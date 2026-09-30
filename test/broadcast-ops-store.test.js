import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BroadcastOpsStore,DEFAULT_GAME_PRESETS} from '../src/broadcast-ops-store.js';

test('broadcast ops store provides built-in presets and persists custom preset',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-broadcast-ops-'));
  try{
    const file=path.join(dir,'ops.json'),store=new BroadcastOpsStore(file);await store.init();
    assert.equal(store.summary().gamePresets.length,DEFAULT_GAME_PRESETS.length);
    const saved=await store.savePreset({name:'5인 칼바람',game:'lol',mode:'aram',count:5,title:'칼바람 5인',description:'테스트',closeMinutes:3});
    assert.equal(saved.name,'5인 칼바람');
    await store.flush();
    const reloaded=new BroadcastOpsStore(file);await reloaded.init();
    assert.ok(reloaded.summary().gamePresets.some(p=>p.name==='5인 칼바람'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('schedule reminder claims once and poll voting is one-vote-per-voter',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-broadcast-ops-'));
  try{
    const store=new BroadcastOpsStore(path.join(dir,'ops.json'));await store.init();
    const now=Date.now(),schedule=await store.createSchedule({title:'오늘 방송',startAt:now-1000,game:'lol',mode:'aram'},now-2000);
    const first=await store.markDueSchedules(now);assert.equal(first.length,1);assert.equal(first[0].id,schedule.id);
    const second=await store.markDueSchedules(now+1000);assert.equal(second.length,0);
    const poll=await store.createPoll({question:'다음 게임?',options:['칼바람','협곡','이터널 리턴']},now);
    await store.votePoll(poll.id,'opt_1','viewer-a');
    const changed=await store.votePoll(poll.id,'opt_2','viewer-a');
    assert.equal(changed.options.find(o=>o.id==='opt_1').votes.length,0);
    assert.equal(changed.options.find(o=>o.id==='opt_2').votes.length,1);
    await store.votePoll(poll.id,'opt_2','viewer-b');
    const summary=store.summary();assert.equal(summary.activePoll.options.find(o=>o.id==='opt_2').votes.length,2);
    await store.closePoll(poll.id,now+2000);assert.equal(store.summary().activePoll,null);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('broadcast stats and unified timeline combine operations and chzzk events',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-broadcast-ops-'));
  try{
    const store=new BroadcastOpsStore(path.join(dir,'ops.json'));await store.init();
    await store.addTimeline({type:'schedule',source:'dashboard',message:'방송 일정 등록',at:300});
    const summary=store.summary({operationsState:{sessionArchive:[{applicants:['a','b'],winners:['a'],noShows:['b']}],history:[{at:200,action:'draw',round:1}]},queueSummary:{activeCount:2,counts:{joined:1,no_show:1}},chzzkSummary:{events:[{id:'x',type:'start',detectedAt:100,live:{liveTitle:'테스트 방송'}}]}});
    assert.equal(summary.stats.completedSessions,1);assert.equal(summary.stats.totalApplicants,2);assert.equal(summary.stats.totalWinners,1);assert.equal(summary.stats.liveStarts,1);
    assert.equal(summary.timeline[0].message,'방송 일정 등록');
    assert.ok(summary.timeline.some(item=>item.message.includes('운영 작업')));
    assert.ok(summary.timeline.some(item=>item.message.includes('치지직 방송 시작')));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('broadcast runbook persists checklist progress, handoff actor, and archives previous runbook',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-broadcast-runbook-'));
  try{
    const file=path.join(dir,'ops.json'),store=new BroadcastOpsStore(file);await store.init();
    const first=await store.startRunbook({title:'금요일 방송'},'admin-a',1000);
    assert.equal(first.currentOwner,'admin-a');
    const done=await store.updateRunbookStep({id:'preflight-review',status:'done'},'operator-b',2000);
    assert.equal(done.steps.find(item=>item.id==='preflight-review').updatedBy,'operator-b');
    const handoff=await store.saveRunbookHandoff({to:'operator-c',note:'2판 마감 직전'},'operator-b',3000);
    assert.equal(handoff.handoff.from,'operator-b');assert.equal(handoff.handoff.to,'operator-c');
    assert.equal(handoff.runbook.currentOwner,'operator-c');
    await store.flush();
    const reloaded=new BroadcastOpsStore(file);await reloaded.init();
    const summary=reloaded.runbookSummary(4000);
    assert.equal(summary.progress.done,1);assert.equal(summary.handoffs[0].note,'2판 마감 직전');
    await reloaded.startRunbook({title:'다음 방송'},'admin-a',5000);
    assert.equal(reloaded.normalize().runbookArchive.length,1);
    assert.equal(reloaded.normalize().runbookArchive[0].title,'금요일 방송');
    const publicSummary=reloaded.summary();
    assert.equal(publicSummary.runbook.archiveCount,1);
    assert.equal(Object.hasOwn(publicSummary,'runbookArchive'),false);
    assert.ok(publicSummary.timeline.some(item=>item.type==='runbook'&&item.message.includes('새 방송 Runbook 시작')));
  }finally{await rm(dir,{recursive:true,force:true});}
});
