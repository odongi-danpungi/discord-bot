import { JsonStore } from './json-store.js';
import { ChzzkEventSession, normalizeDonation } from './chzzk-session.js';

// OBS 후원 목표: cheese donations fill a bar toward a goal.
// Saved (`operations.json.donation-goal.json`): settings and the running total/count only.
// Who donated and what they wrote are never stored here.

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const CONTROL = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;
const clean = (value, limit) => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const int = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;

export const GOAL_LIMITS = Object.freeze({ title: 30, target: [100, 100000000], total: [0, 1000000000000], testIntervalMs: 1000 });
const DEFAULTS = () => ({ enabled: false, title: '오늘의 후원 목표', target: 50000, countTests: false });
const KEYS = ['enabled', 'title', 'target', 'countTests'];

function validSettings(s) {
  return plain(s) && Object.keys(s).sort().join() === [...KEYS].sort().join() && typeof s.enabled === 'boolean' && typeof s.countTests === 'boolean' &&
    int(s.target, GOAL_LIMITS.target) && typeof s.title === 'string' && s.title.length >= 1 && s.title.length <= GOAL_LIMITS.title && s.title === clean(s.title, GOAL_LIMITS.title);
}
const validProgress = p => plain(p) && Object.keys(p).sort().join() === 'count,resetAt,total,updatedAt' && int(p.total, GOAL_LIMITS.total) && int(p.count, [0, 100000000]) && Number.isFinite(p.updatedAt) && Number.isFinite(p.resetAt);

export function validateDonationGoalInput(input) {
  if (!plain(input) || Object.keys(input).sort().join() !== [...KEYS, 'revision'].sort().join() || !revision(input.revision)) throw fail('후원 목표 설정과 최신 버전을 확인해 주세요.');
  const settings = { enabled: input.enabled, title: typeof input.title === 'string' ? clean(input.title, GOAL_LIMITS.title + 1) : input.title, target: input.target, countTests: input.countTests };
  if (typeof settings.title !== 'string' || !settings.title) throw fail('목표 제목을 입력해 주세요.');
  if (settings.title.length > GOAL_LIMITS.title) throw fail(`목표 제목은 ${GOAL_LIMITS.title}자까지예요.`);
  if (!int(settings.target, GOAL_LIMITS.target)) throw fail(`목표 금액은 ${GOAL_LIMITS.target[0].toLocaleString('ko-KR')}~${GOAL_LIMITS.target[1].toLocaleString('ko-KR')}치즈예요.`);
  if (!validSettings(settings)) throw fail('후원 목표 설정을 확인해 주세요.');
  return { settings, revision: input.revision };
}

export class DonationGoalStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.donation-goal.json', { version: 1, revision: 0, settings: DEFAULTS(), progress: { total: 0, count: 0, updatedAt: 0, resetAt: 0 } },
      state => plain(state) && state.version === 1 && revision(state.revision) && validSettings(state.settings) && validProgress(state.progress), { maxBytes: 64 * 1024 });
  }
  snapshot() { const state = this.read(); return { settings: { ...state.settings }, progress: { ...state.progress }, revision: state.revision }; }
}

export class DonationGoalService {
  constructor({ store, chzzkVerification = null, guard = () => {}, now = Date.now, reporter = () => {},
    sessionFactory = options => new ChzzkEventSession({ accessToken: options.accessToken, onStatus: options.onStatus, handlers: { DONATION: payload => options.onDonation(payload) } }) }) {
    Object.assign(this, { store, chzzkVerification, guard, now, reporter, sessionFactory });
    this.session = null; this.sessionChannel = ''; this.ignored = { otherChannel: 0 }; this.lastTestAt = 0;
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
        onStatus: status => { if (status?.status === 'auth_required') this.reporter({ severity: 'warn', code: 'chzzk_goal_session', summary: 'CHZZK 후원 세션 권한 확인 필요(후원 목표)', detail: status.detail }); } });
      this.session.start();
    }
  }
  status() {
    const { settings } = this.store.snapshot(), session = this.session?.status() || null;
    const state = !this.chzzkVerification ? 'unavailable' : !this.connected() ? 'not_connected' : !settings.enabled ? 'disabled' : session?.status || 'stopped';
    return { state, detail: session?.detail || '', ignored: { ...this.ignored }, verification: 'pending' };
  }
  bump(state) { if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('작업을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409); state.revision++; }
  async add(amount) {
    let result;
    await this.store.update(state => {
      state.progress.total = Math.min(GOAL_LIMITS.total[1], state.progress.total + amount); state.progress.count++; state.progress.updatedAt = this.now();
      this.bump(state); result = { ...state.progress };
    });
    return result;
  }
  /** A CHZZK DONATION payload. Counts the amount only; nothing about the donor is kept. */
  async receive(payload) {
    const donation = normalizeDonation(payload);
    if (!donation) return false;
    let target = ''; try { target = this.chzzkVerification.targetChannelId(); } catch {}
    if (!target || donation.channelId !== target) { this.ignored.otherChannel++; return false; }
    if (!this.store.snapshot().settings.enabled) return false;
    return this.add(donation.amount);
  }
  async configure(input) {
    const value = validateDonationGoalInput(input);
    this.guard();
    let result;
    await this.store.update(state => {
      this.guard();
      if (state.revision !== value.revision) throw fail('다른 곳에서 후원 목표가 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요.', 409);
      state.settings = value.settings; this.bump(state); result = { settings: { ...state.settings }, revision: state.revision };
    });
    return result;
  }
  /** Starts the bar from zero (new broadcast or new goal). Input: {revision}. */
  async reset(input) {
    if (!plain(input) || Object.keys(input).join() !== 'revision' || !revision(input.revision)) throw fail('초기화할 목표를 확인해 주세요.');
    this.guard();
    await this.store.update(state => {
      this.guard();
      if (state.revision !== input.revision) throw fail('다른 곳에서 후원 목표가 바뀌었어요. 새로고침해 주세요.', 409);
      state.progress = { total: 0, count: 0, updatedAt: this.now(), resetAt: this.now() }; this.bump(state);
    });
  }
  /** Test donation: moves the bar only when "테스트도 더하기" is on, otherwise shows the effect without saving. */
  async test(input) {
    if (!plain(input) || Object.keys(input).join() !== 'amount' || !int(input.amount, [1, 10000000])) throw fail('테스트할 치즈 금액(1 이상)을 확인해 주세요.');
    const now = this.now();
    if (now - this.lastTestAt < GOAL_LIMITS.testIntervalMs) throw fail('테스트는 1초에 한 번만 보낼 수 있어요.', 429);
    this.guard(); this.lastTestAt = now;
    if (this.store.snapshot().settings.countTests) return { counted: true, progress: await this.add(input.amount) };
    this.preview = { amount: input.amount, at: now };
    return { counted: false };
  }
  /** OBS feed: title, target and total; a recent uncounted test is shown as a flash only. */
  feed() {
    const { settings, progress } = this.store.snapshot();
    const preview = this.preview && this.now() - this.preview.at < 10000 ? { ...this.preview } : null;
    return { enabled: settings.enabled, title: settings.title, target: settings.target, total: progress.total, count: progress.count, updatedAt: progress.updatedAt, preview };
  }
  adminView() { return { ...this.store.snapshot(), status: this.status() }; }
  async close() { this.unsubscribe(); if (this.session) { this.session.stop(); this.session = null; } }
}

/** Streamer routes (`broadcast` capability, workspace allowlist, CSRF, Idempotency-Key, emergency lock). */
export function installDonationGoalRoutes({ app, service }) {
  const unavailable = () => fail('후원 목표를 준비하지 못했습니다.', 503);
  const json = (res, value) => res.set('Cache-Control', 'no-store').json(value);
  app.get('/api/donation-goal', (_req, res, next) => { try { if (!service) throw unavailable(); json(res, service.adminView()); } catch (error) { next(error); } });
  const post = (path, action) => app.post(path, async (req, res, next) => { try { if (!service) throw unavailable(); const extra = await action(req.body); service.sync(); json(res, { ...service.adminView(), ...(extra || {}) }); } catch (error) { next(error); } });
  post('/api/donation-goal', body => service.configure(body).then(() => null));
  post('/api/donation-goal/reset', body => service.reset(body).then(() => null));
  post('/api/donation-goal/test', body => service.test(body).then(test => ({ test })));
}
