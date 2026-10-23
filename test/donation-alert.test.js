import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { ALERT_DEFAULT_TEMPLATE, DonationAlertService, DonationAlertStore, installDonationAlertRoutes, validateDonationAlertInput } from '../src/donation-alert.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';
import { hiddenFeatureFor, OPERATOR_PAGES } from '../src/feature-visibility.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32), SECRET_TEXT = '비밀메시지-xyz';
async function setup(t, { now = () => 1_700_000_000_000 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'donation-alert-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'operations.json'), store = new DonationAlertStore(file); await store.init();
  const sessions = [], verification = { summary: () => ({ ownerConnected: true }), targetChannelId: () => CHANNEL, ownerToken: async () => 'fixture-owner-token', store: { subscribe: () => () => {} } };
  const service = new DonationAlertService({ store, chzzkVerification: verification, now,
    sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed', detail: '' }) }; sessions.push(s); return s; } });
  t.after(() => service.close());
  return { file, store, service, sessions };
}
const input = (store, patch = {}) => { const { settings, revision } = store.snapshot(); return { ...settings, revision, ...patch }; };
const donation = (amount, text = '', channelId = CHANNEL) => ({ donationType: 'CHAT', channelId, donatorChannelId: 'd'.repeat(32), donatorNickname: '봄이', payAmount: String(amount), donationText: text });

test('settings validate the template, amounts, duration and the latest revision', async t => {
  const { store } = await setup(t);
  assert.equal(store.snapshot().settings.template, ALERT_DEFAULT_TEMPLATE);
  assert.equal(store.snapshot().settings.enabled, false, 'off by default');
  for (const bad of [{ template: '' }, { template: 'x'.repeat(61) }, { minAmount: 0 }, { minAmount: 1000001 }, { durationSeconds: 2 }, { durationSeconds: 21 }, { sound: 'yes' }, { extra: 1 }]) {
    await assert.rejects(store.configure(input(store, bad)), { status: 400 }, JSON.stringify(bad));
  }
  assert.throws(() => validateDonationAlertInput({ ...input(store), revision: -1 }), { status: 400 });
  const saved = await store.configure(input(store, { enabled: true, template: '  {닉네임}님\n고마워요 {금액}!  ', minAmount: 500 }));
  assert.equal(saved.settings.template, '{닉네임}님 고마워요 {금액}!', 'control characters and extra spaces are removed');
  await assert.rejects(store.configure(input(store, { revision: 0 })), { status: 409 });
});

test('donations on the connected channel above the minimum become alerts kept only in memory', async t => {
  const { file, store, service, sessions } = await setup(t);
  service.sync(); assert.equal(sessions.length, 0, 'no CHZZK session while off');
  await store.configure(input(store, { enabled: true, minAmount: 1000 })); service.sync();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].on, true);
  assert.equal(service.receive(donation(5000, SECRET_TEXT, OTHER)), false);
  assert.equal(service.receive(donation(999, SECRET_TEXT)), false);
  assert.equal(service.receive({ channelId: CHANNEL, payAmount: 'x' }), false);
  const alert = service.receive(donation('3,000', `  ${SECRET_TEXT}\u0007 `));
  assert.deepEqual({ nickname: alert.nickname, amount: alert.amount, message: alert.message }, { nickname: '봄이', amount: 3000, message: SECRET_TEXT });
  assert.deepEqual(service.status().ignored, { otherChannel: 1, belowMinimum: 1 });
  assert.equal(service.status().verification, 'pending');
  const feed = service.feed(0, 'old-boot');
  assert.equal(feed.alerts.length, 1); assert.equal(feed.alerts[0].message, SECRET_TEXT);
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

test('test alerts are labelled, ignore the minimum and are rate limited', async t => {
  let clock = 1_700_000_000_000;
  const { store, service } = await setup(t, { now: () => clock });
  await store.configure(input(store, { minAmount: 50000 }));
  for (const bad of [{}, { amount: 0 }, { amount: 1000, nickname: 3 }, { amount: 1000, extra: 1 }]) assert.throws(() => service.test(bad), { status: 400 });
  const alert = service.test({ amount: 1000, message: '화이팅' });
  assert.deepEqual({ test: alert.test, nickname: alert.nickname, amount: alert.amount, message: alert.message }, { test: true, nickname: '테스트', amount: 1000, message: '화이팅' });
  assert.throws(() => service.test({ amount: 1000 }), { status: 429 });
  clock += 1000; assert.equal(service.test({ amount: 2000, nickname: '연습' }).nickname, '연습');
});

test('alert routes are workspace product routes with the broadcast capability and can be hidden', async t => {
  for (const [method, url] of [['GET', '/api/donation-alert'], ['POST', '/api/donation-alert'], ['POST', '/api/donation-alert/test']]) {
    assert.equal(workspaceRouteAllowed(method, url), true, url); assert.equal(dashboardCapabilityForRequest(method, url), 'broadcast', url);
  }
  assert.equal(workspaceRouteAllowed('GET', '/api/donation-alert/test'), false);
  assert.ok(OPERATOR_PAGES.includes('obs-alert'));
  assert.equal(hiddenFeatureFor({ operator: ['obs-alert'], viewer: [] }, { path: '/api/donation-alert/test' }), 'obs-alert');
  assert.equal(hiddenFeatureFor({ operator: ['obs-alert'], viewer: [] }, { path: '/obs' }), null, 'the shared OBS address stays while other OBS screens are visible');

  const { store, service } = await setup(t); let locked = false;
  const app = express(); app.use(express.json());
  installDonationAlertRoutes({ app, store, service, guard: () => { if (locked) throw Object.assign(Error('locked'), { status: 423 }); } });
  app.use((e, _q, res, _n) => res.status(e.status || 500).json({ error: e.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); }); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const view = await (await fetch(base + '/api/donation-alert')).json();
  assert.equal(view.status.state, 'disabled'); assert.deepEqual(view.recent, []);
  assert.equal((await post('/api/donation-alert/test', { amount: 1000 })).status, 200);
  locked = true;
  assert.equal((await post('/api/donation-alert', input(store, { enabled: true }))).status, 423, 'emergency lock blocks changes');
  assert.equal((await post('/api/donation-alert/test', { amount: 1000 })).status, 423);
});
