import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDiscordPolicy, createDiscordPolicyBaseline, normalizeDiscordPolicySnapshot } from '../src/discord-policy.js';

function snapshot(extra={}){
  const base={
    guild:{id:'g1',name:'테스트 서버'},
    category:{exists:true,id:'cat1',name:'🎮 시참',expectedName:'🎮 시참'},
    channels:{
      registration:{exists:true,id:'c1',name:'🎟️・시참',expectedName:'🎟️・시참',parentId:'cat1',topic:'시청자 참여 게임 모집과 참가 안내 채널입니다.',parentSynced:true,permissions:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks'],required:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks']},
      teams:{exists:true,id:'c2',name:'⚔️・내전',expectedName:'⚔️・내전',parentId:'cat1',topic:'시청자 내전 모집과 팀 안내 채널입니다.',parentSynced:true,permissions:['ViewChannel','SendMessages','ReadMessageHistory'],required:['ViewChannel','SendMessages','ReadMessageHistory']},
      log:{exists:true,id:'c3',name:'📜・로그',expectedName:'📜・로그',parentId:'cat1',topic:'시참 및 내전 진행 로그 채널입니다.',parentSynced:true,permissions:['ViewChannel','SendMessages'],required:['ViewChannel','SendMessages']}
    },
    commands:[
      {id:'cmd1',name:'연동',description:'내 치지직·게임 정보를 등록하거나 수정합니다',defaultMemberPermissions:null},
      {id:'cmd2',name:'setting',description:'카테고리·채널과 연동 패널을 자동 설정합니다',defaultMemberPermissions:'32'}
    ],
    bot:{basePermissions:['ManageChannels','ManageNicknames'],highestRoleId:'role1',highestRoleName:'댕댕봇'},
    intents:['Guilds'],applicationFlags:[],install:{scopes:['bot','applications.commands'],permissions:['ManageChannels','ManageNicknames'],guildInstallConfigured:true},adminRole:{id:'',exists:true,name:''}
  };
  return {...base,...extra};
}

test('normalized Discord policy snapshots are deterministic',()=>{
  const a=normalizeDiscordPolicySnapshot(snapshot()),b=normalizeDiscordPolicySnapshot(snapshot({intents:['Guilds','Guilds']}));
  assert.deepEqual(a,b);
});

test('matching baseline produces no drift',()=>{
  const current=snapshot(),baseline=createDiscordPolicyBaseline(current,{actor:'admin',capturedAt:1000}),result=compareDiscordPolicy(baseline,current,[]);
  assert.equal(result.status,'pass');assert.equal(result.counts.total,0);assert.deepEqual(result.safeActions,[]);
});

test('missing project channel and command drift map only to bounded SAFE actions',()=>{
  const before=snapshot(),baseline=createDiscordPolicyBaseline(before,{capturedAt:1000}),after=structuredClone(before);
  after.channels.log={...after.channels.log,exists:false,id:null,name:null};
  after.commands=after.commands.filter(command=>command.name!=='연동');
  const result=compareDiscordPolicy(baseline,after,[]);
  assert.equal(result.status,'drift');assert.deepEqual(result.safeActions,['ensure-core-channels','sync-guild-commands']);
  assert.equal(result.counts.safe,2);
});

test('channel move, overwrite change, and bot role change stay manual',()=>{
  const before=snapshot(),baseline=createDiscordPolicyBaseline(before,{capturedAt:1000}),after=structuredClone(before);
  after.channels.registration.parentId='other';after.channels.registration.permissions=['ViewChannel'];after.bot.basePermissions=['ManageChannels'];
  const result=compareDiscordPolicy(baseline,after,[]);
  assert.equal(result.status,'drift');assert.equal(result.safeActions.length,0);
  assert.ok(result.items.some(item=>item.id==='channel-parent-registration'&&item.kind==='manual'));
  assert.ok(result.items.some(item=>item.id==='channel-permission-registration'&&item.kind==='manual'));
  assert.ok(result.items.some(item=>item.id==='bot-permissions'&&item.kind==='manual'));
});

test('recent Discord audit entry is attributed to matching drift target',()=>{
  const before=snapshot(),baseline=createDiscordPolicyBaseline(before,{capturedAt:1000}),after=structuredClone(before);after.channels.registration.name='renamed';
  const result=compareDiscordPolicy(baseline,after,[{targetId:'c1',actorName:'관리자A',actionLabel:'채널 설정 변경',at:2000}]);
  const item=result.items.find(entry=>entry.id==='channel-name-registration');
  assert.equal(item.actor.name,'관리자A');assert.equal(item.actor.action,'채널 설정 변경');
});

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiscordPolicyStore } from '../src/discord-policy.js';

test('policy store persists baseline and deduplicates unchanged comparisons',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-policy-'));
  try{
    const store=await new DiscordPolicyStore(path.join(dir,'discord-policy.json')).init();
    const current=snapshot(),baseline=await store.setBaseline(current,{actor:'tester'});
    assert.equal(store.read().baseline.digest,baseline.digest);
    const changed=structuredClone(current);changed.channels.log.topic='changed';
    const comparison=compareDiscordPolicy(baseline,changed,[]);
    assert.equal(await store.observe(comparison),true);
    assert.equal(await store.observe(comparison),false);
    assert.equal(store.read().journal.filter(entry=>entry.type==='drift-change').length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('baseline captured without project commands does not create false command drift when still absent',()=>{
  const before=snapshot();before.commands=[];const baseline=createDiscordPolicyBaseline(before,{capturedAt:1000});
  const result=compareDiscordPolicy(baseline,before,[]);
  assert.equal(result.status,'pass');assert.equal(result.counts.total,0);
});

test('new project command after a baseline that had none is manual drift, not a destructive safe action',()=>{
  const before=snapshot();before.commands=[];const baseline=createDiscordPolicyBaseline(before,{capturedAt:1000}),after=snapshot();
  const result=compareDiscordPolicy(baseline,after,[]);
  assert.equal(result.status,'drift');assert.equal(result.safeActions.length,0);
  assert.ok(result.items.some(item=>item.id==='command-연동-added'&&item.kind==='manual'));
});

test('policy store labels first drift as detected, deduplicates it, then records clear',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-policy-journal-'));
  try{
    const store=await new DiscordPolicyStore(path.join(dir,'discord-policy.json')).init(),current=snapshot(),baseline=await store.setBaseline(current,{actor:'tester'});
    const changed=structuredClone(current);changed.channels.log.topic='changed';const drift=compareDiscordPolicy(baseline,changed,[]);
    assert.equal(await store.observe(drift),true);assert.match(store.read().journal[0].summary,/drift 감지/);
    assert.equal(await store.observe(drift),false);assert.equal(store.read().journal.filter(entry=>entry.type==='drift-change').length,1);
    const cleared=compareDiscordPolicy(baseline,current,[]);assert.equal(await store.observe(cleared),true);assert.equal(store.read().journal[0].type,'drift-cleared');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('policy monitor settings normalize and monitor run state persists without changing policy baseline',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-policy-monitor-'));
  try{
    const store=await new DiscordPolicyStore(path.join(dir,'discord-policy.json')).init(),current=snapshot(),baseline=await store.setBaseline(current,{actor:'tester'});
    await store.setMonitorSettings({enabled:true,intervalMinutes:15,discordAlerts:true});
    const comparison=compareDiscordPolicy(baseline,current,[]),now=1234567890;await store.noteMonitorRun({comparison,alerted:{status:'pass',digest:comparison.digest},now});
    const summary=store.summary();assert.equal(summary.monitor.intervalMinutes,15);assert.equal(summary.monitor.discordAlerts,true);assert.equal(summary.monitorState.lastStatus,'pass');assert.equal(summary.monitorState.lastRunAt,now);assert.equal(summary.monitorState.nextRunAt,now+15*60*1000);assert.equal(summary.baseline.digest,baseline.digest);
  }finally{await rm(dir,{recursive:true,force:true});}
});
