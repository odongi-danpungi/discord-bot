import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NaverMonitorStore } from '../src/naver-monitor-store.js';
import { NaverCafeMonitor } from '../src/naver-monitor.js';

async function fixture(defaults={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'naver-monitor-'));
  const store=new NaverMonitorStore(path.join(dir,'monitor.json'),defaults);await store.init();return store;
}
const article=(n,cafe='https://cafe.naver.com/target')=>({title:`글 ${n}`,description:`내용 ${n}`,link:`https://cafe.naver.com/target/${n}`,cafeName:'Target Cafe',cafeUrl:cafe});

test('Naver monitor settings validate official Cafe URL and reset baseline when target changes',async()=>{
  const store=await fixture();
  await assert.rejects(store.setSettings({enabled:true,query:'',intervalMinutes:5,discordAlerts:true}),/검색어/);
  await assert.rejects(store.setSettings({enabled:true,query:'방송',cafeUrl:'https://example.com/cafe',intervalMinutes:5,discordAlerts:true}),/cafe\.naver\.com/);
  await store.setSettings({enabled:true,query:'방송',cafeUrl:'https://cafe.naver.com/target/',intervalMinutes:5,discordAlerts:true});
  await store.bootstrap([article(1)],1000);assert.equal(store.summary().state.baselineReady,true);
  await store.setSettings({enabled:true,query:'일정',cafeUrl:'https://cafe.naver.com/target',intervalMinutes:5,discordAlerts:true});
  const summary=store.summary();assert.equal(summary.state.baselineReady,false);assert.equal(summary.seenCount,0);assert.equal(summary.settings.cafeUrl,'https://cafe.naver.com/target');
});


test('manual monitor run requires a configured search query',async()=>{
  const store=await fixture({enabled:false,query:''});const monitor=new NaverCafeMonitor({store,naver:{searchCafeArticles:async()=>({items:[]})},discord:{naverCafeAlert:async()=>({})}});
  await assert.rejects(monitor.run({force:true}),/검색어를 먼저 설정/);
});

test('first public-search poll creates a baseline and later poll alerts only new matching Cafe articles',async()=>{
  const store=await fixture({enabled:true,query:'방송',cafeUrl:'https://cafe.naver.com/target',intervalMinutes:5,discordAlerts:true});
  let calls=0;const responses=[[article(2),article(1),article(99,'https://cafe.naver.com/other')],[article(3),article(2),article(1),article(100,'https://cafe.naver.com/other')]];
  const naver={searchCafeArticles:async()=>({items:responses[Math.min(calls++,responses.length-1)]})};
  const sent=[],discord={naverCafeAlert:async event=>{sent.push(event);return {channelId:'10',id:String(sent.length)};}};
  const monitor=new NaverCafeMonitor({store,naver,discord});
  const first=await monitor.run({force:true,now:1000});assert.equal(first.bootstrapped,true);assert.equal(sent.length,0);assert.equal(store.summary().seenCount,2);
  const second=await monitor.run({force:true,now:2000});assert.equal(second.newCount,1);assert.equal(second.notified,1);assert.equal(sent[0].title,'글 3');
  const event=store.summary().events[0];assert.equal(event.status,'sent');assert.equal(event.discordChannelId,'10');
});

test('Discord alerts can be disabled while detection and deduplication continue',async()=>{
  const store=await fixture({enabled:true,query:'방송',cafeUrl:'https://cafe.naver.com/target',intervalMinutes:5,discordAlerts:false});
  let items=[article(1)];const monitor=new NaverCafeMonitor({store,naver:{searchCafeArticles:async()=>({items})},discord:{naverCafeAlert:async()=>{throw Error('must not send');}}});
  await monitor.run({force:true,now:1000});items=[article(2),article(1)];const result=await monitor.run({force:true,now:2000});assert.equal(result.newCount,1);assert.equal(result.notified,0);assert.equal(store.summary().events[0].status,'suppressed');
});

test('pending alerts from an interrupted process become uncertain and are not automatically duplicated',async()=>{
  const store=await fixture({enabled:true,query:'방송'});await store.bootstrap([article(1)],1000);const [event]=await store.detect([article(2),article(1)],2000);assert.equal(event.status,'pending');
  const recovered=await store.recoverPending();assert.equal(recovered,1);const saved=store.getEvent(event.id);assert.equal(saved.status,'uncertain');assert.match(saved.error,/자동 재전송하지 않았습니다/);
});

test('failed or uncertain alert can be retried manually',async()=>{
  const store=await fixture({enabled:true,query:'방송'});await store.bootstrap([article(1)],1000);const [event]=await store.detect([article(2),article(1)],2000);await store.markEvent(event.id,{status:'failed',error:'Discord unavailable'});
  const monitor=new NaverCafeMonitor({store,naver:{searchCafeArticles:async()=>({items:[]})},discord:{naverCafeAlert:async()=>({channelId:'20',id:'30'})}});const result=await monitor.retry(event.id);assert.equal(result.event.status,'sent');assert.equal(result.event.discordMessageId,'30');
});

test('new articles are retained as failed when Discord log channel readiness fails',async()=>{
  const store=await fixture({enabled:true,query:'방송',cafeUrl:'https://cafe.naver.com/target',intervalMinutes:5,discordAlerts:true});
  let items=[article(1)];
  const discord={naverCafeAlertReadiness:async()=>({ready:false,code:'log_channel_missing',message:'Discord 로그 채널을 찾지 못했습니다.'}),naverCafeAlert:async()=>{throw Error('must not send');}};
  const monitor=new NaverCafeMonitor({store,naver:{status:()=>({configured:true}),searchCafeArticles:async()=>({items})},discord});
  await monitor.run({force:true,now:1000});items=[article(2),article(1)];const result=await monitor.run({force:true,now:2000});
  assert.equal(result.newCount,1);assert.equal(result.failed,1);assert.equal(result.notified,0);assert.equal(store.summary().events[0].status,'failed');assert.match(store.summary().events[0].error,/로그 채널/);assert.equal(store.summary().state.lastStatus,'fail');
});

test('monitor failure audit records bounded upstream metadata and backoff state',async()=>{
  const store=await fixture({enabled:true,query:'방송',intervalMinutes:1});const audits=[];
  const error=Object.assign(Error('rate limited'),{status:429,upstreamStatus:429});
  const monitor=new NaverCafeMonitor({store,naver:{status:()=>({configured:true}),searchCafeArticles:async()=>{throw error;}},discord:{},audit:async e=>audits.push(e)});
  await assert.rejects(monitor.run({force:true,now:1000}),/rate limited/);
  const state=store.summary().state;assert.equal(state.lastStatus,'fail');assert.ok(state.nextRunAt>1000);assert.equal(audits.at(-1).action,'monitor_failure');assert.equal(audits.at(-1).details.upstreamStatus,429);
});
