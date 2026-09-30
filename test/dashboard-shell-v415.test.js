import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DASHBOARD_TABS, dashboardMeta, dashboardShortcut, dashboardTabFromHash, normalizeDashboardTab } from '../public/dashboard-shell.js';

test('v4.15 dashboard shell normalizes deep links and rejects unknown tabs',()=>{
  assert.equal(dashboardTabFromHash('#live'),'live');
  assert.equal(dashboardTabFromHash('#RUNTIME'),'runtime');
  assert.equal(dashboardTabFromHash('#not-a-real-page'),'home');
  assert.equal(normalizeDashboardTab(' members '),'members');
});

test('v4.15 dashboard shell metadata covers every existing admin tab',()=>{
  const expected=['home','preflight','runbook','broadcastarchive','live','operate','broadcast','members','history','recovery','runtime','incidents','capacity','deployment','release','supply','discordaudit','settings'];
  assert.deepEqual(Object.keys(DASHBOARD_TABS),expected);
  assert.equal(dashboardMeta('release').section,'배포·보안');
  assert.equal(dashboardMeta('home').title,'방송 운영 대시보드');
  assert.equal(dashboardMeta('operate').title,'시참 컨트롤 센터');
});

test('v4.15 shortcuts require Alt only and map common broadcast pages',()=>{
  assert.equal(dashboardShortcut({altKey:true,ctrlKey:false,metaKey:false,shiftKey:false,key:'0'}),'home');
  assert.equal(dashboardShortcut({altKey:true,ctrlKey:false,metaKey:false,shiftKey:false,key:'1'}),'live');
  assert.equal(dashboardShortcut({altKey:true,ctrlKey:false,metaKey:false,shiftKey:false,key:'2'}),'operate');
  assert.equal(dashboardShortcut({altKey:true,ctrlKey:false,metaKey:false,shiftKey:false,key:'3'}),'broadcast');
  assert.equal(dashboardShortcut({altKey:true,ctrlKey:true,metaKey:false,shiftKey:false,key:'1'}),null);
});

test('v4.15 dashboard markup keeps all functional tabs and responsive controls',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const tab of Object.keys(DASHBOARD_TABS))assert.match(html,new RegExp(`data-tab=["']${tab}["']`));
  assert.match(html,/id="sidebarToggle"/);assert.match(html,/id="sidebarBackdrop"/);assert.match(html,/id="pageContext"/);assert.match(html,/id="sidebarVersion"/);
  assert.doesNotMatch(html,/v4\.14\.3 · Concurrent Live Control Safety Step 4/);
});
