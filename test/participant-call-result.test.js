import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipantCallResponse } from '../src/participant-call-result.js';
import { callPassId } from '../src/call-pass.js';

function fixture({pending=false}={}){
  const entry={id:'own-entry',source:'discord',discordUserId:'own-user',sessionId:'own-session',game:'lol',mode:'aram',round:3,callAttempt:2,status:'postponed_next',callToken:'private-current-token',callDeadline:0};
  const receipt={id:callPassId(entry.id,'private-original-token'),entryId:entry.id,userId:entry.discordUserId,sessionId:entry.sessionId,game:entry.game,round:entry.round,targetRound:4,attempt:entry.callAttempt,deadline:2000,createdAt:1000,appliedAt:pending?null:1100};
  const operationsState={session:{id:entry.sessionId,game:entry.game,round:entry.round,phase:'closed',postponed:['own-user']},reservations:[{game:'lol',userId:'own-user',round:4}],callPassReceipts:[receipt]};
  return {operationsState,entry,userId:'own-user',receipt};
}

test('own retained pass acknowledgement yields only the explicit historical result fields',()=>{
  const f=fixture(),before=structuredClone(f),result=buildParticipantCallResponse(f);
  assert.deepEqual(result,{action:'pass',state:'recorded',sessionId:'own-session',game:'lol',round:3,targetRound:4,attempt:2,recordedAt:1000,confirmedAt:1100});
  assert.doesNotMatch(JSON.stringify(result),/private|own-user|own-entry|receipt|token|targetId|displayName|deadline/i);
  assert.deepEqual(f,before);
});

test('pending receipt remains confirming after the call response deadline passes',()=>{
  const f=fixture({pending:true});f.entry.status='called';f.entry.callDeadline=1;
  const before=structuredClone(f),result=buildParticipantCallResponse(f);
  assert.equal(result.state,'confirming');assert.equal(result.confirmedAt,null);
  assert.deepEqual(f,before,'reading pending acceptance must not project or acknowledge it');
});

test('ack failure is conservatively confirming even when Queue already has the projected status',()=>{
  const f=fixture({pending:true});f.entry.status='postponed_next';
  assert.equal(buildParticipantCallResponse(f).state,'confirming');
});

test('later reservation cancellation does not rewrite the historical accepted response',()=>{
  const f=fixture();f.operationsState.reservations=[];f.operationsState.session.postponed=[];f.entry.status='waiting';
  const before=structuredClone(f),result=buildParticipantCallResponse(f);
  assert.equal(result.state,'recorded');assert.equal(result.targetRound,4);
  assert.deepEqual(f.operationsState.reservations,[]);assert.deepEqual(f,before);
});

test('a consumed reservation and reused Queue ID cannot confirm a new round',()=>{
  const f=fixture();f.operationsState.reservations=[];f.operationsState.session={...f.operationsState.session,id:'next-session',round:4};f.entry.sessionId='next-session';f.entry.round=4;f.entry.status='waiting';
  assert.equal(buildParticipantCallResponse(f),null);
});

test('the same ended session can display its historical pass without inventing a live reservation',()=>{
  const f=fixture();f.operationsState.session.phase='ended';f.operationsState.reservations=[];
  assert.equal(buildParticipantCallResponse(f).state,'recorded');assert.deepEqual(f.operationsState.reservations,[]);
});

test('a stale Queue from an earlier Operations session cannot confirm the current session',()=>{
  const f=fixture();f.operationsState.session={...f.operationsState.session,id:'new-session',round:4};
  assert.equal(buildParticipantCallResponse(f),null);
  f.operationsState.session=null;assert.equal(buildParticipantCallResponse(f),null);
});

for(const field of ['id','sessionId','game','round','callAttempt'])test(`an exact receipt mismatch on ${field} yields unknown`,()=>{
  const f=fixture();f.entry[field]=field==='round'||field==='callAttempt'?99:field==='game'?'er':`other-${field}`;
  if(field==='sessionId')f.operationsState.session.id=f.entry.sessionId;
  if(field==='game')f.operationsState.session.game=f.entry.game;
  if(field==='round')f.operationsState.session.round=f.entry.round;
  assert.equal(buildParticipantCallResponse(f),null);
});

test('a recalled attempt does not reuse an older completed response and keeps the current call untouched',()=>{
  const f=fixture();f.entry.callAttempt++;f.entry.status='called';f.entry.callToken='new-private-token';f.entry.callDeadline=Date.now()+60_000;
  const before=structuredClone(f);assert.equal(buildParticipantCallResponse(f),null);assert.deepEqual(f,before);
});

test('pending older attempts do not replace the exact current attempt result',()=>{
  const f=fixture();f.operationsState.callPassReceipts.unshift({...f.receipt,id:callPassId(f.entry.id,'older-token'),attempt:1,appliedAt:null});
  assert.equal(buildParticipantCallResponse(f).state,'recorded');
});

test('a different authenticated user or non-Discord source never receives another participant result',()=>{
  const f=fixture();assert.equal(buildParticipantCallResponse({...f,userId:'other-user'}),null);
  f.entry.source='naver';assert.equal(buildParticipantCallResponse(f),null);
  f.entry.source='dashboard';assert.equal(buildParticipantCallResponse(f),null);
});

test('another owner receipt with the same context is unknown rather than accepted for this user',()=>{
  const f=fixture();f.receipt.userId='other-user';assert.equal(buildParticipantCallResponse(f),null);
});

test('missing legacy field or a pruned completed receipt is unknown rather than failed',()=>{
  const f=fixture();delete f.operationsState.callPassReceipts;assert.equal(buildParticipantCallResponse(f),null);
  f.operationsState.callPassReceipts=[];assert.equal(buildParticipantCallResponse(f),null);
  assert.equal(buildParticipantCallResponse(),null);
});

test('missing participant or session context is unknown without reading unrelated records',()=>{
  const f=fixture();
  for(const input of [{...f,entry:null},{...f,userId:''},{...f,userId:null},{...f,operationsState:null},{...f,operationsState:{}}])assert.equal(buildParticipantCallResponse(input),null);
  const unrelated={session:{id:'different-session'},callPassReceipts:null};
  assert.equal(buildParticipantCallResponse({...f,operationsState:unrelated}),null);
});

test('missing or invalid current call attempt cannot identify an older accepted response',()=>{
  for(const attempt of [undefined,null,0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1]){
    const f=fixture();f.entry.callAttempt=attempt;
    assert.equal(buildParticipantCallResponse(f),null);
  }
});

test('an inherited receipt field does not turn legacy absence into an accepted result',()=>{
  const f=fixture(),state=Object.assign(Object.create({callPassReceipts:f.operationsState.callPassReceipts}),{session:f.operationsState.session});
  assert.equal(buildParticipantCallResponse({...f,operationsState:state}),null);
});

for(const malformed of ['extra-secret','duplicate-id','null-list','invalid-round','invalid-ack'])test(`malformed ${malformed} receipt produces a fixed generic 503 without exposing details`,()=>{
  const f=fixture();
  if(malformed==='extra-secret')f.receipt.secret='private-original-token';
  if(malformed==='duplicate-id')f.operationsState.callPassReceipts.push(structuredClone(f.receipt));
  if(malformed==='null-list')f.operationsState.callPassReceipts=null;
  if(malformed==='invalid-round')f.receipt.targetRound=99;
  if(malformed==='invalid-ack')f.receipt.appliedAt=1;
  const before=structuredClone(f);
  assert.throws(()=>buildParticipantCallResponse(f),error=>error.status===503&&error.statusCode===503&&error.code==='participant_call_result_unavailable'&&!/private|token|own-user|own-entry/.test(error.message));
  assert.deepEqual(f,before);
});

test('two distinct receipts for the same call attempt are a conflict, never a guessed success',()=>{
  const f=fixture();f.operationsState.callPassReceipts.push({...f.receipt,id:callPassId(f.entry.id,'conflicting-private-token'),appliedAt:null});
  assert.throws(()=>buildParticipantCallResponse(f),error=>error.status===503&&error.code==='participant_call_result_unavailable');
});

test('a pure read works with deeply frozen state and the returned object cannot mutate persistence',()=>{
  const f=fixture(),freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};freeze(f);
  const result=buildParticipantCallResponse(f);result.state='changed';result.targetRound=99;
  assert.equal(f.receipt.targetRound,4);assert.equal(f.receipt.appliedAt,1100);assert.equal(buildParticipantCallResponse(f).state,'recorded');
});
