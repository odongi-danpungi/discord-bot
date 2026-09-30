import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyAction, OperationsStore } from '../src/operations.js';
function roster(count=2,n=10){const s={session:null,history:[]};applyAction(s,'open',{game:'lol',count},0);for(let i=0;i<n;i++)applyAction(s,'join',{sessionId:s.session.id,userId:String(i)},0);return s}
test('applicant-only selection, confirmations and random vacancy replacement',()=>{
 const s=roster(); const id=s.session.id;
 assert.throws(()=>applyAction(s,'draw'));
 applyAction(s,'close'); applyAction(s,'draw',{ids:['0','1']});
 assert.throws(()=>applyAction(s,'join',{sessionId:id,userId:'other'}));
 applyAction(s,'attendance',{minutes:1},100);
 assert.throws(()=>applyAction(s,'confirm',{sessionId:id,userId:'2'},101));
 applyAction(s,'confirm',{sessionId:id,userId:'0'},101);
 assert.throws(()=>applyAction(s,'replace',{},200));
 applyAction(s,'replace',{},60101);
 assert.equal(s.session.winners.length,2); assert.ok(s.session.winners.includes('0')); assert.ok(!s.session.winners.includes('1'));
 applyAction(s,'attendance',{minutes:1},60200);
 for(const userId of s.session.winners)applyAction(s,'confirm',{sessionId:id,userId},60201);
 assert.throws(()=>applyAction(s,'replace',{},130000));
 applyAction(s,'end'); assert.throws(()=>applyAction(s,'confirm',{sessionId:id,userId:'0'}));
});
test('duplicate and stale entries rejected, unique teams preserve all confirmed winners',()=>{
 const s=roster(10); const sessionId=s.session.id;
 applyAction(s,'join',{sessionId,userId:'0'});assert.equal(s.session.applicants.length,10);
 assert.throws(()=>applyAction(s,'join',{sessionId:'old',userId:'0'}));
 applyAction(s,'close');assert.throws(()=>applyAction(s,'draw',{ids:Array(10).fill('0')}));applyAction(s,'draw');
 assert.throws(()=>applyAction(s,'teams',{records:[]}));applyAction(s,'attendance',{minutes:1},0);
 for(const userId of s.session.winners)applyAction(s,'confirm',{sessionId,userId},1);
 applyAction(s,'teams',{records:s.session.winners.map((discordId,i)=>({discordId,lolMainLane:['top','jungle','mid','adc','support'][i%5],lolCurrentTier:'gold'}))});
 assert.deepEqual(s.session.teams.map(t=>t.length),[5,5]);assert.equal(new Set(s.session.teams.flat()).size,10);
});
test('serialized writes survive restart and recover after a failed operation',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'roster-'));
 try{const p=path.join(dir,'state.json');const store=new OperationsStore(p);await store.init();
 await store.update(s=>applyAction(s,'open',{game:'er',count:3}));const sessionId=store.read().session.id;
 await assert.rejects(store.update(s=>applyAction(s,'join',{sessionId:'old',userId:'0'})));
 await Promise.all(Array.from({length:20},(_,i)=>store.update(s=>applyAction(s,'join',{sessionId,userId:String(i)}))));
 const restarted=new OperationsStore(p);await restarted.init();assert.equal(restarted.read().session.applicants.length,20);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('recruit card validation, postpone exclusion and rejoin restoration',()=>{
 const s=roster(2,3),sessionId=s.session.id;
 applyAction(s,'postpone_next',{sessionId,userId:'0'});
 applyAction(s,'close');
 assert.throws(()=>applyAction(s,'draw',{ids:['0','1']}));
 applyAction(s,'draw');assert.deepEqual(new Set(s.session.winners),new Set(['1','2']));
 const r=roster(2,3),rid=r.session.id;
 applyAction(r,'postpone_next',{sessionId:rid,userId:'0'});
 applyAction(r,'join',{sessionId:rid,userId:'0'});assert.deepEqual(r.session.postponed,[]);assert.equal(r.session.applicants.length,3);
 assert.throws(()=>applyAction({session:null,history:[]},'open',{game:'lol',count:10,title:'x'.repeat(257)}));
});
test('next and later rounds carry over by game, repeated clicks do not extend reservations',()=>{
 const s=roster(1,3),sessionId=s.session.id;
 applyAction(s,'postpone_next',{sessionId,userId:'0'});
 applyAction(s,'postpone_later',{sessionId,userId:'1'});
 applyAction(s,'postpone_later',{sessionId,userId:'1'});
 assert.deepEqual(s.reservations.map(r=>r.round),[2,3]);
 applyAction(s,'end');applyAction(s,'open',{game:'er',count:1});
 assert.equal(s.reservations.length,2);assert.equal(s.session.applicants.length,0);
 applyAction(s,'end');applyAction(s,'open',{game:'lol',count:1});
 assert.equal(s.session.round,2);assert.ok(s.session.applicants.includes('0'));assert.ok(s.session.postponed.includes('1'));
 applyAction(s,'close');applyAction(s,'draw');assert.deepEqual(s.session.winners,['0']);
 applyAction(s,'end');applyAction(s,'open',{game:'lol',count:1});
 assert.equal(s.session.round,3);assert.deepEqual(s.session.applicants,['1']);assert.deepEqual(s.reservations,[]);
 applyAction(s,'close');applyAction(s,'draw');assert.deepEqual(s.session.winners,['1']);
});
test('changing delay, rejoining and leaving cancel the old reservation',()=>{
 const s=roster(1,2),sessionId=s.session.id;
 applyAction(s,'postpone_later',{sessionId,userId:'0'});applyAction(s,'postpone_next',{sessionId,userId:'0'});
 assert.equal(s.reservations.length,1);assert.equal(s.reservations[0].round,2);
 applyAction(s,'join',{sessionId,userId:'0'});assert.equal(s.reservations.length,0);
 applyAction(s,'postpone_later',{sessionId,userId:'0'});applyAction(s,'end');applyAction(s,'open',{game:'lol',count:1});
 applyAction(s,'leave',{sessionId:s.session.id,userId:'0'});assert.equal(s.reservations.length,0);
 assert.ok(!s.session.applicants.includes('0'));
});
test('future reservations survive disk reload',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'defer-'));
 try {
 const file=path.join(dir,'state.json'),store=new OperationsStore(file);await store.init();
 await store.update(s=>{applyAction(s,'open',{game:'lol',count:1});applyAction(s,'join',{sessionId:s.session.id,userId:'a'});applyAction(s,'postpone_later',{sessionId:s.session.id,userId:'a'});});
 const restored=new OperationsStore(file);await restored.init();assert.deepEqual(restored.read().reservations,[{game:'lol',userId:'a',round:3}]);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('store subscriptions fire after a committed update and can unsubscribe',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'live-store-'));
 try{
  const file=path.join(dir,'state.json'),store=new OperationsStore(file);await store.init();
  let events=0;const unsubscribe=store.subscribe(()=>events++);
  await store.update(s=>applyAction(s,'open',{game:'lol',count:1}));
  assert.equal(events,1);
  unsubscribe();
  await store.update(s=>applyAction(s,'end'));
  assert.equal(events,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('ending a session stores a bounded immutable session archive summary',()=>{
 const s=roster(2,3),sessionId=s.session.id;
 applyAction(s,'close');applyAction(s,'draw',{ids:['0','1']});applyAction(s,'attendance',{minutes:1},100);
 applyAction(s,'confirm',{sessionId,userId:'0'},101);
 applyAction(s,'end',{},500);
 assert.equal(s.session.phase,'ended');assert.equal(s.sessionArchive.length,1);
 const archived=s.sessionArchive[0];assert.equal(archived.id,sessionId);assert.equal(archived.endedAt,500);assert.deepEqual(archived.winners,['0','1']);assert.deepEqual(archived.confirmed,['0']);assert.deepEqual(archived.noShows,['1']);
 s.session.winners.push('changed');assert.deepEqual(archived.winners,['0','1']);
});
