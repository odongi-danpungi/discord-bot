import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OperationsStore,applyAction } from '../src/operations.js';
import { CommunityService,participantEntryUrl } from '../src/community.js';
import { handleCommunityInteraction } from '../src/community-discord.js';

const guildA='111111111111111111',guildB='222222222222222222',userId='333333333333333333';
const config=(guildId= guildA,multiWorkspaceEnabled=true)=>({guildId,multiWorkspaceEnabled,publicBaseUrl:'https://bot.example.com'});

async function operationsFor(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'workspace-community-'));
  const operations=await new OperationsStore(path.join(directory,'operations.json')).init();
  t.after(async()=>{await operations.flush();await rm(directory,{recursive:true,force:true});});
  return operations;
}

test('scoped recruitment drafts bind server and round without issuing codes or publishing',async t=>{
  const operations=await operationsFor(t);let sends=0;
  await operations.update(s=>applyAction(s,'open',{game:'lol',mode:'aram',count:2}));
  const service=new CommunityService({operations,config:config(guildB),discord:{communityNotice:async()=>{sends++;}},naver:{writeArticle:async()=>{sends++;}}});
  const draft=await service.draft({kind:'recruitment',topic:'aram'});
  const entry=new URL(draft.content.match(/https:\/\/\S+/)[0]);
  assert.equal(entry.pathname,'/portal/');
  assert.equal(entry.searchParams.get('server'),guildB);
  assert.equal(entry.searchParams.get('session'),operations.read().session.id);
  assert.match(draft.content,/Discord 계정으로 로그인/);
  assert.doesNotMatch(draft.content,/일회용 코드|\/viewer\//);
  assert.equal(sends,0);
});

test('community web opens its own server portal privately and never issues a legacy viewer code',async t=>{
  const operations=await operationsFor(t);let response,issued=0;
  const interaction={customId:'community:web',user:{id:userId},deferReply:async options=>assert.equal(options.flags,64),editReply:async value=>{response=value;}};
  await handleCommunityInteraction(interaction,{operations,config:config(guildB),store:{read:()=>[{guildId:guildB,discordId:userId}]},viewerAuth:{issue:()=>{issued++;throw Error('Legacy code must not be issued');}}});
  assert.match(response.content,new RegExp('/portal/\\?server='+guildB));
  assert.doesNotMatch(response.content,new RegExp(guildA));
  assert.doesNotMatch(response.content,/일회용 코드/);
  assert.deepEqual(response.allowedMentions,{parse:[]});
  assert.equal(issued,0);
});

test('legacy community web preserves the single-use code and original viewer address',async t=>{
  const operations=await operationsFor(t);let response,issued=0;
  const interaction={customId:'community:web',user:{id:userId},deferReply:async()=>{},editReply:async value=>{response=value;}};
  await handleCommunityInteraction(interaction,{operations,config:config(guildA,false),store:{read:()=>[{guildId:guildA,discordId:userId}]},viewerAuth:{issue:id=>{assert.equal(id,userId);issued++;return 'local-test-code';}}});
  assert.match(response.content,/https:\/\/bot.example.com\/viewer\//);
  assert.match(response.content,/일회용 코드: local-test-code/);
  assert.equal(issued,1);
  assert.equal(participantEntryUrl(config(guildA,false),'round one'),'https://bot.example.com/viewer/?session=round+one');
});

test('participant entry URLs reject malformed server IDs and credential-bearing public URLs',()=>{
  assert.throws(()=>participantEntryUrl(config('../outside')),/Discord ID/);
  assert.throws(()=>participantEntryUrl({...config(),publicBaseUrl:'https://username:password@bot.example.com'}),/HTTPS/);
  assert.throws(()=>participantEntryUrl({...config(),publicBaseUrl:'http://bot.example.com'}),/HTTPS/);
  const entry=new URL(participantEntryUrl(config(guildB),'round?server='+guildA));
  assert.equal(entry.searchParams.get('server'),guildB);
  assert.equal(entry.searchParams.get('session'),'round?server='+guildA);
});
