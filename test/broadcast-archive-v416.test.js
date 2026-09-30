import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBroadcastArchiveReport, buildBroadcastArchiveReports } from '../src/broadcast-archive-report.js';
import { normalizeBroadcastArchive, filterBroadcastArchive, broadcastReportFilename } from '../public/broadcast-archive-model-v416.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';
import { readFile } from 'node:fs/promises';

const runbook={id:'rb_12345678',title:'금요일 방송',status:'closed',createdAt:1000,closedAt:9000,progress:{done:10,skipped:2,total:12},handoffs:[{id:'h1'}],closeout:{summary:'마감 완료',nextOwner:'operator-b',nextNote:'다음 방송 협곡',schedule:{title:'다음 방송',startAt:20000}}};

test('post-show report contains aggregate counts only for the closed runbook window',()=>{
  const report=buildBroadcastArchiveReport(runbook,{operationsState:{sessionArchive:[{endedAt:500,applicants:['outside']},{endedAt:4000,game:'lol',mode:'aram',applicants:['a','b'],winners:['a'],confirmed:['a'],noShows:[]},{endedAt:8000,game:'er',applicants:['x','y','z'],winners:['x'],confirmed:[],noShows:['x']},{endedAt:12000,applicants:['late']}]},chzzkSummary:{events:[{type:'start',detectedAt:1500,live:{liveTitle:'secret title'}},{type:'end',detectedAt:8500},{type:'start',detectedAt:12000}]},now:10000});
  assert.equal(report.sessionStats.completed,2);assert.equal(report.sessionStats.applicants,5);assert.equal(report.sessionStats.noShows,1);assert.deepEqual(report.sessionStats.games,{aram:1,rift:0,er:1});assert.deepEqual(report.chzzk,{starts:1,ends:1});
  const text=JSON.stringify(report);for(const secret of ['outside','late','secret title','discordId','callToken','oauthToken'])assert.equal(text.includes(secret),false);
});

test('archive reports de-duplicate closed runbooks and sort newest first',()=>{
  const newer={...runbook,id:'rb_87654321',createdAt:10000,closedAt:20000};
  const reports=buildBroadcastArchiveReports([runbook,newer,runbook],{});assert.deepEqual(reports.map(x=>x.id),['rb_87654321','rb_12345678']);
});

test('archive UI normalization, search and filename stay bounded and safe',()=>{
  const payload=normalizeBroadcastArchive({generatedAt:1,reports:[buildBroadcastArchiveReport(runbook,{})]});
  assert.equal(filterBroadcastArchive(payload.reports,{query:'금요일'}).length,1);assert.equal(filterBroadcastArchive(payload.reports,{query:'없는값'}).length,0);assert.match(broadcastReportFilename(payload.reports[0]),/^daengdaeng-broadcast-1970-01-01-rb_12345678\.json$/);
});

test('archive endpoint uses broadcast capability and dashboard surface is read-only export UX',async()=>{
  assert.equal(dashboardCapabilityForRequest('GET','/api/broadcast-archive'),'broadcast');assert.equal(dashboardCapabilityForRequest('POST','/api/broadcast-archive'),null);
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),server=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(html,/data-tab="broadcastarchive"/);assert.match(html,/data-page="broadcastarchive"/);assert.match(app,/\/api\/broadcast-archive/);assert.match(app,/JSON\.stringify\(report,null,2\)/);assert.match(server,/app\.get\('\/api\/broadcast-archive'/);assert.doesNotMatch(server,/app\.post\('\/api\/broadcast-archive'/);
});
