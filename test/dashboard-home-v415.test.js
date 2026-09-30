import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDashboardHomeModel } from '../public/dashboard-home-v415.js';

test('v4.15.1 home summarizes active round, queue call, schedule, and poll',()=>{
  const now=1_800_000_000_000;
  const model=buildDashboardHomeModel({
    now,
    state:{session:{round:4,phase:'open',game:'lol',mode:'aram',count:10,applicants:['a','b','c'],winners:[],confirmed:[]},reservations:[{id:'r1'}]},
    derived:{active:true,readyCount:3,missingCount:0,pendingCount:0,postponedCount:0},
    participationQueue:{activeCount:2,entries:[{id:'q1',displayName:'방울이',status:'called',source:'discord',position:1,responseToken:'secret-token'},{id:'q2',displayName:'댕댕',status:'waiting',source:'naver',position:2,naverIdentityHash:'private-hash'}],currentCall:{id:'q1',displayName:'방울이',source:'discord',callDeadline:now+35_000,responseToken:'secret-token'}},
    broadcastOps:{nextSchedule:{id:'s1',title:'저녁 내전',startAt:now+3_600_000,status:'scheduled'},activePoll:{id:'p1',question:'다음 게임?',options:[{label:'협곡',votes:['x','y']},{label:'칼바람',voteCount:1}]},stats:{completedSessions:12}},
    chzzkLive:{connector:{configured:true},state:{lastKnownLive:true,lastStatus:'pass'},currentLive:{liveTitle:'테스트 방송',concurrentUserCount:42}},
    health:{connected:true,runtimeStatus:'pass',capacityStatus:'pass',incidentCounts:{open:0,critical:0}},liveState:'live'
  });
  assert.equal(model.session.round,4);assert.equal(model.session.readyCount,3);assert.equal(model.queue.currentCall.secondsLeft,35);assert.equal(model.schedule.title,'저녁 내전');assert.equal(model.poll.totalVotes,3);assert.equal(model.chzzk.viewers,42);assert.equal(model.recommendation.target,'live');
  const serialized=JSON.stringify(model);assert.doesNotMatch(serialized,/secret-token|private-hash|responseToken|naverIdentityHash/);
});

test('v4.15.1 home prioritizes emergency lock over normal live operations',()=>{
  const model=buildDashboardHomeModel({state:{session:{round:1,phase:'open',count:10}},derived:{active:true,readyCount:10},emergency:{locked:true,reason:'저장소 복구'},health:{connected:true},liveState:'live'});
  assert.equal(model.overall,'locked');assert.equal(model.recommendation.target,'recovery');assert.equal(model.alerts[0].target,'recovery');
});

test('v4.15.1 home surfaces critical incidents before session recommendation',()=>{
  const model=buildDashboardHomeModel({state:{session:{round:2,phase:'checking',count:10}},derived:{active:true,readyCount:10},incidentSummary:{counts:{critical:2,open:2,totalActive:2}},health:{connected:true},liveState:'live'});
  assert.equal(model.overall,'danger');assert.equal(model.recommendation.target,'incidents');assert.match(model.recommendation.title,/CRITICAL/);
});

test('v4.15.1 dashboard markup includes consolidated home and keeps control pages intact',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/data-page="home"/);assert.match(html,/id="homeNextAction"/);assert.match(html,/id="homeQueueList"/);assert.match(html,/id="homePollOptions"/);assert.match(html,/data-tab="home"/);assert.match(html,/data-page="operate" hidden/);assert.match(html,/data-page="live"/);
});
