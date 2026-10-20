import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspacePlatform } from '../src/workspace-platform.js';
import { createWorkspaceRuntime } from '../src/workspace-runtime.js';
import { loadConfig } from '../src/config.js';
const A='111111111111111111',B='222222222222222222',owner='333333333333333333';

test('one broken workspace cannot stop healthy workspaces or cause repeated startup work',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'dd-isolated-start-')),client=new EventEmitter(),starts=[],closed=[];
  client.guilds={cache:new Map()};
  const platform=await createWorkspacePlatform({config:{operationsFile:path.join(root,'operations.json'),publicBaseUrl:'https://example.invalid',guildId:owner},client,runtimeFactory:async({entry})=>{
    starts.push(entry.guildId);if(entry.guildId===A)throw Error('unrecoverable fixture data');
    return {context:{config:{}},runtime:{tick:async()=>{},beginShutdown(){}},close:async()=>closed.push(entry.guildId)};
  }});
  t.after(async()=>{await platform.close();await rm(root,{recursive:true,force:true});});
  for(const guildId of [A,B])await platform.registry.ensure({guildId,userId:owner,name:guildId});
  await platform.start();assert.deepEqual(starts,[A,B]);assert.ok(await platform.runtimeFor(B));
  await assert.rejects(platform.runtimeFor(A),e=>e.status===503);assert.deepEqual(starts,[A,B]);
  await platform.registry.update(s=>{s.workspaces.find(w=>w.guildId===B).disabled=true;});
  await assert.rejects(platform.runtimeFor(B),e=>e.status===403);
});

test('global lock blocks workspace timeout and monitors, unlock resumes without losing the current call',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'dd-workspace-lock-'));let locked=false,sends=0;
  const guard=()=>{if(locked)throw Object.assign(Error('global lock fixture'),{status:423});};
  const value=await createWorkspaceRuntime({baseConfig:{...await loadConfig({},['--demo']),publicBaseUrl:'https://example.invalid',multiWorkspaceEnabled:true},entry:{guildId:A,broadcastToken:'a'.repeat(64),settings:{}},root,client:new EventEmitter(),interactionBus:new EventEmitter(),operationGuard:guard});
  t.after(async()=>{await value.close();await rm(root,{recursive:true,force:true});});
  const {participationQueue:queue,participationCalls:calls,discord,naverMonitor,chzzkLiveMonitor}=value.context;
  discord.participationCall=async()=>({id:String(++sends),channelId:'fixture'});
  discord.completeParticipationCall=async()=>{};
  const first=(await queue.register({source:'dashboard',displayName:'first'})).entry;
  await queue.register({source:'dashboard',displayName:'next'});
  await calls.callNext();const raw=queue.read().entries.find(e=>e.id===first.id);
  locked=true;
  await assert.rejects(calls.expireAndAdvance(raw.id,raw.callToken),e=>e.status===423);
  await assert.rejects(naverMonitor.run({force:true}),e=>e.status===423);
  await assert.rejects(chzzkLiveMonitor.run({force:true}),e=>e.status===423);
  await value.runtime.tick();assert.equal(calls.paused,true);assert.equal(sends,1);assert.equal(queue.read().entries.find(e=>e.id===first.id).status,'called');
  locked=false;await value.runtime.tick();assert.equal(calls.paused,false);assert.equal(sends,1);
  value.runtime.beginShutdown('fixture');calls.stop();
});
