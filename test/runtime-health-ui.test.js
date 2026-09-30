import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard exposes runtime health, SSE metrics, incident timeline and safe diagnostics export',async()=>{
 const [html,client,server]=await Promise.all([
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8'),
  readFile(new URL('../src/app.js',import.meta.url),'utf8')
 ]);
 for(const id of ['runtimeOverall','runtimeUptime','runtimeApiErrorRate','runtimeMemory','runtimeLoop','runtimeSseClients','runtimeIncidentList','runtimeIncidentSource','refreshRuntime'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/data-tab="runtime"/);assert.match(html,/진단 JSON 내보내기/);
 assert.match(client,/\/api\/runtime-health/);assert.match(client,/sse-stale/);assert.match(client,/sse-reconnect/);
 assert.match(server,/\/api\/runtime\/diagnostics/);assert.match(server,/\/api\/runtime\/client-metric/);assert.match(server,/streamClosers/);
});
