import { createHash, randomBytes } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { ChzzkEventSession, normalizeChatSender } from './chzzk-session.js';
import { readSessionIntakePolicy } from './intake-policy.js';
import { performParticipantSelfServiceAction } from './participant-self-service.js';

// 채팅 명령어: the bot answers "!명령어" in the broadcaster's CHZZK chat (official API, scope "채팅 메시지 쓰기").
// Saved: settings and the streamer's own commands only (`operations.json.chat-commands.json`).
// Chat content, nicknames and sender channel ids stay in memory; the sender id is used only to find
// the sender's own linked queue entry for !순번 and is then dropped.

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const CONTROL = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;
const clean = (value, limit) => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const int = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;

export const CHAT_COMMAND_LIMITS = Object.freeze({ commands: 30, response: 100, cooldown: [3, 300], sendIntervalMs: 1000, outbox: 5, testIntervalMs: 500 });
export const BUILTIN_COMMANDS = Object.freeze({ waiting: '대기', position: '순번', help: '명령어', join: '신청' });
const TRIGGER = /^[가-힣A-Za-z0-9]{1,12}$/;
const ACTIVE = new Set(['waiting', 'called', 'joined', 'postponed_next', 'postponed_next2']);
const DEFAULTS = () => ({ enabled: false, cooldownSeconds: 10, builtins: { waiting: true, position: true, help: true, join: false }, commands: [] });
// Saved before !신청 existed: three built-ins. Read as "!신청 off".
const LEGACY_BUILTIN_KEYS = ['waiting', 'position', 'help'];
const withJoin = settings => ({ ...settings, builtins: { join: false, ...settings.builtins } });
const SETTING_KEYS = ['enabled', 'cooldownSeconds', 'builtins', 'commands'];
const BUILTIN_KEYS = Object.keys(BUILTIN_COMMANDS);
const commandId = value => typeof value === 'string' && /^m[a-f0-9]{8}$/.test(value);
const reserved = trigger => Object.values(BUILTIN_COMMANDS).includes(trigger);

function validResponse(text) { return typeof text === 'string' && text.length >= 1 && text.length <= CHAT_COMMAND_LIMITS.response && text === clean(text, CHAT_COMMAND_LIMITS.response) && !text.startsWith('!'); }
function validSettings(s) {
  if (!plain(s) || Object.keys(s).sort().join() !== [...SETTING_KEYS].sort().join() || typeof s.enabled !== 'boolean' || !int(s.cooldownSeconds, CHAT_COMMAND_LIMITS.cooldown)) return false;
  const keys = plain(s.builtins) ? Object.keys(s.builtins).sort().join() : '';
  if ((keys !== [...BUILTIN_KEYS].sort().join() && keys !== [...LEGACY_BUILTIN_KEYS].sort().join()) || !Object.values(s.builtins).every(value => typeof value === 'boolean')) return false;
  if (!Array.isArray(s.commands) || s.commands.length > CHAT_COMMAND_LIMITS.commands) return false;
  const seen = new Set();
  for (const c of s.commands) {
    if (!plain(c) || Object.keys(c).sort().join() !== 'id,response,trigger' || !commandId(c.id) || typeof c.trigger !== 'string' || !TRIGGER.test(c.trigger) || reserved(c.trigger) || !validResponse(c.response)) return false;
    const key = c.trigger.toLowerCase(); if (seen.has(key)) return false; seen.add(key);
  }
  return new Set(s.commands.map(c => c.id)).size === s.commands.length;
}

/** Operator input: {enabled, cooldownSeconds, builtins:{waiting,position,help}, commands:[{id?, trigger, response}], revision}. */
export function validateChatCommandsInput(input, existingIds = new Set()) {
  if (!plain(input) || Object.keys(input).sort().join() !== [...SETTING_KEYS, 'revision'].sort().join() || !revision(input.revision)) throw fail('채팅 명령어 설정과 최신 버전을 확인해 주세요.');
  if (typeof input.enabled !== 'boolean' || !int(input.cooldownSeconds, CHAT_COMMAND_LIMITS.cooldown)) throw fail(`같은 명령어 다시 답하기 간격은 ${CHAT_COMMAND_LIMITS.cooldown[0]}~${CHAT_COMMAND_LIMITS.cooldown[1]}초예요.`);
  if (!plain(input.builtins) || Object.keys(input.builtins).sort().join() !== [...BUILTIN_KEYS].sort().join() || !BUILTIN_KEYS.every(key => typeof input.builtins[key] === 'boolean')) throw fail('기본 명령어 설정을 확인해 주세요.');
  if (!Array.isArray(input.commands) || input.commands.length > CHAT_COMMAND_LIMITS.commands) throw fail(`명령어는 ${CHAT_COMMAND_LIMITS.commands}개까지 만들 수 있어요.`);
  const seen = new Set();
  const commands = input.commands.map((c, index) => {
    if (!plain(c) || Object.keys(c).some(key => !['id', 'trigger', 'response'].includes(key))) throw fail(`${index + 1}번째 명령어를 확인해 주세요.`);
    const trigger = typeof c.trigger === 'string' ? c.trigger.trim().replace(/^!/, '') : '';
    if (!TRIGGER.test(trigger)) throw fail(`${index + 1}번째 명령어 이름은 한글·영문·숫자 1~12자로 써 주세요. (예: 디코)`);
    if (reserved(trigger)) throw fail(`!${trigger}는 기본 명령어라 만들 수 없어요.`);
    if (seen.has(trigger.toLowerCase())) throw fail(`!${trigger} 명령어가 두 번 있어요.`); seen.add(trigger.toLowerCase());
    const response = typeof c.response === 'string' ? clean(c.response, CHAT_COMMAND_LIMITS.response + 1) : '';
    if (!response) throw fail(`!${trigger}의 답장을 써 주세요.`);
    if (response.length > CHAT_COMMAND_LIMITS.response) throw fail(`!${trigger}의 답장은 ${CHAT_COMMAND_LIMITS.response}자까지예요.`);
    if (response.startsWith('!')) throw fail(`!${trigger}의 답장은 !로 시작할 수 없어요. (명령어가 서로 부르는 것을 막기 위해서예요)`);
    const id = c.id === undefined ? 'm' + randomBytes(4).toString('hex') : c.id;
    if (!commandId(id) || (c.id !== undefined && !existingIds.has(id))) throw fail('명령어 목록이 바뀌었어요. 새로고침해 주세요.', 409);
    return { id, trigger, response };
  });
  const settings = { enabled: input.enabled, cooldownSeconds: input.cooldownSeconds, builtins: { ...input.builtins }, commands };
  if (!validSettings(settings)) throw fail('채팅 명령어 설정을 확인해 주세요.');
  return { settings, revision: input.revision };
}

export class ChatCommandsStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.chat-commands.json', { version: 1, revision: 0, settings: DEFAULTS() },
      state => plain(state) && state.version === 1 && revision(state.revision) && validSettings(state.settings), { maxBytes: 128 * 1024 });
  }
  snapshot() { const state = this.read(); return { settings: withJoin(structuredClone(state.settings)), revision: state.revision }; }
  async configure(input, { guard = () => {} } = {}) {
    const value = validateChatCommandsInput(input, new Set(this.read().settings.commands.map(c => c.id)));
    let result;
    await this.update(async state => {
      await guard();
      if (state.revision !== value.revision) throw fail('다른 곳에서 채팅 명령어가 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요.', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409);
      state.settings = value.settings; state.revision++;
      result = { settings: structuredClone(state.settings), revision: state.revision };
    });
    return result;
  }
}

/** Sends one chat message as the connected broadcaster account. */
export async function sendChzzkChat({ token, message, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000); timer.unref?.();
  try {
    const response = await fetchImpl('https://openapi.chzzk.naver.com/open/v1/chats/send', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ message })
    });
    if (!response.ok) throw Object.assign(Error('CHZZK 채팅 전송 실패'), { status: response.status });
    return true;
  } finally { clearTimeout(timer); }
}

export class ChatCommandsService {
  constructor({ store, chzzkVerification = null, participationQueue = null, operations = null, participationCalls = null, records = () => [], afterJoin = async () => {}, selfServiceJoin = performParticipantSelfServiceAction, guard = () => {}, now = Date.now, reporter = () => {}, send = sendChzzkChat,
    sessionFactory = options => new ChzzkEventSession({ accessToken: options.accessToken, onStatus: options.onStatus, handlers: { CHAT: payload => options.onChat(payload) } }) }) {
    Object.assign(this, { store, chzzkVerification, participationQueue, operations, participationCalls, records, afterJoin, selfServiceJoin, guard, now, reporter, send, sessionFactory });
    this.session = null; this.sessionChannel = ''; this.lastUsed = new Map(); this.outbox = []; this.sending = false; this.lastSentAt = 0; this.cooldownUntil = 0;
    this.recentSent = []; this.lastTestAt = 0;
    this.counts = { replied: 0, cooldown: 0, dropped: 0, failed: 0, otherChannel: 0, joined: 0 };
    this.sendState = { state: 'idle', detail: '', at: 0 };
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
      this.session = this.sessionFactory({ accessToken: () => this.chzzkVerification.ownerToken(), onChat: payload => this.receive(payload),
        onStatus: status => { if (status?.status === 'auth_required') this.reporter({ severity: 'warn', code: 'chzzk_command_session', summary: 'CHZZK 채팅 세션 권한 확인 필요(채팅 명령어)', detail: status.detail }); } });
      this.session.start();
    }
  }
  status() {
    const { settings } = this.store.snapshot(), session = this.session?.status() || null;
    const state = !this.chzzkVerification ? 'unavailable' : !this.connected() ? 'not_connected' : !settings.enabled ? 'disabled' : session?.status || 'stopped';
    return { state, detail: session?.detail || '', send: { ...this.sendState }, counts: { ...this.counts }, verification: 'pending' };
  }
  /** The sender's linked Discord user, if the sender linked a CHZZK account through follower verification. */
  linkedUser(senderChannelId) {
    if (!senderChannelId) return null;
    try { return (this.chzzkVerification?.store?.read?.().users || []).find(user => String(user.channelId).toLowerCase() === senderChannelId) || null; } catch { return null; }
  }
  positionReply(nickname, senderChannelId) {
    const user = this.linkedUser(senderChannelId);
    if (!user) return `${nickname}님, 팔로워 인증으로 계정을 연결하면 순번을 볼 수 있어요.`;
    const entries = (this.participationQueue?.summary?.().entries || []).filter(entry => ACTIVE.has(entry.status));
    const mine = entries.find(entry => entry.discordUserId === user.userId);
    if (!mine) return `${nickname}님은 지금 대기열에 없어요.`;
    if (mine.status === 'called') return `${nickname}님, 지금 호출 중이에요! 응답해 주세요.`;
    if (mine.status === 'joined') return `${nickname}님은 이번 판 참가 확정이에요.`;
    if (mine.status === 'postponed_next') return `${nickname}님은 다음 판으로 예약돼 있어요.`;
    if (mine.status === 'postponed_next2') return `${nickname}님은 다다음 판으로 예약돼 있어요.`;
    const rank = entries.filter(entry => entry.status === 'waiting').findIndex(entry => entry.id === mine.id) + 1;
    return `${nickname}님은 대기 ${rank}번째예요.`;
  }
  /** !신청 for one sender. A linked viewer joins the Discord way (same rules as the join button); anyone else joins by CHZZK nickname. */
  async joinReply(nickname, senderChannelId) {
    const session = this.operations?.read?.().session;
    if (!session || session.phase !== 'open' || (session.closeAt && this.now() >= session.closeAt)) return `${nickname}님, 지금은 시참 모집 중이 아니에요.`;
    try { this.guard(); } catch { return `${nickname}님, 지금은 신청을 받을 수 없어요. 잠시 후 다시 해 주세요.`; }
    const said = error => `${nickname}님, ${String(error?.message || '신청하지 못했어요.')}`.slice(0, CHAT_COMMAND_LIMITS.response);
    const user = this.linkedUser(senderChannelId), records = this.records() || [], profile = user ? records.find(record => record.discordId === user.userId) : null;
    if (user && profile) {
      try {
        await this.selfServiceJoin({ action: 'join', userId: user.userId, profile, operations: this.operations, participationQueue: this.participationQueue, participationCalls: this.participationCalls, records });
      } catch (error) { return said(error); }
      this.counts.joined++; await this.afterJoin().catch(() => {});
      return ('신청 완료! ' + this.positionReply(nickname, senderChannelId).replace('대기열에 없어요.', '신청했어요.')).slice(0, CHAT_COMMAND_LIMITS.response);
    }
    if (!senderChannelId) return `${nickname}님, 채팅 계정을 확인하지 못했어요.`;
    // CHZZK-only viewers: a separate intake (like the cafe) with the same capacity and duplicate rules.
    let policy; try { policy = readSessionIntakePolicy(session); } catch (error) { return said(error); }
    const identityKey = 'chzzk:' + createHash('sha256').update('chzzk-chat:' + senderChannelId).digest('hex').slice(0, 40);
    const entries = this.participationQueue?.summary?.().entries || [];
    const mine = entries.find(entry => entry.identityKey === identityKey && ACTIVE.has(entry.status));
    const waitingRank = id => entries.filter(entry => entry.status === 'waiting').findIndex(entry => entry.id === id) + 1;
    if (mine) return policy.duplicatePolicy === 'reject' ? `${nickname}님은 이미 신청했어요.` : `${nickname}님은 이미 신청했어요. 대기 ${waitingRank(mine.id) || '-'}번째예요.`;
    const count = entries.filter(entry => entry.source === 'chzzk' && entry.sessionId === session.id && ACTIVE.has(entry.status)).length;
    if (policy.maxApplicants > 0 && count >= policy.maxApplicants) return `${nickname}님, 채팅 신청 정원이 다 찼어요.`;
    try {
      const result = await this.participationQueue.register({ source: 'chzzk', displayName: nickname, identityKey, sessionId: session.id, game: session.game || null, mode: session.mode || null, round: Number.isInteger(session.round) ? session.round : null });
      this.counts.joined++;
      const fresh = (this.participationQueue.summary().entries || []).filter(entry => entry.status === 'waiting').findIndex(entry => entry.id === result.entry.id) + 1;
      return `${nickname}님 신청 완료! 대기 ${fresh || '-'}번째예요.`;
    } catch (error) { return said(error); }
  }
  /** The reply for one chat message, or null. Never sends. */
  reply(content, { nickname = '익명', senderChannelId = '' } = {}) {
    const { settings } = this.store.snapshot();
    const match = /^!([가-힣A-Za-z0-9]{1,12})(?:\s|$)/.exec(String(content || '').trim());
    if (!match) return null;
    const trigger = match[1], key = trigger.toLowerCase(), b = settings.builtins;
    if (trigger === BUILTIN_COMMANDS.waiting && b.waiting) {
      const counts = this.participationQueue?.summary?.().counts || {};
      return { trigger, text: `지금 대기 중인 참가자는 ${Number(counts.waiting) || 0}명이에요.` };
    }
    if (trigger === BUILTIN_COMMANDS.position && b.position) return { trigger, perSender: true, text: this.positionReply(nickname, senderChannelId) };
    if (trigger === BUILTIN_COMMANDS.join && b.join) return { trigger, perSender: true, join: true };
    if (trigger === BUILTIN_COMMANDS.help && b.help) {
      const names = [...BUILTIN_KEYS.filter(k => b[k]).map(k => BUILTIN_COMMANDS[k]), ...settings.commands.map(c => c.trigger)].map(n => '!' + n);
      let text = '명령어:'; for (const name of names) { if ((text + ' ' + name).length > CHAT_COMMAND_LIMITS.response) break; text += ' ' + name; }
      return { trigger, text };
    }
    const custom = settings.commands.find(c => c.trigger.toLowerCase() === key);
    if (!custom) return null;
    return { trigger: custom.trigger, text: custom.response.replaceAll('{닉네임}', nickname).slice(0, CHAT_COMMAND_LIMITS.response) };
  }
  /** A CHZZK CHAT payload. Resolves to the queued reply text or false. */
  async receive(payload) {
    const chat = normalizeChatSender(payload);
    if (!chat) return false;
    let target = ''; try { target = this.chzzkVerification.targetChannelId(); } catch {}
    if (!target || chat.channelId !== target) { this.counts.otherChannel++; return false; }
    const { settings } = this.store.snapshot();
    if (!settings.enabled) return false;
    const now = this.now();
    this.recentSent = this.recentSent.filter(item => now - item.at < 30000);
    if (this.recentSent.some(item => item.text === chat.content)) return false;
    const answer = this.reply(chat.content, chat);
    if (!answer) return false;
    // !순번·!신청 wait per viewer; other commands wait for everyone.
    const key = answer.trigger.toLowerCase() + (answer.perSender ? ':' + (chat.senderChannelId || chat.nickname) : ''), last = this.lastUsed.get(key) || 0;
    if (now - last < settings.cooldownSeconds * 1000) { this.counts.cooldown++; return false; }
    this.lastUsed.set(key, now);
    if (answer.join) answer.text = await this.joinReply(chat.nickname, chat.senderChannelId);
    try { this.guard(); } catch { return false; }
    // A join still counts when the reply is dropped; only the chat answer is skipped.
    if (this.outbox.length >= CHAT_COMMAND_LIMITS.outbox) { this.counts.dropped++; return false; }
    this.outbox.push(answer.text); void this.flush();
    return answer.text;
  }
  async flush() {
    if (this.sending) return; this.sending = true;
    try {
      while (this.outbox.length) {
        const wait = Math.max(this.cooldownUntil, this.lastSentAt + CHAT_COMMAND_LIMITS.sendIntervalMs) - this.now();
        if (wait > 0) await new Promise(resolve => { const t = setTimeout(resolve, Math.min(wait, 60000)); t.unref?.(); });
        const text = this.outbox.shift();
        this.lastSentAt = this.now();
        try {
          await this.send({ token: await this.chzzkVerification.ownerToken(), message: text });
          this.counts.replied++; this.recentSent.push({ text, at: this.now() }); this.sendState = { state: 'ok', detail: '', at: this.now() };
        } catch (error) {
          this.counts.failed++;
          const status = Number(error?.status) || 0;
          if (status === 429) this.cooldownUntil = this.now() + 60000;
          this.sendState = status === 401 || status === 403
            ? { state: 'auth_required', detail: '치지직 개발자 앱에서 "채팅 메시지 쓰기" 권한을 켜고 방송 계정을 다시 연결해 주세요.', at: this.now() }
            : { state: 'error', detail: status === 429 ? '요청이 많아 1분 쉬었다가 다시 보냅니다.' : '채팅을 보내지 못했습니다.', at: this.now() };
          if (status === 401 || status === 403) { this.outbox = []; this.reporter({ severity: 'warn', code: 'chzzk_chat_send', summary: 'CHZZK 채팅 쓰기 권한 확인 필요', detail: String(status) }); }
        }
      }
    } finally { this.sending = false; }
  }
  /** Streamer preview: what the bot would answer. Nothing is sent and no cooldown is used. */
  test(input) {
    if (!plain(input) || Object.keys(input).some(key => !['content', 'nickname'].includes(key)) || typeof input.content !== 'string' || (input.nickname !== undefined && typeof input.nickname !== 'string')) throw fail('미리 볼 채팅을 입력해 주세요.');
    const content = clean(input.content, 100);
    if (!content) throw fail('미리 볼 채팅을 입력해 주세요.');
    const now = this.now();
    if (now - this.lastTestAt < CHAT_COMMAND_LIMITS.testIntervalMs) throw fail('잠시 후 다시 해 주세요.', 429);
    this.lastTestAt = now;
    const answer = this.reply(content, { nickname: clean(input.nickname, 20) || '테스트' });
    if (answer?.join) return { reply: '(미리 보기) 실제 채팅에서만 신청을 처리해요. 모집 중이면 대기열에 넣고 순번을 알려 줘요.' };
    return { reply: answer ? answer.text : null };
  }
  /** Commands viewers can use (for the viewer page). Empty while the feature is off. */
  publicList() {
    const { settings } = this.store.snapshot();
    if (!settings.enabled) return { enabled: false, commands: [] };
    const about = { waiting: '지금 대기 중인 참가자 수', position: '내 순서 (팔로워 인증 연결 시)', help: '쓸 수 있는 명령어 목록', join: '시참 신청 (모집 중일 때)' };
    const builtins = BUILTIN_KEYS.filter(key => settings.builtins[key]).map(key => ({ trigger: BUILTIN_COMMANDS[key], about: about[key] }));
    return { enabled: true, commands: [...builtins, ...settings.commands.map(c => ({ trigger: c.trigger, about: c.response.replaceAll('{닉네임}', '내 닉네임') }))] };
  }
  async close() { this.unsubscribe(); if (this.session) { this.session.stop(); this.session = null; } this.outbox = []; }
}

/** Streamer routes. They inherit dashboard/workspace authentication, CSRF, Idempotency-Key, the `broadcast` capability and workspace allowlists. */
export function installChatCommandsRoutes({ app, store, service, guard }) {
  const unavailable = () => fail('채팅 명령어를 준비하지 못했습니다.', 503);
  const json = (res, value) => res.set('Cache-Control', 'no-store').json(value);
  const view = () => ({ ...store.snapshot(), builtinNames: BUILTIN_COMMANDS, status: service ? service.status() : { state: 'unavailable', verification: 'pending' } });
  app.get('/api/chat-commands', (_req, res, next) => { try { if (!store) throw unavailable(); json(res, view()); } catch (error) { next(error); } });
  app.post('/api/chat-commands', async (req, res, next) => {
    try { if (!store) throw unavailable(); guard(); await store.configure(req.body, { guard }); service?.sync(); json(res, view()); } catch (error) { next(error); }
  });
  app.post('/api/chat-commands/test', (req, res, next) => {
    try { if (!store || !service) throw unavailable(); json(res, service.test(req.body)); } catch (error) { next(error); }
  });
}
