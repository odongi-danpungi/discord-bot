import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipantRecruitmentState } from '../src/participant-intake.js';
import { DEFAULT_INTAKE_POLICY } from '../src/intake-policy.js';
import { applyAction } from '../src/operations.js';

const now=10_000;
const session=(patch={})=>({id:'current-private-session',phase:'open',count:10,closeAt:null,applicants:[],postponed:[],intakePolicy:{...DEFAULT_INTAKE_POLICY},...patch});
const summary=(patch={},time=now)=>buildParticipantRecruitmentState({session:session(patch),now:time});
const fresh=()=>({session:null,history:[],reservations:[],sessionArchive:[],rounds:{},revision:0});

test('absent session has an explicitly inactive aggregate rather than unlimited recruitment',()=>{
  for(const missing of [null,undefined])assert.deepEqual(buildParticipantRecruitmentState({session:missing,now}),{
    status:'inactive',reason:'no_session',maxApplicants:null,activeApplicants:0,remainingSlots:null,
    unlimited:false,closeAt:0,drawCount:0,duplicatePolicy:null
  });
});

test('unlimited intake and draw count are independent; a missing legacy policy retains compatibility',()=>{
  const current=session({count:5,applicants:['first','second']});
  delete current.intakePolicy;
  assert.deepEqual(buildParticipantRecruitmentState({session:current,now}),{
    status:'open',reason:null,maxApplicants:0,activeApplicants:2,remainingSlots:null,
    unlimited:true,closeAt:0,drawCount:5,duplicatePolicy:'keep_existing'
  });
});

test('finite intake counts unique non-postponed applicants and clamps over-cap reservations',()=>{
  const policy={maxApplicants:3,duplicatePolicy:'reject',closeOnCapacity:false};
  const current=summary({count:2,intakePolicy:policy,applicants:['first','first','second','future','future'],postponed:['future']});
  assert.equal(current.activeApplicants,2);assert.equal(current.remainingSlots,1);
  assert.equal(current.status,'open');assert.equal(current.drawCount,2);assert.equal(current.duplicatePolicy,'reject');
  const overflow=summary({count:1,intakePolicy:{...policy,maxApplicants:1},applicants:['first','second','future'],postponed:['future']});
  assert.equal(overflow.activeApplicants,2);assert.equal(overflow.remainingSlots,0);
  assert.equal(overflow.status,'full');assert.equal(overflow.reason,'capacity');
});

test('capacity reached remains full even without automatic phase closure',()=>{
  const current=summary({intakePolicy:{maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:false},applicants:['first','second']});
  assert.equal(current.status,'full');assert.equal(current.reason,'capacity');assert.equal(current.remainingSlots,0);
});

test('deadline uses the admission boundary exactly and takes precedence over a full open round',()=>{
  const patch={intakePolicy:{maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:false},applicants:['first'],closeAt:now};
  assert.equal(summary(patch,now-1).status,'full');
  assert.equal(summary(patch).status,'closed');assert.equal(summary(patch).reason,'deadline');
  assert.equal(summary({...patch,applicants:[]},now+1).reason,'deadline');
});

test('explicit closure reasons survive changed capacity and a later elapsed deadline',()=>{
  for(const reason of ['capacity','manual','deadline']){
    const current=summary({phase:'closed',closeReason:reason,closeAt:1,applicants:[],intakePolicy:{maxApplicants:2,duplicatePolicy:'keep_existing',closeOnCapacity:true}});
    assert.equal(current.status,'closed');assert.equal(current.reason,reason);assert.equal(current.remainingSlots,2);
  }
  assert.equal(summary({phase:'closed',closeAt:now}).reason,'deadline');
  assert.equal(summary({phase:'closed',closeAt:now+1}).reason,'manual');
  assert.equal(summary({phase:'closed'}).reason,'manual');
});

test('drawn, checking and ended rounds are closed for progress despite a prior closure reason',()=>{
  for(const phase of ['drawn','checking','ended']){
    const current=summary({phase,closeReason:'capacity',closeAt:1,intakePolicy:{maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:true},applicants:['first']});
    assert.equal(current.status,'closed');assert.equal(current.reason,'progress');
  }
});

test('reopening a full auto-closed round reports full until a leave frees a place',()=>{
  const state=fresh();state.intakeSettings={revision:1,settings:{maxApplicants:1,duplicatePolicy:'keep_existing',closeOnCapacity:true}};
  applyAction(state,'open',{game:'lol',count:1},now);
  applyAction(state,'join',{sessionId:state.session.id,userId:'first'},now+1);
  assert.equal(buildParticipantRecruitmentState({session:state.session,now:now+2}).status,'closed');
  applyAction(state,'reopen',{},now+2);
  const full=buildParticipantRecruitmentState({session:state.session,now:now+2});
  assert.equal(full.status,'full');assert.equal(full.reason,'capacity');
  applyAction(state,'leave',{sessionId:state.session.id,userId:'first'},now+3);
  const freed=buildParticipantRecruitmentState({session:state.session,now:now+3});
  assert.equal(freed.status,'open');assert.equal(freed.remainingSlots,1);
});

test('carried reservations over a new cap are preserved and shown without future reservations taking places',()=>{
  const state=fresh();state.intakeSettings={revision:1,settings:{maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:false}};
  state.reservations=[{game:'lol',userId:'first',round:1},{game:'lol',userId:'second',round:1},{game:'lol',userId:'future',round:2}];
  applyAction(state,'open',{game:'lol',count:1},now);
  const before=structuredClone(state);
  const current=buildParticipantRecruitmentState({session:state.session,now});
  assert.equal(current.status,'full');assert.equal(current.activeApplicants,2);assert.equal(current.remainingSlots,0);
  assert.deepEqual(state,before);
});

test('aggregate is a fresh exact-shape read-only object without participant identities or internal fields',()=>{
  const original=session({applicants:['sensitive-user'],postponed:['reserved-user'],title:'private title',channelId:'private-channel',token:'private-token'});
  const before=structuredClone(original);
  const current=buildParticipantRecruitmentState({session:original,now});
  assert.deepEqual(Object.keys(current).sort(),['status','reason','maxApplicants','activeApplicants','remainingSlots','unlimited','closeAt','drawCount','duplicatePolicy'].sort());
  assert.equal(Object.values(current).some(Array.isArray),false);
  assert.doesNotMatch(JSON.stringify(current),/sensitive|reserved|private/);
  assert.deepEqual(original,before);
  current.activeApplicants=99;
  assert.equal(buildParticipantRecruitmentState({session:original,now}).activeApplicants,1);
});

test('malformed stored policy, applicant count, draw count, phase or deadline fails closed with 503',()=>{
  const invalidPolicies=[null,undefined,{}, {...DEFAULT_INTAKE_POLICY,maxApplicants:'5'}, {...DEFAULT_INTAKE_POLICY,maxApplicants:1001}, {...DEFAULT_INTAKE_POLICY,closeOnCapacity:true}];
  const invalidSessions=[false,[],{},...invalidPolicies.map(intakePolicy=>session({intakePolicy})),
    ...[null,{},'first',[null],[''],[{}]].map(applicants=>session({applicants})),
    ...[null,{},'first',[null],['']].map(postponed=>session({postponed})),
    ...[undefined,null,'10',0,51,1.5,NaN,Infinity].map(count=>session({count})),
    ...[-1,'10000',NaN,Infinity,0.5].map(closeAt=>session({closeAt})),
    session({phase:'unknown'}),session({phase:'closed',closeReason:'unknown'})];
  for(const malformed of invalidSessions)assert.throws(()=>buildParticipantRecruitmentState({session:malformed,now}),error=>error.status===503);
  for(const invalidTime of [null,-1,NaN,Infinity,'10000'])assert.throws(()=>buildParticipantRecruitmentState({session:session(),now:invalidTime}),error=>error.status===503);
});
