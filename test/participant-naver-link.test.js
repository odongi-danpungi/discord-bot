import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ParticipantNaverLinkStore, createParticipantNaverLinkService } from '../src/participant-naver-link.js';

const GUILD = '123456789012345678', USER = '223456789012345678', OTHER = '323456789012345678';
const BINDING = 'synthetic-portal-session-csrf';
const TOKEN = 'synthetic-provider-token';
const SUBJECT = 'Example+Private/Subject_123-abc=';
const hash = value => createHash('sha256').update(value).digest('hex');
const row = (userId = USER, subject = 'one') => ({ userId, subjectHash: hash(subject), clientHash: hash('client-and-key'), linkedAt: 1000 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const tokenResponse = () => response({ access_token: TOKEN, token_type: 'bearer', expires_in: '3600', refresh_token: 'discard-this-refresh-token' });
const profileResponse = (subject = SUBJECT) => response({ resultcode: '00', message: 'success', response: { id: subject, name: 'Do not retain me', email: 'private@example.invalid' } });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'participant-naver-link-'));
  const file = path.join(directory, 'private-identities.json');
  const store = new ParticipantNaverLinkStore(file); await store.init();
  const config = { participantNaverClientId: 'synthetic-participant-app', participantNaverClientSecret: 'synthetic-participant-secret',
    naverClientId: 'operator-app-must-not-be-used', naverClientSecret: 'operator-secret-must-not-be-used',
    naverTokenKey: Buffer.alloc(32, 71).toString('base64'), publicBaseUrl: 'https://bot.example.invalid/ignored/path', ...options.config };
  const calls = [];
  let clock = 100000;
  const fetchImpl = options.fetchImpl || (async (url, init) => {
    calls.push({ url, init });
    return url.includes('/token') ? tokenResponse() : profileResponse();
  });
  const service = createParticipantNaverLinkService({ config, guildId: GUILD, store, fetchImpl, now: () => clock, ...options.service });
  t.after(async () => { service.close(); await store.flush(); await rm(directory, { recursive: true, force: true }); });
  const begin = (userId = USER, extra = {}) => {
    const result = service.begin({ userId, sessionBinding: BINDING, revision: store.read().revision, consent: true, ...extra });
    return { ...result, state: new URL(result.url).searchParams.get('state') };
  };
  const complete = (state, extra = {}) => service.complete({ state, code: 'synthetic-one-use-code', userId: USER, sessionBinding: BINDING, ...extra });
  return { directory, file, store, config, service, calls, begin, complete, setClock: value => { clock = value; } };
}

test('private store persists only the strict identity proof schema and rejects duplicate subjects and stale revisions', async t => {
  const f = await fixture(t); await f.store.saveLink(row(), { revision: 0 });
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), { version: 1, revision: 1, links: [row()] });
  await assert.rejects(f.store.saveLink(row(OTHER), { revision: 1 }), { code: 'participant_naver_link_conflict' });
  await assert.rejects(f.store.saveLink(row(OTHER, 'two'), { revision: 0 }), { code: 'participant_naver_link_changed' });
  await assert.rejects(f.store.saveLink({ ...row(), token: 'must-not-persist' }, { revision: 1 }), { code: 'participant_naver_link_invalid' });
  await f.store.saveLink(row(USER, 'replacement'), { revision: 1 });
  assert.equal(f.store.read().links.length, 1); assert.equal(f.store.read().revision, 2);
  const reopened = new ParticipantNaverLinkStore(f.file); await reopened.init();
  assert.deepEqual(reopened.read(), f.store.read());
  await f.store.removeLink(USER, { revision: 2 });
  assert.deepEqual(f.store.read(), { version: 1, revision: 3, links: [] });
});

test('strict persisted state rejects unknown fields, invalid hashes, duplicate users and duplicate provider proofs', async t => {
  const f = await fixture(t);
  const invalid = [
    { version: 2, revision: 0, links: [] }, { version: 1, revision: -1, links: [] },
    { version: 1, revision: 0, links: [], profile: {} },
    { version: 1, revision: 0, links: [{ ...row(), clientHash: 'plain-client-id' }] },
    { version: 1, revision: 0, links: [{ ...row(), subjectHash: 'raw-provider-id' }] },
    { version: 1, revision: 0, links: [{ ...row(), linkedAt: 0 }] },
    { version: 1, revision: 0, links: [row(), row(USER, 'two')] },
    { version: 1, revision: 0, links: [row(), row(OTHER)] }
  ];
  for (const value of invalid) await assert.rejects(f.store.write(value), /형식/);
  assert.deepEqual(f.store.read(), { version: 1, revision: 0, links: [] });
});

test('begin requires explicit consent, current revision and an exact valid authenticated identity', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8');
  for (const extra of [{ consent: false }, { consent: 'true' }, { revision: '0' }, { revision: -1 }, { userId: 'display-name' },
    { sessionBinding: '' }, { sessionBinding: 'x'.repeat(257) }, { sessionBinding: 'bad\ncsrf' }])
    assert.throws(() => f.begin(USER, extra), { code: 'participant_naver_link_invalid' });
  assert.throws(() => f.begin(USER, { revision: 1 }), { code: 'participant_naver_link_changed' });
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.calls.length, 0);
});

test('authorize uses only dedicated credentials and the fixed participant callback with a ten-minute nonce', async t => {
  const f = await fixture(t), started = f.begin(), url = new URL(started.url);
  assert.equal(url.origin + url.pathname, 'https://nid.naver.com/oauth2.0/authorize');
  assert.equal(url.searchParams.get('client_id'), f.config.participantNaverClientId);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://bot.example.invalid/naver/participant/callback');
  assert.equal(started.expiresAt, 700000); assert.match(started.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.service.callbackMatches(started.state), true);
  assert.doesNotMatch(started.url, /operator-|secret|token_key|csrf|223456789012345678/);
  assert.deepEqual(f.store.read(), { version: 1, revision: 0, links: [] });
});

test('callback binds the initiating user and browser without consuming a legitimate request on mismatch', async t => {
  const f = await fixture(t), { state } = f.begin();
  for (const extra of [{ userId: OTHER }, { sessionBinding: 'other-browser' }, { sessionBinding: '' }, { sessionBinding: 'x'.repeat(257) }])
    await assert.rejects(f.complete(state, extra), { code: 'participant_naver_link_invalid' });
  assert.equal(f.service.callbackMatches(state), true); assert.equal(f.calls.length, 0);
  assert.equal((await f.complete(state)).linked, true);
  assert.equal(f.service.callbackMatches(state), false);
  await assert.rejects(f.complete(state), { code: 'participant_naver_link_invalid' });
  assert.equal(f.calls.length, 2);
});

test('successful proof discards access/refresh tokens and provider profile, and status reads neither write nor reveal identities', async t => {
  const f = await fixture(t), { state } = f.begin();
  let rechecks = 0;
  const linked = await f.complete(state, { reauthorize: async () => { rechecks++; return true; } });
  assert.deepEqual(linked, { revision: 1, configured: true, linked: true, linkedAt: 100000, needsRelink: false, queueMerge: false });
  assert.equal(rechecks, 1);
  const persisted = await readFile(f.file, 'utf8'), before = await stat(f.file);
  assert.doesNotMatch(persisted, /Example\+Private|synthetic|refresh|private@example|retain|operator|token|secret/i);
  assert.equal(persisted.includes(SUBJECT), false);
  assert.deepEqual(Object.keys(f.store.read().links[0]).sort(), ['clientHash', 'linkedAt', 'subjectHash', 'userId']);
  for (let i = 0; i < 3; i++) assert.deepEqual(f.service.status(USER), linked);
  assert.deepEqual(f.service.status(OTHER), { ...linked, linked: false, linkedAt: null });
  assert.equal(await readFile(f.file, 'utf8'), persisted); assert.equal((await stat(f.file)).mtimeMs, before.mtimeMs);
  assert.equal(f.calls.length, 2);
  const sentToken = f.calls[0], sentProfile = f.calls[1];
  assert.equal(sentToken.init.method, 'POST'); assert.equal(sentToken.init.redirect, 'error');
  const body = new URLSearchParams(sentToken.init.body);
  assert.equal(body.get('client_id'), f.config.participantNaverClientId); assert.equal(body.get('client_secret'), f.config.participantNaverClientSecret);
  assert.equal(sentProfile.init.headers.Authorization, `Bearer ${TOKEN}`); assert.equal(sentProfile.init.redirect, 'error');
});

test('the same provider account cannot be linked by another Discord participant in one workspace', async t => {
  const f = await fixture(t); await f.complete(f.begin().state);
  const next = f.begin(OTHER);
  await assert.rejects(f.complete(next.state, { userId: OTHER }), { code: 'participant_naver_link_conflict' });
  assert.equal(f.service.status(USER).linked, true); assert.equal(f.service.status(OTHER).linked, false);
  assert.equal(f.store.read().revision, 1);
});

test('provider refusal consumes the nonce once without making a token request', async t => {
  const f = await fixture(t), { state } = f.begin();
  await assert.rejects(f.complete(state, { error: 'access_denied', code: undefined }), /취소/);
  assert.equal(f.service.callbackMatches(state), false); assert.equal(f.calls.length, 0);
  await assert.rejects(f.complete(state), { code: 'participant_naver_link_invalid' });
});

test('expired nonces cannot request tokens and a new begin supersedes the prior request', async t => {
  const f = await fixture(t), first = f.begin(), next = f.begin();
  assert.notEqual(first.state, next.state); assert.equal(f.service.callbackMatches(first.state), false);
  await assert.rejects(f.complete(first.state), { code: 'participant_naver_link_invalid' });
  f.setClock(next.expiresAt);
  assert.equal(f.service.callbackMatches(next.state), false);
  await assert.rejects(f.complete(next.state), { code: 'participant_naver_link_invalid' });
  assert.equal(f.calls.length, 0);
});

test('rate limits apply per authenticated participant and expire without changing persisted identities', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) f.begin();
  assert.throws(() => f.begin(), { status: 429, code: 'participant_naver_link_rate_limit' });
  f.setClock(160001); assert.ok(f.begin().state); assert.equal(f.store.read().revision, 0);
});

for (const [name, override] of [
  ['missing dedicated client ID', { participantNaverClientId: '' }], ['missing dedicated secret', { participantNaverClientSecret: '' }],
  ['invalid key', { naverTokenKey: 'not-a-32-byte-key' }], ['plain HTTP callback', { publicBaseUrl: 'http://bot.example.invalid' }],
  ['credential-bearing callback', { publicBaseUrl: 'https://username:password@bot.example.invalid' }],
  ['control character in credentials', { participantNaverClientSecret: 'bad\nsecret' }],
  ['operator client ID reused', { participantNaverClientId: 'operator-app-must-not-be-used' }]
]) test(`invalid configuration is unavailable with ${name} and never falls back to operator credentials`, async t => {
  const f = await fixture(t, { config: override });
  assert.equal(f.service.status(USER).configured, false);
  assert.throws(() => f.begin(), { code: 'participant_naver_link_not_configured' }); assert.equal(f.calls.length, 0);
});

test('only explicit demo permits a loopback HTTP callback and hexadecimal keys are supported', async t => {
  const f = await fixture(t, { config: { demo: true, publicBaseUrl: 'http://127.0.0.1:43210', naverTokenKey: Buffer.alloc(32, 3).toString('hex') } });
  assert.equal(new URL(f.begin().url).searchParams.get('redirect_uri'), 'http://127.0.0.1:43210/naver/participant/callback');
});

test('changing the client or HMAC key marks the old proof as needing relink, with no write or identity leak', async t => {
  const f = await fixture(t); await f.complete(f.begin().state); const before = f.store.read();
  f.config.participantNaverClientId = 'different-participant-app';
  assert.deepEqual(f.service.status(USER), { revision: 1, configured: true, linked: false, linkedAt: 100000, needsRelink: true, queueMerge: false });
  f.config.participantNaverClientId = 'synthetic-participant-app'; f.config.naverTokenKey = Buffer.alloc(32, 9).toString('base64');
  assert.equal(f.service.status(USER).needsRelink, true); assert.equal(f.service.status(USER).linked, false);
  assert.deepEqual(f.store.read(), before);
});

test('binary HMAC key namespaces preserve all bytes when different keys decode to the same invalid UTF-8 text', async t => {
  const first = Buffer.alloc(32, 0x80), replacement = Buffer.alloc(32, 0x81);
  assert.equal(String(first), String(replacement), 'fixture must reproduce the lossy string coercion collision');
  const f = await fixture(t, { config: { naverTokenKey: first.toString('base64') } });
  await f.complete(f.begin().state); const oldHash = f.store.read().links[0].clientHash;
  f.config.naverTokenKey = replacement.toString('base64');
  assert.equal(f.service.status(USER).needsRelink, true); assert.equal(f.service.status(USER).linked, false);
  await f.complete(f.begin().state);
  assert.notEqual(f.store.read().links[0].clientHash, oldHash); assert.equal(f.service.status(USER).linked, true);
});

test('a configuration or revision change before callback prevents any external request', async t => {
  const f = await fixture(t), first = f.begin();
  f.config.participantNaverClientSecret = 'rotated-participant-secret';
  await assert.rejects(f.complete(first.state), { code: 'participant_naver_link_changed' });
  const second = f.begin(); await f.store.saveLink(row(OTHER, 'other-account'), { revision: 0 });
  await assert.rejects(f.complete(second.state), { code: 'participant_naver_link_changed' });
  assert.equal(f.calls.length, 0);
});

for (const variant of ['newer begin', 'disconnect', 'close', 'configuration change']) test(`${variant} fences a late token response before profile access or persistence`, async t => {
  const gate = deferred(), entered = deferred(); let requests = 0;
  const f = await fixture(t, { fetchImpl: async () => { requests++; entered.resolve(); await gate.promise; return tokenResponse(); } });
  const task = f.complete(f.begin().state); await entered.promise;
  if (variant === 'newer begin') f.begin();
  if (variant === 'disconnect') await f.service.disconnect({ userId: USER, revision: 0 });
  if (variant === 'close') f.service.close();
  if (variant === 'configuration change') f.config.publicBaseUrl = 'https://replacement.example.invalid';
  gate.resolve(); await assert.rejects(task, error => error.code.startsWith('participant_naver_link_'));
  assert.equal(requests, 1); assert.equal(f.store.read().links.length, 0);
});

test('one-use callback cannot be raced to trigger duplicate provider requests', async t => {
  const gate = deferred(), entered = deferred(); let requests = 0;
  const f = await fixture(t, { fetchImpl: async url => { requests++; if (url.includes('/token')) { entered.resolve(); await gate.promise; return tokenResponse(); } return profileResponse(); } });
  const { state } = f.begin(), first = f.complete(state); await entered.promise;
  await assert.rejects(f.complete(state), { code: 'participant_naver_link_invalid' });
  gate.resolve(); await first; assert.equal(requests, 2); assert.equal(f.store.read().revision, 1);
});

test('queued save rechecks generation after unlink, before touching the actual persisted store', async t => {
  const f = await fixture(t), gate = deferred(), saveQueued = deferred();
  f.store.enqueue(() => gate.promise);
  const original = f.store.saveLink.bind(f.store);
  f.store.saveLink = (...args) => { saveQueued.resolve(); return original(...args); };
  const completion = f.complete(f.begin().state); await saveQueued.promise;
  const disconnected = f.service.disconnect({ userId: USER, revision: 0 });
  gate.resolve(); await assert.rejects(completion, { code: 'participant_naver_link_changed' }); await disconnected;
  assert.equal(f.store.read().revision, 0); assert.equal(f.store.read().links.length, 0);
});

test('queued save rechecks the runtime mutation guard and reauthorization failure never creates an identity', async t => {
  const f = await fixture(t), gate = deferred(), saveQueued = deferred(); let paused = false;
  const guard = () => { if (paused) throw Object.assign(Error('internal private runtime path'), { status: 423 }); };
  f.store.enqueue(() => gate.promise);
  const original = f.store.saveLink.bind(f.store);
  f.store.saveLink = (...args) => { saveQueued.resolve(); return original(...args); };
  const completion = f.complete(f.begin().state, { guard }); await saveQueued.promise; paused = true;
  gate.resolve(); await assert.rejects(completion, { status: 423, code: 'participant_naver_link_paused' }); paused = false;
  await assert.rejects(f.complete(f.begin().state, { reauthorize: async () => false }), { status: 403, code: 'participant_naver_link_access' });
  assert.equal(f.store.read().links.length, 0); await f.store.flush();
});

test('concurrent participant callbacks with one revision commit at most one identity', async t => {
  let subjectNumber = 0;
  const f = await fixture(t, { fetchImpl: async url => url.includes('/token') ? tokenResponse() : profileResponse(`different-account-${++subjectNumber}`) });
  const a = f.begin(), b = f.begin(OTHER);
  const results = await Promise.allSettled([f.complete(a.state), f.complete(b.state, { userId: OTHER })]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.find(value => value.status === 'rejected').reason.code, 'participant_naver_link_changed');
  assert.equal(f.store.read().revision, 1); assert.equal(f.store.read().links.length, 1);
});

for (const token of [null, {}, { access_token: 'a', token_type: 42, expires_in: 3600 },
  { access_token: 'a b', token_type: 'bearer', expires_in: 3600 }, { access_token: 'a', token_type: 'bearer', expires_in: 0 },
  { access_token: 'a', token_type: 'bearer', expires_in: true },
  { access_token: 'a', token_type: 'bearer', expires_in: 3600, error: 'invalid_grant' }
]) test(`malformed token response is a safe provider error (${JSON.stringify(token)})`, async t => {
  let requests = 0;
  const f = await fixture(t, { fetchImpl: async () => { requests++; return response(token); } });
  await assert.rejects(f.complete(f.begin().state), { status: 502, code: 'participant_naver_link_provider' });
  assert.equal(requests, 1); assert.equal(f.store.read().links.length, 0);
});

for (const profile of [null, { resultcode: '024', response: { id: SUBJECT } }, { resultcode: '00', response: {} },
  { resultcode: '00', response: { id: 'name@example.invalid' } }, { resultcode: '00', response: { id: 'x'.repeat(65) } }
]) test(`malformed profile cannot become an identity proof (${JSON.stringify(profile)})`, async t => {
  const f = await fixture(t, { fetchImpl: async url => url.includes('/token') ? tokenResponse() : response(profile) });
  await assert.rejects(f.complete(f.begin().state), { status: 502, code: 'participant_naver_link_provider' });
  assert.equal(f.store.read().links.length, 0);
});

for (const [name, makeResponse] of [
  ['HTTP 429', () => new Response('private-provider-message', { status: 429 })],
  ['HTTP 500', () => new Response('private-provider-message', { status: 500 })],
  ['invalid JSON', () => new Response('not-json private-provider-message')],
  ['declared oversized body', () => new Response('{}', { headers: { 'content-length': '65537' } })],
  ['streamed oversized body', () => new Response('x'.repeat(65537))],
  ['invalid UTF-8', () => new Response(new Uint8Array([0xff, 0xfe]))]
]) test(`${name} aborts without retry, storing nothing and hiding raw provider content`, async t => {
  let requests = 0; let signal;
  const f = await fixture(t, { fetchImpl: async (_url, init) => { requests++; signal = init.signal; return makeResponse(); } });
  await assert.rejects(f.complete(f.begin().state), error => {
    assert.doesNotMatch(error.message, /private-provider|65537|synthetic|operator/i);
    return error.code === 'participant_naver_link_provider';
  });
  assert.equal(requests, 1); assert.equal(signal.aborted, true); assert.equal(f.store.read().links.length, 0);
});

test('ten-second request timeout aborts a stuck provider exactly once and consumes the nonce', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0; let signal;
  const f = await fixture(t, { fetchImpl: async (_url, init) => { requests++; signal = init.signal; return new Promise(() => {}); } });
  const { state } = f.begin(), task = f.complete(state);
  const result = assert.rejects(task, { status: 504, code: 'participant_naver_link_timeout' });
  t.mock.timers.tick(10000); await result;
  assert.equal(requests, 1); assert.equal(signal.aborted, true); assert.equal(f.service.callbackMatches(state), false);
  assert.equal(f.store.read().links.length, 0);
});

test('storage faults and corrupt status are safe errors without file paths, tokens or persisted content', async t => {
  const f = await fixture(t), originalSave = f.store.saveLink.bind(f.store);
  f.store.saveLink = async () => { throw Error('C:/private/token-secret.json synthetic-provider-token'); };
  await assert.rejects(f.complete(f.begin().state), error => error.code === 'participant_naver_link_unavailable' && !/private|token|synthetic/.test(error.message));
  f.store.saveLink = originalSave;
  const originalRead = f.store.read.bind(f.store);
  f.store.read = () => { throw Error('C:/private/token-secret.json'); };
  assert.throws(() => f.service.status(USER), { code: 'participant_naver_link_unavailable' });
  f.store.read = () => ({ version: 1, revision: 0, links: [row(), row(OTHER)] });
  assert.throws(() => f.service.status(USER), { code: 'participant_naver_link_unavailable' });
  f.store.read = originalRead;
});

test('disconnect removes only the authenticated private proof, sends no revoke request and rejects stale revisions', async t => {
  const f = await fixture(t); await f.complete(f.begin().state);
  await f.store.saveLink(row(OTHER, 'other'), { revision: 1 });
  await assert.rejects(f.service.disconnect({ userId: USER, revision: 1 }), { code: 'participant_naver_link_changed' });
  const result = await f.service.disconnect({ userId: USER, revision: 2 });
  assert.equal(result.linked, false); assert.equal(result.revision, 3); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.store.read().links, [row(OTHER, 'other')]);
});
