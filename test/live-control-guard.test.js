import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLiveControlFresh, createLiveControlMutationGate, liveControlRevisionHeaders, readExpectedLiveRevisions } from '../src/live-control-guard.js';

test('live control revision headers round-trip expected operations and queue revisions',()=>{
  const headers=liveControlRevisionHeaders({operations:12,queue:34});
  assert.deepEqual(headers,{'X-Live-Operations-Revision':'12','X-Live-Queue-Revision':'34'});
  const parsed=readExpectedLiveRevisions({'x-live-operations-revision':'12','x-live-queue-revision':'34'});
  assert.deepEqual(parsed,{operations:12,queue:34});
  assert.deepEqual(assertLiveControlFresh(parsed,{operations:12,queue:34}),{ok:true,operations:12,queue:34});
});

test('live control guard rejects stale multi-device state without mutating',()=>{
  assert.throws(
    ()=>assertLiveControlFresh({operations:5,queue:7},{operations:6,queue:7}),
    error=>error?.status===409&&error?.code==='STALE_LIVE_STATE'&&error?.stale?.operations===true&&error?.actual?.operations===6
  );
  assert.throws(
    ()=>assertLiveControlFresh({operations:6,queue:6},{operations:6,queue:7}),
    error=>error?.status===409&&error?.code==='STALE_LIVE_STATE'&&error?.stale?.queue===true&&error?.actual?.queue===7
  );
});

test('live control guard is backwards compatible when revision headers are absent',()=>{
  const parsed=readExpectedLiveRevisions({});
  assert.deepEqual(parsed,{operations:null,queue:null});
  assert.equal(assertLiveControlFresh(parsed,{operations:999,queue:999}).ok,true);
});

test('malformed live revision headers fail closed',()=>{
  assert.throws(()=>readExpectedLiveRevisions({'x-live-operations-revision':'12x'}),error=>error?.status===400&&error?.code==='INVALID_LIVE_REVISION');
  assert.throws(()=>readExpectedLiveRevisions({'x-live-queue-revision':'-1'}),error=>error?.status===400&&error?.code==='INVALID_LIVE_REVISION');
});


test('live mutation gate serializes different concurrent control requests',async()=>{
  const gate=createLiveControlMutationGate(),order=[];
  const release1=await gate.enter();order.push('first');
  let secondEntered=false;
  const second=gate.enter().then(release=>{secondEntered=true;order.push('second');release();});
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(secondEntered,false);assert.equal(gate.size(),2);
  release1();await second;assert.deepEqual(order,['first','second']);assert.equal(gate.size(),0);
});
