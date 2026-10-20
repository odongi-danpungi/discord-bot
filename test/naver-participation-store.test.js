import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NaverParticipationStore } from '../src/naver-participation-store.js';
import { DEFAULT_INTAKE_POLICY } from '../src/intake-policy.js';

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

test('explicit keep_existing policy preserves the original cafe position and registration identity',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:{...DEFAULT_INTAKE_POLICY,maxApplicants:1}});
  await store.completePublication(pub.id,{});
  const first=await store.register({displayName:'Original'});
  const state=store.read(),bytes=await readFile(store.file);
  assert.deepEqual(await store.register({displayName:' original '}),first);
  assert.deepEqual(store.read(),state);assert.deepEqual(await readFile(store.file),bytes);
  await assert.rejects(store.register({displayName:'New'}),error=>error.status===409&&/정원/.test(error.message));
  assert.deepEqual(store.read(),state);assert.deepEqual(await readFile(store.file),bytes);
}));

test('concurrent cafe admissions obey the queued-entry limit and cancellation releases capacity',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:{maxApplicants:2,duplicatePolicy:'reject',closeOnCapacity:false}});
  await store.completePublication(pub.id,{});
  const result=await Promise.allSettled(['One','Two','Three'].map(displayName=>store.register({displayName})));
  assert.equal(result.filter(item=>item.status==='fulfilled').length,2);
  assert.equal(result.find(item=>item.status==='rejected').reason.status,409);
  assert.deepEqual(store.read().entries.map(entry=>entry.displayName),['One','Two']);
  await store.cancel(store.read().entries[0].id);
  assert.equal((await store.register({displayName:'Three'})).order,3);
  assert.deepEqual(store.summary().counts,{queued:2,cancelled:1});
}));

test('reaching cafe capacity closes registration atomically and keeps all queue entries',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:{maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:true}});
  await store.completePublication(pub.id,{});
  const result=await Promise.allSettled(['One','Two','Three'].map(displayName=>store.register({displayName})));
  assert.equal(result.filter(item=>item.status==='fulfilled').length,2);
  assert.equal(result.find(item=>item.status==='rejected').reason.status,409);
  assert.equal(store.read().session.status,'closed');assert.equal(store.read().session.closeReason,'capacity');
  assert.equal(store.summary().registrationOpen,false);assert.equal(store.summary().counts.queued,2);
  await assert.rejects(store.cancel(store.read().entries[0].id),/마감된 접수/);
}));

test('publication snapshots its policy before network completion and restart preserves the same policy',async()=>withStore(async(store,dir)=>{
  const policy={maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:false};
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:policy});
  policy.maxApplicants=1;pub.intakePolicy.duplicatePolicy='reject';
  await store.completePublication(pub.id,{});
  assert.deepEqual(store.read().session.intakePolicy,{maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:false});
  const first=await store.register({displayName:'One'});
  const restarted=new NaverParticipationStore(path.join(dir,'naver-participation.json'));await restarted.init();
  assert.deepEqual(await restarted.register({displayName:'one'}),first);
  assert.equal((await restarted.register({displayName:'Two'})).order,2);
  await assert.rejects(restarted.register({displayName:'Three'}),error=>error.status===409);
}));

test('legacy cafe publications and sessions retain duplicate rejection without an explicit policy',async()=>withStore(async store=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55'});
  await store.update(state=>{delete state.publication.intakePolicy;});
  await store.completePublication(pub.id,{});
  await store.update(state=>{delete state.session.intakePolicy;});
  await store.register({displayName:'One'});
  await assert.rejects(store.register({displayName:'one'}),error=>error.status===409&&/이미 1번/.test(error.message));
  assert.equal((await store.register({displayName:'Two'})).order,2);
}));

test('malformed cafe policies cannot be committed to a publication or active session',async()=>withStore(async store=>{
  await assert.rejects(store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:{...DEFAULT_INTAKE_POLICY,maxApplicants:'3'}}),error=>error.status===503);
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:DEFAULT_INTAKE_POLICY});
  const pending=store.read(),pendingBytes=await readFile(store.file);
  for(const intakePolicy of [null,undefined,{...DEFAULT_INTAKE_POLICY,extra:true},{...DEFAULT_INTAKE_POLICY,maxApplicants:1001},{...DEFAULT_INTAKE_POLICY,closeOnCapacity:true}]){
    const invalid=structuredClone(pending);invalid.publication.intakePolicy=intakePolicy;
    assert.equal(store.validate(invalid),false);
    await assert.rejects(store.write(invalid),/형식/);
    await assert.rejects(store.update(state=>{state.publication.intakePolicy=intakePolicy;}),/형식/);
  }
  assert.deepEqual(store.read(),pending);assert.deepEqual(await readFile(store.file),pendingBytes);
  await store.completePublication(pub.id,{});
  const before=store.read(),bytes=await readFile(store.file);
  for(const intakePolicy of [null,undefined,{...DEFAULT_INTAKE_POLICY,extra:true},{...DEFAULT_INTAKE_POLICY,maxApplicants:-1},{...DEFAULT_INTAKE_POLICY,duplicatePolicy:'merge'}]){
    const invalid=structuredClone(before);invalid.session.intakePolicy=intakePolicy;
    assert.equal(store.validate(invalid),false);
    await assert.rejects(store.write(invalid),/형식/);
    await assert.rejects(store.update(state=>{state.session.intakePolicy=intakePolicy;}),/형식/);
  }
  assert.deepEqual(store.read(),before);assert.deepEqual(await readFile(store.file),bytes);
}));

test('malformed cafe primary policy recovers from a validated backup and retains its original limit',async()=>withStore(async(store,dir)=>{
  const pub=await store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:{maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:false}});
  await store.completePublication(pub.id,{});await store.register({displayName:'One'});
  const good=store.read();await store.write(good);
  const damaged=structuredClone(good);damaged.session.intakePolicy=null;
  await writeFile(store.file,JSON.stringify(damaged)+'\n');
  const restarted=new NaverParticipationStore(path.join(dir,'naver-participation.json'));await restarted.init();
  assert.equal(restarted.recovered,true);assert.equal(restarted.recoverySource,'backup');assert.deepEqual(restarted.read(),good);
  assert.equal((await restarted.register({displayName:'Two'})).order,2);
  await assert.rejects(restarted.register({displayName:'Three'}),error=>error.status===409&&/정원/.test(error.message));
}));

test('malformed cafe publication candidates fail closed and retain disk bytes without legacy defaults',async()=>withStore(async(store,dir)=>{
  await store.beginPublication({cafeId:'1234',menuId:'55',intakePolicy:{maxApplicants:2,duplicatePolicy:'reject',closeOnCapacity:false}});
  const damaged=store.read();damaged.publication.intakePolicy={...DEFAULT_INTAKE_POLICY,maxApplicants:'2'};
  const payload=JSON.stringify(damaged)+'\n';await writeFile(store.file,payload);await writeFile(store.file+'.bak',payload);
  const primary=await readFile(store.file),backup=await readFile(store.file+'.bak');
  const restarted=new NaverParticipationStore(path.join(dir,'naver-participation.json'));
  await assert.rejects(restarted.init(),error=>error.code==='EDATA_CORRUPT');
  assert.deepEqual(await readFile(store.file),primary);assert.deepEqual(await readFile(store.file+'.bak'),backup);
}));
