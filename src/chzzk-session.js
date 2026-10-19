// CHZZK official Session API client for donation events.
//
// Official flow (https://chzzk.gitbook.io/chzzk/chzzk-api/session):
//   1. GET  /open/v1/sessions/auth                        (broadcaster Access Token) -> { url }
//   2. connect with a Socket.IO 1.x-2.0.x compatible client (Engine.IO protocol 3, websocket only)
//   3. SYSTEM { type: 'connected', data: { sessionKey } }
//   4. POST /open/v1/sessions/events/subscribe/donation   (sessionKey, scope "후원 조회")
//   5. DONATION { donationType, channelId, donatorChannelId, donatorNickname, payAmount, donationText }
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

export class ChzzkDonationSession {
  constructor({ accessToken, onDonation, onStatus = () => {}, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket,
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, apiBase = API, maxBackoffMs = 60000 }) {
    if (typeof accessToken !== 'function' || typeof onDonation !== 'function') throw TypeError('accessToken and onDonation are required');
    Object.assign(this, { accessToken, onDonation, onStatus, fetchImpl, WebSocketImpl, now, setTimer, clearTimer, apiBase: apiBase.replace(/\/+$/, ''), maxBackoffMs });
    this.state = { status: 'stopped', detail: '', since: now(), subscribed: false, lastEventAt: 0, failures: 0 };
    this.running = false; this.socket = null; this.timers = new Set(); this.generation = 0;
  }
  status() { return { ...this.state }; }
  set(status, detail = '') {
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

  async api(path, { method = 'GET', query } = {}) {
    const token = await this.accessToken();
    const url = new URL(this.apiBase + path);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const controller = new AbortController(), timeout = this.setTimer(() => controller.abort(), 7000); timeout?.unref?.();
    try {
      const response = await this.fetchImpl(url, { method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      let body = {}; try { body = await response.json(); } catch {}
      if (response.status === 401 || response.status === 403) throw fail('방송 계정의 후원 조회 권한을 다시 동의해야 합니다.', 403, 'SCOPE_REQUIRED');
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

  async event(name, payload, current) {
    if (name === 'SYSTEM') {
      const message = parse(payload);
      const type = message?.type;
      if (type === 'connected') {
        const sessionKey = String(message?.data?.sessionKey || '');
        if (!sessionKey || sessionKey.length > 512) { this.retry(fail('CHZZK 세션 키를 확인할 수 없습니다.', 502)); return; }
        this.set('subscribing', '후원 이벤트를 구독하는 중입니다.');
        try { await this.api('/open/v1/sessions/events/subscribe/donation', { method: 'POST', query: { sessionKey } }); }
        catch (error) { if (current()) this.retry(error); return; }
        if (current() && this.state.status === 'subscribing') this.set('subscribed', '후원 구독 요청을 보냈습니다. 실제 후원 수신은 방송에서 확인해야 합니다.');
      } else if (type === 'subscribed' && message?.data?.eventType === 'DONATION') {
        this.state.failures = 0; this.set('subscribed', 'CHZZK가 후원 구독을 확인했습니다.');
      } else if (type === 'revoked' || (type === 'unsubscribed' && message?.data?.eventType === 'DONATION')) {
        this.retry(fail(type === 'revoked' ? '방송 계정의 후원 조회 권한이 회수되었습니다. 다시 동의해 주세요.' : 'CHZZK 후원 구독이 해제되었습니다.', 403, type === 'revoked' ? 'REVOKED' : 'UNSUBSCRIBED'));
      }
      return;
    }
    if (name !== 'DONATION') return;
    const donation = normalizeDonation(payload);
    if (!donation) return;
    this.state.lastEventAt = this.now();
    try { await this.onDonation(donation); } catch {}
  }
}
