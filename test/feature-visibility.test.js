import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspacePlatform } from '../src/workspace-platform.js';
import { loadConfig } from '../src/config.js';
import { FeatureVisibilityStore, OPERATOR_PAGES, hiddenFeatureFor } from '../src/feature-visibility.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';

// All data below is fictional. No test reaches Discord, Naver or CHZZK.
const A='111111111111111111',B='222222222222222222',owner='333333333333333333',person='444444444444444444',otherOwner='777777777777777777';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-feature-workspaces-')),client=new EventEmitter(),roles=new Map([[owner,true],[otherOwner,true],[person,false]]),denied=new Set();
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
  }
  return {platform,contexts,request,admin,participant,login,roles,denied};
}


const none = { operator: [], viewer: [] };
const visibility = (f, guildId, hidden, revision, headers = f.admin) => f.request(`/w/${guildId}/api/feature-visibility`, { ...headers, 'Idempotency-Key': crypto.randomUUID() }, { hidden, revision });

test('the server page list matches every portal menu page', async () => {
  const source = await readFile(new URL('../public/portal.js', import.meta.url), 'utf8');
  const menu = source.slice(source.indexOf('const menu=['), source.indexOf('];', source.indexOf('const menu=[')));
  const ids = [...menu.matchAll(/\[((?:'[\w-]+',?)+)\]\]/g)].flatMap(m => m[1].split(',').map(id => id.slice(1, -1)));
  assert.deepEqual([...ids].sort(), [...OPERATOR_PAGES].sort());
});

test('visibility settings reject locked or unknown features and stale revisions', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'feature-visibility-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FeatureVisibilityStore(path.join(dir, 'operations.json')); await store.init();
  for (const hidden of [{ operator: ['queue'], viewer: [] }, { operator: ['home'], viewer: [] }, { operator: [], viewer: ['participation'] }, { operator: ['nope'], viewer: [] }, { operator: ['poll', 'poll'], viewer: [] }, { operator: [] }])
    await assert.rejects(store.configure({ hidden, revision: 0 }), e => e.status === 400, JSON.stringify(hidden));
  assert.equal((await store.configure({ hidden: { operator: ['poll'], viewer: ['card-flip'] }, revision: 0 })).revision, 1);
  await assert.rejects(store.configure({ hidden: none, revision: 0 }), e => e.status === 409);
});

test('a shared route is refused only when every screen that uses it is hidden', () => {
  const hidden = { operator: ['onboarding', 'card-flip', 'roulette', 'ready'], viewer: ['poll'] };
  assert.equal(hiddenFeatureFor(hidden, { path: '/readiness' }), null, 'handoff still uses readiness');
  assert.equal(hiddenFeatureFor({ ...hidden, operator: [...hidden.operator, 'handoff'] }, { path: '/readiness' }), 'onboarding');
  assert.equal(hiddenFeatureFor(hidden, { method: 'POST', path: '/api/card-flip/grant' }), 'card-flip');
  assert.equal(hiddenFeatureFor(hidden, { method: 'POST', path: '/API/Roulette/Spin/' }), 'roulette', 'spelling variants are the same route');
  assert.equal(hiddenFeatureFor(hidden, { path: '/roulette.html' }), 'roulette');
  assert.equal(hiddenFeatureFor(hidden, { path: '/operation-tools.html', query: { feature: 'ready' } }), 'ready');
  assert.equal(hiddenFeatureFor(hidden, { path: '/operation-tools.html', query: { feature: 'undo' } }), null);
  assert.equal(hiddenFeatureFor({ operator: ['tickets'], viewer: [] }, { path: '/community.html', query: { feature: 'tickets' } }), 'tickets');
  assert.equal(hiddenFeatureFor({ operator: ['tickets'], viewer: [] }, { path: '/community.html', query: { feature: 'guide' } }), null);
  assert.equal(hiddenFeatureFor(hidden, { path: '/api/snapshot' }), null);
  assert.equal(hiddenFeatureFor({ operator: [...OPERATOR_PAGES.filter(id => !['home', 'queue'].includes(id))], viewer: [] }, { method: 'POST', path: '/api/feature-visibility' }), null, 'settings stay reachable');
  assert.equal(hiddenFeatureFor(hidden, { method: 'POST', path: '/viewer/api/poll/vote' }), 'poll');
  assert.equal(hiddenFeatureFor(hidden, { path: '/viewer/api/participation' }), null);
});

test('feature visibility is a workspace product route but not a basic-auth operator capability', () => {
  assert.equal(workspaceRouteAllowed('GET', '/api/feature-visibility'), true);
  assert.equal(workspaceRouteAllowed('POST', '/api/feature-visibility'), true);
  assert.equal(dashboardCapabilityForRequest('POST', '/api/feature-visibility'), null);
});

test('hidden features are refused by the real workspace server for that server only', async t => {
  const f = await fixture(t);
  let current = await (await f.request(`/w/${A}/api/feature-visibility`, f.admin)).json();
  assert.deepEqual(current.hidden, none);
  assert.equal((await visibility(f, A, { operator: ['queue'], viewer: [] }, current.revision)).status, 400, 'Queue can never be hidden');
  assert.equal((await visibility(f, A, { operator: [], viewer: [] }, current.revision, f.participant)).status, 403, 'participants cannot change it');
  const saved = await visibility(f, A, { operator: ['roulette', 'card-flip'], viewer: ['card-flip'] }, current.revision);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.deepEqual((await (await f.request(`/portal/api/servers/${A}`, f.admin)).json()).hiddenPages, ['roulette', 'card-flip']);
  assert.equal((await (await f.request(`/portal/api/servers/${A}`, f.participant)).json()).hiddenPages, undefined, 'participants never see the operator menu list');
  for (const route of ['/api/roulette', '/api/card-flip', '/roulette.html']) {
    const response = await f.request(`/w/${A}${route}`, f.admin);
    assert.equal(response.status, 403, route); assert.match((await response.json()).error, /숨긴 기능/);
  }
  assert.equal((await f.request(`/w/${B}/api/roulette`, f.admin)).status, 200, 'another server is unaffected');
  const viewer = await f.request(`/w/${A}/viewer/api/card-flip`, f.participant);
  assert.equal(viewer.status, 403); assert.match((await viewer.json()).error, /숨긴 기능/);
  const notHidden = await f.request(`/w/${B}/viewer/api/card-flip`, f.participant);
  assert.equal(notHidden.status, 403); assert.doesNotMatch((await notHidden.json()).error, /숨긴 기능/, 'B refuses only because the viewer has no profile');
  current = await (await f.request(`/w/${A}/api/feature-visibility`, f.admin)).json();
  assert.equal((await visibility(f, A, none, current.revision)).status, 200);
  assert.equal((await f.request(`/w/${A}/api/card-flip`, f.admin)).status, 200);
});

test('a card picture larger than the normal request limit reaches the workspace', async t => {
  const f = await fixture(t), state = await (await f.request(`/w/${A}/api/card-flip`, f.admin)).json();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300 * 1024, 7)]);
  const response = await f.request(`/w/${A}/api/card-flip/image`, { ...f.admin, 'Idempotency-Key': crypto.randomUUID() }, { cardId: state.settings.cards[0].id, type: 'image/png', data: png.toString('base64'), revision: state.revision });
  assert.equal(response.status, 200, await response.clone().text());
  const file = (await response.json()).settings.cards[0].image.file;
  const image = await f.request(`/w/${A}/api/card-flip/image/${file}`, f.admin);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(Buffer.from(await image.arrayBuffer()).length, png.length);
  assert.equal((await f.request(`/w/${B}/api/card-flip/image/${file}`, f.admin)).status, 404, 'pictures belong to one server');
  const tooBig = await f.request(`/w/${A}/api/snapshot`, { ...f.admin }, { padding: 'x'.repeat(200 * 1024) });
  assert.notEqual(tooBig.status, 200, 'other requests keep the small body limit');
});
