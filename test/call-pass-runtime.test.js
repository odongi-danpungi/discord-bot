import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { RegistrationStore } from '../src/store.js';
import { OperationsStore } from '../src/operations.js';
import { RecoveryStore } from '../src/recovery-store.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';
import { DemoDiscordService } from '../src/discord-service.js';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-pass-runtime-'));
  const store=new RegistrationStore(path.join(dir,'records.json')),operations=new OperationsStore(path.join(dir,'operations.json')),recovery=new RecoveryStore(path.join(dir,'recovery.json')),queue=new ParticipationQueueStore(path.join(dir,'queue.json'));
  for(const item of [store,operations,recovery,queue])await item.init();
  for(const discordId of ['a','b','c'])await store.upsert({guildId:'guild',discordId,chzzkName:`가상${discordId}`,lolRiotId:`Fixture${discordId}#KR1`});
  await operations.update(state=>{state.session={id:'s1',game:'lol',mode:'aram',round:1,count:1,title:'가상 모집',phase:'closed',closeAt:null,applicants:['a','b','c'],postponed:[],winners:[],confirmed:[],excluded:[],teams:[],createdAt:1};state.rounds={...state.rounds,lol:1};});
  let runtime;const sent=[],release={status:'idle'},discord=new DemoDiscordService();
  discord.participationCall=async entry=>{sent.push(entry.discordUserId);return {channelId:'fixture',id:`m${sent.length}`};};
  discord.completeParticipationCall=async()=>{};
  const guard=()=>runtime?.operationGuard();queue.bindOperations(operations,{guard});await queue.syncOperations({records:store.read()});
  const calls=new ParticipationCallService({queue,discord,guard});
  runtime=createApp({config:{host:'127.0.0.1',guildId:'guild',demo:true,backupDir:path.join(dir,'backups')},store,operations,recovery,discord,participationQueue:queue,participationCalls:calls,releaseCenter:{snapshot:()=>release}});
  await calls.callNext();const raw=queue.read().entries.find(entry=>entry.status==='called');
  const write=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw Object.assign(Error('fixture disk full'),{code:'ENOSPC'});};
  try{await assert.rejects(calls.respond({entryId:raw.id,token:raw.callToken,userId:'a',action:'pass'}));}finally{queue.writeUnlocked=write;}
  const server=await new Promise(resolve=>{const s=runtime.app.listen(0,'127.0.0.1',()=>resolve(s));}),base=`http://127.0.0.1:${server.address().port}`;
  const csrf=(await (await fetch(base+'/api/snapshot')).json()).csrf;
  const post=async(url,body)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  t.after(async()=>{calls.stop();runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await calls.chain.catch(()=>{});try{for(const item of [queue,operations,recovery,store])await item.flush();}finally{await rm(dir,{recursive:true,force:true});}});
  return {runtime,calls,queue,operations,recovery,release,sent,post};
}

test('runtime blocks recovered pass calls through release restart, then resumes exactly one target after smoke clearance',async t=>{
  const f=await fixture(t);f.calls.stop();f.release.status='restart-required';
  await f.calls.start();assert.equal(f.calls.paused,true);assert.deepEqual(f.sent,['a']);
  await f.runtime.tick();assert.deepEqual(f.sent,['a']);assert.equal(f.calls.paused,true);
  f.release.status='idle';await f.runtime.tick();assert.deepEqual(f.sent,['a','b']);assert.equal(f.calls.paused,false);
  await f.runtime.tick();assert.deepEqual(f.sent,['a','b']);assert.equal(f.operations.read().reservations.length,1);
  f.runtime.beginShutdown();await f.runtime.tick();assert.equal(f.calls.paused,true);
});

test('real emergency unlock API retains pending booking until durable unlock and the next safe tick resumes once',async t=>{
  const f=await fixture(t),at=Date.now();
  await f.recovery.setEmergency({locked:true,actor:'fixture',reason:'가상 점검',at});await f.calls.pause('emergency-lock',{at});
  const prepared=await f.post('/api/guard/prepare',{action:'emergency-unlock'});assert.equal(prepared.status,200);
  const unlocked=await f.post('/api/emergency/unlock',{approvalId:prepared.data.approvalId,approvalPhrase:prepared.data.phrase});assert.equal(unlocked.status,200);
  assert.equal(f.recovery.emergencyState().locked,false);assert.deepEqual(f.sent,['a']);
  await f.runtime.tick();assert.deepEqual(f.sent,['a','b']);assert.equal(f.operations.read().reservations.length,1);
  await f.runtime.tick();assert.deepEqual(f.sent,['a','b']);
});

test('failed emergency unlock persistence keeps the lock and never sends the pending next call',async t=>{
  const f=await fixture(t),at=Date.now();await f.recovery.setEmergency({locked:true,actor:'fixture',at});await f.calls.pause('emergency-lock',{at});
  const prepared=await f.post('/api/guard/prepare',{action:'emergency-unlock'});assert.equal(prepared.status,200);
  const set=f.recovery.setEmergency;f.recovery.setEmergency=async()=>{throw Object.assign(Error('fixture'),{code:'ENOSPC'});};
  try{const result=await f.post('/api/emergency/unlock',{approvalId:prepared.data.approvalId,approvalPhrase:prepared.data.phrase});assert.equal(result.status,500);}finally{f.recovery.setEmergency=set;}
  assert.equal(f.recovery.emergencyState().locked,true);assert.equal(f.calls.paused,true);await f.runtime.tick();assert.deepEqual(f.sent,['a']);
});
