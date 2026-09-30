import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DASHBOARD_TABS, dashboardMeta, dashboardShortcut, dashboardTabFromHash } from '../public/dashboard-shell.js';
import { buildDashboardHomeModel } from '../public/dashboard-home-v415.js';
import { DASHBOARD_COMMAND_CATALOG, searchDashboardCommands } from '../public/dashboard-command-palette-v415.js';
import { createDashboardFeedback, sanitizeFeedbackMessage } from '../public/dashboard-feedback-v415.js';
import { dashboardContentState } from '../public/dashboard-content-state-v415.js';
import { isEditableShortcutTarget, pageChangeAnnouncement } from '../public/dashboard-accessibility-v415.js';

const now=1_800_000_000_000;

test('v4.15 final: home, shell, command palette and deep links share the same safe dashboard navigation model',()=>{
  assert.equal(dashboardTabFromHash('#home'),'home');
  assert.equal(dashboardTabFromHash('#runtime'),'runtime');
  assert.equal(dashboardShortcut({altKey:true,ctrlKey:false,metaKey:false,shiftKey:false,key:'0'}),'home');
  for(const tab of Object.keys(DASHBOARD_TABS)){
    const meta=dashboardMeta(tab);
    assert.ok(meta.title,`missing title for ${tab}`);
    assert.ok(DASHBOARD_COMMAND_CATALOG.some(item=>item.id===`tab-${tab}`),`palette missing ${tab}`);
  }
  assert.equal(searchDashboardCommands('복구')[0].target,'recovery');
  assert.ok(searchDashboardCommands('네이버').some(item=>item.target==='settings'));
});

test('v4.15 final: home recommendation prioritizes incident/recovery safety without exposing queue or credential secrets',()=>{
  const model=buildDashboardHomeModel({
    now,
    state:{session:{round:9,phase:'checking',game:'lol',mode:'aram',count:10,applicants:['u1'],winners:[],confirmed:[]}},
    derived:{active:true,readyCount:1,missingCount:0,pendingCount:0,postponedCount:0},
    participationQueue:{activeCount:1,entries:[{id:'q1',displayName:'방울이',status:'called',source:'discord',position:1,responseToken:'call-secret',discordUserId:'123'}],currentCall:{id:'q1',displayName:'방울이',source:'discord',callDeadline:now+20_000,responseToken:'call-secret'}},
    incidentSummary:{counts:{critical:1,open:1,totalActive:1}},
    emergency:{locked:false},
    health:{connected:true,runtimeStatus:'warn',capacityStatus:'pass'},
    liveState:'live'
  });
  assert.equal(model.recommendation.target,'incidents');
  const serialized=JSON.stringify(model);
  assert.doesNotMatch(serialized,/call-secret|responseToken|discordUserId/);

  const locked=buildDashboardHomeModel({state:{session:null},emergency:{locked:true,reason:'복구 검증'},health:{connected:true},liveState:'offline'});
  assert.equal(locked.recommendation.target,'recovery');
});

test('v4.15 final: feedback and content-state layers stay display-only and redact credential-shaped values',()=>{
  const message=sanitizeFeedbackMessage('Authorization: Bearer abc.def secret=my-secret csrf=csrf-token');
  assert.doesNotMatch(message,/abc\.def|my-secret|csrf-token/);
  assert.match(message,/REDACTED/);
  const feedback=createDashboardFeedback({tone:'error',message});
  assert.equal(feedback.tone,'error');
  assert.equal(dashboardContentState('error').retry,true);
  assert.equal(dashboardContentState('loading').retry,false);
});

test('v4.15 final: keyboard accessibility does not steal shortcuts from editable controls and announces page changes',()=>{
  assert.equal(isEditableShortcutTarget({tagName:'INPUT'}),true);
  assert.equal(isEditableShortcutTarget({tagName:'TEXTAREA'}),true);
  assert.equal(isEditableShortcutTarget({tagName:'SELECT'}),true);
  assert.equal(isEditableShortcutTarget({tagName:'BUTTON'}),false);
  assert.equal(pageChangeAnnouncement({section:'방송 운영',title:'방송 운영 대시보드'}),'방송 운영 · 방송 운영 대시보드 화면으로 이동했습니다.');
});

test('v4.15 final: dashboard markup keeps all final UX safety surfaces together without destructive palette actions',async()=>{
  const [html,app,css]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/style.css',import.meta.url),'utf8')
  ]);
  assert.match(html,/class="skip-link"[^>]+href="#mainContent"/);
  for(const id of ['dashboardContentState','dashboardContentStateRetry','unsavedChanges','commandPaletteOpen','commandPalette','toastStack','dashboardA11yStatus','memberTableWrap']){
    assert.match(html,new RegExp(`id=["']${id}["']`),`missing ${id}`);
  }
  assert.match(html,/data-page="home"/);
  assert.match(html,/class="responsive-member-table"/);
  assert.match(app,/confirmDashboardNavigation/);
  assert.match(app,/setDashboardContentState\('error'/);
  assert.match(app,/isEditableShortcutTarget/);
  assert.match(css,/@media\(max-width:860px\)/);
  assert.match(css,/prefers-reduced-motion/);
  const catalog=JSON.stringify(DASHBOARD_COMMAND_CATALOG);
  assert.doesNotMatch(catalog,/standalone_draw|no_show|emergency\/lock|release\/apply|release\/rollback|naver.*disconnect|password|csrf|secret/i);
});
