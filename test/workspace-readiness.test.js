import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { buildWorkspaceReadiness } from '../src/workspace-readiness.js';

const GUILD = '111111111111111111';
const ROLE = '222222222222222222';
const CHANNEL = '333333333333333333';
const MESSAGE = '444444444444444444';
const TARGET = '0123456789abcdef0123456789abcdef';
const NOW = 1900000000000;
const find = (report, id) => report.checks.find(check => check.id === id);
const forbidden = () => { throw Error('a probe, fetch, refresh or write must not run'); };

function fixture() {
  const calls = { operations: 0, chzzk: 0, naver: 0, ready: 0 };
  const saved = { guildId: GUILD, panel: { channelId: CHANNEL, id: MESSAGE }, session: { title: 'private title', applicants: ['private person'] } };
  const chzzk = { enabled: true, ownerConnected: true, channelId: TARGET, roleId: ROLE, channelName: 'private broadcaster', linkedCount: 18 };
  const naver = { configured: true, oauthConfigured: true, connected: false, expiresAt: NOW + 600000, hasRefreshToken: true, privateToken: 'private access token' };
  const role = { id: ROLE, managed: false, permissions: { bitfield: 0n }, comparePositionTo: () => -1 };
  const highest = { id: '555555555555555555' };
  const guild = { id: GUILD, name: 'private server name', roles: { cache: new Map([[ROLE, role]]), fetch: forbidden }, members: { me: { permissions: { has: permission => permission === PermissionFlagsBits.ManageRoles }, roles: { highest } }, fetch: forbidden, fetchMe: forbidden }, channels: { fetch: forbidden } };
  const context = {
    config: { guildId: GUILD, naverCafeId: '', naverMenuId: '', naverMemoMenuId: '', naverMonitorEnabled: false, broadcastToken: 'private OBS secret', token: 'private bot token', naverClientSecret: 'private naver secret', chzzkClientSecret: 'private chzzk secret', operationsFile: 'C:/private/operations.json' },
    operations: { read: () => { calls.operations++; return saved; }, update: forbidden, write: forbidden },
    discord: { client: { isReady: () => { calls.ready++; return true; }, guilds: { cache: new Map([[GUILD, guild]]), fetch: forbidden } }, health: forbidden, setup: forbidden, channels: forbidden },
    chzzkVerification: { summary: () => { calls.chzzk++; return chzzk; }, request: forbidden, begin: forbidden, targetChannelId: forbidden, ensureGuild: forbidden, ownerAccessToken: forbidden },
    naver: { status: () => { calls.naver++; return naver; }, profileProbe: forbidden, accessToken: forbidden, refreshToken: forbidden, beginOAuth: forbidden, disconnect: forbidden, rawRequest: forbidden },
    recovery: { audit: forbidden, emergencyState: forbidden },
    snapshot: forbidden
  };
  return { context, calls, saved, chzzk, naver, role, guild };
}

test('workspace readiness reports saved local evidence without claiming production readiness', () => {
  const f = fixture();
  const report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(report.checkedAt, NOW);
  assert.equal(report.evidence, 'local');
  assert.equal(report.productionVerification, 'pending');
  assert.equal(report.paused, false);
  assert.deepEqual(report.summary, { configured: 5, total: 5, attention: 0 });
  assert.deepEqual(report.checks.map(check => check.id), ['discord', 'channels', 'chzzk', 'verification-role', 'naver', 'naver-board', 'obs']);
  assert.equal(find(report, 'naver').status, 'optional');
  assert.equal(find(report, 'naver-board').status, 'optional');
  assert.match(find(report, 'chzzk').detail, /OAuth.*의미하지 않습니다/);
  assert.match(report.handoff.text, /실서비스 검증: 대기/);
  assert.doesNotMatch(report.handoff.text, /운영 준비 완료|production ready|PASS|실서비스 정상/);
});

test('workspace readiness calls only synchronous local summaries and leaves stores and caches unchanged', () => {
  const f = fixture();
  Object.freeze(f.context.config);
  Object.freeze(f.saved.panel);
  Object.freeze(f.saved.session.applicants);
  Object.freeze(f.saved.session);
  Object.freeze(f.saved);
  Object.freeze(f.chzzk);
  Object.freeze(f.naver);
  const before = JSON.stringify({ config: f.context.config, saved: f.saved, chzzk: f.chzzk, naver: f.naver });
  const cachedRole = f.guild.roles.cache.get(ROLE);
  buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.deepEqual(f.calls, { operations: 1, chzzk: 1, naver: 1, ready: 1 });
  assert.equal(JSON.stringify({ config: f.context.config, saved: f.saved, chzzk: f.chzzk, naver: f.naver }), before);
  assert.equal(f.guild.roles.cache.size, 1);
  assert.equal(f.guild.roles.cache.get(ROLE), cachedRole);
});

test('workspace readiness and handoff never include secrets, names, IDs, URLs, paths or raw errors', () => {
  const f = fixture();
  f.context.config.naverCafeId = '987654321';
  f.context.config.naverMenuId = '87654321';
  f.naver.connected = true;
  f.chzzk.callbackUrl = 'https://private.example/oauth?secret=very-private';
  f.chzzk.panel = { channelId: CHANNEL, id: MESSAGE };
  const reports = [buildWorkspaceReadiness({ context: f.context, now: NOW })];
  f.context.chzzkVerification.summary = () => { throw Error('private chzzk secret private broadcaster ' + GUILD); };
  f.context.naver.status = () => { throw Error('private naver secret private OBS secret C:/private/operations.json'); };
  reports.push(buildWorkspaceReadiness({ context: f.context, now: NOW }));
  for (const report of reports) {
    const serialized = JSON.stringify(report);
    for (const value of [GUILD, ROLE, CHANNEL, MESSAGE, TARGET, '987654321', '87654321', 'private title', 'private person', 'private access token', 'private server name', 'private broadcaster', 'private OBS secret', 'private bot token', 'private naver secret', 'private chzzk secret', 'C:/private/operations.json', 'https://private.example']) assert.equal(serialized.includes(value), false, value);
    assert.equal(Object.hasOwn(report, 'context'), false);
    assert.equal(Object.hasOwn(report, 'snapshot'), false);
  }
});

test('workspace readiness preserves other evidence when one local connector summary throws', () => {
  const f = fixture();
  f.context.chzzkVerification.summary = () => { throw Error('decryption failure containing secret'); };
  f.context.naver.status = () => { throw Error('decryption failure containing secret'); };
  const report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(find(report, 'discord').status, 'configured');
  assert.equal(find(report, 'channels').status, 'configured');
  assert.equal(find(report, 'chzzk').status, 'attention');
  assert.equal(find(report, 'naver').status, 'attention');
  assert.equal(find(report, 'obs').status, 'configured');
  assert.equal(report.productionVerification, 'pending');
});

test('Naver remains optional until this workspace selects a cafe, monitor or saved account', () => {
  const f = fixture();
  assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'naver').status, 'optional');
  f.context.config.naverMonitorEnabled = true;
  let report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(find(report, 'naver').status, 'attention');
  assert.equal(find(report, 'naver-board').status, 'attention');
  assert.equal(report.summary.total, 7);
  f.context.config.naverMonitorEnabled = false;
  f.naver.connected = true;
  report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(find(report, 'naver').status, 'configured');
  assert.equal(find(report, 'naver-board').status, 'attention');
});

test('Naver expired and unknown lifetime evidence cannot be reported configured or silently refreshed', () => {
  const f = fixture();
  f.naver.connected = true;
  f.naver.expiresAt = NOW;
  let report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(find(report, 'naver').status, 'pending');
  assert.match(find(report, 'naver').detail, /갱신 성공은 확인/);
  f.naver.hasRefreshToken = false;
  report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(find(report, 'naver').status, 'attention');
  for (const expiry of [0, undefined, NaN, Infinity, String(NOW + 600000)]) {
    f.naver.expiresAt = expiry;
    report = buildWorkspaceReadiness({ context: f.context, now: NOW });
    assert.equal(find(report, 'naver').status, 'pending');
  }
  f.naver.expiresAt = NOW + 1;
  assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'naver').status, 'configured');
});

test('Naver board checks distinguish a saved numeric board from malformed input', () => {
  const f = fixture();
  f.context.config.naverCafeId = '1234567';
  f.context.config.naverMenuId = '123';
  let report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(find(report, 'naver-board').status, 'configured');
  f.context.config.naverMemoMenuId = 'https://private.example/secret';
  report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(find(report, 'naver-board').status, 'attention');
  assert.doesNotMatch(JSON.stringify(report), /private.example/);
});

test('CHZZK connection needs valid saved owner consent and target, not merely a channel setting', () => {
  const f = fixture();
  for (const patch of [{ ownerConnected: false }, { ownerConnected: 'true' }, { enabled: 'true' }, { channelId: 'invalid' }]) {
    const current = { ...f.chzzk, ...patch };
    f.context.chzzkVerification.summary = () => current;
    const report = buildWorkspaceReadiness({ context: f.context, now: NOW });
    assert.equal(find(report, 'chzzk').status, 'attention');
  }
});

test('cached role evidence detects privileged, managed and high roles without role API reads or writes', () => {
  for (const patch of [{ managed: true }, { permissions: { bitfield: 8n } }, { comparePositionTo: () => 0 }]) {
    const f = fixture();
    Object.assign(f.role, patch);
    assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'verification-role').status, 'attention');
  }
  const f = fixture();
  f.guild.members.me.permissions.has = () => false;
  assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'verification-role').status, 'attention');
});

test('role mapping with incomplete or malformed cache stays pending', () => {
  for (const damage of [f => f.guild.roles.cache.clear(), f => { f.guild.members.me = null; }, f => { f.role.permissions.bitfield = '0'; }, f => { delete f.role.managed; }, f => { f.role.comparePositionTo = () => 'below'; }]) {
    const f = fixture();
    damage(f);
    assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'verification-role').status, 'pending');
  }
});

test('Discord readiness requires current workspace cache and rejects stale foreign panel records', () => {
  const f = fixture();
  f.context.discord.client.isReady = () => false;
  assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'discord').status, 'attention');
  f.context.discord.client.isReady = () => true;
  f.context.discord.client.guilds.cache.clear();
  assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'discord').status, 'pending');
  f.saved.guildId = '666666666666666666';
  assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'channels').status, 'attention');
});

test('missing and malformed context produce bounded fail-closed results, including throwing getters', () => {
  for (const context of [undefined, null, [], true, 'secret-context', { config: [] }, { get config() { throw Error('secret getter'); } }]) {
    const report = buildWorkspaceReadiness({ context, now: 'secret time' });
    assert.equal(report.checks.length, 7);
    assert.equal(report.productionVerification, 'pending');
    assert.equal(report.summary.configured, 0);
    assert.equal(report.summary.attention, report.summary.total);
    assert.ok(Number.isFinite(report.checkedAt));
    assert.doesNotMatch(JSON.stringify(report), /secret-context|secret getter|secret time/);
  }
});

test('malformed local summaries fail closed rather than trusting truthy values', () => {
  const f = fixture();
  f.context.discord.client.isReady = () => 'true';
  f.context.operations.read = () => [];
  f.context.chzzkVerification.summary = () => ({ enabled: 'true', ownerConnected: 'true', channelId: TARGET, roleId: 'secret-role' });
  f.context.naver.status = () => 'secret-status';
  f.context.config.broadcastToken = { token: 'secret-token' };
  const report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(report.summary.configured, 0);
  assert.equal(report.summary.attention, report.summary.total);
  assert.equal(find(report, 'naver').status, 'attention');
  assert.doesNotMatch(JSON.stringify(report), /secret-role|secret-status|secret-token/);
});

test('malformed asynchronous summaries stay unconfigured and declared async methods are not invoked', () => {
  const f = fixture();
  let invoked = false;
  f.context.chzzkVerification.summary = async () => { invoked = true; return f.chzzk; };
  f.context.naver.status = () => Promise.resolve(f.naver);
  const report = buildWorkspaceReadiness({ context: f.context, now: NOW });
  assert.equal(invoked, false);
  assert.equal(find(report, 'chzzk').status, 'attention');
  assert.equal(find(report, 'naver').status, 'attention');
});

test('unknown saved Naver connection fields do not imply an optional or configured account', () => {
  const f = fixture();
  for (const connected of [undefined, 'true', 1, null]) {
    f.naver.connected = connected;
    assert.equal(find(buildWorkspaceReadiness({ context: f.context, now: NOW }), 'naver').status, 'attention');
  }
});

test('paused handoff is explicit and every action is an existing safe portal page', () => {
  const f = fixture();
  const report = buildWorkspaceReadiness({ context: f.context, paused: true, now: NOW });
  assert.equal(report.paused, true);
  assert.match(report.handoff.text, /운영 일시 중지/);
  assert.match(report.handoff.text, /로컬 저장 설정 5\/5/);
  assert.match(report.handoff.text, /실서비스 검증: 대기/);
  assert.equal(report.productionVerification, 'pending');
  for (const check of report.checks) {
    assert.ok(['configured', 'attention', 'pending', 'optional'].includes(check.status));
    if (check.action) assert.ok(['discord', 'chzzk', 'panel', 'naver', 'cafe', 'obs'].includes(check.action.page));
  }
});
