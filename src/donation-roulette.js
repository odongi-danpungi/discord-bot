import { createHash, randomInt, randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { ROULETTE_LIMITS, STORED_ROULETTE_LIMITS, normalizeRouletteItems, readRoulette, spinRoulette } from './roulette.js';
import { ChzzkDonationSession } from './chzzk-session.js';

// CHZZK cheese donation -> roulette. Each donation at or above a tier's minimum
// spins that tier's list once, or (repeat mode) once per tier minimum up to maxSpins. Results reuse the existing roulette persistence
// (Operations atomic save, history, idempotency receipts) as `custom` draws and
// never touch the Queue. Settings and the short donation log live in a
// separate file so older releases can still read every existing data file.

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const revision = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const DONATION_TIER_LIMIT = 5, DONATION_LOG_LIMIT = 60, DONATION_PENDING_LIMIT = 50, DONATION_MAX_SPINS = 10, DONATION_TEST_INTERVAL_MS = 3000;
const SPIN_MODES = ['once', 'repeat'];
const MIN_AMOUNT = 1, MAX_AMOUNT = 100000000;
const EVENT_STATUSES = ['spun', 'skipped'];

function tiers(value, limits = ROULETTE_LIMITS) {
  if (!Array.isArray(value) || value.length < 1 || value.length > DONATION_TIER_LIMIT) throw fail(`금액 구간은 1~${DONATION_TIER_LIMIT}개로 설정해 주세요.`);
  const result = value.map(tier => {
    if (!plain(tier) || Object.keys(tier).length !== 2 || !Object.hasOwn(tier, 'minAmount') || !Object.hasOwn(tier, 'items')) throw fail('금액 구간 형식을 확인해 주세요.');
    if (!Number.isSafeInteger(tier.minAmount) || tier.minAmount < MIN_AMOUNT || tier.minAmount > MAX_AMOUNT) throw fail('최소 후원 금액은 1~100,000,000치즈 사이의 정수로 입력해 주세요.');
    return { minAmount: tier.minAmount, items: normalizeRouletteItems(tier.items, limits).map(entry => entry.label) };
  }).sort((a, b) => a.minAmount - b.minAmount);
  for (let i = 1; i < result.length; i++) if (result[i].minAmount === result[i - 1].minAmount) throw fail('같은 최소 금액의 구간을 두 번 만들 수 없습니다.');
  return result;
}

const validMaxSpins = value => Number.isInteger(value) && value >= 1 && value <= DONATION_MAX_SPINS;
/** Older saved settings have no spin mode: they keep one spin per donation. */
export function donationSettings(settings) {
  return { enabled: settings.enabled, tiers: settings.tiers, spinMode: SPIN_MODES.includes(settings.spinMode) ? settings.spinMode : 'once', maxSpins: validMaxSpins(settings.maxSpins) ? settings.maxSpins : 1 };
}

/** Validates operator input: {enabled, tiers:[{minAmount, items[]}], spinMode?, maxSpins?, revision}. */
export function validateDonationRouletteInput(input) {
  const base = ['enabled', 'tiers', 'revision'], extended = [...base, 'spinMode', 'maxSpins'];
  const keys = plain(input) ? Object.keys(input) : [];
  const shape = keys.length === 3 ? base : keys.length === 5 ? extended : null;
  if (!shape || !shape.every(key => Object.hasOwn(input, key)) || typeof input.enabled !== 'boolean' || !revision(input.revision)) throw fail('후원 룰렛 설정과 최신 버전을 확인해 주세요.');
  if (shape === extended && (!SPIN_MODES.includes(input.spinMode) || !validMaxSpins(input.maxSpins))) throw fail(`돌리는 방식과 한 후원당 최대 횟수(1~${DONATION_MAX_SPINS}회)를 확인해 주세요.`);
  return { enabled: input.enabled, tiers: tiers(input.tiers), spinMode: shape === extended ? input.spinMode : 'once', maxSpins: shape === extended ? input.maxSpins : 1, revision: input.revision };
}

/** How many times one donation spins: once, or floor(amount / tier minimum) capped at maxSpins. */
export function spinCount(settings, tier, amount) {
  const value = donationSettings(settings);
  if (!tier) return 0;
  if (value.spinMode !== 'repeat') return 1;
  return Math.max(1, Math.min(value.maxSpins, Math.floor(amount / tier.minAmount)));
}

/** The highest tier whose minimum does not exceed the donation amount. */
export function tierForAmount(settingsTiers, amount) {
  let chosen = null;
  for (const tier of settingsTiers || []) if (amount >= tier.minAmount && (!chosen || tier.minAmount > chosen.minAmount)) chosen = tier;
  return chosen;
}

function validEvent(event) {
  if (!plain(event) || typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(event.id) || !revision(event.at) || !EVENT_STATUSES.includes(event.status) ||
    typeof event.nickname !== 'string' || event.nickname.length > 20 || !Number.isSafeInteger(event.amount) || event.amount <= 0) return false;
  if (Object.hasOwn(event, 'test') && event.test !== true) return false;
  if (event.status === 'skipped') return typeof event.reason === 'string' && event.reason.length <= 200;
  if (Object.hasOwn(event, 'spins') && !(validMaxSpins(event.spins) && Number.isInteger(event.spin) && event.spin >= 1 && event.spin <= event.spins)) return false;
  if (!event.test && !Object.hasOwn(event, 'resultId')) return false;
  return Number.isSafeInteger(event.tierMin) && (event.test === true || typeof event.resultId === 'string') && Array.isArray(event.entries) && event.entries.length >= 2 && event.entries.length <= 100 &&
    event.entries.every(label => typeof label === 'string' && label.length <= 320) && Number.isInteger(event.winnerIndex) && event.winnerIndex >= 0 && event.winnerIndex < event.entries.length;
}

function validate(state) {
  if (!plain(state) || state.version !== 1 || !revision(state.revision) || !plain(state.settings) || typeof state.settings.enabled !== 'boolean' || !Array.isArray(state.events) || state.events.length > DONATION_LOG_LIMIT) return false;
  if (state.settings.tiers.length === 0 && state.settings.enabled) return false;
  if (Object.hasOwn(state.settings, 'spinMode') && !SPIN_MODES.includes(state.settings.spinMode)) return false;
  if (Object.hasOwn(state.settings, 'maxSpins') && !validMaxSpins(state.settings.maxSpins)) return false;
  // Saved settings stay readable under the earlier 100-item / 80-character rule; new saves use the stricter one.
  if (state.settings.tiers.length) { try { if (JSON.stringify(tiers(state.settings.tiers, STORED_ROULETTE_LIMITS)) !== JSON.stringify(state.settings.tiers)) return false; } catch { return false; } }
  return state.events.every(validEvent);
}

export class DonationRouletteStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.donation-roulette.json', { version: 1, revision: 0, settings: { enabled: false, tiers: [] }, events: [] }, validate, { maxBytes: 4 * 1024 * 1024 });
  }
  snapshot() {
    const state = this.read();
    return { settings: donationSettings(state.settings), revision: state.revision, events: state.events };
  }
  async configure(input, { guard = () => {} } = {}) {
    const value = validateDonationRouletteInput(input);
    let result;
    await this.update(async state => {
      await guard();
      if (state.revision !== value.revision) throw fail('다른 운영자가 후원 룰렛 설정을 변경했습니다. 최신 설정을 확인한 뒤 다시 저장하세요.', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409);
      state.settings = { enabled: value.enabled, tiers: value.tiers, spinMode: value.spinMode, maxSpins: value.maxSpins }; state.revision++;
      result = { settings: state.settings, revision: state.revision };
    });
    return result;
  }
  /** Records one event or several spins of one donation; the log stays newest first. */
  async record(event) {
    const added = Array.isArray(event) ? [...event].reverse() : [event];
    await this.update(state => { state.events = [...added, ...state.events].slice(0, DONATION_LOG_LIMIT); });
  }
}

/** Public (operator/OBS) view of recorded donations. No donor channel ids are ever stored. */
export function publicDonationEvents(events, limit = DONATION_LOG_LIMIT) {
  return (events || []).slice(0, limit).map(event => {
    const common = { id: event.id, at: event.at, nickname: event.nickname, amount: event.amount, test: event.test === true };
    return event.status === 'spun'
      ? { ...common, status: 'spun', tierMin: event.tierMin, spin: event.spin || 1, spins: event.spins || 1, entries: event.entries, winnerIndex: event.winnerIndex, winner: event.entries[event.winnerIndex] }
      : { ...common, status: 'skipped', reason: event.reason };
  });
}

/**
 * Connects the broadcaster's CHZZK donation events to the roulette.
 * - Runs only while the setting is enabled and a broadcaster account is connected.
 * - Ignores donations for any channel other than the connected broadcaster.
 * - Processes donations one at a time in arrival order; a full backlog is skipped and logged.
 * - Operation locks (emergency lock, draining, release) skip the spin and log why.
 */
export class DonationRouletteService {
  constructor({ store, operations, chzzkVerification, guard = () => {}, sessionFactory = options => new ChzzkDonationSession(options), now = Date.now, reporter = () => {}, randomIntImpl = randomInt }) {
    Object.assign(this, { store, operations, chzzkVerification, guard, sessionFactory, now, reporter, randomIntImpl });
    this.lastTestAt = 0;
    this.session = null; this.chain = Promise.resolve(); this.pending = 0; this.ignored = { belowMinimum: 0, otherChannel: 0 };
    const unsubscribeSettings = store.subscribe(() => this.sync());
    const unsubscribeOwner = chzzkVerification?.store?.subscribe?.(() => this.sync()) || (() => {});
    this.unsubscribe = () => { unsubscribeSettings(); unsubscribeOwner(); };
  }
  connected() {
    try { return Boolean(this.chzzkVerification?.summary?.().ownerConnected && this.chzzkVerification.targetChannelId()); } catch { return false; }
  }
  sync() {
    const { settings } = this.store.snapshot();
    const wanted = settings.enabled && settings.tiers.length > 0 && this.connected();
    let channel = '';
    try { channel = wanted ? this.chzzkVerification.targetChannelId() : ''; } catch {}
    // A different broadcaster consent needs a new user session for that account.
    if (this.session && (!wanted || channel !== this.sessionChannel)) { this.session.stop(); this.session = null; }
    if (wanted && !this.session) {
      this.sessionChannel = channel;
      this.session = this.sessionFactory({ accessToken: () => this.chzzkVerification.ownerToken(), onDonation: donation => this.enqueue(donation),
        onStatus: status => { if (['auth_required', 'reconnecting'].includes(status.status)) this.reporter({ severity: 'warn', code: 'chzzk_donation_session', summary: 'CHZZK 후원 세션 연결 확인 필요', detail: status.detail }); } });
      this.session.start();
    }
  }
  status() {
    const { settings } = this.store.snapshot();
    const session = this.session?.status() || null;
    const state = !this.chzzkVerification ? 'unavailable' : !this.connected() ? 'not_connected' : !settings.enabled ? 'disabled' : session?.status || 'stopped';
    return { state, detail: session?.detail || '', since: session?.since || 0, lastEventAt: session?.lastEventAt || 0, ignored: { ...this.ignored }, pending: this.pending,
      // Delivery of real donations is not proven by a subscription acknowledgement.
      verification: 'pending' };
  }
  enqueue(donation) {
    if (this.pending >= DONATION_PENDING_LIMIT) {
      return this.skip(donation, '처리 대기 중인 후원이 너무 많아 이 후원은 룰렛을 돌리지 않았습니다.');
    }
    this.pending++;
    const task = this.chain.then(() => this.handle(donation));
    this.chain = task.then(() => {}, () => {}).finally(() => { this.pending--; });
    return task;
  }
  async skip(donation, reason) {
    const event = { id: 'donation-' + randomUUID(), at: this.now(), status: 'skipped', nickname: donation.nickname, amount: donation.amount, reason, ...(donation.test ? { test: true } : {}) };
    try { await this.store.record(event); } catch {}
    return event;
  }
  /**
   * Operator test donation: same tier and spin-count rules and the same OBS display,
   * but never writes roulette history or Operations, needs no CHZZK connection, and
   * is labelled as a test everywhere it is shown.
   */
  async test(input) {
    if (!plain(input) || Object.keys(input).some(key => !['nickname', 'amount'].includes(key)) || !Number.isSafeInteger(input.amount) || input.amount < MIN_AMOUNT || input.amount > MAX_AMOUNT ||
      (input.nickname !== undefined && typeof input.nickname !== 'string')) throw fail('테스트 후원 금액은 1~100,000,000치즈 사이의 정수로 입력해 주세요.');
    const nickname = String(input.nickname ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 20) || '테스트';
    const { settings } = this.store.snapshot();
    if (!settings.tiers.length) throw fail('금액 구간을 먼저 저장해 주세요.', 409);
    if (!tierForAmount(settings.tiers, input.amount)) throw fail(`가장 낮은 구간(${settings.tiers[0].minAmount.toLocaleString('ko-KR')}치즈)보다 적은 금액은 룰렛을 돌리지 않습니다.`);
    const now = this.now();
    if (now - this.lastTestAt < DONATION_TEST_INTERVAL_MS) throw fail('테스트 후원은 3초에 한 번만 보낼 수 있습니다.', 429);
    this.guard();
    this.lastTestAt = now;
    return this.enqueue({ test: true, channelId: '', donationType: 'CHAT', nickname, amount: input.amount });
  }
  async handle(donation) {
    if (!donation.test) {
      let target = '';
      try { target = this.chzzkVerification.targetChannelId(); } catch {}
      if (!target || donation.channelId !== target) { this.ignored.otherChannel++; return null; }
    }
    const { settings } = this.store.snapshot();
    if (!settings.enabled && !donation.test) return null;
    const tier = tierForAmount(settings.tiers, donation.amount);
    if (!tier) { if (!donation.test) this.ignored.belowMinimum++; return null; }
    try { this.guard(); } catch { return this.skip(donation, '운영 잠금 또는 재시작 대기 중이라 룰렛을 돌리지 않았습니다.'); }
    const spins = spinCount(settings, tier, donation.amount), base = 'donation-' + randomUUID();
    const counted = spins > 1 ? spin => ({ spin, spins }) : () => ({});
    if (donation.test) {
      const at = this.now(), events = [];
      for (let spin = 1; spin <= spins; spin++) {
        const winnerIndex = this.randomIntImpl(tier.items.length);
        events.push({ id: `${base}-${spin}`, at, status: 'spun', test: true, nickname: donation.nickname, amount: donation.amount, tierMin: tier.minAmount, ...counted(spin), entries: [...tier.items], winnerIndex });
      }
      await this.store.record(events);
      return events;
    }
    let results;
    try {
      results = await this.operations.update(state => {
        this.guard();
        // All spins of one donation commit together. Each reads the roulette revision
        // inside the atomic update so a concurrent manual spin cannot conflict.
        const done = [];
        for (let spin = 1; spin <= spins; spin++) {
          const requestId = `${base}-${spin}`;
          const fingerprint = createHash('sha256').update(JSON.stringify({ source: 'donation', requestId, minAmount: tier.minAmount, items: tier.items })).digest('hex');
          done.push(spinRoulette(state, { requestId, expectedRevision: readRoulette(state).revision, source: 'custom', items: tier.items, fingerprint }).result);
        }
        return done;
      });
    } catch (error) {
      return this.skip(donation, error?.status === 423 ? '운영 잠금 중이라 룰렛을 돌리지 않았습니다.' : '룰렛 결과를 저장하지 못해 이 후원은 돌리지 않았습니다.');
    }
    const events = results.map((result, index) => ({ id: result.requestId, at: result.at, status: 'spun', nickname: donation.nickname, amount: donation.amount, tierMin: tier.minAmount,
      ...counted(index + 1), resultId: result.id, entries: result.entries.map(entry => entry.label), winnerIndex: result.winnerIndex }));
    try { await this.store.record(events); } catch {}
    return events.length === 1 ? events[0] : events;
  }
  async close() {
    this.unsubscribe?.(); this.session?.stop(); this.session = null;
    await this.chain.catch(() => {});
  }
}
