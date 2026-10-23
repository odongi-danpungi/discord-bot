import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { ALERT_DEFAULT_TEMPLATE, DonationAlertService, DonationAlertStore, decodeAlertMedia, installDonationAlertRoutes, tierFor, validateDonationAlertInput } from '../src/donation-alert.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';
import { hiddenFeatureFor, OPERATOR_PAGES } from '../src/feature-visibility.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32), SECRET_TEXT = '비밀메시지-xyz';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(24, 2)]);
const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(24, 3)]);
const WAV = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVE', 'latin1'), Buffer.alloc(20)]);
async function setup(t, { now = () => 1_700_000_000_000 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'donation-alert-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'operations.json'), store = new DonationAlertStore(file); await store.init();
  const sessions = [], verification = { summary: () => ({ ownerConnected: true }), targetChannelId: () => CHANNEL, ownerToken: async () => 'fixture-owner-token', store: { subscribe: () => () => {} } };
  const service = new DonationAlertService({ store, chzzkVerification: verification, now,
    sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed', detail: '' }) }; sessions.push(s); return s; } });
  t.after(() => service.close());
  return { dir, file, store, service, sessions };
}
const input = (store, patch = {}) => { const { settings, revision } = store.snapshot(); return { enabled: settings.enabled, durationSeconds: settings.durationSeconds, sound: settings.sound, showMessage: settings.showMessage, tiers: settings.tiers.map(({ id, minAmount, template }) => ({ id, minAmount, template })), revision, ...patch }; };
const donation = (amount, text = '', channelId = CHANNEL) => ({ donationType: 'CHAT', channelId, donatorChannelId: 'd'.repeat(32), donatorNickname: '봄이', payAmount: String(amount), donationText: text });

test('settings validate tiers, templates, duration and the latest revision', async t => {
  const { store } = await setup(t);
  assert.equal(store.snapshot().settings.tiers[0].template, ALERT_DEFAULT_TEMPLATE);
  assert.equal(store.snapshot().settings.enabled, false, 'off by default');
  const one = store.snapshot().settings.tiers[0];
  for (const bad of [{ tiers: [] }, { tiers: [{ minAmount: 1, template: '' }] }, { tiers: [{ minAmount: 1, template: 'x'.repeat(61) }] }, { tiers: [{ minAmount: 0, template: 'a' }] },
    { tiers: [{ minAmount: 5, template: 'a' }, { minAmount: 5, template: 'b' }] }, { tiers: Array.from({ length: 6 }, (_, i) => ({ minAmount: i + 1, template: 'a' })) },
    { durationSeconds: 2 }, { durationSeconds: 21 }, { sound: 'yes' }, { extra: 1 }]) {
    await assert.rejects(store.configure(input(store, bad)), { status: 400 }, JSON.stringify(bad));
  }
  await assert.rejects(store.configure(input(store, { tiers: [{ id: 't12345678', minAmount: 1, template: 'a' }] })), { status: 409 }, 'unknown tier id');
  assert.throws(() => validateDonationAlertInput({ ...input(store), revision: -1 }), { status: 400 });
  const saved = await store.configure(input(store, { enabled: true, tiers: [{ minAmount: 10000, template: '  큰 후원 {닉네임}\n{금액}!  ' }, { id: one.id, minAmount: 1000, template: one.template }] }));
  assert.deepEqual(saved.settings.tiers.map(t => t.minAmount), [1000, 10000], 'tiers are sorted by amount');
  assert.equal(saved.settings.tiers[1].template, '큰 후원 {닉네임} {금액}!', 'control characters and extra spaces are removed');
  await assert.rejects(store.configure(input(store, { revision: 0 })), { status: 409 });
  assert.equal(tierFor(saved.settings.tiers, 999), null);
  assert.equal(tierFor(saved.settings.tiers, 5000).minAmount, 1000);
  assert.equal(tierFor(saved.settings.tiers, 10000).minAmount, 10000);
});

test('a saved version 1 file is read as one tier and upgraded on the next save', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'donation-alert-v1-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'operations.json');
  await writeFile(file + '.donation-alert.json', JSON.stringify({ version: 1, revision: 3, settings: { enabled: true, minAmount: 500, template: '{닉네임} 고마워요', durationSeconds: 5, sound: false, showMessage: true } }));
  const store = new DonationAlertStore(file); await store.init();
  const { settings, revision } = store.snapshot();
  assert.equal(revision, 3);
  assert.deepEqual(settings.tiers, [{ id: 't00000001', minAmount: 500, template: '{닉네임} 고마워요', image: null, audio: null }]);
  assert.equal(settings.sound, false);
  await store.configure(input(store));
  assert.equal(JSON.parse(await readFile(file + '.donation-alert.json', 'utf8')).version, 2);
});

test('uploaded pictures and sounds are checked by their bytes, kept per tier and cleaned up', async t => {
  const { dir, store } = await setup(t), tier = store.snapshot().settings.tiers[0];
  assert.throws(() => decodeAlertMedia('image', 'image/png', GIF.toString('base64')), { status: 400 }, 'a GIF named PNG');
  assert.throws(() => decodeAlertMedia('image', 'image/svg+xml', PNG.toString('base64')), { status: 400 }, 'SVG is not allowed');
  assert.throws(() => decodeAlertMedia('audio', 'audio/mpeg', PNG.toString('base64')), { status: 400 });
  assert.throws(() => decodeAlertMedia('image', 'image/png', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]).toString('base64')), { status: 413 });
  assert.equal(decodeAlertMedia('audio', 'audio/wav', WAV.toString('base64')).length, WAV.length);
  const up = (kind, type, bytes) => store.saveMedia({ tierId: tier.id, kind, type, data: bytes.toString('base64'), revision: store.snapshot().revision });
  await up('image', 'image/png', PNG);
  const first = store.snapshot().settings.tiers[0].image.file;
  assert.match(first, /^t00000001-image-[a-f0-9]{16}\.png$/);
  await up('image', 'image/gif', GIF); await up('audio', 'audio/mpeg', MP3);
  const now = store.snapshot().settings.tiers[0];
  assert.match(now.image.file, /\.gif$/); assert.match(now.audio.file, /\.mp3$/);
  const files = () => readdir(path.join(dir, 'donation-alert-media'));
  assert.deepEqual((await files()).sort(), [now.audio.file, now.image.file].sort(), 'the replaced picture is removed');
  assert.deepEqual((await store.media(now.image.file)).type, 'image/gif');
  await assert.rejects(store.media('t00000001-image-0000000000000000.png'), { status: 404 });
  await assert.rejects(store.media('../operations.json'), { status: 404 });
  await assert.rejects(store.saveMedia({ tierId: tier.id, kind: 'image', type: 'image/png', data: PNG.toString('base64'), revision: 0 }), { status: 409 });
  // Saving settings keeps the media of a tier that stays, and removes the files of a tier that is gone.
  await store.configure(input(store, { durationSeconds: 8 }));
  assert.equal(store.snapshot().settings.tiers[0].audio.file, now.audio.file);
  await store.removeMedia({ tierId: tier.id, kind: 'audio', revision: store.snapshot().revision });
  assert.equal(store.snapshot().settings.tiers[0].audio, null);
  await store.configure(input(store, { tiers: [{ minAmount: 7, template: '새 구간' }] }));
  assert.deepEqual(await files(), [], 'files of removed tiers are deleted');
});

test('donations on the connected channel use their tier and stay only in memory', async t => {
  const { file, store, service, sessions } = await setup(t);
  service.sync(); assert.equal(sessions.length, 0, 'no CHZZK session while off');
  const first = store.snapshot().settings.tiers[0];
  await store.configure(input(store, { enabled: true, tiers: [{ id: first.id, minAmount: 1000, template: first.template }, { minAmount: 10000, template: '큰 후원!' }] })); service.sync();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].on, true);
  const big = store.snapshot().settings.tiers[1];
  assert.equal(service.receive(donation(5000, SECRET_TEXT, OTHER)), false);
  assert.equal(service.receive(donation(999, SECRET_TEXT)), false);
  assert.equal(service.receive({ channelId: CHANNEL, payAmount: 'x' }), false);
  const alert = service.receive(donation('3,000', `  ${SECRET_TEXT}\u0007 `));
  assert.deepEqual({ nickname: alert.nickname, amount: alert.amount, message: alert.message, tier: alert.tier }, { nickname: '봄이', amount: 3000, message: SECRET_TEXT, tier: first.id });
  assert.equal(service.receive(donation(20000)).tier, big.id);
  assert.deepEqual(service.status().ignored, { otherChannel: 1, belowMinimum: 1 });
  assert.equal(service.status().verification, 'pending');
  const feed = service.feed(0, 'old-boot');
  assert.equal(feed.alerts.length, 2); assert.equal(feed.alerts[0].message, SECRET_TEXT);
  assert.deepEqual(feed.settings.tiers.map(t => t.minAmount), [1000, 10000]);
  assert.equal(JSON.stringify(feed).includes('d'.repeat(32)), false, 'no donor channel id');
  assert.equal(service.feed(feed.last, feed.boot).alerts.length, 0, 'only newer alerts');
  assert.equal(JSON.stringify(service.recent()).includes(SECRET_TEXT), false, 'the streamer list has no messages');
  assert.equal((await readFile(file + '.donation-alert.json', 'utf8')).includes(SECRET_TEXT), false, 'the message is never saved');
  await store.configure(input(store, { showMessage: false }));
  assert.equal(service.feed(0, '').alerts[0].message, '', 'messages can be hidden from OBS');
  await store.configure(input(store, { enabled: false })); service.sync();
  assert.equal(sessions[0].on, false);
  assert.equal(service.receive(donation(5000)), false);
});

test('test alerts are labelled, use the lowest tier below the minimum and are rate limited', async t => {
  let clock = 1_700_000_000_000;
  const { store, service } = await setup(t, { now: () => clock });
  const first = store.snapshot().settings.tiers[0];
  await store.configure(input(store, { tiers: [{ id: first.id, minAmount: 50000, template: first.template }] }));
  for (const bad of [{}, { amount: 0 }, { amount: 1000, nickname: 3 }, { amount: 1000, extra: 1 }]) assert.throws(() => service.test(bad), { status: 400 });
  const alert = service.test({ amount: 1000, message: '화이팅' });
  assert.deepEqual({ test: alert.test, nickname: alert.nickname, amount: alert.amount, message: alert.message, tier: alert.tier }, { test: true, nickname: '테스트', amount: 1000, message: '화이팅', tier: first.id });
  assert.throws(() => service.test({ amount: 1000 }), { status: 429 });
  clock += 1000; assert.equal(service.test({ amount: 2000, nickname: '연습' }).nickname, '연습');
});

test('alert routes are workspace product routes with the broadcast capability and can be hidden', async t => {
  for (const [method, url] of [['GET', '/api/donation-alert'], ['POST', '/api/donation-alert'], ['POST', '/api/donation-alert/test'], ['POST', '/api/donation-alert/media'], ['POST', '/api/donation-alert/media/remove'], ['GET', '/api/donation-alert/media/t00000001-image-0123456789abcdef.gif']]) {
    assert.equal(workspaceRouteAllowed(method, url), true, url); assert.equal(dashboardCapabilityForRequest(method, url), 'broadcast', url);
  }
  for (const url of ['/api/donation-alert/media/../x.png', '/api/donation-alert/media/t00000001-image-0123.svg']) assert.equal(workspaceRouteAllowed('GET', url), false, url);
  assert.equal(workspaceRouteAllowed('GET', '/api/donation-alert/test'), false);
  assert.ok(OPERATOR_PAGES.includes('obs-alert'));
  for (const url of ['/api/donation-alert/test', '/api/donation-alert/media']) assert.equal(hiddenFeatureFor({ operator: ['obs-alert'], viewer: [] }, { path: url }), 'obs-alert');
  assert.equal(hiddenFeatureFor({ operator: ['obs-alert'], viewer: [] }, { path: '/obs' }), null, 'the shared OBS address stays while other OBS screens are visible');

  const { store, service } = await setup(t); let locked = false;
  const app = express(); app.use(express.json({ limit: '3mb' }));
  installDonationAlertRoutes({ app, store, service, guard: () => { if (locked) throw Object.assign(Error('locked'), { status: 423 }); } });
  app.use((e, _q, res, _n) => res.status(e.status || 500).json({ error: e.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); }); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const view = await (await fetch(base + '/api/donation-alert')).json();
  assert.equal(view.status.state, 'disabled'); assert.deepEqual(view.recent, []);
  assert.equal((await post('/api/donation-alert/test', { amount: 1000 })).status, 200);
  const uploaded = await post('/api/donation-alert/media', { tierId: view.settings.tiers[0].id, kind: 'image', type: 'image/png', data: PNG.toString('base64'), revision: view.revision });
  assert.equal(uploaded.status, 200);
  const name = (await uploaded.json()).settings.tiers[0].image.file, served = await fetch(base + '/api/donation-alert/media/' + name);
  assert.equal(served.headers.get('content-type'), 'image/png'); assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  locked = true;
  assert.equal((await post('/api/donation-alert', input(store, { enabled: true }))).status, 423, 'emergency lock blocks changes');
  assert.equal((await post('/api/donation-alert/test', { amount: 1000 })).status, 423);
  assert.equal((await post('/api/donation-alert/media/remove', { tierId: view.settings.tiers[0].id, kind: 'image', revision: store.snapshot().revision })).status, 423);
});
