import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';

async function fixture(fn,{timeoutSeconds=15}={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-call-'));
  const sent=[],completed=[];
  try{
    const queue=new ParticipationQueueStore(path.join(dir,'queue.json'));await queue.init();
    const discord={
      async participationCall(entry,options){sent.push({entry:{...entry},options:{...options}});return options.messageRef||{channelId:'registration',id:`m${sent.length}`};},
      async completeParticipationCall(ref,payload){completed.push({ref,payload});return ref;}
    };
    const calls=new ParticipationCallService({queue,discord,timeoutSeconds});
    await fn({queue,calls,sent,completed,dir});
    calls.stop();
  }finally{await rm(dir,{recursive:true,force:true});}
}

test('call flow is serialized, exposes no response token in public queue, and accepts only the called Discord user',async()=>fixture(async({queue,calls,sent,completed})=>{
  const a=(await queue.register({source:'discord',displayName:'A',discordUserId:'100'})).entry;
  await queue.register({source:'discord',displayName:'B',discordUserId:'200'});
  const first=await calls.callNext();
  assert.equal(first.entry.id,a.id);assert.equal(sent.length,1);assert.equal(queue.summary().currentCall.id,a.id);assert.equal('callToken' in queue.summary().currentCall,false);
  const raw=queue.read().entries.find(e=>e.id===a.id);assert.equal(raw.status,'called');assert.ok(raw.callToken);assert.ok(raw.callDeadline>raw.calledAt);
  await assert.rejects(calls.respond({entryId:a.id,token:raw.callToken,userId:'999',action:'join'}),/호출된 참가자만/);
  const accepted=await calls.respond({entryId:a.id,token:raw.callToken,userId:'100',action:'join'});
  assert.equal(accepted.entry.status,'joined');assert.equal(accepted.next,null);assert.equal(queue.summary().currentCall,null);assert.equal(completed.at(-1).payload.status,'joined');
}));

test('pass and timeout automatically advance to the next waiting participant',async()=>fixture(async({queue,calls,sent})=>{
  const a=(await queue.register({source:'discord',displayName:'A',discordUserId:'100'})).entry;
  const b=(await queue.register({source:'discord',displayName:'B',discordUserId:'200'})).entry;
  const c=(await queue.register({source:'dashboard',displayName:'C'})).entry;
  await calls.callNext();let raw=queue.read().entries.find(e=>e.id===a.id);
  const passed=await calls.respond({entryId:a.id,token:raw.callToken,userId:'100',action:'pass'});
  assert.equal(passed.entry.status,'postponed_next');assert.equal(passed.next.id,b.id);assert.equal(queue.summary().currentCall.id,b.id);
  raw=queue.read().entries.find(e=>e.id===b.id);await queue.update(state=>{state.entries.find(e=>e.id===b.id).callDeadline=Date.now()-1;});raw=queue.read().entries.find(e=>e.id===b.id);await calls.expireAndAdvance(b.id,raw.callToken);
  assert.equal(queue.read().entries.find(e=>e.id===b.id).status,'no_show');assert.equal(queue.summary().currentCall.id,c.id);assert.equal(sent.length,3);
}));

test('recall edits the existing message reference and cancel returns participant to waiting',async()=>fixture(async({queue,calls,sent})=>{
  const a=(await queue.register({source:'discord',displayName:'A',discordUserId:'100'})).entry;
  await calls.callEntry(a.id);const before=queue.read().entries.find(e=>e.id===a.id),firstRef=before.callMessage,firstToken=before.callToken;
  await calls.recall(a.id);const after=queue.read().entries.find(e=>e.id===a.id);
  assert.notEqual(after.callToken,firstToken);assert.equal(after.callAttempt,2);assert.deepEqual(sent[1].options.messageRef,firstRef);
  const cancelled=await calls.cancel(a.id);assert.equal(cancelled.entry.status,'waiting');assert.equal(queue.summary().currentCall,null);
}));

test('restart recovery keeps a future call and converts an expired call to no-show before advancing',async()=>fixture(async({queue,calls,sent})=>{
  const a=(await queue.register({source:'discord',displayName:'A',discordUserId:'100'})).entry;
  const b=(await queue.register({source:'discord',displayName:'B',discordUserId:'200'})).entry;
  await calls.callEntry(a.id);calls.stop();
  const raw=queue.read().entries.find(e=>e.id===a.id);raw.callDeadline=Date.now()-1;await queue.update(state=>{const target=state.entries.find(e=>e.id===a.id);target.callDeadline=raw.callDeadline;});
  const recovered=new ParticipationCallService({queue,discord:{async participationCall(entry,options){sent.push({entry,options});return {channelId:'registration',id:'recovered'};},async completeParticipationCall(){}} ,timeoutSeconds:15});
  const result=await recovered.start();assert.equal(result.recovered,true);assert.equal(queue.read().entries.find(e=>e.id===a.id).status,'no_show');assert.equal(queue.summary().currentCall.id,b.id);recovered.stop();
}));

test('a committed pass stays successful when automatic next-call delivery fails',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-call-auto-fail-'));
  try{
    const queue=new ParticipationQueueStore(path.join(dir,'queue.json'));await queue.init();
    const a=(await queue.register({source:'discord',displayName:'A',discordUserId:'100'})).entry;
    const b=(await queue.register({source:'discord',displayName:'B',discordUserId:'200'})).entry;
    let sends=0;
    const discord={
      async participationCall(_entry,_options){sends++;if(sends>=2)throw Error('Discord 전송 실패');return {channelId:'registration',id:'m1'};},
      async completeParticipationCall(){}
    };
    const calls=new ParticipationCallService({queue,discord,timeoutSeconds:15});
    await calls.callNext();const raw=queue.read().entries.find(entry=>entry.id===a.id);
    const result=await calls.respond({entryId:a.id,token:raw.callToken,userId:'100',action:'pass'});
    assert.equal(result.entry.status,'postponed_next');
    assert.match(result.advanceError,/Discord 전송 실패/);
    assert.equal(result.next,null);
    assert.equal(queue.read().entries.find(entry=>entry.id===b.id).status,'waiting');
    assert.equal(queue.summary().currentCall,null);
    calls.stop();
  }finally{await rm(dir,{recursive:true,force:true});}
});
