import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ChzzkVerification, ChzzkVerificationStore } from '../src/chzzk-verification.js';

const uid = '111111111111111111', cid = 'a'.repeat(32), ownerId = 'b'.repeat(32);
const config = { chzzkChannelId: ownerId, chzzkVerifyRoleId: '444444444444444444', chzzkVerifyNickname: true,
  publicBaseUrl: 'https://bot.example.com', chzzkClientId: 'example-client', chzzkClientSecret: 'example-secret' };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chzzk-concurrency-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new ChzzkVerificationStore(path.join(dir, 'auth.json'), randomBytes(32).toString('hex')).init();
  let clock = 1000000;
  const writes = [], service = new ChzzkVerification({ config: { ...config }, store, now: () => clock,
    discord: { applyChzzkVerification: async input => { writes.push(input); return { nicknameSynced: Boolean(input.nickname) }; } } });
  service.request = async (endpoint, options) => {
    if (endpoint === '/auth/v1/token') return { accessToken: options.body.code === 'owner' ? 'owner-example' : 'participant-example', refreshToken: 'refresh-example', expiresIn: 3600 };
    if (endpoint === '/open/v1/users/me') return { channelId: options.token === 'owner-example' ? ownerId : cid, channelName: '새 이름' };
    return { data: [{ channelId: cid }] };
  };
  await store.saveOwner({ accessToken: 'owner-example', refreshToken: 'refresh-example', channelId: ownerId, expiresAt: clock + 3600000 });
  return { store, service, writes, advance: ms => { clock += ms; } };
}
function browser(service, kind = 'participant') {
  const link = service.begin(kind, kind === 'owner' ? '' : uid);
  const next = service.start(new URL(link.url).searchParams.get('ticket'));
  return { state: new URL(next.url).searchParams.get('state'), cookie: next.cookie, code: kind === 'owner' ? 'owner' : 'participant' };
}

test('a late owner refresh cannot overwrite completed owner consent', { timeout: 5000 }, async t => {
  const f = await fixture(t), started = deferred(), release = deferred(), request = f.service.request;
  await f.store.saveOwner({ accessToken: 'expired-example', refreshToken: 'expired-refresh-example', channelId: ownerId, expiresAt: 1 });
  f.service.request = async (endpoint, options) => {
    if (options?.body?.grantType === 'refresh_token') {
      started.resolve(); await release.promise;
      return { accessToken: 'late-refresh-example', refreshToken: 'late-rotation-example', expiresIn: 3600 };
    }
    return request(endpoint, options);
  };
  const pending = f.service.ownerToken(); await started.promise;
  assert.equal((await f.service.callback(browser(f.service, 'owner'))).status, 'owner_connected');
  // New callers use the completed consent immediately, even while the old refresh is pending.
  assert.equal(await f.service.ownerToken(), 'owner-example');
  release.resolve();
  assert.equal(await pending, 'owner-example');
  assert.equal(f.store.ownerToken().accessToken, 'owner-example');
  assert.equal(f.store.ownerToken().refreshToken, 'refresh-example');
});

test('participant reauthorization waits for prior verification and applies its newest identity', { timeout: 5000 }, async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  await f.store.saveUser({ userId: uid, channelId: cid, name: '이전 이름', linkedAt: 1 });
  f.service.followers = async () => { started.resolve(); await release.promise; return { ids: new Set([cid]), complete: true }; };
  const previous = f.service.verify(uid); await started.promise;
  const callback = f.service.callback(browser(f.service));
  release.resolve();
  assert.equal((await previous).status, 'verified');
  assert.equal((await callback).status, 'verified');
  assert.equal(f.store.read().users[0].name, '새 이름');
  assert.equal(f.store.read().users[0].linkedAt, 1000000);
  assert.equal(f.writes.at(-1).name, '새 이름');
  assert.equal(f.writes.length, 2);
  await Promise.resolve(); assert.equal(f.service.userQueues.size, 0);
});

test('reauthorization of a recently verified account does not inherit its cooldown', async t => {
  const f = await fixture(t);
  await f.store.saveUser({ userId: uid, channelId: cid, name: '이전 이름' });
  await f.service.verify(uid);
  assert.equal((await f.service.callback(browser(f.service))).status, 'verified');
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes.at(-1).name, '새 이름');
  assert.equal(f.service.status(uid).nicknameSynced, true);
});

test('nickname option and name changes invalidate stored verification immediately', async t => {
  const f = await fixture(t);
  await f.store.saveUser({ userId: uid, channelId: cid, name: '이전 이름' });
  await f.service.verify(uid);
  f.service.config.chzzkVerifyNickname = false;
  assert.equal(f.service.status(uid).status, 'pending');
  assert.equal(f.service.status(uid).nicknameSynced, false);
  assert.equal(f.service.summary().verifiedCount, 0);
  await f.service.verify(uid);
  assert.equal(f.writes.at(-1).nickname, false);
  f.service.config.chzzkVerifyNickname = true;
  assert.equal(f.service.status(uid).status, 'pending');
  await f.service.verify(uid);
  await f.store.saveUser({ userId: uid, channelId: cid, name: '다른 이름' });
  assert.equal(f.service.status(uid).status, 'pending');
  await f.service.verify(uid);
  assert.equal(f.writes.at(-1).name, '다른 이름');
  assert.equal(f.writes.length, 4);
});

test('reissuing OAuth invalidates an earlier callback already awaiting identity lookup', { timeout: 5000 }, async t => {
  const f = await fixture(t), started = deferred(), release = deferred(), request = f.service.request;
  f.service.request = async (endpoint, options) => {
    if (endpoint === '/open/v1/users/me') { started.resolve(); await release.promise; }
    return request(endpoint, options);
  };
  const pending = f.service.callback(browser(f.service));
  const rejected = assert.rejects(pending, /새 인증 링크/);
  await started.promise;
  f.service.begin('participant', uid); release.resolve(); await rejected;
  assert.equal(f.store.read().users.length, 0); assert.equal(f.writes.length, 0);
});

test('a reissued link retains its full lifetime when the old attempt window expires', async t => {
  const f = await fixture(t);
  f.service.begin('participant', uid); f.advance(590000);
  const callback = browser(f.service); f.advance(20000);
  assert.equal((await f.service.callback(callback)).status, 'verified');
});

test('reissuing OAuth during follower lookup prevents the earlier callback from applying a role', { timeout: 5000 }, async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  f.service.followers = async () => { started.resolve(); await release.promise; return { ids: new Set([cid]), complete: true }; };
  const pending = f.service.callback(browser(f.service));
  const rejected = assert.rejects(pending, /새 인증 링크/);
  await started.promise;
  f.service.begin('participant', uid); release.resolve(); await rejected;
  assert.equal(f.writes.length, 0); assert.equal(f.service.status(uid).status, 'pending');
});

test('concurrent panel publishes reuse the committed reference and preserve requested channel order', { timeout: 5000 }, async t => {
  const f = await fixture(t), started = deferred(), release = deferred(), calls = [];
  const firstChannel = '555555555555555555', secondChannel = '666666666666666666';
  f.service.discord.publishChzzkVerification = async input => {
    calls.push(input);
    if (calls.length === 1) { started.resolve(); await release.promise; }
    return { channelId: input.channelId, messageId: input.ref?.channelId === input.channelId ? input.ref.messageId : `message-${calls.length}` };
  };
  const first = f.service.publishPanel(firstChannel); await started.promise;
  const repeated = f.service.publishPanel(firstChannel), changed = f.service.publishPanel(secondChannel);
  assert.equal(calls.length, 1); release.resolve();
  const [a, b, c] = await Promise.all([first, repeated, changed]);
  assert.deepEqual(a, b); assert.deepEqual(calls[1].ref, a); assert.deepEqual(calls[2].ref, b);
  assert.equal(c.channelId, secondChannel); assert.deepEqual(f.store.read().panel, c);
  assert.equal(calls[0].nickname, true);
  await Promise.resolve(); assert.equal(f.service.userQueues.size, 0);
});

test('rejected work releases the per-user queue and duplicate verification still coalesces', async t => {
  const f = await fixture(t);
  await f.store.saveUser({ userId: uid, channelId: cid, name: '이름' });
  f.service.followers = async () => { throw Error('example upstream failure'); };
  await assert.rejects(f.service.verify(uid), /example upstream failure/);
  f.service.followers = async () => ({ ids: new Set([cid]), complete: true });
  const results = await Promise.all([f.service.verify(uid), f.service.verify(uid)]);
  assert.equal(results[0].status, 'verified'); assert.equal(results[1].status, 'verified'); assert.equal(f.writes.length, 1);
  await Promise.resolve(); assert.equal(f.service.userQueues.size, 0); assert.equal(f.service.inflight.size, 0);
});
