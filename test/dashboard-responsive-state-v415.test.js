import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dashboardContentState, MEMBER_TABLE_LABELS, normalizeContentState } from '../public/dashboard-content-state-v415.js';

test('v4.15.6 content state normalizes known and unknown values',()=>{
  assert.equal(normalizeContentState('loading'),'loading');
  assert.equal(normalizeContentState(' ERROR '),'error');
  assert.equal(normalizeContentState('unexpected'),'idle');
  assert.equal(dashboardContentState('error').retry,true);
});

test('v4.15.6 member table keeps the five visible data labels',()=>{
  assert.deepEqual(MEMBER_TABLE_LABELS,['선택','Discord / 치지직','이터널 리턴','리그 오브 레전드','수정 시간']);
});

test('v4.15.6 dashboard exposes loading/error state and responsive table semantics',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/id="dashboardContentState"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html,/id="dashboardContentStateRetry"/);
  assert.match(html,/class="responsive-member-table"/);
  assert.match(html,/<caption class="sr-only">등록된 Discord·치지직/);
  assert.match(html,/id="memberTableWrap" tabindex="0"/);
});

test('v4.15.6 snapshot refresh uses aria-busy, explicit error state, and manual retry',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/setDashboardBusy\(true\)/);
  assert.match(app,/setDashboardContentState\('loading'\)/);
  assert.match(app,/setDashboardContentState\('error'/);
  assert.match(app,/dashboardContentStateRetry.*refresh\(true\)/);
  assert.match(app,/data-label="\$\{label\(1\)\}"/);
});

test('v4.15.6 CSS converts the member table to labeled cards on small screens and preserves touch readability',async()=>{
  const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:860px\)/);
  assert.match(css,/content:attr\(data-label\)/);
  assert.match(css,/dashboard-content-state\[data-state="error"\]/);
  assert.match(css,/@media\(pointer:coarse\)/);
  assert.match(css,/min-height:44px/);
});
