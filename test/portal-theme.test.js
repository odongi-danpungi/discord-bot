import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL('../public/' + file, import.meta.url), 'utf8');

test('portal dark mode uses black surfaces and keeps the Sage accent', async () => {
  const css = await read('portal.css'), block = css.match(/:root\[data-theme="dark"\]\{([^}]*)\}/)?.[1] || '';
  assert.match(block, /--bg:#0b0b0c/); assert.match(block, /--panel:#151517/); assert.match(block, /--accent:#456b59/);
  assert.doesNotMatch(block, /--bg:#0f1814|--panel:#16231d/i, 'no dark green surfaces');
  assert.match(css, /:root\{--bg:#e9eee7;/, 'the light Sage tokens stay the default');
});

test('the portal offers a dark mode switch and remembers the choice per browser', async () => {
  const html = await read('portal.html'), js = await read('portal.js');
  assert.match(html, /<button id="theme-toggle"[^>]*aria-pressed="false">다크 모드<\/button>/);
  assert.match(js, /localStorage\.setItem\('dd-portal-theme',next\)/);
  assert.match(js, /prefers-color-scheme: dark/);
});
