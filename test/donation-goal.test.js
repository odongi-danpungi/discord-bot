import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DonationGoalService, DonationGoalStore } from '../src/donation-goal.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';
import { hiddenFeatureFor, OPERATOR_PAGES } from '../src/feature-visibility.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32);
async function setup(t, { now = () => 1_700_000_000_000, locked = () => false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'donation-goal-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'operations.json'), store = new DonationGoalStore(file); await store.init();
  const sessions = [], verification = { summary: () => ({ ownerConnected: true }), targetChannelId: () => CHANNEL, ownerToken: async () => 'fixture-owner-token', store: { subscribe: () => () => {} } };
  const service = new DonationGoalService({ store, chzzkVerification: verification, now, guard: () => { if (locked()) throw Object.assign(Error('locked'), { status: 423 }); },
    sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed', detail: '' }) }; sessions.push(s); return s; } });
  t.after(() => service.close());
  return { file, store, service, sessions };
}
const input = (store, patch = {}) => { const { settings, revision } = store.snapshot(); return { ...settings, revision, ...patch }; };
const donation = (amount, channelId = CHANNEL) => ({ donationType: 'CHAT', channelId, donatorChannelId: 'd'.repeat(32), donatorNickname: '비밀후원자', payAmount: String(amount), donationText: '비밀메시지' });

test('goal settings validate the title, target and the latest revision', async t => {
  const { service, store } = await setup(t);
  for (const bad of [{ title: '' }, { title: 'x'.repeat(31) }, { target: 99 }, { target: 100000001 }, { countTests: 'no' }, { extra: 1 }]) await assert.rejects(service.configure(input(store, bad)), { status: 400 }, JSON.stringify(bad));
  await service.configure(input(store, { enabled: true, title: ' 오늘\n목표 ', target: 30000 }));
  assert.deepEqual(store.snapshot().settings, { enabled: true, title: '오늘 목표', target: 30000, countTests: false });
  await assert.rejects(service.configure(input(store, { revision: 0 })), { status: 409 });
});

test('donations on the connected channel add only the amount; reset starts from zero', async t => {
  let locked = false;
  const { file, store, service, sessions } = await setup(t, { locked: () => locked });
  service.sync(); assert.equal(sessions.length, 0, 'off by default');
  await service.configure(input(store, { enabled: true })); service.sync();
  assert.equal(sessions[0].on, true);
  assert.equal(await service.receive(donation(5000, OTHER)), false);
  await service.receive(donation(3000)); await service.receive(donation('2,500'));
  assert.deepEqual({ total: store.snapshot().progress.total, count: store.snapshot().progress.count }, { total: 5500, count: 2 });
  const saved = await readFile(file + '.donation-goal.json', 'utf8');
  assert.equal(saved.includes('비밀후원자') || saved.includes('비밀메시지') || saved.includes('d'.repeat(32)), false, 'no donor data is saved');
  const feed = service.feed();
  assert.deepEqual({ title: feed.title, target: feed.target, total: feed.total }, { title: '오늘의 후원 목표', target: 50000, total: 5500 });
  locked = true;
  await assert.rejects(service.reset({ revision: store.snapshot().revision }), { status: 423 });
  locked = false;
  await assert.rejects(service.reset({ revision: 0 }), { status: 409 });
  await service.reset({ revision: store.snapshot().revision });
  assert.equal(store.snapshot().progress.total, 0);
});

test('tests only preview unless they are set to count', async t => {
  let clock = 1_700_000_000_000;
  const { store, service } = await setup(t, { now: () => clock });
  assert.deepEqual(await service.test({ amount: 1000 }), { counted: false });
  assert.equal(store.snapshot().progress.total, 0);
  assert.equal(service.feed().preview.amount, 1000);
  await assert.rejects(service.test({ amount: 1000 }), { status: 429 });
  await assert.rejects(service.test({ amount: 0 }), { status: 400 });
  clock += 11000; assert.equal(service.feed().preview, null, 'the preview fades');
  await service.configure(input(store, { countTests: true }));
  assert.equal((await service.test({ amount: 2000 })).counted, true);
  assert.equal(store.snapshot().progress.total, 2000);
});

test('goal routes are workspace product routes with the broadcast capability and can be hidden', () => {
  for (const [method, url] of [['GET', '/api/donation-goal'], ['POST', '/api/donation-goal'], ['POST', '/api/donation-goal/reset'], ['POST', '/api/donation-goal/test']]) {
    assert.equal(workspaceRouteAllowed(method, url), true, url); assert.equal(dashboardCapabilityForRequest(method, url), 'broadcast', url);
  }
  assert.ok(OPERATOR_PAGES.includes('obs-goal'));
  assert.equal(hiddenFeatureFor({ operator: ['obs-goal'], viewer: [] }, { path: '/api/donation-goal/reset' }), 'obs-goal');
});
