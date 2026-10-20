import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildLocalSelfCheck, createRestorePoint, inspectBackup, recoveryDigest, validOperationsState, verifyRestorePoint } from '../src/recovery-audit.js';
import { RecoveryStore } from '../src/recovery-store.js';
import { DEFAULT_INTAKE_POLICY } from '../src/intake-policy.js';
import { OperationsStore,applyAction } from '../src/operations.js';
import { RegistrationStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createViewerAuth } from '../src/viewer.js';
import { DemoDiscordService } from '../src/discord-service.js';
import { randomUUID } from 'node:crypto';

const records=[{guildId:'guild',discordId:'u1',chzzkName:'별1'},{guildId:'guild',discordId:'u2',chzzkName:'별2'}];
const operations={guildId:'guild',revision:7,session:null,history:[],reservations:[],sessionArchive:[],rounds:{}};

test('full backup verification rejects another guild and duplicate registrations',()=>{
 const good=inspectBackup({version:2,guildId:'guild',exportedAt:new Date().toISOString(),records,operations},'guild');
 assert.equal(good.ok,true);assert.equal(good.stats.records,2);assert.match(good.digest,/^[a-f0-9]{64}$/);
 const wrong=inspectBackup({version:2,guildId:'other',records:[records[0],records[0]],operations},'guild');
 assert.equal(wrong.ok,false);assert.ok(wrong.checks.some(c=>c.id==='guild'&&c.status==='fail'));assert.ok(wrong.checks.some(c=>c.id==='duplicates'&&c.status==='fail'));
 const poisoned=JSON.parse(JSON.stringify({version:2,guildId:'guild',records,operations}).replace('\"history\":[]','\"history\":[],\"__proto__\":{\"polluted\":true}'));
 assert.equal(inspectBackup(poisoned,'guild').ok,false);
 const newer=inspectBackup({version:2,guildId:'guild',records,operations:{...operations,schemaVersion:999}},'guild');
 assert.equal(newer.ok,false);assert.ok(newer.checks.some(c=>c.id==='schema'&&c.status==='fail'));
});

test('restore point digest detects tampering',()=>{
 const point=createRestorePoint({records,operations,label:'방송 전',guildId:'guild',at:1000});
 assert.equal(verifyRestorePoint(point,'guild').ok,true);
 point.records[0].chzzkName='변조';
 assert.equal(verifyRestorePoint(point,'guild').ok,false);
});

test('self-check reports broken session references and unsafe remote broadcast exposure',()=>{
 const bad={...operations,session:{phase:'checking',applicants:['u1'],winners:['u2'],confirmed:['u2'],teams:[['u2']]}};
 const result=buildLocalSelfCheck({config:{guildId:'guild',host:'0.0.0.0',broadcastToken:''},records,operations:bad,recovery:{restorePoints:[],auditLog:[]},nodeVersion:'v22.22.2'});
 assert.equal(result.ok,false);assert.ok(result.checks.some(c=>c.id==='session-integrity'&&c.status==='fail'));assert.ok(result.checks.some(c=>c.id==='broadcast-token'&&c.status==='fail'));
});

test('RecoveryStore persists checkpoints and bounded audit metadata',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'recovery-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new RecoveryStore(path.join(dir,'recovery.json'));await store.init();
 const point=await store.checkpoint({records,operations,label:'수동',guildId:'guild'});assert.ok(point.id.startsWith('rp_'));
 await store.audit({category:'recovery',action:'checkpoint_create',summary:'복원 지점 생성',actor:'admin',details:{token:'SHOULD_NOT_SAVE',count:2}});
 const summary=store.summary('guild');assert.equal(summary.restorePoints.length,1);assert.equal(summary.restorePoints[0].integrity,true);assert.equal(summary.auditLog.length,1);assert.equal(summary.auditLog[0].details.token,undefined);assert.equal(summary.auditLog[0].details.count,2);
});

function sessionOperations(){const state=structuredClone(operations);applyAction(state,'open',{game:'lol',count:1},1000);return state;}
function malformedIntakeStates(){
 const state=sessionOperations();
 return [
  {...operations,intakeSettings:null},
  {...operations,intakeSettings:{revision:1,settings:{...DEFAULT_INTAKE_POLICY,maxApplicants:'5'}}},
  {...operations,intakeSettings:{revision:-1,settings:{...DEFAULT_INTAKE_POLICY}}},
  {...operations,intakeSettings:{revision:1,settings:{...DEFAULT_INTAKE_POLICY},unexpected:true}},
  {...state,session:{...state.session,intakePolicy:null}},
  {...state,session:{...state.session,intakePolicy:{...DEFAULT_INTAKE_POLICY,closeOnCapacity:true}}},
  {...state,session:{...state.session,intakePolicy:{...DEFAULT_INTAKE_POLICY,duplicatePolicy:'merge_names'}}}
 ];
}

test('backup and checkpoint checks reject malformed intake policies even with a recomputed valid digest',()=>{
 const original=createRestorePoint({records,operations,guildId:'guild'});
 for(const malformed of malformedIntakeStates()){
  const before=structuredClone(malformed);
  assert.equal(validOperationsState(malformed,'guild'),false);
  const checked=inspectBackup({version:2,guildId:'guild',records,operations:malformed},'guild');
  assert.equal(checked.ok,false);assert.equal(checked.digest,null);
  assert.ok(checked.checks.some(check=>check.id==='operations'&&check.status==='fail'));
  assert.throws(()=>createRestorePoint({records,operations:malformed,guildId:'guild'}),/현재 데이터를 복원 지점/);
  const point={...original,operations:malformed,digest:recoveryDigest(records,malformed)};
  assert.equal(verifyRestorePoint(point,'guild').ok,false,'a matching digest must not bypass intake schema validation');
  assert.deepEqual(malformed,before,'read-only validation must not repair or drop invalid policy values');
 }
});

test('legacy backups without intake fields and explicit valid policy snapshots retain compatibility',()=>{
 const legacy=sessionOperations();delete legacy.session.intakePolicy;
 const explicit={...sessionOperations(),intakeSettings:{revision:2,settings:{maxApplicants:30,duplicatePolicy:'reject',closeOnCapacity:true}}};
 for(const state of [operations,legacy,explicit]){
  const before=structuredClone(state);
  assert.equal(validOperationsState(state,'guild'),true);
  assert.equal(inspectBackup({version:2,guildId:'guild',records,operations:state},'guild').ok,true);
  const point=createRestorePoint({records,operations:state,guildId:'guild'});
  assert.equal(verifyRestorePoint(point,'guild').ok,true);assert.deepEqual(point.operations,state);
  assert.deepEqual(state,before);
 }
});

test('refusing a malformed intake checkpoint preserves recovery storage bytes',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'recovery-intake-checkpoint-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new RecoveryStore(path.join(dir,'recovery.json'));await store.init();
 await store.checkpoint({records,operations,guildId:'guild',label:'valid legacy'});
 const before=store.read(),bytes=await readFile(store.file);
 for(const malformed of malformedIntakeStates()){
  await assert.rejects(store.checkpoint({records,operations:malformed,guildId:'guild'}),/현재 데이터를 복원 지점/);
  assert.deepEqual(store.read(),before);assert.deepEqual(await readFile(store.file),bytes);
 }
});

test('real backup verification and restore APIs reject malformed policies before changing live data',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'recovery-intake-api-'));
 const store=new RegistrationStore(path.join(dir,'people.json')),ops=new OperationsStore(path.join(dir,'operations.json'));
 await store.init();await ops.init();for(const record of records)await store.upsert(record);
 await ops.update(state=>applyAction(state,'open',{game:'lol',count:1}));
 const runtime=createApp({config:{host:'127.0.0.1',guildId:'guild',demo:false,dashboardUser:'fixture-admin',dashboardPassword:'fixture-password-1234',backupDir:path.join(dir,'backups')},
  store,operations:ops,discord:new DemoDiscordService(),viewerAuth:createViewerAuth()});
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,auth='Basic '+Buffer.from('fixture-admin:fixture-password-1234').toString('base64');
 const snapshot=await fetch(base+'/api/snapshot',{headers:{Authorization:auth}}).then(response=>response.json());
 const post=(route,body)=>fetch(base+route,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json','X-CSRF-Token':snapshot.csrf,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
 const before=ops.read(),people=store.read(),opsBytes=await readFile(ops.file),peopleBytes=await readFile(store.file);
 for(const malformed of malformedIntakeStates()){
  const bundle={version:2,guildId:'guild',records:[{guildId:'guild',discordId:'replacement',chzzkName:'should not be restored'}],operations:malformed};
  const checked=await post('/api/backup/verify',bundle);assert.equal(checked.status,200);assert.equal((await checked.json()).ok,false);
  const restored=await post('/api/backup/restore',{bundle});assert.equal(restored.status,400);assert.match((await restored.json()).error,/백업 검증/);
  assert.deepEqual(ops.read(),before);assert.deepEqual(store.read(),people);
  assert.deepEqual(await readFile(ops.file),opsBytes);assert.deepEqual(await readFile(store.file),peopleBytes);
 }
 // A rejected restore leaves the live store usable rather than poisoning its next mutation.
 await ops.update(state=>applyAction(state,'join',{sessionId:state.session.id,userId:'u1'}));
 assert.deepEqual(ops.read().session.applicants,['u1']);
});
