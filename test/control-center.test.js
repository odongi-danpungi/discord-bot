import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('control center exposes live flow, readiness, archive and reusable session controls',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 for(const id of ['phaseRail','nextActionButton','operationalAlerts','liveFeed','sessionArchive','metricTotalApplicants','rosterReadiness','liveSyncState','diagVersion','diagRevision','diagLiveClients','diagLastEvent','diagLag','reconnectLive'])assert.match(html,new RegExp(`id=["']${id}["']`));
 assert.match(js,/recommendedAction/);assert.match(js,/addEventListener\('heartbeat'/);assert.match(js,/45000/);assert.match(js,/renderArchive/);assert.match(js,/data-reuse-session/);assert.match(js,/게임 정보 미등록/);
});
