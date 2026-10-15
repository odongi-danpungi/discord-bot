import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildParticipantSelfServiceState, performParticipantSelfServiceAction } from '../src/participant-self-service.js';
import { OperationsStore } from '../src/operations.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';

function fakeOperations(initial){
  const state=structuredClone(initial);
  return {
    state,
    read(){return state;},
    async update(fn){return fn(state);}
  };
}

const profile={discordId:'u1',chzzkName:'테스터',lolRiotId:'Tester#KR1',lolMainLane:'mid',lolCurrentTier:'골드',lolPeakTier:'플래티넘'};

function openState(){return {session:{id:'s1',round:3,game:'lol',mode:'aram',phase:'open',count:10,title:'칼바람 시참',closeAt:null,applicants:[],postponed:[],winners:[],confirmed:[],excluded:[],teams:[],createdAt:1},reservations:[],history:[],sessionArchive:[],rounds:{lol:3},revision:0};}

test('participant self-service summary exposes only the logged-in Discord participant',()=>{
  const state=openState();state.session.applicants=['u1','u2'];
  const summary=buildParticipantSelfServiceState({operationsState:state,userId:'u1',profile,now:1000,queueSummary:{activeCount:2,counts:{waiting:2},entries:[
    {id:'q1',source:'discord',discordUserId:'u1',displayName:'테스터',status:'waiting',position:1,updatedAt:10},
    {id:'q2',source:'discord',discordUserId:'u2',displayName:'다른사람',status:'waiting',position:2,updatedAt:11}
  ]}});
  assert.equal(summary.queue.entry.id,'q1');
  assert.equal(summary.queue.entry.displayName,'테스터');
  assert.equal(summary.queue.waitingCount,2);
  assert.equal(JSON.stringify(summary).includes('다른사람'),false);
  assert.equal(summary.actions.leave,true);
  assert.equal(summary.actions.postponeNext,true);
  assert.equal(summary.actions.join,false);
});

test('participant self-service can join and postpone using the authoritative operations state',async()=>{
  const operations=fakeOperations(openState());let syncs=0;
  const queue={read:()=>({entries:[]}),summary:()=>({entries:[],counts:{waiting:0},activeCount:0}),async syncOperations(){syncs++;return this.summary();}};
  await performParticipantSelfServiceAction({action:'join',userId:'u1',profile,operations,participationQueue:queue,records:[profile],now:2000});
  assert.deepEqual(operations.read().session.applicants,['u1']);
  await performParticipantSelfServiceAction({action:'postpone_next',userId:'u1',profile,operations,participationQueue:queue,records:[profile],now:2100});
  assert.ok(operations.read().session.postponed.includes('u1'));
  assert.deepEqual(operations.read().reservations.map(r=>({game:r.game,userId:r.userId,round:r.round})),[{game:'lol',userId:'u1',round:4}]);
  assert.equal(syncs,2);
});

test('participant call response keeps the token server-side and delegates persistence without prewrites or stale resync',async()=>{
  const state=openState();state.session.applicants=['u1'];
  const operations=fakeOperations(state),raw={id:'q1',source:'discord',discordUserId:'u1',displayName:'테스터',status:'called',position:1,sessionId:'s1',game:'lol',mode:'aram',round:3,callToken:'secret-call-token',callDeadline:Date.now()+60_000};let captured=null,syncs=0;
  const queue={read:()=>({entries:[raw]}),summary:()=>({entries:[{...raw,callToken:undefined}],counts:{called:1,waiting:0},activeCount:1}),async syncOperations(){syncs++;}};
  const calls={async respond(input){captured=input;raw.status='postponed_next';return {entry:{id:raw.id,status:'postponed_next',callToken:'never-return'},next:{displayName:'private-other-participant',discordUserId:'private-other-id'},advanceError:'private-filesystem-detail'};}};
  const result=await performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations,participationQueue:queue,participationCalls:calls,records:[profile],now:Date.now()});
  assert.equal(captured.token,'secret-call-token');
  assert.equal(captured.userId,'u1');
  assert.equal(captured.action,'pass');
  assert.deepEqual(operations.read().reservations,[],'the entrypoint must not pre-write the call service decision');
  assert.equal(syncs,0,'the entrypoint must not replay an Operations snapshot over the committed Queue result');
  assert.equal(JSON.stringify(result.state).includes('secret-call-token'),false);
  assert.doesNotMatch(JSON.stringify(result),/private-other|private-filesystem|never-return|callToken/);
  assert.match(result.result.advanceError,/진행자가 확인/);
});

test('participant self-service blocks non-call mutations while a call is pending',async()=>{
  const operations=fakeOperations(openState()),raw={id:'q1',source:'discord',discordUserId:'u1',status:'called',callToken:'token',callDeadline:Date.now()+60_000};
  const queue={read:()=>({entries:[raw]}),summary:()=>({entries:[],counts:{},activeCount:1}),async syncOperations(){}};
  await assert.rejects(()=>performParticipantSelfServiceAction({action:'join',userId:'u1',profile,operations,participationQueue:queue,now:Date.now()}),/현재 호출에 먼저 응답/);
});

test('participant recruitment uses only the current Discord policy snapshot and not Queue or next-round settings',()=>{
  const state=openState();
  state.session.count=2;
  state.session.intakePolicy={maxApplicants:4,duplicatePolicy:'keep_existing',closeOnCapacity:false};
  state.session.applicants=['other','other','reserved'];state.session.postponed=['reserved'];
  state.intakeSettings={revision:7,settings:{maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:true}};
  const before=structuredClone(state);
  const result=buildParticipantSelfServiceState({operationsState:state,userId:'u1',profile,now:1000,queueSummary:{activeCount:99,counts:{waiting:77},entries:[{id:'private-naver',source:'naver',displayName:'private cafe name',status:'waiting'}]}});
  assert.deepEqual(result.recruitment,{status:'open',reason:null,maxApplicants:4,activeApplicants:1,remainingSlots:3,unlimited:false,closeAt:0,drawCount:2,duplicatePolicy:'keep_existing'});
  assert.equal(result.actions.join,true);assert.equal(result.queue.activeCount,99);
  assert.doesNotMatch(JSON.stringify(result.recruitment),/other|reserved|naver|cafe/);
  assert.deepEqual(state,before);
  state.intakeSettings=null;
  assert.deepEqual(buildParticipantSelfServiceState({operationsState:state,userId:'u1',profile,now:1000}).recruitment,result.recruitment);
});

test('capacity disables new and postponed admissions while preserving active participant leave and postponement',()=>{
  const state=openState();state.session.count=1;
  state.session.intakePolicy={maxApplicants:1,duplicatePolicy:'keep_existing',closeOnCapacity:false};
  state.session.applicants=['u1','reserved'];state.session.postponed=['reserved'];
  const own=buildParticipantSelfServiceState({operationsState:state,userId:'u1',profile,now:1000});
  assert.equal(own.recruitment.status,'full');assert.equal(own.actions.join,false);
  assert.equal(own.actions.leave,true);assert.equal(own.actions.postponeNext,true);assert.equal(own.actions.postponeNext2,true);
  const newcomer=buildParticipantSelfServiceState({operationsState:state,userId:'new',profile,now:1000});
  assert.equal(newcomer.actions.join,false);assert.equal(newcomer.actions.leave,false);
  const reserved=buildParticipantSelfServiceState({operationsState:state,userId:'reserved',profile,now:1000});
  assert.equal(reserved.session.postponed,true);assert.equal(reserved.actions.join,false);assert.equal(reserved.actions.postponeNext,false);
  state.session.applicants=['reserved'];
  assert.equal(buildParticipantSelfServiceState({operationsState:state,userId:'reserved',profile,now:1000}).actions.join,true);
});

test('auto-closed capacity keeps intake mutations disabled but retains reservation cancellation',()=>{
  const state=openState();state.session.count=1;state.session.phase='closed';state.session.closeReason='capacity';
  state.session.intakePolicy={maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:true};
  state.session.applicants=['u1'];state.reservations=[{userId:'u1',game:'lol',round:4}];
  const own=buildParticipantSelfServiceState({operationsState:state,userId:'u1',profile,now:1000});
  assert.equal(own.recruitment.status,'closed');assert.equal(own.recruitment.reason,'capacity');
  assert.equal(own.actions.join,false);assert.equal(own.actions.leave,false);assert.equal(own.actions.postponeNext,false);
  assert.equal(own.actions.cancelReservation,true);
});

test('intake deadline preserves call responses before draw and attendance confirmation remains separate',()=>{
  const state=openState();state.session.count=1;state.session.closeAt=1000;
  state.session.intakePolicy={maxApplicants:1,duplicatePolicy:'keep_existing',closeOnCapacity:false};
  state.session.applicants=['u1'];
  const queueSummary={entries:[{id:'own-call',source:'discord',discordUserId:'u1',sessionId:'s1',game:'lol',mode:'aram',round:3,status:'called',callDeadline:2000,callToken:'server-only'}]};
  const called=buildParticipantSelfServiceState({operationsState:state,queueSummary,userId:'u1',profile,now:1000});
  assert.equal(called.recruitment.reason,'deadline');assert.equal(called.actions.callJoin,true);assert.equal(called.actions.callPass,true);assert.equal(called.actions.leave,false);
  assert.doesNotMatch(JSON.stringify(called),/server-only/);
  state.session.phase='checking';state.session.winners=['u1'];state.session.deadline=2000;
  const checking=buildParticipantSelfServiceState({operationsState:state,userId:'u1',profile,now:1000});
  assert.equal(checking.recruitment.reason,'progress');assert.equal(checking.actions.confirm,true);
});

test('recruitment preserves own identity actions while malformed current session data fails closed',()=>{
  const state=openState();state.session.intakePolicy={maxApplicants:20,duplicatePolicy:'reject',closeOnCapacity:false};
  state.session.applicants=['other'];
  const own=buildParticipantSelfServiceState({operationsState:state,userId:'u1',profile,now:1000});
  assert.equal(own.actions.join,true);assert.equal(own.session.applicant,false);assert.equal(own.queue.entry,null);
  for(const malformed of [false,{...state.session,count:'10'},{...state.session,intakePolicy:null},{...state.session,applicants:null}])
    assert.throws(()=>buildParticipantSelfServiceState({operationsState:{...state,session:malformed},userId:'u1',profile,now:1000}),error=>error.status===503);
  const inactive=buildParticipantSelfServiceState({operationsState:{session:null,reservations:[]},userId:'u1',profile,now:1000});
  assert.equal(inactive.recruitment.reason,'no_session');assert.equal(inactive.actions.join,false);
});

for(const action of ['join','confirm'])test(`queued ${action} rechecks its deadline inside the real OperationsStore update without changing committed state`,async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'daeng-participant-deadline-'));
  let release,blocking,pending;
  try{
    const file=path.join(dir,'operations.json'),operations=new OperationsStore(file);
    await operations.init();
    const state=openState();state.session.count=1;
    if(action==='join')state.session.closeAt=1010;
    else Object.assign(state.session,{phase:'checking',applicants:['u1'],winners:['u1'],deadline:1010,attendanceVersion:1});
    await operations.write(state);
    const before=operations.read(),bytes=await readFile(file);
    let entered;const started=new Promise(resolve=>{entered=resolve;});
    const barrier=new Promise(resolve=>{release=resolve;});
    blocking=operations.update(async()=>{entered();await barrier;});
    await started;
    let time=50_000;
    pending=performParticipantSelfServiceAction({action,userId:'u1',profile,operations,now:1000,clock:()=>time});
    const rejected=assert.rejects(pending,action==='join'?/모집이 마감됐거나 이전 모집/:/참석 확인 대상이 아니거나 시간이 만료/);
    time+=10;release();
    await blocking;await rejected;
    assert.deepEqual(operations.read(),before);assert.deepEqual(await readFile(file),bytes);
    await operations.flush();
  }finally{
    release?.();await Promise.allSettled([blocking,pending].filter(Boolean));
    await rm(dir,{recursive:true,force:true});
  }
});

async function durableCalled(t,phase){
  const dir=await mkdtemp(path.join(tmpdir(),'daeng-participant-pass-'));
  const operations=new OperationsStore(path.join(dir,'operations.json'));await operations.init();
  const state=openState(),at=Date.now();state.session.count=1;state.session.applicants=['u1'];
  state.session.phase=phase==='expired_open'?'open':phase;
  if(phase==='expired_open')state.session.closeAt=at;
  if(phase==='closed')state.session.closeReason='manual';
  if(['drawn','checking'].includes(phase))state.session.winners=['u1'];
  if(phase==='checking'){state.session.deadline=at+60_000;state.session.attendanceVersion=1;}
  await operations.write(state);
  const queue=new ParticipationQueueStore(path.join(dir,'queue.json'));await queue.init();queue.bindOperations(operations);
  await queue.syncOperations({records:[profile]});
  // An ended session has no current applicant Queue; retain an exact historical call.
  if(phase==='ended')await queue.register({source:'discord',displayName:'테스터',discordUserId:'u1',sessionId:'s1',game:'lol',mode:'aram',round:3});
  const sent=[];
  const calls=new ParticipationCallService({queue,discord:{async participationCall(entry){sent.push(entry.id);return {channelId:'fixture',id:'fixture-message'};},async completeParticipationCall(){}}});
  t.after(async()=>{calls.stop();try{await Promise.all([queue.flush(),operations.flush()]);}finally{await rm(dir,{recursive:true,force:true});}});
  await calls.callNext();
  return {operations,queue,calls,sent,raw:queue.read().entries.find(entry=>entry.status==='called'),file:operations.file};
}

for(const phase of ['drawn','checking','ended'])test(`current-session call pass protects committed ${phase} outcomes while call join remains valid`,async t=>{
  const f=await durableCalled(t,phase),before=f.operations.read(),bytes=await readFile(f.file),queueBefore=f.queue.read();
  const own=buildParticipantSelfServiceState({operationsState:before,queueSummary:f.queue.summary(),userId:'u1',profile});
  assert.equal(own.actions.callPass,false);assert.equal(own.actions.callJoin,true);
  await assert.rejects(performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations:f.operations,participationQueue:f.queue,participationCalls:f.calls}),error=>error.status===409);
  assert.deepEqual(f.operations.read(),before);assert.deepEqual(await readFile(f.file),bytes);assert.deepEqual(f.queue.read(),queueBefore);
  const accepted=await performParticipantSelfServiceAction({action:'call_join',userId:'u1',profile,operations:f.operations,participationQueue:f.queue,participationCalls:f.calls});
  assert.equal(accepted.state.queue.entry.status,'joined');assert.deepEqual(f.operations.read(),before);
});

for(const phase of ['expired_open','closed'])test(`self-service call pass durably books the next round after ${phase} without reopening recruitment`,async t=>{
  const f=await durableCalled(t,phase),phaseBefore=f.operations.read().session.phase;
  const own=buildParticipantSelfServiceState({operationsState:f.operations.read(),queueSummary:f.queue.summary(),userId:'u1',profile});
  assert.equal(own.actions.callPass,true);assert.equal(own.actions.join,false);
  const result=await performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations:f.operations,participationQueue:f.queue,participationCalls:f.calls,records:[profile]});
  assert.equal(result.state.queue.entry.status,'postponed_next');assert.equal(result.state.queue.passPending,false);
  assert.deepEqual(result.state.reservations,[{game:'lol',round:4}]);assert.equal(f.operations.read().session.phase,phaseBefore);
  assert.deepEqual(f.operations.read().session.postponed,['u1']);
  assert.doesNotMatch(JSON.stringify(result),/callPassReceipt|callPassAdvances|server-only/);
  const before=f.operations.read(),replayed=await f.calls.respond({entryId:f.raw.id,token:f.raw.callToken,userId:'u1',action:'pass'});
  assert.equal(replayed.replayed,true);assert.deepEqual(f.operations.read(),before);assert.equal(f.sent.length,1);
});

test('an open full intake still supports call pass and frees the current-round seat',async t=>{
  const f=await durableCalled(t,'open');
  await f.operations.update(state=>{state.session.intakePolicy={maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:false};});
  const result=await performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations:f.operations,participationQueue:f.queue,participationCalls:f.calls,records:[profile]});
  assert.equal(result.state.recruitment.remainingSlots,1);assert.equal(result.state.queue.entry.status,'postponed_next');
  assert.deepEqual(f.operations.read().reservations,[{game:'lol',userId:'u1',round:4}]);
});

test('unmatched or manual Queue calls and calls without a current session retain their existing pass path',async()=>{
  const at=Date.now();
  for(const sessionId of ['other-session',undefined,null]){
    const state=openState();state.session.phase='closed';state.session.closeReason='manual';
    const operations=fakeOperations(state),before=structuredClone(state);
    const raw={id:'other-call',source:'discord',discordUserId:'u1',sessionId,status:'called',callDeadline:at+60_000,callToken:'server-only'};
    let responses=0;
    const queue={read:()=>({entries:[raw]}),summary:()=>({entries:[raw],counts:{called:1},activeCount:1}),async syncOperations(){}};
    const calls={async respond(input){responses++;assert.equal(input.action,'pass');raw.status='postponed_next';return {entry:{id:raw.id,status:raw.status}};}};
    assert.equal(buildParticipantSelfServiceState({operationsState:state,queueSummary:queue.summary(),userId:'u1',profile,now:at}).actions.callPass,true);
    await performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations,participationQueue:queue,participationCalls:calls,now:at,clock:()=>at});
    assert.equal(responses,1);assert.deepEqual(operations.read(),before);
  }
  const operations=fakeOperations({session:null,reservations:[]});
  const raw={id:'manual-call',source:'discord',discordUserId:'u1',sessionId:'past-session',status:'called',callDeadline:at+60_000,callToken:'server-only'};
  let responded=false;
  const queue={read:()=>({entries:[raw]}),summary:()=>({entries:[raw],counts:{called:1},activeCount:1}),async syncOperations(){}};
  const calls={async respond(){responded=true;raw.status='postponed_next';return {};}};
  assert.equal(buildParticipantSelfServiceState({operationsState:operations.read(),queueSummary:queue.summary(),userId:'u1',profile,now:at}).actions.callPass,true);
  await performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations,participationQueue:queue,participationCalls:calls,now:at,clock:()=>at});
  assert.equal(responded,true);assert.deepEqual(operations.read(),{session:null,reservations:[]});
});
