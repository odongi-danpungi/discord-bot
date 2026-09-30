import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeHealth, classifyRuntimeError } from '../src/runtime-health.js';
import { OperationsStore } from '../src/operations.js';

test('runtime health aggregates API, Discord, SSE and scheduler failures without exposing secrets',()=>{
 const health=new RuntimeHealth({startedAt:Date.now()-65000});
 health.recordApi({method:'GET',path:'/api/test',status:200,durationMs:10});
 health.recordApi({method:'POST',path:'/api/test',status:500,durationMs:25});
 health.recordDiscord({operation:'sync:close',ok:false,durationMs:30,error:Error('Authorization: Bot super-secret-token-value')});
 health.recordSse('connect');health.recordSse('stale',{delayMs:48000});health.recordSse('client-reconnect');health.recordTick({ok:false,durationMs:8,error:Error('scheduler failed')});
 const snap=health.snapshot({liveClients:1,version:'3.8.0',revision:7});
 assert.equal(snap.status,'fail');assert.equal(snap.api.requests,2);assert.equal(snap.api.serverErrors,1);assert.equal(snap.discord.failures,1);assert.equal(snap.sse.liveClients,1);assert.equal(snap.sse.clientReconnects,1);assert.equal(snap.ticks.failures,1);
 const text=JSON.stringify(snap);assert.doesNotMatch(text,/super-secret-token-value/);assert.match(text,/\[REDACTED\]/);
 health.close();
});

test('diagnostic bundle contains safe configuration flags but not credential values',()=>{
 const health=new RuntimeHealth();const bundle=health.diagnosticBundle({config:{host:'127.0.0.1',port:3000,demo:false,guildId:'123',adminRoleId:'456',broadcastToken:'secret',token:'BOT_SECRET',dashboardPassword:'PASS_SECRET',dashboardOperatorPassword:'OPERATOR_SECRET'},version:'3.8.0',revision:3});
 const text=JSON.stringify(bundle);assert.equal(bundle.configuration.guildConfigured,true);assert.equal(bundle.configuration.broadcastTokenConfigured,true);assert.doesNotMatch(text,/BOT_SECRET|PASS_SECRET|OPERATOR_SECRET|"secret"/);health.close();
});

test('storage observer reports backup recovery and write failures',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'runtime-store-'));try{
  const file=path.join(dir,'ops.json'),events=[];let store=new OperationsStore(file).setObserver(event=>events.push(event));await store.init();await store.update(s=>{s.revision=(s.revision||0)+1;});
  const valid=await readFile(file,'utf8');await writeFile(file+'.bak',valid);await writeFile(file,'{broken');
  store=new OperationsStore(file).setObserver(event=>events.push(event));await store.init();assert.equal(store.recovered,true);assert.ok(events.some(e=>e.type==='recovery'));
  const badDir=path.join(dir,'as-directory');await mkdir(badDir);store.file=badDir;await assert.rejects(store.update(s=>{s.revision++;}));assert.ok(events.some(e=>e.type==='write-failure'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('runtime error classifier distinguishes storage and Discord failures from validation',()=>{
 assert.deepEqual(classifyRuntimeError(Object.assign(Error('disk'),{code:'ENOSPC'})).status,500);
 assert.deepEqual(classifyRuntimeError(Object.assign(Error('discord'),{code:50013})).status,502);
 assert.equal(classifyRuntimeError(Error('bad input')).status,400);
 assert.equal(classifyRuntimeError(new TypeError('boom')).status,500);
});

test('runtime storage incidents do not expose absolute file paths',()=>{
 const health=new RuntimeHealth(),error=Object.assign(Error('ENOSPC: no space, open /home/example/private/data.json'),{path:'/home/example/private/data.json'});
 health.recordPersistence({type:'write-failure',file:'/home/example/private/data.json',error});
 const text=JSON.stringify(health.snapshot());assert.doesNotMatch(text,/\/home\/example\/private/);assert.match(text,/\[PATH\]/);health.close();
});


test('runtime incidents deduplicate in memory and do not spam persisted audit',async()=>{
 const persisted=[],health=new RuntimeHealth();health.attachAudit(event=>persisted.push(event));
 health.recordIncident({severity:'warn',source:'discord',code:'same',summary:'same incident'});
 health.recordIncident({severity:'warn',source:'discord',code:'same',summary:'same incident'});
 await new Promise(resolve=>setImmediate(resolve));
 const snapshot=health.snapshot();assert.equal(snapshot.incidents[0].count,2);assert.equal(persisted.length,1);health.close();
 const seeded=new RuntimeHealth();seeded.seedFromAudit([{id:'old',at:Date.now(),category:'runtime',action:'same',summary:'same incident',details:{source:'discord',severity:'warn',code:'same',count:1}}]);
 seeded.recordIncident({severity:'warn',source:'discord',code:'same',summary:'same incident',persist:false});
 assert.equal(seeded.snapshot().incidents.length,1);assert.equal(seeded.snapshot().incidents[0].count,2);seeded.close();
});

test('semantic operations recovery is reported separately from backup-file recovery',()=>{
  const health=new RuntimeHealth();
  health.recordPersistence({type:'consistency-recovery',file:'/tmp/operations.json',detail:'예약 중복 제거'});
  const snap=health.snapshot();
  assert.equal(snap.persistence.recoveries,1);
  assert.ok(snap.incidents.some(item=>item.code==='state_consistency_recovery'));
  assert.equal(snap.incidents.some(item=>item.code==='backup_recovery'),false);
  health.close();
});

test('durability degradation is visible as a storage warning without exposing absolute paths',()=>{
  const health=new RuntimeHealth();
  health.recordPersistence({type:'durability_degraded',file:'/private/runtime/data.json',operation:'primary-directory-sync',error:Object.assign(Error('directory fsync failed'),{code:'EIO'})});
  const snap=health.snapshot();
  assert.equal(snap.status,'warn');
  assert.equal(snap.persistence.durabilityWarnings,1);
  assert.ok(snap.incidents.some(item=>item.code==='durability_degraded'));
  assert.doesNotMatch(JSON.stringify(snap),/\/private\/runtime/);
  health.close();
});
