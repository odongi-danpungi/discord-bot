import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { NaverParticipationStore } from '../src/naver-participation-store.js';
import { BroadcastOpsStore } from '../src/broadcast-ops-store.js';
import { ChzzkLiveStore } from '../src/chzzk-live-store.js';
import { applyAction } from '../src/operations.js';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'dd-v413-final-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}

test('v4.13 final: Naver and Discord participants converge into one durable canonical queue',async t=>{
  const root=await fixture(t);
  const naver=new NaverParticipationStore(path.join(root,'naver.json'));
  const queue=new ParticipationQueueStore(path.join(root,'queue.json'));
  await naver.init();await queue.init();

  const publication=await naver.beginPublication({cafeId:'12345',menuId:'67890'});
  await naver.completePublication(publication.id,{articleId:'42',articleUrl:'https://cafe.naver.com/example/42'});
  await naver.register({displayName:'네이버참가자'});
  await queue.syncNaver(naver.summary());
  const discord=await queue.register({source:'discord',displayName:'디스코드참가자',discordUserId:'100000000000000001',game:'lol',mode:'aram'});

  let summary=queue.summary();
  assert.equal(summary.activeCount,2);
  assert.deepEqual(summary.entries.filter(e=>['waiting','called','joined','postponed_next','postponed_next2'].includes(e.status)).map(e=>e.position),[1,2]);
  assert.ok(summary.entries.some(e=>e.source==='naver'&&e.displayName==='네이버참가자'));
  assert.ok(summary.entries.some(e=>e.source==='discord'&&e.displayName==='디스코드참가자'));

  await queue.beginCall(discord.entry.id,{token:'finaltok12345678',timeoutSeconds:60,reason:'final-integration'});
  await queue.respondCall(discord.entry.id,{token:'finaltok12345678',userId:'100000000000000001',action:'join'});
  summary=queue.summary();
  assert.equal(summary.entries.find(e=>e.id===discord.entry.id).status,'joined');
  assert.equal('callToken' in summary.entries.find(e=>e.id===discord.entry.id),false);

  const rebooted=new ParticipationQueueStore(path.join(root,'queue.json'));
  await rebooted.init();
  assert.equal(rebooted.summary().entries.find(e=>e.id===discord.entry.id).status,'joined');
});

test('v4.13 final: recruitment, attendance, balanced teams and archive remain consistent end-to-end',()=>{
  let state={session:null,history:[],reservations:[],sessionArchive:[],rounds:{},revision:0};
  const start=Date.now();
  state=applyAction(state,'open',{game:'lol',mode:'rift',count:10,title:'최종 통합 검증',description:'final'},start);
  const sessionId=state.session.id;
  const ids=Array.from({length:10},(_,i)=>`u${i+1}`);
  ids.forEach((userId,i)=>{state=applyAction(state,'join',{userId,sessionId},start+10+i);});
  state=applyAction(state,'close',{},start+100);
  state=applyAction(state,'draw',{ids},start+110);
  state=applyAction(state,'attendance',{minutes:5},start+120);
  ids.forEach((userId,i)=>{state=applyAction(state,'confirm',{userId,sessionId,attendanceVersion:state.session.attendanceVersion},start+130+i);});
  const lanes=['top','jungle','mid','adc','support'];
  const records=ids.map((discordId,i)=>({discordId,lolCurrentTier:i<5?'골드 1':'플래티넘 4',lolMainLane:lanes[i%5]}));
  state=applyAction(state,'teams',{records,strategy:'balanced',historyDepth:5},start+200);
  assert.equal(state.session.teams.length,2);
  assert.ok(state.session.teams.every(team=>team.length===5));
  assert.equal(new Set(state.session.teams.flat()).size,10);
  assert.equal(state.session.teamMeta.strategy,'balanced');
  state=applyAction(state,'end',{},start+300);
  assert.equal(state.sessionArchive.length,1);
  assert.equal(state.sessionArchive[0].noShows.length,0);
  assert.equal(state.sessionArchive[0].teams.length,2);
});

test('v4.13 final: CHZZK transition contributes to broadcast hub statistics and survives persistence',async t=>{
  const root=await fixture(t);
  const chzzk=new ChzzkLiveStore(path.join(root,'chzzk.json'),{enabled:true,channelId:'a'.repeat(32)});
  const hub=new BroadcastOpsStore(path.join(root,'broadcast-ops.json'));
  await chzzk.init();await hub.init();
  const now=Date.now();
  await chzzk.bootstrap({live:false,item:null,complete:true},now);
  const event=await chzzk.applyScan({live:true,complete:true,item:{liveId:'live-1',liveTitle:'통합 검증 방송',channelId:'a'.repeat(32),channelName:'테스트채널',concurrentUserCount:10}},now+1000);
  assert.equal(event.type,'start');
  await chzzk.markEvent(event.id,{status:'sent',discordMessageId:'msg1',discordChannelId:'chan1',notifiedAt:now+1100});
  const poll=await hub.createPoll({question:'다음 게임?',options:['칼바람','협곡']},now+1200);
  await hub.votePoll(poll.id,poll.options[0].id,'viewer-hash-1',now+1300);
  const summary=hub.summary({operationsState:{session:null,sessionArchive:[],history:[]},queueSummary:{activeCount:0,counts:{}},chzzkSummary:chzzk.summary(),now:now+1400});
  assert.equal(summary.stats.liveStarts,1);
  assert.equal(summary.activePoll.options[0].votes.length,1);
  assert.ok(summary.timeline.some(item=>item.source==='chzzk'));

  const hubReboot=new BroadcastOpsStore(path.join(root,'broadcast-ops.json'));
  await hubReboot.init();
  assert.equal(hubReboot.summary({operationsState:{session:null,sessionArchive:[],history:[]},queueSummary:{activeCount:0,counts:{}},chzzkSummary:chzzk.summary()}).activePoll.id,poll.id);
});
