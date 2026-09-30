import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('navigation safety module provides dirty-state and high-risk guards',()=>{
  const src=fs.readFileSync(new URL('../public/dashboard-navigation-safety-v415.js',import.meta.url),'utf8');
  assert.match(src,/registerDirtyGroup/);
  assert.match(src,/beforeunload/);
  assert.match(src,/confirmDashboardNavigation/);
  assert.match(src,/confirmHighRiskAction/);
});

test('dashboard integrates unsaved badge and tracked settings groups',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="unsavedChanges"/);
  assert.match(app,/broadcast-settings/);
  assert.match(app,/broadcast-automation/);
  assert.match(app,/discord-policy-monitor/);
  assert.match(app,/release-trust-policy/);
});

test('naver monitor and article drafts participate in navigation safety',()=>{
  const src=fs.readFileSync(new URL('../public/naver.js',import.meta.url),'utf8');
  assert.match(src,/naver-monitor/);
  assert.match(src,/naver-article-draft/);
  assert.match(src,/confirmHighRiskAction/);
});
