import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ChzzkEventSession, ChzzkSessionHub, normalizeChat } from '../src/chzzk-session.js';
import { CHAT_BUFFER_LIMIT, ChatOverlayService, ChatOverlayStore, validateChatOverlayInput } from '../src/chat-overlay.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';
import { createBroadcastRouter } from '../src/broadcast.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32), SENDER = 'c'.repeat(32);
const EMOJI = 'https://nng-phinf.pstatic.net/glive/emoji/fixture.png';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

async function tempStore(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chat-overlay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ChatOverlayStore(path.join(dir, 'operations.json'));
  await store.init();
  return store;
}
const verification = (channel = CHANNEL, connected = true) => ({ summary: () => ({ ownerConnected: connected }), targetChannelId: () => channel, ownerToken: async () => 'fixture-owner-token' });
const chat = (overrides = {}) => ({ channelId: CHANNEL, senderChannelId: SENDER, chatChannelId: 'chat-fixture', profile: { nickname: '봄이', badges: [], verifiedMark: false }, userRoleCode: 'common_user', content: '안녕하세요', emojis: {}, messageTime: 1000, ...overrides });

class FakeSocket {
  static last = null;
  constructor(url) { this.url = url; this.sent = []; this.closed = false; FakeSocket.last = this; }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  emit(data) { this.onmessage?.({ data }); }
}
function manualTimers() {
  const timers = new Map(); let id = 0;
  return { set: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key; }, clear: key => timers.delete(key), timers };
}
const system = (type, data) => '42' + JSON.stringify(['SYSTEM', { type, data }]);

test('chat payloads keep only nickname, role, text and CHZZK emoji images; sender ids are dropped', () => {
  const value = normalizeChat(JSON.stringify(chat({ channelId: CHANNEL.toUpperCase(), userRoleCode: 'streaming_chat_manager', content: '하이{:dog:}{:bad:}\u0007',
    emojis: { dog: EMOJI, bad: 'https://evil.example/x.png', 'x y': EMOJI, plain: 'http://nng-phinf.pstatic.net/a.png' } })));
  assert.deepEqual(value, { channelId: CHANNEL, nickname: '봄이', role: 'manager', content: '하이{:dog:}{:bad:}', emojis: { dog: EMOJI }, at: 1000 });
  assert.equal(JSON.stringify(value).includes(SENDER), false);
  assert.equal(normalizeChat(chat({ userRoleCode: 'streamer' })).role, 'streamer');
  assert.equal(normalizeChat(chat({ userRoleCode: 'anything' })).role, 'viewer');
  assert.equal(normalizeChat(chat({ profile: {} })).nickname, '익명');
  assert.equal(normalizeChat(chat({ channelId: 'bad' })), null);
  assert.equal(normalizeChat(chat({ content: '  ' })), null);
  assert.equal(normalizeChat('not json'), null);
  assert.equal([...normalizeChat(chat({ content: 'a'.repeat(500) })).content].length, 300);
});

test('one CHZZK session subscribes donation and chat; a missing chat scope keeps donations running', async () => {
  const calls = [], chats = [], timers = manualTimers();
  const fetchImpl = async url => { calls.push(String(url)); const u = String(url);
    if (u.includes('/sessions/auth')) return { ok: true, status: 200, json: async () => ({ content: { url: 'https://ssio08.nchat.naver.com/?auth=S' } }) };
    if (u.includes('/subscribe/chat')) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) }; };
  const session = new ChzzkEventSession({ accessToken: async () => 't', handlers: { DONATION: () => {}, CHAT: p => chats.push(normalizeChat(p)) }, fetchImpl, WebSocketImpl: FakeSocket, setTimer: timers.set, clearTimer: timers.clear });
  session.start(); await settle();
  const socket = FakeSocket.last; socket.emit('0{}'); socket.emit(system('connected', { sessionKey: 'KEY' })); await settle();
  assert.deepEqual(calls.filter(u => u.includes('/subscribe/')).map(u => [new URL(u).pathname, new URL(u).searchParams.get('sessionKey')]),
    [['/open/v1/sessions/events/subscribe/donation', 'KEY'], ['/open/v1/sessions/events/subscribe/chat', 'KEY']]);
  assert.equal(calls.filter(u => u.includes('/sessions/auth')).length, 1, 'one user session for both event types');
  assert.equal(socket.closed, false);
  assert.equal(session.eventStatus('DONATION').status, 'subscribed');
  assert.equal(session.eventStatus('CHAT').status, 'auth_required'); assert.match(session.eventStatus('CHAT').detail, /채팅 메시지 조회 권한/);
  socket.emit('42' + JSON.stringify(['CHAT', chat()])); await settle();
  assert.equal(chats.length, 1);
  socket.emit(system('revoked', { eventType: 'DONATION', channelId: CHANNEL })); await settle();
  assert.equal(session.status().status, 'auth_required'); assert.equal(socket.closed, true, 'every event type refused -> long back-off');
  session.stop();
});

test('revoking only chat keeps the shared session and donation subscription', async () => {
  const timers = manualTimers();
  const fetchImpl = async url => ({ ok: true, status: 200, json: async () => ({ content: String(url).includes('/sessions/auth') ? { url: 'https://ssio01.nchat.naver.com/?auth=S' } : {} }) });
  const session = new ChzzkEventSession({ accessToken: async () => 't', handlers: { DONATION: () => {}, CHAT: () => {} }, fetchImpl, WebSocketImpl: FakeSocket, setTimer: timers.set, clearTimer: timers.clear });
  session.start(); await settle();
  const socket = FakeSocket.last; socket.emit('0{}'); socket.emit(system('connected', { sessionKey: 'K' })); await settle();
  assert.equal(session.eventStatus('CHAT').status, 'subscribed');
  socket.emit(system('revoked', { eventType: 'CHAT', channelId: CHANNEL })); await settle();
  assert.equal(socket.closed, false);
  assert.equal(session.eventStatus('CHAT').status, 'auth_required'); assert.equal(session.eventStatus('DONATION').status, 'subscribed');
  session.stop();
});

test('the hub shares one session between leases and rebuilds it when the leased event types change', async () => {
  const made = [];
  const hub = new ChzzkSessionHub({ defer: fn => fn(), sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, eventStatus: type => ({ status: 'subscribed', type }), status: () => ({ events: {} }) }; made.push(s); return s; } });
  const got = [];
  const donation = hub.lease('DONATION', { accessToken: async () => 't', onEvent: p => got.push(['D', p]) });
  const chatLease = hub.lease('CHAT', { accessToken: async () => 't', onEvent: p => got.push(['C', p]) });
  donation.start(); chatLease.start();
  assert.equal(made.length, 2); assert.equal(made[0].on, false); assert.equal(made[1].on, true);
  assert.deepEqual(Object.keys(made[1].options.handlers).sort(), ['CHAT', 'DONATION']);
  made[1].options.handlers.CHAT('x'); made[1].options.handlers.DONATION('y');
  assert.deepEqual(got, [['C', 'x'], ['D', 'y']]);
  assert.equal(chatLease.status().status, 'subscribed');
  chatLease.stop();
  assert.equal(made.length, 3); assert.deepEqual(Object.keys(made[2].options.handlers), ['DONATION']);
  hub.refresh(); assert.equal(made.length, 3, 'no rebuild while nothing waits for consent');
  made[2].status = () => ({ events: { DONATION: { status: 'auth_required' } } });
  hub.refresh(); assert.equal(made.length, 4, 'renewed consent rebuilds the session');
  donation.stop(); assert.equal(made[3].on, false);
  hub.close();
});

test('chat settings validate ranges and the latest revision', async t => {
  const store = await tempStore(t);
  assert.deepEqual(store.snapshot(), { settings: { enabled: false, maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium' }, revision: 0 });
  for (const bad of [{ maxMessages: 2 }, { maxMessages: 21 }, { hideAfterSeconds: 45 }, { fontSize: 'huge' }, { enabled: 'yes' }, { extra: 1 }])
    assert.throws(() => validateChatOverlayInput({ enabled: true, maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium', revision: 0, ...bad }), Object.keys(bad)[0]);
  const saved = await store.configure({ enabled: true, maxMessages: 12, hideAfterSeconds: 0, fontSize: 'small', revision: 0 });
  assert.equal(saved.revision, 1);
  await assert.rejects(store.configure({ enabled: false, maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium', revision: 0 }), e => e.status === 409);
});

test('chat service shows only the connected channel, keeps a short in-memory buffer and labels tests', async t => {
  const store = await tempStore(t), sessions = []; let locked = false, now = 10000;
  const service = new ChatOverlayService({ store, chzzkVerification: verification(), now: () => now, guard: () => { if (locked) throw Object.assign(Error('locked'), { status: 423 }); },
    sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed', detail: '' }) }; sessions.push(s); return s; } });
  service.sync(); assert.equal(sessions.length, 0, 'disabled by default');
  await store.configure({ enabled: true, maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium', revision: 0 }); await settle();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].on, true);
  assert.equal(service.status().state, 'subscribed'); assert.equal(service.status().verification, 'pending');
  sessions[0].options.onChat(normalizeChat(chat({ content: '<script>x</script>' })));
  sessions[0].options.onChat(normalizeChat(chat({ channelId: OTHER, content: '남의 방송' })));
  let feed = service.feed(0, '');
  assert.deepEqual(feed.messages.map(m => m.content), ['<script>x</script>']);
  assert.equal(JSON.stringify(feed).includes(SENDER), false); assert.equal(service.status().ignored.otherChannel, 1);
  assert.throws(() => service.test({ content: '' }), /내용/);
  assert.throws(() => service.test({ content: 'x', extra: 1 }));
  const tested = service.test({ nickname: '', content: '테스트 채팅' }); assert.equal(tested.test, true); assert.equal(tested.nickname, '테스트');
  assert.throws(() => service.test({ content: '또' }), e => e.status === 429);
  now += 1000; locked = true; assert.throws(() => service.test({ content: '잠금' }), e => e.status === 423); locked = false;
  for (let i = 0; i < CHAT_BUFFER_LIMIT + 5; i++) sessions[0].options.onChat(normalizeChat(chat({ content: 'm' + i })));
  feed = service.feed(0, feed.boot);
  assert.equal(feed.messages.length, CHAT_BUFFER_LIMIT); assert.equal(feed.messages.at(-1).content, 'm' + (CHAT_BUFFER_LIMIT + 4));
  assert.deepEqual(service.feed(feed.last, feed.boot).messages, [], 'nothing new after the last id');
  assert.equal(service.feed(feed.last, 'old-boot').messages.length, CHAT_BUFFER_LIMIT, 'a different boot id starts over');
  assert.deepEqual(service.clear(), { cleared: feed.last }); assert.deepEqual(service.feed(0, feed.boot).messages, []);
  await store.configure({ enabled: false, maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium', revision: 1 }); await settle();
  assert.equal(sessions[0].on, false); assert.equal(service.status().state, 'disabled');
  assert.equal(service.receive(normalizeChat(chat())), false, 'disabled overlays drop real chat');
  await service.close();
});

test('chat routes are broadcast-scoped workspace product APIs and the OBS feed needs the broadcast token', async t => {
  for (const [method, route] of [['GET', '/api/chat-overlay'], ['POST', '/api/chat-overlay'], ['POST', '/api/chat-overlay/test'], ['POST', '/api/chat-overlay/clear']]) {
    assert.equal(workspaceRouteAllowed(method, route), true, route); assert.equal(dashboardCapabilityForRequest(method, route), 'broadcast', route);
  }
  assert.equal(workspaceRouteAllowed('DELETE', '/api/chat-overlay'), false);
  const store = await tempStore(t);
  const service = new ChatOverlayService({ store, chzzkVerification: verification(), sessionFactory: () => ({ start() {}, stop() {}, status: () => ({ status: 'stopped' }) }) });
  service.test({ nickname: '봄이', content: '안녕' });
  const broadcast = createBroadcastRouter({ config: { host: '0.0.0.0', broadcastToken: 'x'.repeat(32), guildId: 'g' }, store: { read: () => [], subscribe: () => () => {} },
    operations: { read: () => ({ revision: 0 }), subscribe: () => () => {} }, version: 'test', chatFeed: () => service });
  const app = express(); app.use('/broadcast', broadcast.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { broadcast.close(); server.close(); await service.close(); });
  const base = `http://127.0.0.1:${server.address().port}/broadcast`, token = '?token=' + 'x'.repeat(32);
  assert.equal((await fetch(base + '/api/chat')).status, 403);
  assert.equal((await fetch(base + '/chat')).status, 403);
  const data = await (await fetch(base + '/api/chat' + token)).json();
  assert.deepEqual(data.messages.map(m => [m.nickname, m.content, m.test]), [['봄이', '안녕', true]]);
  const page = await fetch(base + '/chat' + token); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/\*\.pstatic\.net;/);
  assert.match((await fetch(base + '/overlay' + token)).headers.get('content-security-policy'), /img-src 'self' data:;/, 'other OBS pages keep the stricter policy');
  assert.equal((await fetch(base + '/chat-overlay.js')).status, 200);
});

test('OBS chat page renders text inertly, shows only CHZZK emoji images, trims and clears', async t => {
  const html = await readFile(new URL('../public/chat-overlay.html', import.meta.url), 'utf8'), source = await readFile(new URL('../public/chat-overlay.js', import.meta.url), 'utf8');
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, { url: 'https://example.invalid/broadcast/chat?token=abc', runScripts: 'outside-only', virtualConsole: vc });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const message = (id, extra = {}) => ({ id, at: 9000, nickname: '봄이', role: 'viewer', content: '안녕 ' + id, emojis: {}, ...extra });
  let reply = { boot: 'b1', last: 2, cleared: 0, serverTime: 10000, settings: { maxMessages: 3, hideAfterSeconds: 0, fontSize: 'large' },
    messages: [message(1, { nickname: '<i>봄이</i>', role: 'streamer', content: '<b>굵게</b>{:dog:}{:evil:}', emojis: { dog: EMOJI, evil: 'https://evil.example/x.png' } }), message(2, { test: true })] };
  const urls = [];
  dom.window.fetch = async url => { urls.push(url); return { ok: true, json: async () => structuredClone(reply) }; };
  let pending = [];
  dom.window.setTimeout = (fn, ms) => { pending.push({ fn, ms }); return pending.length; };
  const poll = async () => { const next = pending.find(p => p.ms >= 1000); pending = pending.filter(p => p !== next); next.fn(); await settle(); };
  dom.window.eval(source); await settle();
  const doc = dom.window.document, items = () => [...doc.querySelectorAll('#chat .message')];
  assert.match(urls[0], /^\/broadcast\/api\/chat\?token=abc&after=0&boot=$/);
  assert.equal(doc.getElementById('chat').dataset.size, 'large');
  assert.equal(items().length, 2);
  const first = items()[0];
  assert.equal(first.querySelector('.name').textContent, '<i>봄이</i>'); assert.equal(first.querySelector('.name i'), null);
  assert.equal(first.querySelector('.role').textContent, '스트리머');
  assert.equal(first.querySelector('.content b'), null, 'chat HTML stays text');
  assert.deepEqual([...first.querySelectorAll('img')].map(img => img.getAttribute('src')), [EMOJI], 'only CHZZK emoji hosts become images');
  assert.match(first.textContent, /\{:evil:\}/);
  assert.equal(items()[1].querySelector('.role.test').textContent, '테스트');
  reply = { ...reply, last: 4, messages: [message(3), message(4)] }; await poll();
  assert.match(urls.at(-1), /after=2&boot=b1/);
  assert.deepEqual(items().map(i => i.dataset.id), ['2', '3', '4'], 'keeps the newest maxMessages');
  reply = { ...reply, cleared: 4, messages: [] }; await poll();
  assert.equal(items().length, 0, 'operator clear empties the window');
  reply = { ...reply, boot: 'b2', last: 1, cleared: 0, messages: [message(1)] }; await poll();
  assert.deepEqual(items().map(i => i.textContent.includes('안녕 1')), [true], 'server restart starts over');
});

test('portal OBS screens: roulette guide copies the donation OBS URL; chat screen saves with the loaded revision and never claims real delivery', async t => {
  const A = '111111111111111111';
  const read = name => readFile(new URL('../public/' + name, import.meta.url), 'utf8');
  const html = await read('portal.html'), source = await read('portal.js');
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, { url: 'https://example.invalid/portal/?server=' + A, runScripts: 'outside-only', virtualConsole: vc });
  t.after(async () => { await new Promise(r => setTimeout(r, 20)); for (const n of dom.window.document.querySelectorAll('details')) n.ontoggle = null; dom.window.close(); assert.deepEqual(errors, []); });
  const chatData = { settings: { enabled: false, maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium' }, revision: 4, status: { state: 'subscribed', detail: '', verification: 'pending' },
    recent: [{ id: 1, at: Date.UTC(2026, 9, 20, 3), nickname: '<b>봄이</b>', role: 'viewer', content: '<i>안녕</i>', emojis: {}, test: true }] };
  const data = url => url === '/portal/auth/session' ? { authenticated: true, user: { name: '가상 운영자' }, csrf: 'fixture' }
    : url === '/portal/api/servers' ? { servers: [{ id: A, name: '봄별 방송', botPresent: true }] }
      : url.startsWith('/portal/api/servers/') ? { guildId: A, name: '봄별 방송', role: 'operator' }
        : url.endsWith('/api/snapshot') ? { state: { session: null }, participationQueue: { activeCount: 0 }, paused: false }
          : url.endsWith('/obs') ? { url: 'https://fixture.invalid/o', donationRouletteUrl: 'https://fixture.invalid/d?token=t', chatUrl: 'https://fixture.invalid/c?token=t' }
            : url.endsWith('/api/chat-overlay') ? chatData : {};
  const calls = [], copied = [];
  dom.window.fetch = (url, options) => { calls.push({ url, options }); return Promise.resolve({ ok: true, json: async () => structuredClone(data(url)) }); };
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text); } } });
  dom.window.newPractice = () => ({}); dom.window.practiceAction = () => ({});
  await dom.window.eval('(async()=>{' + source.replace(/^import \{newPractice,practiceAction\} from '\.\/practice-model\.js';\r?\n/, '') + ';globalThis.portalTest={page};})()');
  const doc = dom.window.document, panel = doc.getElementById('panel');
  await dom.window.portalTest.page('obs-roulette');
  assert.equal(doc.getElementById('breadcrumb').textContent, '통합 운영 / 방송 / OBS 룰렛');
  assert.match(panel.textContent, /브라우저/); assert.match(panel.textContent, /1280/);
  [...panel.querySelectorAll('button')].find(b => b.textContent === 'OBS 후원 룰렛 주소 복사').click(); await settle();
  assert.deepEqual(copied, ['https://fixture.invalid/d?token=t']);
  await dom.window.portalTest.page('obs-chat');
  assert.equal(doc.getElementById('breadcrumb').textContent, '통합 운영 / 방송 / OBS 채팅창');
  assert.match(panel.textContent, /채팅 구독 요청 완료/); assert.match(panel.textContent, /실제 채팅 수신 검증 대기/);
  assert.match(panel.textContent, /\[테스트\] <b>봄이<\/b>/); assert.equal(panel.querySelector('td b, td i'), null, 'chat stays inert text');
  doc.querySelector('.chat-form [name=enabled]').checked = true;
  doc.querySelector('.chat-form [name=maxMessages]').value = '12';
  doc.querySelector('.chat-form [name=hideAfterSeconds]').value = '0';
  doc.querySelector('.chat-form [name=fontSize]').value = 'large';
  doc.querySelector('.chat-form').requestSubmit(); await settle();
  const save = calls.find(c => c.url.endsWith('/api/chat-overlay') && c.options?.method === 'POST');
  assert.ok(save); assert.equal(save.url, '/w/' + A + '/api/chat-overlay');
  assert.deepEqual(JSON.parse(save.options.body), { enabled: true, maxMessages: 12, hideAfterSeconds: 0, fontSize: 'large', revision: 4 });
  [...doc.getElementById('panel').querySelectorAll('button')].find(b => b.textContent === 'OBS 채팅창 주소 복사').click(); await settle();
  assert.equal(copied.at(-1), 'https://fixture.invalid/c?token=t');
});
