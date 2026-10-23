// CHZZK official Session API client for donation and chat events.
//
// Official flow (https://chzzk.gitbook.io/chzzk/chzzk-api/session):
//   1. GET  /open/v1/sessions/auth                        (broadcaster Access Token) -> { url }
//   2. connect with a Socket.IO 1.x-2.0.x compatible client (Engine.IO protocol 3, websocket only)
//   3. SYSTEM { type: 'connected', data: { sessionKey } }
//   4. POST /open/v1/sessions/events/subscribe/donation   (sessionKey, scope "후원 조회")
//   5. DONATION { donationType, channelId, donatorChannelId, donatorNickname, payAmount, donationText }
//   4'. POST /open/v1/sessions/events/subscribe/chat     (sessionKey, scope "채팅 메시지 조회")
//   5'. CHAT { channelId, senderChannelId, chatChannelId, profile{nickname,badges,verifiedMark}, userRoleCode, content, emojis, messageTime }
// CHZZK allows at most 3 user sessions per account, so one session per server
// subscribes to every event type that server needs (see ChzzkSessionHub).
// A user session only receives events of the user who owns the Access Token.
// This module speaks the small Engine.IO v3 / Socket.IO v2 text framing over the
// platform WebSocket so no outdated socket.io-client dependency is added.
// The real CHZZK connection has not been verified from this repository (PENDING).

const API = 'https://openapi.chzzk.naver.com';
const fail = (message, status = 503, code = 'CHZZK_SESSION') => Object.assign(Error(message), { status, code });
const text = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, limit);
const parse = value => { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return null; } };

/** Builds the Engine.IO v3 websocket URL from the session URL returned by CHZZK. */
export function sessionSocketUrl(sessionUrl) {
  let url;
  try { url = new URL(String(sessionUrl || '')); } catch { throw fail('CHZZK 세션 주소를 확인할 수 없습니다.', 502, 'SESSION_URL'); }
  if (url.protocol !== 'https:' || !/(^|\.)naver\.com$/i.test(url.hostname) || !url.searchParams.get('auth')) throw fail('CHZZK 세션 주소를 확인할 수 없습니다.', 502, 'SESSION_URL');
  url.protocol = 'wss:';
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/socket.io/';
  url.searchParams.set('EIO', '3'); url.searchParams.set('transport', 'websocket');
  return url.href;
}

/** Validates one DONATION payload. Returns null for anything that is not a usable donation. */
export function normalizeDonation(raw) {
  const event = parse(raw);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const amount = Number(String(event.payAmount ?? '').replace(/,/g, ''));
  const channelId = String(event.channelId || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(channelId) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return {
    channelId,
    donationType: event.donationType === 'VIDEO' ? 'VIDEO' : 'CHAT',
    // Never persist the donor channel id; the nickname is shown on stream by the operator's choice.
    nickname: text(event.donatorNickname, 20) || '익명',
    amount
  };
}

/**
 * Donation with its message, for the 뽑기판 numbers ("11 23"). The text must stay in memory:
 * callers read the numbers and drop it.
 */
export function normalizeDonationText(raw) {
  const event = parse(raw);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const amount = Number(String(event.payAmount ?? '').replace(/,/g, ''));
  const channelId = String(event.channelId || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(channelId) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return { channelId, amount, nickname: text(event.donatorNickname, 20) || '익명', text: String(event.donationText ?? '').slice(0, 200) };
}

/**
 * Donation with the donor's CHZZK channel id, for features that credit a linked viewer.
 * The donor id must stay in memory: callers match it against an existing account link and drop it.
 */
export function normalizeDonationDonor(raw) {
  const event = parse(raw);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const amount = Number(String(event.payAmount ?? '').replace(/,/g, ''));
  const channelId = String(event.channelId || '').toLowerCase(), donorChannelId = String(event.donatorChannelId || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(channelId) || !/^[a-f0-9]{32}$/.test(donorChannelId) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return { channelId, donorChannelId, amount };
}

const EVENTS = Object.freeze({ DONATION: { path: 'donation', scope: '후원 조회', noun: '후원' }, CHAT: { path: 'chat', scope: '채팅 메시지 조회', noun: '채팅' } });
export const CHZZK_EVENT_TYPES = Object.freeze(Object.keys(EVENTS));
const scopes = types => types.map(type => EVENTS[type].scope).join('·');

const ROLES = { streamer: 'streamer', streaming_channel_manager: 'manager', streaming_chat_manager: 'manager' };
const emojiUrl = value => {
  if (typeof value !== 'string' || value.length > 500) return '';
  try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)pstatic\.net$/i.test(url.hostname) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};
/** Validates one CHAT payload. Sender channel ids and chat channel ids are never kept. */
export function normalizeChat(raw) {
  const event = parse(raw);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const channelId = String(event.channelId || '').toLowerCase();
  const content = text(event.content, 300);
  if (!/^[a-f0-9]{32}$/.test(channelId) || !content) return null;
  const emojis = {};
  if (event.emojis && typeof event.emojis === 'object' && !Array.isArray(event.emojis)) {
    for (const [key, value] of Object.entries(event.emojis).slice(0, 20)) { const url = emojiUrl(value); if (/^[A-Za-z0-9_.-]{1,64}$/.test(key) && url) emojis[key] = url; }
  }
  const profile = event.profile && typeof event.profile === 'object' ? event.profile : {};
  const at = Number(event.messageTime);
  return { channelId, nickname: text(profile.nickname, 20) || '익명', role: ROLES[event.userRoleCode] || 'viewer', content, emojis, ...(Number.isSafeInteger(at) && at > 0 ? { at } : {}) };
}

/**
 * Chat with the sender's CHZZK channel id, for chat commands that look up the sender's own queue entry.
 * The sender id must stay in memory: callers match it against an existing account link and drop it.
 */
export function normalizeChatSender(raw) {
  const event = parse(raw);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const channelId = String(event.channelId || '').toLowerCase(), senderChannelId = String(event.senderChannelId || '').toLowerCase();
  const content = text(event.content, 300);
  if (!/^[a-f0-9]{32}$/.test(channelId) || !content) return null;
  const profile = event.profile && typeof event.profile === 'object' ? event.profile : {};
  return { channelId, senderChannelId: /^[a-f0-9]{32}$/.test(senderChannelId) ? senderChannelId : '', nickname: text(profile.nickname, 20) || '익명', role: ROLES[event.userRoleCode] || 'viewer', content };
}

/**
 * One CHZZK user session that subscribes to several event types.
 * `handlers` maps DONATION/CHAT to a function receiving the raw payload.
 * A missing scope for one event type does not stop the others; when every
 * type is refused the session backs off like a permanent failure.
 */
export class ChzzkEventSession {
  constructor({ accessToken, handlers, onStatus = () => {}, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket,
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, apiBase = API, maxBackoffMs = 60000 }) {
    const types = Object.keys(handlers || {}).filter(type => EVENTS[type] && typeof handlers[type] === 'function');
    if (typeof accessToken !== 'function' || !types.length) throw TypeError('accessToken and at least one event handler are required');
    Object.assign(this, { accessToken, handlers, types, onStatus, fetchImpl, WebSocketImpl, now, setTimer, clearTimer, apiBase: apiBase.replace(/\/+$/, ''), maxBackoffMs });
    this.state = { status: 'stopped', detail: '', since: now(), subscribed: false, lastEventAt: 0, failures: 0, events: Object.fromEntries(types.map(type => [type, { status: 'stopped', detail: '', lastEventAt: 0 }])) };
    this.running = false; this.socket = null; this.timers = new Set(); this.generation = 0;
  }
  status() { return { ...this.state, events: structuredClone(this.state.events) }; }
  /** Status as seen by one feature (donation roulette or chat overlay). */
  eventStatus(type) {
    const state = this.state, event = state.events[type];
    if (!event) return { status: 'stopped', detail: '', since: state.since, lastEventAt: 0 };
    if (state.status === 'subscribed' && event.status !== 'subscribed') return { status: event.status, detail: event.detail, since: state.since, lastEventAt: event.lastEventAt };
    return { status: state.status, detail: state.status === 'subscribed' ? event.detail || state.detail : state.detail, since: state.since, lastEventAt: event.lastEventAt };
  }
  setEvent(type, status, detail = '') { const event = this.state.events[type]; if (event) Object.assign(event, { status, detail: text(detail, 200) }); }
  set(status, detail = '') {
    if (status !== 'subscribed') for (const type of this.types) if (this.state.events[type].status !== 'auth_required' || status === 'stopped') this.setEvent(type, status, detail);
    this.state = { ...this.state, status, detail: text(detail, 200), since: this.now(), subscribed: status === 'subscribed' };
    try { this.onStatus(this.status()); } catch {}
  }
  timer(fn, ms) { const id = this.setTimer(() => { this.timers.delete(id); fn(); }, ms); id?.unref?.(); this.timers.add(id); return id; }
  clearTimers() { for (const id of this.timers) this.clearTimer(id); this.timers.clear(); }

  start() {
    if (this.running) return;
    this.running = true; this.state.failures = 0;
    void this.connect();
  }
  stop(status = 'stopped', detail = '') {
    this.running = false; this.generation++; this.clearTimers();
    const socket = this.socket; this.socket = null;
    if (socket) { try { socket.send?.('41'); } catch {} try { socket.close?.(); } catch {} }
    this.set(status, detail);
  }

  async api(path, { method = 'GET', query, scope = scopes(this.types) } = {}) {
    const token = await this.accessToken();
    const url = new URL(this.apiBase + path);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const controller = new AbortController(), timeout = this.setTimer(() => controller.abort(), 7000); timeout?.unref?.();
    try {
      const response = await this.fetchImpl(url, { method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      let body = {}; try { body = await response.json(); } catch {}
      if (response.status === 401 || response.status === 403) throw fail(`방송 계정의 ${scope} 권한을 다시 동의해야 합니다.`, 403, 'SCOPE_REQUIRED');
      if (!response.ok) throw fail(`CHZZK 세션 요청이 실패했습니다. (${response.status})`, response.status === 429 ? 429 : 502);
      return body?.content ?? body;
    } catch (error) {
      if (error?.code) throw error;
      throw fail('CHZZK 세션 응답을 확인할 수 없습니다.', 502);
    } finally { this.clearTimer(timeout); }
  }

  retry(error) {
    if (!this.running) return;
    const permanent = error?.code === 'SCOPE_REQUIRED' || error?.code === 'REVOKED';
    this.state.failures++;
    const delay = permanent ? this.maxBackoffMs * 5 : Math.min(this.maxBackoffMs, 2000 * 2 ** Math.min(5, this.state.failures - 1));
    const socket = this.socket; this.socket = null; this.generation++;
    if (socket) { try { socket.close?.(); } catch {} }
    this.set(permanent ? 'auth_required' : 'reconnecting', error?.message || '연결이 끊겼습니다.');
    if (permanent) for (const type of this.types) this.setEvent(type, 'auth_required', this.state.events[type].detail || error?.message);
    this.timer(() => { if (this.running) void this.connect(); }, delay);
  }

  async connect() {
    if (!this.running) return;
    const generation = ++this.generation;
    this.set('connecting', '세션을 만드는 중입니다.');
    let session;
    try { session = await this.api('/open/v1/sessions/auth'); } catch (error) { if (generation === this.generation) this.retry(error); return; }
    if (!this.running || generation !== this.generation) return;
    let socket;
    try {
      if (typeof this.WebSocketImpl !== 'function') throw fail('이 Node.js에서 WebSocket을 사용할 수 없습니다.', 503, 'NO_WEBSOCKET');
      socket = new this.WebSocketImpl(sessionSocketUrl(session?.url));
    } catch (error) { this.retry(error); return; }
    this.socket = socket;
    let pingInterval = 25000, pingTimeout = 20000, pinger = null, watchdog = null;
    const current = () => this.running && generation === this.generation && this.socket === socket;
    const arm = () => { if (watchdog) { this.clearTimer(watchdog); this.timers.delete(watchdog); } watchdog = this.timer(() => { if (current()) this.retry(fail('CHZZK 세션 응답이 없습니다.', 504)); }, pingInterval + pingTimeout); };
    const ping = () => { if (!current()) return; try { socket.send('2'); } catch {} pinger = this.timer(ping, pingInterval); };
    socket.onmessage = message => {
      if (!current()) return;
      const data = typeof message?.data === 'string' ? message.data : String(message?.data ?? '');
      arm();
      if (data.startsWith('0')) {
        const open = parse(data.slice(1)) || {};
        if (Number.isFinite(open.pingInterval) && open.pingInterval >= 1000) pingInterval = Math.min(open.pingInterval, 120000);
        if (Number.isFinite(open.pingTimeout) && open.pingTimeout >= 1000) pingTimeout = Math.min(open.pingTimeout, 120000);
        if (pinger) this.clearTimer(pinger); pinger = this.timer(ping, pingInterval); arm();
        return;
      }
      if (data === '3' || data === '40') return;
      if (data === '41' || data === '1') { this.retry(fail('CHZZK 세션이 종료되었습니다.', 503)); return; }
      if (!data.startsWith('42')) return;
      const packet = parse(data.slice(2));
      if (!Array.isArray(packet) || typeof packet[0] !== 'string') return;
      void this.event(packet[0], packet[1], current);
    };
    socket.onclose = () => { if (current()) this.retry(fail('CHZZK 세션 연결이 끊겼습니다.', 503)); };
    socket.onerror = () => { if (current()) this.retry(fail('CHZZK 세션 연결 오류입니다.', 503)); };
  }

  subscribedDetail() {
    return this.types.filter(type => this.state.events[type].status === 'subscribed').map(type => `${EVENTS[type].noun} 구독 요청을 보냈습니다. 실제 ${EVENTS[type].noun} 수신은 방송에서 확인해야 합니다.`).join(' ');
  }

  async event(name, payload, current) {
    if (name === 'SYSTEM') {
      const message = parse(payload);
      const type = message?.type, eventType = message?.data?.eventType;
      if (type === 'connected') {
        const sessionKey = String(message?.data?.sessionKey || '');
        if (!sessionKey || sessionKey.length > 512) { this.retry(fail('CHZZK 세션 키를 확인할 수 없습니다.', 502)); return; }
        this.set('subscribing', `${this.types.map(t => EVENTS[t].noun).join('·')} 이벤트를 구독하는 중입니다.`);
        const failures = [];
        for (const t of this.types) {
          try { await this.api(`/open/v1/sessions/events/subscribe/${EVENTS[t].path}`, { method: 'POST', query: { sessionKey }, scope: EVENTS[t].scope }); if (!current()) return; this.setEvent(t, 'subscribed'); }
          catch (error) { if (!current()) return; failures.push(error); this.setEvent(t, error?.code === 'SCOPE_REQUIRED' ? 'auth_required' : 'reconnecting', error?.message); }
        }
        // Transient errors reconnect everything; a missing scope only disables that event type.
        const transient = failures.find(error => error?.code !== 'SCOPE_REQUIRED');
        if (transient || failures.length === this.types.length) { this.retry(transient || failures[0]); return; }
        if (current() && this.state.status === 'subscribing') this.set('subscribed', this.subscribedDetail());
      } else if (type === 'subscribed' && this.types.includes(eventType)) {
        this.state.failures = 0; this.setEvent(eventType, 'subscribed', `CHZZK가 ${EVENTS[eventType].noun} 구독을 확인했습니다.`);
        if (this.state.status === 'subscribed' || this.state.status === 'subscribing') this.set('subscribed', this.subscribedDetail());
      } else if (type === 'revoked') {
        const revoked = this.types.includes(eventType) ? [eventType] : this.types;
        for (const t of revoked) this.setEvent(t, 'auth_required', `방송 계정의 ${EVENTS[t].scope} 권한이 회수되었습니다. 다시 동의해 주세요.`);
        if (this.types.every(t => this.state.events[t].status === 'auth_required')) this.retry(fail(this.state.events[revoked[0]].detail, 403, 'REVOKED'));
        else this.set('subscribed', this.subscribedDetail());
      } else if (type === 'unsubscribed' && this.types.includes(eventType)) {
        this.retry(fail(`CHZZK ${EVENTS[eventType].noun} 구독이 해제되었습니다.`, 403, 'UNSUBSCRIBED'));
      }
      return;
    }
    if (!this.types.includes(name)) return;
    try { if (await this.handlers[name](payload) !== false) { this.state.lastEventAt = this.now(); this.state.events[name].lastEventAt = this.state.lastEventAt; } } catch {}
  }
}

/** Donation-only session (kept for callers and tests that only need donations). */
export class ChzzkDonationSession extends ChzzkEventSession {
  constructor({ onDonation, ...options }) {
    if (typeof onDonation !== 'function') throw TypeError('accessToken and onDonation are required');
    super({ ...options, handlers: { DONATION: payload => { const donation = normalizeDonation(payload); if (!donation) return false; return onDonation(donation); } } });
  }
}

/**
 * Shares one CHZZK user session per server between features. Each feature takes a
 * lease for one event type; the session is rebuilt (on the next microtask) whenever
 * the set of leased event types changes, or when the broadcaster consent changes
 * while an event type is waiting for consent.
 */
export class ChzzkSessionHub {
  constructor({ sessionFactory = options => new ChzzkEventSession(options), defer = queueMicrotask } = {}) {
    Object.assign(this, { sessionFactory, defer });
    this.leases = new Set(); this.session = null; this.pending = false; this.closed = false;
  }
  /** Returns an object with the start/stop/status contract feature services already use.
   * Several leases may share one event type (for example two features that both need donations);
   * every started lease of that type receives each event. */
  lease(type, { accessToken, onEvent, onStatus = () => {} }) {
    if (!EVENTS[type] || typeof accessToken !== 'function' || typeof onEvent !== 'function') throw TypeError('a known event type, accessToken and onEvent are required');
    const hub = this, lease = {
      type, accessToken, onEvent, onStatus,
      start() { if (!hub.leases.has(lease)) { hub.leases.add(lease); hub.schedule(); } },
      stop() { if (hub.leases.delete(lease)) hub.schedule(); },
      status() { return hub.session?.eventStatus(type) || { status: hub.leases.has(lease) ? 'connecting' : 'stopped', detail: '', since: 0, lastEventAt: 0 }; }
    };
    return lease;
  }
  /** Called when the broadcaster account consent may have changed. */
  refresh() {
    const events = this.session?.status?.().events || {};
    if (Object.values(events).some(event => event.status === 'auth_required')) this.schedule();
  }
  schedule() { if (this.pending || this.closed) return; this.pending = true; this.defer(() => { this.pending = false; this.rebuild(); }); }
  rebuild() {
    if (this.closed) return;
    if (this.session) { try { this.session.stop(); } catch {} this.session = null; }
    if (!this.leases.size) return;
    const leases = [...this.leases], latest = leases.at(-1), handlers = {};
    for (const type of new Set(leases.map(lease => lease.type))) {
      const group = leases.filter(lease => lease.type === type);
      // One feature failing must not keep the event from the others.
      handlers[type] = async payload => { let used = false; for (const lease of group) { try { if (await lease.onEvent(payload) !== false) used = true; } catch {} } return used; };
    }
    this.session = this.sessionFactory({
      accessToken: () => latest.accessToken(),
      handlers,
      onStatus: () => { for (const lease of leases) { try { lease.onStatus(lease.status()); } catch {} } }
    });
    this.session.start();
  }
  close() { this.closed = true; this.leases.clear(); if (this.session) { try { this.session.stop(); } catch {} this.session = null; } }
}
