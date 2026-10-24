import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { DEFAULT_AVATAR } from '../public/avatar.js';

const NOW = Date.UTC(2026, 9, 15, 3);
const result = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) });
const status = overrides => ({ revision: 3, configured: true, linked: false, linkedAt: null, needsRelink: false, queueMerge: false, ...overrides });
const inactive = () => ({ serverTime: NOW, session: null, recruitment: { status: 'inactive', reason: 'no_session', maxApplicants: null, activeApplicants: 0, remainingSlots: null, unlimited: false, closeAt: 0, drawCount: 0, duplicatePolicy: null }, queue: {}, reservations: [], actions: {} });
const authorization = overrides => ({ url: 'https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=fixture-client&state='+'s'.repeat(43)+'&redirect_uri=https%3A%2F%2Fexample.invalid%2Fnaver%2Fparticipant%2Fcallback', expiresAt: NOW + 600000, ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function viewer(t, { link = status(), fetcher, appUrl = 'https://example.invalid/viewer/' } = {}) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (!error.message.includes('Not implemented: navigation to another Document')) errors.push(error); });
  const dom = new JSDOM(await readFile(new URL('../public/viewer.html', import.meta.url), 'utf8'), { url: appUrl, runScripts: 'outside-only', virtualConsole });
  const w = dom.window, calls = [], intervals = [], navigations = [];
  let current = link;
  w.Date.now = () => NOW; w.DEFAULT_AVATAR = DEFAULT_AVATAR; w.mountViewerCommunity = () => {}; w.requestAnimationFrame = () => 1;
  w.setInterval = (fn, delay) => { intervals.push({ fn, delay }); return intervals.length; };
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  w.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const override = fetcher?.(url, options);
    if (override !== undefined) return override;
    return result(url.endsWith('/me') ? { name: '가상 참가자', avatar: DEFAULT_AVATAR, revision: 1, csrf: 'fixture-csrf' } :
      url.endsWith('/account-link') ? current : url.endsWith('/participation') ? inactive() : url.endsWith('/ready-check') ? { check: null } :
      url.endsWith('/mode') ? { demo: false } : { poll: null });
  };
  t.after(() => { w.close(); assert.deepEqual(errors, [], 'viewer must not raise unhandled DOM errors'); });
  const source = (await readFile(new URL('../public/viewer.js', import.meta.url), 'utf8')).replace(/^import .*;\r?$/gm, '');
  w.captureNavigation = url => navigations.push(url);
  w.eval(source + '\nnavigateAccountLink=window.captureNavigation;');
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  const get = id => w.document.getElementById(id);
  const consent = () => { get('accountLinkConsent').checked = true; get('accountLinkConsent').dispatchEvent(new w.Event('change')); };
  return { w, calls, intervals, navigations, settle, get, consent, setStatus: value => { current = value; }, posts: () => calls.filter(call => call.options.method === 'POST') };
}

test('participant account link is one collapsed read-only panel with explicit scope and no additional poll', async t => {
  const ui = await viewer(t), panel = ui.get('viewerAccountLink');
  assert.equal(panel.hidden, false); assert.equal(panel.open, false); assert.equal(panel.dataset.state, 'unlinked');
  assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.get('accountLinkConsent').checked, false);
  assert.match(panel.textContent, /카페 가입이나 게시글 작성자 신원이 확인되지는 않습니다/);
  assert.match(panel.textContent, /대기열은 자동으로 합쳐지지 않습니다/);
  assert.match(panel.textContent, /카페 운영용 네이버 계정과는 별도/);
  assert.equal(ui.calls.filter(call => call.url === '/viewer/api/account-link').length, 1); assert.equal(ui.posts().length, 0);
  assert.deepEqual(ui.intervals.map(item => item.delay), [10000, 1000]);
  for (const item of ui.intervals) item.fn(); await ui.settle();
  assert.equal(ui.calls.filter(call => call.url === '/viewer/api/account-link').length, 1, 'existing participation and poll timers must not poll the identity service');
  assert.equal(panel.nextElementSibling.id, 'viewerPoll');
});

test('connection requires explicit consent and posts only the displayed revision before official navigation', async t => {
  const ui = await viewer(t, { fetcher: url => url.endsWith('/account-link/start') ? result(authorization()) : undefined });
  await ui.get('accountLinkStart').onclick(); assert.equal(ui.posts().length, 0);
  ui.consent(); assert.equal(ui.get('accountLinkStart').disabled, false); await ui.get('accountLinkStart').onclick();
  assert.equal(ui.posts().length, 1);
  assert.deepEqual(JSON.parse(ui.posts()[0].options.body), { revision: 3, consent: true });
  assert.equal(ui.posts()[0].options.headers['X-CSRF-Token'], 'fixture-csrf'); assert.ok(ui.posts()[0].options.headers['Idempotency-Key']);
  assert.deepEqual(ui.navigations, [authorization().url]);
});

test('current linked, reauthorization and unconfigured states expose only their appropriate actions', async t => {
  const ui = await viewer(t, { link: status({ linked: true, linkedAt: NOW - 1 }) });
  assert.equal(ui.get('viewerAccountLink').dataset.state, 'linked'); assert.equal(ui.get('accountLinkStart').hidden, true); assert.equal(ui.get('accountLinkDisconnect').hidden, false);
  ui.setStatus(status({ needsRelink: true, linkedAt: NOW - 1 })); await ui.get('accountLinkRefresh').onclick();
  assert.equal(ui.get('viewerAccountLink').dataset.state, 'relink'); assert.match(ui.get('accountLinkState').textContent, /再|다시 연결/); assert.equal(ui.get('accountLinkStart').hidden, false); assert.equal(ui.get('accountLinkDisconnect').hidden, false);
  ui.consent(); assert.equal(ui.get('accountLinkStart').disabled, false);
  ui.setStatus(status({ configured: false })); await ui.get('accountLinkRefresh').onclick();
  assert.equal(ui.get('viewerAccountLink').dataset.state, 'unconfigured'); assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.get('accountLinkDisconnect').hidden, true); assert.equal(ui.get('accountLinkConsent').checked, false);
  await ui.get('accountLinkStart').onclick(); assert.equal(ui.posts().length, 0);
});

test('disconnect needs its own confirmation and does not call participant or operator mutations', async t => {
  const ui = await viewer(t, { link: status({ linked: true, linkedAt: NOW - 1 }), fetcher: url => url.endsWith('/account-link/disconnect') ? result(status({ revision: 4 })) : undefined });
  await ui.get('accountLinkConfirmDisconnect').onclick(); assert.equal(ui.posts().length, 0);
  ui.get('accountLinkDisconnect').click(); assert.equal(ui.get('accountLinkConfirm').hidden, false); assert.match(ui.get('accountLinkConfirm').textContent, /기존 참가 순서와 예약은 그대로 유지/);
  ui.get('accountLinkCancelDisconnect').click(); assert.equal(ui.get('accountLinkConfirm').hidden, true); assert.equal(ui.posts().length, 0);
  ui.get('accountLinkDisconnect').click(); await ui.get('accountLinkConfirmDisconnect').onclick();
  assert.equal(ui.posts().length, 1); assert.equal(ui.posts()[0].url, '/viewer/api/account-link/disconnect'); assert.deepEqual(JSON.parse(ui.posts()[0].options.body), { revision: 3, confirm: true });
  assert.equal(ui.get('viewerAccountLink').dataset.state, 'unlinked'); assert.equal(ui.get('accountLinkConfirm').hidden, true); assert.match(ui.get('accountLinkStatus').textContent, /해제했습니다/);
});

test('malformed status fails closed without rendering returned identity or enabling a stale action', async t => {
  const ui = await viewer(t); ui.consent(); const staleStart = ui.get('accountLinkStart').onclick;
  for (const invalid of [null, [], {}, status({ revision: -1 }), status({ revision: '3' }), status({ configured: 'true' }), status({ linked: 'false' }), status({ linkedAt: 0 }), status({ linked: true }), status({ linkedAt: '1' }), status({ needsRelink: null }), status({ queueMerge: true })]) {
    ui.setStatus(invalid); await ui.get('accountLinkRefresh').onclick();
    assert.equal(ui.get('viewerAccountLink').dataset.state, 'unknown'); assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.get('accountLinkDisconnect').hidden, true); await staleStart();
  }
  ui.setStatus({ ...status({ revision: null }), displayName: '<img src=x onerror=alert(1)>', token: 'private-fixture-marker' }); await ui.get('accountLinkRefresh').onclick();
  assert.doesNotMatch(ui.get('viewerAccountLink').textContent, /private-fixture-marker|<img|onerror/); assert.equal(ui.get('viewerAccountLink').querySelector('img'), null); assert.equal(ui.posts().length, 0);
});

test('a failed status read clears consent and only a later valid GET enables connection again', async t => {
  let failed = false; const ui = await viewer(t, { fetcher: url => url.endsWith('/account-link') && failed ? Promise.reject(Error('private-storage-path')) : undefined });
  ui.consent(); failed = true; await ui.get('accountLinkRefresh').onclick();
  assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.get('accountLinkConsent').checked, false); assert.doesNotMatch(ui.get('viewerAccountLink').textContent, /private-storage-path/);
  failed = false; await ui.get('accountLinkRefresh').onclick(); assert.equal(ui.get('viewerAccountLink').dataset.state, 'unlinked'); assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.posts().length, 0);
});

test('legacy and unauthorized account-link endpoints hide the optional panel', async t => {
  for (const httpStatus of [404, 401, 403]) {
    const ui = await viewer(t, { fetcher: url => url.endsWith('/account-link') ? result({ error: 'private-server-detail' }, httpStatus) : undefined });
    assert.equal(ui.get('viewerAccountLink').hidden, true); assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.posts().length, 0); assert.doesNotMatch(ui.w.document.body.textContent, /private-server-detail/);
  }
});

test('failed connection requests block all writes until an explicit status-only refresh', async t => {
  let failed = true; const ui = await viewer(t, { fetcher: url => url.endsWith('/account-link/start') && failed ? Promise.reject(Error('private-connect-detail')) : undefined });
  ui.consent(); await ui.get('accountLinkStart').onclick(); assert.equal(ui.posts().length, 1); assert.equal(ui.get('viewerAccountLink').dataset.state, 'unknown'); assert.equal(ui.get('accountLinkStart').disabled, true);
  await ui.get('accountLinkStart').onclick(); ui.get('accountLinkDisconnect').click(); await ui.get('accountLinkConfirmDisconnect').onclick(); assert.equal(ui.posts().length, 1);
  assert.doesNotMatch(ui.get('accountLinkStatus').textContent, /private-connect-detail/); failed = false; await ui.get('accountLinkRefresh').onclick();
  assert.equal(ui.posts().length, 1, 'refresh must never replay a connection request'); assert.equal(ui.get('viewerAccountLink').dataset.state, 'unlinked'); assert.equal(ui.get('accountLinkConsent').checked, false); assert.equal(ui.get('accountLinkStart').disabled, true);
});

test('malformed or lost disconnect results remain unknown until GET confirms the actual status', async t => {
  const ui = await viewer(t, { link: status({ linked: true, linkedAt: NOW - 1 }), fetcher: url => url.endsWith('/account-link/disconnect') ? result({ linked: false, privateData: 'private-disconnect-detail' }) : undefined });
  ui.get('accountLinkDisconnect').click(); await ui.get('accountLinkConfirmDisconnect').onclick();
  assert.equal(ui.get('viewerAccountLink').dataset.state, 'unknown'); assert.equal(ui.get('accountLinkDisconnect').hidden, true); assert.equal(ui.get('accountLinkConfirm').hidden, true); assert.doesNotMatch(ui.get('accountLinkStatus').textContent, /해제했습니다|private-disconnect-detail/);
  ui.setStatus(status({ revision: 4 })); await ui.get('accountLinkRefresh').onclick(); assert.equal(ui.get('viewerAccountLink').dataset.state, 'unlinked'); assert.equal(ui.posts().length, 1);
});

test('authorization response accepts only a current fixed Naver endpoint and this apps callback', async t => {
  const response = authorization(); let outgoing = response;
  const ui = await viewer(t, { fetcher: url => url.endsWith('/account-link/start') ? result(outgoing) : undefined });
  const changedUrl = change => { const url = new URL(response.url); change(url); return url.href; };
  const invalid = [authorization({ expiresAt: NOW }), authorization({ expiresAt: 'later' }), authorization({ url: 'javascript:alert(1)' }),
    authorization({ url: changedUrl(url => { url.hostname = 'nid.naver.com.example.invalid'; }) }),
    authorization({ url: changedUrl(url => { url.protocol = 'http:'; }) }), authorization({ url: changedUrl(url => { url.port = '8443'; }) }),
    authorization({ url: changedUrl(url => { url.pathname = '/unapproved'; }) }), authorization({ url: changedUrl(url => { url.username = 'fixture'; }) }),
    authorization({ url: changedUrl(url => { url.hash = 'fragment'; }) }), authorization({ url: changedUrl(url => { url.searchParams.set('response_type', 'token'); }) }),
    authorization({ url: changedUrl(url => { url.searchParams.delete('state'); }) }), authorization({ url: changedUrl(url => { url.searchParams.delete('client_id'); }) }),
    authorization({ url: changedUrl(url => { url.searchParams.set('state', 'short'); }) }), authorization({ url: changedUrl(url => { url.searchParams.set('state', 's'.repeat(42)+'%'); }) }),
    authorization({ url: changedUrl(url => { url.searchParams.set('client_id', ' '); }) }), authorization({ url: changedUrl(url => { url.searchParams.set('client_id', 'c'.repeat(4097)); }) }),
    authorization({ url: changedUrl(url => { url.searchParams.append('redirect_uri', 'https://other.invalid/naver/participant/callback'); }) }),
    authorization({ url: changedUrl(url => { url.searchParams.append('state', 's'.repeat(43)); }) }), authorization({ url: changedUrl(url => { url.searchParams.set('unrecognized', 'extra'); }) }),
    ...['https://example.invalid/naver/callback', 'http://example.invalid/naver/participant/callback', 'https://other.invalid/naver/participant/callback', 'https://example.invalid/naver/participant/callback?extra=1', 'https://example.invalid/naver/participant/callback#fragment'].map(redirect => authorization({ url: changedUrl(url => { url.searchParams.set('redirect_uri', redirect); }) }))];
  for (outgoing of invalid) {
    await ui.get('accountLinkRefresh').onclick(); ui.consent(); await ui.get('accountLinkStart').onclick();
    assert.equal(ui.get('viewerAccountLink').dataset.state, 'unknown'); assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.navigations.length, 0);
  }
  outgoing = response; await ui.get('accountLinkRefresh').onclick(); ui.consent(); await ui.get('accountLinkStart').onclick(); assert.deepEqual(ui.navigations, [response.url]);
});

test('local HTTP callback is limited to this apps loopback origin while Naver stays HTTPS', async t => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const appUrl = `http://${host}:4567/viewer/`, url = new URL(authorization().url); url.searchParams.set('redirect_uri', `http://${host}:4567/naver/participant/callback`);
    const ui = await viewer(t, { appUrl, fetcher: request => request.endsWith('/account-link/start') ? result(authorization({ url: url.href })) : undefined });
    ui.consent(); await ui.get('accountLinkStart').onclick(); assert.deepEqual(ui.navigations, [url.href]);
  }
  const url = new URL(authorization().url); url.searchParams.set('redirect_uri', 'http://example.invalid/naver/participant/callback');
  const ui = await viewer(t, { appUrl: 'http://example.invalid/viewer/', fetcher: request => request.endsWith('/account-link/start') ? result(authorization({ url: url.href })) : undefined });
  ui.consent(); await ui.get('accountLinkStart').onclick(); assert.equal(ui.navigations.length, 0); assert.equal(ui.get('viewerAccountLink').dataset.state, 'unknown');
});

test('busy start and disconnect controls cannot duplicate writes while their requests are pending', async t => {
  const pending = deferred(), ui = await viewer(t, { fetcher: url => url.endsWith('/account-link/start') ? pending.promise : undefined });
  ui.consent(); const action = ui.get('accountLinkStart').onclick(); assert.equal(ui.get('accountLinkStart').disabled, true); assert.equal(ui.get('accountLinkRefresh').disabled, true);
  await ui.get('accountLinkStart').onclick(); await ui.get('accountLinkRefresh').onclick(); assert.equal(ui.posts().length, 1); pending.resolve(result(authorization())); await action; assert.equal(ui.navigations.length, 1);
  ui.setStatus(status({ linked: true, linkedAt: NOW - 1 })); await ui.get('accountLinkRefresh').onclick(); const disconnect = deferred();
  ui.w.fetch = async (url, options = {}) => { ui.calls.push({ url, options }); return disconnect.promise; };
  ui.get('accountLinkDisconnect').click(); const removing = ui.get('accountLinkConfirmDisconnect').onclick(); await ui.get('accountLinkConfirmDisconnect').onclick(); ui.get('accountLinkCancelDisconnect').click();
  assert.equal(ui.posts().length, 2); assert.equal(ui.get('accountLinkConfirm').hidden, false); disconnect.resolve(result(status({ revision: 4 }))); await removing;
});

test('logout discards a delayed connection action before it can navigate or restore participant data', async t => {
  const pending = deferred(), logout = deferred();
  const ui = await viewer(t, { fetcher: url => url.endsWith('/account-link/start') ? pending.promise : url.endsWith('/logout') ? logout.promise : undefined });
  ui.consent(); const action = ui.get('accountLinkStart').onclick(), leaving = ui.get('logout').onclick();
  assert.equal(ui.get('viewerAccountLink').hidden, true); assert.equal(ui.get('editor').hidden, true); assert.equal(ui.get('login').hidden, false);
  pending.resolve(result(authorization())); await action; assert.equal(ui.navigations.length, 0); assert.equal(ui.get('viewerAccountLink').hidden, true);
  logout.reject(Error('private-logout-detail')); await leaving; assert.doesNotMatch(ui.w.document.body.textContent, /private-logout-detail/); assert.equal(ui.get('viewerAccountLink').hidden, true);
});

test('an expired viewer session discards a late account status response', async t => {
  let participationExpired = false, pending;
  const ui = await viewer(t, { fetcher: url => url.endsWith('/account-link') && pending ? pending.promise : url.endsWith('/participation') && participationExpired ? result({ error: 'expired' }, 401) : undefined });
  pending = deferred(); const reading = ui.get('accountLinkRefresh').onclick(); participationExpired = true; await ui.get('participationRefresh').onclick();
  assert.equal(ui.get('viewerAccountLink').hidden, true); assert.equal(ui.get('editor').hidden, true);
  pending.resolve(result(status({ linked: true, linkedAt: NOW - 1 }))); await reading;
  assert.equal(ui.get('viewerAccountLink').hidden, true); assert.equal(ui.get('accountLinkState').textContent.includes('연결되어 있습니다'), false); assert.equal(ui.posts().length, 0);
});

test('a login for a newer participant invalidates an earlier pending account result', async t => {
  let pending;
  const ui = await viewer(t, { fetcher: (url, options) => url.endsWith('/account-link') && pending ? pending.promise : url.endsWith('/login') && options.method === 'POST' ? result({ ok: true }) : undefined });
  pending = deferred(); const oldRead = ui.get('accountLinkRefresh').onclick(); const oldPending = pending; pending = null; ui.setStatus(status({ revision: 9 }));
  ui.get('code').value = 'fixture-new-session'; await ui.get('loginButton').onclick(); assert.equal(ui.get('viewerAccountLink').dataset.state, 'unlinked');
  oldPending.resolve(result(status({ linked: true, linkedAt: NOW - 1 }))); await oldRead;
  assert.equal(ui.get('viewerAccountLink').dataset.state, 'unlinked'); assert.equal(ui.get('accountLinkConsent').checked, false); assert.equal(ui.navigations.length, 0);
});
