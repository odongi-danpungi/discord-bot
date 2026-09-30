import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChzzkLiveStore } from '../src/chzzk-live-store.js';
import { ChzzkLiveMonitor } from '../src/chzzk-live-monitor.js';

const CHANNEL='0123456789abcdef0123456789abcdef';
const live=(id='1')=>({liveId:id,liveTitle:`방송 ${id}`,liveThumbnailImageUrl:'https://example.com/thumb.jpg',concurrentUserCount:12,openDate:'2026-09-25 01:00:00',adult:false,tags:[],categoryType:'GAME',liveCategory:'lol',liveCategoryValue:'리그 오브 레전드',channelId:CHANNEL,channelName:'스트리머',channelImageUrl:''});
async function store(){const dir=await mkdtemp(path.join(os.tmpdir(),'chzzk-monitor-'));const s=new ChzzkLiveStore(path.join(dir,'live.json'),{enabled:true,channelId:CHANNEL,intervalMinutes:1,discordAlerts:true,maxPages:5});await s.init();return s;}
const channelService=scans=>{let i=0;return {configured:()=>true,status:()=>({configured:true}),getChannel:async()=>({channel:{channelId:CHANNEL,channelName:'스트리머'}}),scanLiveChannel:async()=>scans[Math.min(i++,scans.length-1)]};};

test('baseline validates the configured channel and sends no Discord alert',async()=>{
  const s=await store(),sent=[],audits=[];const monitor=new ChzzkLiveMonitor({store:s,chzzk:channelService([{live:true,complete:true,item:live('1'),pagesScanned:1,totalScanned:1}]),discord:{chzzkLiveAlert:async e=>sent.push(e)},audit:async e=>audits.push(e)});
  const result=await monitor.run({force:true,now:1000});assert.equal(result.event,null);assert.equal(sent.length,0);assert.equal(s.summary().state.baselineReady,true);assert.equal(audits[0].action,'chzzk_live_baseline');
});

test('invalid configured channel fails before creating a baseline',async()=>{
  const s=await store();const monitor=new ChzzkLiveMonitor({store:s,chzzk:{configured:()=>true,status:()=>({configured:true}),getChannel:async()=>({channel:null}),scanLiveChannel:async()=>{throw Error('must not scan');}},discord:{}});
  await assert.rejects(monitor.run({force:true,now:1000}),error=>error.code==='CHZZK_CHANNEL_NOT_FOUND'&&error.status===400);assert.equal(s.summary().state.baselineReady,false);assert.equal(s.summary().state.lastStatus,'fail');
});

test('offline to live transition sends exactly one Discord alert',async()=>{
  const s=await store(),sent=[];const service=channelService([{live:false,complete:true,item:null,pagesScanned:1,totalScanned:10},{live:true,complete:true,item:live('2'),pagesScanned:1,totalScanned:5}]);const discord={chzzkLiveAlertReadiness:async()=>({ready:true}),chzzkLiveAlert:async event=>{sent.push(event);return {id:'m1',channelId:'c1'};}};const monitor=new ChzzkLiveMonitor({store:s,chzzk:service,discord});
  await monitor.run({force:true,now:1000});const second=await monitor.run({force:true,now:2000});assert.equal(second.event.type,'start');assert.equal(sent.length,1);assert.equal(s.summary().events[0].status,'sent');assert.equal(s.summary().events[0].discordMessageId,'m1');
});

test('truncated official live scan never emits a false end event',async()=>{
  const s=await store();await s.bootstrap({live:true,complete:true,item:live('3')},1000);let sent=0;const monitor=new ChzzkLiveMonitor({store:s,chzzk:channelService([{live:null,complete:false,truncated:true,item:null,pagesScanned:5,totalScanned:100}]),discord:{chzzkLiveAlertReadiness:async()=>({ready:true}),chzzkLiveAlert:async()=>{sent++;}}});
  const result=await monitor.run({force:true,now:2000});assert.equal(result.unknown,true);assert.equal(sent,0);const summary=s.summary();assert.equal(summary.state.lastKnownLive,true);assert.equal(summary.currentLive.liveId,'3');assert.equal(summary.state.lastStatus,'warn');
});

test('Discord readiness failure preserves the transition as failed for operators',async()=>{
  const s=await store();await s.bootstrap({live:false,complete:true,item:null},1000);const monitor=new ChzzkLiveMonitor({store:s,chzzk:channelService([{live:true,complete:true,item:live('4'),pagesScanned:1,totalScanned:1}]),discord:{chzzkLiveAlertReadiness:async()=>({ready:false,message:'방송 안내 채널 권한 없음'}),chzzkLiveAlert:async()=>{throw Error('must not send');}}});
  const result=await monitor.run({force:true,now:2000});assert.equal(result.event.type,'start');const event=s.summary().events[0];assert.equal(event.status,'failed');assert.match(event.error,/권한 없음/);
});
