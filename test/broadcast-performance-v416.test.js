import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBroadcastPerformance, broadcastPerformancePoint, buildBroadcastPerformanceInsights, buildBroadcastPerformanceModel, compareBroadcastPerformance } from '../public/broadcast-performance-model-v416.js';
import { readFile } from 'node:fs/promises';

const report=(id,{endedAt=1,sessions=2,applicants=20,winners=10,confirmed=9,noShows=1,duration=120,skipped=0}={})=>({id,title:`방송 ${id}`,endedAt,durationMinutes:duration,checklist:{done:12-skipped,skipped,total:12},handoffCount:1,sessionStats:{completed:sessions,applicants,winners,confirmed,noShows,games:{aram:1,rift:1,er:0}}});

test('performance point and aggregate use aggregate counts without identities',()=>{
  const a=report('a'),b=report('b',{sessions:1,applicants:5,winners:4,confirmed:2,noShows:2,duration:30});
  const point=broadcastPerformancePoint(a);assert.equal(point.applicantsPerSession,10);assert.equal(point.attendanceRate,90);assert.equal(point.noShowRate,10);
  const total=aggregateBroadcastPerformance([a,b]);assert.equal(total.broadcasts,2);assert.equal(total.sessions,3);assert.equal(total.applicants,25);assert.equal(total.attendanceRate,78.6);assert.equal(JSON.stringify(total).includes('discordId'),false);
});

test('comparison exposes latest-vs-previous deltas only',()=>{
  const current=report('new',{applicants:24,confirmed:10,noShows:0}),previous=report('old',{applicants:16,confirmed:8,noShows:2});
  const comparison=compareBroadcastPerformance(current,previous);assert.equal(comparison.current.id,'new');assert.equal(comparison.previous.id,'old');assert.equal(comparison.metrics.find(x=>x.key==='attendanceRate').delta,20);assert.equal(comparison.metrics.find(x=>x.key==='noShowRate').delta,-20);
});

test('insights are rule-based, bounded, and explicitly avoid causal claims',()=>{
  const latest=report('new',{applicants:30,winners:10,confirmed:6,noShows:4,duration:180,skipped:2}),previous=report('old',{applicants:16,winners:10,confirmed:9,noShows:1,duration:90});
  const insights=buildBroadcastPerformanceInsights([latest,previous]);assert.ok(insights.length>=1&&insights.length<=4);assert.ok(insights.some(x=>x.title.includes('노쇼')));assert.ok(insights.some(x=>x.detail.includes('원인')||x.detail.includes('확인')));
});

test('range selection and trend order are deterministic',()=>{
  const reports=[report('a',{endedAt:100}),report('d',{endedAt:400}),report('b',{endedAt:200}),report('c',{endedAt:300})];const model=buildBroadcastPerformanceModel(reports,{range:3});assert.equal(model.selectedCount,3);assert.deepEqual(model.trend.map(x=>x.id),['b','c','d']);
});

test('dashboard contains read-only performance comparison surface',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/broadcastPerformanceRange/);assert.match(html,/broadcastPerformanceTrend/);assert.match(html,/broadcastPerformanceInsights/);assert.match(app,/buildBroadcastPerformanceModel/);assert.doesNotMatch(app,/api\/broadcast-performance.*POST/);
});
