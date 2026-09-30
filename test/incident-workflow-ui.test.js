import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('incident workflow dashboard and API are wired',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  for(const id of ['incidentOverall','incidentOpenCount','incidentAckCount','incidentCriticalCount','incidentWarningCount','incidentStatusFilter','incidentSeverityFilter','refreshIncidents','incidentQueue','incidentTimeline'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(html,/data-tab="incidents"/);assert.match(js,/incidentRefresh/);assert.match(js,/incidentAck/);assert.match(js,/incidentResolve/);assert.match(js,/incidentReopen/);
  assert.match(server,/\/api\/incidents/);assert.match(server,/\/api\/incidents\/:id\/ack/);assert.match(server,/\/api\/incidents\/:id\/resolve/);assert.match(server,/\/api\/incidents\/:id\/reopen/);assert.match(server,/incidentStore\.subscribe\(pushLive\)/);assert.match(server,/unsubscribeIncident\(\)/);
});
