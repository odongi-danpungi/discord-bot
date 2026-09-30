import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DASHBOARD_TABS } from '../public/dashboard-shell.js';
import { DASHBOARD_COMMAND_CATALOG, commandById, searchDashboardCommands } from '../public/dashboard-command-palette-v415.js';

test('v4.15.2 palette indexes every dashboard tab plus safe quick actions',()=>{
  for(const tab of Object.keys(DASHBOARD_TABS))assert.ok(commandById(`tab-${tab}`),`missing ${tab}`);
  assert.equal(commandById('action-refresh-page').action,'refresh-page');
  assert.equal(commandById('action-refresh-all').action,'refresh-all');
  const serialized=JSON.stringify(DASHBOARD_COMMAND_CATALOG);
  assert.doesNotMatch(serialized,/standalone_draw|no_show|emergency\/lock|release\/apply|responseToken|csrf|password|clientSecret/i);
});

test('v4.15.2 palette finds Korean operational aliases',()=>{
  assert.equal(searchDashboardCommands('복구')[0].target,'recovery');
  assert.equal(searchDashboardCommands('시참')[0].type,'tab');
  assert.ok(searchDashboardCommands('네이버').some(item=>item.target==='settings'));
  assert.ok(searchDashboardCommands('장애').some(item=>item.target==='incidents'));
  assert.ok(searchDashboardCommands('인수인계').some(item=>item.target==='runbook'));
  assert.ok(searchDashboardCommands('runbook').some(item=>item.target==='runbook'));
});

test('v4.15.2 palette finds English and multi-token aliases',()=>{
  assert.equal(searchDashboardCommands('naver oauth')[0].target,'settings');
  assert.ok(searchDashboardCommands('obs overlay').some(item=>item.type==='link'||item.target==='broadcast'));
  assert.ok(searchDashboardCommands('discord intent').some(item=>item.target==='discordaudit'));
});

test('v4.15.2 empty query provides broadcast-safe defaults',()=>{
  const ids=searchDashboardCommands('',{limit:7}).map(item=>item.id);
  assert.deepEqual(ids.slice(0,5),['tab-home','tab-live','tab-operate','action-refresh-page','external-mobile']);
});

test('v4.15.2 dashboard markup exposes accessible command palette and shortcut',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="commandPaletteOpen"/);assert.match(html,/id="commandPalette" hidden aria-hidden="true"/);assert.match(html,/role="dialog"/);assert.match(html,/role="listbox"/);assert.match(html,/Ctrl K/);
  assert.match(app,/event\.ctrlKey\|\|event\.metaKey/);assert.match(app,/ArrowDown/);assert.match(app,/ArrowUp/);assert.match(app,/executeCommandPalette/);
});
