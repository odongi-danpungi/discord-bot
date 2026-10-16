import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OperationsStore, applyAction } from '../src/operations.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';
import { assertCallPassOperationsState, callPassId, canBookCallPass, hasPendingCallPass } from '../src/call-pass.js';
import { validOperationsState } from '../src/recovery-audit.js';

async function fixture(fn){
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-durable-pass-')),services=[];
  try{
    const operations=new OperationsStore(path.join(dir,'operations.json'));await operations.init();
    await operations.update(state=>applyAction(state,'open',{game:'lol',mode:'aram',count:1}));
    for(const userId of ['a','b','c'])await operations.update(state=>applyAction(state,'join',{sessionId:state.session.id,userId}));
    const queue=new ParticipationQueueStore(path.join(dir,'queue.json'));await queue.init();queue.bindOperations(operations);
    await queue.syncOperations({records:['a','b','c'].map(discordId=>({discordId,discordUsername:`User ${discordId}`}))});
    const sent=[],completed=[];
    const discord={async participationCall(entry,options){sent.push({entry,options});return {channelId:'channel',id:`message-${sent.length}`};},async completeParticipationCall(ref,payload){completed.push({ref,payload});}};
    const makeCalls=()=>{const service=new ParticipationCallService({queue,discord,timeoutSeconds:15});services.push(service);return service;};
    const calls=makeCalls();await calls.callNext();
    const entry=queue.read().entries.find(item=>item.status==='called'),input={entryId:entry.id,token:entry.callToken,userId:'a',action:'pass'};
    await fn({dir,operations,queue,calls,discord,makeCalls,sent,completed,entry,input});
  }finally{for(const service of services)service.stop();await rm(dir,{recursive:true,force:true});}
}
const ioFailure=()=>Object.assign(Error('private path must not be exposed'),{code:'ENOSPC'});

for(const phase of ['open','closed','elapsed-open'])test(`exact live call pass commits one next-round reservation in ${phase}`,()=>fixture(async({operations,queue,calls,entry,input,sent})=>{
  if(phase==='closed')await operations.update(state=>applyAction(state,'close'));
  if(phase==='elapsed-open')await operations.update(state=>{state.session.closeAt=Date.now()-1;});
  assert.equal(canBookCallPass({state:operations.read(),entry}),true);
  const result=await calls.respond(input),state=operations.read(),receipt=state.callPassReceipts[0];
  assert.equal(result.entry.status,'postponed_next');assert.equal(result.next.discordUserId,'b');assert.equal(sent.length,2);
  assert.deepEqual(state.reservations,[{game:'lol',userId:'a',round:2}]);assert.deepEqual(state.session.postponed,['a']);
  assert.equal(receipt.id,callPassId(entry.id,input.token));assert.ok(receipt.appliedAt);assert.equal('token' in receipt,false);
  assert.equal(JSON.stringify(receipt).includes(input.token),false);
  const summary=queue.summary();assert.equal('callPassAdvances' in summary,false);assert.equal('callPassReceipt' in summary.entries[0],false);assert.equal('callToken' in summary.entries[0],false);
}));

test('successful duplicate pass never books twice or calls participant C after B has joined',()=>fixture(async({operations,queue,calls,input,sent})=>{
  await calls.respond(input);const b=queue.read().entries.find(item=>item.status==='called');
  await calls.respond({entryId:b.id,token:b.callToken,userId:'b',action:'join'});
  const revision=operations.read().revision,result=await calls.respond(input);
  assert.equal(result.replayed,true);assert.equal(result.next,null);assert.equal(operations.read().revision,revision);assert.equal(operations.read().reservations.length,1);assert.equal(sent.length,2);
  assert.equal(queue.read().entries.find(item=>item.discordUserId==='c').status,'waiting');
}));

test('operations write failure commits neither booking nor Queue response and retry succeeds',()=>fixture(async({operations,queue,calls,input})=>{
  const original=operations.writeUnlocked;operations.writeUnlocked=async()=>{throw ioFailure();};
  await assert.rejects(calls.respond(input),error=>error.code==='ENOSPC');
  assert.deepEqual(operations.read().reservations,[]);assert.equal(queue.read().entries.find(item=>item.id===input.entryId).status,'called');
  operations.writeUnlocked=original;await calls.respond(input);assert.equal(operations.read().reservations.length,1);
}));

test('Queue write failure leaves durable outbox; retry projects it and advances exactly once',()=>fixture(async({dir,operations,queue,calls,input,sent,entry})=>{
  const original=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw ioFailure();};
  await assert.rejects(calls.respond(input),error=>error.code==='ENOSPC');
  const disk=JSON.parse(await readFile(path.join(dir,'operations.json'),'utf8'));
  assert.equal(disk.callPassReceipts[0].appliedAt,null);assert.equal(disk.reservations.length,1);assert.equal(hasPendingCallPass({state:disk,entry}),true);
  assert.equal(queue.read().entries.find(item=>item.id===entry.id).status,'called');
  queue.writeUnlocked=original;
  const recovered=await calls.respond(input);assert.equal(recovered.replayed,true);assert.equal(recovered.next.discordUserId,'b');assert.equal(sent.length,2);
  assert.equal(operations.read().reservations.length,1);assert.ok(operations.read().callPassReceipts[0].appliedAt);
}));

test('restart recovers pending pass before expiry without marking accepted participant no-show',()=>fixture(async({dir,operations,queue,calls,input,discord})=>{
  const original=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw ioFailure();};await assert.rejects(calls.respond(input));queue.writeUnlocked=original;calls.stop();
  const freshOperations=new OperationsStore(path.join(dir,'operations.json'));await freshOperations.init();
  const freshQueue=new ParticipationQueueStore(path.join(dir,'queue.json'));await freshQueue.init();freshQueue.bindOperations(freshOperations);
  const freshCalls=new ParticipationCallService({queue:freshQueue,discord,timeoutSeconds:15});
  try{await freshCalls.start();assert.equal(freshQueue.read().entries.find(item=>item.id===input.entryId).status,'postponed_next');assert.equal(freshQueue.summary().currentCall.discordUserId,'b');assert.equal(freshOperations.read().reservations.length,1);}finally{freshCalls.stop();}
}));

test('stale queued sync cannot undo accepted pass and retains known participant label',()=>fixture(async({operations,queue,calls,input})=>{
  const stale=operations.read();await calls.respond(input);await queue.syncOperations({operationsState:stale});
  const a=queue.read().entries.find(item=>item.discordUserId==='a');assert.equal(a.status,'postponed_next');assert.equal(a.displayName,'User a');assert.equal(operations.read().reservations.length,1);
}));

for(const transition of ['cancel','consume'])test(`pending projection respects ${transition} and replay never restores an old booking`,()=>fixture(async({operations,queue,calls,input})=>{
  const original=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw ioFailure();};await assert.rejects(calls.respond(input));queue.writeUnlocked=original;
  if(transition==='cancel')await operations.update(state=>applyAction(state,'cancel_reservation',{game:'lol',userId:'a'}));
  else{await operations.update(state=>applyAction(state,'end'));await operations.update(state=>applyAction(state,'open',{game:'lol',mode:'aram',count:1}));}
  await queue.recoverCallPasses();assert.deepEqual(operations.read().reservations,[]);
  const a=queue.read().entries.find(item=>item.discordUserId==='a');assert.equal(a.status,transition==='cancel'?'cancelled':'waiting');
  if(transition==='consume')assert.equal(a.sessionId,operations.read().session.id);
  await calls.respond(input);assert.deepEqual(operations.read().reservations,[]);
}));

test('ack IO failure remains recoverable after a newer call pass replaces the latest entry marker',()=>fixture(async({operations,queue,calls,input})=>{
  const ack=operations.acknowledgeCallPasses;operations.acknowledgeCallPasses=async()=>{throw ioFailure();};
  await calls.respond(input);assert.equal(operations.read().callPassReceipts[0].appliedAt,null);
  await operations.update(state=>applyAction(state,'cancel_reservation',{game:'lol',userId:'a'}));
  await operations.update(state=>applyAction(state,'join',{sessionId:state.session.id,userId:'a'}));await queue.syncOperations();
  const b=queue.read().entries.find(item=>item.status==='called');await calls.cancel(b.id);
  await calls.callEntry(input.entryId);const newer=queue.read().entries.find(item=>item.id===input.entryId);
  await calls.respond({...input,token:newer.callToken});assert.equal(operations.read().callPassReceipts.length,2);
  operations.acknowledgeCallPasses=ack;await queue.recoverCallPasses();assert.ok(operations.read().callPassReceipts.every(item=>item.appliedAt));assert.equal(operations.read().reservations.length,1);
}));

for(const invalid of ['wrong-user','wrong-token','round','game','drawn','checking','ended','postponed'])test(`invalid ${invalid} call pass fails without changing authoritative booking`,()=>fixture(async({operations,queue,calls,input})=>{
  if(invalid==='wrong-user')input.userId='other';
  else if(invalid==='wrong-token')input.token='not-the-call';
  else if(['session','round','game'].includes(invalid))await queue.update(state=>{const entry=state.entries.find(item=>item.id===input.entryId);if(invalid==='session')entry.sessionId='other';if(invalid==='round')entry.round++;if(invalid==='game')entry.game='er';});
  else if(invalid==='postponed')await operations.update(state=>applyAction(state,'postpone_next',{sessionId:state.session.id,userId:'a'}));
  else if(invalid==='ended')await operations.update(state=>applyAction(state,'end'));
  else{await operations.update(state=>applyAction(state,'close'));await operations.update(state=>applyAction(state,'draw',{ids:['b']}));if(invalid==='checking')await operations.update(state=>applyAction(state,'attendance',{minutes:1}));}
  const before=operations.read();await assert.rejects(calls.respond(input),error=>[403,409].includes(error.status));assert.deepEqual(operations.read(),before);
}));

test('deadline is measured after waiting for Queue and Operations ownership, equality is expired',()=>fixture(async({operations,queue,entry,input})=>{
  const at=Date.now(),deadline=at+100;
  await queue.update(state=>{state.entries.find(item=>item.id===entry.id).callDeadline=deadline;});
  let release;const barrier=new Promise(resolve=>{release=resolve;});const holding=operations.update(async()=>barrier);
  let now=at;const response=queue.respondCall(entry.id,{...input,action:'pass',clock:()=>now});
  await new Promise(resolve=>setImmediate(resolve));now=deadline;release();await holding;
  await assert.rejects(response,error=>error.status===409);assert.deepEqual(operations.read().reservations,[]);
}));

test('guard is checked after waiting for the Operations lock',()=>fixture(async({operations,queue,entry,input})=>{
  let release,locked=false;const holding=operations.update(async()=>new Promise(resolve=>{release=resolve;}));await new Promise(resolve=>setImmediate(resolve));
  const response=queue.respondCall(entry.id,{...input,action:'pass',guard:()=>{if(locked)throw Object.assign(Error('locked'),{status:423});}});
  await new Promise(resolve=>setImmediate(resolve));locked=true;release();await holding;
  await assert.rejects(response,error=>error.status===423);assert.deepEqual(operations.read().reservations,[]);
}));

test('missing or replaced Queue evidence fails closed without silently dropping pending receipt',()=>fixture(async({operations,queue,calls,input})=>{
  const original=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw ioFailure();};await assert.rejects(calls.respond(input));queue.writeUnlocked=original;
  const state=queue.read();state.entries=state.entries.filter(item=>item.id!==input.entryId);await queue.write(state);
  await assert.rejects(queue.recoverCallPasses(),error=>error.status===503&&error.code==='call_pass_recovery_conflict');assert.equal(operations.read().callPassReceipts[0].appliedAt,null);
}));

test('alternate Queue instances share authoritative binding and cannot use a stale Operations snapshot',()=>fixture(async({dir,operations,queue,calls,input})=>{
  const alternate=new ParticipationQueueStore(path.join(dir,'queue.json')),stale=operations.read();await alternate.init();assert.equal(alternate.operations,operations);
  await calls.respond(input);await alternate.syncOperations({operationsState:stale});assert.equal(queue.read().entries.find(item=>item.id===input.entryId).status,'postponed_next');
}));

test('receipt contract rejects token-bearing, malformed, or duplicate receipts in stores and restore audits',()=>fixture(async({operations,calls,input})=>{
  await calls.respond(input);const valid=operations.read();assert.equal(validOperationsState(valid),true);
  for(const change of [state=>{state.callPassReceipts[0].token='secret';},state=>{state.callPassReceipts[0].targetRound++;},state=>{state.callPassReceipts.push(state.callPassReceipts[0]);},state=>{state.callPassReceipts=null;}]){
    const state=structuredClone(valid);change(state);assert.throws(()=>assertCallPassOperationsState(state));assert.equal(validOperationsState(state),false);await assert.rejects(operations.write(state));
  }
}));

test('concurrent duplicate passes create one booking and send one next call',()=>fixture(async({operations,calls,input,sent})=>{
  const results=await Promise.all([calls.respond(input),calls.respond(input),calls.respond(input)]);
  assert.equal(results.filter(item=>item.replayed).length,2);assert.equal(sent.length,2);assert.equal(operations.read().reservations.length,1);assert.equal(operations.read().callPassReceipts.length,1);
}));

for(const selected of [false,true])test(`old ${selected?'selected':'unselected'} automatic advance cannot call a reused Queue entry in a new round`,()=>fixture(async({operations,queue,calls,input,sent})=>{
  await queue.respondCall(input.entryId,input);
  if(selected)await queue.selectCallPassAdvance(operations.read().callPassReceipts[0].id);
  await operations.update(state=>applyAction(state,'postpone_next',{sessionId:state.session.id,userId:'b'}));
  await operations.update(state=>applyAction(state,'end'));
  await operations.update(state=>applyAction(state,'open',{game:'lol',mode:'aram',count:1}));
  await queue.syncOperations();assert.equal(queue.read().entries.find(item=>item.discordUserId==='b').status,'waiting');
  await calls.start();assert.equal(sent.length,1);assert.equal(queue.summary().currentCall,null);assert.equal(queue.pendingCallPassAdvances().length,0);
}));

test('advance validates origin again after waiting for Queue ownership',()=>fixture(async({operations,queue,calls,input,sent})=>{
  await queue.respondCall(input.entryId,input);const receipt=operations.read().callPassReceipts[0];const advance=await queue.selectCallPassAdvance(receipt.id);
  let release;const holding=queue.update(async()=>new Promise(resolve=>{release=resolve;}));await new Promise(resolve=>setImmediate(resolve));
  const progressing=calls.callEntryUnlocked(advance.targetId,{reason:'pass-auto',expectedSession:advance});
  await operations.update(state=>applyAction(state,'end'));release();await holding;
  await assert.rejects(progressing,error=>error.code==='call_pass_advance_stale');assert.equal(sent.length,1);assert.equal(queue.summary().currentCall,null);
}));

test('ack failure is reported by shared Queue flush and a durable retry clears it',()=>fixture(async({operations,queue,calls,input})=>{
  const ack=operations.acknowledgeCallPasses;operations.acknowledgeCallPasses=async()=>{throw ioFailure();};await calls.respond(input);
  await assert.rejects(queue.flush(),error=>error.code==='ENOSPC');
  const alternate=new ParticipationQueueStore(queue.file);await assert.rejects(alternate.flush(),error=>error.code==='ENOSPC');
  operations.acknowledgeCallPasses=ack;await alternate.recoverCallPasses();await queue.flush();assert.ok(operations.read().callPassReceipts[0].appliedAt);
}));

test('Queue flush waits for acknowledgement that starts after the Queue primary commit',()=>fixture(async({operations,queue,input})=>{
  const acknowledge=operations.acknowledgeCallPasses;let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  operations.acknowledgeCallPasses=async ids=>{entered();await new Promise(resolve=>{release=resolve;});return acknowledge.call(operations,ids);};
  const response=queue.respondCall(input.entryId,input);await started;
  let flushed=false;const flushing=queue.flush().then(()=>{flushed=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(flushed,false);
  release();await response;await flushing;assert.ok(operations.read().callPassReceipts[0].appliedAt);
}));

test('newer unmatched call token is not overwritten by an unprojected decision',()=>fixture(async({operations,queue,calls,input})=>{
  const original=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw ioFailure();};await assert.rejects(calls.respond(input));queue.writeUnlocked=original;
  const state=queue.read(),entry=state.entries.find(item=>item.id===input.entryId);entry.callToken='newer-token';entry.callAttempt++;await queue.write(state);
  await assert.rejects(queue.recoverCallPasses(),error=>error.code==='call_pass_recovery_conflict');assert.equal(queue.read().entries.find(item=>item.id===input.entryId).callToken,'newer-token');assert.equal(operations.read().callPassReceipts[0].appliedAt,null);
}));

test('ordinary postponement remains closed while a live called response is eligible',()=>fixture(async({operations,entry})=>{
  await operations.update(state=>applyAction(state,'close'));
  await assert.rejects(operations.update(state=>applyAction(state,'postpone_next',{sessionId:state.session.id,userId:'b'})),/마감/);
  assert.equal(canBookCallPass({state:operations.read(),entry}),true);
}));

test('origin change during Queue primary write prevents stale Discord automatic call',()=>fixture(async({operations,queue,calls,input,sent})=>{
  await queue.respondCall(input.entryId,input);const receipt=operations.read().callPassReceipts[0],advance=await queue.selectCallPassAdvance(receipt.id);
  const write=queue.writeUnlocked;let release,entered;const started=new Promise(resolve=>{entered=resolve;});let held=false;
  queue.writeUnlocked=async function(...args){if(!held){held=true;entered();await new Promise(resolve=>{release=resolve;});}return write.apply(this,args);};
  const progressing=calls.callEntryUnlocked(advance.targetId,{reason:'pass-auto',expectedSession:advance});await started;
  await operations.update(state=>applyAction(state,'end'));release();await assert.rejects(progressing,error=>error.code==='call_pass_advance_stale');
  assert.equal(sent.length,1);assert.equal(queue.summary().currentCall,null);queue.writeUnlocked=write;
}));

test('automatic advance failure is public-safe while committed reservation is retained',()=>fixture(async({operations,queue,calls,input})=>{
  queue.selectCallPassAdvance=async()=>{throw ioFailure();};
  const result=await calls.respond(input);assert.equal(result.entry.status,'postponed_next');assert.match(result.advanceError,/진행자/);assert.doesNotMatch(result.advanceError,/private|path|exposed/);assert.equal(operations.read().reservations.length,1);
}));

for(const progression of ['next','manual','timeout'])test(`recovery through ${progression} owns the next call once, even after the next participant joins`,()=>fixture(async({operations,queue,calls,input,sent})=>{
  const write=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw ioFailure();};await assert.rejects(calls.respond(input));queue.writeUnlocked=write;
  if(progression==='next')await calls.callNext();
  else if(progression==='manual')await calls.callEntry(queue.read().entries.find(item=>item.discordUserId==='b').id);
  else await calls.expireAndAdvance(input.entryId,input.token);
  const b=queue.read().entries.find(item=>item.status==='called');assert.equal(b.discordUserId,'b');await calls.respond({entryId:b.id,token:b.callToken,userId:'b',action:'join'});
  const replay=await calls.respond(input);assert.equal(replay.replayed,true);assert.equal(replay.next,null);assert.equal(sent.length,2);assert.equal(operations.read().reservations.length,1);assert.equal(queue.summary().currentCall,null);
}));

test('completed history pruning rejects an exact old replay without rebooking or advancing',()=>fixture(async({operations,queue,calls,input,entry,sent})=>{
  const now=Date.now();
  const receipts=Array.from({length:200},(_,index)=>({id:callPassId(`old-${index}`,`token-${index}`),entryId:`old-${index}`,userId:`old-user-${index}`,sessionId:'old-session',game:'lol',round:1,targetRound:2,attempt:1,deadline:now-1000,createdAt:now-10000+index,appliedAt:now-500}));
  await operations.update(state=>{state.callPassReceipts=receipts;});
  await queue.update(state=>{state.callPassAdvances=receipts.map(receipt=>({id:receipt.id,entryId:receipt.entryId,sessionId:receipt.sessionId,game:receipt.game,round:receipt.round,targetId:null,selected:true,done:true}));state.entries.push({...entry,id:'old-0',sequence:state.nextSequence++,position:4,identityKey:'discord:old-user-0',discordUserId:'old-user-0',sessionId:'old-session',status:'postponed_next',callToken:'',callDeadline:0,callMessage:null,calledAt:0});});
  await calls.respond(input);await queue.syncOperations();
  assert.equal(operations.read().callPassReceipts.length,200);assert.equal(queue.read().callPassAdvances.length,200);assert.equal(operations.read().callPassReceipts.some(item=>item.id===receipts[0].id),false);
  const before=operations.read();await assert.rejects(calls.respond({entryId:'old-0',token:'token-0',userId:'old-user-0',action:'pass'}),error=>error.status===409);assert.deepEqual(operations.read(),before);assert.equal(sent.length,2);
}));

for(const kind of ['unmatched-session','no-session','manual-source'])test(`bound ${kind} call retains legacy Queue-only pass without booking an arbitrary round`,()=>fixture(async({operations,queue,calls,input})=>{
  await queue.update(state=>{const entry=state.entries.find(item=>item.id===input.entryId);if(kind==='unmatched-session')entry.sessionId='manual-other-session';else if(kind==='no-session')entry.sessionId=null;else entry.source='dashboard';});
  const result=await calls.respond(input);assert.equal(result.entry.status,'postponed_next');assert.equal(result.next.discordUserId,'b');assert.deepEqual(operations.read().reservations,[]);assert.equal(operations.read().callPassReceipts,undefined);
}));

test('invalid manual call does not retire a pending pass advance before a valid next call',()=>fixture(async({operations,queue,calls,input,sent})=>{
  await queue.respondCall(input.entryId,input);assert.equal(queue.pendingCallPassAdvances().length,1);
  await assert.rejects(calls.callEntry('missing'),error=>error.status===404);assert.equal(queue.pendingCallPassAdvances().length,1);
  await calls.callNext();assert.equal(queue.summary().currentCall.discordUserId,'b');assert.equal(sent.length,2);assert.equal(operations.read().reservations.length,1);
}));

test('a response queued before its deadline is rejected when Queue ownership arrives at expiry',()=>fixture(async({operations,queue,entry,input})=>{
  const at=Date.now(),deadline=at+100;await queue.update(state=>{state.entries.find(item=>item.id===entry.id).callDeadline=deadline;});
  let release;const holding=queue.update(async()=>new Promise(resolve=>{release=resolve;}));await new Promise(resolve=>setImmediate(resolve));
  let now=at;const response=queue.respondCall(entry.id,{...input,clock:()=>now});now=deadline;release();await holding;
  await assert.rejects(response,error=>error.status===409);assert.deepEqual(operations.read().reservations,[]);
}));

test('damaged Operations primary recovers a receipt backup without losing or duplicating booking',()=>fixture(async({dir,operations,queue,calls,input,discord,sent})=>{
  await calls.respond(input);calls.stop();
  await writeFile(operations.file,'{damaged-primary','utf8');
  const recoveredOps=new OperationsStore(operations.file);await recoveredOps.init();assert.equal(recoveredOps.recovered,true);
  const recoveredQueue=new ParticipationQueueStore(queue.file);await recoveredQueue.init();recoveredQueue.bindOperations(recoveredOps);
  const service=new ParticipationCallService({queue:recoveredQueue,discord,timeoutSeconds:15});
  try{await service.start();assert.equal(recoveredOps.read().reservations.length,1);assert.equal(recoveredQueue.read().entries.find(item=>item.id===input.entryId).status,'postponed_next');assert.equal(sent.length,2);}finally{service.stop();}
}));

test('emergency pause keeps an accepted pending decision and unlock resumes its next call once',()=>fixture(async({operations,queue,calls,input,sent})=>{
  const write=queue.writeUnlocked;queue.writeUnlocked=async()=>{throw ioFailure();};await assert.rejects(calls.respond(input));queue.writeUnlocked=write;
  await calls.pause();assert.equal(sent.length,1);assert.equal(operations.read().reservations.length,1);
  await calls.resume();assert.equal(queue.summary().currentCall.discordUserId,'b');assert.equal(sent.length,2);
  await calls.respond(input);assert.equal(sent.length,2);assert.equal(operations.read().reservations.length,1);
}));
