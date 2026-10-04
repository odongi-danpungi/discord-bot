import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { ChzzkVerification, ChzzkVerificationStore } from '../src/chzzk-verification.js';
import { installChzzkOAuthRoutes } from '../src/chzzk-verification-routes.js';
import { loadConfig } from '../src/config.js';
import { buildProductionEnvironmentValidation } from '../src/production-environment.js';

const guild = '111111111111111111', other = '222222222222222222', uid = '333333333333333333';
const target = 'a'.repeat(32), person = 'b'.repeat(32), obsolete = 'c'.repeat(32);
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chzzk-shared-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'auth.json'), key = randomBytes(32).toString('hex');
  const store = await new ChzzkVerificationStore(file, key).init(), calls = [], writes = [];
  const config = { guildId: guild, chzzkChannelId: obsolete, chzzkVerifyRoleId: '444444444444444444',
    chzzkVerifyNickname: false, publicBaseUrl: 'https://bot.example.com' };
  const service = new ChzzkVerification({ config, store, now: () => 1000000,
    discord: { applyChzzkVerification: async data => { data.guard(); writes.push(data); return { nicknameSynced: false }; } } });
  service.request = async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (endpoint === '/auth/v1/token') return { accessToken: 'synthetic-owner-token', refreshToken: 'synthetic-refresh-token', expiresIn: 3600 };
    if (endpoint === '/open/v1/users/me') return { channelId: target, channelName: '공통 방송' };
    return { data: [{ channelId: person }] };
  };
  return { service, store, key, file, calls, writes };
}
async function connect(f) {
  const link = f.service.begin('owner'), start = f.service.start(new URL(link.url).searchParams.get('ticket'));
  return f.service.callback({ state: new URL(start.url).searchParams.get('state'), cookie: start.cookie, code: 'synthetic-code' });
}

test('all invited guilds use the discovered broadcaster, with one follower request and separate role targets', async t => {
  const f = await fixture(t); await connect(f);
  await f.store.update(s => { s.guilds = [guild, other].map((guildId, i) => ({ guildId, roleId: String(555555555555555555n + BigInt(i)), pending: false })); });
  await f.store.saveUser({ userId: uid, channelId: person, name: '가상 참가자' });
  const results = await Promise.all([f.service.verify(uid, guild), f.service.verify(uid, other)]);
  assert.deepEqual(results.map(r => r.status), ['verified', 'verified']);
  assert.deepEqual(f.writes.map(w => w.guildId), [guild, other]);
  assert.notEqual(f.writes[0].roleId, f.writes[1].roleId);
  const requests = f.calls.filter(c => c.endpoint.includes('/followers'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.token, 'synthetic-owner-token');
  assert.equal(f.store.read().users[0].targetChannelId, target);
  assert.equal(f.store.read().users[0].guildChecks[other].targetChannelId, target);
});

test('restart preserves common target and encrypted credentials without requiring a channel environment variable', async t => {
  const f = await fixture(t); f.service.config.chzzkChannelId = '';
  await connect(f);
  const restored = await new ChzzkVerificationStore(f.file, f.key).init();
  const service = new ChzzkVerification({ config: f.service.config, store: restored });
  assert.equal(service.targetChannelId(), target);
  assert.equal(service.summary().mode, 'shared-broadcaster');
  assert.equal(service.summary().ownerConnected, true);
  assert.doesNotMatch(await readFile(f.file, 'utf8'), /synthetic-owner-token|synthetic-refresh-token/);
  assert.doesNotMatch(JSON.stringify(service.summary()), /synthetic-owner-token|synthetic-refresh-token|\"owner\"/);
});

test('refresh and first panel publication use the stored common channel despite obsolete environment channel', async t => {
  const f = await fixture(t); await connect(f);
  await f.store.saveOwner({ ...f.store.ownerToken(), expiresAt: 1 });
  assert.equal(await f.service.ownerToken(), 'synthetic-owner-token');
  assert.equal(f.store.ownerToken().channelName, '공통 방송');
  f.service.discord.publishChzzkVerification = async () => ({ channelId: uid, id: other });
  assert.deepEqual(await f.service.publishPanel(uid), { channelId: uid, id: other });
});

test('pending role creation is not counted as a successfully prepared server', async t => {
  const f = await fixture(t);
  await f.store.update(s => { s.guilds = [{ guildId: guild, roleId: '', pending: true }]; });
  assert.equal(f.service.summary().guildCount, 0);
});

test('verification-only deployment accepts no manual channel ID; monitor and malformed values still fail closed', async () => {
  const env = { DISCORD_TOKEN: 'synthetic', DISCORD_CLIENT_ID: uid, DISCORD_GUILD_ID: guild,
    DASHBOARD_PASSWORD: 'synthetic-password', CHZZK_VERIFY_ENABLED: 'true', CHZZK_CLIENT_ID: 'synthetic-client',
    CHZZK_CLIENT_SECRET: 'synthetic-client-secret', CHZZK_TOKEN_KEY: randomBytes(32).toString('hex'), PUBLIC_BASE_URL: 'https://bot.example.com' };
  const config = await loadConfig(env, []);
  assert.equal(config.chzzkChannelId, '');
  const check = buildProductionEnvironmentValidation({ config }).checks.find(c => c.id === 'chzzk-channel');
  assert.equal(check.status, 'warn'); assert.equal(check.required, false);
  await assert.rejects(loadConfig({ ...env, CHZZK_MONITOR_ENABLED: 'true' }, []), /CHZZK_CHANNEL_ID/);
  await assert.rejects(loadConfig({ ...env, CHZZK_CHANNEL_ID: 'invalid' }, []), /CHZZK_CHANNEL_ID/);
});

test('public callback explains a different existing broadcaster without echoing tokens or arbitrary errors', async t => {
  const app = express(), service = { callback: async () => { throw Object.assign(Error('synthetic-private-token'), { status: 409, reason: 'OWNER_CHANNEL_MISMATCH' }); } };
  installChzzkOAuthRoutes(app, service, () => {});
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/oauth/chzzk/callback?code=synthetic-private-code`);
  const html = await response.text();
  assert.equal(response.status, 409); assert.match(html, /이미 연결된 공통 방송 채널/);
  assert.doesNotMatch(html, /synthetic-private/);
});
