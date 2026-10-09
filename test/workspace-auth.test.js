import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceLogin } from '../src/workspace-login.js';
import { createViewerAuth, createViewerRouter } from '../src/viewer.js';

const userId='111111111111111111',guildId='222222222222222222';
const fixtureSecret='test-only-client-secret',fixtureToken='test-only-discord-access-token';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

async function loginFixture(t,{respond,config:overrides={}}={}) {
  let clock=1000000;
  const calls=[];
  const config={demo:true,publicBaseUrl:'http://127.0.0.1',clientId:'333333333333333333',discordClientSecret:fixtureSecret,...overrides};
  const auth=createWorkspaceLogin({config,now:()=>clock,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(respond){const response=await respond(url,options);if(response!==undefined)return response;}
    if(url.endsWith('/oauth2/token'))return json({access_token:fixtureToken,token_type:'Bearer',refresh_token:'test-only-refresh-token'});
    if(url.endsWith('/users/@me'))return json({id:userId,username:'가상 참가자',email:'private-fixture@example.invalid'});
    return json([{id:guildId,name:'가상 방송',permissions:'8',owner:true}]);
  }});
  const app=express();app.set('trust proxy',1);app.use('/portal/auth',auth.router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=(route,options={})=>fetch(base+'/portal/auth'+route,{redirect:'manual',...options});
  async function start(headers={},query=''){
    const response=await request('/login'+query,{headers});assert.equal(response.status,303);
    return {state:new URL(response.headers.get('location')).searchParams.get('state'),cookie:response.headers.getSetCookie()[0].split(';')[0],response};
  }
  async function finish(flow,query='&code=fixture-code',headers={}){
    return request('/callback?state='+flow.state+query,{headers:{cookie:flow.cookie,...headers}});
  }
  async function loggedIn(){
    const flow=await start(),response=await finish(flow);assert.equal(response.status,303);
    const cookie=response.headers.getSetCookie().find(value=>value.startsWith('dd_portal=')).split(';')[0];
    const session=await(await request('/session',{headers:{cookie}})).json();
    return {cookie,session,response};
  }
  return {auth,config,calls,request,start,finish,loggedIn,advance(ms){clock+=ms;}};
}

test('Discord OAuth requests only identity and server scopes, with an exact callback and secure production cookies',async t=>{
  const f=await loginFixture(t,{config:{demo:false,publicBaseUrl:'https://bot.example.invalid'}});
  assert.equal((await f.request('/login')).status,403);
  const first=await f.start({'X-Forwarded-Proto':'https'}),second=await f.start({'X-Forwarded-Proto':'https'});
  const url=new URL(first.response.headers.get('location'));
  assert.equal(url.origin,'https://discord.com');assert.equal(url.searchParams.get('scope'),'identify guilds');
  assert.equal(url.searchParams.get('redirect_uri'),'https://bot.example.invalid/portal/auth/callback');
  assert.equal(url.searchParams.get('response_type'),'code');assert.notEqual(first.state,second.state);
  assert.match(first.response.headers.getSetCookie()[0],/HttpOnly; SameSite=Lax; Path=\/; Max-Age=600; Secure/);
  const response=await f.finish(first,'&code=fixture-code',{'X-Forwarded-Proto':'https'});
  assert.equal(response.status,303);assert.match(response.headers.getSetCookie().find(value=>value.startsWith('dd_portal=')),/; Secure/);
  assert.equal(f.calls[0].options.redirect,'error');assert.ok(f.calls[0].options.signal instanceof AbortSignal);
});

test('OAuth state is bound to its browser and consumed once; public and retained sessions contain no API credentials',async t=>{
  const f=await loginFixture(t),first=await f.start(),other=await f.start();
  assert.equal((await f.finish(first,'&code=fixture-code',{cookie:other.cookie})).status,400);
  assert.equal(f.calls.length,0,'a mismatched browser must not exchange the authorization code');
  const result=await f.finish(first);assert.equal(result.status,303);
  const cookie=result.headers.getSetCookie().find(value=>value.startsWith('dd_portal=')).split(';')[0];
  const sessionResponse=await f.request('/session',{headers:{cookie}}),session=await sessionResponse.json();
  assert.equal(sessionResponse.headers.get('cache-control'),'no-store');assert.equal(sessionResponse.headers.get('referrer-policy'),'no-referrer');
  assert.equal(session.authenticated,true);assert.deepEqual(session.user,{id:userId,name:'가상 참가자'});
  assert.deepEqual(session.guilds,[{id:guildId,name:'가상 방송'}]);
  const retained=f.auth.session({headers:{cookie}});
  assert.deepEqual(Object.keys(retained).sort(),['csrf','expires','guilds','name','userId']);
  for(const value of [fixtureSecret,fixtureToken,'test-only-refresh-token','private-fixture@example.invalid'])assert.equal(JSON.stringify({session,retained}).includes(value),false);
  const count=f.calls.length;assert.equal((await f.finish(first)).status,400);assert.equal(f.calls.length,count);
});

test('cancelled and expired login states cannot be reused',async t=>{
  const f=await loginFixture(t),cancelled=await f.start();
  assert.equal((await f.finish(cancelled,'&error=access_denied')).status,400);
  assert.equal((await f.finish(cancelled)).status,400);
  const expired=await f.start();f.advance(600001);
  assert.equal((await f.finish(expired)).status,400);assert.equal(f.calls.length,0);
});

test('Discord exchange throttling and network failures fail closed without leaking provider messages or secrets',async t=>{
  for(const kind of ['rate-limit','network','malformed','wrong-token-type'])await t.test(kind,async t=>{
    const f=await loginFixture(t,{respond:(url)=>{
      if(!url.endsWith('/oauth2/token'))return undefined;
      if(kind==='rate-limit')return json({error:fixtureSecret},429);
      if(kind==='network')throw Error(fixtureSecret);
      if(kind==='malformed')return new Response(fixtureSecret);
      return json({access_token:fixtureToken,token_type:'not-bearer'});
    }});
    const flow=await f.start(),result=await f.finish(flow);
    assert.equal(result.status,kind==='rate-limit'?429:502);assert.equal((await result.text()).includes(fixtureSecret),false);
    assert.equal(result.headers.getSetCookie().some(value=>value.startsWith('dd_portal=')),false);
    assert.equal((await f.finish(flow)).status,400);assert.equal(f.calls.length,1,'failed exchanges must not be retried with a consumed state');
  });
});

test('login attempts are bounded per IP and become available after the rate window',async t=>{
  const f=await loginFixture(t);
  for(let index=0;index<10;index++)await f.start();
  assert.equal((await f.request('/login')).status,429);
  f.advance(60001);assert.equal((await f.request('/login')).status,303);assert.equal(f.calls.length,0);
});

test('portal logout validates CSRF and origin, destroys the session, and expired sessions cannot authenticate',async t=>{
  const f=await loginFixture(t),login=await f.loggedIn();
  const headers={cookie:login.cookie,'Content-Type':'application/json','X-CSRF-Token':login.session.csrf};
  for(const override of [{'X-CSRF-Token':'wrong'},{Origin:'https://attacker.invalid'},{'Sec-Fetch-Site':'cross-site'},{'Content-Type':'text/plain'}]){
    assert.equal((await f.request('/logout',{method:'POST',headers:{...headers,...override},body:'{}'})).status,403);
    assert.equal((await(await f.request('/session',{headers:{cookie:login.cookie}})).json()).authenticated,true);
  }
  assert.equal((await f.request('/logout',{method:'POST',headers,body:'{}'})).status,200);
  assert.equal((await(await f.request('/session',{headers:{cookie:login.cookie}})).json()).authenticated,false);
  const expiring=await f.loggedIn();f.advance(8*60*60*1000+1);
  assert.equal((await(await f.request('/session',{headers:{cookie:expiring.cookie}})).json()).authenticated,false);
});

test('guild discovery follows Discord pagination and strips supplied administrative permissions',async t=>{
  const firstPage=Array.from({length:200},(_,index)=>({id:String(700000000000000000n+BigInt(index)),name:'가상 '+index,permissions:'8',owner:true}));
  const f=await loginFixture(t,{respond:(url)=>url.includes('/users/@me/guilds?')?json(url.includes('&after=')?[{id:guildId,name:'마지막 방송'}]:firstPage):undefined});
  const login=await f.loggedIn();assert.equal(login.session.guilds.length,201);
  const guildCalls=f.calls.filter(call=>call.url.includes('/users/@me/guilds?'));
  assert.equal(guildCalls.length,2);assert.equal(new URL(guildCalls[1].url).searchParams.get('after'),firstPage.at(-1).id);
  assert.ok(login.session.guilds.every(guild=>Object.keys(guild).sort().join(',')==='id,name'));
});

test('login returns to the validated server and session captured in OAuth state, never a supplied redirect destination',async t=>{
  const f=await loginFixture(t);
  const flow=await f.start({},'?server='+guildId+'&session=round-test&returnTo=https%3A%2F%2Fattacker.invalid%2F');
  const result=await f.finish(flow,'&code=fixture-code&server=999999999999999999&session=tampered&returnTo=https%3A%2F%2Fattacker.invalid%2F');
  assert.equal(result.status,303);
  assert.equal(result.headers.get('location'),'/portal/?server='+guildId+'&session=round-test');
  assert.equal((await f.finish(flow)).status,400,'the return context cannot make a consumed state reusable');
});

test('unknown or malformed return servers and external return URLs fall back to the portal',async t=>{
  const f=await loginFixture(t);
  for(const query of [
    '?server=999999999999999999&session=round-test',
    '?server=..%2Fcreator&session=round-test',
    '?server=https%3A%2F%2Fattacker.invalid&session=round-test',
    '?returnTo=https%3A%2F%2Fattacker.invalid%2F&session=round-test'
  ]){
    const flow=await f.start({},query),result=await f.finish(flow);
    assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/portal/',query);
  }
});

test('legacy viewer logout with the same idempotency key replays after its session is invalidated',async t=>{
  const viewerAuth=createViewerAuth(),issued=viewerAuth.exchange(viewerAuth.issue(userId));
  const app=express();app.use('/viewer',createViewerRouter({config:{guildId,host:'127.0.0.1',demo:false},store:{read:()=>[]},operations:{read:()=>({})},viewerAuth}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const headers={cookie:'dd_viewer='+issued.token,'Content-Type':'application/json','X-CSRF-Token':issued.session.csrf,'Idempotency-Key':'fixture-logout-retry-0001'};
  const url='http://127.0.0.1:'+server.address().port+'/viewer/api/logout';
  const first=await fetch(url,{method:'POST',headers,body:'{}'});assert.equal(first.status,200);assert.equal(viewerAuth.get(issued.token),undefined);
  const replay=await fetch(url,{method:'POST',headers,body:'{}'});assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{ok:true});assert.equal(replay.headers.get('X-Idempotency-Replayed'),'true');
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'Idempotency-Key':'different-logout-key-0002'},body:'{"fresh":true}'})).status,401);
});
