import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';

async function withStore(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'dd-queue-'));try{const store=new ParticipationQueueStore(path.join(dir,'queue.json'));await store.init();await fn(store,dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('canonical queue serializes concurrent registrations and prevents duplicates',async()=>withStore(async store=>{
  const [a,b,c]=await Promise.all([
    store.register({source:'dashboard',displayName:'첫째'}),
    store.register({source:'dashboard',displayName:'둘째'}),
    store.register({source:'dashboard',displayName:'셋째'})
  ]);
  const summary=store.summary();
  assert.equal(summary.entries.length,3);
  assert.deepEqual(summary.entries.map(entry=>entry.sequence),[1,2,3]);
  assert.deepEqual(summary.entries.map(entry=>entry.position),[1,2,3]);
  assert.equal(new Set([a.entry.id,b.entry.id,c.entry.id]).size,3);
  const duplicate=await store.register({source:'dashboard',displayName:'첫째'});
  assert.equal(duplicate.duplicate,true);
  assert.equal(store.summary().entries.length,3);
}));

test('queue supports reorder, postpone, cancel and resume while preserving sequence',async()=>withStore(async store=>{
  const a=(await store.register({source:'dashboard',displayName:'A'})).entry;
  const b=(await store.register({source:'dashboard',displayName:'B'})).entry;
  const c=(await store.register({source:'dashboard',displayName:'C'})).entry;
  await store.reorder(c.id,1);
  assert.deepEqual(store.summary().entries.filter(e=>!['cancelled','no_show'].includes(e.status)).map(e=>e.displayName),['C','A','B']);
  await store.setStatus(a.id,'postponed_next');
  assert.equal(store.summary().entries.find(e=>e.id===a.id).status,'postponed_next');
  await store.setStatus(b.id,'cancelled');
  assert.equal(store.summary().activeCount,2);
  await store.setStatus(b.id,'waiting');
  const resumed=store.summary().entries.find(e=>e.id===b.id);
  assert.equal(resumed.status,'waiting');
  assert.equal(resumed.sequence,b.sequence);
  assert.equal(resumed.position,3);
}));

test('operations compatibility mirrors discord applicants, reservations and confirmed state',async()=>withStore(async store=>{
  const operations={session:{id:'s1',phase:'open',game:'lol',mode:'aram',round:4,applicants:['10','20'],postponed:['20'],confirmed:[],winners:[]},reservations:[{game:'lol',userId:'20',round:6}]};
  const records=[{discordId:'10',chzzkName:'강아지A'},{discordId:'20',chzzkName:'강아지B'}];
  await store.syncOperations({operationsState:operations,records});
  let summary=store.summary();
  assert.equal(summary.entries.find(e=>e.discordUserId==='10').status,'waiting');
  assert.equal(summary.entries.find(e=>e.discordUserId==='20').status,'postponed_next2');
  operations.session.confirmed=['10'];operations.session.winners=['10'];
  await store.syncOperations({operationsState:operations,records});
  summary=store.summary();assert.equal(summary.entries.find(e=>e.discordUserId==='10').status,'joined');
  operations.session.applicants=['20'];
  await store.syncOperations({operationsState:operations,records});
  assert.equal(store.summary().entries.find(e=>e.discordUserId==='10').status,'cancelled');
}));

test('naver compatibility stores hashed identity rather than raw account identifiers',async()=>withStore(async store=>{
  await store.syncNaver({entries:[{displayName:'네이버참가자',status:'queued'}]});
  let entry=store.summary().entries[0];
  assert.equal(entry.source,'naver');assert.match(entry.naverKey,/^[a-f0-9]{64}$/);assert.equal(entry.identityKey,`naver:${entry.naverKey}`);
  await store.syncNaver({entries:[{displayName:'네이버참가자',status:'cancelled'}]});
  entry=store.summary().entries[0];assert.equal(entry.status,'cancelled');
}));

test('queue order and status survive a store restart',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-queue-restart-'));
  try{
    const file=path.join(dir,'queue.json'),first=new ParticipationQueueStore(file);await first.init();
    const a=(await first.register({source:'dashboard',displayName:'재시작A'})).entry;const b=(await first.register({source:'dashboard',displayName:'재시작B'})).entry;
    await first.reorder(b.id,1);await first.setStatus(a.id,'postponed_next2');await first.flush();
    const restarted=new ParticipationQueueStore(file);await restarted.init();const summary=restarted.summary();
    assert.equal(summary.entries.find(e=>e.id===a.id).status,'postponed_next2');
    assert.deepEqual(summary.entries.filter(e=>!['cancelled','no_show'].includes(e.status)).map(e=>e.displayName),['재시작B','재시작A']);
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('call metadata persists internally while public summaries hide response tokens',async()=>withStore(async store=>{
  const entry=(await store.register({source:'discord',displayName:'호출대상',discordUserId:'123'})).entry;
  const started=await store.beginCall(entry.id,{token:'secret-token',timeoutSeconds:30,reason:'test'});
  assert.equal(started.entry.status,'called');assert.equal('callToken' in started.entry,false);
  await store.attachCallMessage(entry.id,{token:'secret-token',messageRef:{channelId:'c1',id:'m1'}});
  const summary=store.summary();assert.equal(summary.currentCall.id,entry.id);assert.equal('callToken' in summary.currentCall,false);
  const raw=store.read().entries.find(row=>row.id===entry.id);assert.equal(raw.callToken,'secret-token');assert.deepEqual(raw.callMessage,{channelId:'c1',id:'m1'});
  await assert.rejects(store.respondCall(entry.id,{token:'secret-token',userId:'999',action:'join'}),/호출된 참가자만/);
  const response=await store.respondCall(entry.id,{token:'secret-token',userId:'123',action:'join'});assert.equal(response.entry.status,'joined');assert.equal(store.read().entries.find(row=>row.id===entry.id).callToken,'');
}));
