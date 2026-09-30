import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('dashboard exposes a dedicated broadcast preflight page and navigation entry',async()=>{
  const [html,shell,palette]=await Promise.all([read('public/index.html'),read('public/dashboard-shell.js'),read('public/dashboard-command-palette-v415.js')]);
  assert.match(html,/data-tab="preflight"/);
  assert.match(html,/data-page="preflight"/);
  for(const id of ['preflightHero','preflightOverall','preflightChecklist','preflightRefresh','preflightNextButton','homePreflight'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(shell,/preflight:\{title:'방송 시작 전 점검'/);
  assert.match(palette,/preflight:\['방송 준비','사전 점검'/);
});

test('dashboard preflight is read-only and refreshes through GET only',async()=>{
  const app=await read('public/app.js');
  assert.match(app,/request\('\/api\/broadcast-preflight'\)/);
  assert.doesNotMatch(app,/request\('\/api\/broadcast-preflight',\{/);
  assert.match(app,/if\(activeTab==='preflight'\)return preflightRefresh\(\)/);
});

test('server snapshot and manual endpoint both expose broadcast preflight',async()=>{
  const app=await read('src/app.js');
  assert.match(app,/broadcastPreflight:broadcastPreflightSnapshot\(\)/);
  assert.match(app,/app\.get\('\/api\/broadcast-preflight'/);
  assert.match(app,/buildBroadcastPreflight/);
});
