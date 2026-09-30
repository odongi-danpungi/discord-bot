import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateDashboardBasic, canDashboard, dashboardCapabilityForRequest, operatorStaticAllowed, parseDashboardOperatorCapabilities, sanitizeOperatorSnapshot,sanitizeOperatorBroadcastOps,sanitizeOperatorNaverParticipation } from '../src/dashboard-access.js';

const basic=(user,password)=>`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const config={dashboardUser:'admin',dashboardPassword:'admin-password-123',dashboardOperatorUser:'producer',dashboardOperatorPassword:'operator-password-456',dashboardOperatorCapabilities:['live','queue','discord']};

test('dashboard access authenticates admin and delegated operator independently',()=>{
  const admin=authenticateDashboardBasic(basic('admin','admin-password-123'),config);
  const operator=authenticateDashboardBasic(basic('producer','operator-password-456'),config);
  assert.equal(admin.role,'admin');assert.equal(operator.role,'operator');assert.deepEqual(operator.capabilities,['live','queue','discord']);
  assert.equal(authenticateDashboardBasic(basic('producer','wrong'),config),null);
  assert.equal(canDashboard(admin,'broadcast'),true);assert.equal(canDashboard(operator,'queue'),true);assert.equal(canDashboard(operator,'broadcast'),false);
});

test('operator capability parser rejects unknown privileges and supports explicit subsets',()=>{
  assert.deepEqual(parseDashboardOperatorCapabilities('queue, live,queue'),['queue','live']);
  assert.deepEqual(parseDashboardOperatorCapabilities('all'),['live','queue','broadcast','discord']);
  assert.throws(()=>parseDashboardOperatorCapabilities('queue,release'),/지원하지 않는 권한/);
});

test('delegated request map keeps recovery, release, settings and account integrations admin-only',()=>{
  assert.equal(dashboardCapabilityForRequest('GET','/api/snapshot'),'authenticated');
  assert.equal(dashboardCapabilityForRequest('POST','/api/participation-queue/call-next'),'queue');
  assert.equal(dashboardCapabilityForRequest('POST','/api/operations/draw'),'live');
  assert.equal(dashboardCapabilityForRequest('POST','/api/operations/publish'),'discord');
  assert.equal(dashboardCapabilityForRequest('POST','/api/broadcast-ops/poll'),'broadcast');
  assert.equal(dashboardCapabilityForRequest('POST','/api/release/apply'),null);
  assert.equal(dashboardCapabilityForRequest('POST','/api/recovery/restore'),null);
  assert.equal(dashboardCapabilityForRequest('POST','/api/naver/disconnect'),null);
  assert.equal(dashboardCapabilityForRequest('POST','/api/operations/setup'),null);
});

test('operator static access is limited to the mobile operations surface assets',()=>{
  assert.equal(operatorStaticAllowed('/mobile-control.html'),true);
  assert.equal(operatorStaticAllowed('/mobile-control.js'),true);
  assert.equal(operatorStaticAllowed('/mobile-control-model.js'),true);
  assert.equal(operatorStaticAllowed('/mobile-broadcast-model.js'),true);
  assert.equal(operatorStaticAllowed('/'),false);
  assert.equal(operatorStaticAllowed('/index.html'),false);
  assert.equal(operatorStaticAllowed('/app.js'),false);
});

test('operator snapshot removes profile identifiers and queue identity metadata',()=>{
  const source={
    csrf:'csrf-secret',version:'4.14.2',revision:7,serverTime:1000,demo:false,profile:'production',recovered:false,
    state:{revision:7,safeDeploy:{secret:'admin-only'},session:{id:'s1',round:2,game:'lol',mode:'aram',phase:'checking',count:10,title:'시참',description:'desc',deadline:2000,applicants:['111','222'],postponed:['222'],winners:['111'],confirmed:[],teams:[['111']]}},
    records:[{discordId:'111',chzzkName:'개인프로필',lolRiotId:'secret#KR1'}],
    participationQueue:{revision:3,activeCount:1,counts:{called:1},history:[{identityKey:'secret'}],entries:[{id:'q1',sequence:1,position:1,source:'discord',status:'called',identityKey:'discord:111',displayName:'방울이',discordUserId:'111',naverKey:'a'.repeat(64),callMessage:{channelId:'999',id:'888'},callDeadline:1900}],currentCall:{id:'q1',position:1,source:'discord',status:'called',identityKey:'discord:111',displayName:'방울이',discordUserId:'111',callDeadline:1900}},
    participationCalls:{timeoutSeconds:60,calledCount:1,current:{id:'q1',displayName:'방울이',source:'discord',discordUserId:'111',position:1,deadline:1900,messageRef:{channelId:'999',id:'888'}}},
    chzzkLive:{state:{lastKnownLive:true,lastStatus:'live'},currentLive:{title:'방송',categoryType:'게임',concurrentUserCount:10},settings:{channelId:'channel'}},
    broadcastOps:{schedules:[{id:'b1'}]},policyMonitor:{secret:true},incidentWorkflow:{secret:true}
  };
  const safe=sanitizeOperatorSnapshot(source,{role:'operator',user:'producer',capabilities:['live','queue']});
  const text=JSON.stringify(safe);
  assert.equal(safe.records.length,0);assert.equal(safe.state.session.applicantCount,2);assert.equal(safe.state.session.winnerCount,1);assert.equal(safe.state.session.teamCount,1);
  assert.equal(safe.participationQueue.entries[0].displayName,'방울이');
  assert.equal(text.includes('discord:111'),false);assert.equal(text.includes('discordUserId'),false);assert.equal(text.includes('naverKey'),false);assert.equal(text.includes('callMessage'),false);assert.equal(text.includes('messageRef'),false);assert.equal(text.includes('secret#KR1'),false);assert.deepEqual(safe.broadcastOps,{});
  assert.equal(safe.csrf,'csrf-secret');assert.equal(safe.access.role,'operator');
});


test('high-impact admin-only routes never map to delegated capabilities',()=>{
  const adminOnly=[
    ['POST','/api/release/apply'],['POST','/api/recovery/restore'],['POST','/api/naver/disconnect'],
    ['POST','/api/operations/setup'],['POST','/api/operations/voice'],['POST','/api/nicknames'],['POST','/api/broadcast-import']
  ];
  for(const [method,path] of adminOnly)assert.equal(dashboardCapabilityForRequest(method,path),null,`${method} ${path}`);
});


test('operator broadcast and Naver summaries remove hashed voters and publication identifiers',()=>{
  const broadcast=sanitizeOperatorBroadcastOps({activePoll:{id:'poll_x',question:'Q',status:'open',createdAt:1,options:[{id:'a',label:'A',votes:['hash-one','hash-two']}]},pollHistory:[],gamePresets:[],schedules:[],notifications:{broadcast:true},timeline:[],stats:{polls:1}});
  assert.equal(broadcast.activePoll.options[0].voteCount,2);assert.equal(Object.hasOwn(broadcast.activePoll.options[0],'votes'),false);assert.doesNotMatch(JSON.stringify(broadcast),/hash-one|hash-two/);
  const naver=sanitizeOperatorNaverParticipation({publication:{status:'sent',cafeId:'123',menuId:'456',articleId:'789',articleUrl:'https://cafe.naver.com/example/789',subject:'칼바람 시참'},session:{id:'session',status:'open',startedAt:1},entries:[{id:'e1',order:1,displayName:'방울이',status:'queued',registeredAt:1}],history:[{secret:'old'}],counts:{queued:1},nextOrder:2,registrationOpen:true});
  const text=JSON.stringify(naver);assert.doesNotMatch(text,/"cafeId"|"menuId"|"articleId"|old/);assert.match(text,/방울이/);assert.equal(naver.history.length,0);
});
