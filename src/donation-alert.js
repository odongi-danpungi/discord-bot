import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonStore } from './json-store.js';
import { atomicWriteFile, removeDurable } from './durable-file.js';
import { ChzzkEventSession, normalizeDonationText } from './chzzk-session.js';

// OBS 후원 알림: a cheese donation pops up on the OBS browser source.
// Saved (`operations.json.donation-alert.json`): display settings and amount tiers. Each tier can carry
// one picture and one sound uploaded by the streamer (files in `donation-alert-media/` next to it).
// Alerts (nickname, amount, the donation message) stay in memory only (latest ALERT_BUFFER_LIMIT);
// the donor channel id never reaches this module and the message is never written to disk.

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const CONTROL = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;
const clean = (value, limit) => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const int = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;

export const ALERT_BUFFER_LIMIT = 30, ALERT_TEST_INTERVAL_MS = 1000, ALERT_TEMPLATE_MAX = 60, ALERT_MESSAGE_MAX = 100, ALERT_TIERS_MAX = 5;
export const ALERT_MIN_AMOUNT = [1, 1000000], ALERT_DURATION = [3, 20], ALERT_MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export const ALERT_DEFAULT_TEMPLATE = '{닉네임}님 {금액}치즈 후원 감사합니다!';
export const ALERT_MEDIA_TYPES = Object.freeze({
  image: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' },
  audio: { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }
});
const FIRST_TIER = 't00000001';
const tierId = value => typeof value === 'string' && /^t[a-f0-9]{8}$/.test(value);
const MEDIA_NAME = /^(t[a-f0-9]{8})-(image|audio)-[a-f0-9]{16}\.(png|jpg|webp|gif|mp3|ogg|wav)$/;
export const alertMediaName = name => typeof name === 'string' && MEDIA_NAME.test(name);
const BASE_KEYS = ['enabled', 'durationSeconds', 'sound', 'showMessage'];
const DEFAULTS = () => ({ enabled: false, durationSeconds: 6, sound: true, showMessage: true, tiers: [{ id: FIRST_TIER, minAmount: 1000, template: ALERT_DEFAULT_TEMPLATE, image: null, audio: null }] });
const validTemplate = t => typeof t === 'string' && t.length >= 1 && t.length <= ALERT_TEMPLATE_MAX && t === clean(t, ALERT_TEMPLATE_MAX);
const validMedia = (media, kind, id) => media === null || (plain(media) && Object.keys(media).sort().join() === 'file,type' && Object.hasOwn(ALERT_MEDIA_TYPES[kind], media.type) &&
  alertMediaName(media.file) && media.file.startsWith(`${id}-${kind}-`) && media.file.endsWith('.' + ALERT_MEDIA_TYPES[kind][media.type]));
function validTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > ALERT_TIERS_MAX) return false;
  for (const [i, t] of tiers.entries()) {
    if (!plain(t) || Object.keys(t).sort().join() !== 'audio,id,image,minAmount,template' || !tierId(t.id) || !int(t.minAmount, ALERT_MIN_AMOUNT) || !validTemplate(t.template) ||
      !validMedia(t.image, 'image', t.id) || !validMedia(t.audio, 'audio', t.id)) return false;
    if (i > 0 && tiers[i - 1].minAmount >= t.minAmount) return false;
  }
  return new Set(tiers.map(t => t.id)).size === tiers.length;
}
const validBase = s => typeof s.enabled === 'boolean' && typeof s.sound === 'boolean' && typeof s.showMessage === 'boolean' && int(s.durationSeconds, ALERT_DURATION);
const validV2 = s => plain(s) && Object.keys(s).sort().join() === [...BASE_KEYS, 'tiers'].sort().join() && validBase(s) && validTiers(s.tiers);
// Version 1 (one template and one minimum amount) is still read and becomes a single tier.
const validV1 = s => plain(s) && Object.keys(s).sort().join() === [...BASE_KEYS, 'minAmount', 'template'].sort().join() && validBase(s) && int(s.minAmount, ALERT_MIN_AMOUNT) && validTemplate(s.template);
const upgrade = state => state.version === 2 ? structuredClone(state.settings) : (({ minAmount, template, ...base }) => ({ ...base, tiers: [{ id: FIRST_TIER, minAmount, template, image: null, audio: null }] }))(state.settings);

/** Validates operator input: {enabled, durationSeconds, sound, showMessage, tiers:[{id?, minAmount, template}], revision}. Media stay as they are. */
export function validateDonationAlertInput(input, current = null) {
  if (!plain(input) || Object.keys(input).sort().join() !== [...BASE_KEYS, 'revision', 'tiers'].sort().join() || !revision(input.revision)) throw fail('후원 알림 설정과 최신 버전을 확인해 주세요.');
  if (!validBase(input)) throw fail(`후원 알림 설정을 확인해 주세요. 표시 시간은 ${ALERT_DURATION[0]}~${ALERT_DURATION[1]}초예요.`);
  if (!Array.isArray(input.tiers) || input.tiers.length < 1 || input.tiers.length > ALERT_TIERS_MAX) throw fail(`금액 구간은 1~${ALERT_TIERS_MAX}개예요.`);
  const known = new Map((current?.tiers || []).map(t => [t.id, t]));
  const tiers = input.tiers.map((t, index) => {
    if (!plain(t) || Object.keys(t).some(key => !['id', 'minAmount', 'template'].includes(key))) throw fail(`${index + 1}번째 금액 구간을 확인해 주세요.`);
    if (!int(t.minAmount, ALERT_MIN_AMOUNT)) throw fail(`${index + 1}번째 구간의 최소 금액은 ${ALERT_MIN_AMOUNT[0]}~${ALERT_MIN_AMOUNT[1].toLocaleString('ko-KR')}치즈예요.`);
    const template = typeof t.template === 'string' ? clean(t.template, ALERT_TEMPLATE_MAX + 1) : '';
    if (!template) throw fail(`${index + 1}번째 구간의 알림 문구를 입력해 주세요.`);
    if (template.length > ALERT_TEMPLATE_MAX) throw fail(`알림 문구는 ${ALERT_TEMPLATE_MAX}자까지 쓸 수 있어요.`);
    if (t.id !== undefined && !known.has(t.id)) throw fail('금액 구간 목록이 바뀌었어요. 새로고침해 주세요.', 409);
    const id = t.id ?? 't' + randomBytes(4).toString('hex'), old = known.get(id);
    return { id, minAmount: t.minAmount, template, image: old?.image || null, audio: old?.audio || null };
  }).sort((a, b) => a.minAmount - b.minAmount);
  for (let i = 1; i < tiers.length; i++) if (tiers[i].minAmount === tiers[i - 1].minAmount) throw fail('같은 최소 금액의 구간이 두 개 있어요.');
  const settings = { enabled: input.enabled, durationSeconds: input.durationSeconds, sound: input.sound, showMessage: input.showMessage, tiers };
  if (!validV2(settings)) throw fail('후원 알림 설정을 확인해 주세요.');
  return { settings, revision: input.revision };
}

/** Checks an uploaded picture or sound by its first bytes. Returns the bytes. */
export function decodeAlertMedia(kind, type, data) {
  const types = ALERT_MEDIA_TYPES[kind];
  const label = kind === 'image' ? 'PNG·JPG·WEBP·GIF 그림' : 'MP3·OGG·WAV 소리';
  if (!types || !Object.hasOwn(types, type) || typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4) throw fail(`${label}만 올릴 수 있어요.`);
  if (data.length > Math.ceil(ALERT_MEDIA_MAX_BYTES / 3) * 4) throw fail('파일은 2MB까지 올릴 수 있어요.', 413);
  const b = Buffer.from(data, 'base64');
  if (!b.length || b.length > ALERT_MEDIA_MAX_BYTES) throw fail('파일은 2MB까지 올릴 수 있어요.', 413);
  const ascii = (from, to) => b.toString('latin1', from, to);
  const ok = {
    'image/png': b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/jpeg': b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/webp': b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    'image/gif': b.length > 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6)),
    'audio/mpeg': b.length > 3 && (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)),
    'audio/ogg': b.length > 4 && ascii(0, 4) === 'OggS',
    'audio/wav': b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
  }[type];
  if (!ok) throw fail(`파일 형식이 올바르지 않아요. ${label} 파일을 올려 주세요.`);
  return b;
}

export class DonationAlertStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.donation-alert.json', { version: 2, revision: 0, settings: DEFAULTS() },
      state => plain(state) && revision(state.revision) && ((state.version === 2 && validV2(state.settings)) || (state.version === 1 && validV1(state.settings))), { maxBytes: 64 * 1024 });
    this.mediaDir = path.join(path.dirname(operationsFile), 'donation-alert-media');
  }
  snapshot() { const state = this.read(); return { settings: upgrade(state), revision: state.revision }; }
  /** Media files any tier still uses. */
  referenced() { return new Set(this.snapshot().settings.tiers.flatMap(t => [t.image?.file, t.audio?.file]).filter(Boolean)); }
  async removeUnused(files) { const used = this.referenced(); await Promise.all(files.filter(f => f && !used.has(f)).map(f => removeDurable(path.join(this.mediaDir, f)).catch(() => {}))); }
  async configure(input, { guard = () => {} } = {}) {
    const before = this.snapshot().settings, value = validateDonationAlertInput(input, before);
    let result;
    await this.update(async state => {
      await guard();
      if (state.revision !== value.revision) throw fail('다른 곳에서 후원 알림 설정이 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요.', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409);
      // Media are kept from the saved state (not from the snapshot read before the lock).
      const saved = new Map(upgrade(state).tiers.map(t => [t.id, t]));
      for (const t of value.settings.tiers) { t.image = saved.get(t.id)?.image || null; t.audio = saved.get(t.id)?.audio || null; }
      state.version = 2; state.settings = value.settings; state.revision++;
      result = { settings: structuredClone(state.settings), revision: state.revision };
    });
    await this.removeUnused(before.tiers.flatMap(t => [t.image?.file, t.audio?.file]));
    return result;
  }
  /** Input: {tierId, kind:'image'|'audio', type, data(base64), revision}. */
  async saveMedia(input, { guard = () => {} } = {}) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'data,kind,revision,tierId,type' || !tierId(input.tierId) || !['image', 'audio'].includes(input.kind) || !revision(input.revision)) throw fail('올릴 금액 구간과 파일을 확인해 주세요.');
    await guard();
    const bytes = decodeAlertMedia(input.kind, input.type, input.data);
    if (!this.snapshot().settings.tiers.some(t => t.id === input.tierId)) throw fail('금액 구간 목록이 바뀌었어요. 새로고침해 주세요.', 409);
    const file = `${input.tierId}-${input.kind}-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ALERT_MEDIA_TYPES[input.kind][input.type]}`;
    await mkdir(this.mediaDir, { recursive: true, mode: 0o700 });
    await atomicWriteFile(path.join(this.mediaDir, file), bytes);
    let previous = null, result;
    try {
      await this.update(async state => {
        await guard();
        if (state.revision !== input.revision) throw fail('다른 곳에서 후원 알림 설정이 바뀌었어요. 새로고침한 뒤 다시 올려 주세요.', 409);
        const settings = upgrade(state), tier = settings.tiers.find(t => t.id === input.tierId);
        if (!tier) throw fail('금액 구간 목록이 바뀌었어요. 새로고침해 주세요.', 409);
        previous = tier[input.kind]?.file !== file ? tier[input.kind]?.file || null : null;
        tier[input.kind] = { file, type: input.type };
        state.version = 2; state.settings = settings; state.revision++;
        result = { settings: structuredClone(settings), revision: state.revision };
      });
    } catch (error) { await this.removeUnused([file]); throw error; }
    await this.removeUnused([previous]);
    return result;
  }
  /** Input: {tierId, kind, revision}. Goes back to the cheese picture or the built-in chime. */
  async removeMedia(input, { guard = () => {} } = {}) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'kind,revision,tierId' || !tierId(input.tierId) || !['image', 'audio'].includes(input.kind) || !revision(input.revision)) throw fail('지울 파일을 확인해 주세요.');
    let previous = null, result;
    await this.update(async state => {
      await guard();
      if (state.revision !== input.revision) throw fail('다른 곳에서 후원 알림 설정이 바뀌었어요. 새로고침해 주세요.', 409);
      const settings = upgrade(state), tier = settings.tiers.find(t => t.id === input.tierId);
      if (!tier) throw fail('금액 구간 목록이 바뀌었어요. 새로고침해 주세요.', 409);
      previous = tier[input.kind]?.file || null; tier[input.kind] = null;
      state.version = 2; state.settings = settings; state.revision++;
      result = { settings: structuredClone(settings), revision: state.revision };
    });
    await this.removeUnused([previous]);
    return result;
  }
  async media(name) {
    if (!alertMediaName(name)) throw fail('파일을 찾지 못했어요.', 404);
    const kind = MEDIA_NAME.exec(name)[2], tier = this.snapshot().settings.tiers.find(t => t[kind]?.file === name);
    if (!tier) throw fail('파일을 찾지 못했어요.', 404);
    try { return { type: tier[kind].type, bytes: await readFile(path.join(this.mediaDir, name)) }; } catch { throw fail('파일을 찾지 못했어요.', 404); }
  }
}

/** The tier for an amount: the highest minimum not above it. */
export const tierFor = (tiers, amount) => [...tiers].reverse().find(t => amount >= t.minAmount) || null;

/**
 * Connects the broadcaster's CHZZK donations to the OBS alert.
 * - Runs only while enabled and a broadcaster account is connected (shares the donation subscription).
 * - Ignores donations for other channels and below the lowest tier.
 * - Test alerts work without CHZZK and are labelled as tests.
 */
export class DonationAlertService {
  constructor({ store, chzzkVerification = null, guard = () => {}, now = Date.now, reporter = () => {},
    sessionFactory = options => new ChzzkEventSession({ accessToken: options.accessToken, onStatus: options.onStatus, handlers: { DONATION: payload => options.onDonation(payload) } }) }) {
    Object.assign(this, { store, chzzkVerification, guard, now, reporter, sessionFactory });
    this.session = null; this.sessionChannel = ''; this.alerts = []; this.seq = 0; this.lastTestAt = 0;
    // A new id after every restart lets an open OBS page start over instead of waiting for old sequence numbers.
    this.boot = randomBytes(4).toString('hex');
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
    const entry = { id: ++this.seq, at: this.now(), nickname: alert.nickname, amount: alert.amount, message: alert.message, tier: alert.tier, ...(alert.test ? { test: true } : {}) };
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
    const tier = tierFor(settings.tiers, donation.amount);
    if (!tier) { this.ignored.belowMinimum++; return false; }
    return this.push({ nickname: clean(donation.nickname, 20) || '익명', amount: donation.amount, message: clean(donation.text, ALERT_MESSAGE_MAX), tier: tier.id });
  }
  /** Operator test: {amount, nickname?, message?}. Below the lowest tier it uses the lowest tier so every look can be tried. */
  test(input) {
    if (!plain(input) || Object.keys(input).some(key => !['nickname', 'amount', 'message'].includes(key)) || !int(input.amount, [1, 10000000]) ||
      (input.nickname !== undefined && typeof input.nickname !== 'string') || (input.message !== undefined && typeof input.message !== 'string')) throw fail('테스트할 치즈 금액(1 이상)을 확인해 주세요.');
    const now = this.now();
    if (now - this.lastTestAt < ALERT_TEST_INTERVAL_MS) throw fail('테스트 알림은 1초에 한 번만 보낼 수 있어요.', 429);
    this.guard();
    this.lastTestAt = now;
    const tiers = this.store.snapshot().settings.tiers, tier = tierFor(tiers, input.amount) || tiers[0];
    return this.push({ test: true, nickname: clean(input.nickname, 20) || '테스트', amount: input.amount, message: clean(input.message, ALERT_MESSAGE_MAX), tier: tier.id });
  }
  /** OBS feed: display settings plus alerts newer than `after` from this boot. */
  feed(after, boot) {
    const { settings } = this.store.snapshot();
    const since = boot === this.boot && Number.isSafeInteger(after) && after >= 0 ? after : 0;
    return { boot: this.boot, last: this.seq,
      settings: { durationSeconds: settings.durationSeconds, sound: settings.sound, showMessage: settings.showMessage,
        tiers: settings.tiers.map(t => ({ id: t.id, minAmount: t.minAmount, template: t.template, image: t.image?.file || null, audio: t.audio?.file || null })) },
      alerts: this.alerts.filter(alert => alert.id > since).map(alert => ({ ...alert, message: settings.showMessage ? alert.message : '' })) };
  }
  /** Streamer view: the latest alerts without messages (nickname and amount are enough to check). */
  recent(limit = 10) { return this.alerts.slice(-limit).reverse().map(({ id, at, nickname, amount, test }) => ({ id, at, nickname, amount, ...(test ? { test } : {}) })); }
  async close() { this.unsubscribe(); if (this.session) { this.session.stop(); this.session = null; } }
}

const sendMedia = (res, media) => res.set({ 'Content-Type': media.type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(media.bytes);

/** Streamer routes. They inherit dashboard/workspace authentication, CSRF, Idempotency-Key, the `broadcast` capability and workspace allowlists. */
export function installDonationAlertRoutes({ app, store, service, guard }) {
  const unavailable = () => fail('OBS 후원 알림을 준비하지 못했습니다.', 503);
  const json = (res, value) => res.set('Cache-Control', 'no-store').json(value);
  const view = () => ({ ...store.snapshot(), status: service ? service.status() : { state: 'unavailable', verification: 'pending' }, recent: service ? service.recent(10) : [] });
  app.get('/api/donation-alert', (_req, res, next) => { try { if (!store) throw unavailable(); json(res, view()); } catch (error) { next(error); } });
  app.post('/api/donation-alert', async (req, res, next) => {
    try { if (!store) throw unavailable(); guard(); await store.configure(req.body, { guard }); service?.sync(); json(res, view()); } catch (error) { next(error); }
  });
  app.post('/api/donation-alert/media', async (req, res, next) => { try { if (!store) throw unavailable(); guard(); await store.saveMedia(req.body, { guard }); json(res, view()); } catch (error) { next(error); } });
  app.post('/api/donation-alert/media/remove', async (req, res, next) => { try { if (!store) throw unavailable(); guard(); await store.removeMedia(req.body, { guard }); json(res, view()); } catch (error) { next(error); } });
  app.get('/api/donation-alert/media/:name', async (req, res, next) => { try { if (!store) throw unavailable(); sendMedia(res, await store.media(req.params.name)); } catch (error) { next(error); } });
  app.post('/api/donation-alert/test', (req, res, next) => {
    try { if (!store || !service) throw unavailable(); guard(); const alert = service.test(req.body); json(res, { ...view(), test: { id: alert.id } }); } catch (error) { next(error); }
  });
}

/** OBS media for the alert page (broadcast token). */
export async function sendAlertMedia(res, store, name) { sendMedia(res, await store.media(name)); }
