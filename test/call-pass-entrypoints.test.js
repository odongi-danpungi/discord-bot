import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Events, MessageFlags } from 'discord.js';
import { OperationsStore } from '../src/operations.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';
import { installInteractions } from '../src/interactions.js';
import { communityCallButtonId } from '../src/community-discord.js';

async function fixture(t,phase='closed'){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-pass-discord-'));
  const operations=new OperationsStore(path.join(dir,'operations.json'));await operations.init();
  await operations.update(state=>{state.rounds={...state.rounds,lol:1};state.session={id:'fixture-session',game:'lol',mode:'aram',round:1,count:1,title:'가상 모집',phase,closeAt:null,applicants:['a','b','c'],postponed:[],winners:phase==='drawn'?['a']:[],confirmed:[],excluded:[],teams:[],createdAt:1};});
  const queue=new ParticipationQueueStore(path.join(dir,'queue.json'));await queue.init();queue.bindOperations(operations);
  const records=['a','b','c'].map(discordId=>({guildId:'guild',discordId,chzzkName:`가상${discordId}`,lolRiotId:`Fixture${discordId}#KR1`}));
  await queue.syncOperations({records});
  const sent=[],discord={async participationCall(entry){sent.push(entry.id);return {channelId:'fixture',id:`m${sent.length}`};},async completeParticipationCall(){},async sync(){}};
  const calls=new ParticipationCallService({queue,discord});await calls.callNext();
  const client=new EventEmitter(),emergency={locked:false};
  const cleanup=installInteractions({client,config:{guildId:'guild',workspaceScoped:true},store:{read:()=>records},operations,discord,viewerAuth:{},participationQueue:queue,participationCalls:calls,emergencyState:()=>emergency});
  const handler=client.listeners(Events.InteractionCreate)[0];
  const raw=queue.read().entries.find(entry=>entry.status==='called');
  async function click({userId='a',action='pass',guildId='guild',token=raw.callToken,customId}={}){
    const replies=[],interaction={guildId,user:{id:userId,username:'fixture'},customId:customId||`queuecall:${action}:${raw.id}:${token}`,deferred:false,replied:false,
      isButton:()=>true,isChatInputCommand:()=>false,isModalSubmit:()=>false,
      async deferReply(payload){assert.equal(payload.flags,MessageFlags.Ephemeral);this.deferred=true;},
      async editReply(payload){replies.push(typeof payload==='string'?payload:payload.content);this.replied=true;},
      async reply(payload){assert.equal(payload.flags,MessageFlags.Ephemeral);replies.push(payload.content);this.replied=true;},
      async followUp(payload){replies.push(payload.content);}};
    await handler(interaction);return replies;
  }
  t.after(async()=>{cleanup();calls.stop();await calls.chain.catch(()=>{});try{await queue.flush();await operations.flush();}finally{await rm(dir,{recursive:true,force:true});}});
  return {operations,queue,calls,raw,sent,click,emergency};
}

test('Discord private pass button books after close, advances once, and replays the old button without calling a third participant',async t=>{
  const f=await fixture(t);
  assert.match((await f.click())[0],/패스 처리/);
  assert.deepEqual(f.operations.read().reservations,[{game:'lol',userId:'a',round:2}]);
  assert.equal(f.operations.read().session.phase,'closed');assert.equal(f.sent.length,2);
  const next=f.queue.read().entries.find(entry=>entry.status==='called');assert.equal(next.discordUserId,'b');
  await f.calls.respond({entryId:next.id,userId:'b',token:next.callToken,action:'join'});
  assert.match((await f.click())[0],/이미 저장된 패스/);
  assert.equal(f.sent.length,2);assert.equal(f.queue.summary().currentCall,null);
  assert.equal(f.operations.read().reservations.length,1);
});

test('Discord private pass button denies another participant, foreign guild, stale token and emergency lock without booking',async t=>{
  const f=await fixture(t),before=f.operations.read();
  assert.match((await f.click({userId:'b'}))[0],/호출된 참가자만/);
  assert.deepEqual(await f.click({guildId:'foreign'}),[]);
  assert.match((await f.click({token:'stale'}))[0],/이미 종료되었거나 갱신/);
  f.emergency.locked=true;assert.match((await f.click())[0],/긴급 잠금/);
  assert.deepEqual(f.operations.read(),before);assert.equal(f.sent.length,1);
});

test('Discord pass after draw preserves outcomes and gives a conflict explanation while call join remains available',async t=>{
  const f=await fixture(t,'drawn'),before=f.operations.read();
  assert.match((await f.click())[0],/현재 모집과 호출 상태/);
  assert.deepEqual(f.operations.read(),before);assert.equal(f.sent.length,1);
  assert.match((await f.click({action:'join'}))[0],/참가 확인 완료/);
  assert.deepEqual(f.operations.read(),before);
});

test('Discord call response masks unclassified internal error details',async t=>{
  const f=await fixture(t),original=f.calls.respond;
  try{
    for(const error of [Error('secret=fixture-do-not-expose C:/private/file.json'),Object.assign(Error('secret=fixture-do-not-expose'),{status:503}),Object.assign(Error('C:/private/file.json'),{code:'EIO'})]){
      f.calls.respond=async()=>{throw error;};
      const replies=await f.click();assert.doesNotMatch(JSON.stringify(replies),/fixture-do-not-expose|private\/file/);
      assert.match(replies[0],/호출 응답을 처리하지 못|데이터 저장소/);
    }
    assert.equal(f.operations.read().reservations.length,0);assert.equal(f.sent.length,1);
  }finally{f.calls.respond=original;}
});

test('Discord community participant call buttons also mask internal pass and join errors',async t=>{
  const f=await fixture(t),original=f.calls.respond;
  try{
    for(const action of ['call_pass','call_join'])for(const status of [undefined,503]){
      f.calls.respond=async()=>{throw Object.assign(Error('secret=fixture-community-private C:/private/file.json'),status?{status}:{});};
      const replies=await f.click({customId:communityCallButtonId(action==='call_pass'?'pass':'join','fixture-session',f.raw)});
      assert.match(replies[0],/호출 응답을 처리하지 못/);assert.doesNotMatch(JSON.stringify(replies),/fixture-community-private|private\/file/);
    }
    assert.equal(f.operations.read().reservations.length,0);assert.equal(f.sent.length,1);
  }finally{f.calls.respond=original;}
});
