import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { BroadcastOpsStore, DEFAULT_BROADCAST_RUNBOOK_STEPS } from '../src/broadcast-ops-store.js';
import { buildBroadcastPerformanceModel } from '../public/broadcast-performance-model-v416.js';
import { DASHBOARD_TABS } from '../public/dashboard-shell.js';
import { DASHBOARD_COMMAND_CATALOG, searchDashboardCommands } from '../public/dashboard-command-palette-v415.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';

async function finishRunbook(store, startAt=4000){
  let now=startAt;
  for(const step of DEFAULT_BROADCAST_RUNBOOK_STEPS){
    await store.updateRunbookStep({ id:step.id, status:'done' }, 'admin', now++);
  }
}

test('v4.16 lifecycle integrates runbook automation, closeout, archive, and performance analytics', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-v416-final-'));
  try{
    const store=new BroadcastOpsStore(path.join(dir,'broadcast-ops.json'));
    await store.init();
    const started=await store.startRunbook({title:'통합 검증 방송'},'admin',1000);
    assert.equal(started.phaseState.phase,'pre');

    const live=await store.syncRunbookPhase({operationsState:{session:{id:'s1',round:1,phase:'open'}},chzzkSummary:{state:{lastKnownLive:false},events:[]}},'system',2000);
    assert.equal(live.changed,true);
    assert.equal(live.runbook.phaseState.phase,'live');

    const post=await store.syncRunbookPhase({operationsState:{session:null,sessionArchive:[{id:'s1',endedAt:3000,game:'lol',mode:'aram',applicants:['u1','u2'],winners:['u1'],confirmed:['u1'],noShows:[]}]},chzzkSummary:{state:{lastKnownLive:false,baselineReady:true},events:[]}},'system',3500);
    assert.equal(post.changed,true);
    assert.equal(post.runbook.phaseState.phase,'post');

    await finishRunbook(store,4000);
    const closed=await store.closeRunbook({note:'다음 방송 준비'},'admin',5000);
    assert.equal(closed.runbook.status,'closed');
    assert.equal(store.normalize().runbookArchive.length,1);

    const reports=store.archiveReports({operationsState:{sessionArchive:[{id:'s1',endedAt:3000,game:'lol',mode:'aram',applicants:['u1','u2'],winners:['u1'],confirmed:['u1'],noShows:[]}]},chzzkSummary:{events:[{type:'start',detectedAt:1500},{type:'end',detectedAt:3200}]},now:6000});
    assert.equal(reports.length,1);
    assert.equal(reports[0].sessionStats.completed,1);
    assert.equal(reports[0].sessionStats.applicants,2);
    assert.deepEqual(reports[0].chzzk,{starts:1,ends:1});

    const performance=buildBroadcastPerformanceModel(reports,{range:5});
    assert.equal(performance.aggregate.broadcasts,1);
    assert.equal(performance.aggregate.applicantsPerSession,2);
    assert.equal(performance.insights[0].title,'비교 데이터가 더 필요합니다');
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});

test('final dashboard exposes every v4.16 operations surface and searchable navigation',()=>{
  for(const tab of ['preflight','runbook','broadcastarchive'])assert.ok(DASHBOARD_TABS[tab]);
  assert.ok(DASHBOARD_COMMAND_CATALOG.some(item=>item.id==='tab-preflight'));
  assert.ok(DASHBOARD_COMMAND_CATALOG.some(item=>item.id==='tab-runbook'));
  assert.ok(DASHBOARD_COMMAND_CATALOG.some(item=>item.id==='tab-broadcastarchive'));
  assert.equal(searchDashboardCommands('인수인계')[0]?.target,'runbook');
  assert.equal(searchDashboardCommands('성과 비교')[0]?.target,'broadcastarchive');
});

test('archive and preflight remain read-only while runbook mutations stay capability-scoped',()=>{
  assert.equal(dashboardCapabilityForRequest('GET','/api/broadcast-preflight'),null,'PC Preflight stays admin-only; operators receive sanitized preflight via their snapshot');
  assert.equal(dashboardCapabilityForRequest('GET','/api/broadcast-runbook'),'broadcast');
  assert.equal(dashboardCapabilityForRequest('GET','/api/broadcast-archive'),'broadcast');
  assert.equal(dashboardCapabilityForRequest('POST','/api/broadcast-archive'),null);
  assert.equal(dashboardCapabilityForRequest('POST','/api/broadcast-runbook/step'),'broadcast');
  assert.equal(dashboardCapabilityForRequest('POST','/api/broadcast-runbook/handoff'),'broadcast');
  assert.equal(dashboardCapabilityForRequest('POST','/api/broadcast-runbook/closeout'),'broadcast');
});

test('final UX refreshes Runbook on direct sidebar entry and protects replacement of active Runbooks',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/nav\.dataset\.tab==='runbook'\)runbookRefresh\(\)/);
  assert.match(app,/model\.id&&!model\.closed/);
  assert.match(app,/confirmHighRiskAction\('현재 활성 Runbook을 보관하고 새 방송 Runbook을 시작할까요\?/);
  assert.doesNotMatch(app,/if\(model\.progress\.done\|\|model\.progress\.skipped\|\|model\.handoffs\.length\)\{if\(!confirm\(/);
});

test('v4.16 final preserves Discord, CHZZK, and Naver Cafe integration routes without adding Administrator shortcuts',async()=>{
  const [server,config]=await Promise.all([
    readFile(new URL('../src/app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/config.js',import.meta.url),'utf8')
  ]);
  assert.match(server,/\/api\/naver\/participation\/session/);
  assert.match(server,/\/api\/naver\/participation\/register/);
  assert.match(server,/chzzkLiveMonitor/);
  assert.match(server,/discord\.broadcastOpsNotice/);
  assert.doesNotMatch(config,/Administrator/i);
});
