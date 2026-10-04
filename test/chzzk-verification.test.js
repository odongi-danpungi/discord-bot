import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { PermissionFlagsBits } from 'discord.js';
import { ChzzkVerification, ChzzkVerificationStore } from '../src/chzzk-verification.js';
import { installChzzkVerificationDiscord, handleChzzkVerification } from '../src/chzzk-verification-discord.js';
import { installChzzkOAuthRoutes } from '../src/chzzk-verification-routes.js';
import { createApp } from '../src/app.js';
import { RegistrationStore } from '../src/store.js';
import { OperationsStore } from '../src/operations.js';
import { DemoDiscordService } from '../src/discord-service.js';
import { loadConfig } from '../src/config.js';
import { RuntimeHealth } from '../src/runtime-health.js';
const uid = '111111111111111111', uid2 = '222222222222222222', cid = 'a'.repeat(32), ownerId = 'b'.repeat(32);
const config = { guildId: '333333333333333333', chzzkChannelId: ownerId, chzzkClientId: 'example-client', chzzkClientSecret: 'test-secret',
  chzzkVerifyRoleId: '444444444444444444', chzzkVerifyNickname: true, publicBaseUrl: 'https://bot.example.com' };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chzzk-verify-')), key = randomBytes(32).toString('hex'), file = path.join(dir, 'auth.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new ChzzkVerificationStore(file, key).init(); let clock = 1000000, locked = false;
  const f = { dir, key, file, store, calls: [], writes: [], followerData: [{ channelId: cid }], responseStatus: 200 };
  const fetchImpl = async (url, options) => {
    f.calls.push({ url, options }); let content;
    if (url.endsWith('/auth/v1/token')) {
      const body = JSON.parse(options.body); content = { accessToken: body.code === 'owner' ? 'owner-test-token' : 'participant-test-token', refreshToken: 'test-refresh', expiresIn: 86400 };
    } else if (url.endsWith('/users/me')) content = { channelId: options.headers.Authorization.includes('owner-test-token') ? ownerId : cid, channelName: '가상 참가자' };
    else content = { data: f.followerData };
    return { ok: f.responseStatus === 200, status: f.responseStatus, json: async () => ({ content }) };
  };
  const service = new ChzzkVerification({ config: { ...config }, store, fetchImpl, now: () => clock,
    discord: { applyChzzkVerification: async data => { data.guard(); f.writes.push(data); return f.applyResult || { nicknameSynced: true }; } },
    guard: () => { if (locked) throw Object.assign(Error('locked'), { status: 423 }); } });
  Object.assign(f, { service, advance: ms => clock += ms, lock: () => locked = true }); return f;
}
async function owner(f) { await f.store.saveOwner({ accessToken: 'owner-test-token', refreshToken: 'test-refresh', channelId: ownerId, expiresAt: 900000000 }); }
function browser(service, userId = uid, kind = 'participant') {
  const link = service.begin(kind, kind === 'owner' ? '' : userId), ticket = new URL(link.url).searchParams.get('ticket'), start = service.start(ticket);
  return { ...start, state: new URL(start.url).searchParams.get('state'), ticket };
}
test('OAuth links expire, are single-use, browser bound, and reissue invalidates earlier links', async t => {
  const f = await fixture(t), first = browser(f.service);
  assert.throws(() => f.service.start(first.ticket), /만료/);
  assert.throws(() => f.service.consume(first.state, 'wrong'), /브라우저/);
  f.service.begin('participant', uid); assert.throws(() => f.service.consume(first.state, first.cookie), /만료/);
  const next = browser(f.service); f.advance(600001); assert.throws(() => f.service.consume(next.state, next.cookie), /만료/);
});
test('follower OAuth completes using broadcaster token and stores no participant token', async t => {
  const f = await fixture(t); await owner(f); const b = browser(f.service);
  const result = await f.service.callback({ ...b, code: 'participant' });
  assert.equal(result.status, 'verified'); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].userId, uid);
  assert.equal(f.calls.at(-1).options.headers.Authorization, 'Bearer owner-test-token');
  assert.equal((await readFile(f.file, 'utf8')).includes('participant-test-token'), false);
  assert.equal((await readFile(f.file, 'utf8')).includes('owner-test-token'), false);
  assert.equal(JSON.stringify(f.service.summary()).includes(uid), false);
  await assert.rejects(f.service.callback({ ...b, code: 'participant' }), /만료/);
});
test('initial broadcaster consent discovers the common channel; later consent cannot silently retarget badges', async t => {
  const f = await fixture(t); let b = browser(f.service, '', 'owner');
  f.service.config.chzzkChannelId = 'c'.repeat(32); // Stale monitor/legacy setting must not block first consent.
  assert.equal((await f.service.callback({ ...b, code: 'owner' })).status, 'owner_connected');
  assert.equal(f.store.ownerToken().channelId, ownerId);
  assert.equal(f.service.summary().channelId, ownerId);
  assert.equal(f.service.summary().channelName, '가상 참가자');
  assert.equal(f.service.config.chzzkChannelId, 'c'.repeat(32)); // Broadcast monitoring remains independent.
  b = browser(f.service, '', 'owner');
  await assert.rejects(f.service.callback({ ...b, code: 'participant' }), e => e.status === 409 && e.reason === 'OWNER_CHANNEL_MISMATCH');
  assert.equal(f.store.ownerToken().channelId, ownerId);
  b = browser(f.service, '', 'owner');
  assert.equal((await f.service.callback({ ...b, code: 'owner' })).status, 'owner_connected');
});
test('denied consent and operational lock never issue API or Discord writes', async t => {
  const f = await fixture(t), b = browser(f.service);
  await assert.rejects(f.service.callback({ ...b, denied: true }), /취소/); assert.equal(f.calls.length, 0);
  const next = browser(f.service); f.lock(); await assert.rejects(f.service.callback({ ...next, code: 'participant' }), /locked/);
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
});
test('account duplicates and account substitution are rejected atomically', async t => {
  const f = await fixture(t); await f.store.saveUser({ userId: uid, channelId: cid, name: '예시' });
  await assert.rejects(f.store.saveUser({ userId: uid2, channelId: cid, name: '예시' }), /다른 Discord/);
  await assert.rejects(f.store.saveUser({ userId: uid, channelId: 'c'.repeat(32), name: '예시' }), /다른 CHZZK/);
  assert.equal(f.store.read().users.length, 1);
});
test('non-follower and truncated scan fail closed and scans coalesce', async t => {
  const f = await fixture(t); await owner(f); await f.store.saveUser({ userId: uid, channelId: cid, name: '예시' });
  f.followerData = [];
  const results = await Promise.all([f.service.verify(uid), f.service.verify(uid)]);
  assert.equal(results[0].status, 'not_following'); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 1);
  f.advance(120001); f.followerData = Array.from({ length: 50 }, () => ({ channelId: 'c'.repeat(32) }));
  assert.equal((await f.service.verify(uid)).status, 'pending_scan'); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 51);
});
test('API rate limits are sanitized and prevent retry storms or role writes', async t => {
  const f = await fixture(t); await owner(f); await f.store.saveUser({ userId: uid, channelId: cid, name: '예시' }); f.responseStatus = 429;
  await assert.rejects(f.service.verify(uid), /CHZZK/); await assert.rejects(f.service.verify(uid), /요청 제한/);
  assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0);
});
test('encrypted owner and user records survive restart but pending OAuth does not', async t => {
  const f = await fixture(t); await owner(f); await f.store.saveUser({ userId: uid, channelId: cid, name: '예시' });
  const b = browser(f.service), restored = await new ChzzkVerificationStore(f.file, f.key).init();
  assert.equal(restored.ownerToken().accessToken, 'owner-test-token'); assert.equal(restored.read().users.length, 1);
  const next = new ChzzkVerification({ config, store: restored }); assert.throws(() => next.consume(b.state, b.cookie), /만료/);
  const wrong = await new ChzzkVerificationStore(f.file, randomBytes(32).toString('hex')).init(); assert.throws(() => wrong.ownerToken(), /복호화/);
});
test('nickname failure stays partial and role target changes require revalidation', async t => {
  const f = await fixture(t); await owner(f); await f.store.saveUser({ userId: uid, channelId: cid, name: '예시' });
  f.applyResult = { nicknameFailed: true }; assert.equal((await f.service.verify(uid)).status, 'partial');
  f.service.config.chzzkVerifyRoleId = '555555555555555555'; assert.equal(f.service.status(uid).status, 'pending');
  await f.service.verify(uid); assert.equal(f.writes.length, 2);
});
test('owner refresh is single-flight and rotating tokens persist before follower use', async t => {
  const f = await fixture(t); await f.store.saveOwner({ accessToken: 'expired-test', refreshToken: 'test-refresh', channelId: ownerId, expiresAt: 1 });
  const tokens = await Promise.all([f.service.ownerToken(), f.service.ownerToken()]);
  assert.equal(f.calls.length, 1); assert.equal(tokens[0], tokens[1]); assert.equal(f.store.ownerToken().accessToken, tokens[0]);
  assert.equal(JSON.parse(f.calls[0].options.body).grantType, 'refresh_token');
});
test('malformed upstream data does not grant roles and owner consent is required for panel', async t => {
  const f = await fixture(t); await assert.rejects(f.service.publishPanel(uid), /방송 채널/);
  await owner(f); await f.store.saveUser({ userId: uid, channelId: cid, name: '예시' }); f.followerData = [{ channelId: 'invalid' }];
  await assert.rejects(f.service.verify(uid), /올바르지/); assert.equal(f.writes.length, 0);
});
test('participant interaction is ephemeral and status identity comes from Discord user', async t => {
  const f = await fixture(t), replies = [];
  const interaction = { guildId: config.guildId, isButton: () => true, customId: 'chzzk:link', user: { id: uid }, deferReply: async d => replies.push(d), editReply: async d => replies.push(d) };
  assert.equal(await handleChzzkVerification(interaction, f.service), true); assert.equal(replies[0].flags, 64);
  assert.match(replies[1].components[0].components[0].url, /^https:\/\/bot\.example\.com\/oauth/);
});
test('public routes bind Secure cookie, reject stolen callback and do not echo secrets', async t => {
  const f = await fixture(t), app = express(); installChzzkOAuthRoutes(app, f.service, () => {});
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`, link = f.service.begin('participant', uid);
  const start = await fetch(base + new URL(link.url).pathname + new URL(link.url).search, { redirect: 'manual' });
  assert.equal(start.status, 303); assert.match(start.headers.get('set-cookie'), /Secure/); assert.match(start.headers.get('set-cookie'), /HttpOnly/);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const callback = await fetch(`${base}/oauth/chzzk/callback?state=${state}&code=do-not-echo-this`);
  assert.equal(callback.status, 400); assert.equal((await callback.text()).includes('do-not-echo-this'), false);
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer'); assert.equal(f.calls.length, 0);
});
test('admin verification API enforces authentication, operator restriction, CSRF and draining', async t => {
  const f = await fixture(t), store = await new RegistrationStore(path.join(f.dir, 'people.json')).init(), operations = await new OperationsStore(path.join(f.dir, 'ops.json')).init();
  const cfg = { ...config, host: '127.0.0.1', dashboardUser: 'admin', dashboardPassword: 'test-admin-password', dashboardOperatorUser: 'op', dashboardOperatorPassword: 'test-operator-password', dashboardOperatorCapabilities: ['broadcast'] };
  const runtime = createApp({ config: cfg, store, operations, discord: new DemoDiscordService(), chzzkVerification: f.service });
  const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { runtime.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`, auth = 'Basic ' + Buffer.from('admin:test-admin-password').toString('base64');
  const snap = await fetch(base + '/api/snapshot', { headers: { Authorization: auth } }).then(r => r.json());
  assert.equal((await fetch(base + '/api/chzzk/verification')).status, 401);
  assert.equal((await fetch(base + '/api/chzzk/verification', { headers: { Authorization: 'Basic ' + Buffer.from('op:test-operator-password').toString('base64') } })).status, 403);
  const post = csrf => fetch(base + '/api/chzzk/verification/owner/start', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}' });
  assert.equal((await post('wrong')).status, 403); assert.equal((await post(snap.csrf)).status, 200);
  runtime.beginShutdown(); assert.equal((await post(snap.csrf)).status, 503);
});
test('Discord application rejects elevated roles and reports nickname failure separately', async () => {
  class Service { serial(_name, fn) { return fn(); } }
  installChzzkVerificationDiscord(Service);
  let added = 0, elevated = true;
  const member = { manageable: true, nickname: '', roles: { cache: new Map(), add: async () => added++ } };
  const role = { id: config.chzzkVerifyRoleId, managed: false, comparePositionTo: () => -1, get permissions() { return { bitfield: elevated ? PermissionFlagsBits.Administrator : 0n }; } };
  const guild = { id: config.guildId, roles: { fetch: async () => role }, members: { fetch: async () => member, fetchMe: async () => ({ roles: { highest: {} }, permissions: { has: p => p === PermissionFlagsBits.ManageRoles } }) } };
  const service = new Service(); service.client = { guilds: { fetch: async () => guild } }; service.guildId = config.guildId;
  const args = { userId: uid, roleId: role.id, name: '가상 참가자', nickname: true, guard: () => {} };
  await assert.rejects(service.applyChzzkVerification(args), /역할/); assert.equal(added, 0);
  elevated = false; assert.equal((await service.applyChzzkVerification(args)).nicknameFailed, true); assert.equal(added, 1);
});
test('verification configuration rejects missing encryption and insecure public URL', async () => {
  const base = { DISCORD_TOKEN: 'example-token', DISCORD_CLIENT_ID: uid, DISCORD_GUILD_ID: config.guildId, DASHBOARD_PASSWORD: 'test-admin-password',
    CHZZK_VERIFY_ENABLED: 'true', CHZZK_CLIENT_ID: 'example', CHZZK_CLIENT_SECRET: 'example', CHZZK_CHANNEL_ID: ownerId, CHZZK_VERIFY_ROLE_ID: config.chzzkVerifyRoleId, PUBLIC_BASE_URL: config.publicBaseUrl };
  await assert.rejects(loadConfig(base, []), /CHZZK_TOKEN_KEY/);
  await assert.rejects(loadConfig({ ...base, CHZZK_TOKEN_KEY: randomBytes(32).toString('hex'), PUBLIC_BASE_URL: 'http://bot.example.com' }, []), /HTTPS/);
});

test('recovered CHZZK auth data is visible in dashboard and runtime health without private records', async t => {
  const f = await fixture(t); await owner(f);
  const valid = await readFile(f.file, 'utf8');
  await writeFile(f.file + '.bak', valid); await writeFile(f.file, '{broken');
  const auth = await new ChzzkVerificationStore(f.file, f.key).init();
  assert.equal(auth.recovered, true);
  const store = await new RegistrationStore(path.join(f.dir, 'people.json')).init();
  const operations = await new OperationsStore(path.join(f.dir, 'ops.json')).init();
  const health = new RuntimeHealth();
  const service = new ChzzkVerification({ config, store: auth });
  const runtime = createApp({ config: { ...config, demo: true, host: '127.0.0.1', backupDir: path.join(f.dir, 'backups') },
    store, operations, discord: new DemoDiscordService(), chzzkVerification: service, runtimeHealth: health });
  const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { runtime.close(); health.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/api/snapshot', '/api/runtime-health', '/api/health']) {
    const response = await fetch(base + route); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.recovered, true, route);
    assert.doesNotMatch(JSON.stringify(data), /owner-test-token|test-refresh/);
  }
});
