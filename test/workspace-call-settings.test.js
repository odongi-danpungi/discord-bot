import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceCallSettingsStore,saveWorkspaceCallSettings,validateCallSettingsInput,resolveLegacyCallTimeout } from '../src/workspace-call-settings.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';

async function fixture(t,{timeoutSeconds=60}={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'dd-call-settings-'));
  const store=new WorkspaceCallSettingsStore(path.join(dir,'operations.json'),timeoutSeconds);await store.init();
  const queue=new ParticipationQueueStore(path.join(dir,'queue.json'));await queue.init();
  const sent=[];
  const discord={async participationCall(entry,options){sent.push({entry:structuredClone(entry),options:structuredClone(options)});return {channelId:'fixture-channel',id:'message-'+sent.length};},async completeParticipationCall(){}};
  const calls=new ParticipationCallService({queue,discord,timeoutSeconds:store.snapshot().settings.timeoutSeconds});
  t.after(async()=>{calls.stop();await calls.chain.catch(()=>{});await store.flush().catch(()=>{});await rm(dir,{recursive:true,force:true});});
  const save=(input,guard)=>saveWorkspaceCallSettings({store,calls,input,guard});
  return {dir,store,queue,calls,discord,sent,save};
}

test('call settings accept only explicit integer timeout and safe revision fields',async t=>{
  const f=await fixture(t),before=f.store.snapshot();
  for(const input of [null,[],{}, {timeoutSeconds:60},{timeoutSeconds:60,revision:0,other:'private'},
    {timeoutSeconds:'60',revision:0},{timeoutSeconds:14,revision:0},{timeoutSeconds:301,revision:0},
    {timeoutSeconds:15.1,revision:0},{timeoutSeconds:Infinity,revision:0},{timeoutSeconds:NaN,revision:0},
    {timeoutSeconds:60,revision:-1},{timeoutSeconds:60,revision:0.1},{timeoutSeconds:60,revision:'0'},
    {timeoutSeconds:60,revision:Number.MAX_SAFE_INTEGER+1}]) {
    await assert.rejects(f.save(input),e=>e.status===400);
  }
  assert.deepEqual(f.store.snapshot(),before);assert.equal(f.calls.timeoutSeconds,60);
  assert.deepEqual(validateCallSettingsInput({timeoutSeconds:15,revision:0}),{timeoutSeconds:15,revision:0});
  assert.deepEqual(await f.save({timeoutSeconds:300,revision:0}),{settings:{timeoutSeconds:300},revision:1});
});

test('saved timeout survives a new store and service and keeps the original default only on first initialization',async t=>{
  const f=await fixture(t,{timeoutSeconds:45});
  assert.equal(f.calls.timeoutSeconds,45);
  await f.save({timeoutSeconds:120,revision:0});
  const restartedStore=new WorkspaceCallSettingsStore(path.join(f.dir,'operations.json'),30);await restartedStore.init();
  const restarted=new ParticipationCallService({queue:f.queue,discord:f.discord,timeoutSeconds:restartedStore.snapshot().settings.timeoutSeconds});
  try {assert.deepEqual(restartedStore.snapshot(),{settings:{timeoutSeconds:120},revision:1});assert.equal(restarted.timeoutSeconds,120);}
  finally {restarted.stop();}
  const disk=JSON.parse(await readFile(f.store.file,'utf8'));
  assert.deepEqual(disk,{version:1,timeoutSeconds:120,revision:1});
});

test('legacy restart keeps environment precedence with the portal disabled and restores the saved timeout only with the portal enabled',async t=>{
  const f=await fixture(t,{timeoutSeconds:45});await f.save({timeoutSeconds:120,revision:0});
  const restartedStore=new WorkspaceCallSettingsStore(path.join(f.dir,'operations.json'),30);await restartedStore.init();
  for(const [enabled,expected] of [[false,30],[true,120]]){
    const config={multiWorkspaceEnabled:enabled,participationCallTimeoutSeconds:30};
    const calls=new ParticipationCallService({queue:f.queue,discord:f.discord,timeoutSeconds:resolveLegacyCallTimeout({config,callSettings:restartedStore})});
    try{assert.equal(calls.state().timeoutSeconds,expected);}finally{calls.stop();}
  }
  const config={multiWorkspaceEnabled:false,participationCallTimeoutSeconds:90};
  assert.equal(resolveLegacyCallTimeout({config,callSettings:{snapshot(){throw Error('disabled mode must not read the sidecar');}}}),90);
  assert.deepEqual(restartedStore.snapshot(),{settings:{timeoutSeconds:120},revision:1},'disabling the portal must preserve its saved preference');
});

test('legacy timeout selection fails closed for invalid environment or missing and malformed enabled preferences',()=>{
  for(const value of [14,301,60.5,'60',NaN]){
    assert.throws(()=>resolveLegacyCallTimeout({config:{multiWorkspaceEnabled:false,participationCallTimeoutSeconds:value},callSettings:null}),e=>e.status===503);
  }
  const config={multiWorkspaceEnabled:true,participationCallTimeoutSeconds:60};
  assert.throws(()=>resolveLegacyCallTimeout({config,callSettings:null}),e=>e.status===503);
  for(const snapshot of [{settings:{timeoutSeconds:10},revision:0},{settings:{timeoutSeconds:90},revision:-1},{}]){
    assert.throws(()=>resolveLegacyCallTimeout({config,callSettings:{snapshot:()=>snapshot}}),e=>e.status===503);
  }
});

test('simultaneous saves with the same revision permit one commit without lost updates',async t=>{
  const f=await fixture(t);
  const results=await Promise.allSettled([f.save({timeoutSeconds:90,revision:0}),f.save({timeoutSeconds:150,revision:0})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.deepEqual(f.store.snapshot(),{settings:{timeoutSeconds:90},revision:1});assert.equal(f.calls.timeoutSeconds,90);
  assert.deepEqual(await f.save({timeoutSeconds:150,revision:1}),{settings:{timeoutSeconds:150},revision:2});
});

test('changing timeout preserves the active call deadline and timer and applies only to the next call',async t=>{
  const f=await fixture(t),first=(await f.queue.register({source:'discord',displayName:'가상 A',discordUserId:'100'})).entry;
  const second=(await f.queue.register({source:'discord',displayName:'가상 B',discordUserId:'200'})).entry;
  await f.calls.callNext();
  const before=f.queue.read().entries.find(e=>e.id===first.id),timer=f.calls.timer;
  await f.save({timeoutSeconds:120,revision:0});
  assert.deepEqual(f.queue.read().entries.find(e=>e.id===first.id),before);assert.equal(f.calls.timer,timer);
  assert.equal(f.sent.length,1,'saving preferences must not send Discord messages');
  await f.calls.respond({entryId:first.id,token:before.callToken,userId:'100',action:'join'});
  await f.calls.callNext();
  const next=f.queue.read().entries.find(e=>e.id===second.id);
  assert.equal(next.callDeadline-next.calledAt,120000);assert.equal(f.sent[1].options.timeoutSeconds,120);
});

test('settings commit waits in the call serial chain and cannot change a call midway through delivery',async t=>{
  const f=await fixture(t);
  await f.queue.register({source:'discord',displayName:'가상 A',discordUserId:'100'});
  let release,entered;
  const inDelivery=new Promise(r=>{entered=r;}),waiting=new Promise(r=>{release=r;});
  f.discord.participationCall=async(_entry,options)=>{entered();await waiting;assert.equal(options.timeoutSeconds,60);return {channelId:'fixture',id:'fixture'};};
  const call=f.calls.callNext();await inDelivery;
  const saving=f.save({timeoutSeconds:180,revision:0});
  assert.equal(f.store.snapshot().revision,0);assert.equal(f.calls.timeoutSeconds,60);
  release();await call;await saving;
  const active=f.queue.read().entries.find(e=>e.status==='called');
  assert.equal(active.callDeadline-active.calledAt,60000);assert.equal(f.calls.timeoutSeconds,180);
});

test('restart restores a future active deadline unchanged while later calls use the saved timeout',async t=>{
  const f=await fixture(t),first=(await f.queue.register({source:'discord',displayName:'가상 A',discordUserId:'100'})).entry;
  const second=(await f.queue.register({source:'discord',displayName:'가상 B',discordUserId:'200'})).entry;
  await f.calls.callNext();const active=f.queue.read().entries.find(e=>e.id===first.id);
  await f.save({timeoutSeconds:150,revision:0});f.calls.stop();
  const restartedStore=new WorkspaceCallSettingsStore(path.join(f.dir,'operations.json'),30);await restartedStore.init();
  const restarted=new ParticipationCallService({queue:f.queue,discord:f.discord,timeoutSeconds:restartedStore.snapshot().settings.timeoutSeconds});
  try{
    const result=await restarted.start();assert.equal(result.recovered,true);
    assert.deepEqual(f.queue.read().entries.find(e=>e.id===first.id),active);assert.equal(f.sent.length,1);
    await restarted.respond({entryId:first.id,token:active.callToken,userId:'100',action:'join'});await restarted.callNext();
    const next=f.queue.read().entries.find(e=>e.id===second.id);assert.equal(next.callDeadline-next.calledAt,150000);
  }finally{restarted.stop();}
});

test('failed atomic persistence does not change saved revision or runtime timeout and a later retry succeeds',async t=>{
  const f=await fixture(t),original=f.store.writeUnlocked;
  f.store.writeUnlocked=async()=>{throw Object.assign(Error('private filesystem diagnostic'),{code:'EACCES'});};
  await assert.rejects(f.save({timeoutSeconds:180,revision:0}),e=>e.code==='EACCES');
  assert.deepEqual(f.store.snapshot(),{settings:{timeoutSeconds:60},revision:0});assert.equal(f.calls.timeoutSeconds,60);
  assert.deepEqual(JSON.parse(await readFile(f.store.file,'utf8')),{version:1,timeoutSeconds:60,revision:0});
  f.store.writeUnlocked=original;
  assert.equal((await f.save({timeoutSeconds:180,revision:0})).revision,1);assert.equal(f.calls.timeoutSeconds,180);
});

test('queued saves recheck locks and reject paused or draining services without changing state',async t=>{
  const f=await fixture(t);let release,locked=false;
  const blocker=f.calls.serial(()=>new Promise(r=>{release=r;}));
  await new Promise(r=>setImmediate(r));
  const saving=f.save({timeoutSeconds:90,revision:0},()=>{if(locked)throw Object.assign(Error('locked'),{status:423});});
  locked=true;release();await blocker;
  await assert.rejects(saving,e=>e.status===423);
  await f.calls.pause();await assert.rejects(f.save({timeoutSeconds:90,revision:0}),e=>e.status===423);
  await f.calls.resume();f.calls.stop();await assert.rejects(f.save({timeoutSeconds:90,revision:0}),e=>e.status===503);
  assert.deepEqual(f.store.snapshot(),{settings:{timeoutSeconds:60},revision:0});assert.equal(f.calls.timeoutSeconds,60);
});

test('a damaged settings primary recovers the prior committed backup instead of replacing it with environment defaults',async t=>{
  const f=await fixture(t,{timeoutSeconds:45});
  await f.save({timeoutSeconds:120,revision:0});
  await f.save({timeoutSeconds:150,revision:1});
  await writeFile(f.store.file,'{"broken":');
  const recovered=new WorkspaceCallSettingsStore(path.join(f.dir,'operations.json'),30);await recovered.init();
  assert.equal(recovered.recovered,true);assert.equal(recovered.recoverySource,'backup');
  assert.deepEqual(recovered.snapshot(),{settings:{timeoutSeconds:120},revision:1});
});
