import { randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { ChzzkEventSession, normalizeChat } from './chzzk-session.js';

// CHZZK chat -> OBS chat window. Only display settings are saved (separate file
// `operations.json.chat-overlay.json`). Chat messages themselves are kept in memory
// only (latest CHAT_BUFFER_LIMIT) so viewer chat is never written to disk, and
// sender channel ids are dropped before a message reaches the buffer.

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, limit);

export const CHAT_BUFFER_LIMIT = 50, CHAT_TEST_INTERVAL_MS = 1000;
export const CHAT_MAX_MESSAGES = [3, 20], CHAT_HIDE_AFTER = [0, 15, 30, 60, 120, 300], CHAT_FONT_SIZES = ['small', 'medium', 'large'];
const DEFAULTS = Object.freeze({ enabled: false, maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium' });
const KEYS = ['enabled', 'maxMessages', 'hideAfterSeconds', 'fontSize'];

function validSettings(settings) {
  return plain(settings) && Object.keys(settings).length === KEYS.length && KEYS.every(key => Object.hasOwn(settings, key)) && typeof settings.enabled === 'boolean' &&
    Number.isInteger(settings.maxMessages) && settings.maxMessages >= CHAT_MAX_MESSAGES[0] && settings.maxMessages <= CHAT_MAX_MESSAGES[1] &&
    CHAT_HIDE_AFTER.includes(settings.hideAfterSeconds) && CHAT_FONT_SIZES.includes(settings.fontSize);
}

/** Validates operator input: {enabled, maxMessages, hideAfterSeconds, fontSize, revision}. */
export function validateChatOverlayInput(input) {
  if (!plain(input) || Object.keys(input).length !== KEYS.length + 1 || !revision(input.revision)) throw fail('채팅창 설정과 최신 버전을 확인해 주세요.');
  const settings = Object.fromEntries(KEYS.map(key => [key, input[key]]));
  if (!validSettings(settings)) throw fail(`채팅창 설정을 확인해 주세요. 표시 개수는 ${CHAT_MAX_MESSAGES[0]}~${CHAT_MAX_MESSAGES[1]}개입니다.`);
  return { settings, revision: input.revision };
}

export class ChatOverlayStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.chat-overlay.json', { version: 1, revision: 0, settings: { ...DEFAULTS } },
      state => plain(state) && state.version === 1 && revision(state.revision) && validSettings(state.settings), { maxBytes: 64 * 1024 });
  }
  snapshot() { const state = this.read(); return { settings: { ...state.settings }, revision: state.revision }; }
  async configure(input, { guard = () => {} } = {}) {
    const value = validateChatOverlayInput(input);
    let result;
    await this.update(async state => {
      await guard();
      if (state.revision !== value.revision) throw fail('다른 운영자가 채팅창 설정을 변경했습니다. 최신 설정을 확인한 뒤 다시 저장하세요.', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409);
      state.settings = value.settings; state.revision++;
      result = { settings: { ...state.settings }, revision: state.revision };
    });
    return result;
  }
}

/**
 * Connects the broadcaster's CHZZK chat to the OBS chat window.
 * - Runs only while enabled and a broadcaster account is connected.
 * - Ignores chat for any channel other than the connected broadcaster.
 * - Test messages work without CHZZK and are labelled as tests.
 */
export class ChatOverlayService {
  constructor({ store, chzzkVerification, guard = () => {}, sessionFactory = options => new ChzzkEventSession({ accessToken: options.accessToken, onStatus: options.onStatus, handlers: { CHAT: payload => { const chat = normalizeChat(payload); return chat ? options.onChat(chat) : false; } } }), now = Date.now, reporter = () => {} }) {
    Object.assign(this, { store, chzzkVerification, guard, sessionFactory, now, reporter });
    this.session = null; this.sessionChannel = ''; this.messages = []; this.seq = 0; this.cleared = 0; this.lastTestAt = 0;
    // A new id after every restart lets an open OBS page start over instead of waiting for old sequence numbers.
    this.boot = randomUUID().slice(0, 8);
    this.ignored = { otherChannel: 0 };
    const unsubscribeSettings = store.subscribe(() => this.sync());
    const unsubscribeOwner = chzzkVerification?.store?.subscribe?.(() => this.sync()) || (() => {});
    this.unsubscribe = () => { unsubscribeSettings(); unsubscribeOwner(); };
  }
  connected() {
    try { return Boolean(this.chzzkVerification?.summary?.().ownerConnected && this.chzzkVerification.targetChannelId()); } catch { return false; }
  }
  sync() {
    const { settings } = this.store.snapshot();
    const wanted = settings.enabled && this.connected();
    let channel = '';
    try { channel = wanted ? this.chzzkVerification.targetChannelId() : ''; } catch {}
    if (this.session && (!wanted || channel !== this.sessionChannel)) { this.session.stop(); this.session = null; }
    if (wanted && !this.session) {
      this.sessionChannel = channel;
      this.session = this.sessionFactory({ accessToken: () => this.chzzkVerification.ownerToken(), onChat: chat => this.receive(chat),
        onStatus: status => { if (status?.status === 'auth_required') this.reporter({ severity: 'warn', code: 'chzzk_chat_session', summary: 'CHZZK 채팅 세션 권한 확인 필요', detail: status.detail }); } });
      this.session.start();
    }
  }
  status() {
    const { settings } = this.store.snapshot();
    const session = this.session?.status() || null;
    const state = !this.chzzkVerification ? 'unavailable' : !this.connected() ? 'not_connected' : !settings.enabled ? 'disabled' : session?.status || 'stopped';
    return { state, detail: session?.detail || '', since: session?.since || 0, lastEventAt: session?.lastEventAt || 0, ignored: { ...this.ignored },
      // Delivery of real chat is not proven by a subscription acknowledgement.
      verification: 'pending' };
  }
  push(message) {
    const entry = { id: ++this.seq, at: this.now(), nickname: message.nickname, role: message.role, content: message.content, emojis: message.emojis || {}, ...(message.test ? { test: true } : {}) };
    this.messages.push(entry);
    if (this.messages.length > CHAT_BUFFER_LIMIT) this.messages.splice(0, this.messages.length - CHAT_BUFFER_LIMIT);
    return entry;
  }
  receive(chat) {
    let target = '';
    try { target = this.chzzkVerification.targetChannelId(); } catch {}
    if (!target || chat.channelId !== target) { this.ignored.otherChannel++; return false; }
    if (!this.store.snapshot().settings.enabled) return false;
    return this.push(chat);
  }
  test(input) {
    if (!plain(input) || Object.keys(input).some(key => !['nickname', 'content'].includes(key)) || typeof input.content !== 'string' ||
      (input.nickname !== undefined && typeof input.nickname !== 'string')) throw fail('테스트 채팅 내용을 입력해 주세요.');
    const content = clean(input.content, 100);
    if (!content) throw fail('테스트 채팅 내용을 입력해 주세요.');
    const now = this.now();
    if (now - this.lastTestAt < CHAT_TEST_INTERVAL_MS) throw fail('테스트 채팅은 1초에 한 번만 보낼 수 있습니다.', 429);
    this.guard();
    this.lastTestAt = now;
    return this.push({ test: true, nickname: clean(input.nickname, 20) || '테스트', role: 'viewer', content, emojis: {} });
  }
  /** Clears the OBS chat window (for example after an unwanted message). */
  clear() { this.guard(); this.messages = []; this.cleared = this.seq; return { cleared: this.cleared }; }
  /** OBS feed: display settings plus messages newer than `after` from this boot. */
  feed(after, boot) {
    const { settings } = this.store.snapshot();
    const since = boot === this.boot && Number.isSafeInteger(after) && after >= 0 ? after : 0;
    return { boot: this.boot, last: this.seq, cleared: this.cleared,
      settings: { maxMessages: settings.maxMessages, hideAfterSeconds: settings.hideAfterSeconds, fontSize: settings.fontSize },
      messages: this.messages.filter(message => message.id > since).slice(-CHAT_BUFFER_LIMIT) };
  }
  recent(limit = 10) { return this.messages.slice(-limit); }
  async close() { this.unsubscribe(); if (this.session) { this.session.stop(); this.session = null; } }
}
