import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatCommandsService, ChatCommandsStore, sendChzzkChat, validateChatCommandsInput } from '../src/chat-commands.js';
import { normalizeChatSender } from '../src/chzzk-session.js';
import { workspaceRouteAllowed } from '../src/workspace-policy.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';
import { hiddenFeatureFor, OPERATOR_PAGES } from '../src/feature-visibility.js';

// All data below is fictional. No test reaches CHZZK, Discord or Naver.
const CHANNEL = 'a'.repeat(32), OTHER = 'b'.repeat(32), FAN = 'c'.repeat(32), STRANGER = 'e'.repeat(32), VIEWER = '123456789012345678';
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
async function setup(t, { now = () => 1_700_000_000_000, entries = [], send } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chat-commands-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'operations.json'), store = new ChatCommandsStore(file); await store.init();
  const sent = [], sessions = [];
  const verification = { summary: () => ({ ownerConnected: true }), targetChannelId: () => CHANNEL, ownerToken: async () => 'fixture-owner-token',
    store: { read: () => ({ users: [{ userId: VIEWER, channelId: FAN }] }), subscribe: () => () => {} } };
  const queue = { summary: () => ({ entries, counts: { waiting: entries.filter(e => e.status === 'waiting').length } }) };
  const service = new ChatCommandsService({ store, chzzkVerification: verification, participationQueue: queue, now,
    send: send || (async ({ token, message }) => { sent.push({ token, message }); return true; }),
    sessionFactory: options => { const s = { options, on: false, start() { this.on = true; }, stop() { this.on = false; }, status: () => ({ status: 'subscribed', detail: '' }) }; sessions.push(s); return s; } });
  t.after(() => service.close());
  return { file, store, service, sent, sessions };
}
const input = (store, patch = {}) => { const { settings, revision } = store.snapshot(); return { ...structuredClone(settings), revision, ...patch }; };
const chat = (content, { channelId = CHANNEL, sender = FAN, nickname = '봄이' } = {}) => ({ channelId, senderChannelId: sender, chatChannelId: 'x', profile: { nickname }, userRoleCode: 'common_user', content, emojis: {}, messageTime: 1 });

test('chat sender ids are read only for matching', () => {
  assert.deepEqual(normalizeChatSender(chat('!순번')), { channelId: CHANNEL, senderChannelId: FAN, nickname: '봄이', role: 'viewer', content: '!순번' });
  assert.equal(normalizeChatSender({ channelId: CHANNEL, content: '' }), null);
  assert.equal(normalizeChatSender(chat('hi', { sender: 'bad' })).senderChannelId, '');
});

test('commands validate names, replies, duplicates, built-in names and the latest revision', async t => {
  const { store } = await setup(t);
  for (const [bad, status] of [[{ commands: [{ trigger: '디 코', response: 'x' }] }, 400], [{ commands: [{ trigger: '대기', response: 'x' }] }, 400],
    [{ commands: [{ trigger: '디코', response: '!디코' }] }, 400], [{ commands: [{ trigger: '디코', response: 'x' }, { trigger: '디코', response: 'y' }] }, 400],
    [{ commands: [{ trigger: '디코', response: 'x'.repeat(101) }] }, 400], [{ cooldownSeconds: 2 }, 400], [{ builtins: { waiting: true } }, 400],
    [{ commands: [{ id: 'm12345678', trigger: '디코', response: 'x' }] }, 409], [{ commands: Array.from({ length: 31 }, (_, i) => ({ trigger: 'c' + i, response: 'x' })) }, 400]]) {
    await assert.rejects(store.configure(input(store, bad)), { status }, JSON.stringify(bad).slice(0, 60));
  }
  const saved = await store.configure(input(store, { enabled: true, commands: [{ trigger: '!디코', response: ' 디스코드는\n소개란에! ' }] }));
  assert.deepEqual(saved.settings.commands.map(({ trigger, response }) => ({ trigger, response })), [{ trigger: '디코', response: '디스코드는 소개란에!' }]);
  assert.match(saved.settings.commands[0].id, /^m[a-f0-9]{8}$/);
  assert.throws(() => validateChatCommandsInput({ ...input(store), revision: -1 }), { status: 400 });
  await assert.rejects(store.configure(input(store, { revision: 0 })), { status: 409 });
});

test('the bot answers built-in and custom commands on the connected channel with cooldowns', async t => {
  let clock = 1_700_000_000_000;
  const entries = [{ id: 'q1', status: 'waiting', discordUserId: '999999999999999999' }, { id: 'q2', status: 'waiting', discordUserId: VIEWER }, { id: 'q3', status: 'joined', discordUserId: '888888888888888888' }];
  const { store, service, sent, sessions } = await setup(t, { now: () => clock, entries });
  await store.configure(input(store, { enabled: true, cooldownSeconds: 10, commands: [{ trigger: '디코', response: '{닉네임}님 디스코드는 소개란에!' }] })); service.sync();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].on, true);
  assert.equal(service.receive(chat('!대기')), '지금 대기 중인 참가자는 2명이에요.');
  assert.equal(service.receive(chat('!순번')), '봄이님은 대기 2번째예요.');
  assert.equal(service.receive(chat('!순번', { sender: STRANGER, nickname: '손님' })), false, 'cooldown per command');
  clock += 10000;
  assert.equal(service.receive(chat('!순번', { sender: STRANGER, nickname: '손님' })), '손님님, 팔로워 인증으로 계정을 연결하면 순번을 볼 수 있어요.');
  assert.equal(service.receive(chat('!디코 알려줘')), '봄이님 디스코드는 소개란에!');
  assert.equal(service.receive(chat('!명령어')), '명령어: !대기 !순번 !명령어 !디코');
  assert.equal(service.receive(chat('!없는거')), false);
  assert.equal(service.receive(chat('그냥 채팅')), false);
  assert.equal(service.receive(chat('!대기', { channelId: OTHER })), false);
  assert.equal(service.status().counts.otherChannel, 1);
  await settle();
  // Replies are sent one per second.
  assert.ok(sent.length >= 1 && sent.every(item => item.token === 'fixture-owner-token'));
  assert.equal(service.status().counts.cooldown, 1);
  // A message the bot itself sent is not answered again.
  clock += 60000;
  assert.equal(service.receive(chat(sent[0].message)), false);
});

test('sending failures report the missing write permission and nothing is saved from chat', async t => {
  const { file, store, service } = await setup(t, { send: async () => { throw Object.assign(Error('no'), { status: 403 }); } });
  await store.configure(input(store, { enabled: true }));
  service.receive(chat('!대기', { nickname: '비밀닉네임' })); await settle();
  assert.equal(service.status().send.state, 'auth_required');
  assert.match(service.status().send.detail, /채팅 메시지 쓰기/);
  assert.equal((await readFile(file + '.chat-commands.json', 'utf8')).includes('비밀닉네임'), false);
  // Preview never sends.
  assert.deepEqual(service.test({ content: '!대기' }), { reply: '지금 대기 중인 참가자는 0명이에요.' });
  assert.throws(() => service.test({}), { status: 400 });
});

test('the CHZZK chat send request uses the official endpoint and bearer token', async () => {
  const calls = [];
  await sendChzzkChat({ token: 'fixture-token', message: '안녕', fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200 }; } });
  assert.equal(calls[0].url, 'https://openapi.chzzk.naver.com/open/v1/chats/send');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: '안녕' });
  await assert.rejects(sendChzzkChat({ token: 't', message: 'x', fetchImpl: async () => ({ ok: false, status: 403 }) }), { status: 403 });
});

test('chat command routes are workspace product routes with the broadcast capability and can be hidden', () => {
  for (const [method, url] of [['GET', '/api/chat-commands'], ['POST', '/api/chat-commands'], ['POST', '/api/chat-commands/test']]) {
    assert.equal(workspaceRouteAllowed(method, url), true, url); assert.equal(dashboardCapabilityForRequest(method, url), 'broadcast', url);
  }
  assert.ok(OPERATOR_PAGES.includes('chat-commands'));
  assert.equal(hiddenFeatureFor({ operator: ['chat-commands'], viewer: [] }, { path: '/api/chat-commands/test' }), 'chat-commands');
});
