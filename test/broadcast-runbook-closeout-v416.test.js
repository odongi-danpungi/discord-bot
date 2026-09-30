import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { BroadcastOpsStore, DEFAULT_BROADCAST_RUNBOOK_STEPS } from '../src/broadcast-ops-store.js';
import { buildBroadcastRunbookModel, normalizeRunbookForUi } from '../public/broadcast-runbook-model-v416.js';
import { sanitizeOperatorBroadcastOps } from '../src/dashboard-access.js';

async function completeRunbook(store, now=2000){
  let at=now;
  for(const step of DEFAULT_BROADCAST_RUNBOOK_STEPS){
    await store.updateRunbookStep({id:step.id,status:'done'},'operator',at++);
  }
}

test('closeout requires all checklist items, archives once, and makes the runbook immutable', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-runbook-closeout-'));
  try{
    const file=path.join(dir,'broadcast-ops.json'),store=new BroadcastOpsStore(file);
    await store.init();
    await store.startRunbook({title:'금요일 방송'},'admin',1000);
    await assert.rejects(()=>store.closeRunbook({},'admin',1500),/대기 항목 12개/);
    await completeRunbook(store,2000);
    await store.saveRunbookHandoff({to:'operator-b',note:'다음 방송은 협곡부터 시작 token=topsecret'},'admin',3000);
    await store.createSchedule({title:'다음 방송',startAt:9000,game:'lol',mode:'rift'},4000);
    const first=await store.closeRunbook({note:'다음 방송은 협곡 10명 모집부터 시작 password=hunter2'},'admin',5000);
    assert.equal(first.alreadyClosed,false);
    assert.equal(first.runbook.status,'closed');
    assert.equal(first.runbook.closedAt,5000);
    assert.equal(first.closeout.nextOwner,'operator-b');
    assert.match(first.closeout.nextNote,/\[REDACTED\]/);
    assert.doesNotMatch(first.closeout.nextNote,/hunter2/);
    assert.equal(first.closeout.schedule.title,'다음 방송');
    assert.equal(store.normalize().runbookArchive.length,1);
    assert.equal(store.normalize().runbookArchive[0].id,first.runbook.id);
    const second=await store.closeRunbook({note:'ignored'},'admin',6000);
    assert.equal(second.alreadyClosed,true);
    assert.equal(store.normalize().runbookArchive.length,1);
    await assert.rejects(()=>store.updateRunbookStep({id:'preflight-review',status:'pending'},'admin',7000),/완료된 Runbook/);
    await assert.rejects(()=>store.saveRunbookHandoff({note:'late edit'},'admin',7001),/완료된 Runbook/);
    await store.startRunbook({title:'다음 방송'},'admin',8000);
    assert.equal(store.normalize().runbookArchive.length,1,'closed runbook must not be archived twice when starting the next runbook');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('closeout UI model only enables finalization for a complete POST-LIVE active runbook',()=>{
  const steps=DEFAULT_BROADCAST_RUNBOOK_STEPS.map(item=>({...item,status:'done'}));
  const active=buildBroadcastRunbookModel({runbook:{id:'rb_12345678',status:'active',phaseState:{phase:'post',detectedAt:5000},steps},access:{role:'operator',capabilities:['broadcast']}});
  assert.equal(active.complete,true);assert.equal(active.canCloseout,true);assert.equal(active.closed,false);
  const closed=buildBroadcastRunbookModel({runbook:{...active,status:'closed',closedAt:6000,closeout:{summary:'done',nextOwner:'operator-b',nextNote:'next',generatedAt:6000}},access:{role:'operator',capabilities:['broadcast']}});
  assert.equal(closed.closed,true);assert.equal(closed.canCloseout,false);assert.equal(closed.closeout.nextOwner,'operator-b');
  const live=buildBroadcastRunbookModel({runbook:{id:'rb_87654321',status:'active',phaseState:{phase:'live',detectedAt:5000},steps},access:{role:'admin'}});
  assert.equal(live.canCloseout,false);
});

test('operator closeout payload stays scoped and drops unknown secret fields',()=>{
  const safe=sanitizeOperatorBroadcastOps({runbook:{id:'rb_12345678',status:'closed',closedAt:9000,closedBy:'admin',phaseState:{phase:'post'},steps:[],handoffs:[],closeout:{summary:'마감',nextOwner:'operator',nextNote:'safe note',generatedAt:9000,schedule:{id:'sch_12345678',title:'다음 방송',startAt:10000},oauthToken:'secret'},token:'topsecret'}}).runbook;
  assert.equal(safe.status,'closed');
  assert.equal(safe.closeout.nextNote,'safe note');
  assert.equal(Object.hasOwn(safe.closeout,'oauthToken'),false);
  assert.equal(Object.hasOwn(safe,'token'),false);
});

test('desktop/mobile surfaces expose closeout controls and server blocks live/session closeout',async()=>{
  const [html,app,mobileHtml,mobileJs,server]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/mobile-control.html',import.meta.url),'utf8'),
    readFile(new URL('../public/mobile-control.js',import.meta.url),'utf8'),
    readFile(new URL('../src/app.js',import.meta.url),'utf8')
  ]);
  assert.match(html,/id="runbookCloseout"/);assert.match(html,/id="runbookCloseoutNote"/);
  assert.match(app,/\/api\/broadcast-runbook\/closeout/);assert.match(app,/markDirtyGroupClean\('runbook-closeout'\)/);
  assert.match(mobileHtml,/id="mobileRunbookCloseout"/);assert.match(mobileJs,/mobileRunbookCloseout/);
  assert.match(server,/RUNBOOK_CLOSEOUT_SESSION_ACTIVE/);assert.match(server,/RUNBOOK_CLOSEOUT_LIVE/);assert.match(server,/kind:'runbook-closeout'/);
});

test('UI normalizer preserves only closeout fields needed by clients',()=>{
  const normalized=normalizeRunbookForUi({status:'closed',closedAt:123,closedBy:'admin',closeout:{summary:'summary',nextOwner:'op',nextNote:'note',generatedAt:123,schedule:{id:'sch_x',title:'next',startAt:999},clientSecret:'drop'}});
  assert.equal(normalized.status,'closed');assert.equal(normalized.closeout.summary,'summary');assert.equal(Object.hasOwn(normalized.closeout,'clientSecret'),false);
});
