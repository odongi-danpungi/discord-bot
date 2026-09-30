import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IncidentWorkflowStore } from '../src/incident-workflow.js';

const runtimeWarn=(at=Date.now(),count=1)=>({severity:'warn',source:'api',code:'slow_api',summary:'느린 API 반복',detail:'GET /api/test',at,lastAt:at,count});
const runtimeError=(at=Date.now())=>({severity:'error',source:'storage',code:'write_failure',summary:'저장 실패',detail:'disk error',at,lastAt:at,count:1});
const drift=(manual=0,safe=1,digest='d1')=>({status:'drift',digest,counts:{manual,safe,total:manual+safe},items:[]});
const pass={status:'pass',digest:'clean',counts:{manual:0,safe:0,total:0},items:[]};

async function withStore(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'dd-incidents-'));try{const store=await new IncidentWorkflowStore(path.join(dir,'incidents.json')).init();await fn(store);}finally{await rm(dir,{recursive:true,force:true});}}

test('runtime warnings enter the open queue and repeated warnings escalate',async()=>withStore(async store=>{
  const now=1_000_000;await store.sync({runtimeIncidents:[runtimeWarn(now,1)],now});
  let s=store.summary();assert.equal(s.counts.open,1);assert.equal(s.incidents[0].severity,'warning');
  await store.sync({runtimeIncidents:[runtimeWarn(now+1000,3)],now:now+1000});
  s=store.summary();assert.equal(s.incidents[0].severity,'critical');assert.equal(s.incidents[0].escalated,true);assert.ok(s.timeline.some(x=>x.type==='escalated'));
}));

test('runtime errors start as critical and can be acknowledged with an owner',async()=>withStore(async store=>{
  const now=2_000_000;await store.sync({runtimeIncidents:[runtimeError(now)],now});const id=store.summary().incidents[0].id;
  await store.acknowledge(id,{owner:'operator-a',note:'investigating',actor:'tester',now:now+100});
  const i=store.summary().incidents[0];assert.equal(i.status,'acknowledged');assert.equal(i.owner,'operator-a');assert.equal(i.note,'investigating');
}));

test('stale runtime incidents auto-resolve after ten minutes',async()=>withStore(async store=>{
  const now=3_000_000;await store.sync({runtimeIncidents:[runtimeWarn(now)],now});
  await store.sync({runtimeIncidents:[],now:now+10*60*1000+1});
  const i=store.summary().incidents[0];assert.equal(i.status,'resolved');assert.ok(i.resolvedAt);
}));

test('Discord policy drift is suppressed during maintenance and reevaluated when maintenance ends',async()=>withStore(async store=>{
  const now=4_000_000;await store.sync({runtimeIncidents:[],policyComparison:drift(1,0),maintenance:{active:true},now});
  let i=store.summary().incidents[0];assert.equal(i.severity,'warning');assert.equal(i.suppressed,true);
  await store.sync({runtimeIncidents:[],policyComparison:drift(1,0),maintenance:null,now:now+1000});
  i=store.summary().incidents[0];assert.equal(i.suppressed,false);assert.equal(i.severity,'critical');assert.ok(store.summary().timeline.some(x=>x.type==='unsuppressed'));
}));

test('policy pass resolves active policy drift immediately',async()=>withStore(async store=>{
  const now=5_000_000;await store.sync({runtimeIncidents:[],policyComparison:drift(0,2),now});
  await store.sync({runtimeIncidents:[],policyComparison:pass,now:now+1});
  assert.equal(store.summary().incidents[0].status,'resolved');
}));

test('manual resolution and reopen preserve the incident workflow timeline',async()=>withStore(async store=>{
  const now=6_000_000;await store.sync({runtimeIncidents:[runtimeWarn(now)],now});const id=store.summary().incidents[0].id;
  await store.resolve(id,{note:'fixed',actor:'tester',now:now+1});assert.equal(store.summary().incidents[0].status,'resolved');
  await store.reopen(id,{actor:'tester',now:now+2});assert.equal(store.summary().incidents[0].status,'open');
  const types=store.summary().timeline.map(x=>x.type);assert.ok(types.includes('resolved'));assert.ok(types.includes('reopened'));
}));


test('manual resolution does not reopen from the same historical runtime event',async()=>withStore(async store=>{
  const now=7_000_000;await store.sync({runtimeIncidents:[runtimeWarn(now)],now});const id=store.summary().incidents[0].id;
  await store.resolve(id,{note:'handled',actor:'tester',now:now+100});
  await store.sync({runtimeIncidents:[runtimeWarn(now)],now:now+200});
  assert.equal(store.summary().incidents[0].status,'resolved');
  await store.sync({runtimeIncidents:[runtimeWarn(now+300,2)],now:now+300});
  assert.equal(store.summary().incidents[0].status,'open');
}));

test('separate recent runtime buckets with the same fingerprint aggregate occurrences for escalation',async()=>withStore(async store=>{
  const now=8_000_000;
  await store.sync({runtimeIncidents:[runtimeWarn(now,1),runtimeWarn(now+61_000,1),runtimeWarn(now+122_000,1)],now:now+122_000});
  const i=store.summary().incidents[0];assert.equal(i.occurrences,3);assert.equal(i.severity,'critical');assert.equal(i.escalated,true);
}));
