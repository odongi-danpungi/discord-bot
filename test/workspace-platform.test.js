import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspacePlatform } from '../src/workspace-platform.js';
import { loadConfig } from '../src/config.js';

const A='111111111111111111',B='222222222222222222',owner='333333333333333333',person='444444444444444444';
async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-platform-')),client=new EventEmitter(),roles=new Map([[owner,true],[person,false]]),deniedMembers=new Set();
  client.guilds={cache:new Map([[A,{}],[B,{}]]),async fetch(id){return {id,name:id===A?'방송 A':'방송 B',ownerId:'999999999999999999',members:{async fetch({user}){if(!roles.has(user)||deniedMembers.has(id+':'+user))throw Error('not member');return {user:{bot:false},permissions:{has:()=>roles.get(user)}};}}};}};
  const config={...await loadConfig({},['--demo']),multiWorkspaceEnabled:true,publicBaseUrl:'http://127.0.0.1',operationsFile:path.join(dir,'operations.json'),guildId:'555555555555555555',clientId:'666666666666666666',discordClientSecret:'fixture-secret',dashboardPassword:'fixture-password-123',host:'127.0.0.1'};
  const platform=await createWorkspacePlatform({config,client,fetchImpl:async(url,opts)=>{
    let data;if(url.endsWith('/oauth2/token'))data={access_token:new URLSearchParams(opts.body).get('code'),token_type:'Bearer'};
    else if(url.endsWith('/users/@me'))data={id:opts.headers.Authorization.slice(7),username:'가상 사용자'};
    else data=[{id:A,name:'방송 A'},{id:B,name:'방송 B'}];
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  }});
  const server=platform.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await platform.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  async function login(user){const start=await fetch(base+'/portal/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state'),cookie=start.headers.getSetCookie()[0].split(';')[0];
    const done=await fetch(base+'/portal/auth/callback?state='+state+'&code='+user,{headers:{cookie},redirect:'manual'});assert.equal(done.status,303);
    const sessionCookie=done.headers.getSetCookie().find(x=>x.startsWith('dd_portal=')).split(';')[0];
    const session=await(await fetch(base+'/portal/auth/session',{headers:{cookie:sessionCookie}})).json();
    return {cookie:sessionCookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};
  }
  return {platform,base,roles,deniedMembers,login,client,config,request:async(url,headers,body)=>fetch(base+url,{headers,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})})};
}
test('real workspace runtimes isolate operations, participants, CSRF and creator APIs',async t=>{
  const f=await fixture(t),admin=await f.login(owner),participant=await f.login(person);
  assert.equal((await f.request('/portal/api/servers/'+A,participant,{})).status,403);
  for(const id of [A,B]){const r=await f.request('/portal/api/servers/'+id,admin,{});assert.equal(r.status,200,await r.text());}
  assert.equal(f.client.listenerCount('interactionCreate'),1);
  assert.equal((await f.request('/w/'+A+'/settings',admin,{naverCafeId:'123'})).status,200);
  assert.equal((await(await f.request('/w/'+B+'/settings',admin)).json()).settings.naverCafeId,'');
  const added=await f.request('/w/'+A+'/api/participation-queue/register',admin,{displayName:'A만의 참가자'});assert.equal(added.status,200,await added.text());
  const a=await(await f.request('/w/'+A+'/api/snapshot',admin)).json(),b=await(await f.request('/w/'+B+'/api/snapshot',admin)).json();
  assert.equal(a.participationQueue.entries.length,1);assert.equal(b.participationQueue.entries.length,0);assert.equal(a.csrf,admin['X-CSRF-Token']);
  assert.equal(a.access.role,'workspace');assert.equal(a.runtime,undefined);assert.equal(a.state.safeDeploy,undefined);
  for(const route of ['/api/release','/api/runtime','/api/recovery','/index.html','/app.js'])assert.equal((await f.request('/w/'+A+route,admin)).status,route.endsWith('.html')||route.endsWith('.js')?404:403,route);
  assert.equal((await f.request('/w/'+A+'/api/snapshot',participant)).status,403);
  assert.equal((await f.request('/w/'+A+'/api/participation-queue/register',{...admin,'X-CSRF-Token':'bad'},{displayName:'blocked'})).status,403);
  assert.equal((await f.request('/w/'+A+'/api/participation-queue/register',{...admin,Origin:'https://untrusted.invalid'},{displayName:'blocked'})).status,403);
  const role=await(await f.request('/portal/api/servers/'+A,participant)).json();assert.equal(role.role,'participant');
  let globallyPaused=true;
  f.platform.registerLegacy({context:{config:{}},runtime:{operationGuard:()=>{if(globallyPaused)throw Object.assign(Error('global pause fixture'),{status:423});}}});
  assert.equal((await(await f.request('/w/'+A+'/api/snapshot',admin)).json()).paused,true,'operator home must reflect a creator-wide pause');
  globallyPaused=false;
  assert.equal((await(await f.request('/w/'+A+'/api/snapshot',admin)).json()).paused,false);
  f.roles.set(owner,false);assert.equal((await f.request('/w/'+A+'/settings',admin,{naverCafeId:'999'})).status,403);
});

async function prepareParticipants(f){
  const admin=await f.login(owner),participant=await f.login(person),contexts={};
  for(const id of [A,B]){
    const response=await f.request('/portal/api/servers/'+id,admin,{});assert.equal(response.status,200,await response.text());
    const {context}=await f.platform.runtimeFor(id);contexts[id]=context;
    for(const userId of [owner,person])await context.store.upsert({guildId:id,discordId:userId,chzzkName:id+'-'+userId,lolRiotId:'가상참가자#KR1'});
    await context.operations.update(state=>{state.reservations=[{userId:owner,game:'lol',round:3},{userId:person,game:'lol',round:4}];});
  }
  return {admin,participant,contexts};
}

test('participant views and mutations use the authenticated identity even when another user or workspace is supplied',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  const profile=await(await f.request('/w/'+A+'/viewer/api/me?userId='+owner+'&guildId='+B,participant)).json();
  assert.equal(profile.userId,person);assert.equal(profile.name,A+'-'+person);assert.equal(profile.csrf,participant['X-CSRF-Token']);
  const before=await(await f.request('/w/'+A+'/viewer/api/participation?userId='+owner,participant)).json();
  assert.deepEqual(before.reservations,[{game:'lol',round:4}]);assert.equal(JSON.stringify(before).includes(owner),false);
  const headers={...participant,'Idempotency-Key':'same-participant-action-0001'};
  const body={action:'cancel_reservation',game:'lol',userId:owner,guildId:B};
  const result=await f.request('/w/'+A+'/viewer/api/participation/action',headers,body);assert.equal(result.status,200,await result.text());
  assert.deepEqual(contexts[A].operations.read().reservations,[{userId:owner,game:'lol',round:3}]);
  assert.equal(contexts[B].operations.read().reservations.length,2,'A action must not mutate B');
  // Both portal users lack a legacy viewer cookie. Their CSRF-bound idempotency scopes
  // must still remain separate, including when a client reuses the same action key.
  const ownerResult=await f.request('/w/'+A+'/viewer/api/participation/action',{...admin,'Idempotency-Key':'same-participant-action-0001'},body);
  assert.equal(ownerResult.status,200,await ownerResult.text());assert.equal(contexts[A].operations.read().reservations.length,0);
  const other=await(await f.request('/w/'+B+'/viewer/api/me',participant)).json();assert.equal(other.name,B+'-'+person);
});

test('participant mutations require CSRF and fresh membership, and cannot use legacy login or operator routes',async t=>{
  const f=await fixture(t),{participant,contexts}=await prepareParticipants(f);
  const body={action:'cancel_reservation',game:'lol'};
  for(const headers of [{...participant,'X-CSRF-Token':'wrong'},{...participant,Origin:'https://attacker.invalid'},{...participant,'Sec-Fetch-Site':'cross-site'}]){
    assert.equal((await f.request('/w/'+A+'/viewer/api/participation/action',headers,body)).status,403);
  }
  for(const route of ['/settings','/obs','/api/snapshot','/api/participation-queue'])assert.equal((await f.request('/w/'+A+route,participant)).status,403,route);
  for(const route of ['login','demo-login','logout'])assert.equal((await f.request('/w/'+A+'/viewer/api/'+route,participant,{})).status,403,route);
  assert.equal(contexts[A].operations.read().reservations.length,2);
  assert.equal((await f.request('/w/'+A+'/viewer/api/me',participant)).status,200,'populate read membership cache');
  f.deniedMembers.add(A+':'+person);
  assert.equal((await f.request('/w/'+A+'/viewer/api/participation/action',participant,body)).status,403,'writes must recheck membership instead of trusting the cached read');
  assert.equal(contexts[A].operations.read().reservations.length,2);
  assert.equal((await f.request('/w/'+B+'/viewer/api/participation/action',participant,body)).status,200,'membership in another server remains independent');
});

test('workspace routing rejects untrusted guild membership, encoded creator routes, and another workspace OBS token',async t=>{
  const f=await fixture(t),{admin,participant}=await prepareParticipants(f);
  f.deniedMembers.add(B+':'+person);
  for(const route of ['/viewer/api/me','/viewer/api/participation','/api/snapshot'])assert.equal((await f.request('/w/'+B+route,participant)).status,403,route);
  for(const route of ['/api/%72untime','/api/release%2fapply','/api//recovery','/api/snapshot%2f..%2frecovery'])assert.equal((await f.request('/w/'+A+route,admin)).status,403,route);
  const obsA=await(await f.request('/w/'+A+'/obs',admin)).json(),obsB=await(await f.request('/w/'+B+'/obs',admin)).json();
  const tokenA=new URL(obsA.url).searchParams.get('token'),tokenB=new URL(obsB.url).searchParams.get('token');assert.notEqual(tokenA,tokenB);
  assert.equal((await f.request('/w/'+B+'/broadcast/overlay?token='+tokenA,{})).status,403);
  assert.equal((await f.request('/w/'+B+'/broadcast/overlay?token='+tokenB,{})).status,200);
  assert.equal((await f.request('/w/'+A+'/broadcast/overlay',{})).status,403);
});

test('creator workspace management requires the original dashboard administrator and preserves child CSRF boundaries',async t=>{
  const f=await fixture(t),{admin,participant,contexts}=await prepareParticipants(f);
  // Use a real app's creatorIdentity implementation. Portal identities and the
  // user-controlled headers below must never manufacture its admin role.
  await f.platform.registry.ensure({guildId:f.config.guildId,userId:owner,name:'제작자 방송'});
  const legacy=await f.platform.runtimeFor(f.config.guildId);
  legacy.context.config.dashboardOperatorUser='fixture-operator';
  legacy.context.config.dashboardOperatorPassword='fixture-operator-password';
  // Production creates the legacy app before the platform, so its guard is
  // independent. Avoid a synthetic parent-to-itself loop in this fixture.
  legacy.runtime.operationGuard=()=>{};
  let identityChecks=0;
  const creatorIdentity=legacy.runtime.creatorIdentity;
  legacy.runtime.creatorIdentity=req=>{identityChecks++;return creatorIdentity(req);};
  f.platform.registerLegacy(legacy);
  const basic=(user,password)=>({Authorization:'Basic '+Buffer.from(user+':'+password).toString('base64')});
  const creator=basic(legacy.context.config.dashboardUser,legacy.context.config.dashboardPassword);
  const delegate=basic('fixture-operator','fixture-operator-password');
  const headersToReject=[{},admin,participant,delegate,{...admin,'X-Role':'admin','X-Dashboard-Role':'admin','X-User-Id':owner}];
  for(const headers of headersToReject){
    for(const route of ['/creator/api/workspaces','/creator/workspaces/'+A+'/api/recovery','/creator/workspaces/'+A+'/api/snapshot']){
      assert.equal((await f.request(route,headers)).status,403,route);
    }
  }
  assert.equal(identityChecks,headersToReject.length*3,'every creator route must consult the original dashboard authentication');
  const list=await(await f.request('/creator/api/workspaces',creator)).json();
  assert.deepEqual(new Set(list.workspaces.map(item=>item.guildId)),new Set([A,B,f.config.guildId]));
  for(const item of list.workspaces){assert.equal(item.broadcastToken,undefined);assert.equal(item.createdBy,undefined);}
  const snapshotA=await(await f.request('/creator/workspaces/'+A+'/api/snapshot',creator)).json();
  const snapshotB=await(await f.request('/creator/workspaces/'+B+'/api/snapshot',creator)).json();
  assert.equal(snapshotA.access.role,'admin');assert.equal(snapshotB.access.role,'admin');
  assert.notEqual(snapshotA.csrf,snapshotB.csrf);
  assert.equal((await f.request('/creator/workspaces/'+A+'/api/recovery',creator)).status,200);
  const mutation='/creator/workspaces/'+B+'/api/participation-queue/register';
  for(const csrf of [admin['X-CSRF-Token'],snapshotA.csrf,'invalid']){
    assert.equal((await f.request(mutation,{...creator,'Content-Type':'application/json','X-CSRF-Token':csrf},{displayName:'차단되어야 함'})).status,403);
  }
  assert.equal(contexts[B].participationQueue.summary().entries.length,0);
  const saved=await f.request(mutation,{...creator,'Content-Type':'application/json','X-CSRF-Token':snapshotB.csrf},{displayName:'B 제작자 작업'});
  assert.equal(saved.status,200,await saved.text());
  assert.equal(contexts[B].participationQueue.summary().entries.length,1);
  assert.equal(contexts[A].participationQueue.summary().entries.length,0);
  assert.equal((await f.request('/creator/workspaces/'+A+'/settings',creator)).status,404);
  for(let i=0;i<15;i++)assert.equal((await f.request('/creator/api/workspaces',basic('bad-user','bad-password'))).status,403);
  assert.equal((await f.request('/creator/api/workspaces',basic('bad-user','bad-password'))).status,429,'creator alias must not bypass password attempt throttling');
});
