import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChzzkLiveStore } from '../src/chzzk-live-store.js';

const CHANNEL='0123456789abcdef0123456789abcdef';
const live=(id='1')=>({liveId:id,liveTitle:`방송 ${id}`,liveThumbnailImageUrl:'https://example.com/thumb.jpg',concurrentUserCount:10,openDate:'2026-09-25 01:00:00',adult:false,tags:[],categoryType:'GAME',liveCategory:'lol',liveCategoryValue:'리그 오브 레전드',channelId:CHANNEL,channelName:'스트리머',channelImageUrl:''});
async function fixture(){const dir=await mkdtemp(path.join(os.tmpdir(),'chzzk-live-'));const store=new ChzzkLiveStore(path.join(dir,'chzzk-live.json'),{enabled:true,channelId:CHANNEL,intervalMinutes:2,discordAlerts:true,maxPages:50});await store.init();return store;}

test('first complete scan establishes a baseline without creating a start event',async()=>{
  const store=await fixture();await store.bootstrap({live:true,complete:true,item:live('1')},1000);const summary=store.summary();
  assert.equal(summary.state.baselineReady,true);assert.equal(summary.state.lastKnownLive,true);assert.equal(summary.events.length,0);assert.equal(summary.currentLive.liveId,'1');
});

test('offline to live creates one pending start event',async()=>{
  const store=await fixture();await store.bootstrap({live:false,complete:true,item:null},1000);const event=await store.applyScan({live:true,complete:true,item:live('2')},2000);
  assert.equal(event.type,'start');assert.equal(event.status,'pending');assert.equal(store.summary().state.lastKnownLive,true);assert.equal(store.summary().currentLive.liveId,'2');
});

test('live to offline creates an end event retaining the prior live snapshot',async()=>{
  const store=await fixture();await store.bootstrap({live:true,complete:true,item:live('3')},1000);const event=await store.applyScan({live:false,complete:true,item:null},2000);
  assert.equal(event.type,'end');assert.equal(event.live.liveId,'3');assert.equal(store.summary().currentLive,null);assert.equal(store.summary().state.lastKnownLive,false);
});

test('incomplete scan never changes known online state',async()=>{
  const store=await fixture();await store.bootstrap({live:true,complete:true,item:live('4')},1000);const event=await store.applyScan({live:null,complete:false,item:null},2000);
  assert.equal(event,null);const summary=store.summary();assert.equal(summary.state.lastKnownLive,true);assert.equal(summary.currentLive.liveId,'4');
});

test('pending notification is recovered as uncertain instead of being automatically duplicated',async()=>{
  const store=await fixture();await store.bootstrap({live:false,complete:true,item:null},1000);const event=await store.applyScan({live:true,complete:true,item:live('5')},2000);assert.equal(event.status,'pending');
  const recovered=await store.recoverPending();assert.equal(recovered,1);const saved=store.summary().events[0];assert.equal(saved.status,'uncertain');assert.match(saved.error,/자동 재전송하지 않았습니다/);
});
