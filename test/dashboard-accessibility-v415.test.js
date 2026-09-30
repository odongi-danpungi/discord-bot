import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isEditableShortcutTarget, pageChangeAnnouncement, trapTabKey } from '../public/dashboard-accessibility-v415.js';

test('v4.15.5 global shortcuts ignore editable controls',()=>{
  assert.equal(isEditableShortcutTarget({tagName:'INPUT'}),true);
  assert.equal(isEditableShortcutTarget({tagName:'TEXTAREA'}),true);
  assert.equal(isEditableShortcutTarget({tagName:'SELECT'}),true);
  assert.equal(isEditableShortcutTarget({tagName:'DIV',isContentEditable:true}),true);
  assert.equal(isEditableShortcutTarget({tagName:'BUTTON'}),false);
});

test('v4.15.5 page announcements preserve section and page title',()=>{
  assert.equal(pageChangeAnnouncement({section:'시스템 상태',title:'런타임·장애 센터'}),'시스템 상태 · 런타임·장애 센터 화면으로 이동했습니다.');
});

test('v4.15.5 focus trap cycles at both dialog boundaries',()=>{
  const calls=[];
  const first={focus:()=>calls.push('first'),getAttribute:()=>null,closest:()=>null};
  const last={focus:()=>calls.push('last'),getAttribute:()=>null,closest:()=>null};
  const container={querySelectorAll:()=>[first,last],focus:()=>calls.push('container')};
  let prevented=0;
  assert.equal(trapTabKey(container,{key:'Tab',shiftKey:false,preventDefault:()=>prevented++},{activeElement:last}),true);
  assert.equal(trapTabKey(container,{key:'Tab',shiftKey:true,preventDefault:()=>prevented++},{activeElement:first}),true);
  assert.deepEqual(calls,['first','last']);assert.equal(prevented,2);
});

test('v4.15.5 dashboard exposes skip link, live announcements, labels, and focus management',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(html,/class="skip-link" href="#mainContent"/);
  assert.match(html,/id="mainContent" tabindex="-1"/);
  assert.match(html,/id="dashboardA11yStatus" role="status" aria-live="polite"/);
  assert.match(html,/id="pageTitle" tabindex="-1"/);
  assert.match(html,/id="commandPaletteInput"[^>]+aria-label="대시보드 기능 검색"/);
  assert.match(html,/id="commandPaletteDialog" role="dialog" aria-modal="true"/);
  assert.match(app,/trapTabKey\(\$\('commandPaletteDialog'\),event\)/);
  assert.match(app,/trapTabKey\(\$\('dashboardSidebar'\),event\)/);
  assert.match(app,/isEditableShortcutTarget\(event\.target\)/);
  assert.match(app,/pageChangeAnnouncement/);
  assert.match(css,/:focus-visible/);assert.match(css,/prefers-reduced-motion:reduce/);
});
