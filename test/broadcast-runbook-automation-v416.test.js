import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BroadcastOpsStore} from '../src/broadcast-ops-store.js';
import {buildBroadcastRunbookModel,normalizeRunbookForUi} from '../public/broadcast-runbook-model-v416.js';
import {sanitizeOperatorBroadcastOps} from '../src/dashboard-access.js';

const waitTick=()=>new Promise(resolve=>setTimeout(resolve,8));

test('runbook automatically follows pre -> live -> post runtime phases without duplicate transition writes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-runbook-auto-'));
  try{
    const file=path.join(dir,'ops.json'),store=new BroadcastOpsStore(file);await store.init();
    await store.startRunbook({title:'자동 단계 테스트'},'admin',1000);
    const live=await store.syncRunbookPhase({operationsState:{session:{id:'s1',round:3,phase:'open'},sessionArchive:[]},chzzkSummary:{state:{baselineReady:true,lastKnownLive:false},events:[]}},'system',2000);
    assert.equal(live.changed,true);assert.equal(live.transition.from,'pre');assert.equal(live.transition.to,'live');assert.equal(live.runbook.phaseState.phase,'live');
    const timelineAfterLive=store.runbookSummary(2001).activity.filter(item=>item.type==='runbook_phase').length;
    await waitTick();const before=await stat(file);
    const same=await store.syncRunbookPhase({operationsState:{session:{id:'s1',round:3,phase:'closed'},sessionArchive:[]},chzzkSummary:{state:{baselineReady:true,lastKnownLive:false},events:[]}},'system',2100);
    await waitTick();const after=await stat(file);
    assert.equal(same.changed,false);assert.equal(store.runbookSummary(2101).activity.filter(item=>item.type==='runbook_phase').length,timelineAfterLive);
    assert.equal(after.mtimeMs,before.mtimeMs,'unchanged phase must not rewrite broadcast-ops.json every scheduler tick');
    const post=await store.syncRunbookPhase({operationsState:{session:null,sessionArchive:[{id:'s1',endedAt:3000}]},chzzkSummary:{state:{baselineReady:true,lastKnownLive:false,lastTransitionAt:0},events:[]}},'system',3000);
    assert.equal(post.changed,true);assert.equal(post.transition.to,'post');assert.match(post.transition.reason,/회차가 종료/);
    const summary=store.runbookSummary(3100);assert.equal(summary.phaseState.phase,'post');assert.equal(summary.phaseHistory[0].phase,'post');assert.equal(summary.phaseHistory[1].phase,'live');assert.ok(summary.activity.some(item=>item.message.includes('방송 전 → 방송 중')));assert.ok(summary.activity.some(item=>item.message.includes('방송 중 → 방송 후')));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('handoff alert delivery status is persisted without exposing alert errors to delegated operators',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-runbook-alert-'));
  try{
    const store=new BroadcastOpsStore(path.join(dir,'ops.json'));await store.init();await store.startRunbook({title:'교대'},'admin',1000);
    const saved=await store.saveRunbookHandoff({to:'operator-b',note:'다음 판 Queue 확인'},'admin',2000);assert.equal(saved.handoff.alertStatus,'pending');
    await store.noteRunbookHandoffAlert(saved.handoff.id,{status:'failed',error:'Authorization: Bearer topsecret password=hunter2'},2100);
    const admin=store.runbookSummary(2200);assert.equal(admin.handoffs[0].alertStatus,'failed');assert.doesNotMatch(admin.handoffs[0].alertError,/topsecret|hunter2/);assert.match(admin.handoffs[0].alertError,/\[REDACTED\]/);
    const safe=sanitizeOperatorBroadcastOps({runbook:admin}).runbook,text=JSON.stringify(safe);assert.equal(safe.handoffs[0].alertStatus,'failed');assert.equal(Object.hasOwn(safe.handoffs[0],'alertError'),false);assert.doesNotMatch(text,/topsecret|hunter2|authorization/i);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('server-authoritative phase state and runbook activity drive desktop/mobile models',()=>{
  const raw={id:'rb_12345678',title:'방송',phaseState:{phase:'live',source:'chzzk',reason:'CHZZK 방송이 LIVE 상태로 감지되었습니다.',detectedAt:5000},phaseHistory:[{phase:'live',source:'chzzk',reason:'LIVE',at:5000}],steps:[{id:'a',phase:'pre',title:'점검',status:'done'},{id:'b',phase:'live',title:'운영',status:'pending'}],handoffs:[],activity:[{id:'t1',type:'runbook_phase',source:'chzzk',message:'Runbook 자동 단계 전환',at:5000}],secret:'drop'};
  const normalized=normalizeRunbookForUi(raw);assert.equal(normalized.phaseState.phase,'live');assert.equal(normalized.activity.length,1);assert.equal(Object.hasOwn(normalized,'secret'),false);
  const model=buildBroadcastRunbookModel({runbook:raw,session:null,chzzkLive:{state:{lastKnownLive:false}},access:{role:'operator',capabilities:['broadcast']}});assert.equal(model.activePhase,'live');assert.match(model.phaseReason,/LIVE/);assert.equal(model.activity[0].type,'runbook_phase');
});

test('v4.16 step 3 surfaces automatic phase, handoff delivery and runbook timeline without inline handlers',async()=>{
  const [server,html,app,mobileHtml,mobileJs]=await Promise.all([
    readFile(new URL('../src/app.js',import.meta.url),'utf8'),readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/app.js',import.meta.url),'utf8'),readFile(new URL('../public/mobile-control.html',import.meta.url),'utf8'),readFile(new URL('../public/mobile-control.js',import.meta.url),'utf8')
  ]);
  assert.match(server,/syncRunbookAutomation/);assert.match(server,/kind:'runbook-phase'/);assert.match(server,/kind:'runbook-handoff'/);assert.match(server,/runbook_handoff_alert_failure/);
  assert.match(html,/id="runbookPhaseSource"/);assert.match(html,/id="runbookActivity"/);assert.match(app,/model\.activity/);
  assert.match(mobileHtml,/id="mobileRunbookAutoPhase"/);assert.match(mobileHtml,/id="mobileRunbookActivity"/);assert.match(mobileJs,/model\.phaseReason/);assert.match(mobileJs,/model\.activity/);
  assert.doesNotMatch(html,/on(click|change|submit)=/i);assert.doesNotMatch(mobileHtml,/on(click|change|submit)=/i);
});
