import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipantSelfServiceState, performParticipantSelfServiceAction } from '../src/participant-self-service.js';

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

test('participant call response keeps the call token server-side and supports self-service pass',async()=>{
  const state=openState();state.session.applicants=['u1'];
  const operations=fakeOperations(state),raw={id:'q1',source:'discord',discordUserId:'u1',displayName:'테스터',status:'called',position:1,sessionId:'s1',game:'lol',mode:'aram',round:3,callToken:'secret-call-token',callDeadline:Date.now()+60_000};let captured=null,syncs=0;
  const queue={read:()=>({entries:[raw]}),summary:()=>({entries:[{...raw,callToken:undefined}],counts:{called:1,waiting:0},activeCount:1}),async syncOperations(){syncs++;}};
  const calls={async respond(input){captured=input;raw.status='postponed_next';return {entry:{id:raw.id,status:'postponed_next'},next:null,advanceError:null};}};
  const result=await performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations,participationQueue:queue,participationCalls:calls,records:[profile],now:Date.now()});
  assert.equal(captured.token,'secret-call-token');
  assert.equal(captured.userId,'u1');
  assert.equal(captured.action,'pass');
  assert.ok(operations.read().reservations.some(r=>r.userId==='u1'&&r.round===4));
  assert.equal(syncs,1);
  assert.equal(JSON.stringify(result.state).includes('secret-call-token'),false);
});

test('participant self-service blocks non-call mutations while a call is pending',async()=>{
  const operations=fakeOperations(openState()),raw={id:'q1',source:'discord',discordUserId:'u1',status:'called',callToken:'token',callDeadline:Date.now()+60_000};
  const queue={read:()=>({entries:[raw]}),summary:()=>({entries:[],counts:{},activeCount:1}),async syncOperations(){}};
  await assert.rejects(()=>performParticipantSelfServiceAction({action:'join',userId:'u1',profile,operations,participationQueue:queue,now:Date.now()}),/현재 호출에 먼저 응답/);
});
