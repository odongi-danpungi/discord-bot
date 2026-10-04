import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { ensureVerificationGuild } from './chzzk-guild-setup.js';
import { JsonStore } from './json-store.js';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const fail = (message, status = 400) => Object.assign(Error(message), { status, statusCode: status });
const snowflake = value => /^\d{17,20}$/.test(value || '');
const channelId = value => /^[a-f0-9]{32}$/i.test(value || '');
const cleanName = value => String(value || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 32);
const validChecks = checks => checks === undefined || (checks && typeof checks === 'object' && !Array.isArray(checks) && Object.keys(checks).length <= 10000 && Object.entries(checks).every(([id, c]) => snowflake(id) && c && snowflake(c.roleId) && channelId(c.targetChannelId) && typeof c.status === 'string' && Number.isFinite(c.checkedAt) && typeof c.checkedName === 'string' && c.checkedName.length <= 32 && typeof c.nicknameSync === 'boolean'));
const initial = () => ({ version: 1, owner: null, users: [], panel: null });
export class ChzzkVerificationStore extends JsonStore {
  constructor(file, key) {
    super(file, initial(), state => state?.version === 1 && Array.isArray(state.users) && state.users.length <= 10000 &&
      (state.guilds === undefined || (Array.isArray(state.guilds) && state.guilds.length <= 10000 && state.guilds.every(g => snowflake(g.guildId) && (g.roleId === '' || snowflake(g.roleId)) && typeof g.pending === 'boolean') && new Set(state.guilds.map(g => g.guildId)).size === state.guilds.length)) &&
      state.users.every(u => validChecks(u.guildChecks) && snowflake(u.userId) && channelId(u.channelId) && typeof u.name === 'string' && u.name.length <= 32) &&
      new Set(state.users.map(u => u.userId)).size === state.users.length && new Set(state.users.map(u => u.channelId)).size === state.users.length &&
      (state.owner === null || ['iv', 'tag', 'data'].every(k => typeof state.owner[k] === 'string')), { maxBytes: 8 * 1024 * 1024 });
    this.key = /^[a-f0-9]{64}$/i.test(key || '') ? Buffer.from(key, 'hex') : Buffer.from(key || '', 'base64');
    if (this.key.length !== 32) throw fail('CHZZK_TOKEN_KEY는 32바이트 HEX 또는 Base64 키여야 합니다.');
  }
  ownerToken() {
    const e = this.read().owner;
    if (!e) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(e.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
      const token = JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]).toString('utf8'));
      if (typeof token.accessToken !== 'string' || !token.accessToken || token.accessToken.length > 16384 || !channelId(token.channelId) || !Number.isFinite(token.expiresAt)) throw Error('invalid token');
      return token;
    } catch { throw fail('채널 인증 정보를 복호화할 수 없습니다. 키와 백업을 확인하세요.', 503); }
  }
  async saveOwner(token, { expectedOwner, guard = () => {} } = {}) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(token)), cipher.final()]);
    return this.update(s => {
      guard();
      if (expectedOwner !== undefined && JSON.stringify(s.owner) !== JSON.stringify(expectedOwner)) return false;
      s.owner = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
      return true;
    });
  }
  async saveUser(input, { guard = () => {} } = {}) {
    await this.update(s => {
      guard();
      const previous = s.users.find(u => u.userId === input.userId);
      if (previous && previous.channelId !== input.channelId) throw fail('이미 다른 CHZZK 계정에 연결되어 있습니다.', 409);
      if (s.users.some(u => u.channelId === input.channelId && u.userId !== input.userId)) throw fail('이미 다른 Discord 계정에 연결된 CHZZK 계정입니다.', 409);
      if (!previous && s.users.length >= 10000) throw fail('인증 저장 한도에 도달했습니다.', 503);
      if (previous) Object.assign(previous, input); else s.users.push(input);
    });
  }
}

export class ChzzkVerification {
  constructor({ config, store, discord, fetchImpl = globalThis.fetch, now = Date.now, guard = () => {} }) {
    Object.assign(this, { config, store, discord, fetchImpl, now, guard });
    this.tickets = new Map(); this.states = new Map(); this.attempts = new Map(); this.generations = new Map();
    this.inflight = new Map(); this.userQueues = new Map();
  }
  ensureGuild(guildId = this.config.guildId) { return ensureVerificationGuild(this, guildId); }
  targetChannelId() {
    // The broadcaster's consent establishes the common target for every guild.
    // Keep the environment value only as a pre-connection/legacy fallback.
    return (this.store.ownerToken()?.channelId || this.config.chzzkChannelId || '').toLowerCase();
  }
  roleFor(guildId = this.config.guildId) {
    return this.store.read().guilds?.find(g => g.guildId === guildId && !g.pending)?.roleId || (guildId === this.config.guildId ? this.config.chzzkVerifyRoleId : '');
  }
  checkedUser(user, guildId) {
    if (!user || guildId === this.config.guildId) return user;
    const check = user.guildChecks?.[guildId];
    return { ...user, status: check?.status || 'pending', checkedAt: check?.checkedAt || 0, roleId: check?.roleId || '',
      targetChannelId: check?.targetChannelId, checkedName: check?.checkedName, nicknameSync: check?.nicknameSync, nicknameSynced: Boolean(check?.nicknameSynced) };
  }
  async saveCheck(user, guildId, options) {
    if (guildId === this.config.guildId) return this.store.saveUser(user, options);
    const { status, checkedAt, roleId, targetChannelId, checkedName, nicknameSync, nicknameSynced } = user;
    const current = this.store.read().users.find(u => u.userId === user.userId);
    const guildChecks = { ...current.guildChecks, [guildId]: { status, checkedAt, roleId, targetChannelId, checkedName, nicknameSync, nicknameSynced } };
    return this.store.saveUser({ ...current, guildChecks }, options);
  }
  currentCheck(user, guildId = this.config.guildId) {
    return Boolean(this.roleFor(guildId)) && user.roleId === this.roleFor(guildId) && user.targetChannelId === this.targetChannelId() &&
      user.checkedName === user.name && user.nicknameSync === Boolean(this.config.chzzkVerifyNickname);
  }
  assertCurrent(item) {
    const current = this.generations.get(item.kind === 'owner' ? 'owner' : item.userId);
    if (item.expiresAt <= this.now() || current?.generation !== item.generation) throw fail('새 인증 링크가 발급됐거나 인증 요청이 만료됐습니다. 다시 시작하세요.', 409);
    this.guard();
  }
  withUser(userId, action) {
    const previous = this.userQueues.get(userId) || Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    // Store a settled tail so a rejected caller cannot create an unhandled rejection.
    const tail = task.then(() => {}, () => {});
    this.userQueues.set(userId, tail);
    void tail.then(() => { if (this.userQueues.get(userId) === tail) this.userQueues.delete(userId); });
    return task;
  }
  summary() {
    const state = this.store.read();
    const owner = this.store.ownerToken();
    return { enabled: true, channelId: this.targetChannelId(), channelName: cleanName(owner?.channelName || ''), mode: 'shared-broadcaster',
      roleId: this.roleFor(), automaticRoles: !this.config.chzzkVerifyRoleId, guildCount: state.guilds?.filter(g => !g.pending && g.roleId).length || 0,
      joinedGuildCount: this.discord?.client?.guilds?.cache?.size || 0,
      nicknameSync: this.config.chzzkVerifyNickname, ownerConnected: Boolean(state.owner),
      linkedCount: state.users.length, verifiedCount: state.users.filter(u => u.status === 'verified' && this.currentCheck(u)).length,
      callbackUrl: this.callbackUrl(), installUrl: this.installUrl(), panel: state.panel, followerScanLimit: 50 };
  }
  installUrl() {
    if (!snowflake(this.config.clientId)) return '';
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('scope', 'bot applications.commands');
    url.searchParams.set('permissions', this.config.chzzkVerifyNickname ? '402653184' : '268435456');
    url.searchParams.set('integration_type', '0');
    return url.href;
  }
  callbackUrl() { return new URL('/oauth/chzzk/callback', this.config.publicBaseUrl).href; }
  prune() {
    const now = this.now();
    for (const map of [this.tickets, this.states, this.attempts, this.generations]) for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
  }
  begin(kind, userId = '', guildId = this.config.guildId) {
    this.guard(); this.prune();
    if (!['owner', 'participant'].includes(kind)) throw fail('인증 유형을 확인하세요.');
    if (kind !== 'owner' && !snowflake(userId)) throw fail('Discord 계정을 확인하세요.');
    if (kind !== 'owner' && !snowflake(guildId)) throw fail('Discord 서버에서 인증을 시작하세요.');
    const key = kind === 'owner' ? 'owner' : userId, attempt = this.attempts.get(key) || { count: 0, expiresAt: this.now() + 600000 };
    if (attempt.count >= 5 || this.tickets.size + this.states.size >= 2000) throw fail('인증 요청이 많습니다. 잠시 후 다시 시도하세요.', 429);
    attempt.count++; this.attempts.set(key, attempt);
    const generation = randomBytes(16).toString('hex'), expiresAt = this.now() + 600000;
    this.generations.set(key, { generation, expiresAt });
    // Reissuing invalidates this person's earlier links, including browser-bound states.
    for (const map of [this.tickets, this.states]) for (const [id, item] of map) if (item.kind === kind && item.userId === userId) map.delete(id);
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(hash(ticket), { kind, userId, guildId, generation, expiresAt });
    const url = new URL('/oauth/chzzk/start', this.config.publicBaseUrl); url.searchParams.set('ticket', ticket);
    return { url: url.href, expiresIn: 600 };
  }
  start(ticket) {
    this.guard(); this.prune();
    if (typeof ticket !== 'string' || ticket.length > 100) throw fail('인증 링크가 유효하지 않습니다.');
    const item = this.tickets.get(hash(ticket)); this.tickets.delete(hash(ticket));
    if (!item) throw fail('인증 링크가 만료됐거나 이미 사용됐습니다.');
    const state = randomBytes(32).toString('base64url'), cookie = randomBytes(32).toString('base64url');
    this.states.set(hash(state), { ...item, cookieHash: hash(cookie) });
    const url = new URL('https://chzzk.naver.com/account-interlock');
    url.searchParams.set('clientId', this.config.chzzkClientId); url.searchParams.set('redirectUri', this.callbackUrl()); url.searchParams.set('state', state);
    return { url: url.href, cookie };
  }
  consume(state, cookie) {
    this.prune();
    if (typeof state !== 'string' || state.length > 100 || typeof cookie !== 'string') throw fail('인증 요청이 유효하지 않습니다.');
    const item = this.states.get(hash(state));
    if (!item || item.cookieHash !== hash(cookie)) throw fail('인증 요청이 만료됐거나 브라우저가 다릅니다.');
    this.states.delete(hash(state)); return item;
  }
  async request(path, { token, body } = {}) {
    if (this.now() < (this.cooldownUntil || 0)) throw fail('CHZZK 요청 제한입니다. 잠시 후 다시 시도하세요.', 429);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000); timer.unref?.();
    try {
      const response = await this.fetchImpl(`https://openapi.chzzk.naver.com${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify({ clientId: this.config.chzzkClientId, clientSecret: this.config.chzzkClientSecret, ...body }) } : {})
      });
      if (response.status === 429) this.cooldownUntil = this.now() + 60000;
      if (!response.ok) throw fail('CHZZK 인증 또는 조회에 실패했습니다. 동의 범위와 연결 상태를 확인하세요.', response.status === 429 ? 429 : 502);
      const json = await response.json(); return json.content ?? json;
    } catch (error) {
      if (error.status) throw error;
      throw fail('CHZZK 응답을 확인할 수 없습니다. 잠시 후 인증을 다시 시작하세요.', 502);
    } finally { clearTimeout(timer); }
  }
  async callback({ state, cookie, code, denied = false }) {
    const item = this.consume(state, cookie); this.guard();
    if (denied) throw fail('CHZZK 정보 제공 동의가 취소됐습니다.');
    if (typeof code !== 'string' || !code || code.length > 2048) throw fail('인증 코드가 없습니다.');
    const token = await this.request('/auth/v1/token', { body: { grantType: 'authorization_code', code, state } });
    if (!token.accessToken || !Number.isFinite(Number(token.expiresIn)) || Number(token.expiresIn) <= 0) throw fail('CHZZK 인증 응답이 올바르지 않습니다.', 502);
    const me = await this.request('/open/v1/users/me', { token: token.accessToken });
    if (!channelId(me.channelId) || !cleanName(me.channelName)) throw fail('CHZZK 계정 정보를 확인할 수 없습니다.', 502);
    this.assertCurrent(item);
    if (item.kind === 'owner') {
      const current = this.store.ownerToken();
      // Do not silently retarget existing follower badges to another broadcaster.
      if (current && current.channelId.toLowerCase() !== me.channelId.toLowerCase()) throw Object.assign(fail('이미 연결된 방송 채널 계정으로 로그인해 주세요. 다른 채널로 변경하려면 기존 인증 역할을 먼저 검토해야 합니다.', 409), { reason: 'OWNER_CHANNEL_MISMATCH' });
      await this.store.saveOwner({ accessToken: token.accessToken, refreshToken: token.refreshToken,
        expiresAt: this.now() + Number(token.expiresIn) * 1000, channelId: me.channelId.toLowerCase(), channelName: cleanName(me.channelName) }, { guard: () => this.assertCurrent(item) });
      this.followerCache = null; return { status: 'owner_connected' };
    }
    // Participant OAuth tokens are never persisted; only the verified identity is kept.
    return this.withUser(item.userId, async () => {
      this.assertCurrent(item);
      await this.store.saveUser({ userId: item.userId, channelId: me.channelId, name: cleanName(me.channelName), status: 'pending', linkedAt: this.now(),
        checkedAt: 0, checkedName: null, nicknameSync: null, nicknameSynced: false, guildChecks: {} }, { guard: () => this.assertCurrent(item) });
      return this.verifyOnce(item.userId, () => this.assertCurrent(item), item.guildId || this.config.guildId);
    });
  }
  async ownerToken() {
    const expectedOwner = this.store.read().owner, token = this.store.ownerToken();
    if (!token || token.channelId.toLowerCase() !== this.targetChannelId()) throw fail('운영자가 방송 채널을 먼저 연결해야 합니다.', 503);
    if (token.expiresAt > this.now() + 60000) return token.accessToken;
    if (this.ownerRefresh) return this.ownerRefresh;
    if (!token.refreshToken) throw fail('방송 채널 동의를 다시 진행하세요.', 503);
    this.ownerRefresh = (async () => {
      this.guard();
      const next = await this.request('/auth/v1/token', { body: { grantType: 'refresh_token', refreshToken: token.refreshToken } });
      if (!next.accessToken || !next.refreshToken || !Number.isFinite(Number(next.expiresIn)) || Number(next.expiresIn) <= 0) throw fail('방송 채널 재인증이 필요합니다.', 503);
      this.guard();
      const saved = await this.store.saveOwner({ ...token, accessToken: next.accessToken, refreshToken: next.refreshToken,
        expiresAt: this.now() + Number(next.expiresIn) * 1000 }, { expectedOwner, guard: this.guard });
      if (saved !== false) return next.accessToken;
      // A newer owner consent won while this refresh was in flight. Never restore its old grant.
      const current = this.store.ownerToken();
      if (!current || current.channelId.toLowerCase() !== this.targetChannelId() || current.expiresAt <= this.now() + 60000) throw fail('방송 채널 인증이 변경됐습니다. 다시 확인하세요.', 503);
      return current.accessToken;
    })();
    try { return await this.ownerRefresh; } finally { this.ownerRefresh = null; }
  }
  async followers() {
    if (this.followerCache && this.followerCache.expiresAt > this.now()) return this.followerCache;
    if (this.followerScan) return this.followerScan;
    this.followerScan = (async () => {
      const token = await this.ownerToken(), ids = new Set(), deadline = this.now() + 20000; let complete = false;
      for (let page = 0; page < 50; page++) {
        if (this.now() >= deadline) break;
        this.guard();
        const content = await this.request(`/open/v1/channels/followers?page=${page}&size=50`, { token });
        if (!Array.isArray(content.data) || content.data.some(u => !channelId(u.channelId))) throw fail('팔로워 목록 응답이 올바르지 않습니다.', 502);
        for (const user of content.data) ids.add(user.channelId);
        if (content.data.length < 50) { complete = true; break; }
      }
      return this.followerCache = { ids, complete, expiresAt: this.now() + 120000 };
    })();
    try { return await this.followerScan; } finally { this.followerScan = null; }
  }
  status(userId, guildId = this.config.guildId) {
    const u = this.checkedUser(this.store.read().users.find(u => u.userId === userId), guildId);
    return u ? { status: this.currentCheck(u, guildId) ? u.status : 'pending', name: u.name, checkedAt: u.checkedAt || 0, nicknameSynced: this.currentCheck(u, guildId) && Boolean(u.nicknameSynced) } : { status: 'unlinked' };
  }
  async verify(userId, guildId = this.config.guildId) {
    const key = `${guildId}:${userId}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const task = this.withUser(userId, () => this.verifyOnce(userId, this.guard, guildId)); this.inflight.set(key, task);
    try { return await task; } finally { this.inflight.delete(key); }
  }
  async verifyOnce(userId, guard = this.guard, guildId = this.config.guildId) {
    guard();
    if (!snowflake(guildId)) throw fail('Discord 서버를 확인하세요.');
    if (this.discord?.client) await this.ensureGuild(guildId);
    guard();
    const previous = this.checkedUser(this.store.read().users.find(u => u.userId === userId), guildId);
    const user = previous && { ...previous, roleId: this.roleFor(guildId), targetChannelId: this.targetChannelId(),
      checkedName: previous.name, nicknameSync: Boolean(this.config.chzzkVerifyNickname) };
    if (!user) return { status: 'unlinked' };
    if (this.currentCheck(previous, guildId) && this.now() - (user.checkedAt || 0) < 120000) return this.status(userId, guildId);
    const followers = await this.followers(); guard();
    if (!followers.ids.has(user.channelId)) {
      await this.saveCheck({ ...user, status: followers.complete ? 'not_following' : 'pending_scan', checkedAt: this.now() }, guildId, { guard });
      return this.status(userId, guildId);
    }
    // Persist intent before Discord writes. Retries reconcile existing role/nickname.
    await this.saveCheck({ ...user, status: 'applying', checkedAt: this.now() }, guildId, { guard });
    try {
      const result = await this.discord.applyChzzkVerification({ userId, guildId, roleId: this.roleFor(guildId),
        name: user.name, nickname: this.config.chzzkVerifyNickname, guard });
      await this.saveCheck({ ...user, status: result.nicknameFailed ? 'partial' : 'verified', checkedAt: this.now(), nicknameSynced: Boolean(result.nicknameSynced) }, guildId);
    } catch {
      await this.saveCheck({ ...user, status: 'apply_failed', checkedAt: this.now() }, guildId);
    }
    return this.status(userId, guildId);
  }
  async publishPanel(channel) {
    this.guard(); if (!snowflake(channel)) throw fail('Discord 채널 ID를 확인하세요.');
    // Include the reference read and commit in the same queue as the Discord write.
    return this.withUser('panel', async () => {
      this.guard();
      if (!this.store.ownerToken()) throw fail('방송 채널을 먼저 연결한 후 인증 패널을 게시하세요.', 503);
      const ref = await this.discord.publishChzzkVerification({ channelId: channel, ref: this.store.read().panel,
        nickname: this.config.chzzkVerifyNickname, guard: this.guard });
      await this.store.update(s => { s.panel = ref; }); return ref;
    });
  }
}
