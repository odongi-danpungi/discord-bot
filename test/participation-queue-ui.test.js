import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('live dashboard exposes unified queue controls and API wiring',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  for(const id of ['liveQueueName','liveQueueRegister','liveOpsRoster','liveQueueCallNext','liveQueueRecall','liveQueueCallCancel'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/통합 시참 Queue/);assert.match(js,/participationQueue/);assert.match(js,/data-queue-status/);assert.match(js,/data-queue-move/);
  assert.match(app,/\/api\/participation-queue\/register/);assert.match(app,/\/api\/participation-queue\/:id\/status/);assert.match(app,/\/api\/participation-queue\/:id\/reorder/);assert.match(app,/\/api\/participation-queue\/call-next/);assert.match(app,/\/api\/participation-queue\/:id\/call/);assert.match(app,/\/api\/participation-queue\/:id\/call-cancel/);
});
