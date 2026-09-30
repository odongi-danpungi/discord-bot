import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard exposes performance trends, capacity budgets, slow APIs and advisor',async()=>{
 const [html,client,server,broadcast]=await Promise.all([
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8'),
  readFile(new URL('../src/app.js',import.meta.url),'utf8'),
  readFile(new URL('../src/broadcast.js',import.meta.url),'utf8')
 ]);
 for(const id of ['capacityOverall','capacityApiP95','capacityMemoryGrowth','capacityDataSize','capacitySseUsage','capacityTrendCanvas','capacitySlowApiList','capacityRecommendations','refreshCapacity'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/data-tab="capacity"/);assert.match(html,/Performance & Capacity/);
 assert.match(client,/\/api\/performance-capacity/);assert.match(client,/drawCapacityTrend/);assert.match(client,/capacityRefresh/);
 assert.match(server,/PerformanceCapacity/);assert.match(server,/measureDataFootprint/);assert.match(server,/broadcastSseCapacity|broadcast-sse-capacity/);
 assert.match(broadcast,/streamClosers/);assert.match(broadcast,/stats\(\)/);
 assert.equal((html.match(/<div class="metrics runtime-metrics">/g)||[]).length,1);
});
