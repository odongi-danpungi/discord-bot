import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createViewerAuth } from '../src/viewer.js';
import { RegistrationStore } from '../src/store.js';
import { OperationsStore } from '../src/operations.js';
import { DemoDiscordService } from '../src/discord-service.js';
import { FeatureVisibilityStore } from '../src/feature-visibility.js';
import { LotteryBoardStore } from '../src/lottery-board.js';

// Practice mode only. All data is fictional; nothing reaches Discord, Naver or CHZZK.
async function fixture(t, demo) {
  const dir = await mkdtemp(path.join(tmpdir(), 'practice-portal-')), file = path.join(dir, 'operations.json');
  const store = new RegistrationStore(path.join(dir, 'registrations.json')), operations = new OperationsStore(file);
  const featureVisibilityStore = new FeatureVisibilityStore(file), lotteryBoardStore = new LotteryBoardStore(file);
  for (const s of [store, operations, featureVisibilityStore, lotteryBoardStore]) await s.init();
  const config = { host: '127.0.0.1', guildId: 'demo', demo, dashboardUser: 'admin', dashboardPassword: 'test-password-1234' };
  const runtime = createApp({ config, store, operations, discord: new DemoDiscordService(), viewerAuth: createViewerAuth(), featureVisibilityStore, lotteryBoardStore });
  const server = await new Promise(resolve => { const s = runtime.app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { runtime.close?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, featureVisibilityStore };
}

test('the practice portal exists only in demo mode and keeps hidden features refused on the server', async t => {
  const prod = await fixture(t, false);
  // Outside practice mode these paths fall through to the normal dashboard page: no fake session, server or workspace data.
  for (const url of ['/portal/api/servers', '/portal/api/servers/demo', '/portal/auth/session', '/w/demo/api/lottery-board', '/w/demo/obs']) {
    const response = await fetch(prod.base + url);
    assert.doesNotMatch(response.headers.get('content-type') || '', /json/, url);
    assert.doesNotMatch(await response.text(), /연습 방송 서버|연습 운영자|lotteryBoardUrl/, url);
  }

  const demo = await fixture(t, true);
  assert.equal((await fetch(demo.base + '/portal/')).status, 200);
  assert.equal((await fetch(demo.base + '/portal/workspace-admin.js')).status, 404, 'creator files are not served from the practice portal');
  const session = await (await fetch(demo.base + '/portal/auth/session')).json();
  assert.equal(session.authenticated, true); assert.equal(typeof session.csrf, 'string');
  assert.deepEqual((await (await fetch(demo.base + '/portal/api/servers')).json()).servers.map(s => s.id), ['demo']);
  assert.equal((await (await fetch(demo.base + '/portal/api/servers/demo')).json()).role, 'operator');
  assert.equal((await fetch(demo.base + '/w/demo/api/lottery-board')).status, 200);
  const obs = await (await fetch(demo.base + '/w/demo/obs')).json();
  assert.match(obs.lotteryBoardUrl, /\/broadcast\/lottery-board$/);

  const { revision } = demo.featureVisibilityStore.snapshot();
  await demo.featureVisibilityStore.configure({ hidden: { operator: ['lottery-board'], viewer: [] }, revision });
  assert.deepEqual((await (await fetch(demo.base + '/portal/api/servers/demo')).json()).hiddenPages, ['lottery-board']);
  assert.equal((await fetch(demo.base + '/w/demo/api/lottery-board')).status, 403);
  const blocked = await fetch(demo.base + '/w/demo/api/lottery-board/test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ number: 7 }) });
  assert.equal(blocked.status, 403); assert.match((await blocked.json()).error, /숨긴 기능/);
});
