import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMobileHealthModel, formatMobileBytes, formatMobileUptime, mobileHealthSummaryText } from '../public/mobile-health-model.js';
import { dashboardCapabilityForRequest, operatorStaticAllowed } from '../src/dashboard-access.js';

test('mobile health model summarizes runtime and incident state without requiring admin mutation rights',()=>{
  const payload={
    version:'4.14.5',checkedAt:1000,access:{role:'operator',user:'producer',capabilities:['live']},
    runtime:{status:'warn',uptimeMs:3660000,memory:{rss:64*1024*1024},eventLoop:{p95Ms:18.2},api:{requests:100,errors:2,errorRate:2},persistence:{recoveries:1,failures:0},sse:{liveClients:2}},
    services:{discord:{status:'pass',detail:'Discord 요청 상태'},naver:{status:'warn',detail:'모니터 기준선 대기'},chzzk:{status:'pass',detail:'방송 OFFLINE'},storage:{status:'pass',detail:'복구 1 · 손상 0'},sse:{status:'warn',detail:'연결 2 · 재연결 1'}},
    incidentWorkflow:{counts:{open:1,acknowledged:0,critical:0,warning:1,totalActive:1},incidents:[{id:'i1',title:'SSE 지연',source:'sse',severity:'warning',status:'open',occurrences:2,lastSeenAt:900}],timeline:[]}
  };
  const model=buildMobileHealthModel(payload,1000);
  assert.equal(model.status,'warn');assert.equal(model.uptime,'1시간 1분');assert.equal(model.memory,'64.0 MB');assert.equal(model.canManageIncidents,false);assert.equal(model.activeIncidents.length,1);assert.equal(model.services.naver.status,'warn');
  assert.match(mobileHealthSummaryText(model),/Runtime Health: 주의/);
});

test('mobile health formatters use bounded readable units',()=>{
  assert.equal(formatMobileUptime(60_000),'1분');assert.equal(formatMobileBytes(1024),'1.0 KB');assert.equal(formatMobileBytes(1024**2),'1.0 MB');
});

test('mobile health endpoint is delegated read-only while incident mutations remain admin-only',()=>{
  assert.equal(dashboardCapabilityForRequest('GET','/api/mobile-health'),'authenticated');
  assert.equal(dashboardCapabilityForRequest('POST','/api/incidents/i1/ack'),null);
  assert.equal(dashboardCapabilityForRequest('POST','/api/incidents/i1/resolve'),null);
  assert.equal(operatorStaticAllowed('/mobile-health-model.js'),true);
});

test('mobile page exposes runtime health and incident center with safe non-live incident mutation path',()=>{
  const html=fs.readFileSync(new URL('../public/mobile-control.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/mobile-control.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  for(const id of ['mobileTabHealth','mobileHealthView','healthOverall','healthServices','healthIncidents','healthTimeline','healthRefresh','healthCopy'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(js,/\/api\/mobile-health/);assert.match(js,/syncGuard:false/);assert.match(js,/liveGuard:false/);assert.match(js,/\/api\/incidents\//);assert.match(js,/navigator\.clipboard/);
  assert.match(server,/app\.get\('\/api\/mobile-health'/);assert.match(server,/mobileIncidentWorkflow/);assert.match(server,/publicDashboardAccess\(identity\)/);
  assert.doesNotMatch(html,/on(click|change|submit)=/i);
});
