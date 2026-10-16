import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp,rm,writeFile,readFile,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspacePlatform } from '../src/workspace-platform.js';
import { createWorkspaceRuntime } from '../src/workspace-runtime.js';
import { loadConfig } from '../src/config.js';
import { applyAction } from '../src/operations.js';

const A='111111111111111111',B='222222222222222222',owner='333333333333333333',person='444444444444444444';
async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-platform-')),client=new EventEmitter(),roles=new Map([[owner,true],[person,false]]),deniedMembers=new Set();
  client.guilds={cache:new Map([[A,{}],[B,{}]]),async fetch(id){return {id,name:id===A?'방송 A':'방송 B',ownerId:'999999999999999999',members:{async fetch({user}){if(!roles.has(user)||deniedMembers.has(id+':'+user))throw Error('not member');return {user:{bot:false},permissions:{has:()=>roles.get(user)}};}}};}};
  const config={...await loadConfig({},['--demo']),multiWorkspaceEnabled:true,publicBaseUrl:'http://127.0.0.1',operationsFile:path.join(dir,'operations.json'),guildId:'555555555555555555',clientId:'666666666666666666',discordClientSecret:'fixture-secret',dashboardPassword:'fixture-password-123',host:'127.0.0.1'};
  const platform=await createWorkspacePlatform({config,client,fetchImpl:async(url,opts)=>{
    let data;if(url.endsWith('/oauth2/token'))data={access_token:new URLSearchParams(opts.body).get('code'),token_type:'Bearer'};
    else if(url.endsWith('/users/@me'))data={id:opts.headers.Authorization.slice(7),username:'가상 사용자'};
    else data=[{id:A,name:'방송 A'},{id:B,name:'방송 B'}];
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  }});
  const server=platform.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{try{await platform.close();}finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}});
  async function login(user){const start=await fetch(base+'/portal/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state'),cookie=start.headers.getSetCookie()[0].split(';')[0];
    const done=await fetch(base+'/portal/auth/callback?state='+state+'&code='+user,{headers:{cookie},redirect:'manual'});assert.equal(done.status,303);
    const sessionCookie=done.headers.getSetCookie().find(x=>x.startsWith('dd_portal=')).split(';')[0];
    const session=await(await fetch(base+'/portal/auth/session',{headers:{cookie:sessionCookie}})).json();
    return {cookie:sessionCookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};
  }
  return {platform,base,roles,deniedMembers,login,client,config,request:async(url,headers,body)=>fetch(base+url,{headers,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})})};
}
async function prepareClosedCall(f,kind){
  const prepared=await prepareParticipants(f),context=prepared.contexts[A],sent=[];
  context.discord.participationCall=async(entry)=>{sent.push(entry.id);return {channelId:'fixture-channel',id:'fixture-message-'+sent.length};};
  context.discord.completeParticipationCall=async()=>{};
  await context.operations.update(state=>{
    state.reservations=[];
    if(kind==='capacity')state.intakeSettings={revision:1,settings:{maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:true}};
    applyAction(state,'open',{game:'lol',mode:'aram',count:1,title:'마감 후 호출'});
    for(const userId of [person,owner])applyAction(state,'join',{sessionId:state.session.id,userId});
    if(kind==='manual')applyAction(state,'close');
    if(kind==='deadline')state.session.closeAt=Date.now()-1;
  });
  await context.participationQueue.syncOperations({records:context.store.read()});
  await context.participationCalls.callNext();
  const raw=context.participationQueue.read().entries.find(entry=>entry.status==='called');
  assert.equal(raw.discordUserId,person);
  return {...prepared,context,sent,raw};
}

for(const kind of ['manual','deadline','capacity'])test(`participant API persists a ${kind} post-close pass once, preserves isolation and hides the next caller`,async t=>{
  const f=await fixture(t),p=await prepareClosedCall(f,kind),{context,participant,admin,raw,sent}=p;
  const route='/w/'+A+'/viewer/api/participation',body={action:'call_pass',expectedSessionId:context.operations.read().session.id,userId:owner};
  const before=context.operations.read(),queueBefore=context.participationQueue.read(),b=p.contexts[B].operations.read();
  for(const headers of [{...participant,'X-CSRF-Token':'wrong'},{...participant,Origin:'https://untrusted.invalid'}])assert.equal((await f.request(route+'/action',headers,body)).status,403);
  assert.deepEqual(context.operations.read(),before);assert.deepEqual(context.participationQueue.read(),queueBefore);
  const ready=await(await f.request(route,participant)).json();assert.equal(ready.actions.callPass,true);assert.equal(ready.actions.join,false);
  const headers={...participant,'Idempotency-Key':'post-close-pass-'+kind};
  const passed=await f.request(route+'/action',headers,body);assert.equal(passed.status,200);const result=await passed.json();
  assert.equal(result.state.queue.entry.status,'postponed_next');assert.deepEqual(result.state.reservations,[{game:'lol',round:2}]);
  assert.equal(result.state.queue.passPending,false);assert.equal(result.result.next,undefined);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(owner+'|callPassReceipts|callPassAdvances|callPassReceipt|'+raw.callToken));
  assert.deepEqual(context.operations.read().reservations,[{game:'lol',userId:person,round:2}]);
  assert.equal(context.operations.read().session.phase,before.session.phase);
  assert.deepEqual(p.contexts[B].operations.read(),b);assert.equal(sent.length,2);
  const replay=await f.request(route+'/action',headers,body);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),result);assert.equal(sent.length,2);
  const snapshot=await(await f.request('/w/'+A+'/api/snapshot',admin)).json();assert.equal(snapshot.state.callPassReceipts,undefined);assert.equal(snapshot.participationQueue.callPassAdvances,undefined);
});

test('participant API reports a durable pass awaiting Queue recovery without writes on GET',async t=>{
  const f=await fixture(t),p=await prepareClosedCall(f,'manual'),{context,participant}=p,queue=context.participationQueue;
  const route='/w/'+A+'/viewer/api/participation',original=queue.writeUnlocked;
  queue.writeUnlocked=async()=>{throw Object.assign(Error('private queue path'),{code:'ENOSPC'});};
  try{
    const response=await f.request(route+'/action',participant,{action:'call_pass',expectedSessionId:context.operations.read().session.id});assert.equal(response.status,500);assert.doesNotMatch(await response.text(),/private queue path/);
    assert.equal(context.operations.read().reservations.length,1);
    const before=context.operations.read(),queued=queue.read();
    const pending=await(await f.request(route,participant)).json();assert.equal(pending.queue.passPending,true);assert.equal(pending.actions.callJoin,false);assert.equal(pending.actions.callPass,false);
    assert.equal(pending.queue.callResponse.state,'confirming');assert.equal(pending.queue.callResponse.confirmedAt,null);
    assert.match(pending.queue.entry.statusLabel,/반영 확인/);assert.doesNotMatch(JSON.stringify(pending),/callPassReceipt|callPassAdvances/);
    assert.deepEqual(context.operations.read(),before);assert.deepEqual(queue.read(),queued);
  }finally{queue.writeUnlocked=original;}
  await context.participationCalls.start();
  const recovered=await(await f.request(route,participant)).json();assert.equal(recovered.queue.passPending,false);assert.equal(recovered.queue.entry.status,'postponed_next');assert.equal(context.operations.read().reservations.length,1);
});

test('own pass result reads are private, durable, read-only and separate from the current reservation',async t=>{
  const f=await fixture(t),p=await prepareClosedCall(f,'manual'),{context,participant,admin,raw,sent}=p;
  const route='/w/'+A+'/viewer/api/participation',binding={entryId:raw.id,attempt:raw.callAttempt,sessionId:raw.sessionId};
  const response=await f.request(route+'/action',participant,{action:'call_pass',expectedSessionId:raw.sessionId,expectedCall:binding});assert.equal(response.status,200);
  // Deliberately discard the original response body: fresh GET must provide proof.
  const queue=context.participationQueue,ops=context.operations,files=[ops.file,queue.file];
  const bytes=await Promise.all(files.map(file=>readFile(file))),times=await Promise.all(files.map(file=>stat(file).then(info=>info.mtimeMs))),before=ops.read(),queued=queue.read(),sends=sent.length;
  for(let i=0;i<2;i++){
    const result=await(await f.request(route+'?userId='+owner,participant)).json();
    assert.equal(result.queue.callResponse.state,'recorded');assert.equal(result.queue.callResponse.action,'pass');assert.equal(result.queue.callResponse.targetRound,2);
    assert.ok(result.queue.callResponse.confirmedAt>=result.queue.callResponse.recordedAt);
    assert.deepEqual(result.reservations,[{game:'lol',round:2}]);
    assert.doesNotMatch(JSON.stringify(result),new RegExp(owner+'|'+raw.callToken+'|callPassReceipt|targetId|identityKey'));
  }
  const other=await(await f.request(route,admin)).json();assert.equal(other.queue.callResponse,null);
  const otherServer=await(await f.request('/w/'+B+'/viewer/api/participation',participant)).json();assert.equal(otherServer.queue.callResponse,null);
  assert.deepEqual(ops.read(),before);assert.deepEqual(queue.read(),queued);assert.equal(sent.length,sends);
  assert.deepEqual(await Promise.all(files.map(file=>readFile(file))),bytes);assert.deepEqual(await Promise.all(files.map(file=>stat(file).then(info=>info.mtimeMs))),times);
  assert.equal((await f.request(route+'/action',participant,{action:'cancel_reservation',game:'lol',expectedSessionId:raw.sessionId})).status,200);
  const cancelled=await(await f.request(route,participant)).json();assert.deepEqual(cancelled.reservations,[]);assert.equal(cancelled.queue.callResponse.state,'recorded');
  await ops.update(state=>{applyAction(state,'end');applyAction(state,'open',{game:'lol',count:1,title:'새 모집'});});
  const changed=await(await f.request(route,participant)).json();assert.equal(changed.queue.callResponse,null);
});

test('participant result remains confirming when acknowledgement fails, and GET never retries that write',async t=>{
  const f=await fixture(t),p=await prepareClosedCall(f,'manual'),{context,participant}=p,ops=context.operations,queue=context.participationQueue;
  const route='/w/'+A+'/viewer/api/participation',ack=ops.acknowledgeCallPasses;
  let attempts=0;ops.acknowledgeCallPasses=async()=>{attempts++;throw Object.assign(Error('private acknowledgement path'),{code:'EIO'});};
  try{
    const accepted=await f.request(route+'/action',participant,{action:'call_pass',expectedSessionId:ops.read().session.id});assert.equal(accepted.status,200);
    const before=ops.read(),queued=queue.read(),count=attempts;
    const state=await(await f.request(route,participant)).json();assert.equal(state.queue.callResponse.state,'confirming');assert.equal(state.queue.passPending,true);
    assert.equal(attempts,count);assert.deepEqual(ops.read(),before);assert.deepEqual(queue.read(),queued);assert.doesNotMatch(JSON.stringify(state),/private acknowledgement|callPassReceipt/);
  }finally{ops.acknowledgeCallPasses=ack;await queue.recoverCallPasses();}
  const confirmed=await(await f.request(route,participant)).json();assert.equal(confirmed.queue.callResponse.state,'recorded');
});

test('participant HTTP call binding rejects same-session recall, foreign context and malformed input before accepting the fresh binding',async t=>{
  const f=await fixture(t),p=await prepareClosedCall(f,'manual'),{context,participant,raw}=p,queue=context.participationQueue;
  const route='/w/'+A+'/viewer/api/participation/action',binding={entryId:raw.id,attempt:raw.callAttempt,sessionId:raw.sessionId};
  await context.participationCalls.recall(raw.id);const before=context.operations.read(),queued=queue.read();
  for(const action of ['call_pass','call_join']){
    const stale=await f.request(route,participant,{action,expectedSessionId:raw.sessionId,expectedCall:binding});assert.equal(stale.status,409);
    const foreign=await f.request(route,participant,{action,expectedCall:{...binding,entryId:'foreign-private-entry'}});assert.equal(foreign.status,409);assert.doesNotMatch(await foreign.text(),/foreign-private-entry/);
    const malformed=await f.request(route,participant,{action,expectedCall:{...binding,attempt:'2'}});assert.equal(malformed.status,400);
  }
  assert.deepEqual(context.operations.read(),before);assert.deepEqual(queue.read(),queued);
  const current=queue.read().entries.find(entry=>entry.id===raw.id);
  const accepted=await f.request(route,participant,{action:'call_join',expectedSessionId:raw.sessionId,expectedCall:{entryId:current.id,attempt:current.callAttempt,sessionId:current.sessionId}});assert.equal(accepted.status,200);
  const result=await accepted.json();assert.equal(result.state.queue.entry.status,'joined');assert.equal(result.state.queue.callResponse,null,'joined state is not a durable pass result');
});

test('participant recruitment reads current session capacity per server without exposing identities or writing state',async t=>{
  const f=await fixture(t),{participant,contexts}=await prepareParticipants(f);
  for(const [id,capacity]of [[A,3],[B,7]])await contexts[id].operations.update(state=>{
    state.reservations=[];
    state.intakeSettings={revision:1,settings:{maxApplicants:capacity,duplicatePolicy:'reject',closeOnCapacity:false}};
    applyAction(state,'open',{game:'lol',mode:'aram',count:1,title:'현재 모집'});
    applyAction(state,'join',{sessionId:state.session.id,userId:owner});
    state.intakeSettings={revision:2,settings:{maxApplicants:99,duplicatePolicy:'keep_existing',closeOnCapacity:true}};
  });
  await contexts[A].participationQueue.register({source:'dashboard',displayName:'다른 사람의 수동 Queue'});
  const before=Object.fromEntries([A,B].map(id=>[id,{state:contexts[id].operations.read(),queue:contexts[id].participationQueue.read()}]));
  for(const [id,capacity]of [[A,3],[B,7]]){
    const response=await f.request('/w/'+id+'/viewer/api/participation',participant);
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const body=await response.json();
    assert.deepEqual(body.recruitment,{status:'open',reason:null,maxApplicants:capacity,activeApplicants:1,remainingSlots:capacity-1,unlimited:false,closeAt:0,drawCount:1,duplicatePolicy:'reject'});
    assert.equal(body.actions.join,true);
    assert.equal(JSON.stringify(body).includes(owner),false);
    assert.equal(JSON.stringify(body).includes('다른 사람의 수동 Queue'),false);
    assert.deepEqual(contexts[id].operations.read(),before[id].state);
    assert.deepEqual(contexts[id].participationQueue.read(),before[id].queue);
  }
  assert.equal((await f.request('/w/'+A+'/viewer/api/participation',{})).status,401);
});

test('participant recruitment at capacity hides admission and keeps server-side conflicts and own cancellation available',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f),operations=contexts[A].operations;
  await operations.update(state=>{
    state.reservations=[];state.intakeSettings={revision:1,settings:{maxApplicants:1,duplicatePolicy:'keep_existing',closeOnCapacity:false}};
    applyAction(state,'open',{game:'lol',count:1,title:'한 자리'});
    applyAction(state,'join',{sessionId:state.session.id,userId:owner});
  });
  const read=()=>f.request('/w/'+A+'/viewer/api/participation',participant);
  const full=await(await read()).json();assert.equal(full.recruitment.status,'full');assert.equal(full.recruitment.reason,'capacity');
  assert.equal(full.recruitment.remainingSlots,0);assert.equal(full.actions.join,false);
  const own=await(await f.request('/w/'+A+'/viewer/api/participation',admin)).json();assert.equal(own.actions.leave,true);
  const rejected=await f.request('/w/'+A+'/viewer/api/participation/action',participant,{action:'join',expectedSessionId:operations.read().session.id});
  assert.equal(rejected.status,409);assert.deepEqual(operations.read().session.applicants,[owner]);
  await operations.update(state=>applyAction(state,'leave',{sessionId:state.session.id,userId:owner}));
  const available=await(await read()).json();assert.equal(available.recruitment.remainingSlots,1);assert.equal(available.actions.join,true);
  const stale=await f.request('/w/'+A+'/viewer/api/participation/action',participant,{action:'join',expectedSessionId:'old-session'});
  assert.equal(stale.status,409);assert.deepEqual(operations.read().session.applicants,[]);
});

test('participant recruitment rechecks current server membership even after a cached read and masks invalid stored policy',async t=>{
  const f=await fixture(t),{participant,contexts}=await prepareParticipants(f);
  const route='/w/'+A+'/viewer/api/participation';
  for(const variant of [route+'/',route.replace('/participation','/Participation'),route]){
    f.deniedMembers.delete(A+':'+person);
    assert.equal((await f.request(route,participant)).status,200);
    f.deniedMembers.add(A+':'+person);
    assert.equal((await f.request(variant,participant)).status,403,'a cached membership must not reveal current recruitment after removal: '+variant);
  }
  assert.equal((await f.request('/w/'+B+'/viewer/api/participation',participant)).status,200);
  f.deniedMembers.delete(A+':'+person);
  const operations=contexts[A].operations;
  await operations.update(state=>{state.reservations=[];applyAction(state,'open',{game:'lol',count:1,title:'안전한 모집'});});
  const original=operations.read.bind(operations),saved=original();
  operations.read=()=>({...saved,session:{...saved.session,intakePolicy:{maxApplicants:'private-invalid-path',duplicatePolicy:'reject',closeOnCapacity:false}}});
  try{const failed=await f.request(route,participant);assert.equal(failed.status,503);const text=await failed.text();assert.equal(text.includes('private-invalid-path'),false);assert.equal(text.includes('recruitment'),false);}
  finally{operations.read=original;}
  assert.equal((await f.request(route,participant)).status,200);
});

test('real workspace runtimes isolate operations, participants, CSRF and creator APIs',async t=>{
  const f=await fixture(t),admin=await f.login(owner),participant=await f.login(person);
  assert.equal((await f.request('/portal/api/servers/'+A,participant,{})).status,403);
  for(const id of [A,B]){const r=await f.request('/portal/api/servers/'+id,admin,{});assert.equal(r.status,200,await r.text());}
  assert.equal(f.client.listenerCount('interactionCreate'),1);
  assert.equal((await f.request('/w/'+A+'/settings',admin,{naverCafeId:'123'})).status,200);
  assert.equal((await(await f.request('/w/'+B+'/settings',admin)).json()).settings.naverCafeId,'');
  const added=await f.request('/w/'+A+'/api/participation-queue/register',admin,{displayName:'A만의 참가자'});assert.equal(added.status,200,await added.text());
  const a=await(await f.request('/w/'+A+'/api/snapshot',admin)).json(),b=await(await f.request('/w/'+B+'/api/snapshot',admin)).json();
  assert.equal(a.participationQueue.entries.length,1);assert.equal(b.participationQueue.entries.length,0);assert.equal(a.csrf,admin['X-CSRF-Token']);
  assert.equal(a.access.role,'workspace');assert.equal(a.runtime,undefined);assert.equal(a.state.safeDeploy,undefined);
  for(const route of ['/api/release','/api/runtime','/api/recovery','/index.html','/app.js'])assert.equal((await f.request('/w/'+A+route,admin)).status,route.endsWith('.html')||route.endsWith('.js')?404:403,route);
  assert.equal((await f.request('/w/'+A+'/api/snapshot',participant)).status,403);
  assert.equal((await f.request('/w/'+A+'/api/participation-queue/register',{...admin,'X-CSRF-Token':'bad'},{displayName:'blocked'})).status,403);
  assert.equal((await f.request('/w/'+A+'/api/participation-queue/register',{...admin,Origin:'https://untrusted.invalid'},{displayName:'blocked'})).status,403);
  const role=await(await f.request('/portal/api/servers/'+A,participant)).json();assert.equal(role.role,'participant');
  let globallyPaused=true;
  f.platform.registerLegacy({context:{config:{}},runtime:{operationGuard:()=>{if(globallyPaused)throw Object.assign(Error('global pause fixture'),{status:423});}}});
  assert.equal((await(await f.request('/w/'+A+'/api/snapshot',admin)).json()).paused,true,'operator home must reflect a creator-wide pause');
  globallyPaused=false;
  assert.equal((await(await f.request('/w/'+A+'/api/snapshot',admin)).json()).paused,false);
  f.roles.set(owner,false);assert.equal((await f.request('/w/'+A+'/settings',admin,{naverCafeId:'999'})).status,403);
});

async function prepareParticipants(f){
  const admin=await f.login(owner),participant=await f.login(person),contexts={};
  for(const id of [A,B]){
    const response=await f.request('/portal/api/servers/'+id,admin,{});assert.equal(response.status,200,await response.text());
    const {context}=await f.platform.runtimeFor(id);contexts[id]=context;
    for(const userId of [owner,person])await context.store.upsert({guildId:id,discordId:userId,chzzkName:id+'-'+userId,lolRiotId:'가상참가자#KR1'});
    await context.operations.update(state=>{state.reservations=[{userId:owner,game:'lol',round:3},{userId:person,game:'lol',round:4}];});
  }
  return {admin,participant,contexts};
}

test('intake settings require a current operator, isolate servers and preserve active sessions and Queue',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  await contexts[A].operations.update(state=>applyAction(state,'open',{game:'lol',mode:'aram',count:1,title:'기존 모집'}));
  await contexts[A].participationQueue.register({source:'dashboard',displayName:'독립 Queue'});
  const before=contexts[A].operations.read(),queue=contexts[A].participationQueue.read();
  const initial=await(await f.request('/w/'+A+'/intake-settings',admin)).json();
  assert.deepEqual(initial,{revision:0,settings:{maxApplicants:0,duplicatePolicy:'keep_existing',closeOnCapacity:false}});
  const input={maxApplicants:5,duplicatePolicy:'reject',closeOnCapacity:true,revision:0};
  const response=await f.request('/w/'+A+'/intake-settings',admin,input),body=await response.text();assert.equal(response.status,200,body);
  assert.deepEqual(JSON.parse(body),{revision:1,settings:{maxApplicants:5,duplicatePolicy:'reject',closeOnCapacity:true}});
  assert.deepEqual(contexts[A].operations.read().session,before.session);
  assert.deepEqual(contexts[A].operations.read().reservations,before.reservations);
  assert.deepEqual(contexts[A].participationQueue.read(),queue);
  assert.deepEqual(await(await f.request('/w/'+B+'/intake-settings',admin)).json(),initial);
  for(const headers of [participant,{}]){
    assert.equal((await f.request('/w/'+A+'/intake-settings',headers)).status,headers===participant?403:401);
    assert.equal((await f.request('/w/'+A+'/intake-settings',headers,input)).status,headers===participant?403:401);
  }
  for(const headers of [{...admin,'X-CSRF-Token':'wrong'},{...admin,Origin:'https://untrusted.invalid'}])
    assert.equal((await f.request('/w/'+A+'/intake-settings',headers,{...input,revision:1})).status,403);
  f.roles.set(owner,false);
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin)).status,403,'read must recheck removed operator privileges');
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin,{...input,revision:1})).status,403);
});

test('intake API rejects concurrent stale saves, invalid combinations and masked persistence errors',async t=>{
  const f=await fixture(t),{admin,contexts}=await prepareParticipants(f);
  const input={maxApplicants:3,duplicatePolicy:'keep_existing',closeOnCapacity:false,revision:0};
  const responses=await Promise.all([f.request('/w/'+A+'/intake-settings',admin,input),f.request('/w/'+A+'/intake-settings',admin,{...input,maxApplicants:4})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const saved=contexts[A].operations.read();
  for(const body of [{...input,revision:1,maxApplicants:'3'},{...input,revision:1,maxApplicants:1001},{...input,revision:1,maxApplicants:3.1},{...input,revision:1,maxApplicants:0,closeOnCapacity:true},{...input,revision:1,duplicatePolicy:'allow'},{...input,revision:1,token:'never-save'}])
    assert.equal((await f.request('/w/'+A+'/intake-settings',admin,body)).status,400);
  const original=contexts[A].operations.writeUnlocked;
  contexts[A].operations.writeUnlocked=async()=>{throw Error('private filesystem detail');};
  try{
    const failed=await f.request('/w/'+A+'/intake-settings',admin,{...input,revision:1,maxApplicants:8});
    assert.equal(failed.status,503);assert.equal((await failed.text()).includes('private filesystem detail'),false);
    assert.deepEqual(contexts[A].operations.read(),saved);
  }finally{contexts[A].operations.writeUnlocked=original;}
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin,{...input,revision:1,maxApplicants:8})).status,200);
});

test('intake settings remain readable under locks but mutations respect global and server recovery guards',async t=>{
  const f=await fixture(t),{admin,contexts}=await prepareParticipants(f);let globalLock=true;
  f.platform.registerLegacy({context:{config:{}},runtime:{operationGuard:()=>{if(globalLock)throw Object.assign(Error('fixture global lock'),{status:423});}}});
  const input={maxApplicants:6,duplicatePolicy:'reject',closeOnCapacity:false,revision:0};
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin)).status,200);
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin,input)).status,423);
  globalLock=false;await contexts[A].recovery.setEmergency({locked:true,actor:'fixture',reason:'fixture server lock'});
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin)).status,200);
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin,input)).status,423);
  assert.equal((await f.request('/w/'+B+'/intake-settings',admin,input)).status,200);
  assert.equal(Object.hasOwn(contexts[A].operations.read(),'intakeSettings'),false);
});

test('Naver publication snapshots saved intake before a delayed write and preserves unsaved legacy behavior',async t=>{
  const f=await fixture(t),{admin,contexts}=await prepareParticipants(f);
  const input={maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:false,revision:0};
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin,input)).status,200);
  let releaseWrite,enteredWrite;
  const entered=new Promise(r=>{enteredWrite=r;}),pending=new Promise(r=>{releaseWrite=r;});
  contexts[A].naver.writeArticle=async()=>{enteredWrite();await pending;return {articleId:'fixture-article',articleUrl:'https://cafe.naver.com/fixture/1'};};
  const opening=f.request('/w/'+A+'/api/naver/participation/session',admin,{cafeId:'123',menuId:'55'});
  await entered;
  try{
    assert.equal((await f.request('/w/'+A+'/intake-settings',admin,{...input,revision:1,maxApplicants:1,duplicatePolicy:'reject'})).status,200);
  }finally{releaseWrite();}
  const opened=await opening;assert.equal(opened.status,200,await opened.text());
  assert.deepEqual(contexts[A].naverParticipation.summary().session.intakePolicy,{maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:false});
  for(const displayName of ['가상 참가자',' 가상 참가자 '])
    assert.equal((await f.request('/w/'+A+'/api/naver/participation/register',admin,{displayName})).status,200);
  assert.equal(contexts[A].naverParticipation.summary().counts.queued,1);
  assert.equal((await f.request('/w/'+A+'/api/naver/participation/register',admin,{displayName:'둘째'})).status,200);
  assert.equal((await f.request('/w/'+A+'/api/naver/participation/register',admin,{displayName:'초과'})).status,409);
  contexts[B].naver.writeArticle=async()=>({articleId:'fixture-legacy'});
  assert.equal((await f.request('/w/'+B+'/api/naver/participation/session',admin,{cafeId:'123',menuId:'55'})).status,200);
  assert.equal((await f.request('/w/'+B+'/api/naver/participation/register',admin,{displayName:'기존 정책'})).status,200);
  assert.equal((await f.request('/w/'+B+'/api/naver/participation/register',admin,{displayName:' 기존 정책 '})).status,409,'a distinct request must still reject the same normalized legacy name');
});

test('authenticated participant requests cannot bypass the current Discord intake limit or impersonate another user',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  assert.equal((await f.request('/w/'+A+'/intake-settings',admin,{maxApplicants:1,duplicatePolicy:'keep_existing',closeOnCapacity:false,revision:0})).status,200);
  await contexts[A].operations.update(state=>applyAction(state,'open',{game:'lol',mode:'aram',count:1,title:'한 자리'}));
  const route='/w/'+A+'/viewer/api/participation/action';
  assert.equal((await f.request(route,participant,{action:'join',userId:owner,guildId:B})).status,200);
  assert.deepEqual(contexts[A].operations.read().session.applicants.filter(id=>!(contexts[A].operations.read().session.postponed||[]).includes(id)),[person]);
  assert.equal((await f.request(route,admin,{action:'join'})).status,409);
  assert.equal(contexts[A].participationQueue.summary().entries.filter(e=>e.status==='waiting').length,1);
  assert.equal(contexts[B].operations.read().session,null);
  const original=contexts[A].operations.update;
  try{
    const errors=[Object.assign(Error('private filesystem marker'),{status:503}),Object.assign(Error('ENOSPC C:/private-user/data.json'),{code:'ENOSPC'}),new TypeError('private implementation marker')];
    for(const [index,error] of errors.entries()){
      contexts[A].operations.update=async()=>{throw error;};
      const failed=await f.request(route,participant,{action:'leave',fixtureCase:index});
      assert.equal(failed.status,index===0?503:500);const body=await failed.text();
      assert.equal(body.includes('private'),false);assert.equal(body.includes('data.json'),false);
    }
  }finally{contexts[A].operations.update=original;}
});

test('operator readiness is scoped, read-only and excludes participant identities and OBS credentials',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  contexts[A].config.naverCafeId='123';contexts[A].config.naverMenuId='456';
  const before=JSON.stringify(contexts[A].operations.read());
  const result=await f.request('/w/'+A+'/readiness',admin);assert.equal(result.status,200);
  const data=await result.json(),serialized=JSON.stringify(data);
  assert.equal(data.evidence,'local');assert.equal(data.productionVerification,'pending');
  assert.ok(data.checks.length>0);assert.equal(typeof data.handoff.text,'string');
  for(const secret of [owner,person,A,B,contexts[A].config.broadcastToken,contexts[A].config.dashboardPassword])assert.equal(serialized.includes(secret),false);
  assert.equal(JSON.stringify(contexts[A].operations.read()),before,'reading setup guidance must not modify operating state');
  assert.equal((await f.request('/w/'+A+'/readiness',participant)).status,403);
  assert.equal((await f.request('/w/'+A+'/readiness',{})).status,401);
  assert.equal((await f.request('/w/'+A+'/readiness',admin,{})).status,404);
  assert.equal(JSON.stringify(contexts[A].operations.read()),before);
  f.deniedMembers.add(B+':'+owner);
  assert.equal((await f.request('/w/'+B+'/readiness',admin)).status,403,'another server membership must be verified');
});

test('readiness remains available during a global operating lock and reports paused without leaking the lock reason',async t=>{
  const f=await fixture(t),{admin}=await prepareParticipants(f);
  f.platform.registerLegacy({context:{config:{}},runtime:{operationGuard:()=>{throw Object.assign(Error('private creator incident details'),{status:423});}}});
  const response=await f.request('/w/'+A+'/readiness',admin);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.paused,true);assert.equal(data.productionVerification,'pending');
  assert.equal(JSON.stringify(data).includes('private creator incident details'),false);
});

test('call settings are server scoped, enforce fresh operator permission and require CSRF for writes',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  const before=JSON.stringify(contexts[A].operations.read());
  assert.deepEqual(await(await f.request('/w/'+A+'/call-settings',admin)).json(),{settings:{timeoutSeconds:60},revision:0});
  const response=await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:120,revision:0});
  const body=await response.text();assert.equal(response.status,200,body);
  assert.deepEqual(JSON.parse(body),{settings:{timeoutSeconds:120},revision:1});
  assert.equal(contexts[A].participationCalls.timeoutSeconds,120);
  assert.deepEqual(await(await f.request('/w/'+B+'/call-settings',admin)).json(),{settings:{timeoutSeconds:60},revision:0});
  assert.equal(JSON.stringify(contexts[A].operations.read()),before,'preferences must preserve current operations');
  assert.equal((await f.request('/w/'+A+'/call-settings',participant)).status,403);
  assert.equal((await f.request('/w/'+A+'/call-settings',participant,{timeoutSeconds:90,revision:1})).status,403);
  assert.equal((await f.request('/w/'+A+'/call-settings',{})).status,401);
  for(const headers of [{...admin,'X-CSRF-Token':'wrong'},{...admin,Origin:'https://untrusted.invalid'}]){
    assert.equal((await f.request('/w/'+A+'/call-settings',headers,{timeoutSeconds:90,revision:1})).status,403);
  }
  f.roles.set(owner,false);
  assert.equal((await f.request('/w/'+A+'/call-settings',admin)).status,403,'GET must not trust an earlier manager cache');
  assert.equal((await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:90,revision:1})).status,403);
  assert.equal(contexts[A].callSettings.snapshot().revision,1);
});

test('call settings reject stale simultaneous saves, malformed input and masked persistence errors',async t=>{
  const f=await fixture(t),{admin,contexts}=await prepareParticipants(f);
  const responses=await Promise.all([f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:90,revision:0}),f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:150,revision:0})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const saved=contexts[A].callSettings.snapshot();
  for(const body of [{timeoutSeconds:'90',revision:1},{timeoutSeconds:14,revision:1},{timeoutSeconds:60.1,revision:1},{timeoutSeconds:90,revision:-1},{timeoutSeconds:90,revision:1,token:'must-not-save'}]){
    assert.equal((await f.request('/w/'+A+'/call-settings',admin,body)).status,400);
  }
  const original=contexts[A].callSettings.writeUnlocked;
  contexts[A].callSettings.writeUnlocked=async()=>{throw Error('secret filesystem detail');};
  try{
    const failed=await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:180,revision:1});
    assert.equal(failed.status,503);assert.equal((await failed.text()).includes('secret filesystem detail'),false);
    assert.deepEqual(contexts[A].callSettings.snapshot(),saved);assert.equal(contexts[A].participationCalls.timeoutSeconds,saved.settings.timeoutSeconds);
  }finally{contexts[A].callSettings.writeUnlocked=original;}
  assert.equal((await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:180,revision:1})).status,200,'a corrected persistence failure must permit retry');
});

test('call settings remain readable under locks but writes reject both creator and workspace pauses',async t=>{
  const f=await fixture(t),{admin,contexts}=await prepareParticipants(f);let globalLock=true;
  f.platform.registerLegacy({context:{config:{}},runtime:{operationGuard:()=>{if(globalLock)throw Object.assign(Error('private creator lock'),{status:423});}}});
  assert.equal((await f.request('/w/'+A+'/call-settings',admin)).status,200);
  assert.equal((await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:90,revision:0})).status,423);
  globalLock=false;
  await contexts[A].recovery.setEmergency({locked:true,actor:'fixture',reason:'private workspace lock'});
  assert.equal((await f.request('/w/'+A+'/call-settings',admin)).status,200);
  assert.equal((await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:90,revision:0})).status,423);
  assert.equal((await f.request('/w/'+B+'/call-settings',admin,{timeoutSeconds:90,revision:0})).status,200);
  assert.equal(contexts[A].callSettings.snapshot().revision,0);
});

test('legacy creator workspace uses the same call settings path and public practice asset is allowlisted',async t=>{
  const f=await fixture(t),admin=await f.login(owner);
  f.client.guilds.cache.set(f.config.guildId,{});
  await f.platform.registry.ensure({guildId:f.config.guildId,userId:owner,name:'제작자 방송'});
  const legacy=await f.platform.runtimeFor(f.config.guildId);legacy.runtime.operationGuard=()=>{};
  f.platform.registerLegacy(legacy);
  const result=await f.request('/w/'+f.config.guildId+'/call-settings',admin,{timeoutSeconds:75,revision:0});
  assert.equal(result.status,200,await result.text());assert.equal(legacy.context.participationCalls.timeoutSeconds,75);
  assert.equal((await f.request('/portal/practice-model.js',{})).status,200);
  assert.equal((await f.request('/portal/app.js',{})).status,404);
});

test('workspace restart loads the committed call preference and surfaces settings backup recovery in the runtime snapshot',async t=>{
  const f=await fixture(t),{admin,contexts}=await prepareParticipants(f);
  assert.equal((await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:90,revision:0})).status,200);
  assert.equal((await f.request('/w/'+A+'/call-settings',admin,{timeoutSeconds:120,revision:1})).status,200);
  const previous=await f.platform.runtimeFor(A);await previous.close();
  await writeFile(contexts[A].callSettings.file,'{"damaged":');
  const restarted=await createWorkspaceRuntime({baseConfig:f.config,entry:f.platform.registry.find(A),root:path.join(path.dirname(f.config.operationsFile),'workspaces'),client:f.client,interactionBus:new EventEmitter()});
  const server=restarted.runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    assert.deepEqual(restarted.context.callSettings.snapshot(),{settings:{timeoutSeconds:90},revision:1});
    assert.equal(restarted.context.participationCalls.timeoutSeconds,90);assert.equal(restarted.context.callSettings.recovered,true);
    const basic=Buffer.from(restarted.context.config.dashboardUser+':'+restarted.context.config.dashboardPassword).toString('base64');
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/snapshot',{headers:{Authorization:'Basic '+basic}});
    assert.equal(response.status,200);const snapshot=await response.json();assert.equal(snapshot.recovered,true);
    assert.equal(snapshot.participationCalls.timeoutSeconds,90);
  }finally{await new Promise(r=>server.close(r));await restarted.close();}
});

test('participant views and mutations use the authenticated identity even when another user or workspace is supplied',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  const profile=await(await f.request('/w/'+A+'/viewer/api/me?userId='+owner+'&guildId='+B,participant)).json();
  assert.equal(profile.userId,person);assert.equal(profile.name,A+'-'+person);assert.equal(profile.csrf,participant['X-CSRF-Token']);
  const before=await(await f.request('/w/'+A+'/viewer/api/participation?userId='+owner,participant)).json();
  assert.deepEqual(before.reservations,[{game:'lol',round:4}]);assert.equal(JSON.stringify(before).includes(owner),false);
  const headers={...participant,'Idempotency-Key':'same-participant-action-0001'};
  const body={action:'cancel_reservation',game:'lol',userId:owner,guildId:B};
  const result=await f.request('/w/'+A+'/viewer/api/participation/action',headers,body);assert.equal(result.status,200,await result.text());
  assert.deepEqual(contexts[A].operations.read().reservations,[{userId:owner,game:'lol',round:3}]);
  assert.equal(contexts[B].operations.read().reservations.length,2,'A action must not mutate B');
  // Both portal users lack a legacy viewer cookie. Their CSRF-bound idempotency scopes
  // must still remain separate, including when a client reuses the same action key.
  const ownerResult=await f.request('/w/'+A+'/viewer/api/participation/action',{...admin,'Idempotency-Key':'same-participant-action-0001'},body);
  assert.equal(ownerResult.status,200,await ownerResult.text());assert.equal(contexts[A].operations.read().reservations.length,0);
  const other=await(await f.request('/w/'+B+'/viewer/api/me',participant)).json();assert.equal(other.name,B+'-'+person);
});

test('participant mutations require CSRF and fresh membership, and cannot use legacy login or operator routes',async t=>{
  const f=await fixture(t),{participant,contexts}=await prepareParticipants(f);
  const body={action:'cancel_reservation',game:'lol'};
  for(const headers of [{...participant,'X-CSRF-Token':'wrong'},{...participant,Origin:'https://attacker.invalid'},{...participant,'Sec-Fetch-Site':'cross-site'}]){
    assert.equal((await f.request('/w/'+A+'/viewer/api/participation/action',headers,body)).status,403);
  }
  for(const route of ['/settings','/obs','/api/snapshot','/api/participation-queue'])assert.equal((await f.request('/w/'+A+route,participant)).status,403,route);
  for(const route of ['login','demo-login','logout'])assert.equal((await f.request('/w/'+A+'/viewer/api/'+route,participant,{})).status,403,route);
  assert.equal(contexts[A].operations.read().reservations.length,2);
  assert.equal((await f.request('/w/'+A+'/viewer/api/me',participant)).status,200,'populate read membership cache');
  f.deniedMembers.add(A+':'+person);
  assert.equal((await f.request('/w/'+A+'/viewer/api/participation/action',participant,body)).status,403,'writes must recheck membership instead of trusting the cached read');
  assert.equal(contexts[A].operations.read().reservations.length,2);
  assert.equal((await f.request('/w/'+B+'/viewer/api/participation/action',participant,body)).status,200,'membership in another server remains independent');
});

test('workspace routing rejects untrusted guild membership, encoded creator routes, and another workspace OBS token',async t=>{
  const f=await fixture(t),{admin,participant}=await prepareParticipants(f);
  f.deniedMembers.add(B+':'+person);
  for(const route of ['/viewer/api/me','/viewer/api/participation','/api/snapshot'])assert.equal((await f.request('/w/'+B+route,participant)).status,403,route);
  for(const route of ['/api/%72untime','/api/release%2fapply','/api//recovery','/api/snapshot%2f..%2frecovery'])assert.equal((await f.request('/w/'+A+route,admin)).status,403,route);
  const obsA=await(await f.request('/w/'+A+'/obs',admin)).json(),obsB=await(await f.request('/w/'+B+'/obs',admin)).json();
  const tokenA=new URL(obsA.url).searchParams.get('token'),tokenB=new URL(obsB.url).searchParams.get('token');assert.notEqual(tokenA,tokenB);
  assert.equal((await f.request('/w/'+B+'/broadcast/overlay?token='+tokenA,{})).status,403);
  assert.equal((await f.request('/w/'+B+'/broadcast/overlay?token='+tokenB,{})).status,200);
  assert.equal((await f.request('/w/'+A+'/broadcast/overlay',{})).status,403);
});

test('creator workspace management requires the original dashboard administrator and preserves child CSRF boundaries',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  // Use a real app's creatorIdentity implementation. Portal identities and the
  // user-controlled headers below must never manufacture its admin role.
  await f.platform.registry.ensure({guildId:f.config.guildId,userId:owner,name:'제작자 방송'});
  const legacy=await f.platform.runtimeFor(f.config.guildId);
  legacy.context.config.dashboardOperatorUser='fixture-operator';
  legacy.context.config.dashboardOperatorPassword='fixture-operator-password';
  // Production creates the legacy app before the platform, so its guard is
  // independent. Avoid a synthetic parent-to-itself loop in this fixture.
  legacy.runtime.operationGuard=()=>{};
  let identityChecks=0;
  const creatorIdentity=legacy.runtime.creatorIdentity;
  legacy.runtime.creatorIdentity=req=>{identityChecks++;return creatorIdentity(req);};
  f.platform.registerLegacy(legacy);
  const basic=(user,password)=>({Authorization:'Basic '+Buffer.from(user+':'+password).toString('base64')});
  const creator=basic(legacy.context.config.dashboardUser,legacy.context.config.dashboardPassword);
  const delegate=basic('fixture-operator','fixture-operator-password');
  const headersToReject=[{},admin,participant,delegate,{...admin,'X-Role':'admin','X-Dashboard-Role':'admin','X-User-Id':owner}];
  for(const headers of headersToReject){
    for(const route of ['/creator/api/workspaces','/creator/workspaces/'+A+'/api/recovery','/creator/workspaces/'+A+'/api/snapshot']){
      assert.equal((await f.request(route,headers)).status,403,route);
    }
  }
  assert.equal(identityChecks,headersToReject.length*3,'every creator route must consult the original dashboard authentication');
  const list=await(await f.request('/creator/api/workspaces',creator)).json();
  assert.deepEqual(new Set(list.workspaces.map(item=>item.guildId)),new Set([A,B,f.config.guildId]));
  for(const item of list.workspaces){assert.equal(item.broadcastToken,undefined);assert.equal(item.createdBy,undefined);}
  const snapshotA=await(await f.request('/creator/workspaces/'+A+'/api/snapshot',creator)).json();
  const snapshotB=await(await f.request('/creator/workspaces/'+B+'/api/snapshot',creator)).json();
  assert.equal(snapshotA.access.role,'admin');assert.equal(snapshotB.access.role,'admin');
  assert.notEqual(snapshotA.csrf,snapshotB.csrf);
  assert.equal((await f.request('/creator/workspaces/'+A+'/api/recovery',creator)).status,200);
  const mutation='/creator/workspaces/'+B+'/api/participation-queue/register';
  for(const csrf of [admin['X-CSRF-Token'],snapshotA.csrf,'invalid']){
    assert.equal((await f.request(mutation,{...creator,'Content-Type':'application/json','X-CSRF-Token':csrf},{displayName:'차단되어야 함'})).status,403);
  }
  assert.equal(contexts[B].participationQueue.summary().entries.length,0);
  const saved=await f.request(mutation,{...creator,'Content-Type':'application/json','X-CSRF-Token':snapshotB.csrf},{displayName:'B 제작자 작업'});
  assert.equal(saved.status,200,await saved.text());
  assert.equal(contexts[B].participationQueue.summary().entries.length,1);
  assert.equal(contexts[A].participationQueue.summary().entries.length,0);
  assert.equal((await f.request('/creator/workspaces/'+A+'/settings',creator)).status,404);
  for(let i=0;i<15;i++)assert.equal((await f.request('/creator/api/workspaces',basic('bad-user','bad-password'))).status,403);
  assert.equal((await f.request('/creator/api/workspaces',basic('bad-user','bad-password'))).status,429,'creator alias must not bypass password attempt throttling');
});
