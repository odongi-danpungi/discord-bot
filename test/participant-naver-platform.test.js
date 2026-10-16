import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp,readFile,stat,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspacePlatform } from '../src/workspace-platform.js';
import { loadConfig } from '../src/config.js';

const A='111111111111111111',B='222222222222222222',owner='333333333333333333',person='444444444444444444';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,{configured=true}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-participant-naver-')),client=new EventEmitter();
  const hooks={},denied=new Set(),providerCalls=[];
  client.guilds={cache:new Map([[A,{}],[B,{}]]),async fetch(id){return {id,name:'가상 방송',ownerId:owner,members:{async fetch({user}){
    if(hooks.membership)await hooks.membership(id,user);
    if(denied.has(id+':'+user))throw Error('not member');
    return {user:{bot:false},permissions:{has:()=>user===owner}};
  }}};}};
  const server=createServer();server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const config={...await loadConfig({},['--demo']),multiWorkspaceEnabled:true,publicBaseUrl:base,operationsFile:path.join(dir,'operations.json'),guildId:'555555555555555555',clientId:'666666666666666666',discordClientSecret:'fixture-discord-secret',host:'127.0.0.1',naverTokenKey:'a'.repeat(64),participantNaverClientId:configured?'participant-fixture-app':'',participantNaverClientSecret:configured?'participant-fixture-secret':''};
  const platform=await createWorkspacePlatform({config,client,fetchImpl:async(url,opts)=>{
    let data;
    if(url==='https://nid.naver.com/oauth2.0/token'){
      providerCalls.push({kind:'token',method:opts.method,url});
      if(hooks.token)await hooks.token();
      data={access_token:'fixture-participant-access',refresh_token:'fixture-unused-refresh',token_type:'bearer',expires_in:'3600'};
    }else if(url==='https://openapi.naver.com/v1/nid/me'){
      providerCalls.push({kind:'profile',url});if(hooks.profile)await hooks.profile();
      data={resultcode:'00',response:{id:'providerSubjectFixture',nickname:'private nickname',email:'private@example.invalid'}};
    }else if(url.endsWith('/oauth2/token'))data={access_token:new URLSearchParams(opts.body).get('code'),token_type:'Bearer'};
    else if(url.endsWith('/users/@me'))data={id:opts.headers.Authorization.slice(7),username:'가상 사용자'};
    else data=[{id:A,name:'가상 A'},{id:B,name:'가상 B'}];
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  }});
  server.on('request',platform.app);
  t.after(async()=>{try{await platform.close();}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}});
  const request=(route,headers,body)=>fetch(base+route,{headers,redirect:'manual',method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})});
  async function login(user){
    const start=await request('/portal/auth/login'),state=new URL(start.headers.get('location')).searchParams.get('state'),cookie=start.headers.getSetCookie()[0].split(';')[0];
    const done=await request('/portal/auth/callback?state='+state+'&code='+user,{cookie});assert.equal(done.status,303);
    const sessionCookie=done.headers.getSetCookie().find(x=>x.startsWith('dd_portal=')).split(';')[0];
    const session=await(await request('/portal/auth/session',{cookie:sessionCookie})).json();
    return {cookie:sessionCookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json',Origin:base};
  }
  const admin=await login(owner),participant=await login(person),contexts={};
  for(const guild of [A,B]){
    const result=await request('/portal/api/servers/'+guild,admin,{});assert.equal(result.status,200,await result.text());
    contexts[guild]=(await platform.runtimeFor(guild)).context;
    await contexts[guild].participationQueue.register({source:'naver',displayName:'private nickname'});
  }
  const route=(guild=A)=>'/w/'+guild+'/viewer/api/account-link';
  const status=async(headers=participant,guild=A)=>{const r=await request(route(guild),headers);assert.equal(r.status,200,await r.clone().text());return r.json();};
  const start=async(headers=participant,guild=A)=>{const current=await status(headers,guild),r=await request(route(guild)+'/start',headers,{revision:current.revision,consent:true});assert.equal(r.status,200,await r.clone().text());return new URL((await r.json()).url).searchParams.get('state');};
  const callback=(state,headers=participant)=>request('/naver/participant/callback?state='+state+'&code=synthetic-code',headers);
  return {dir,base,config,platform,contexts,admin,participant,hooks,denied,providerCalls,request,login,route,status,start,callback};
}

test('participant Naver link is own-only, tenant scoped, private and leaves Queue and operator grants unchanged',async t=>{
  const f=await fixture(t),context=f.contexts[A],ops=context.operations.read(),queue=context.participationQueue.read(),naver=context.naver.status();
  const initial=await f.status();assert.deepEqual(initial,{revision:0,configured:true,linked:false,linkedAt:null,needsRelink:false,queueMerge:false});
  const state=await f.start();assert.equal((await f.request('/naver/participant/callback?state='+state+'&code=synthetic-code&guildId='+B+'&userId='+owner,f.participant)).status,303);
  const own=await f.status();assert.equal(own.linked,true);assert.equal(own.revision,1);
  const forged=await(await f.request(f.route()+'?userId='+owner+'&guildId='+B,f.participant)).json();assert.deepEqual(forged,own);
  assert.equal((await f.status(f.admin)).linked,false);assert.equal((await f.status(f.participant,B)).linked,false);
  assert.doesNotMatch(JSON.stringify(own),/providerSubject|subjectHash|clientHash|userId|private|access|refresh/);
  assert.deepEqual(context.operations.read(),ops);assert.deepEqual(context.participationQueue.read(),queue);assert.deepEqual(context.naver.status(),naver);
  const file=path.join(path.dirname(context.config.operationsFile),'participant-identities.json'),before=await readFile(file),modified=(await stat(file)).mtimeMs;
  for(let i=0;i<2;i++)await f.status();assert.deepEqual(await readFile(file),before);assert.equal((await stat(file)).mtimeMs,modified);
  assert.doesNotMatch(before.toString(),/providerSubject|private nickname|private@example|fixture-participant-access|fixture-unused-refresh/);
  const snapshot=await(await f.request('/w/'+A+'/api/snapshot',f.admin)).json();assert.doesNotMatch(JSON.stringify(snapshot),/subjectHash|clientHash|participant-identities|providerSubject/);
  assert.equal(f.providerCalls.length,2);assert.equal((await f.callback(state)).status,403);assert.equal(f.providerCalls.length,2);
  const otherServer=await f.start(f.participant,B);assert.equal((await f.callback(otherServer)).status,303);assert.equal((await f.status(f.participant,B)).linked,true);
});

test('link mutations require consent, exact fields, CSRF, Origin and current Discord membership',async t=>{
  const f=await fixture(t),route=f.route();
  for(const body of [{revision:0,consent:false},{revision:0,consent:true,userId:owner},{revision:0,consent:true,guildId:B},{revision:'0',consent:true}])assert.equal((await f.request(route+'/start',f.participant,body)).status,400);
  for(const headers of [{...f.participant,'X-CSRF-Token':'wrong'},{...f.participant,Origin:'https://untrusted.invalid'}])assert.equal((await f.request(route+'/start',headers,{revision:0,consent:true})).status,403);
  const state=await f.start();assert.equal((await f.callback(state,f.admin)).status,403);assert.equal(f.providerCalls.length,0);
  f.denied.add(A+':'+person);assert.equal((await f.callback(state)).status,403);assert.equal(f.providerCalls.length,0);
  assert.equal((await f.request(route,f.participant)).status,403);
});

test('same Naver subject cannot displace another Discord account and local disconnect never revokes the operator grant',async t=>{
  const f=await fixture(t),first=await f.start();assert.equal((await f.callback(first)).status,303);
  const conflict=await f.start(f.admin),denied=await f.callback(conflict,f.admin);assert.equal(denied.status,409);assert.doesNotMatch(await denied.text(),new RegExp(person+'|providerSubject|private|fixture'));
  assert.equal((await f.status()).linked,true);assert.equal((await f.status(f.admin)).linked,false);
  const before=f.providerCalls.length,own=await f.status();
  assert.equal((await f.request(f.route()+'/disconnect',f.participant,{revision:own.revision,confirm:false})).status,400);
  const removed=await f.request(f.route()+'/disconnect',f.participant,{revision:own.revision,confirm:true});assert.equal(removed.status,200);assert.equal((await removed.json()).linked,false);assert.equal(f.providerCalls.length,before);
});

test('logout during membership await cannot retain request authorization',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred();
  f.hooks.membership=async(_guild,user)=>{if(user===person){entered.resolve();await release.promise;}};
  const pending=f.request(f.route(),f.participant);await entered.promise;
  assert.equal((await f.request('/portal/auth/logout',f.participant,{})).status,200);release.resolve();
  assert.equal((await pending).status,401);assert.equal(f.providerCalls.length,0);
});

test('logout and relogin as the same person during provider lookup cannot commit an old callback',async t=>{
  const f=await fixture(t),state=await f.start(),entered=deferred(),release=deferred();
  f.hooks.profile=async()=>{entered.resolve();await release.promise;};
  const pending=f.callback(state);await entered.promise;
  assert.equal((await f.request('/portal/auth/logout',f.participant,{})).status,200);const replacement=await f.login(person);release.resolve();
  assert.equal((await pending).status,403);assert.equal((await f.status(replacement)).linked,false);
});

test('local disconnect while provider request waits cancels the pending link without external revocation',async t=>{
  const f=await fixture(t),state=await f.start(),entered=deferred(),release=deferred();
  f.hooks.profile=async()=>{entered.resolve();await release.promise;};
  const pending=f.callback(state);await entered.promise;const own=await f.status();
  const removed=await f.request(f.route()+'/disconnect',f.participant,{revision:own.revision,confirm:true});assert.equal(removed.status,200);release.resolve();
  assert.equal((await pending).status,409);assert.equal((await f.status()).linked,false);assert.deepEqual(f.providerCalls.map(c=>c.kind),['token','profile']);
});

test('fresh membership is rechecked after provider lookup and fails without writing a link',async t=>{
  const f=await fixture(t),state=await f.start();f.hooks.profile=async()=>{f.denied.add(A+':'+person);};
  assert.equal((await f.callback(state)).status,403);f.denied.clear();assert.equal((await f.status()).linked,false);
});

test('missing participant app stays unavailable and malformed callback errors expose no provider details',async t=>{
  const f=await fixture(t,{configured:false});assert.equal((await f.status()).configured,false);
  assert.equal((await f.request(f.route()+'/start',f.participant,{revision:0,consent:true})).status,503);
  const malformed=await f.request('/naver/participant/callback?state[]=bad&error=private-secret');assert.equal(malformed.status,400);assert.doesNotMatch(await malformed.text(),/private-secret|state\[|subjectHash|Error:/);
});
