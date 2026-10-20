import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ChzzkDonationSession, normalizeDonation, sessionSocketUrl } from '../src/chzzk-session.js';
import { DonationRouletteService, DonationRouletteStore, publicDonationEvents, tierForAmount, validateDonationRouletteInput } from '../src/donation-roulette.js';
import { readRoulette } from '../src/roulette.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';
import { createBroadcastRouter } from '../src/broadcast.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

async function tempStore(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'donation-roulette-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new DonationRouletteStore(path.join(dir, 'operations.json'));
  await store.init();
  return store;
}
function fakeOperations() {
  let state = { revision: 0 }; const subs = new Set();
  return { read: () => structuredClone(state), subscribe: fn => (subs.add(fn), () => subs.delete(fn)),
    update: async fn => { const draft = structuredClone(state); const result = await fn(draft); state = draft; return result; } };
}
function fakeVerification(channel = CHANNEL, connected = true) {
  return { summary: () => ({ ownerConnected: connected }), targetChannelId: () => channel, ownerToken: async () => 'fixture-owner-token' };
}

test('session URL becomes an Engine.IO v3 websocket address on a CHZZK host only', () => {
  const url = new URL(sessionSocketUrl('https://ssio08.nchat.naver.com:443?auth=TOKEN'));
  assert.equal(url.protocol, 'wss:'); assert.equal(url.pathname, '/socket.io/');
  assert.equal(url.searchParams.get('auth'), 'TOKEN'); assert.equal(url.searchParams.get('EIO'), '3'); assert.equal(url.searchParams.get('transport'), 'websocket');
  assert.throws(() => sessionSocketUrl('https://evil.example.com/?auth=x'));
  assert.throws(() => sessionSocketUrl('https://ssio08.nchat.naver.com/'));
  assert.throws(() => sessionSocketUrl('http://ssio08.nchat.naver.com/?auth=x'));
});

test('donation payloads are validated and never keep the donor channel id', () => {
  const d = normalizeDonation(JSON.stringify({ donationType: 'CHAT', channelId: CHANNEL.toUpperCase(), donatorChannelId: 'c'.repeat(32), donatorNickname: '봄이‮\u0007', payAmount: '1,000', donationText: '안녕' }));
  assert.deepEqual(d, { channelId: CHANNEL, donationType: 'CHAT', nickname: '봄이', amount: 1000 });
  assert.equal(JSON.stringify(d).includes('c'.repeat(32)), false);
  assert.equal(normalizeDonation({ channelId: 'bad', payAmount: '1000' }), null);
  assert.equal(normalizeDonation({ channelId: CHANNEL, payAmount: '0' }), null);
  assert.equal(normalizeDonation({ channelId: CHANNEL, payAmount: '12.5' }), null);
  assert.equal(normalizeDonation('not json'), null);
  assert.equal(normalizeDonation({ channelId: CHANNEL, payAmount: 500, donatorNickname: '' }).nickname, '익명');
});

class FakeSocket {
  static last = null;
  constructor(url) { this.url = url; this.sent = []; this.closed = false; FakeSocket.last = this; }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  emit(data) { this.onmessage?.({ data }); }
}
function manualTimers() {
  const timers = new Map(); let id = 0;
  return { set: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key; }, clear: key => timers.delete(key),
    fire: ms => { for (const [key, t] of [...timers]) if (t.ms === ms) { timers.delete(key); t.fn(); } }, timers };
}

test('session uses the official user session, subscribes to donations with the session key and forwards donations', async () => {
  const calls = [], donations = [], statuses = [], timers = manualTimers();
  const fetchImpl = async (url, options) => { calls.push({ url: String(url), options }); return { ok: true, status: 200, json: async () => ({ code: 200, content: String(url).includes('/sessions/auth') ? { url: 'https://ssio08.nchat.naver.com:443?auth=SESSION' } : {} }) }; };
  const session = new ChzzkDonationSession({ accessToken: async () => 'owner-token', onDonation: d => donations.push(d), onStatus: s => statuses.push(s.status), fetchImpl, WebSocketImpl: FakeSocket, setTimer: timers.set, clearTimer: timers.clear });
  session.start(); await settle();
  assert.equal(calls[0].url, 'https://openapi.chzzk.naver.com/open/v1/sessions/auth');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.headers.Authorization, 'Bearer owner-token');
  const socket = FakeSocket.last; assert.match(socket.url, /^wss:\/\/ssio08\.nchat\.naver\.com\/socket\.io\/\?auth=SESSION&EIO=3&transport=websocket$/);
  socket.emit('0{"sid":"x","pingInterval":25000,"pingTimeout":60000}'); socket.emit('40');
  socket.emit('42' + JSON.stringify(['SYSTEM', JSON.stringify({ type: 'connected', data: { sessionKey: 'KEY-1' } })])); await settle();
  const subscribe = calls.find(c => c.url.includes('/subscribe/donation'));
  assert.ok(subscribe); assert.equal(subscribe.options.method, 'POST'); assert.equal(new URL(subscribe.url).searchParams.get('sessionKey'), 'KEY-1');
  assert.equal(session.status().status, 'subscribed');
  socket.emit('42' + JSON.stringify(['DONATION', { donationType: 'CHAT', channelId: CHANNEL, donatorChannelId: OTHER, donatorNickname: '달콩', payAmount: '3000', donationText: '' }])); await settle();
  assert.deepEqual(donations, [{ channelId: CHANNEL, donationType: 'CHAT', nickname: '달콩', amount: 3000 }]);
  timers.fire(25000); assert.ok(socket.sent.includes('2'), 'Engine.IO v3 client heartbeat');
  session.stop(); assert.equal(socket.closed, true); assert.equal(session.status().status, 'stopped');
});

test('revoked consent and missing scope stop retrying quickly and ask for consent', async () => {
  const timers = manualTimers();
  let subscribeStatus = 200;
  const fetchImpl = async url => String(url).includes('/sessions/auth')
    ? { ok: true, status: 200, json: async () => ({ content: { url: 'https://ssio01.nchat.naver.com/?auth=S' } }) }
    : { ok: subscribeStatus === 200, status: subscribeStatus, json: async () => ({}) };
  const session = new ChzzkDonationSession({ accessToken: async () => 't', onDonation: () => {}, fetchImpl, WebSocketImpl: FakeSocket, setTimer: timers.set, clearTimer: timers.clear, maxBackoffMs: 1000 });
  session.start(); await settle();
  let socket = FakeSocket.last; socket.emit('0{}');
  socket.emit('42' + JSON.stringify(['SYSTEM', { type: 'connected', data: { sessionKey: 'K' } }])); await settle();
  socket.emit('42' + JSON.stringify(['SYSTEM', { type: 'revoked', data: { eventType: 'DONATION', channelId: CHANNEL } }])); await settle();
  assert.equal(session.status().status, 'auth_required'); assert.equal(socket.closed, true);
  assert.ok([...timers.timers.values()].some(t => t.ms === 5000), 'permanent failures back off longer');
  subscribeStatus = 403; timers.fire(5000); await settle();
  socket = FakeSocket.last; socket.emit('0{}');
  socket.emit('42' + JSON.stringify(['SYSTEM', { type: 'connected', data: { sessionKey: 'K2' } }])); await settle();
  assert.equal(session.status().status, 'auth_required'); assert.match(session.status().detail, /후원 조회 권한/);
  session.stop();
});

test('settings require 1-5 unique tiers with 2-100 items and the latest revision', async t => {
  const store = await tempStore(t);
  assert.throws(() => validateDonationRouletteInput({ enabled: true, tiers: [], revision: 0 }));
  assert.throws(() => validateDonationRouletteInput({ enabled: true, tiers: [{ minAmount: 1000, items: ['하나'] }], revision: 0 }));
  assert.throws(() => validateDonationRouletteInput({ enabled: true, tiers: [{ minAmount: 1000, items: ['a', 'b'] }, { minAmount: 1000, items: ['c', 'd'] }], revision: 0 }));
  assert.throws(() => validateDonationRouletteInput({ enabled: true, tiers: [{ minAmount: 0, items: ['a', 'b'] }], revision: 0 }));
  assert.throws(() => validateDonationRouletteInput({ enabled: 'yes', tiers: [{ minAmount: 1, items: ['a', 'b'] }], revision: 0 }));
  const saved = await store.configure({ enabled: true, tiers: [{ minAmount: 10000, items: ['노래', '춤'] }, { minAmount: 1000, items: [' 물 마시기 ', '스쿼트'] }], revision: 0 });
  assert.deepEqual(saved.settings.tiers.map(t => t.minAmount), [1000, 10000]);
  assert.deepEqual(saved.settings.tiers[0].items, ['물 마시기', '스쿼트']);
  await assert.rejects(store.configure({ enabled: false, tiers: saved.settings.tiers, revision: 0 }), e => e.status === 409);
  assert.equal(tierForAmount(saved.settings.tiers, 999), null);
  assert.equal(tierForAmount(saved.settings.tiers, 1000).minAmount, 1000);
  assert.equal(tierForAmount(saved.settings.tiers, 25000).minAmount, 10000);
});

test('donations spin the highest matching tier once, in order, and are saved to roulette history', async t => {
  const store = await tempStore(t), operations = fakeOperations();
  await store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: ['물 마시기', '스쿼트'] }, { minAmount: 10000, items: ['노래', '춤', '성대모사'] }], revision: 0 });
  const sessions = [];
  const service = new DonationRouletteService({ store, operations, chzzkVerification: fakeVerification(), sessionFactory: options => { const s = { options, started: false, start() { this.started = true; }, stop() { this.started = false; }, status: () => ({ status: 'subscribed', detail: '', since: 1, lastEventAt: 0 }) }; sessions.push(s); return s; } });
  service.sync();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].started, true);
  await Promise.all([
    service.enqueue({ channelId: CHANNEL, donationType: 'CHAT', nickname: '봄이', amount: 1500 }),
    service.enqueue({ channelId: CHANNEL, donationType: 'CHAT', nickname: '달콩', amount: 20000 }),
    service.enqueue({ channelId: CHANNEL, donationType: 'CHAT', nickname: '여름', amount: 500 }),
    service.enqueue({ channelId: OTHER, donationType: 'CHAT', nickname: '남의 방송', amount: 50000 })
  ]);
  const events = store.snapshot().events;
  assert.deepEqual(events.map(e => [e.nickname, e.tierMin]), [['달콩', 10000], ['봄이', 1000]], 'newest first, below-minimum and other channels ignored');
  assert.deepEqual(events[0].entries, ['노래', '춤', '성대모사']);
  const history = readRoulette(operations.read()).history;
  assert.equal(history.length, 2); assert.equal(history[0].source, 'custom');
  assert.equal(history[0].winner.label, events[0].entries[events[0].winnerIndex]);
  assert.deepEqual(service.status().ignored, { belowMinimum: 1, otherChannel: 1 });
  assert.equal(service.status().verification, 'pending');
  const view = publicDonationEvents(events);
  assert.equal(view[0].winner, events[0].entries[events[0].winnerIndex]);
  assert.equal(JSON.stringify(view).includes(OTHER), false);
  await service.close();
});

test('operation locks skip the spin and log why; disabling stops the session', async t => {
  const store = await tempStore(t), operations = fakeOperations(); let locked = true;
  await store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: ['a', 'b'] }], revision: 0 });
  const sessions = [];
  const service = new DonationRouletteService({ store, operations, chzzkVerification: fakeVerification(), guard: () => { if (locked) throw Object.assign(Error('locked'), { status: 423 }); },
    sessionFactory: () => { const s = { start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed' }) }; sessions.push(s); return s; } });
  service.sync();
  await service.enqueue({ channelId: CHANNEL, donationType: 'CHAT', nickname: '봄이', amount: 1000 });
  assert.equal(store.snapshot().events[0].status, 'skipped'); assert.match(store.snapshot().events[0].reason, /운영 잠금/);
  assert.equal(readRoulette(operations.read()).history.length, 0);
  locked = false;
  await store.configure({ enabled: false, tiers: store.snapshot().settings.tiers, revision: store.snapshot().revision });
  await settle();
  assert.equal(sessions[0].on, false, 'saving disabled settings stops the CHZZK session');
  assert.equal(service.status().state, 'disabled');
  await service.close();
});

test('no session starts without a connected broadcaster, and a changed broadcaster gets a new session', async t => {
  const store = await tempStore(t), operations = fakeOperations();
  await store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: ['a', 'b'] }], revision: 0 });
  let channel = CHANNEL, connected = false; const sessions = [];
  const verification = { summary: () => ({ ownerConnected: connected }), targetChannelId: () => channel, ownerToken: async () => 't' };
  const service = new DonationRouletteService({ store, operations, chzzkVerification: verification, sessionFactory: () => { const s = { start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'connecting' }) }; sessions.push(s); return s; } });
  service.sync(); assert.equal(sessions.length, 0); assert.equal(service.status().state, 'not_connected');
  connected = true; service.sync(); assert.equal(sessions.length, 1);
  channel = OTHER; service.sync(); assert.equal(sessions.length, 2); assert.equal(sessions[0].on, false); assert.equal(sessions[1].on, true);
  await service.close();
});

test('settings API is broadcast-scoped and allowed for workspace managers; OBS feed requires the broadcast token', async t => {
  assert.equal(workspaceRouteAllowed('GET', '/api/donation-roulette'), true);
  assert.equal(workspaceRouteAllowed('POST', '/api/donation-roulette'), true);
  assert.equal(workspaceRouteAllowed('DELETE', '/api/donation-roulette'), false);
  assert.equal(dashboardCapabilityForRequest('GET', '/api/donation-roulette'), 'broadcast');
  assert.equal(dashboardCapabilityForRequest('POST', '/api/donation-roulette'), 'broadcast');
  const store = await tempStore(t);
  await store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: ['a', 'b'] }], revision: 0 });
  await store.record({ id: 'donation-fixture-1', at: 1, status: 'spun', nickname: '<img src=x>', amount: 1000, tierMin: 1000, resultId: 'r', entries: ['a', 'b'], winnerIndex: 1 });
  await store.record({ id: 'donation-fixture-2', at: 2, status: 'skipped', nickname: '숨김', amount: 1000, reason: '운영 잠금' });
  const ops = fakeOperations();
  const broadcast = createBroadcastRouter({ config: { host: '0.0.0.0', broadcastToken: 'x'.repeat(32), guildId: 'g' }, store: { read: () => [], subscribe: () => () => {} }, operations: ops, version: 'test', donationRouletteStore: store });
  const app = express(); app.use('/broadcast', broadcast.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { broadcast.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/broadcast`;
  // Loopback is trusted only when the configured host is loopback; this host is not.
  assert.equal((await fetch(base + '/api/donation-roulette')).status, 403);
  assert.equal((await fetch(base + '/donation-roulette')).status, 403);
  const ok = await fetch(base + '/api/donation-roulette?token=' + 'x'.repeat(32)); assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.deepEqual(data.events.map(e => e.id), ['donation-fixture-1'], 'OBS shows completed spins only');
  assert.equal(data.events[0].winner, 'b');
  assert.equal((await fetch(base + '/donation-roulette.js')).status, 200);
});

test('OBS page renders donor text as inert text and lands on the saved winner without replaying history', async t => {
  const html = await readFile(new URL('../public/donation-roulette.html', import.meta.url), 'utf8'), source = await readFile(new URL('../public/donation-roulette.js', import.meta.url), 'utf8');
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, { url: 'https://example.invalid/broadcast/donation-roulette?token=abc', runScripts: 'outside-only', virtualConsole: vc, pretendToBeVisual: true });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const old = { id: 'old', at: 1, status: 'spun', nickname: '예전', amount: 1000, tierMin: 1000, entries: ['a', 'b'], winnerIndex: 0, winner: 'a' };
  const fresh = { id: 'new', at: 2, status: 'spun', nickname: '<img src=x onerror=alert(1)>', amount: 5000, tierMin: 1000, entries: ['물', '불', '흙'], winnerIndex: 2, winner: '흙' };
  let events = [old], urls = [];
  dom.window.fetch = async url => { urls.push(url); return { ok: true, json: async () => ({ events }) }; };
  dom.window.matchMedia = () => ({ matches: true });
  let pending = [];
  dom.window.setTimeout = (fn, ms) => { pending.push({ fn, ms }); return pending.length; };
  dom.window.eval(source); await settle();
  assert.equal(urls[0], '/broadcast/api/donation-roulette?token=abc');
  assert.equal(dom.window.document.getElementById('stage').hidden, true, 'existing history is not replayed on load');
  events = [fresh, old];
  const poll = pending.find(p => p.ms >= 2000); pending = []; poll.fn(); await settle();
  const doc = dom.window.document;
  assert.equal(doc.getElementById('stage').hidden, false);
  assert.match(doc.getElementById('donor').textContent, /<img src=x onerror=alert\(1\)>님 5,000치즈/);
  assert.equal(doc.querySelector('#donor img'), null);
  for (let i = 0; i < 4; i++) { const due = pending.filter(p => p.ms < 2000); pending = pending.filter(p => p.ms >= 2000); for (const p of due) p.fn(); await settle(); }
  assert.equal(doc.getElementById('result').textContent, '결과 · 흙');
  const angle = Number(/rotate\(([-.\d]+)deg\)/.exec(doc.getElementById('wheel').style.transform)[1]);
  assert.equal((angle + (2 + .5) * 120) % 360, 0, 'winner sector centre meets the top pointer');
});

test('portal donation screen saves tiers with the loaded revision and never claims real delivery', async t => {
  const A = '111111111111111111', calls = [];
  const html = await readFile(new URL('../public/portal.html', import.meta.url), 'utf8'), source = await readFile(new URL('../public/portal.js', import.meta.url), 'utf8');
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, { url: 'https://example.invalid/portal/?server=' + A, runScripts: 'outside-only', virtualConsole: vc });
  t.after(async () => { await new Promise(r => setTimeout(r, 20)); for (const n of dom.window.document.querySelectorAll('details')) n.ontoggle = null; dom.window.close(); assert.deepEqual(errors, []); });
  const donation = { settings: { enabled: false, tiers: [{ minAmount: 1000, items: ['물 마시기', '스쿼트'] }] }, revision: 4, status: { state: 'subscribed', detail: '', verification: 'pending' },
    events: [{ id: 'donation-fixture-1', at: Date.UTC(2026, 9, 19, 12), status: 'spun', nickname: '<b>봄이</b>', amount: 1000, tierMin: 1000, entries: ['물 마시기', '스쿼트'], winnerIndex: 1, winner: '스쿼트' }] };
  const data = url => url === '/portal/auth/session' ? { authenticated: true, user: { name: '가상 운영자' }, csrf: 'fixture' }
    : url === '/portal/api/servers' ? { servers: [{ id: A, name: '봄별 방송', botPresent: true }] }
      : url.startsWith('/portal/api/servers/') ? { guildId: A, name: '봄별 방송', role: 'operator' }
        : url.endsWith('/api/snapshot') ? { state: { session: null }, participationQueue: { activeCount: 0 }, paused: false }
          : url.endsWith('/api/donation-roulette') ? donation : {};
  dom.window.fetch = (url, options) => { calls.push({ url, options }); return Promise.resolve({ ok: true, json: async () => structuredClone(data(url)) }); };
  dom.window.newPractice = () => ({}); dom.window.practiceAction = () => ({});
  await dom.window.eval('(async()=>{' + source.replace(/^import \{newPractice,practiceAction\} from '\.\/practice-model\.js';\r?\n/, '') + ';globalThis.portalTest={page};})()');
  await dom.window.portalTest.page('donation-roulette');
  const doc = dom.window.document, panel = doc.getElementById('panel');
  assert.equal(doc.getElementById('breadcrumb').textContent, '방송 / 룰렛 / 치즈 후원 룰렛');
  assert.deepEqual([...doc.querySelectorAll('#menu>details>summary')].map(s => s.textContent), ['통합 운영', '방송', '네이버 카페', 'Discord', 'CHZZK']);
  assert.equal(doc.querySelector('#menu [data-page=donation-roulette]').closest('#menu>details').querySelector('summary').textContent, '방송');
  const groupOf = id => { const leaf = doc.querySelector(`#menu [data-page="${id}"]`); return [leaf.closest('#menu>details').querySelector('summary').textContent, leaf.parentElement.querySelector('summary').textContent]; };
  for (const [id, path] of Object.entries({ schedule: ['방송', '방송 도구'], poll: ['방송', '방송 도구'], studio: ['방송', '방송 도구'], obs: ['방송', 'OBS'], 'obs-roulette': ['방송', 'OBS'], 'obs-chat': ['방송', 'OBS'], roulette: ['방송', '룰렛'], archive: ['방송', '방송 기록'], timeline: ['방송', '방송 기록'], stats: ['방송', '방송 기록'], notifications: ['방송', '방송 기록'],
    home: ['통합 운영', '참가 진행'], queue: ['통합 운영', '참가 진행'], presets: ['통합 운영', '참가 진행'], practice: ['통합 운영', '운영 준비'] })) assert.deepEqual(groupOf(id), path, id);
  assert.equal(new Set([...doc.querySelectorAll('#menu [data-page]')].map(b => b.dataset.page)).size, doc.querySelectorAll('#menu [data-page]').length, 'every feature appears once');
  assert.match(panel.textContent, /후원 구독 요청 완료/); assert.match(panel.textContent, /실제 후원 수신 검증 대기/);
  assert.match(panel.textContent, /<b>봄이<\/b>/); assert.equal(panel.querySelector('td b'), null, 'donor nickname stays inert text');
  doc.querySelector('[name=enabled]').checked = true;
  doc.querySelector('.donation-form > button.secondary').click();
  const rows = doc.querySelectorAll('.donation-tier'); assert.equal(rows.length, 2);
  rows[1].querySelector('[name=minAmount]').value = '10000'; rows[1].querySelector('[name=items]').value = '노래\n\n춤\n';
  doc.querySelector('.donation-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const saved = calls.find(c => c.url === '/w/' + A + '/api/donation-roulette' && c.options?.method === 'POST');
  assert.ok(saved);
  assert.deepEqual(JSON.parse(saved.options.body), { enabled: true, tiers: [{ minAmount: 1000, items: ['물 마시기', '스쿼트'] }, { minAmount: 10000, items: ['노래', '춤'] }], spinMode: 'once', maxSpins: 1, revision: 4 });
  assert.equal(saved.options.headers['X-CSRF-Token'], 'fixture');
});

test('repeat mode spins once per tier minimum up to the cap and commits every spin together', async t => {
  const store = await tempStore(t), operations = fakeOperations();
  let updates = 0; const update = operations.update; operations.update = fn => { updates++; return update(fn); };
  await store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: ['a', 'b'] }, { minAmount: 10000, items: ['x', 'y', 'z'] }], spinMode: 'repeat', maxSpins: 3, revision: 0 });
  const service = new DonationRouletteService({ store, operations, chzzkVerification: fakeVerification(), sessionFactory: () => ({ start() {}, stop() {}, status: () => ({ status: 'subscribed' }) }) });
  await service.enqueue({ channelId: CHANNEL, donationType: 'CHAT', nickname: '봄이', amount: 2500 });
  assert.equal(updates, 1, 'one atomic Operations update per donation');
  let events = store.snapshot().events;
  assert.deepEqual(events.map(e => [e.spin, e.spins]), [[2, 2], [1, 2]], 'newest first; OBS replays oldest first');
  assert.equal(readRoulette(operations.read()).history.length, 2);
  await service.enqueue({ channelId: CHANNEL, donationType: 'CHAT', nickname: '달콩', amount: 99000 });
  events = store.snapshot().events;
  assert.equal(events.filter(e => e.nickname === '달콩').length, 3, 'capped at maxSpins');
  assert.ok(events.filter(e => e.nickname === '달콩').every(e => e.tierMin === 10000 && e.entries.length === 3));
  await store.configure({ enabled: true, tiers: store.snapshot().settings.tiers, revision: store.snapshot().revision });
  assert.deepEqual([store.snapshot().settings.spinMode, store.snapshot().settings.maxSpins], ['once', 1], 'older 3-field saves keep one spin per donation');
  await service.enqueue({ channelId: CHANNEL, donationType: 'CHAT', nickname: '여름', amount: 99000 });
  const once = store.snapshot().events.filter(e => e.nickname === '여름');
  assert.equal(once.length, 1); assert.equal(once[0].spins, undefined);
  assert.throws(() => validateDonationRouletteInput({ enabled: true, tiers: [{ minAmount: 1, items: ['a', 'b'] }], spinMode: 'many', maxSpins: 2, revision: 0 }));
  assert.throws(() => validateDonationRouletteInput({ enabled: true, tiers: [{ minAmount: 1, items: ['a', 'b'] }], spinMode: 'repeat', maxSpins: 11, revision: 0 }));
  await service.close();
});

test('test donations need no CHZZK connection, never touch roulette history and are labelled everywhere', async t => {
  const store = await tempStore(t), operations = fakeOperations(); let clock = 10000, locked = false;
  const service = new DonationRouletteService({ store, operations, chzzkVerification: fakeVerification(CHANNEL, false), now: () => clock,
    guard: () => { if (locked) throw Object.assign(Error('locked'), { status: 423 }); }, sessionFactory: () => { throw Error('no session expected'); } });
  await assert.rejects(service.test({ amount: 1000 }), e => e.status === 409, 'tiers must be saved first');
  await store.configure({ enabled: false, tiers: [{ minAmount: 1000, items: ['a', 'b', 'c'] }], spinMode: 'repeat', maxSpins: 5, revision: 0 });
  await assert.rejects(service.test({ amount: 999 }), e => e.status === 400);
  await assert.rejects(service.test({ amount: 1000, extra: 1 }), e => e.status === 400);
  const created = await service.test({ nickname: ' 방송 테스트\u0007 ', amount: 3000 });
  assert.equal(created.length, 3);
  assert.ok(created.every(e => e.test === true && e.nickname === '방송 테스트' && e.resultId === undefined));
  assert.deepEqual(operations.read(), { revision: 0 }, 'no roulette history or Operations write');
  await assert.rejects(service.test({ amount: 1000 }), e => e.status === 429, 'test spam is throttled');
  clock += 5000; locked = true;
  await assert.rejects(service.test({ amount: 1000 }), e => e.status === 423);
  const view = publicDonationEvents(store.snapshot().events);
  assert.ok(view.every(e => e.test === true)); assert.deepEqual(view.map(e => e.spin), [3, 2, 1]);
  assert.equal(workspaceRouteAllowed('POST', '/api/donation-roulette/test'), true);
  assert.equal(dashboardCapabilityForRequest('POST', '/api/donation-roulette/test'), 'broadcast');
  await service.close();
});

test('OBS page labels test donations and shows which spin of a multi-spin donation is playing', async t => {
  const html = await readFile(new URL('../public/donation-roulette.html', import.meta.url), 'utf8'), source = await readFile(new URL('../public/donation-roulette.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.invalid/broadcast/donation-roulette?token=abc', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  let events = [], pending = [];
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.setTimeout = (fn, ms) => { pending.push({ fn, ms }); return pending.length; };
  dom.window.eval(source); await settle();
  const spin = n => ({ id: 'donation-t-' + n, at: 5, status: 'spun', test: true, nickname: '테스트', amount: 2000, tierMin: 1000, spin: n, spins: 2, entries: ['a', 'b'], winnerIndex: 1, winner: 'b' });
  events = [spin(2), spin(1)];
  const poll = pending.find(p => p.ms >= 2000); pending = []; poll.fn(); await settle();
  const donor = dom.window.document.getElementById('donor').textContent;
  assert.match(donor, /^\[테스트\] 테스트님 2,000치즈/); assert.match(donor, /1\/2회/); assert.match(donor, /테스트 후원/);
});

test('donation tiers follow the 99-item / 30-character rule but older saved tiers still load', async t => {
  const store = await tempStore(t);
  await assert.rejects(store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: Array.from({ length: 100 }, (_, i) => 'x' + i) }], revision: 0 }), /2~99개/);
  await assert.rejects(store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: ['가'.repeat(31), 'b'] }], revision: 0 }), /1~30자/);
  const saved = await store.configure({ enabled: true, tiers: [{ minAmount: 1000, items: Array.from({ length: 99 }, (_, i) => 'x' + i) }], revision: 0 });
  assert.equal(saved.settings.tiers[0].items.length, 99);
  // A file written before the limit change (100 items, 80-character item) must keep loading.
  const { writeFile } = await import('node:fs/promises');
  const legacy = { version: 1, revision: 3, settings: { enabled: true, tiers: [{ minAmount: 500, items: ['가'.repeat(80), ...Array.from({ length: 99 }, (_, i) => 'y' + i)] }] }, events: [] };
  await writeFile(store.file, JSON.stringify(legacy));
  const reloaded = new DonationRouletteStore(store.file.replace(/\.donation-roulette\.json$/, '') + '-copy');
  await writeFile(reloaded.file, JSON.stringify(legacy));
  await reloaded.init();
  assert.equal(reloaded.snapshot().settings.tiers[0].items.length, 100);
});
