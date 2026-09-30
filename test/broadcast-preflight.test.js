import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBroadcastPreflight } from '../src/broadcast-preflight.js';

const base=(overrides={})=>({
  state:{session:null},records:[],participationQueue:{entries:[],activeCount:0,currentCall:null},participationCalls:{current:null},
  chzzkLive:{connector:{configured:true},state:{lastStatus:'pass',lastKnownLive:false,baselineReady:true},currentLive:null},broadcastOps:{nextSchedule:null},
  runtime:{status:'pass',persistence:{}},incidents:{counts:{critical:0,open:0,acknowledged:0,totalActive:0}},emergency:{locked:false},discord:{connected:true},discordPolicy:{baseline:null,monitor:{enabled:false},monitorState:{}},naver:{connected:false},naverParticipation:{registrationOpen:false,counts:{queued:0}},demo:false,now:10_000,
  ...overrides
});

test('go-live preflight passes when core broadcast systems are healthy',()=>{
  const result=buildBroadcastPreflight(base());
  assert.equal(result.status,'pass');
  assert.equal(result.ready,true);
  assert.equal(result.counts.fail,0);
  assert.equal(result.counts.warn,0);
  assert.ok(result.checks.some(item=>item.id==='discord'&&item.status==='pass'));
  assert.equal(result.recommendation.target,'operate');
});

test('emergency lock, critical incident and Discord disconnect block preflight',()=>{
  const result=buildBroadcastPreflight(base({
    emergency:{locked:true,reason:'데이터 복구 중'},
    incidents:{counts:{critical:1,open:1,totalActive:1}},
    discord:{connected:false}
  }));
  assert.equal(result.status,'fail');
  assert.equal(result.ready,false);
  assert.ok(result.counts.fail>=3);
  assert.equal(result.recommendation.target,'recovery');
  assert.match(result.summary,/해결 필요/);
});

test('live CHZZK without an active participation session becomes a warning',()=>{
  const result=buildBroadcastPreflight(base({chzzkLive:{connector:{configured:true},state:{lastStatus:'pass',lastKnownLive:true,baselineReady:true},currentLive:{liveTitle:'테스트 방송'}}}));
  const session=result.checks.find(item=>item.id==='participation-session');
  assert.equal(session.status,'warn');
  assert.equal(session.target,'operate');
  assert.equal(result.status,'warn');
});

test('participant call output is privacy-minimized and never exposes response tokens',()=>{
  const result=buildBroadcastPreflight(base({
    participationQueue:{activeCount:1,currentCall:{displayName:'방울이',deadline:20_000,token:'server-secret-token',discordUserId:'123456'}},
    participationCalls:{current:{displayName:'방울이',deadline:20_000,token:'another-secret'}}
  }));
  const json=JSON.stringify(result);
  assert.match(json,/방울이/);
  assert.doesNotMatch(json,/server-secret-token|another-secret|123456/);
  assert.equal(result.checks.find(item=>item.id==='participant-call').status,'warn');
});

test('Naver participation warns when registration is open but OAuth is disconnected',()=>{
  const result=buildBroadcastPreflight(base({naver:{connected:false},naverParticipation:{registrationOpen:true,counts:{queued:3}}}));
  const naver=result.checks.find(item=>item.id==='naver');
  assert.equal(naver.status,'warn');
  assert.equal(naver.target,'settings');
});

test('acknowledged Discord policy drift does not create a preflight warning',()=>{
  const policy={baseline:{digest:'base'},monitor:{enabled:true},monitorState:{lastComparisonStatus:'drift',lastComparisonDigest:'drift-1'},maintenance:null,acknowledgement:{digest:'drift-1'}};
  const result=buildBroadcastPreflight(base({discordPolicy:policy}));
  assert.equal(result.checks.find(item=>item.id==='discord-policy').status,'pass');
  assert.equal(result.status,'pass');
});
