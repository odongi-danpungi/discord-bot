import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('live dashboard contains broadcast operations hub controls',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const id of ['broadcastHubBadge','hubPresetList','hubScheduleList','hubPollView','hubNotificationStatus','hubTimeline'])assert.match(html,new RegExp(`id="${id}"`));
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(js,/renderBroadcastHub/);assert.match(js,/\/api\/broadcast-ops\/poll/);assert.match(js,/\/api\/broadcast-ops\/schedule/);
});

test('viewer dashboard exposes live poll panel',async()=>{
  const html=await readFile(new URL('../public/viewer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/viewer.js',import.meta.url),'utf8');
  assert.match(html,/id="viewerPoll"/);assert.match(js,/poll\/vote/);
});
