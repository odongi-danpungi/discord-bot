import { randomBytes, randomInt } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { ChzzkEventSession, normalizeDonationText } from './chzzk-session.js';

// 뽑기판: a 1–100 board. A cheese donation opens one number per `amount` cheese, taken in order
// from the numbers written in the donation message ("11 23"). Each number hides 꽝 or a prize.
// The layout is drawn by the server and only the creator can read it (no audit entry is written
// for that read). Numbers that cannot be used (already open, outside 1–100, missing, board not
// ready) become saved chances that the streamer opens on the donor's behalf.
// Saved separately in `operations.json.lottery-board.json`. The donation message itself is read
// in memory and never stored; the donor nickname is kept with opened numbers for the broadcast.

export const BOARD_SIZE = 100;
export const LOTTERY_LIMITS = Object.freeze({ amount: [100, 1000000], perDonation: [1, 20], prizes: [1, 10], count: [1, 100], rank: 10, name: 20 });
const PENDING_LIMIT = 100, LOG_LIMIT = 100;

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const int = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, limit);
const newId = prefix => prefix + randomBytes(4).toString('hex');
const prizeId = value => typeof value === 'string' && /^p[a-f0-9]{8}$/.test(value);

const defaultSettings = () => ({ enabled: false, amount: 1000, perDonation: 10,
  prizes: [{ id: newId('p'), rank: '1등', name: '신청곡 1곡', count: 1 }, { id: newId('p'), rank: '2등', name: '애칭 불러 주기', count: 3 }, { id: newId('p'), rank: '3등', name: '응원 한마디', count: 6 }] });

const validPrize = p => plain(p) && prizeId(p.id) && typeof p.rank === 'string' && p.rank.length >= 1 && p.rank.length <= LOTTERY_LIMITS.rank &&
  typeof p.name === 'string' && p.name.length <= LOTTERY_LIMITS.name && int(p.count, LOTTERY_LIMITS.count);
const validPrizes = list => Array.isArray(list) && list.length >= LOTTERY_LIMITS.prizes[0] && list.length <= LOTTERY_LIMITS.prizes[1] && list.every(validPrize) &&
  new Set(list.map(p => p.id)).size === list.length && list.reduce((sum, p) => sum + p.count, 0) <= BOARD_SIZE;
const validSettings = s => plain(s) && typeof s.enabled === 'boolean' && int(s.amount, LOTTERY_LIMITS.amount) && int(s.perDonation, LOTTERY_LIMITS.perDonation) && validPrizes(s.prizes);
const validBoard = b => b === null || (plain(b) && /^b[a-f0-9]{8}$/.test(b.id) && Number.isFinite(b.createdAt) && validPrizes(b.prizes) &&
  Array.isArray(b.layout) && b.layout.length === BOARD_SIZE && b.layout.every(id => id === '' || b.prizes.some(p => p.id === id)) &&
  Array.isArray(b.opened) && b.opened.length <= BOARD_SIZE && b.opened.every(o => plain(o) && int(o.n, [1, BOARD_SIZE]) && Number.isFinite(o.at) && typeof o.nickname === 'string' && o.nickname.length <= 20) &&
  new Set(b.opened.map(o => o.n)).size === b.opened.length);
const validState = state => plain(state) && state.version === 1 && revision(state.revision) && validSettings(state.settings) && validBoard(state.board) &&
  Array.isArray(state.pending) && state.pending.length <= PENDING_LIMIT && state.pending.every(p => plain(p) && /^q[a-f0-9]{8}$/.test(p.id) && typeof p.nickname === 'string' && p.nickname.length <= 20 && int(p.count, [1, LOTTERY_LIMITS.perDonation[1]]) && Number.isFinite(p.at)) &&
  Array.isArray(state.log) && state.log.length <= LOG_LIMIT;

/** Numbers written in a donation message, in order ("11 23", "11번, 23번"). */
export const messageNumbers = text => (String(text || '').match(/\d+/g) || []).slice(0, 40).map(value => (value.length > 3 ? 0 : Number(value)));

/** Validates streamer input: {enabled, amount, perDonation, prizes:[{id?, name, count}], revision}.
 * Ranks follow the order (1등, 2등, …): the streamer picks how many ranks and how many of each.
 * 1등·2등·3등 are shown as gold, silver and bronze. */
export function validateLotteryInput(input, current) {
  if (!plain(input) || Object.keys(input).sort().join() !== 'amount,enabled,perDonation,prizes,revision' || !revision(input.revision)) throw fail('뽑기판 설정과 최신 버전을 확인해 주세요.');
  if (typeof input.enabled !== 'boolean' || !int(input.amount, LOTTERY_LIMITS.amount)) throw fail(`번호 1개당 금액은 ${LOTTERY_LIMITS.amount[0]}~${LOTTERY_LIMITS.amount[1].toLocaleString('ko-KR')}치즈로 정해 주세요.`);
  if (!int(input.perDonation, LOTTERY_LIMITS.perDonation)) throw fail('후원 1건에 열 수 있는 번호는 1~20개로 정해 주세요.');
  if (!Array.isArray(input.prizes) || input.prizes.length < 1 || input.prizes.length > LOTTERY_LIMITS.prizes[1]) throw fail('상품은 1~10개 등수로 정해 주세요.');
  const known = new Set(current.prizes.map(p => p.id)), seen = new Set();
  const prizes = input.prizes.map((p, index) => {
    if (!plain(p) || Object.keys(p).some(key => !['id', 'rank', 'name', 'count'].includes(key))) throw fail('상품 정보를 확인해 주세요.');
    const rank = `${index + 1}등`, name = clean(p.name, LOTTERY_LIMITS.name + 1);
    if (name.length > LOTTERY_LIMITS.name) throw fail('상품 이름은 20자까지 입력해 주세요.');
    if (!int(p.count, LOTTERY_LIMITS.count)) throw fail('등수별 개수는 1개 이상으로 정해 주세요.');
    if (p.id !== undefined && (!known.has(p.id) || seen.has(p.id))) throw fail('상품 목록이 바뀌었습니다. 새로고침한 뒤 다시 저장하세요.', 409);
    const id = p.id ?? newId('p'); seen.add(id);
    return { id, rank, name, count: p.count };
  });
  const total = prizes.reduce((sum, p) => sum + p.count, 0);
  if (total > BOARD_SIZE) throw fail(`상품 개수의 합은 ${BOARD_SIZE}개를 넘을 수 없어요. 나머지 칸은 꽝이에요.`);
  return { settings: { enabled: input.enabled, amount: input.amount, perDonation: input.perDonation, prizes }, revision: input.revision };
}

export class LotteryBoardStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.lottery-board.json', { version: 1, revision: 0, settings: defaultSettings(), board: null, pending: [], log: [] }, validState, { maxBytes: 512 * 1024 });
  }
}

// `place` is the prize position (1 = 1등 gold, 2 = silver, 3 = bronze); 0 is 꽝.
const label = (board, n) => { const id = board.layout[n - 1], index = board.prizes.findIndex(p => p.id === id), prize = board.prizes[index]; return prize ? { rank: prize.rank, name: prize.name, place: index + 1 } : { rank: '꽝', place: 0, name: '' }; };

export class LotteryBoardService {
  constructor({ store, chzzkVerification = null, guard = () => {}, now = Date.now, random = randomInt,
    sessionFactory = options => new ChzzkEventSession({ accessToken: options.accessToken, onStatus: options.onStatus, handlers: { DONATION: payload => options.onDonation(payload) } }), reporter = () => {} }) {
    Object.assign(this, { store, chzzkVerification, guard, now, random, sessionFactory, reporter });
    this.session = null; this.sessionChannel = ''; this.ignored = { otherChannel: 0 }; this.tests = []; this.lastTestAt = 0;
    const off = [store.subscribe(() => this.sync()), chzzkVerification?.store?.subscribe?.(() => this.sync()) || (() => {})];
    this.unsubscribe = () => off.forEach(fn => fn());
  }
  connected() { try { return Boolean(this.chzzkVerification?.summary?.().ownerConnected && this.chzzkVerification.targetChannelId()); } catch { return false; } }
  sync() {
    const { settings } = this.store.read(), wanted = settings.enabled && this.connected();
    let channel = ''; try { channel = wanted ? this.chzzkVerification.targetChannelId() : ''; } catch {}
    if (this.session && (!wanted || channel !== this.sessionChannel)) { this.session.stop(); this.session = null; }
    if (wanted && !this.session) {
      this.sessionChannel = channel;
      this.session = this.sessionFactory({ accessToken: () => this.chzzkVerification.ownerToken(), onDonation: payload => this.receiveDonation(payload),
        onStatus: status => { if (status?.status === 'auth_required') this.reporter({ severity: 'warn', code: 'chzzk_lottery_session', summary: 'CHZZK 후원 세션 권한 확인 필요(뽑기판)', detail: status.detail }); } });
      this.session.start();
    }
  }
  status() {
    const { settings } = this.store.read(), session = this.session?.status() || null;
    const state = !this.chzzkVerification ? 'unavailable' : !this.connected() ? 'not_connected' : !settings.enabled ? 'disabled' : session?.status || 'stopped';
    return { state, detail: session?.detail || '', ignored: { ...this.ignored }, verification: 'pending' };
  }
  bump(state) { if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('작업을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409); state.revision++; }
  /** Opens one number on the current board. Returns false when it cannot be used. */
  openNumber(state, n, nickname) {
    const board = state.board;
    if (!board || !Number.isInteger(n) || n < 1 || n > BOARD_SIZE || board.opened.some(o => o.n === n)) return false;
    const at = this.now(), result = label(board, n);
    board.opened.push({ n, at, nickname });
    state.log.unshift({ at, n, nickname, rank: result.rank, name: result.name, place: result.place });
    state.log.length = Math.min(state.log.length, LOG_LIMIT);
    return true;
  }
  savePending(state, nickname, count, reason) {
    if (count <= 0) return;
    if (state.pending.length >= PENDING_LIMIT) state.pending.pop();
    state.pending.unshift({ id: newId('q'), nickname, count: Math.min(count, LOTTERY_LIMITS.perDonation[1]), at: this.now(), reason });
  }
  /** Cheese donation: numbers from the message, one per `amount` cheese. The message is not stored. */
  async receiveDonation(payload) {
    const donation = normalizeDonationText(payload);
    if (!donation) return false;
    let target = ''; try { target = this.chzzkVerification.targetChannelId(); } catch {}
    if (!target || donation.channelId !== target) { this.ignored.otherChannel++; return false; }
    const { settings } = this.store.read();
    if (!settings.enabled) return false;
    const picks = Math.min(Math.floor(donation.amount / settings.amount), settings.perDonation);
    if (picks <= 0) return false;
    const numbers = messageNumbers(donation.text).slice(0, picks);
    let locked = false; try { this.guard(); } catch { locked = true; }
    await this.store.update(state => {
      let unused = picks - numbers.length;
      for (const n of numbers) if (locked || !this.openNumber(state, n, donation.nickname)) unused++;
      this.savePending(state, donation.nickname, unused, locked ? '운영 잠금 중 후원' : '열 수 없는 번호');
      this.bump(state);
    });
    return true;
  }
  // ----- streamer -----
  async configure(input) {
    this.guard();
    await this.store.update(state => {
      const value = validateLotteryInput(input, state.settings);
      if (state.revision !== value.revision) throw fail('다른 곳에서 뽑기판 설정이 바뀌었습니다. 새로고침한 뒤 다시 저장하세요.', 409);
      state.settings = value.settings; this.bump(state);
    });
    return this.adminView();
  }
  /** Draws a new board from the current prize settings. The layout is never returned here. */
  async newBoard(input) {
    if (!plain(input) || Object.keys(input).join() !== 'revision' || !revision(input.revision)) throw fail('새 뽑기판 요청을 확인해 주세요.');
    this.guard();
    await this.store.update(state => {
      if (state.revision !== input.revision) throw fail('다른 곳에서 뽑기판이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.', 409);
      const prizes = structuredClone(state.settings.prizes), layout = Array(BOARD_SIZE).fill('');
      const cells = Array.from({ length: BOARD_SIZE }, (_, i) => i);
      for (let i = cells.length - 1; i > 0; i--) { const j = this.random(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
      let k = 0; for (const p of prizes) for (let c = 0; c < p.count; c++) layout[cells[k++]] = p.id;
      state.board = { id: newId('b'), createdAt: this.now(), prizes, layout, opened: [] };
      this.bump(state);
    });
    return this.adminView();
  }
  /** The streamer opens a number for a saved chance (the viewer said it again in chat). */
  async openPending(input) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'number,pendingId' || typeof input.pendingId !== 'string' || !int(input.number, [1, BOARD_SIZE])) throw fail('열 번호(1~100)와 보류 기회를 확인해 주세요.');
    this.guard();
    await this.store.update(state => {
      const pending = state.pending.find(p => p.id === input.pendingId);
      if (!pending) throw fail('보류 기회를 찾지 못했어요. 새로고침해 주세요.', 404);
      if (!state.board) throw fail('먼저 새 뽑기판을 만들어 주세요.', 409);
      if (!this.openNumber(state, input.number, pending.nickname)) throw fail(`${input.number}번은 이미 열렸어요. 다른 번호를 골라 주세요.`, 409);
      pending.count--; if (!pending.count) state.pending = state.pending.filter(p => p !== pending);
      this.bump(state);
    });
    return this.adminView();
  }
  async removePending(input) {
    if (!plain(input) || Object.keys(input).join() !== 'pendingId' || typeof input.pendingId !== 'string') throw fail('지울 보류 기회를 확인해 주세요.');
    this.guard();
    await this.store.update(state => { const before = state.pending.length; state.pending = state.pending.filter(p => p.id !== input.pendingId); if (state.pending.length !== before) this.bump(state); });
    return this.adminView();
  }
  /**
   * Test donation for checking OBS: a practice result drawn from the prize counts, shown on OBS as [테스트].
   * It never opens or reveals the real board and is kept in memory only.
   */
  testDonation(input) {
    if (!plain(input) || Object.keys(input).some(key => !['nickname', 'number'].includes(key)) || !int(input.number, [1, BOARD_SIZE]) || (input.nickname !== undefined && typeof input.nickname !== 'string')) throw fail('테스트할 번호(1~100)를 확인해 주세요.');
    const now = this.now();
    if (now - this.lastTestAt < 3000) throw fail('테스트 후원은 3초에 한 번만 보낼 수 있어요.', 429);
    this.guard();
    const { settings, board } = this.store.read();
    if (!board) throw fail('먼저 뽑기판을 만들어 주세요. 테스트는 지금 뽑기판 위에 잠깐 표시돼요.', 409);
    this.lastTestAt = now;
    const roll = this.random(BOARD_SIZE);
    let edge = 0, result = { rank: '꽝', name: '', place: 0 };
    settings.prizes.forEach((p, index) => { if (result.place === 0 && roll >= edge && roll < edge + p.count) result = { rank: p.rank, name: p.name, place: index + 1 }; edge += p.count; });
    const event = { id: newId('t'), test: true, at: now, n: input.number, nickname: clean(input.nickname, 20) || '테스트', ...result };
    this.tests.unshift(event); this.tests.length = Math.min(this.tests.length, 20);
    return event;
  }
  /** Board as the streamer and OBS see it: opened numbers and what is left, never the hidden layout. */
  publicBoard() {
    const board = this.store.read().board;
    if (!board) return null;
    const opened = board.opened.map(o => ({ n: o.n, at: o.at, nickname: o.nickname, ...label(board, o.n) }));
    const openedIds = board.opened.map(o => board.layout[o.n - 1]);
    const prizes = board.prizes.map((p, index) => ({ rank: p.rank, name: p.name, place: index + 1, count: p.count, left: p.count - openedIds.filter(id => id === p.id).length }));
    const missCount = board.layout.filter(id => id === '').length;
    return { id: board.id, createdAt: board.createdAt, size: BOARD_SIZE, opened, prizes, miss: { count: missCount, left: missCount - openedIds.filter(id => id === '').length } };
  }
  adminView() {
    const state = this.store.read();
    return { settings: structuredClone(state.settings), revision: state.revision, status: this.status(), board: this.publicBoard(),
      pending: state.pending.map(p => ({ ...p })), log: state.log.slice(0, 30).map(l => ({ ...l })) };
  }
  /** Creator only: the full layout. Callers must not record this read anywhere. */
  layout() {
    const board = this.store.read().board;
    if (!board) return { board: null };
    const open = new Set(board.opened.map(o => o.n));
    return { board: { id: board.id, createdAt: board.createdAt, tiles: board.layout.map((_, i) => ({ n: i + 1, ...label(board, i + 1), opened: open.has(i + 1) })) } };
  }
  async close() { this.unsubscribe(); if (this.session) { this.session.stop(); this.session = null; } }
}
