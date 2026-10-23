import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { ChzzkSessionHub, normalizeDonationDonor } from '../src/chzzk-session.js';
import { CardFlipService, CardFlipStore, cardFlipDay, decodeCardImage, validateCardFlipInput } from '../src/card-flip.js';
import { installCardFlipRoutes, installCardFlipViewerRoutes } from '../src/card-flip-routes.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32), DONOR = 'd'.repeat(32), STRANGER = 'e'.repeat(32);
const VIEWER = '123456789012345678', VIEWER2 = '223456789012345678';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 2)]);
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

async function setup(t, { now = () => 1_700_000_000_000, linked = [{ userId: VIEWER, channelId: DONOR }], queue = null } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'card-flip-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new CardFlipStore(path.join(dir, 'operations.json')); await store.init();
  const sessions = [], verification = { summary: () => ({ ownerConnected: true }), targetChannelId: () => CHANNEL, ownerToken: async () => 'fixture-owner-token', store: { read: () => ({ users: linked }), subscribe: () => () => {} } };
  // Deterministic shuffle: j = 0 keeps a predictable order, enough to reason about outcomes.
  const service = new CardFlipService({ store, chzzkVerification: verification, participationQueue: queue, now, random: () => 0,
    sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed', detail: '' }) }; sessions.push(s); return s; } });
  t.after(() => service.close());
  return { dir, store, service, sessions };
}
const settingsInput = (store, patch = {}) => { const { settings, revision } = store.snapshot(); return { enabled: true, need: settings.need, cards: settings.cards.map(({ id, reward }) => ({ id, reward })), chances: structuredClone(settings.chances), revision, ...patch }; };
const donation = (overrides = {}) => ({ donationType: 'CHAT', channelId: CHANNEL, donatorChannelId: DONOR, donatorNickname: '봄이', payAmount: '3000', donationText: '', ...overrides });

test('the CHZZK hub delivers one event type to every lease that started', async () => {
  const made = [], got = [];
  const hub = new ChzzkSessionHub({ defer: fn => fn(), sessionFactory: options => { const s = { options, start() {}, stop() {}, eventStatus: () => ({ status: 'subscribed' }), status: () => ({ events: {} }) }; made.push(s); return s; } });
  const a = hub.lease('DONATION', { accessToken: async () => 't', onEvent: p => got.push(['A', p]) });
  const b = hub.lease('DONATION', { accessToken: async () => 't', onEvent: p => { got.push(['B', p]); throw Error('one feature failing'); } });
  a.start(); b.start();
  assert.deepEqual(Object.keys(made.at(-1).options.handlers), ['DONATION']);
  assert.equal(await made.at(-1).options.handlers.DONATION('x'), true);
  assert.deepEqual(got, [['A', 'x'], ['B', 'x']]);
  b.stop(); got.length = 0;
  await made.at(-1).options.handlers.DONATION('y');
  assert.deepEqual(got, [['A', 'y']]);
  hub.close();
});

test('donor channel ids are read only for matching and need a valid donor', () => {
  assert.deepEqual(normalizeDonationDonor(donation()), { channelId: CHANNEL, donorChannelId: DONOR, amount: 3000 });
  assert.equal(normalizeDonationDonor(donation({ donatorChannelId: 'anonymous' })), null);
  assert.equal(normalizeDonationDonor(donation({ payAmount: '0' })), null);
});

test('settings validate cards, rewards, chances and the latest revision', async t => {
  const { store, service } = await setup(t);
  const base = settingsInput(store);
  assert.equal(base.cards.length, 6);
  for (const bad of [{ need: 4 }, { cards: base.cards.slice(0, 1) }, { cards: [...base.cards, ...base.cards.slice(0, 3).map(c => ({ reward: c.reward }))] },
    { cards: [{ reward: '' }, ...base.cards.slice(1)] }, { cards: [{ reward: 'x'.repeat(21) }, ...base.cards.slice(1)] },
    { chances: { ...base.chances, dailyMax: 21 } }, { chances: { ...base.chances, cheese: { enabled: true, amount: 50, count: 1 } } }, { extra: true }])
    assert.throws(() => validateCardFlipInput({ ...base, ...bad }, store.read().settings), Object.keys(bad)[0]);
  assert.throws(() => validateCardFlipInput({ ...base, cards: [{ id: 'c00000000', reward: '모르는 카드' }, ...base.cards.slice(1)] }, store.read().settings), e => e.status === 409);
  const saved = await service.configure({ ...base, need: 3, cards: [...base.cards.slice(0, 2), { reward: '새 상품' }] });
  assert.equal(saved.settings.need, 3); assert.equal(saved.settings.cards.length, 3); assert.match(saved.settings.cards[2].id, /^c[a-f0-9]{8}$/);
  await assert.rejects(service.configure(base), e => e.status === 409);
});

test('a game never loses: flipping ends on the first card that reaches the target, and the deck stays on the server', async t => {
  const { store, service } = await setup(t);
  await service.configure(settingsInput(store));
  await assert.rejects(service.newGame(VIEWER), e => e.status === 409 && /기회/.test(e.message));
  await service.credit(VIEWER, 1, 'direct');
  let view = await service.newGame(VIEWER);
  assert.equal(view.chances, 0); assert.equal(view.game.total, 12); assert.deepEqual(view.game.open, []);
  assert.equal(JSON.stringify(view).includes('deck'), false, 'the viewer never receives the deck');
  await assert.rejects(service.newGame(VIEWER), e => e.status === 409, 'one game at a time');
  let flips = 0;
  for (let index = 0; !view.game.done; index++) { view = await service.flip(VIEWER, { gameId: view.game.id, index }); flips++; }
  assert.ok(flips >= 2 && flips <= 7, 'with 6 cards × 2 someone must match within 7 flips');
  const won = view.cards.find(card => card.id === view.game.win);
  assert.equal(view.game.open.filter(o => o.card === view.game.win).length, 2);
  assert.deepEqual(view.rewards.map(r => [r.reward, r.status]), [[won.reward, 'ready']]);
  const after = await service.flip(VIEWER, { gameId: view.game.id, index: 11 });
  assert.equal(after.game.open.length, view.game.open.length, 'a finished game does not change');
  await assert.rejects(service.flip(VIEWER, { gameId: 'g00000000', index: 0 }), e => e.status === 409);
  const used = await service.requestUse(VIEWER, { rewardId: view.rewards[0].id });
  assert.equal(used.rewards[0].status, 'requested');
  await service.resolveReward({ userId: VIEWER, rewardId: view.rewards[0].id });
  assert.equal(service.view(VIEWER).rewards[0].status, 'done');
});

test('changing the deck cancels unfinished games and returns the chance', async t => {
  const { store, service } = await setup(t);
  await service.configure(settingsInput(store)); await service.credit(VIEWER, 1, 'direct');
  const view = await service.newGame(VIEWER);
  await service.flip(VIEWER, { gameId: view.game.id, index: 0 });
  await service.configure(settingsInput(store, { need: 3 }));
  assert.equal(service.view(VIEWER).game, null); assert.equal(service.view(VIEWER).chances, 1);
});

test('join and cheese chances follow the daily limit; direct grants and restarts never double count', async t => {
  let now = 1_700_000_000_000;
  const entries = [{ status: 'joined', discordUserId: VIEWER, sessionId: 's1', round: 1 }, { status: 'waiting', discordUserId: VIEWER2, sessionId: 's1', round: 1 }];
  const listeners = [], queue = { read: () => ({ entries }), subscribe: fn => { listeners.push(fn); return () => {}; } };
  const { store, service } = await setup(t, { now: () => now, queue });
  await service.configure(settingsInput(store, { chances: { join: { enabled: true, count: 2 }, cheese: { enabled: true, amount: 1000, count: 1 }, dailyMax: 3 } }));
  await service.awardJoins(); await service.awardJoins();
  assert.equal(service.view(VIEWER).chances, 2, 'one award per game round');
  assert.equal(service.view(VIEWER2).chances, 0, 'only joined participants');
  assert.equal(await service.receiveDonation(donation({ payAmount: '5000' })), true);
  assert.equal(service.view(VIEWER).chances, 3, 'cheese chances stop at the daily limit');
  await service.credit(VIEWER, 2, 'direct');
  assert.equal(service.view(VIEWER).chances, 5, 'the streamer can grant beyond the daily limit');
  now += 24 * 3600 * 1000;
  assert.notEqual(cardFlipDay(now), cardFlipDay(now - 24 * 3600 * 1000));
  await service.receiveDonation(donation({ payAmount: '1000' }));
  assert.equal(service.view(VIEWER).chances, 6, 'a new day starts a new limit');
  const raw = await readFile(store.file, 'utf8');
  assert.equal(raw.includes(DONOR), false, 'the donor CHZZK channel id is never written');
  assert.equal(raw.includes('봄이'), false, 'the donor nickname is never written');
});

test('donations credit only linked viewers on the connected channel, and only while cheese chances are on', async t => {
  const { store, service, sessions } = await setup(t);
  service.sync(); assert.equal(sessions.length, 0, 'off by default');
  await service.configure(settingsInput(store, { chances: { join: { enabled: false, count: 1 }, cheese: { enabled: true, amount: 1000, count: 2 }, dailyMax: 20 } })); service.sync(); await settle();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].on, true);
  assert.equal(await service.receiveDonation(donation({ channelId: OTHER })), false);
  assert.equal(await service.receiveDonation(donation({ donatorChannelId: STRANGER })), false);
  assert.equal(await service.receiveDonation(donation({ payAmount: '999' })), false);
  assert.equal(await service.receiveDonation(donation({ payAmount: '2500' })), true);
  assert.equal(service.view(VIEWER).chances, 4);
  assert.deepEqual(service.status().ignored, { otherChannel: 1, unlinked: 1 });
  assert.equal(service.status().verification, 'pending');
  await service.configure(settingsInput(store, { chances: { join: { enabled: false, count: 1 }, cheese: { enabled: false, amount: 1000, count: 2 }, dailyMax: 20 } })); await settle();
  assert.equal(sessions[0].on, false);
});

test('card pictures accept only real PNG, JPG or WEBP up to 1 MB and old files are removed', async t => {
  const { store, service } = await setup(t);
  assert.throws(() => decodeCardImage('image/gif', PNG.toString('base64')), /PNG·JPG·WEBP/);
  assert.throws(() => decodeCardImage('image/png', JPG.toString('base64')), /형식/);
  assert.throws(() => decodeCardImage('image/png', 'not base64!'), /PNG·JPG·WEBP/);
  assert.throws(() => decodeCardImage('image/png', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]).toString('base64')), e => e.status === 413);
  const card = store.read().settings.cards[0].id;
  let result = await service.saveImage({ cardId: card, type: 'image/png', data: PNG.toString('base64'), revision: store.read().revision });
  const first = result.settings.cards[0].image.file;
  assert.match(first, new RegExp(`^${card}-[a-f0-9]{16}\\.png$`));
  assert.deepEqual((await service.image(first)).bytes, PNG);
  await assert.rejects(service.saveImage({ cardId: card, type: 'image/jpeg', data: JPG.toString('base64'), revision: 0 }), e => e.status === 409);
  result = await service.saveImage({ cardId: card, type: 'image/jpeg', data: JPG.toString('base64'), revision: store.read().revision });
  assert.deepEqual(await readdir(store.imagesDir), [result.settings.cards[0].image.file], 'the replaced picture is deleted');
  await assert.rejects(service.image(first), e => e.status === 404);
  await assert.rejects(service.image('../operations.json'), e => e.status === 404);
  const input = settingsInput(store); input.cards = input.cards.slice(1);
  await service.configure(input);
  assert.deepEqual(await readdir(store.imagesDir), [], 'a removed card takes its picture with it');
});

test('card flip routes are workspace product routes with the broadcast capability', () => {
  for (const [method, url] of [['GET', '/api/card-flip'], ['POST', '/api/card-flip'], ['POST', '/api/card-flip/image'], ['POST', '/api/card-flip/image/remove'], ['POST', '/api/card-flip/grant'], ['POST', '/api/card-flip/reward'], ['GET', '/api/card-flip/image/c0123abcd-0123456789abcdef.png']]) {
    assert.equal(workspaceRouteAllowed(method, url), true, url);
    assert.equal(dashboardCapabilityForRequest(method, url), 'broadcast', url);
  }
  for (const url of ['/api/card-flip/image/../x.png', '/api/card-flip/image/c0123abcd-0123.gif']) assert.equal(workspaceRouteAllowed('GET', url), false, url);
  assert.equal(workspaceRouteAllowed('POST', '/api/card-flip/image/c0123abcd-0123456789abcdef.png'), false);
});

test('viewer and streamer routes keep each viewer to their own game and need a registered profile', async t => {
  const { store, service } = await setup(t);
  await service.configure(settingsInput(store)); await service.credit(VIEWER, 1, 'direct');
  const viewerApp = express(), router = express.Router();
  viewerApp.use(express.json());
  router.use((req, _res, next) => { req.viewer = { userId: req.get('X-Test-User') }; next(); });
  installCardFlipViewerRoutes(router, { service: () => service, registered: id => id === VIEWER || id === VIEWER2 });
  router.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  viewerApp.use('/viewer', router);
  const admin = express(); admin.use(express.json());
  installCardFlipRoutes({ app: admin, service, profiles: () => [{ userId: VIEWER, name: '테스트 시청자' }] });
  admin.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const listen = app => new Promise(resolve => { const server = app.listen(0, () => resolve(server)); t.after(() => server.close()); });
  const [vs, as] = await Promise.all([listen(viewerApp), listen(admin)]);
  const call = (server, url, user, body) => fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Test-User': user || '' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await call(vs, '/viewer/api/card-flip', '323456789012345678')).status, 403, 'unregistered viewers cannot play');
  const game = await (await call(vs, '/viewer/api/card-flip/new', VIEWER, {})).json();
  assert.equal((await call(vs, '/viewer/api/card-flip/flip', VIEWER2, { gameId: game.game.id, index: 0 })).status, 409, 'another viewer cannot flip this game');
  assert.equal((await call(vs, '/viewer/api/card-flip/new', VIEWER, { extra: 1 })).status, 400);
  const adminView = await (await call(as, '/api/card-flip')).json();
  assert.deepEqual(adminView.viewers, [{ userId: VIEWER, name: '테스트 시청자' }]);
  assert.equal((await call(as, '/api/card-flip/grant', null, { userId: VIEWER2, count: 1 })).status, 404, 'only registered viewers can receive chances');
  const granted = await (await call(as, '/api/card-flip/grant', null, { userId: VIEWER, count: 2 })).json();
  assert.equal(granted.added, 2); assert.equal(granted.grants[0].source, 'direct');
  assert.equal((await call(as, '/api/card-flip/grant', null, { userId: VIEWER, count: 11 })).status, 400);
});
