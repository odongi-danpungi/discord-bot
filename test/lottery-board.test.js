import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createWorkspacePlatform } from '../src/workspace-platform.js';
import { loadConfig } from '../src/config.js';
import { LotteryBoardService, LotteryBoardStore, messageNumbers, validateLotteryInput } from '../src/lottery-board.js';
import { installLotteryBoardRoutes } from '../src/lottery-board-routes.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32), SECRET_TEXT = '비밀메모-xyz';
async function setup(t, { locked = () => false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lottery-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new LotteryBoardStore(path.join(dir, 'operations.json')); await store.init();
  const sessions = [], verification = { summary: () => ({ ownerConnected: true }), targetChannelId: () => CHANNEL, ownerToken: async () => 'fixture-owner-token', store: { subscribe: () => () => {} } };
  let seed = 0;
  const service = new LotteryBoardService({ store, chzzkVerification: verification, random: n => (seed = (seed * 7 + 3) % 1000) % n,
    guard: () => { if (locked()) throw Object.assign(Error('locked'), { status: 423 }); },
    sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed', detail: '' }) }; sessions.push(s); return s; } });
  t.after(() => service.close());
  return { store, service, sessions };
}
const input = (store, patch = {}) => { const { settings, revision } = store.read(); return { enabled: true, amount: settings.amount, perDonation: settings.perDonation, prizes: settings.prizes.map(({ id, rank, name, count }) => ({ id, rank, name, count })), revision, ...patch }; };
const donation = (amount, text, channelId = CHANNEL) => ({ donationType: 'CHAT', channelId, donatorChannelId: 'd'.repeat(32), donatorNickname: '봄이', payAmount: String(amount), donationText: text });

test('donation messages give numbers in order', () => {
  assert.deepEqual(messageNumbers('11 23'), [11, 23]);
  assert.deepEqual(messageNumbers('11번, 23번 45!'), [11, 23, 45]);
  assert.deepEqual(messageNumbers('번호 없음'), []);
  assert.deepEqual(messageNumbers('1234 7'), [0, 7], 'long numbers are invalid');
});

test('prize settings validate counts, the 100-tile limit and the latest revision', async t => {
  const { store, service } = await setup(t), base = input(store);
  for (const bad of [{ prizes: [] }, { prizes: [{ name: 'x', count: 0 }] }, { prizes: [{ rank: '1등', name: 'x', count: 101 }] },
    { prizes: [{ rank: '1등', name: 'a', count: 60 }, { rank: '2등', name: 'b', count: 41 }] }, { amount: 50 }, { perDonation: 21 }, { extra: 1 }])
    assert.throws(() => validateLotteryInput({ ...base, ...bad }, store.read().settings), Object.keys(bad)[0]);
  const saved = await service.configure({ ...base, prizes: [{ rank: '아무거나', name: '금', count: 1 }, { name: '은', count: 2 }, { name: '동', count: 3 }, { name: '참가상', count: 4 }] });
  assert.deepEqual(saved.settings.prizes.map(p => [p.rank, p.count]), [['1등', 1], ['2등', 2], ['3등', 3], ['4등', 4]], 'ranks follow the order the streamer chose');
  await assert.rejects(service.configure(base), e => e.status === 409);
});

test('a new board hides exactly the prize counts and never sends the layout to the streamer or OBS', async t => {
  const { store, service } = await setup(t);
  await service.configure(input(store, { prizes: [{ rank: '1등', name: '신청곡', count: 1 }, { rank: '2등', name: '애칭', count: 3 }] }));
  const view = await service.newBoard({ revision: store.read().revision });
  const layout = store.read().board.layout;
  assert.equal(layout.length, 100); assert.equal(layout.filter(id => id === '').length, 96);
  assert.deepEqual(view.board.prizes.map(p => [p.rank, p.left]), [['1등', 1], ['2등', 3]]);
  assert.equal(JSON.stringify(view).includes('layout'), false); assert.equal(JSON.stringify(service.publicBoard()).includes('layout'), false);
  for (const id of new Set(layout.filter(Boolean))) assert.equal(JSON.stringify(service.publicBoard()).includes(id), false, 'OBS gets results only, not prize ids');
  const creator = service.layout();
  assert.equal(creator.board.tiles.filter(tile => tile.rank === '1등').length, 1);
  assert.deepEqual(view.board.prizes.map(p => p.place), [1, 2], '1등 gold and 2등 silver follow the order');
});

test('donations open numbers per cheese amount and save chances for numbers that cannot be used', async t => {
  let locked = false;
  const { store, service, sessions } = await setup(t, { locked: () => locked });
  service.sync(); assert.equal(sessions.length, 0, 'off by default');
  await service.configure(input(store)); await service.newBoard({ revision: store.read().revision });
  assert.equal(sessions.length, 1);
  assert.equal(await service.receiveDonation(donation(3000, `11 23 45 ${SECRET_TEXT}`)), true);
  assert.deepEqual(service.publicBoard().opened.map(o => o.n), [11, 23, 45]);
  await service.receiveDonation(donation(1000, '12 13 14'));
  assert.deepEqual(service.publicBoard().opened.map(o => o.n), [11, 23, 45, 12], 'only as many numbers as the amount allows, from the front');
  await service.receiveDonation(donation(2000, '11'));
  assert.deepEqual(service.adminView().pending.map(p => [p.nickname, p.count]), [['봄이', 2]], 'an open number and a missing number become saved chances');
  assert.equal(await service.receiveDonation(donation(999, '50')), false, 'below the amount');
  assert.equal(await service.receiveDonation(donation(1000, '50', OTHER)), false, 'another channel');
  locked = true; await service.receiveDonation(donation(1000, '60')); locked = false;
  assert.equal(service.publicBoard().opened.some(o => o.n === 60), false); assert.equal(service.adminView().pending[0].reason, '운영 잠금 중 후원');
  const pendingId = service.adminView().pending.at(-1).id;
  await assert.rejects(service.openPending({ pendingId, number: 11 }), e => e.status === 409);
  await service.openPending({ pendingId, number: 70 });
  assert.equal(service.adminView().pending.find(p => p.id === pendingId).count, 1);
  assert.equal(service.publicBoard().opened.at(-1).nickname, '봄이');
  const raw = await readFile(store.file, 'utf8');
  assert.equal(raw.includes(SECRET_TEXT), false, 'the donation message is never written');
  assert.equal(raw.includes('d'.repeat(32)), false, 'the donor channel id is never written');
});

test('the layout route is creator-only and not a workspace or operator route', async t => {
  const { store, service } = await setup(t);
  await service.configure(input(store)); await service.newBoard({ revision: store.read().revision });
  assert.equal(workspaceRouteAllowed('GET', '/api/lottery-board/layout'), false);
  assert.equal(dashboardCapabilityForRequest('GET', '/api/lottery-board/layout'), null);
  for (const [method, url] of [['GET', '/api/lottery-board'], ['POST', '/api/lottery-board'], ['POST', '/api/lottery-board/new'], ['POST', '/api/lottery-board/open'], ['POST', '/api/lottery-board/pending/remove']]) {
    assert.equal(workspaceRouteAllowed(method, url), true, url); assert.equal(dashboardCapabilityForRequest(method, url), 'broadcast', url);
  }
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.dashboardIdentity = { role: req.get('X-Role') }; next(); });
  installLotteryBoardRoutes({ app, service }); app.use((e, _q, res, _n) => res.status(e.status || 500).json({ error: e.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); }); t.after(() => server.close());
  const get = role => fetch(`http://127.0.0.1:${server.address().port}/api/lottery-board/layout`, { headers: { 'X-Role': role } });
  assert.equal((await get('workspace')).status, 403); assert.equal((await get('operator')).status, 403);
  const admin = await get('admin'); assert.equal(admin.status, 200); assert.equal((await admin.json()).board.tiles.length, 100);
});

test('the real workspace keeps the layout from the streamer and OBS', async t => {
  const f = await fixture(t), headers = { ...f.admin, 'Idempotency-Key': crypto.randomUUID() };
  const state = await (await f.request(`/w/${A}/api/lottery-board`, f.admin)).json();
  const created = await f.request(`/w/${A}/api/lottery-board/new`, headers, { revision: state.revision });
  assert.equal(created.status, 200, await created.clone().text());
  assert.equal((await f.request(`/w/${A}/api/lottery-board/layout`, f.admin)).status, 403, 'streamers cannot read the layout');
  const token = f.contexts[A].config.broadcastToken;
  const obs = await f.request(`/w/${A}/broadcast/api/lottery-board?token=${encodeURIComponent(token)}`);
  assert.equal(obs.status, 200); const body = await obs.text(); assert.equal(body.includes('layout'), false); assert.match(body, /"size":100/);
  assert.equal((await f.request(`/w/${B}/broadcast/api/lottery-board?token=${encodeURIComponent(token)}`)).status, 403, 'another server needs its own token');
});
const A='111111111111111111',B='222222222222222222',owner='333333333333333333',person='444444444444444444',otherOwner='777777777777777777';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-lottery-workspaces-')),client=new EventEmitter(),roles=new Map([[owner,true],[otherOwner,true],[person,false]]),denied=new Set();
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



test('test donations show a practice result for OBS and never open the real board', async t => {
  let clock = 1_700_000_000_000;
  const dir = await mkdtemp(path.join(tmpdir(), 'lottery-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new LotteryBoardStore(path.join(dir, 'operations.json')); await store.init();
  const service = new LotteryBoardService({ store, now: () => clock, random: () => 0 }); t.after(() => service.close());
  await assert.rejects(async () => service.testDonation({ number: 7 }), { status: 409 }, 'needs a board first');
  await service.configure({ ...input(store), prizes: [{ name: '금상', count: 1 }, { name: '은상', count: 2 }, { name: '동상', count: 3 }] });
  await service.newBoard({ revision: store.read().revision });
  const before = JSON.stringify(store.read());
  for (const bad of [{}, { number: 0 }, { number: 101 }, { number: 7, nickname: 3 }, { number: 7, extra: 1 }]) assert.throws(() => service.testDonation(bad), { status: 400 });
  const event = service.testDonation({ number: 7, nickname: '연습' });
  assert.deepEqual({ test: event.test, n: event.n, nickname: event.nickname, rank: event.rank, name: event.name, place: event.place }, { test: true, n: 7, nickname: '연습', rank: '1등', name: '금상', place: 1 });
  assert.throws(() => service.testDonation({ number: 8 }), { status: 429 });
  clock += 3000;
  assert.equal(service.testDonation({ number: 8 }).nickname, '테스트');
  assert.equal(JSON.stringify(store.read()), before, 'the saved board, pending chances and log are unchanged');
  assert.equal(service.publicBoard().opened.length, 0);
  assert.equal(service.tests.length, 2);
  assert.equal(workspaceRouteAllowed('POST', '/api/lottery-board/test'), true);
  assert.equal(dashboardCapabilityForRequest('POST', '/api/lottery-board/test'), 'broadcast');
});
