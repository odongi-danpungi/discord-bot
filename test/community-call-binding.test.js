import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OperationsStore } from '../src/operations.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';
import { communityCallButtonId,handleCommunityInteraction } from '../src/community-discord.js';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-community-call-binding-'));
  const operations=await new OperationsStore(path.join(dir,'operations.json')).init();
  await operations.update(state=>{state.rounds={...state.rounds,lol:1};state.session={id:'fixture-session',game:'lol',mode:'aram',round:1,count:1,title:'가상 모집',phase:'closed',closeAt:null,applicants:['a','b'],postponed:[],winners:[],confirmed:[],excluded:[],teams:[],createdAt:1};});
  const queue=await new ParticipationQueueStore(path.join(dir,'queue.json')).init();queue.bindOperations(operations);
  const records=['a','b'].map(discordId=>({guildId:'guild',discordId,chzzkName:`가상${discordId}`,lolRiotId:`Fixture${discordId}#KR1`}));
  await queue.syncOperations({records});
  const sent=[],discord={async participationCall(entry){sent.push(entry.id);return {channelId:'fixture',id:`m${sent.length}`};},async completeParticipationCall(){},async sync(){}};
  const calls=new ParticipationCallService({queue,discord});await calls.callNext();
  const raw=queue.read().entries.find(entry=>entry.status==='called');
  const ctx={operations,config:{guildId:'guild'},store:{read:()=>records},viewerAuth:{},participationQueue:queue,participationCalls:calls,discord};
  async function click(customId,userId='a'){
    let reply;
    const interaction={customId,user:{id:userId},async deferReply(options){assert.equal(options.flags,64);},async editReply(value){reply=value;}};
    assert.equal(await handleCommunityInteraction(interaction,ctx),true);return reply;
  }
  t.after(async()=>{calls.stop();await calls.chain.catch(()=>{});try{await queue.flush();await operations.flush();}finally{await rm(dir,{recursive:true,force:true});}});
  return {operations,queue,calls,raw,sent,click};
}

const changed=error=>error.status===409&&error.statusCode===409&&/최신 호출/.test(error.message);
const buttons=reply=>reply.components.flatMap(row=>row.components);

test('community call button IDs fit Discord limits and bind session, entry and attempt without the private Queue token',()=>{
  const entry={id:'entry',callAttempt:2,sessionId:'queue-session',callToken:'private-call-token'};
  for(const action of ['join','pass']){
    const id=communityCallButtonId(action,'ops-session',entry);
    assert.match(id,new RegExp(`^community:call:${action}:[a-f0-9]{64}$`));
    assert.ok(Buffer.byteLength(id,'utf8')<=100);assert.ok(!id.includes(entry.callToken));
    assert.equal(id,communityCallButtonId(action,'ops-session',{...entry,callToken:'another-token'}));
    for(const [session,next] of [['next-session',entry],['ops-session',{...entry,id:'next-entry'}],['ops-session',{...entry,callAttempt:3}],['ops-session',{...entry,sessionId:'next-queue-session'}]])assert.notEqual(id,communityCallButtonId(action,session,next));
  }
  assert.equal(communityCallButtonId('join',undefined,{...entry,sessionId:undefined}),communityCallButtonId('join',null,{...entry,sessionId:null}));
  assert.throws(()=>communityCallButtonId('other','ops-session',entry),TypeError);
});

test('community home emits attempt-bound call buttons while retaining the other personal menu buttons',async t=>{
  const f=await fixture(t),reply=await f.click('community:home'),ids=buttons(reply).map(button=>button.custom_id);
  assert.ok(ids.includes(communityCallButtonId('join','fixture-session',f.raw)));
  assert.ok(ids.includes(communityCallButtonId('pass','fixture-session',f.raw)));
  assert.ok(ids.includes('community:web'));assert.ok(ids.includes('community:history'));assert.ok(ids.includes('community:tickets'));
  assert.ok(!ids.some(id=>id.startsWith('community:act:call_')));
  assert.doesNotMatch(JSON.stringify(reply),new RegExp(f.raw.callToken));
});

test('community same-attempt join accepts only the clicked participant call',async t=>{
  const f=await fixture(t),before=f.operations.read();
  await f.click(communityCallButtonId('join','fixture-session',f.raw));
  assert.equal(f.queue.read().entries.find(entry=>entry.id===f.raw.id).status,'joined');
  assert.deepEqual(f.operations.read(),before);assert.equal(f.sent.length,1);
});

test('community same-attempt pass after close makes one reservation and one next call',async t=>{
  const f=await fixture(t),id=communityCallButtonId('pass','fixture-session',f.raw);
  await f.click(id);
  assert.deepEqual(f.operations.read().reservations,[{game:'lol',userId:'a',round:2}]);
  assert.equal(f.queue.read().entries.find(entry=>entry.id===f.raw.id).status,'postponed_next');
  assert.equal(f.queue.summary().currentCall.discordUserId,'b');assert.equal(f.sent.length,2);
  const before=f.queue.read();await assert.rejects(f.click(id),changed);
  assert.deepEqual(f.queue.read(),before);assert.equal(f.sent.length,2);assert.equal(f.operations.read().reservations.length,1);
});

test('community buttons from a previous attempt cannot answer a recalled call',async t=>{
  const f=await fixture(t),oldIds=['join','pass'].map(action=>communityCallButtonId(action,'fixture-session',f.raw));
  await f.calls.recall(f.raw.id);
  const before=f.queue.read(),beforeOps=f.operations.read(),fresh=before.entries.find(entry=>entry.id===f.raw.id);
  assert.equal(fresh.callAttempt,f.raw.callAttempt+1);
  for(const id of oldIds)await assert.rejects(f.click(id),changed);
  assert.deepEqual(f.queue.read(),before);assert.deepEqual(f.operations.read(),beforeOps);assert.equal(f.sent.length,2);
  const reply=await f.click('community:home'),ids=buttons(reply).map(button=>button.custom_id);
  assert.ok(ids.includes(communityCallButtonId('join','fixture-session',fresh)));
  assert.ok(!ids.some(id=>oldIds.includes(id)));
  await f.click(communityCallButtonId('join','fixture-session',fresh));
  assert.equal(f.queue.read().entries.find(entry=>entry.id===fresh.id).status,'joined');
});

test('community buttons bind the current Operations session even before Queue sync',async t=>{
  const f=await fixture(t),ids=['join','pass'].map(action=>communityCallButtonId(action,'fixture-session',f.raw));
  await f.operations.update(state=>{state.session.id='replacement-session';});
  const before=f.queue.read(),beforeOps=f.operations.read();
  for(const id of ids)await assert.rejects(f.click(id),changed);
  assert.deepEqual(f.queue.read(),before);assert.deepEqual(f.operations.read(),beforeOps);assert.equal(f.sent.length,1);
});

for(const field of ['id','sessionId'])test(`community old buttons reject a changed Queue ${field}`,async t=>{
  const f=await fixture(t),ids=['join','pass'].map(action=>communityCallButtonId(action,'fixture-session',f.raw));
  await f.queue.update(state=>{state.entries.find(entry=>entry.id===f.raw.id)[field]=`replacement-${field}`;});
  const before=f.queue.read(),beforeOps=f.operations.read();
  for(const id of ids)await assert.rejects(f.click(id),changed);
  assert.deepEqual(f.queue.read(),before);assert.deepEqual(f.operations.read(),beforeOps);assert.equal(f.sent.length,1);
});

test('community call digest never authorizes another Discord user or a non-Discord source',async t=>{
  const f=await fixture(t),ids=['join','pass'].map(action=>communityCallButtonId(action,'fixture-session',f.raw));
  const before=f.queue.read(),beforeOps=f.operations.read();
  for(const id of ids)await assert.rejects(f.click(id,'b'),changed);
  assert.deepEqual(f.queue.read(),before);
  await f.queue.update(state=>{state.entries.find(entry=>entry.id===f.raw.id).source='naver';});
  const nonDiscord=f.queue.read();
  for(const id of ids)await assert.rejects(f.click(id),changed);
  assert.deepEqual(f.queue.read(),nonDiscord);assert.deepEqual(f.operations.read(),beforeOps);assert.equal(f.sent.length,1);
});

test('legacy unbound call buttons and malformed new IDs fail closed with a refresh explanation',async t=>{
  const f=await fixture(t),before=f.queue.read(),beforeOps=f.operations.read();
  const valid=communityCallButtonId('join','fixture-session',f.raw);
  for(const id of ['community:act:call_join:fixture-session','community:act:call_pass:fixture-session','community:act:call_join:old-session','community:call:join:',valid+':extra',valid.replace('join:','invalid:'),valid.toUpperCase().replace('COMMUNITY:CALL:JOIN:','community:call:join:')])await assert.rejects(f.click(id),changed);
  assert.deepEqual(f.queue.read(),before);assert.deepEqual(f.operations.read(),beforeOps);assert.equal(f.sent.length,1);
});

test('community response pins the private token so a recall during service dispatch cannot consume the new attempt',async t=>{
  const f=await fixture(t),original=f.calls.respond.bind(f.calls);let afterRecall;
  f.calls.respond=async input=>{
    assert.equal(input.token,f.raw.callToken);
    await f.calls.recall(f.raw.id);afterRecall=f.queue.read();
    return original(input);
  };
  await assert.rejects(f.click(communityCallButtonId('join','fixture-session',f.raw)),/이미 종료되었거나 갱신/);
  assert.deepEqual(f.queue.read(),afterRecall);assert.equal(f.sent.length,2);assert.deepEqual(f.operations.read().reservations,[]);
});
