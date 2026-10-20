import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/workspace-store.js';
import { workspaceDirectory, workspaceRouteAllowed, workspacePublicSnapshot } from '../src/workspace-policy.js';
import { buildProductionEnvironmentValidation } from '../src/production-environment.js';

const guildA='111111111111111111',guildB='222222222222222222',owner='333333333333333333';
test('workspace environment gate blocks missing or reused OAuth secrets without exposing their values',()=>{
  const config={profile:'production',multiWorkspaceEnabled:true,publicBaseUrl:'https://bot.example.invalid/'};
  const missing=buildProductionEnvironmentValidation({config});assert.equal(missing.checks.find(c=>c.id==='workspace-login').status,'fail');
  const fixture='fixture-distinct-oauth-secret',valid=buildProductionEnvironmentValidation({config:{...config,discordClientSecret:fixture}});
  assert.equal(valid.checks.find(c=>c.id==='workspace-login').status,'pass');assert.equal(JSON.stringify(valid).includes(fixture),false);
  const reused=buildProductionEnvironmentValidation({config:{...config,discordClientSecret:fixture,dashboardPassword:fixture}});assert.equal(reused.checks.find(c=>c.id==='secret-reuse').status,'fail');
});
test('workspace creation is atomic, isolated, restartable and never exposes OBS tokens in the public registry',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dd-workspace-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new WorkspaceStore(path.join(dir,'registry.json'));await store.init();
  await Promise.all(Array.from({length:10},()=>store.ensure({guildId:guildA,userId:owner,name:'A'})));
  await store.ensure({guildId:guildB,userId:owner,name:'B'});
  assert.equal(store.read().workspaces.length,2);
  await store.configure(guildA,{naverCafeId:'123'});
  assert.equal(store.find(guildA).settings.naverCafeId,'123');
  assert.deepEqual(store.find(guildB).settings,{});
  assert.notEqual(store.find(guildA).broadcastToken,store.find(guildB).broadcastToken);
  assert.doesNotMatch(JSON.stringify(store.publicList()),/broadcastToken|createdBy|333333333333333333/);
  await assert.rejects(store.configure(guildA,{chzzkClientSecret:'forbidden'}),/변경할 수 없는/);
  await assert.rejects(store.configure(guildA,{naverCafeId:'../other'}),/숫자/);
  const restored=new WorkspaceStore(path.join(dir,'registry.json'));await restored.init();
  assert.deepEqual(restored.read(),store.read());
});
test('workspace paths reject traversal and arbitrary directory identifiers',()=>{
  for(const id of ['../data','/tmp','C:\\data',guildA+'/..','',null,'123'])assert.throws(()=>workspaceDirectory(tmpdir(),id));
  assert.notEqual(workspaceDirectory(tmpdir(),guildA),workspaceDirectory(tmpdir(),guildB));
});
test('workspace operation policy defaults to deny creator diagnostics and maintenance even for GET and encoded paths',()=>{
  for(const route of ['/api/release/apply','/api/recovery/restore','/api/runtime','/api/settings','/api/environment','/api/connector-verification/probe','/api/production-monitoring','/index.html','/app.js','/api/%72untime','/api//snapshot']){
    for(const method of ['GET','POST','PUT','DELETE'])assert.equal(workspaceRouteAllowed(method,route),false,method+' '+route);
  }
  assert.equal(workspaceRouteAllowed('GET','/api/snapshot'),true);
  assert.equal(workspaceRouteAllowed('POST','/api/participation-queue/q_test/status'),true);
  assert.equal(workspaceRouteAllowed('POST','/api/community/publish'),true);
  assert.equal(workspaceRouteAllowed('POST','/api/community/unknown'),false);
});
test('workspace snapshots omit creator deployment and recovery fields',()=>{
  const input={state:{safeDeploy:{private:true},session:{id:'round1'}},records:[],runtime:{secret:'private'},policyMonitor:{secret:true},csrf:'test-csrf',emergency:{locked:true}};
  const out=workspacePublicSnapshot(input,{user:owner,guildId:guildA});
  assert.deepEqual(out.state,{session:{id:'round1'}});assert.equal(out.paused,true);
  assert.equal(out.access.guildId,guildA);assert.doesNotMatch(JSON.stringify(out),/private|policyMonitor|safeDeploy/);
  assert.equal(input.state.safeDeploy.private,true);
});
