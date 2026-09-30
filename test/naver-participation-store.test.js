import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NaverParticipationStore } from '../src/naver-participation-store.js';

async function withStore(fn){
  const dir=await mkdtemp(path.join(tmpdir(),'daeng-nav-part-'));
  try{
    const store=new NaverParticipationStore(path.join(dir,'naver-participation.json'));
    await store.init();
    return await fn(store,dir);
  }finally{await rm(dir,{recursive:true,force:true});}
}

test('participation order is assigned atomically in request arrival order',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55'});
  await store.completePublication(pub.id,{articleId:'100',articleUrl:'https://cafe.naver.com/test/100'});
  const first=await store.register({displayName:'첫번째'});
  const second=await store.register({displayName:'두번째'});
  const third=await store.register({displayName:'세번째'});
  assert.deepEqual([first.order,second.order,third.order],[1,2,3]);
  assert.deepEqual(store.summary().entries.map(x=>x.displayName),['첫번째','두번째','세번째']);
}));

test('cancelled slots are not reused and duplicate active names are blocked',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55'});
  await store.completePublication(pub.id,{articleId:'100',articleUrl:'https://cafe.naver.com/test/100'});
  const first=await store.register({displayName:'OD'});
  await assert.rejects(store.register({displayName:' od '}),/이미 1번/);
  await store.cancel(first.id);
  const next=await store.register({displayName:'OD'});
  assert.equal(next.order,2);
  assert.equal(store.summary().counts.queued,1);
  assert.equal(store.summary().counts.cancelled,1);
}));

test('restart turns in-flight Naver publication into uncertain instead of retrying it',async()=>withStore(async(store,dir)=>{
  await store.beginPublication({cafeId:'1234',menuId:'55'});
  await store.flush();
  const restarted=new NaverParticipationStore(path.join(dir,'naver-participation.json'));
  await restarted.init();
  assert.equal(await restarted.recoverPending(),1);
  assert.equal(restarted.summary().publication.status,'uncertain');
  await assert.rejects(restarted.beginPublication({cafeId:'1234',menuId:'55'}),/미확정/);
}));

test('reset archives current queue and clears active session',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55'});
  await store.completePublication(pub.id,{articleId:'100',articleUrl:'https://cafe.naver.com/test/100'});
  await store.register({displayName:'A'});
  const summary=await store.reset('manual');
  assert.equal(summary.session,null);
  assert.equal(summary.entries.length,0);
  assert.equal(summary.history.length,1);
  assert.equal(summary.history[0].entries[0].displayName,'A');
}));

test('close locks registration and cancellation until reset while preserving the final queue',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55'});
  await store.completePublication(pub.id,{articleId:'100',articleUrl:'https://cafe.naver.com/test/100'});
  const first=await store.register({displayName:'첫번째'});
  const closed=await store.close('dashboard');
  assert.equal(closed.session.status,'closed');
  assert.equal(closed.registrationOpen,false);
  assert.equal(closed.entries[0].id,first.id);
  await assert.rejects(store.register({displayName:'두번째'}),/마감되었습니다/);
  await assert.rejects(store.cancel(first.id),/마감된 접수/);
  const reset=await store.reset('manual');
  assert.equal(reset.session,null);
  assert.equal(reset.entries.length,0);
  assert.equal(reset.history[0].session.status,'closed');
  assert.equal(reset.history[0].entries[0].displayName,'첫번째');
}));
