import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('viewer dashboard exposes participant self-service controls without exposing call tokens',()=>{
  const html=fs.readFileSync(new URL('../public/viewer.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/viewer.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/viewer.js',import.meta.url),'utf8');
  assert.match(html,/LIVE PARTICIPATION/);
  assert.match(html,/participationCallTimer/);
  assert.match(html,/다음판으로 미루기|data-participation-action/);
  assert.match(js,/participation\/action/);
  assert.match(js,/call_join/);
  assert.match(js,/call_pass/);
  assert.match(server,/buildParticipantSelfServiceState/);
  assert.match(server,/performParticipantSelfServiceAction/);
  assert.doesNotMatch(js,/callToken/);
});

test('discord registration panel points users to the unified viewer dashboard',()=>{
  const messages=fs.readFileSync(new URL('../src/messages.js',import.meta.url),'utf8');
  const interactions=fs.readFileSync(new URL('../src/interactions.js',import.meta.url),'utf8');
  assert.match(messages,/시청자 대시보드/);
  assert.match(interactions,/시청자 대시보드:/);
});
