import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { OperationsStore,applyAction } from '../src/operations.js';
import { reconcileOperationsState } from '../src/operations-consistency.js';

const baseSession=()=>({id:'s1',round:2,game:'lol',mode:'rift',title:'test',description:'test',count:2,phase:'open',applicants:['a','b'],postponed:[],winners:[],confirmed:[],excluded:[],teams:[],createdAt:1,closeAt:null});

test('reconciliation restores reservation/session links and keeps latest duplicate reservation',()=>{
  const state={session:baseSession(),history:[],reservations:[
    {game:'lol',userId:'a',round:3},
    {game:'lol',userId:'a',round:4},
    {game:'lol',userId:'future',round:4},
    {game:'lol',userId:'due',round:2}
  ],sessionArchive:[],rounds:{lol:1},revision:7};
  state.session.postponed=['missing-booking'];
  const result=reconcileOperationsState(state),next=result.state;
  assert.equal(result.changed,true);
  assert.deepEqual(next.reservations.find(r=>r.userId==='a'),{game:'lol',userId:'a',round:4});
  assert.ok(next.session.applicants.includes('future'));assert.ok(next.session.postponed.includes('future'));
  assert.ok(next.session.applicants.includes('due'));assert.ok(!next.session.postponed.includes('due'));assert.ok(!next.reservations.some(r=>r.userId==='due'));
  assert.deepEqual(next.reservations.find(r=>r.userId==='missing-booking'),{game:'lol',userId:'missing-booking',round:3});
  assert.ok(next.session.applicants.includes('missing-booking'));assert.equal(next.rounds.lol,2);
});

test('OperationsStore repairs deterministic drift once and persists the repaired state',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ops-consistency-'));
  try{
    const file=path.join(dir,'operations.json'),session=baseSession();session.applicants=['a','a'];session.postponed=['future'];
    const raw={session,history:[],reservations:[{game:'lol',userId:'future',round:3},{game:'lol',userId:'future',round:4}],sessionArchive:[],rounds:{lol:1},revision:3};
    await writeFile(file,JSON.stringify(raw));
    const store=new OperationsStore(file);await store.init();const fixed=store.read();
    assert.equal(store.consistencyRecovered,true);assert.deepEqual(fixed.session.applicants,['a','future']);assert.deepEqual(fixed.session.postponed,['future']);
    assert.deepEqual(fixed.reservations,[{game:'lol',userId:'future',round:4}]);assert.equal(fixed.rounds.lol,2);
    const restarted=new OperationsStore(file);await restarted.init();assert.equal(restarted.consistencyRecovered,false);assert.deepEqual(restarted.read(),fixed);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('ambiguous committed draw corruption fails closed without rewriting the source file',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ops-consistency-fail-'));
  try{
    const file=path.join(dir,'operations.json'),session=baseSession();session.phase='drawn';session.winners=['ghost','a'];
    const raw={session,history:[],reservations:[],sessionArchive:[],rounds:{lol:2},revision:3},before=JSON.stringify(raw,null,2)+'\n';await writeFile(file,before);
    const store=new OperationsStore(file);await assert.rejects(store.init(),/당첨자가 applicants/);assert.equal(await readFile(file,'utf8'),before);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('invalid derived teams are discarded while committed winner/confirmation state is preserved',()=>{
  const session=baseSession();session.phase='drawn';session.winners=['a','b'];session.confirmed=['a','b'];session.teams=[['a','a'],['b']];
  const result=reconcileOperationsState({session,history:[],reservations:[],sessionArchive:[],rounds:{lol:2},revision:1});
  assert.deepEqual(result.state.session.winners,['a','b']);assert.deepEqual(result.state.session.confirmed,['a','b']);assert.deepEqual(result.state.session.teams,[]);
});

test('replacement removes the expired attendance deadline and duplicate team records are rejected',()=>{
  const state={session:null,history:[]};applyAction(state,'open',{game:'lol',count:2},0);const sid=state.session.id;
  for(const userId of ['a','b','c'])applyAction(state,'join',{sessionId:sid,userId},0);
  applyAction(state,'close',{},0);applyAction(state,'draw',{ids:['a','b']},0);applyAction(state,'attendance',{minutes:1},0);applyAction(state,'confirm',{sessionId:sid,userId:'a'},1);
  applyAction(state,'replace',{},60001);assert.equal(state.session.phase,'drawn');assert.equal(state.session.deadline,null);assert.equal(state.session.deadlineSynced,false);
  applyAction(state,'attendance',{minutes:1},60002);for(const userId of state.session.winners)applyAction(state,'confirm',{sessionId:sid,userId},60003);
  const duplicate=state.session.winners.map(()=>({discordId:state.session.winners[0],lolCurrentTier:'gold',lolMainLane:'top'}));
  assert.throws(()=>applyAction(state,'teams',{records:duplicate}),/게임 정보를 확인/);
});
