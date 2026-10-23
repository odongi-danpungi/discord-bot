import { randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { ChzzkEventSession, normalizeDonationText } from './chzzk-session.js';

// OBS 후원 알림: a cheese donation pops up on the OBS browser source.
// Only the display settings are saved (separate file `operations.json.donation-alert.json`).
// Alerts (nickname, amount, the donation message) stay in memory only (latest ALERT_BUFFER_LIMIT);
// the donor channel id never reaches this module and the message is never written to disk.

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const CONTROL = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;
const clean = (value, limit) => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);

export const ALERT_BUFFER_LIMIT = 30, ALERT_TEST_INTERVAL_MS = 1000, ALERT_TEMPLATE_MAX = 60, ALERT_MESSAGE_MAX = 100;
export const ALERT_MIN_AMOUNT = [1, 1000000], ALERT_DURATION = [3, 20];
export const ALERT_DEFAULT_TEMPLATE = '{닉네임}님 {금액}치즈 후원 감사합니다!';
const DEFAULTS = Object.freeze({ enabled: false, minAmount: 1000, template: ALERT_DEFAULT_TEMPLATE, durationSeconds: 6, sound: true, showMessage: true });
const KEYS = Object.keys(DEFAULTS);
const int = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;

function validSettings(s) {
  return plain(s) && Object.keys(s).length === KEYS.length && KEYS.every(key => Object.hasOwn(s, key)) &&
    typeof s.enabled === 'boolean' && typeof s.sound === 'boolean' && typeof s.showMessage === 'boolean' &&
    int(s.minAmount, ALERT_MIN_AMOUNT) && int(s.durationSeconds, ALERT_DURATION) &&
    typeof s.template === 'string' && s.template.length >= 1 && s.template.length <= ALERT_TEMPLATE_MAX && s.template === clean(s.template, ALERT_TEMPLATE_MAX);
}

/** Validates operator input: {enabled, minAmount, template, durationSeconds, sound, showMessage, revision}. */
export function validateDonationAlertInput(input) {
  if (!plain(input) || Object.keys(input).length !== KEYS.length + 1 || !revision(input.revision)) throw fail('후원 알림 설정과 최신 버전을 확인해 주세요.');
  const settings = Object.fromEntries(KEYS.map(key => [key, input[key]]));
  if (typeof settings.template === 'string') settings.template = clean(settings.template, ALERT_TEMPLATE_MAX + 1);
  if (typeof settings.template !== 'string' || !settings.template) throw fail('알림 문구를 입력해 주세요.');
  if (settings.template.length > ALERT_TEMPLATE_MAX) throw fail(`알림 문구는 ${ALERT_TEMPLATE_MAX}자까지 쓸 수 있어요.`);
  if (!validSettings(settings)) throw fail(`후원 알림 설정을 확인해 주세요. 최소 금액은 ${ALERT_MIN_AMOUNT[0]}~${ALERT_MIN_AMOUNT[1].toLocaleString('ko-KR')}치즈, 표시 시간은 ${ALERT_DURATION[0]}~${ALERT_DURATION[1]}초예요.`);
  return { settings, revision: input.revision };
}

export class DonationAlertStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.donation-alert.json', { version: 1, revision: 0, settings: { ...DEFAULTS } },
      state => plain(state) && state.version === 1 && revision(state.revision) && validSettings(state.settings), { maxBytes: 64 * 1024 });
  }
  snapshot() { const state = this.read(); return { settings: { ...state.settings }, revision: state.revision }; }
  async configure(input, { guard = () => {} } = {}) {
    const value = validateDonationAlertInput(input);
    let result;
    await this.update(async state => {
      await guard();
      if (state.revision !== value.revision) throw fail('다른 곳에서 후원 알림 설정이 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요.', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409);
      state.settings = value.settings; state.revision++;
      result = { settings: { ...state.settings }, revision: state.revision };
    });
    return result;
  }
}

/**
 * Connects the broadcaster's CHZZK donations to the OBS alert.
 * - Runs only while enabled and a broadcaster account is connected (shares the donation subscription).
 * - Ignores donations for other channels and below the minimum amount.
 * - Test alerts work without CHZZK and are labelled as tests.
 */
export class DonationAlertService {
  constructor({ store, chzzkVerification = null, guard = () => {}, now = Date.now, reporter = () => {},
    sessionFactory = options => new ChzzkEventSession({ accessToken: options.accessToken, onStatus: options.onStatus, handlers: { DONATION: payload => options.onDonation(payload) } }) }) {
    Object.assign(this, { store, chzzkVerification, guard, now, reporter, sessionFactory });
    this.session = null; this.sessionChannel = ''; this.alerts = []; this.seq = 0; this.lastTestAt = 0;
    // A new id after every restart lets an open OBS page start over instead of waiting for old sequence numbers.
    this.boot = randomUUID().slice(0, 8);
    this.ignored = { otherChannel: 0, belowMinimum: 0 };
    const off = [store.subscribe(() => this.sync()), chzzkVerification?.store?.subscribe?.(() => this.sync()) || (() => {})];
    this.unsubscribe = () => off.forEach(fn => fn());
  }
  connected() { try { return Boolean(this.chzzkVerification?.summary?.().ownerConnected && this.chzzkVerification.targetChannelId()); } catch { return false; } }
  sync() {
    const { settings } = this.store.snapshot(), wanted = settings.enabled && this.connected();
    let channel = ''; try { channel = wanted ? this.chzzkVerification.targetChannelId() : ''; } catch {}
    if (this.session && (!wanted || channel !== this.sessionChannel)) { this.session.stop(); this.session = null; }
    if (wanted && !this.session) {
      this.sessionChannel = channel;
      this.session = this.sessionFactory({ accessToken: () => this.chzzkVerification.ownerToken(), onDonation: payload => this.receive(payload),
        onStatus: status => { if (status?.status === 'auth_required') this.reporter({ severity: 'warn', code: 'chzzk_alert_session', summary: 'CHZZK 후원 세션 권한 확인 필요(후원 알림)', detail: status.detail }); } });
      this.session.start();
    }
  }
  status() {
    const { settings } = this.store.snapshot(), session = this.session?.status() || null;
    const state = !this.chzzkVerification ? 'unavailable' : !this.connected() ? 'not_connected' : !settings.enabled ? 'disabled' : session?.status || 'stopped';
    // A subscription acknowledgement does not prove that real donations arrive.
    return { state, detail: session?.detail || '', ignored: { ...this.ignored }, verification: 'pending' };
  }
  push(alert) {
    const entry = { id: ++this.seq, at: this.now(), nickname: alert.nickname, amount: alert.amount, message: alert.message, ...(alert.test ? { test: true } : {}) };
    this.alerts.push(entry);
    if (this.alerts.length > ALERT_BUFFER_LIMIT) this.alerts.splice(0, this.alerts.length - ALERT_BUFFER_LIMIT);
    return entry;
  }
  /** A CHZZK DONATION payload. Returns the alert or false. */
  receive(payload) {
    const donation = normalizeDonationText(payload);
    if (!donation) return false;
    let target = ''; try { target = this.chzzkVerification.targetChannelId(); } catch {}
    if (!target || donation.channelId !== target) { this.ignored.otherChannel++; return false; }
    const { settings } = this.store.snapshot();
    if (!settings.enabled) return false;
    if (donation.amount < settings.minAmount) { this.ignored.belowMinimum++; return false; }
    return this.push({ nickname: clean(donation.nickname, 20) || '익명', amount: donation.amount, message: clean(donation.text, ALERT_MESSAGE_MAX) });
  }
  /** Operator test: {amount, nickname?, message?}. Not limited by the minimum so every look can be tried. */
  test(input) {
    if (!plain(input) || Object.keys(input).some(key => !['nickname', 'amount', 'message'].includes(key)) || !int(input.amount, [1, 10000000]) ||
      (input.nickname !== undefined && typeof input.nickname !== 'string') || (input.message !== undefined && typeof input.message !== 'string')) throw fail('테스트할 치즈 금액(1 이상)을 확인해 주세요.');
    const now = this.now();
    if (now - this.lastTestAt < ALERT_TEST_INTERVAL_MS) throw fail('테스트 알림은 1초에 한 번만 보낼 수 있어요.', 429);
    this.guard();
    this.lastTestAt = now;
    return this.push({ test: true, nickname: clean(input.nickname, 20) || '테스트', amount: input.amount, message: clean(input.message, ALERT_MESSAGE_MAX) });
  }
  /** OBS feed: display settings plus alerts newer than `after` from this boot. */
  feed(after, boot) {
    const { settings } = this.store.snapshot();
    const since = boot === this.boot && Number.isSafeInteger(after) && after >= 0 ? after : 0;
    return { boot: this.boot, last: this.seq,
      settings: { template: settings.template, durationSeconds: settings.durationSeconds, sound: settings.sound, showMessage: settings.showMessage },
      alerts: this.alerts.filter(alert => alert.id > since).map(alert => ({ ...alert, message: settings.showMessage ? alert.message : '' })) };
  }
  /** Streamer view: the latest alerts without messages (nickname and amount are enough to check). */
  recent(limit = 10) { return this.alerts.slice(-limit).reverse().map(({ id, at, nickname, amount, test }) => ({ id, at, nickname, amount, ...(test ? { test } : {}) })); }
  async close() { this.unsubscribe(); if (this.session) { this.session.stop(); this.session = null; } }
}

/** Streamer routes. They inherit dashboard/workspace authentication, CSRF, Idempotency-Key, the `broadcast` capability and workspace allowlists. */
export function installDonationAlertRoutes({ app, store, service, guard }) {
  const unavailable = () => fail('OBS 후원 알림을 준비하지 못했습니다.', 503);
  const json = (res, value) => res.set('Cache-Control', 'no-store').json(value);
  const view = () => ({ ...store.snapshot(), status: service ? service.status() : { state: 'unavailable', verification: 'pending' }, recent: service ? service.recent(10) : [] });
  app.get('/api/donation-alert', (_req, res, next) => { try { if (!store) throw unavailable(); json(res, view()); } catch (error) { next(error); } });
  app.post('/api/donation-alert', async (req, res, next) => {
    try { if (!store) throw unavailable(); guard(); await store.configure(req.body, { guard }); service?.sync(); json(res, view()); } catch (error) { next(error); }
  });
  app.post('/api/donation-alert/test', (req, res, next) => {
    try { if (!store || !service) throw unavailable(); guard(); const alert = service.test(req.body); json(res, { ...view(), test: { id: alert.id } }); } catch (error) { next(error); }
  });
}
