import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

// Sage workspace UI unification: one logo, one palette, no creator entry in user screens.
const read = name => readFile(new URL('../public/' + name, import.meta.url), 'utf8');
const logoPath = async () => (await read('brand-logo.svg')).match(/\sd="([^"]+)"/)[1];
const branded = ['portal.html', 'workspace-admin.html', 'roulette.html', 'login.html', 'operation-tools.html', 'practice.html'];
const sageTokens = ['--bg:#e9eee7', '--panel:#f5f7f1', '--text:#25372c', '--muted:#5b6e60', '--line:#cdd7ca', '--accent:#456b59'];

test('every unified page renders the original logo from the shared drawing instead of an emoji mark', async () => {
  const d = await logoPath();
  assert.ok(d.length > 1000, 'logo path must be the traced drawing, not a placeholder');
  for (const name of branded) {
    const doc = new JSDOM(await read(name)).window.document;
    const mark = doc.querySelector('.brand-mark');
    assert.ok(mark, name + ' must show the logo');
    assert.equal(mark.getAttribute('aria-hidden'), 'true', name + ' logo is decorative next to the product name');
    assert.equal(mark.querySelector('path').getAttribute('d'), d, name + ' must use the same logo drawing');
    assert.match(doc.querySelector('.brand-text strong').textContent, /댕댕봇/);
    assert.doesNotMatch(doc.querySelector('.brand').textContent, /🐾/);
  }
});

test('sage tokens are shared by portal, roulette and login stylesheets', async () => {
  for (const name of ['portal.css', 'roulette.css', 'login.css']) {
    const css = await read(name);
    for (const token of sageTokens) assert.ok(css.includes(token), `${name} must define ${token}`);
    assert.doesNotMatch(css, /#3567dc|#3265ca|#665b83/i, `${name} must not keep the previous blue or purple chrome colors`);
  }
});

test('user portal does not link to creator login or creator tools', async () => {
  const html = await read('portal.html');
  assert.doesNotMatch(html, /href="\/auth\/login"|href="\/creator|제작자 관리/);
});

test('portal marks only the selected leaf as the current page and keeps its parents open', async t => {
  const A = '111111111111111111';
  const html = await read('portal.html'), source = await read('portal.js');
  const errors = [], virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, { url: 'https://example.invalid/portal/?server=' + A, runScripts: 'outside-only', virtualConsole });
  t.after(async () => { await new Promise(r => setTimeout(r, 20)); for (const n of dom.window.document.querySelectorAll('details')) n.ontoggle = null; dom.window.close(); assert.deepEqual(errors, []); });
  const data = url => url === '/portal/auth/session' ? { authenticated: true, user: { name: '가상 운영자' }, csrf: 'fixture' }
    : url === '/portal/api/servers' ? { servers: [{ id: A, name: '봄별 방송', botPresent: true }] }
      : url.startsWith('/portal/api/servers/') ? { guildId: A, name: '봄별 방송', role: 'operator' }
        : url.endsWith('/api/snapshot') ? { state: { session: null }, participationQueue: { activeCount: 0 }, paused: false } : {};
  dom.window.fetch = url => Promise.resolve({ ok: true, json: async () => structuredClone(data(url)) });
  dom.window.newPractice = () => ({}); dom.window.practiceAction = () => ({});
  await dom.window.eval('(async()=>{' + source.replace(/^import \{newPractice,practiceAction\} from '\.\/practice-model\.js';\r?\n/, '') + ';globalThis.portalTest={page};})()');
  await dom.window.portalTest.page('roulette');
  const doc = dom.window.document;
  const current = [...doc.querySelectorAll('[data-page][aria-current="page"]')];
  assert.deepEqual(current.map(b => b.dataset.page), ['roulette']);
  assert.equal(current[0].parentElement.open, true);
  assert.equal(current[0].parentElement.parentElement.open, true);
  assert.equal(doc.getElementById('breadcrumb').textContent, '방송 / 룰렛 / 직접 입력 룰렛');
  await dom.window.portalTest.page('queue');
  assert.deepEqual([...doc.querySelectorAll('[aria-current="page"]')].map(b => b.dataset.page), ['queue']);
  assert.equal([...doc.querySelectorAll('#menu>details')].filter(d => d.open).length, 1, 'only the selected top group stays expanded');
});
