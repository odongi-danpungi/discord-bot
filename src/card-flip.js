import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonStore } from './json-store.js';
import { atomicWriteFile, removeDurable } from './durable-file.js';
import { ChzzkEventSession, normalizeDonationDonor } from './chzzk-session.js';

// Viewer reward "카드 뒤집기": a viewer spends one chance, flips cards one by one and wins the
// prize of the first card that reaches the streamer's target count (2 or 3). There is no losing
// card. The deck lives on the server; viewers only ever see cards they have opened.
//
// Settings, chances and rewards live in a separate file `operations.json.card-flip.json`.
// Card pictures are files in `card-flip-images/` next to it. Chances come from joining a game
// (queue status `joined`), cheese donations from a viewer whose CHZZK account is already linked
// through follower verification, or a direct grant by the streamer. The donor's CHZZK channel id
// is matched in memory and never written down.

export const CARD_FLIP_NEEDS = [2, 3], CARD_FLIP_CARD_RANGE = [2, 8], CARD_FLIP_REWARD_MAX = 20;
export const CARD_FLIP_IMAGE_MAX_BYTES = 1024 * 1024;
export const CARD_FLIP_IMAGE_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
export const CARD_FLIP_LIMITS = Object.freeze({ joinCount: [1, 5], cheeseAmount: [100, 1000000], cheeseCount: [1, 5], dailyMax: [1, 20], grant: [1, 10], held: 99 });
const PLAYER_LIMIT = 2000, REWARD_LIMIT = 30, GRANT_LOG_LIMIT = 50, AWARDED_LIMIT = 1000;

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const int = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;
// Discord user ids; `demo-N` is the practice-mode participant id (never a real Discord id).
const snowflake = value => typeof value === 'string' && /^(?:\d{17,20}|demo-\d{1,3})$/.test(value);
const cardId = value => typeof value === 'string' && /^c[a-f0-9]{8}$/.test(value);
const imageName = value => typeof value === 'string' && /^c[a-f0-9]{8}-[a-f0-9]{16}\.(png|jpg|webp)$/.test(value);
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, limit);
const newId = prefix => prefix + randomBytes(4).toString('hex');
const keyHash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
/** Day key in Korea time, used for the daily chance limit. */
export const cardFlipDay = now => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

const DEFAULT_REWARDS = ['다음판 우선 호출 1회', '신청곡 1곡', '애칭 불러 주기', '칭호 「행운아」 1주', '스트리머 응원 한마디', '오늘 시참 우선권'];
const defaultSettings = () => ({
  enabled: false, need: 2,
  cards: DEFAULT_REWARDS.map(reward => ({ id: newId('c'), reward, image: null })),
  chances: { join: { enabled: true, count: 1 }, cheese: { enabled: false, amount: 1000, count: 1 }, dailyMax: 3 }
});

function validCard(card) {
  return plain(card) && cardId(card.id) && typeof card.reward === 'string' && card.reward.length >= 1 && card.reward.length <= CARD_FLIP_REWARD_MAX &&
    (card.image === null || (plain(card.image) && imageName(card.image.file) && Object.hasOwn(CARD_FLIP_IMAGE_TYPES, card.image.type) && card.image.file.startsWith(card.id + '-')));
}
function validChances(c) {
  return plain(c) && plain(c.join) && typeof c.join.enabled === 'boolean' && int(c.join.count, CARD_FLIP_LIMITS.joinCount) &&
    plain(c.cheese) && typeof c.cheese.enabled === 'boolean' && int(c.cheese.amount, CARD_FLIP_LIMITS.cheeseAmount) && int(c.cheese.count, CARD_FLIP_LIMITS.cheeseCount) &&
    int(c.dailyMax, CARD_FLIP_LIMITS.dailyMax);
}
function validSettings(s) {
  return plain(s) && typeof s.enabled === 'boolean' && CARD_FLIP_NEEDS.includes(s.need) && Array.isArray(s.cards) &&
    s.cards.length >= CARD_FLIP_CARD_RANGE[0] && s.cards.length <= CARD_FLIP_CARD_RANGE[1] && s.cards.every(validCard) &&
    new Set(s.cards.map(card => card.id)).size === s.cards.length && validChances(s.chances);
}
function validGame(game) {
  return game === null || (plain(game) && typeof game.id === 'string' && /^g[a-f0-9]{8}$/.test(game.id) && Array.isArray(game.deck) && game.deck.length <= 24 && game.deck.every(cardId) &&
    Array.isArray(game.open) && game.open.every(i => Number.isInteger(i) && i >= 0 && i < game.deck.length) && new Set(game.open).size === game.open.length &&
    typeof game.done === 'boolean' && (game.win === null || cardId(game.win)) && CARD_FLIP_NEEDS.includes(game.need) && Number.isFinite(game.startedAt));
}
function validPlayer(p) {
  return plain(p) && int(p.chances, [0, CARD_FLIP_LIMITS.held]) && typeof p.day === 'string' && p.day.length <= 10 && Number.isInteger(p.earned) && p.earned >= 0 &&
    validGame(p.game) && Array.isArray(p.rewards) && p.rewards.length <= REWARD_LIMIT && p.rewards.every(r => plain(r) && /^r[a-f0-9]{8}$/.test(r.id) &&
    typeof r.reward === 'string' && r.reward.length <= CARD_FLIP_REWARD_MAX && ['ready', 'requested', 'done'].includes(r.status) && Number.isFinite(r.at));
}
function validState(state) {
  return plain(state) && state.version === 1 && revision(state.revision) && validSettings(state.settings) && plain(state.players) &&
    Object.keys(state.players).length <= PLAYER_LIMIT && Object.entries(state.players).every(([id, p]) => snowflake(id) && validPlayer(p)) &&
    Array.isArray(state.grants) && state.grants.length <= GRANT_LOG_LIMIT && state.grants.every(g => plain(g) && snowflake(g.userId) && Number.isInteger(g.count) && ['join', 'cheese', 'direct', 'test'].includes(g.source) && Number.isFinite(g.at)) &&
    Array.isArray(state.awarded) && state.awarded.length <= AWARDED_LIMIT && state.awarded.every(k => typeof k === 'string' && /^[a-f0-9]{24}$/.test(k));
}

/** Validates operator settings: {enabled, need, cards:[{id?, reward}], chances, revision}. Existing card ids keep their pictures. */
export function validateCardFlipInput(input, current) {
  if (!plain(input) || Object.keys(input).sort().join() !== 'cards,chances,enabled,need,revision' || !revision(input.revision)) throw fail('카드 뒤집기 설정과 최신 버전을 확인해 주세요.');
  if (typeof input.enabled !== 'boolean' || !CARD_FLIP_NEEDS.includes(input.need)) throw fail('같은 카드는 2장 또는 3장으로 정해 주세요.');
  if (!Array.isArray(input.cards) || input.cards.length < CARD_FLIP_CARD_RANGE[0] || input.cards.length > CARD_FLIP_CARD_RANGE[1]) throw fail(`카드는 ${CARD_FLIP_CARD_RANGE[0]}~${CARD_FLIP_CARD_RANGE[1]}종으로 정해 주세요.`);
  const known = new Map(current.cards.map(card => [card.id, card])), seen = new Set();
  const cards = input.cards.map(card => {
    if (!plain(card) || Object.keys(card).some(key => !['id', 'reward'].includes(key))) throw fail('카드 정보를 확인해 주세요.');
    const reward = clean(card.reward, CARD_FLIP_REWARD_MAX + 1);
    if (!reward || reward.length > CARD_FLIP_REWARD_MAX) throw fail(`상품 이름은 1~${CARD_FLIP_REWARD_MAX}자로 입력해 주세요.`);
    if (card.id !== undefined && (!known.has(card.id) || seen.has(card.id))) throw fail('카드 목록이 바뀌었습니다. 새로고침한 뒤 다시 저장하세요.', 409);
    const id = card.id ?? newId('c'); seen.add(id);
    return { id, reward, image: known.get(id)?.image ?? null };
  });
  const c = input.chances;
  if (!plain(c) || !plain(c.join) || !plain(c.cheese) || Object.keys(c).sort().join() !== 'cheese,dailyMax,join' ||
    Object.keys(c.join).sort().join() !== 'count,enabled' || Object.keys(c.cheese).sort().join() !== 'amount,count,enabled') throw fail('기회 주는 방법을 확인해 주세요.');
  const chances = { join: { enabled: c.join.enabled, count: c.join.count }, cheese: { enabled: c.cheese.enabled, amount: c.cheese.amount, count: c.cheese.count }, dailyMax: c.dailyMax };
  if (!validChances(chances)) throw fail(`기회 설정을 확인해 주세요. 시참·후원 1회당 1~5회, 치즈는 ${CARD_FLIP_LIMITS.cheeseAmount[0]}~${CARD_FLIP_LIMITS.cheeseAmount[1].toLocaleString('ko-KR')}, 하루 최대 1~20회입니다.`);
  return { settings: { enabled: input.enabled, need: input.need, cards, chances }, revision: input.revision };
}

/** Accepts only real PNG/JPEG/WEBP bytes of the declared type, up to 1 MB. */
export function decodeCardImage(type, data) {
  if (!Object.hasOwn(CARD_FLIP_IMAGE_TYPES, type) || typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4) throw fail('PNG·JPG·WEBP 그림만 올릴 수 있어요.');
  if (data.length > Math.ceil(CARD_FLIP_IMAGE_MAX_BYTES / 3) * 4) throw fail('그림은 1MB까지 올릴 수 있어요.', 413);
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > CARD_FLIP_IMAGE_MAX_BYTES) throw fail('그림은 1MB까지 올릴 수 있어요.', 413);
  const png = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
  if (!({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[type]) throw fail('그림 파일 형식이 올바르지 않아요. PNG·JPG·WEBP 파일을 올려 주세요.');
  return bytes;
}

export class CardFlipStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.card-flip.json', { version: 1, revision: 0, settings: defaultSettings(), players: {}, grants: [], awarded: [] }, validState, { maxBytes: 4 * 1024 * 1024 });
    this.imagesDir = path.join(path.dirname(operationsFile), 'card-flip-images');
  }
  snapshot() { const state = this.read(); return { settings: structuredClone(state.settings), revision: state.revision }; }
}

const blankPlayer = () => ({ chances: 0, day: '', earned: 0, game: null, rewards: [] });

export class CardFlipService {
  constructor({ store, chzzkVerification = null, participationQueue = null, guard = () => {}, now = Date.now, random = randomInt,
    sessionFactory = options => new ChzzkEventSession({ accessToken: options.accessToken, onStatus: options.onStatus, handlers: { DONATION: payload => options.onDonation(payload) } }), reporter = () => {} }) {
    Object.assign(this, { store, chzzkVerification, participationQueue, guard, now, random, sessionFactory, reporter });
    this.session = null; this.sessionChannel = ''; this.ignored = { otherChannel: 0, unlinked: 0 }; this.joinBusy = false;
    const off = [store.subscribe(() => this.sync()), chzzkVerification?.store?.subscribe?.(() => this.sync()) || (() => {}), participationQueue?.subscribe?.(() => void this.awardJoins().catch(() => {})) || (() => {})];
    this.unsubscribe = () => off.forEach(fn => fn());
  }
  connected() { try { return Boolean(this.chzzkVerification?.summary?.().ownerConnected && this.chzzkVerification.targetChannelId()); } catch { return false; } }
  /** Listens for donations only while card flip and cheese chances are on and a broadcaster account is connected. */
  sync() {
    const { settings } = this.store.snapshot(), wanted = settings.enabled && settings.chances.cheese.enabled && this.connected();
    let channel = ''; try { channel = wanted ? this.chzzkVerification.targetChannelId() : ''; } catch {}
    if (this.session && (!wanted || channel !== this.sessionChannel)) { this.session.stop(); this.session = null; }
    if (wanted && !this.session) {
      this.sessionChannel = channel;
      this.session = this.sessionFactory({ accessToken: () => this.chzzkVerification.ownerToken(), onDonation: payload => this.receiveDonation(payload),
        onStatus: status => { if (status?.status === 'auth_required') this.reporter({ severity: 'warn', code: 'chzzk_card_flip_session', summary: 'CHZZK 후원 세션 권한 확인 필요(카드 뒤집기)', detail: status.detail }); } });
      this.session.start();
    }
  }
  status() {
    const { settings } = this.store.snapshot(), session = this.session?.status() || null;
    const cheese = !settings.chances.cheese.enabled ? 'disabled' : !this.chzzkVerification ? 'unavailable' : !this.connected() ? 'not_connected' : !settings.enabled ? 'disabled' : session?.status || 'stopped';
    // Real donation delivery is not proven by a subscription acknowledgement.
    return { cheese, detail: session?.detail || '', ignored: { ...this.ignored }, verification: 'pending' };
  }
  player(state, userId) {
    let p = state.players[userId];
    if (!p) {
      if (Object.keys(state.players).length >= PLAYER_LIMIT) throw fail('카드 뒤집기 참가자가 너무 많습니다. 제작자에게 점검을 요청하세요.', 503);
      p = state.players[userId] = blankPlayer();
    }
    const day = cardFlipDay(this.now());
    if (p.day !== day) { p.day = day; p.earned = 0; }
    return p;
  }
  bump(state) { if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('작업을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409); state.revision++; }
  /** Adds chances. Join and cheese chances respect the daily limit; the streamer's direct grant does not. */
  async credit(userId, count, source, { key = '', amount = 0 } = {}) {
    if (!snowflake(userId) || !Number.isInteger(count) || count <= 0) return 0;
    let added = 0;
    await this.store.update(state => {
      if (!state.settings.enabled && source !== 'direct') return;
      if (source === 'test' && !state.settings.chances.cheese.enabled) return;
      if (key && state.awarded.includes(key)) return;
      const p = this.player(state, userId), room = CARD_FLIP_LIMITS.held - p.chances;
      added = Math.min(count, room, source === 'direct' ? count : Math.max(0, state.settings.chances.dailyMax - p.earned));
      if (key) { state.awarded.push(key); if (state.awarded.length > AWARDED_LIMIT) state.awarded.splice(0, state.awarded.length - AWARDED_LIMIT); }
      if (added <= 0) { added = 0; if (key) this.bump(state); return; }
      p.chances += added; if (source !== 'direct') p.earned += added;
      state.grants.unshift({ at: this.now(), userId, count: added, source, ...(['cheese', 'test'].includes(source) ? { amount } : {}) });
      state.grants.length = Math.min(state.grants.length, GRANT_LOG_LIMIT);
      this.bump(state);
    });
    return added;
  }
  /** Cheese donation from a viewer whose CHZZK account is linked through follower verification. */
  async receiveDonation(payload) {
    const donation = normalizeDonationDonor(payload);
    if (!donation) return false;
    let target = ''; try { target = this.chzzkVerification.targetChannelId(); } catch {}
    if (!target || donation.channelId !== target) { this.ignored.otherChannel++; return false; }
    const { settings } = this.store.snapshot();
    if (!settings.enabled || !settings.chances.cheese.enabled) return false;
    const linked = (this.chzzkVerification.store.read().users || []).find(user => String(user.channelId).toLowerCase() === donation.donorChannelId);
    if (!linked) { this.ignored.unlinked++; return false; }
    const count = Math.floor(donation.amount / settings.chances.cheese.amount) * settings.chances.cheese.count;
    if (count <= 0) return false;
    await this.credit(linked.userId, count, 'cheese', { amount: donation.amount });
    return true;
  }
  /** One join chance per Discord participant per game round, recorded so restarts never repeat it. */
  async awardJoins() {
    if (this.joinBusy || !this.participationQueue) return; this.joinBusy = true;
    try {
      const { settings } = this.store.snapshot();
      if (!settings.enabled || !settings.chances.join.enabled) return;
      for (const entry of this.participationQueue.read().entries || []) {
        if (entry.status !== 'joined' || !snowflake(entry.discordUserId)) continue;
        const key = keyHash(`join:${entry.sessionId}:${entry.round}:${entry.discordUserId}`);
        if (this.store.read().awarded.includes(key)) continue;
        await this.credit(entry.discordUserId, settings.chances.join.count, 'join', { key });
      }
    } finally { this.joinBusy = false; }
  }
  view(userId) {
    const state = this.store.read(), s = state.settings, p = state.players[userId] || blankPlayer(), today = p.day === cardFlipDay(this.now());
    const game = p.game ? { id: p.game.id, total: p.game.deck.length, need: p.game.need, done: p.game.done, win: p.game.win,
      open: p.game.open.map(index => ({ index, card: p.game.deck[index] })) } : null;
    return {
      enabled: s.enabled, need: s.need, revision: state.revision,
      cards: s.cards.map(card => ({ id: card.id, reward: card.reward, image: card.image?.file || null })),
      chances: p.chances, earnedToday: today ? p.earned : 0, dailyMax: s.chances.dailyMax,
      ways: { join: s.chances.join.enabled ? s.chances.join.count : 0, cheese: s.chances.cheese.enabled ? { amount: s.chances.cheese.amount, count: s.chances.cheese.count } : null, direct: true },
      game, rewards: p.rewards.map(r => ({ id: r.id, reward: r.reward, status: r.status, at: r.at }))
    };
  }
  async newGame(userId) {
    if (!snowflake(userId)) throw fail('로그인을 다시 확인해 주세요.', 401);
    this.guard();
    await this.store.update(state => {
      const s = state.settings;
      if (!s.enabled) throw fail('지금은 카드 뒤집기를 쉬고 있어요.', 409);
      const p = this.player(state, userId);
      if (p.game && !p.game.done) throw fail('지금 판을 먼저 끝내 주세요.', 409);
      if (p.chances <= 0) throw fail('남은 기회가 없어요.', 409);
      const deck = s.cards.flatMap(card => Array(s.need).fill(card.id));
      for (let i = deck.length - 1; i > 0; i--) { const j = this.random(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      p.chances--; p.game = { id: newId('g'), deck, open: [], done: false, win: null, need: s.need, startedAt: this.now() };
      this.bump(state);
    });
    return this.view(userId);
  }
  async flip(userId, input) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'gameId,index' || typeof input.gameId !== 'string' || !Number.isInteger(input.index)) throw fail('뒤집을 카드를 확인해 주세요.');
    this.guard();
    await this.store.update(state => {
      const p = state.players[userId], game = p?.game;
      if (!game || game.id !== input.gameId) throw fail('이 판은 끝났거나 바뀌었어요. 새로고침해 주세요.', 409);
      if (input.index < 0 || input.index >= game.deck.length) throw fail('뒤집을 카드를 확인해 주세요.');
      if (game.done || game.open.includes(input.index)) return;
      game.open.push(input.index);
      const card = game.deck[input.index];
      if (game.open.filter(i => game.deck[i] === card).length >= game.need) {
        const prize = state.settings.cards.find(item => item.id === card);
        game.done = true; game.win = card;
        p.rewards.unshift({ id: newId('r'), cardId: card, reward: prize?.reward || '상품', status: 'ready', at: this.now() });
        p.rewards.length = Math.min(p.rewards.length, REWARD_LIMIT);
      }
      this.bump(state);
    });
    return this.view(userId);
  }
  /** Viewer asks the streamer to use a reward during the broadcast. */
  async requestUse(userId, input) {
    if (!plain(input) || Object.keys(input).join() !== 'rewardId' || typeof input.rewardId !== 'string') throw fail('사용할 보상을 확인해 주세요.');
    this.guard();
    await this.store.update(state => {
      const reward = state.players[userId]?.rewards.find(r => r.id === input.rewardId);
      if (!reward) throw fail('보상을 찾지 못했어요. 새로고침해 주세요.', 404);
      if (reward.status !== 'ready') return;
      reward.status = 'requested'; this.bump(state);
    });
    return this.view(userId);
  }
  // ----- streamer -----
  async configure(input) {
    this.guard();
    let removed = [], result;
    await this.store.update(state => {
      const value = validateCardFlipInput(input, state.settings);
      if (state.revision !== value.revision) throw fail('다른 곳에서 카드 뒤집기 설정이 바뀌었습니다. 새로고침한 뒤 다시 저장하세요.', 409);
      const before = state.settings, deckChanged = before.need !== value.settings.need || before.cards.map(c => c.id).join() !== value.settings.cards.map(c => c.id).join();
      const kept = new Set(value.settings.cards.map(card => card.id));
      removed = before.cards.filter(card => !kept.has(card.id) && card.image).map(card => card.image.file);
      // A changed deck cannot finish fairly: cancel unfinished games and give the chance back.
      if (deckChanged) for (const p of Object.values(state.players)) if (p.game && !p.game.done) { p.game = null; p.chances = Math.min(CARD_FLIP_LIMITS.held, p.chances + 1); }
      state.settings = value.settings; this.bump(state);
      result = { settings: structuredClone(state.settings), revision: state.revision };
    });
    await Promise.all(removed.map(file => removeDurable(path.join(this.store.imagesDir, file)).catch(() => {})));
    return result;
  }
  async saveImage(input) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'cardId,data,revision,type' || !cardId(input.cardId) || !revision(input.revision)) throw fail('그림을 올릴 카드를 확인해 주세요.');
    this.guard();
    const bytes = decodeCardImage(input.type, input.data);
    if (!this.store.read().settings.cards.some(card => card.id === input.cardId)) throw fail('카드 목록이 바뀌었습니다. 새로고침해 주세요.', 409);
    const file = `${input.cardId}-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${CARD_FLIP_IMAGE_TYPES[input.type]}`;
    await mkdir(this.store.imagesDir, { recursive: true, mode: 0o700 });
    await atomicWriteFile(path.join(this.store.imagesDir, file), bytes);
    let previous = null, result;
    try {
      await this.store.update(state => {
        this.guard();
        if (state.revision !== input.revision) throw fail('다른 곳에서 카드 뒤집기 설정이 바뀌었습니다. 새로고침한 뒤 다시 올려 주세요.', 409);
        const card = state.settings.cards.find(item => item.id === input.cardId);
        if (!card) throw fail('카드 목록이 바뀌었습니다. 새로고침해 주세요.', 409);
        previous = card.image?.file !== file ? card.image?.file || null : null;
        card.image = { file, type: input.type }; this.bump(state);
        result = { settings: structuredClone(state.settings), revision: state.revision };
      });
    } catch (error) { if (!this.referenced(file)) await removeDurable(path.join(this.store.imagesDir, file)).catch(() => {}); throw error; }
    if (previous && !this.referenced(previous)) await removeDurable(path.join(this.store.imagesDir, previous)).catch(() => {});
    return result;
  }
  async removeImage(input) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'cardId,revision' || !cardId(input.cardId) || !revision(input.revision)) throw fail('그림을 지울 카드를 확인해 주세요.');
    this.guard();
    let previous = null, result;
    await this.store.update(state => {
      if (state.revision !== input.revision) throw fail('다른 곳에서 카드 뒤집기 설정이 바뀌었습니다. 새로고침해 주세요.', 409);
      const card = state.settings.cards.find(item => item.id === input.cardId);
      if (!card) throw fail('카드 목록이 바뀌었습니다. 새로고침해 주세요.', 409);
      previous = card.image?.file || null; card.image = null; this.bump(state);
      result = { settings: structuredClone(state.settings), revision: state.revision };
    });
    if (previous && !this.referenced(previous)) await removeDurable(path.join(this.store.imagesDir, previous)).catch(() => {});
    return result;
  }
  referenced(file) { return this.store.read().settings.cards.some(card => card.image?.file === file); }
  /** Picture bytes for a card that is still in the deck. */
  async image(name) {
    if (!imageName(name)) throw fail('그림을 찾지 못했어요.', 404);
    const card = this.store.read().settings.cards.find(item => item.image?.file === name);
    if (!card) throw fail('그림을 찾지 못했어요.', 404);
    try { return { type: card.image.type, bytes: await readFile(path.join(this.store.imagesDir, name)) }; } catch { throw fail('그림을 찾지 못했어요.', 404); }
  }
  async grant(input, knownUser) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'count,userId' || !snowflake(input.userId) || !int(input.count, CARD_FLIP_LIMITS.grant)) throw fail('기회를 줄 시청자와 횟수(1~10회)를 확인해 주세요.');
    if (!knownUser(input.userId)) throw fail('이 서버에 등록된 시청자에게만 기회를 줄 수 있어요.', 404);
    this.guard();
    const added = await this.credit(input.userId, input.count, 'direct');
    if (!added) throw fail('이 시청자는 기회를 더 받을 수 없어요. (최대 99회 보유)', 409);
    return { added };
  }
  /** Test cheese donation: credits a registered viewer as a real donation would (daily limit included), labelled 테스트 in the log. */
  async testDonation(input, knownUser) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'amount,userId' || !snowflake(input.userId) || !int(input.amount, [1, 10000000])) throw fail('테스트할 시청자와 치즈 금액을 확인해 주세요.');
    if (!knownUser(input.userId)) throw fail('이 서버에 등록된 시청자만 고를 수 있어요.', 404);
    const { settings } = this.store.snapshot();
    if (!settings.enabled) throw fail('카드 뒤집기를 켠 뒤 테스트해 주세요.', 409);
    if (!settings.chances.cheese.enabled) throw fail('치즈 후원 기회를 켠 뒤 테스트해 주세요.', 409);
    const now = this.now(); if (now - (this.lastTestAt || 0) < 1000) throw fail('테스트 후원은 1초에 한 번만 보낼 수 있어요.', 429);
    this.guard(); this.lastTestAt = now;
    const count = Math.floor(input.amount / settings.chances.cheese.amount) * settings.chances.cheese.count;
    return { count, added: count > 0 ? await this.credit(input.userId, count, 'test', { amount: input.amount }) : 0 };
  }
  async resolveReward(input) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'rewardId,userId' || !snowflake(input.userId) || typeof input.rewardId !== 'string') throw fail('처리할 보상을 확인해 주세요.');
    this.guard();
    await this.store.update(state => {
      const reward = state.players[input.userId]?.rewards.find(r => r.id === input.rewardId);
      if (!reward) throw fail('보상을 찾지 못했어요. 새로고침해 주세요.', 404);
      if (reward.status === 'done') return;
      reward.status = 'done'; this.bump(state);
    });
    return { ok: true };
  }
  /** Streamer view. Names come from the server's existing participant profiles at read time. */
  adminView(profiles) {
    const state = this.store.read(), names = new Map(profiles.map(p => [p.userId, p.name])), day = cardFlipDay(this.now());
    const players = Object.entries(state.players).map(([userId, p]) => ({ userId, name: names.get(userId) || '알 수 없는 시청자', chances: p.chances, earnedToday: p.day === day ? p.earned : 0,
      rewards: p.rewards.filter(r => r.status !== 'done').map(r => ({ id: r.id, reward: r.reward, status: r.status, at: r.at })) }));
    return {
      settings: structuredClone(state.settings), revision: state.revision, status: this.status(),
      viewers: profiles.slice(0, 500),
      requests: players.flatMap(p => p.rewards.map(r => ({ ...r, userId: p.userId, name: p.name }))).sort((a, b) => (a.status === 'requested' ? 0 : 1) - (b.status === 'requested' ? 0 : 1) || b.at - a.at).slice(0, 100),
      players: players.filter(p => p.chances > 0).sort((a, b) => b.chances - a.chances).slice(0, 100),
      grants: state.grants.map(g => ({ at: g.at, name: names.get(g.userId) || '알 수 없는 시청자', count: g.count, source: g.source, ...(g.amount ? { amount: g.amount } : {}) }))
    };
  }
  async close() { this.unsubscribe(); if (this.session) { this.session.stop(); this.session = null; } }
}
