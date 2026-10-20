import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspacePlatform } from '../src/workspace-platform.js';
import { loadConfig } from '../src/config.js';

const A='111111111111111111',B='222222222222222222',owner='333333333333333333',person='444444444444444444',otherOwner='777777777777777777';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-roulette-workspaces-')),client=new EventEmitter(),roles=new Map([[owner,true],[otherOwner,true],[person,false]]),denied=new Set();
  client.guilds={cache:new Map([[A,{}],[B,{}]]),async fetch(guildId){return {id:guildId,name:guildId===A?'방송 A':'방송 B',ownerId:'999999999999999999',members:{async fetch({user}){if(!roles.has(user)||denied.has(guildId+':'+user))throw Error('not member');return {user:{bot:false},permissions:{has:()=>roles.get(user)}};}}};}};
  const config={...await loadConfig({},['--demo']),multiWorkspaceEnabled:true,publicBaseUrl:'http://127.0.0.1',operationsFile:path.join(dir,'operations.json'),guildId:'555555555555555555',clientId:'666666666666666666',discordClientSecret:'fixture-secret',dashboardPassword:'fixture-password-123',host:'127.0.0.1'};
  const platform=await createWorkspacePlatform({config,client,fetchImpl:async(url,options)=>{
    const value=url.endsWith('/oauth2/token')?{access_token:new URLSearchParams(options.body).get('code'),token_type:'Bearer'}:url.endsWith('/users/@me')?{id:options.headers.Authorization.slice(7),username:'가상 사용자'}:[{id:A,name:'방송 A'},{id:B,name:'방송 B'}];
    return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  }});
  const server=platform.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{try{await platform.close();}finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}});
  const request=(route,headers={},body)=>fetch(base+route,{headers,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})});
  async function login(userId){
    const start=await fetch(base+'/portal/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state'),cookie=start.headers.getSetCookie()[0].split(';')[0];
    const callback=await fetch(base+'/portal/auth/callback?state='+state+'&code='+userId,{headers:{cookie},redirect:'manual'});assert.equal(callback.status,303);
    const sessionCookie=callback.headers.getSetCookie().find(value=>value.startsWith('dd_portal=')).split(';')[0];
    const session=await(await request('/portal/auth/session',{cookie:sessionCookie})).json();
    return {cookie:sessionCookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};
  }
  const admin=await login(owner),participant=await login(person),contexts={};
  for(const guildId of [A,B]){
    const prepared=await request('/portal/api/servers/'+guildId,admin,{});assert.equal(prepared.status,200,await prepared.text());
    contexts[guildId]=(await platform.runtimeFor(guildId)).context;
    for(const name of guildId===A?['A 달콩','A 봄이']:['B 단풍','B 구름'])await contexts[guildId].participationQueue.register({source:'dashboard',displayName:name});
  }
  return {platform,contexts,request,admin,participant,login,roles,denied};
}

const queueInput=(state,requestId='shared-roulette-request')=>({requestId,expectedRevision:state.revision,source:'queue',queueRevision:state.queueRevision});
const spin=(f,guildId,input,headers=f.admin)=>f.request(`/w/${guildId}/api/roulette/spin`,{...headers,'Idempotency-Key':input.requestId},input);
async function read(f,guildId,headers=f.admin){const response=await f.request(`/w/${guildId}/api/roulette`,headers);assert.equal(response.status,200,await response.clone().text());assert.match(response.headers.get('cache-control'),/no-store/);return response.json();}

test('real workspace roulette separates Queue snapshots, results and persistent receipts across servers',async t=>{
  const f=await fixture(t),queueBefore=Object.fromEntries([A,B].map(guildId=>[guildId,f.contexts[guildId].participationQueue.read()]));
  const a=await read(f,A),b=await read(f,B);
  assert.deepEqual(a.queueEntries.map(entry=>entry.label),['A 달콩','A 봄이']);assert.deepEqual(b.queueEntries.map(entry=>entry.label),['B 단풍','B 구름']);
  assert.equal(a.csrf,f.admin['X-CSRF-Token']);assert.equal(b.csrf,f.admin['X-CSRF-Token']);
  const inputA=queueInput(a),inputB=queueInput(b),responseA=await spin(f,A,inputA);assert.equal(responseA.status,200,await responseA.clone().text());const resultA=await responseA.json();
  assert.deepEqual((await read(f,B)).history,[]);assert.equal(f.contexts[B].operations.read().roulette,undefined);
  const responseB=await spin(f,B,inputB);assert.equal(responseB.status,200,await responseB.clone().text());const resultB=await responseB.json();
  assert.notEqual(resultA.result.id,resultB.result.id);assert.equal(resultA.result.requestId,resultB.result.requestId,'the same key is independently scoped to each server');
  assert.deepEqual(resultA.result.entries,a.queueEntries);assert.deepEqual(resultB.result.entries,b.queueEntries);
  const replay=await spin(f,A,inputA);assert.equal(replay.status,200);const repeated=await replay.json();assert.equal(repeated.replayed,true);assert.deepEqual(repeated.result,resultA.result);
  for(const [guildId,other,foreignLabels]of [[A,resultB.result,['B 단풍','B 구름']],[B,resultA.result,['A 달콩','A 봄이']]]){
    const state=await read(f,guildId),serialized=JSON.stringify(state),snapshot=await(await f.request(`/w/${guildId}/api/snapshot`,f.admin)).json();
    assert.equal(state.revision,1);assert.equal(state.history.length,1);assert.equal(serialized.includes(other.id),false);
    for(const label of foreignLabels)assert.equal(serialized.includes(label),false);
    assert.equal(serialized.includes('fingerprint'),false);assert.equal(serialized.includes('requests'),false);assert.equal(snapshot.state.roulette,undefined);
    assert.equal(f.contexts[guildId].operations.read().roulette.requests.length,1);
    assert.deepEqual(f.contexts[guildId].participationQueue.read(),queueBefore[guildId]);
  }
});

test('workspace roulette requires portal CSRF, origin checks and the current session instead of another operator token',async t=>{
  const f=await fixture(t),other=await f.login(otherOwner),current=await read(f,A),input=queueInput(current,'csrf-roulette-request'),before=f.contexts[A].operations.read();
  const invalid=[{...f.admin,'X-CSRF-Token':'wrong'},{...f.admin,'X-CSRF-Token':other['X-CSRF-Token']},{...f.admin,Origin:'https://untrusted.invalid'},{...f.admin,'Sec-Fetch-Site':'cross-site'}];
  const missing={...f.admin};delete missing['X-CSRF-Token'];invalid.push(missing);
  for(const headers of invalid){const response=await spin(f,A,input,headers);assert.equal(response.status,403);}
  assert.deepEqual(f.contexts[A].operations.read(),before);
  const good=await spin(f,A,input);assert.equal(good.status,200,await good.text());assert.equal(f.contexts[A].operations.read().roulette.revision,1);
});

test('participants and unauthenticated users cannot read, spin or load operator roulette assets',async t=>{
  const f=await fixture(t),state=await read(f,A),input=queueInput(state,'participant-denied-roulette'),before=f.contexts[A].operations.read();
  for(const guildId of [A,B]){
    for(const route of ['/api/roulette','/roulette.html','/roulette.js','/roulette.css']){
      assert.equal((await f.request(`/w/${guildId}`+route,f.participant)).status,403,route);
      assert.equal((await f.request(`/w/${guildId}`+route)).status,401,route);
    }
    assert.equal((await spin(f,guildId,input,f.participant)).status,403);assert.equal((await spin(f,guildId,input,{})).status,401);
  }
  assert.deepEqual(f.contexts[A].operations.read(),before);assert.equal(f.contexts[B].operations.read().roulette,undefined);
});

test('workspace roulette assets point at their own API and expose no creator-only code or embedded results',async t=>{
  const f=await fixture(t);
  for(const guildId of [A,B]){
    const html=await f.request(`/w/${guildId}/roulette.html`,f.admin);assert.equal(html.status,200);assert.match(html.headers.get('content-type'),/text\/html/);
    const markup=await html.text(),script=markup.match(/src="([^"]*roulette\.js)"/),stylesheet=markup.match(/href="([^"]*roulette\.css)"/);
    assert.ok(script);assert.ok(stylesheet);assert.equal(new URL(script[1],html.url).pathname,`/w/${guildId}/roulette.js`);assert.equal(new URL(stylesheet[1],html.url).pathname,`/w/${guildId}/roulette.css`);
    const js=await f.request(`/w/${guildId}/roulette.js`,f.admin);assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);
    const scriptText=await js.text(),endpoint=scriptText.match(/request\('([^']*api\/roulette)'\)/);assert.ok(endpoint);assert.equal(new URL(endpoint[1],html.url).pathname,`/w/${guildId}/api/roulette`);
    const css=await f.request(`/w/${guildId}/roulette.css`,f.admin);assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/text\/css/);
    assert.doesNotMatch(markup,/fingerprint|"winnerIndex"|dashboardPassword/);
    assert.equal((await f.request(`/w/${guildId}/app.js`,f.admin)).status,404);
  }
});

test('scoped roulette GET is read-only and committed results can replay after its live Queue changes',async t=>{
  const f=await fixture(t),context=f.contexts[A],state=await read(f,A),input=queueInput(state,'changed-queue-replay');
  const first=await spin(f,A,input);assert.equal(first.status,200);const result=await first.json();
  await context.participationQueue.register({source:'dashboard',displayName:'A 새 참가자'});
  const files=[context.operations.file,context.participationQueue.file],before=await Promise.all(files.map(file=>readFile(file)));
  for(let index=0;index<2;index++){const current=await read(f,A);assert.equal(current.history[0].id,result.result.id);assert.equal(current.queueCount,3);}
  assert.deepEqual(await Promise.all(files.map(file=>readFile(file))),before);
  const replay=await spin(f,A,input);assert.equal(replay.status,200);const body=await replay.json();assert.equal(body.replayed,true);assert.deepEqual(body.result,result.result);
  const stale=await spin(f,A,{...input,requestId:'changed-queue-new-request',expectedRevision:1});assert.equal(stale.status,409);
  assert.equal(context.operations.read().roulette.revision,1);assert.deepEqual((await read(f,B)).history,[]);
});

test('roulette rechecks server operator permission before reading or committing a result',async t=>{
  const f=await fixture(t),state=await read(f,A),input=queueInput(state,'revoked-roulette-operator'),before=f.contexts[A].operations.read();
  f.roles.set(owner,false);
  for(const route of ['/api/roulette','/api/roulette/','/api/Roulette'])assert.equal((await f.request(`/w/${A}`+route,f.admin)).status,403,'cached manager access must not expose private roulette history after demotion: '+route);
  assert.equal((await spin(f,A,input)).status,403);assert.deepEqual(f.contexts[A].operations.read(),before);
});
