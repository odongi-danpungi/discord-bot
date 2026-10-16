import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NaverService } from '../src/naver-service.js';
import { NaverAuthStore, __test as authStoreTest } from '../src/naver-auth-store.js';

const config={naverClientId:'fixture-client',naverClientSecret:'fixture-secret',naverRedirectUri:'https://example.invalid/naver/callback'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const response=(label='new')=>new Response(JSON.stringify({access_token:'fixture-'+label,refresh_token:'fixture-refresh-'+label,token_type:'bearer',expires_in:3600}));
const authChanged=error=>error.code==='NAVER_AUTH_CHANGED'&&error.status===409;
async function fixture(t,{connected=true,fetchImpl,guard}={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'dd-naver-race-')),file=path.join(directory,'naver-auth.json'),key='a'.repeat(64);
  const store=new NaverAuthStore(file,key);await store.init();
  if(connected)await store.saveToken({accessToken:'fixture-old',refreshToken:'fixture-refresh-old',expiresIn:1});
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const service=new NaverService({config,authStore:store,fetchImpl,guard});
  return {store,service,async restart(){const restored=new NaverAuthStore(file,key);await restored.init();return restored;}};
}

test('a late Naver refresh cannot reconnect an account after successful disconnect, including after restart',async t=>{
  const started=deferred(),reply=deferred();
  const f=await fixture(t,{fetchImpl:async url=>{
    if(String(url).includes('grant_type=refresh_token')){started.resolve();return reply.promise;}
    return new Response('{}');
  }});
  const refresh=f.service.refreshToken(),rejected=assert.rejects(refresh,authChanged);await started.promise;
  assert.equal((await f.service.disconnect()).connected,false);
  reply.resolve(response('late'));await rejected;
  assert.equal(f.store.token(),null);assert.equal((await f.restart()).summary().connected,false);
});

test('disconnect invalidates unused Naver OAuth states and an already running code exchange',async t=>{
  const started=deferred(),reply=deferred();let calls=0;
  const f=await fixture(t,{connected:false,fetchImpl:async()=>{calls++;started.resolve();return reply.promise;}});
  const oldState=new URL(f.service.beginOAuth().url).searchParams.get('state');
  const state=new URL(f.service.beginOAuth().url).searchParams.get('state');
  const exchange=f.service.exchangeCode({code:'fixture-code',state}),rejected=assert.rejects(exchange,authChanged);await started.promise;
  await f.service.disconnect();assert.equal(f.service.states.size,0);
  await assert.rejects(f.service.exchangeCode({code:'unused-code',state:oldState}),error=>error.status===400);
  assert.equal(calls,1,'a disconnected old state must never reach the provider');
  reply.resolve(response('late-consent'));await rejected;
  assert.equal((await f.restart()).token(),null);
});

test('new Naver consent keeps its token when an older refresh completes afterwards',async t=>{
  const started=deferred(),reply=deferred();
  const f=await fixture(t,{fetchImpl:async url=>{
    if(String(url).includes('grant_type=refresh_token')){started.resolve();return reply.promise;}
    return response('new-consent');
  }});
  const refresh=f.service.refreshToken(),rejected=assert.rejects(refresh,authChanged);await started.promise;
  const state=new URL(f.service.beginOAuth().url).searchParams.get('state');
  assert.equal((await f.service.exchangeCode({code:'fixture-code',state})).connected,true);
  const envelope=f.store.read().token;reply.resolve(response('old-refresh'));await rejected;
  assert.deepEqual(f.store.read().token,envelope);
  assert.equal((await f.restart()).token().accessToken,'fixture-new-consent');
});

test('new consent replaces an earlier Naver refresh already committing atomic IO and blocks its profile follow-up',async t=>{
  const commitStarted=deferred(),releaseCommit=deferred();let profileRequests=0;
  const f=await fixture(t,{fetchImpl:async url=>{
    if(String(url).includes('grant_type=refresh_token'))return response('old-refresh');
    if(String(url).includes('grant_type=authorization_code'))return response('authoritative-consent');
    profileRequests++;return new Response('{}');
  }});
  const write=f.store.writeUnlocked.bind(f.store);let pauseNextWrite=true;
  f.store.writeUnlocked=async(...args)=>{
    if(pauseNextWrite){pauseNextWrite=false;commitStarted.resolve();await releaseCommit.promise;}
    return write(...args);
  };
  const oldProfile=f.service.profile(),rejected=assert.rejects(oldProfile,authChanged);await commitStarted.promise;
  const state=new URL(f.service.beginOAuth().url).searchParams.get('state');
  const consent=f.service.exchangeCode({code:'fixture-code',state});
  releaseCommit.resolve();await rejected;
  assert.equal((await consent).connected,true);
  const token=(await f.restart()).token();assert.equal(token.accessToken,'fixture-authoritative-consent');
  assert.equal(token.refreshToken,'fixture-refresh-authoritative-consent');
  assert.equal(profileRequests,0,'the superseded refresh cannot send an old-account profile request');
});

test('fresh Naver consent never inherits the previous account refresh token or connection time',async t=>{
  const f=await fixture(t,{fetchImpl:async()=>new Response(JSON.stringify({access_token:'fixture-other-account',token_type:'bearer',expires_in:3600}))});
  const previous=f.store.token();
  await f.store.update(state=>{state.token=authStoreTest.encryptToken({...previous,connectedAt:1},f.store.key);});
  const state=new URL(f.service.beginOAuth().url).searchParams.get('state');
  await f.service.exchangeCode({code:'fixture-code',state});
  const current=(await f.restart()).token();
  assert.equal(current.accessToken,'fixture-other-account');assert.equal(current.refreshToken,'');
  assert.notEqual(current.connectedAt,1);assert.equal(f.service.status().hasRefreshToken,false);
});

test('the newest overlapping Naver consent supersedes an older in-flight consent',async t=>{
  const first=deferred(),second=deferred(),firstStarted=deferred(),secondStarted=deferred();
  const f=await fixture(t,{connected:false,fetchImpl:async url=>{
    if(new URL(url).searchParams.get('code')==='first'){firstStarted.resolve();return first.promise;}
    secondStarted.resolve();return second.promise;
  }});
  const firstState=new URL(f.service.beginOAuth().url).searchParams.get('state');
  const old=f.service.exchangeCode({code:'first',state:firstState}),rejected=assert.rejects(old,authChanged);await firstStarted.promise;
  const secondState=new URL(f.service.beginOAuth().url).searchParams.get('state');
  const latest=f.service.exchangeCode({code:'second',state:secondState});await secondStarted.promise;
  first.resolve(response('first'));await rejected;assert.equal(f.store.token(),null);
  second.resolve(response('second'));await latest;assert.equal(f.store.token().accessToken,'fixture-second');
});

test('a refresh cannot replace the old grant while a new Naver consent is in flight',async t=>{
  const started=deferred(),reply=deferred();let requests=0;
  const f=await fixture(t,{fetchImpl:async()=>{requests++;started.resolve();return reply.promise;}});
  const state=new URL(f.service.beginOAuth().url).searchParams.get('state');
  const consent=f.service.exchangeCode({code:'new-consent',state});await started.promise;
  await assert.rejects(f.service.refreshToken(),authChanged);await assert.rejects(f.service.accessToken(),authChanged);
  assert.equal(requests,1,'a pending consent must not trigger an old-account refresh');
  reply.resolve(response('replacement'));await consent;
  assert.equal(await f.service.accessToken(),'fixture-replacement');
});

test('Naver token fencing is checked inside the atomic persistence queue',async t=>{
  const blocked=deferred(),saveStarted=deferred();
  const f=await fixture(t,{fetchImpl:async url=>String(url).includes('grant_type=refresh_token')?response('queued'):new Response('{}')});
  const blocker=f.store.enqueue(()=>blocked.promise);
  const save=f.store.saveToken.bind(f.store);f.store.saveToken=(...args)=>{saveStarted.resolve();return save(...args);};
  const refresh=f.service.refreshToken(),rejected=assert.rejects(refresh,authChanged);await saveStarted.promise;
  const disconnect=f.service.disconnect();blocked.resolve();await blocker;await rejected;await disconnect;
  assert.equal((await f.restart()).token(),null);
});

test('disconnect clears a prior refresh that already passed its guard and is committing file IO',async t=>{
  const commitStarted=deferred(),releaseCommit=deferred();let profileRequests=0;
  const f=await fixture(t,{fetchImpl:async url=>{
    if(String(url).includes('grant_type=refresh_token'))return response('committing');
    if(String(url).includes('/nid/me'))profileRequests++;
    return new Response('{}');
  }});
  const write=f.store.writeUnlocked.bind(f.store);let pauseNextWrite=true;
  f.store.writeUnlocked=async(...args)=>{
    if(pauseNextWrite){pauseNextWrite=false;commitStarted.resolve();await releaseCommit.promise;}
    return write(...args);
  };
  const profile=f.service.profile(),rejected=assert.rejects(profile,authChanged);await commitStarted.promise;
  const disconnect=f.service.disconnect();releaseCommit.resolve();
  await rejected;
  assert.equal((await disconnect).connected,false);
  assert.equal((await f.restart()).token(),null);
  assert.equal(profileRequests,0,'a credential committed during disconnect must not be used for a follow-up request');
});

test('an authorization request rechecks a shutdown guard after acquiring its token and before calling the provider',async t=>{
  let stopped=false,requests=0;
  const f=await fixture(t,{guard:()=>{if(stopped)throw Object.assign(Error('fixture shutdown'),{status:503});},fetchImpl:async()=>{requests++;return new Response('{}');}});
  await f.store.saveToken({accessToken:'fixture-active',refreshToken:'fixture-refresh',expiresIn:3600});
  const token=f.store.token.bind(f.store);f.store.token=()=>{const current=token();stopped=true;return current;};
  await assert.rejects(f.service.authorizedRequest('https://example.invalid/profile'),error=>error.status===503);
  assert.equal(requests,0);
});

test('Naver store rejects stale refresh and clear against a newer committed token envelope',async t=>{
  const f=await fixture(t,{fetchImpl:async()=>{throw Error('unused');}}),old=f.store.read().token;
  await f.store.saveToken({accessToken:'fixture-replacement',refreshToken:'fixture-new-refresh',expiresIn:3600});
  await assert.rejects(f.store.saveToken({accessToken:'fixture-stale',expiresIn:3600},{expectedToken:old}),authChanged);
  await assert.rejects(f.store.clear({expectedToken:old}),authChanged);
  assert.equal((await f.restart()).token().accessToken,'fixture-replacement');
});

test('concurrent Naver disconnects share one revoke and prevent credential use until it settles',async t=>{
  const started=deferred(),reply=deferred();let revokes=0;
  const f=await fixture(t,{fetchImpl:async()=>{revokes++;started.resolve();return reply.promise;}});
  const first=f.service.disconnect();await started.promise;const second=f.service.disconnect();
  await assert.rejects(f.service.accessToken(),authChanged);assert.throws(()=>f.service.beginOAuth(),authChanged);
  reply.resolve(new Response('{}'));await Promise.all([first,second]);assert.equal(revokes,1);assert.equal(f.store.token(),null);
  assert.ok(f.service.beginOAuth().url,'a fresh consent can start after disconnect finishes');
});

test('a failed Naver revoke preserves the saved grant and allows a fresh consent afterwards',async t=>{
  const f=await fixture(t,{fetchImpl:async url=>String(url).includes('/revoke')?new Response(JSON.stringify({error:'fixture-unavailable'}),{status:503}):response('reconnected')});
  const staleState=new URL(f.service.beginOAuth().url).searchParams.get('state'),before=f.store.read();
  await assert.rejects(f.service.disconnect(),error=>error.upstreamStatus===503);
  assert.deepEqual(f.store.read(),before);assert.equal((await f.restart()).token().accessToken,'fixture-old');
  assert.equal(f.service.disconnecting,false);assert.equal(f.service.disconnectPromise,null);
  await assert.rejects(f.service.exchangeCode({code:'old-code',state:staleState}),error=>error.status===400);
  const state=new URL(f.service.beginOAuth().url).searchParams.get('state');
  await f.service.exchangeCode({code:'new-code',state});assert.equal(f.store.token().accessToken,'fixture-reconnected');
});

test('a runtime shutdown guard blocks token commit after the provider response',async t=>{
  const started=deferred(),reply=deferred();let stopped=false;
  const f=await fixture(t,{connected:false,guard:()=>{if(stopped)throw Object.assign(Error('fixture shutdown'),{status:503});},fetchImpl:async()=>{started.resolve();return reply.promise;}});
  const state=new URL(f.service.beginOAuth().url).searchParams.get('state');
  const exchange=f.service.exchangeCode({code:'fixture-code',state}),rejected=assert.rejects(exchange,error=>error.status===503);await started.promise;
  stopped=true;reply.resolve(response('late-shutdown'));await rejected;assert.equal((await f.restart()).token(),null);
});
