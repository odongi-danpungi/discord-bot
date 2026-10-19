import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { RegistrationStore } from '../src/store.js';
import { OperationsStore } from '../src/operations.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { RecoveryStore } from '../src/recovery-store.js';
import { PersistentIdempotencyStore } from '../src/idempotency-store.js';
import { DemoDiscordService } from '../src/discord-service.js';
import { classifyRuntimeError } from '../src/runtime-health.js';

const basic=(user,password)=>'Basic '+Buffer.from(user+':'+password).toString('base64');
async function fixture(t,{queue=true}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'roulette-api-'));
  const store=new RegistrationStore(path.join(dir,'registrations.json')),operations=new OperationsStore(path.join(dir,'operations.json')),recovery=new RecoveryStore(path.join(dir,'recovery.json')),idempotencyStore=new PersistentIdempotencyStore(path.join(dir,'requests.json'));
  await store.init();await operations.init();await recovery.init();await idempotencyStore.init();
  const participationQueue=queue?new ParticipationQueueStore(path.join(dir,'queue.json')):null;
  if(participationQueue)await participationQueue.init();
  const config={host:'127.0.0.1',guildId:'guild',demo:false,dashboardUser:'admin',dashboardPassword:'roulette-admin-test',dashboardOperatorUser:'producer',dashboardOperatorPassword:'roulette-producer-test',dashboardOperatorCapabilities:['broadcast']};
  const discord=new DemoDiscordService();let externalWrites=0,releaseStatus='idle';
  for(const method of ['sync','broadcastOpsNotice','rename','setup'])discord[method]=async()=>{externalWrites++;throw Error('unexpected Discord write');};
  let runtime,server,base;
  async function start(){
    runtime=createApp({config,store,operations,recovery,participationQueue,idempotencyStore,discord,releaseCenter:{snapshot:()=>({status:releaseStatus})}});
    server=await new Promise(resolve=>{const server=runtime.app.listen(0,'127.0.0.1',()=>resolve(server));});
    base='http://127.0.0.1:'+server.address().port;
  }
  async function stop(){runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await start();
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
  const request=async(url,{body,headers={},auth='admin'}={})=>{
    const authorization=auth==='admin'?basic('admin','roulette-admin-test'):auth==='operator'?basic('producer','roulette-producer-test'):'';
    const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{...(authorization?{Authorization:authorization}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),headers:response.headers};
  };
  const view=()=>request('/api/roulette');
  const {data:{csrf}}=await view();
  const spin=(body,options={})=>request('/api/roulette/spin',{body,headers:{'X-CSRF-Token':csrf,'Idempotency-Key':body.requestId,...options.headers},...options});
  const custom=(expectedRevision=0,items=['동동','시리','후리나기'])=>({requestId:randomUUID(),expectedRevision,source:'custom',items});
  return {config,operations,recovery,participationQueue,idempotencyStore,request,view,spin,custom,csrf,async restart(){await stop();await start();},get runtime(){return runtime;},set releaseStatus(value){releaseStatus=value;},get externalWrites(){return externalWrites;}};
}

test('roulette saves a server-selected result, replays exact requests across restart, and never writes Discord or Queue',async t=>{
  const f=await fixture(t),beforeQueue=f.participationQueue.read(),body=f.custom();
  const first=await f.spin(body);assert.equal(first.status,200);assert.equal(first.data.revision,1);assert.equal(first.data.replayed,false);
  assert.equal(first.data.result.requestId,body.requestId);assert.deepEqual(first.data.result.winner,first.data.result.entries[first.data.result.winnerIndex]);
  const duplicate=await f.spin(body);assert.equal(duplicate.status,200);assert.equal(duplicate.data.replayed,true);assert.deepEqual(duplicate.data.result,first.data.result);
  await f.restart();const {data:{csrf}}=await f.view();
  const afterRestart=await f.request('/api/roulette/spin',{body,headers:{'X-CSRF-Token':csrf,'Idempotency-Key':body.requestId}});
  assert.equal(afterRestart.status,200);assert.deepEqual(afterRestart.data.result,first.data.result);assert.equal(afterRestart.data.replayed,true);
  assert.equal(f.operations.read().roulette.revision,1);assert.equal(f.operations.read().roulette.history.length,1);
  assert.deepEqual(f.participationQueue.read(),beforeQueue);assert.equal(f.externalWrites,0);
  assert.equal(f.idempotencyStore.read().entries?.length||0,0,'generic cache must not intercept durable roulette receipts');
  const view=await f.view();assert.deepEqual(view.data.history,[first.data.result]);assert.match(view.headers.get('cache-control'),/no-store/);
  const snapshot=await f.request('/api/snapshot');assert.equal(snapshot.status,200);assert.equal(Object.hasOwn(snapshot.data.state,'roulette'),false);
  assert.doesNotMatch(JSON.stringify(view.data),/fingerprint|identityKey|discordUserId|callToken/);
});

test('roulette validates authentication, CSRF, request keys, duplicate items and client-picked outcomes before mutating',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/roulette',{auth:null})).status,401);
  assert.equal((await f.request('/api/roulette/spin',{body:f.custom()})).status,403);
  assert.equal((await f.request('/api/roulette/spin',{body:f.custom(),headers:{'X-CSRF-Token':f.csrf}})).status,400);
  assert.equal((await f.spin(f.custom(),{headers:{'X-CSRF-Token':f.csrf,'Idempotency-Key':'wrong-request-key'}})).status,400);
  assert.equal((await f.spin({...f.custom(),winnerIndex:0})).status,400);
  assert.equal((await f.spin({...f.custom(),entries:[{id:'spoof',label:'spoof'}]})).status,400);
  for(const url of ['/api/roulette/spin/','/api/Roulette/spin','/API/roulette/spin']){
    const body=f.custom();assert.equal((await f.request(url,{body,headers:{'X-CSRF-Token':f.csrf,'Idempotency-Key':body.requestId}})).status,404);
  }
  assert.equal((await f.spin(f.custom(0,['같은 이름',' 같은 이름 ']))).status,400);
  assert.equal((await f.spin(f.custom(),{headers:{'X-CSRF-Token':f.csrf,'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal(Object.hasOwn(f.operations.read(),'roulette'),false);
});

test('only one concurrent roulette request wins an expected revision and changed request contents conflict',async t=>{
  const f=await fixture(t),one=f.custom(),two=f.custom();
  const results=await Promise.all([f.spin(one),f.spin(two)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winningBody=results[0].status===200?one:two;
  assert.equal((await f.spin({...winningBody,items:['다른','항목']})).status,409);
  assert.equal(f.operations.read().roulette.history.length,1);assert.equal(f.operations.read().roulette.revision,1);
});

test('Queue roulette snapshots only waiting names, checks Queue revision, and replays even when the Queue later changes',async t=>{
  const f=await fixture(t),queue=f.participationQueue;
  await queue.register({source:'discord',displayName:'참가자 A',discordUserId:'secret-discord-id'});
  await queue.register({source:'naver',displayName:'참가자 B'});
  await queue.register({source:'dashboard',displayName:'예약',status:'postponed_next'});
  const view=await f.view();assert.equal(view.data.queueEntries.length,2);assert.doesNotMatch(JSON.stringify(view.data),/secret-discord-id|naverKey|identityKey/);
  const body={requestId:randomUUID(),expectedRevision:0,source:'queue',queueRevision:view.data.queueRevision};
  await queue.register({source:'dashboard',displayName:'추가 참가자'});
  assert.equal((await f.spin(body)).status,409);
  const latest=await f.view(),fresh={...body,requestId:randomUUID(),queueRevision:latest.data.queueRevision},before=queue.read();
  const first=await f.spin(fresh);assert.equal(first.status,200);assert.equal(first.data.result.entries.length,3);assert.deepEqual(queue.read(),before);
  await queue.setStatus(before.entries[0].id,'cancelled');const replay=await f.spin(fresh);
  assert.equal(replay.status,200);assert.deepEqual(replay.data.result,first.data.result);assert.equal(replay.data.replayed,true);assert.equal(f.externalWrites,0);
});

test('broadcast-only delegated operator cannot see or spin Queue names and unrelated operators cannot access roulette',async t=>{
  const f=await fixture(t),queue=f.participationQueue;
  await queue.register({displayName:'비공개 Queue A'});await queue.register({displayName:'비공개 Queue B'});
  const view=await f.view();const adminSpin=await f.spin({requestId:randomUUID(),expectedRevision:0,source:'queue',queueRevision:view.data.queueRevision});assert.equal(adminSpin.status,200);
  const operator=await f.request('/api/roulette',{auth:'operator'});assert.equal(operator.status,200);assert.deepEqual(operator.data.queueEntries,[]);assert.equal(operator.data.queueRevision,null);assert.equal(operator.data.history.length,0);assert.doesNotMatch(JSON.stringify(operator.data),/비공개 Queue/);
  assert.equal((await f.spin({requestId:randomUUID(),expectedRevision:1,source:'queue',queueRevision:view.data.queueRevision},{auth:'operator'})).status,403);
  assert.equal((await f.spin(f.custom(1),{auth:'operator'})).status,200);
  f.config.dashboardOperatorCapabilities=['queue'];assert.equal((await f.request('/api/roulette',{auth:'operator'})).status,403);
  assert.equal((await f.spin(f.custom(2),{auth:'operator'})).status,403);
  f.config.dashboardOperatorCapabilities=['queue','broadcast'];assert.equal((await f.request('/api/roulette',{auth:'operator'})).data.history.length,2);
});

test('roulette stops under emergency/release/draining states, including a request waiting behind another save',async t=>{
  const f=await fixture(t);
  await f.recovery.setEmergency({locked:true});assert.equal((await f.spin(f.custom())).status,423);await f.recovery.setEmergency({locked:false});
  for(const status of ['staging','applying','rolling-back','restart-required','rollback-restart-required']){f.releaseStatus=status;assert.equal((await f.spin(f.custom())).status,423);}
  f.releaseStatus='idle';let unblock,entered;const enteredPromise=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{unblock=resolve;});
  const saving=f.operations.update(async()=>{entered();await blocked;});await enteredPromise;
  let queued;const queuedPromise=new Promise(resolve=>{queued=resolve;}),update=f.operations.update.bind(f.operations);
  f.operations.update=fn=>{queued();return update(fn);};
  const pending=f.spin(f.custom());await queuedPromise;f.releaseStatus='restart-required';unblock();await saving;
  assert.equal((await pending).status,423);assert.equal(Object.hasOwn(f.operations.read(),'roulette'),false);
  f.releaseStatus='idle';f.runtime.beginShutdown();assert.equal((await f.spin(f.custom())).status,503);
});

test('Queue absent and oversized pools fail closed without blocking custom roulette',async t=>{
  const f=await fixture(t,{queue:false}),view=await f.view();assert.equal(view.status,200);assert.equal(view.data.queueRevision,null);assert.deepEqual(view.data.queueEntries,[]);
  assert.equal((await f.spin({requestId:randomUUID(),expectedRevision:0,source:'queue',queueRevision:0})).status,503);
  assert.equal((await f.spin(f.custom())).status,200);
  const large=await fixture(t);await large.participationQueue.update(state=>{
    for(let i=0;i<101;i++)state.entries.push({id:randomUUID(),sequence:i+1,position:i+1,source:'dashboard',status:'waiting',identityKey:'test:'+i,displayName:'참가자 '+i,createdAt:1,updatedAt:1});
    state.revision=1;state.nextSequence=102;
  });
  const crowded=await large.view();assert.equal(crowded.data.queueCount,101);assert.deepEqual(crowded.data.queueEntries,[]);assert.match(crowded.data.queueMessage,/100명/);
  assert.equal((await large.spin({requestId:randomUUID(),expectedRevision:0,source:'queue',queueRevision:1})).status,400);assert.equal(Object.hasOwn(large.operations.read(),'roulette'),false);
});

test('explicit service unavailability stays 503 while internal details stay private',()=>{
  const classified=classifyRuntimeError(Object.assign(Error('private-token=do-not-expose'),{status:503}));
  assert.equal(classified.status,503);assert.doesNotMatch(classified.message,/do-not-expose|private/);
});
