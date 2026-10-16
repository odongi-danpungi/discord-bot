import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { JsonStore } from './json-store.js';

const AUTHORIZE_URL = 'https://nid.naver.com/oauth2.0/authorize';
const TOKEN_URL = 'https://nid.naver.com/oauth2.0/token';
const PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';
const STATE_TTL = 10 * 60 * 1000;
const REQUEST_TIMEOUT = 10000;
const RESPONSE_LIMIT = 64 * 1024;
const CAPACITY = 2000;
const MAX_LINKS = 10000;
const digest = value => createHash('sha256').update(typeof value === 'string' || ArrayBuffer.isView(value) ? value : String(value)).digest('hex');
const validUser = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validBinding = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plainObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (first, second) => {
  const a = Buffer.from(String(first)), b = Buffer.from(String(second));
  return a.length === b.length && timingSafeEqual(a, b);
};
const fail = (message, status = 400, code = 'participant_naver_link_invalid') => Object.assign(Error(message), { status, statusCode: status, code });
const changed = () => fail('연결 상태가 변경되었습니다. 상태를 다시 확인한 뒤 시작하세요.', 409, 'participant_naver_link_changed');
const unavailable = () => fail('계정 연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.', 503, 'participant_naver_link_unavailable');

function validState(value) {
  if (!exactKeys(value, ['version', 'revision', 'links']) || value.version !== 1 ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.links) || value.links.length > MAX_LINKS) return false;
  const users = new Set(), subjects = new Set();
  for (const row of value.links) {
    if (!exactKeys(row, ['userId', 'subjectHash', 'clientHash', 'linkedAt']) || !validUser(row.userId) ||
        !validHash(row.subjectHash) || !validHash(row.clientHash) || !Number.isSafeInteger(row.linkedAt) || row.linkedAt <= 0 ||
        users.has(row.userId) || subjects.has(row.subjectHash)) return false;
    users.add(row.userId); subjects.add(row.subjectHash);
  }
  return true;
}

function checkRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw fail('현재 화면에서 연결 상태를 다시 확인하세요.');
}

/** Private, tenant-scoped identity proofs. No provider profile or token is retained. */
export class ParticipantNaverLinkStore extends JsonStore {
  constructor(file) { super(file, { version: 1, revision: 0, links: [] }, validState, { maxBytes: 4 * 1024 * 1024 }); }

  async saveLink(row, { revision, guard = () => {} } = {}) {
    checkRevision(revision);
    if (!validState({ version: 1, revision: 0, links: [row] })) throw fail('계정 연결 정보를 확인하지 못했습니다.');
    return this.update(state => {
      guard();
      if (state.revision !== revision) throw changed();
      if (state.links.some(item => item.userId !== row.userId && item.subjectHash === row.subjectHash))
        throw fail('이 네이버 계정은 현재 이 서버에서 연결할 수 없습니다.', 409, 'participant_naver_link_conflict');
      if (!state.links.some(item => item.userId === row.userId) && state.links.length >= MAX_LINKS)
        throw fail('연결 가능한 계정 수에 도달했습니다. 운영자에게 문의하세요.', 503, 'participant_naver_link_capacity');
      state.links = state.links.filter(item => item.userId !== row.userId);
      state.links.push({ ...row });
      state.revision++;
    });
  }

  async removeLink(userId, { revision, guard = () => {} } = {}) {
    checkRevision(revision);
    if (!validUser(userId)) throw fail('Discord 계정을 확인하세요.');
    return this.update(state => {
      guard();
      if (state.revision !== revision) throw changed();
      const remaining = state.links.filter(row => row.userId !== userId);
      if (remaining.length !== state.links.length) { state.links = remaining; state.revision++; }
    });
  }
}

function parseKey(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (/^[a-fA-F0-9]{64}$/.test(input)) return Buffer.from(input, 'hex');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(input)) return null;
  const bytes = Buffer.from(input, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === input ? bytes : null;
}

function settings(config, guildId) {
  const clientId = config.participantNaverClientId, clientSecret = config.participantNaverClientSecret;
  const key = parseKey(config.naverTokenKey);
  const credential = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/.test(value);
  let callbackUrl = '';
  try {
    const base = new URL(config.publicBaseUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (!base.username && !base.password && (base.protocol === 'https:' || (config.demo === true && base.protocol === 'http:' && loopback)))
      callbackUrl = new URL('/naver/participant/callback', base).href;
  } catch { /* Missing configuration is reported without including its value. */ }
  const separateClient = !config.naverClientId || clientId !== config.naverClientId;
  const configured = Boolean(validUser(guildId) && key && callbackUrl && credential(clientId) && credential(clientSecret) && separateClient);
  if (!configured) return { configured: false };
  // Including the HMAC-key namespace also fences a key rotation from old proofs.
  const clientHash = digest(JSON.stringify([clientId, digest(key)]));
  const configurationHash = createHmac('sha256', key).update(JSON.stringify([guildId, clientId, clientSecret, callbackUrl])).digest('hex');
  return { configured, clientId, clientSecret, key, callbackUrl, clientHash, configurationHash };
}

async function boundedJson(response) {
  const length = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > RESPONSE_LIMIT) throw unavailable();
  if (!response?.body?.getReader) throw unavailable();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) throw unavailable();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } catch {
    await reader.cancel().catch(() => {});
    throw unavailable();
  } finally { reader.releaseLock(); }
}

/** Explicit participant consent; intentionally independent of the Cafe operator grant. */
export function createParticipantNaverLinkService({ config = {}, guildId, store, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const states = new Map(), generations = new Map(), attempts = new Map(), controllers = new Set();
  let closed = false;

  function prune() {
    const at = now();
    for (const map of [states, generations, attempts])
      for (const [key, value] of map) if (value.expiresAt <= at) map.delete(key);
  }
  function read() {
    try {
      const value = store?.read?.();
      if (validState(value)) return value;
    } catch { /* Storage errors must not expose a path or a persisted identity. */ }
    throw unavailable();
  }
  async function persist(operation) {
    try { return await operation(); }
    catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('participant_naver_link_')) throw error;
      throw unavailable();
    }
  }
  function configured() {
    const current = settings(config, guildId);
    if (closed || !current.configured) throw fail('참가자 네이버 연결이 아직 준비되지 않았습니다.', 503, 'participant_naver_link_not_configured');
    return current;
  }
  function runGuard(guard) {
    if (closed) throw unavailable();
    try { guard?.(); }
    catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 503;
      throw fail('현재 계정 연결을 변경할 수 없습니다. 상태를 확인한 뒤 다시 시도하세요.', status, 'participant_naver_link_paused');
    }
  }
  function invalidate(userId) {
    generations.delete(userId);
    for (const [key, item] of states) if (item.userId === userId) states.delete(key);
  }
  function current(item, guard) {
    prune(); runGuard(guard);
    const currentConfig = configured();
    if (item.expiresAt <= now() || generations.get(item.userId)?.generation !== item.generation ||
        currentConfig.configurationHash !== item.configurationHash || read().revision !== item.revision) throw changed();
    return currentConfig;
  }
  function status(userId) {
    if (!validUser(userId)) throw fail('Discord 계정을 확인하세요.');
    const value = read(), currentConfig = settings(config, guildId), row = value.links.find(item => item.userId === userId);
    const matched = Boolean(row && currentConfig.configured && same(row.clientHash, currentConfig.clientHash));
    return { revision: value.revision, configured: Boolean(!closed && currentConfig.configured), linked: Boolean(!closed && matched),
      linkedAt: row?.linkedAt ?? null, needsRelink: Boolean(row && !matched), queueMerge: false };
  }
  function begin({ userId, sessionBinding, revision, consent, guard } = {}) {
    runGuard(guard); const currentConfig = configured(); checkRevision(revision);
    if (!validUser(userId) || !validBinding(sessionBinding))
      throw fail('로그인 상태를 확인한 뒤 다시 시작하세요.');
    if (consent !== true) throw fail('네이버 계정 식별 정보 연결에 동의한 뒤 시작하세요.');
    if (read().revision !== revision) throw changed();
    prune();
    const attempt = attempts.get(userId) || { count: 0, expiresAt: now() + 60000 };
    if (attempt.count >= 5 || (!attempts.has(userId) && attempts.size >= CAPACITY) ||
        (!generations.has(userId) && generations.size >= CAPACITY)) throw fail('연결 요청이 많습니다. 잠시 후 다시 시도하세요.', 429, 'participant_naver_link_rate_limit');
    attempt.count++; attempts.set(userId, attempt); invalidate(userId);
    const state = randomBytes(32).toString('base64url'), generation = randomBytes(24).toString('base64url'), expiresAt = now() + STATE_TTL;
    generations.set(userId, { generation, expiresAt });
    states.set(digest(state), { userId, sessionHash: digest(sessionBinding), generation, expiresAt, revision, configurationHash: currentConfig.configurationHash });
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({ response_type: 'code', client_id: currentConfig.clientId, redirect_uri: currentConfig.callbackUrl, state }).toString();
    return { url: url.href, expiresAt };
  }
  async function request(url, options = {}) {
    const controller = new AbortController(); controllers.add(controller);
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
          if (!response.ok) throw fail('네이버 계정 확인 요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.', response.status === 429 ? 429 : 502, 'participant_naver_link_provider');
          return boundedJson(response);
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('네이버 계정 확인 시간이 초과되었습니다. 다시 시작하세요.', 504, 'participant_naver_link_timeout')); }, REQUEST_TIMEOUT); timer.unref?.(); })
      ]);
    } catch (error) {
      if (['participant_naver_link_provider', 'participant_naver_link_timeout'].includes(error?.code)) throw error;
      throw fail('네이버 계정 확인 결과를 읽지 못했습니다. 다시 시작하세요.', 502, 'participant_naver_link_provider');
    } finally { clearTimeout(timer); controller.abort(); controllers.delete(controller); }
  }
  async function complete({ state, code, error, userId, sessionBinding, guard, reauthorize = async () => true } = {}) {
    prune(); runGuard(guard);
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw fail('연결 요청이 만료되었습니다. 다시 시작하세요.');
    const key = digest(state), item = states.get(key);
    if (!item || !validUser(userId) || item.userId !== userId || !validBinding(sessionBinding) || !same(item.sessionHash, digest(sessionBinding)))
      throw fail('연결을 시작한 계정과 브라우저에서 다시 시도하세요.');
    // All matching callbacks, including a refusal, consume the nonce before any HTTP request.
    states.delete(key);
    const currentConfig = current(item, guard);
    if (error !== undefined && error !== null && error !== '') throw fail('네이버 계정 연결 동의가 취소되었습니다.');
    if (typeof code !== 'string' || !code || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code)) throw fail('네이버 인증 코드를 확인하지 못했습니다. 다시 시작하세요.');
    const token = await request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: currentConfig.clientId, client_secret: currentConfig.clientSecret, code, state }).toString() });
    current(item, guard);
    if (!plainObject(token) || typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8192 ||
        /[\u0000-\u0020\u007f]/.test(token.access_token) || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer' || token.error ||
        !['string', 'number'].includes(typeof token.expires_in) || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0)
      throw fail('네이버 인증 결과를 확인하지 못했습니다. 다시 시작하세요.', 502, 'participant_naver_link_provider');
    const profile = await request(PROFILE_URL, { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}` } });
    current(item, guard);
    const subject = profile?.response?.id;
    if (profile?.resultcode !== '00' || typeof subject !== 'string' || !/^[A-Za-z0-9+/_=-]{1,64}$/.test(subject))
      throw fail('네이버 계정 식별 정보를 확인하지 못했습니다. 다시 시작하세요.', 502, 'participant_naver_link_provider');
    try { if ((await reauthorize()) === false) throw unavailable(); }
    catch { throw fail('현재 Discord 서버 접근 권한을 확인하지 못했습니다. 다시 로그인하세요.', 403, 'participant_naver_link_access'); }
    const latest = current(item, guard);
    const subjectHash = createHmac('sha256', latest.key).update(JSON.stringify(['participant-naver', guildId, latest.clientId, subject])).digest('hex');
    await persist(() => store.saveLink({ userId, subjectHash, clientHash: latest.clientHash, linkedAt: now() }, { revision: item.revision, guard: () => current(item, guard) }));
    return status(userId);
  }
  async function disconnect({ userId, revision, guard } = {}) {
    runGuard(guard); checkRevision(revision);
    if (!validUser(userId)) throw fail('Discord 계정을 확인하세요.');
    if (read().revision !== revision) throw changed();
    invalidate(userId);
    await persist(() => store.removeLink(userId, { revision, guard: () => runGuard(guard) }));
    return status(userId);
  }
  return { status, begin, complete, disconnect,
    callbackMatches(state) { prune(); return typeof state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(state) && states.has(digest(state)); },
    close() { closed = true; states.clear(); generations.clear(); attempts.clear(); for (const controller of controllers) controller.abort(); controllers.clear(); }
  };
}
