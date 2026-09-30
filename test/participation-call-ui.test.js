import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('broadcast call controls wire dashboard, API, Discord buttons and interaction ownership checks',async()=>{
  const [html,web,app,discord,interactions]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/discord-service.js',import.meta.url),'utf8'),
    readFile(new URL('../src/interactions.js',import.meta.url),'utf8')
  ]);
  for(const id of ['liveQueueCallName','liveQueueCallTimer','liveQueueCallNext','liveQueueRecall','liveQueueCallCancel'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(web,/callQueueParticipant/);assert.match(web,/cancelQueueCall/);assert.match(web,/data-queue-call/);
  assert.match(app,/\/api\/participation-queue\/call-next/);assert.match(app,/\/api\/participation-queue\/:id\/call-cancel/);
  assert.match(discord,/setLabel\('참가합니다'\)/);assert.match(discord,/setLabel\('이번판 패스'\)/);assert.match(discord,/queuecall:join/);assert.match(discord,/queuecall:pass/);
  assert.match(interactions,/customId\.startsWith\('queuecall:'\)/);assert.match(interactions,/entry\.discordUserId!==userId/);
});
