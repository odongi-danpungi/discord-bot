import { createHash, randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { normalizeRouletteItems, readRoulette, spinRoulette } from './roulette.js';
import { ChzzkDonationSession } from './chzzk-session.js';

// CHZZK cheese donation -> roulette. Each donation at or above a tier's minimum
// spins that tier's list once. Results reuse the existing roulette persistence
// (Operations atomic save, history, idempotency receipts) as `custom` draws and
// never touch the Queue. Settings and the short donation log live in a
// separate file so older releases can still read every existing data file.

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const revision = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const DONATION_TIER_LIMIT = 5, DONATION_LOG_LIMIT = 30, DONATION_PENDING_LIMIT = 50;
const MIN_AMOUNT = 1, MAX_AMOUNT = 100000000;
const EVENT_STATUSES = ['spun', 'skipped'];

function tiers(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > DONATION_TIER_LIMIT) throw fail(`금액 구간은 1~${DONATION_TIER_LIMIT}개로 설정해 주세요.`);
  const result = value.map(tier => {
    if (!plain(tier) || Object.keys(tier).length !== 2 || !Object.hasOwn(tier, 'minAmount') || !Object.hasOwn(tier, 'items')) throw fail('금액 구간 형식을 확인해 주세요.');
    if (!Number.isSafeInteger(tier.minAmount) || tier.minAmount < MIN_AMOUNT || tier.minAmount > MAX_AMOUNT) throw fail('최소 후원 금액은 1~100,000,000치즈 사이의 정수로 입력해 주세요.');
    return { minAmount: tier.minAmount, items: normalizeRouletteItems(tier.items).map(entry => entry.label) };
  }).sort((a, b) => a.minAmount - b.minAmount);
  for (let i = 1; i < result.length; i++) if (result[i].minAmount === result[i - 1].minAmount) throw fail('같은 최소 금액의 구간을 두 번 만들 수 없습니다.');
  return result;
}

/** Validates operator input: {enabled, tiers:[{minAmount, items[]}], revision}. */
export function validateDonationRouletteInput(input) {
  if (!plain(input) || Object.keys(input).length !== 3 || !['enabled', 'tiers', 'revision'].every(key => Object.hasOwn(input, key)) ||
    typeof input.enabled !== 'boolean' || !revision(input.revision)) throw fail('후원 룰렛 설정과 최신 버전을 확인해 주세요.');
  return { enabled: input.enabled, tiers: tiers(input.tiers), revision: input.revision };
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
  if (event.status === 'skipped') return typeof event.reason === 'string' && event.reason.length <= 200;
  return Number.isSafeInteger(event.tierMin) && typeof event.resultId === 'string' && Array.isArray(event.entries) && event.entries.length >= 2 && event.entries.length <= 100 &&
    event.entries.every(label => typeof label === 'string' && label.length <= 320) && Number.isInteger(event.winnerIndex) && event.winnerIndex >= 0 && event.winnerIndex < event.entries.length;
}

function validate(state) {
  if (!plain(state) || state.version !== 1 || !revision(state.revision) || !plain(state.settings) || typeof state.settings.enabled !== 'boolean' || !Array.isArray(state.events) || state.events.length > DONATION_LOG_LIMIT) return false;
  if (state.settings.tiers.length === 0 && state.settings.enabled) return false;
  if (state.settings.tiers.length) { try { if (JSON.stringify(tiers(state.settings.tiers)) !== JSON.stringify(state.settings.tiers)) return false; } catch { return false; } }
  return state.events.every(validEvent);
}

export class DonationRouletteStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.donation-roulette.json', { version: 1, revision: 0, settings: { enabled: false, tiers: [] }, events: [] }, validate, { maxBytes: 2 * 1024 * 1024 });
  }
  snapshot() {
    const state = this.read();
    return { settings: state.settings, revision: state.revision, events: state.events };
  }
  async configure(input, { guard = () => {} } = {}) {
    const value = validateDonationRouletteInput(input);
    let result;
    await this.update(async state => {
      await guard();
      if (state.revision !== value.revision) throw fail('다른 운영자가 후원 룰렛 설정을 변경했습니다. 최신 설정을 확인한 뒤 다시 저장하세요.', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409);
      state.settings = { enabled: value.enabled, tiers: value.tiers }; state.revision++;
      result = { settings: state.settings, revision: state.revision };
    });
    return result;
  }
  async record(event) {
    await this.update(state => { state.events = [event, ...state.events].slice(0, DONATION_LOG_LIMIT); });
  }
}

/** Public (operator/OBS) view of recorded donations. No donor channel ids are ever stored. */
export function publicDonationEvents(events, limit = DONATION_LOG_LIMIT) {
  return (events || []).slice(0, limit).map(event => event.status === 'spun'
    ? { id: event.id, at: event.at, status: 'spun', nickname: event.nickname, amount: event.amount, tierMin: event.tierMin, entries: event.entries, winnerIndex: event.winnerIndex, winner: event.entries[event.winnerIndex] }
    : { id: event.id, at: event.at, status: 'skipped', nickname: event.nickname, amount: event.amount, reason: event.reason });
}

/**
 * Connects the broadcaster's CHZZK donation events to the roulette.
 * - Runs only while the setting is enabled and a broadcaster account is connected.
 * - Ignores donations for any channel other than the connected broadcaster.
 * - Processes donations one at a time in arrival order; a full backlog is skipped and logged.
 * - Operation locks (emergency lock, draining, release) skip the spin and log why.
 */
export class DonationRouletteService {
  constructor({ store, operations, chzzkVerification, guard = () => {}, sessionFactory = options => new ChzzkDonationSession(options), now = Date.now, reporter = () => {} }) {
    Object.assign(this, { store, operations, chzzkVerification, guard, sessionFactory, now, reporter });
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
    const event = { id: 'donation-' + randomUUID(), at: this.now(), status: 'skipped', nickname: donation.nickname, amount: donation.amount, reason };
    try { await this.store.record(event); } catch {}
    return event;
  }
  async handle(donation) {
    let target = '';
    try { target = this.chzzkVerification.targetChannelId(); } catch {}
    if (!target || donation.channelId !== target) { this.ignored.otherChannel++; return null; }
    const { settings } = this.store.snapshot();
    if (!settings.enabled) return null;
    const tier = tierForAmount(settings.tiers, donation.amount);
    if (!tier) { this.ignored.belowMinimum++; return null; }
    try { this.guard(); } catch { return this.skip(donation, '운영 잠금 또는 재시작 대기 중이라 룰렛을 돌리지 않았습니다.'); }
    const requestId = 'donation-' + randomUUID();
    const fingerprint = createHash('sha256').update(JSON.stringify({ source: 'donation', requestId, minAmount: tier.minAmount, items: tier.items })).digest('hex');
    let spun;
    try {
      spun = await this.operations.update(state => {
        this.guard();
        // Read the roulette revision inside the atomic update so a concurrent manual spin cannot conflict.
        return spinRoulette(state, { requestId, expectedRevision: readRoulette(state).revision, source: 'custom', items: tier.items, fingerprint });
      });
    } catch (error) {
      return this.skip(donation, error?.status === 423 ? '운영 잠금 중이라 룰렛을 돌리지 않았습니다.' : '룰렛 결과를 저장하지 못해 이 후원은 돌리지 않았습니다.');
    }
    const result = spun.result;
    const event = { id: requestId, at: result.at, status: 'spun', nickname: donation.nickname, amount: donation.amount, tierMin: tier.minAmount,
      resultId: result.id, entries: result.entries.map(entry => entry.label), winnerIndex: result.winnerIndex };
    try { await this.store.record(event); } catch {}
    return event;
  }
  async close() {
    this.unsubscribe?.(); this.session?.stop(); this.session = null;
    await this.chain.catch(() => {});
  }
}
