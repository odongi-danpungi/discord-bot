import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';
import { RecoveryStore } from '../src/recovery-store.js';
import { performParticipantSelfServiceAction } from '../src/participant-self-service.js';
import { sanitizeOperatorSnapshot } from '../src/dashboard-access.js';
import { buildMobileControlModel } from '../public/mobile-control-model.js';
import { buildMobileBroadcastModel } from '../public/mobile-broadcast-model.js';
import { buildMobileHealthModel } from '../public/mobile-health-model.js';
import { buildMobileRecoveryModel } from '../public/mobile-recovery-model.js';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'dd-v414-final-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}

function fakeOperations(initial){
  const state=structuredClone(initial);
  return {read:()=>state,async update(fn){return fn(state);}};
}

const openOperations=()=>({session:{id:'s1',round:7,game:'lol',mode:'aram',phase:'open',count:10,title:'최종 통합 검증',description:'v4.14 final',closeAt:null,applicants:['u1'],postponed:[],winners:[],confirmed:[],excluded:[],teams:[],createdAt:1},reservations:[],history:[],sessionArchive:[],rounds:{lol:7},revision:4});
const profile={discordId:'u1',chzzkName:'방울이',lolRiotId:'Bangul#KR1',lolMainLane:'mid',lolCurrentTier:'골드',lolPeakTier:'플래티넘'};

test('v4.14 final: delegated mobile snapshot keeps least privilege and removes sensitive identities across mobile surfaces',()=>{
  const identity={role:'operator',user:'producer',capabilities:['live','queue','broadcast']};
  const snapshot=sanitizeOperatorSnapshot({
    csrf:'csrf-safe',version:'4.14.7',revision:9,serverTime:1000,profile:'production',recovered:false,
    state:{revision:9,session:{id:'s1',round:7,game:'lol',mode:'aram',phase:'closed',count:2,title:'시참',description:'',applicants:['u1','u2'],postponed:[],winners:[],confirmed:[],teams:[]}},
    records:[{discordId:'u1',chzzkName:'비밀프로필',lolRiotId:'Secret#KR1'}],
    participationQueue:{revision:5,activeCount:2,counts:{waiting:2},entries:[{id:'q1',sequence:1,position:1,source:'discord',status:'waiting',displayName:'방울이',discordUserId:'u1',identityKey:'discord:u1',naverKey:'n'.repeat(64)},{id:'q2',sequence:2,position:2,source:'naver',status:'waiting',displayName:'네이버참가자',naverKey:'m'.repeat(64)}]},
    participationCalls:{timeoutSeconds:60,current:null,calledCount:0},
    chzzkLive:{state:{lastKnownLive:true,lastStatus:'live'},currentLive:{title:'방송',categoryType:'게임',concurrentUserCount:12}},
    broadcastOps:{gamePresets:[{id:'builtin',name:'칼바람',builtin:true,game:'lol',mode:'aram',count:10}],activePoll:{id:'poll',question:'다음 게임?',status:'open',options:[{id:'a',label:'칼바람',votes:['viewer-hash-secret']}]},schedules:[],notifications:{broadcast:true},timeline:[],stats:{}},
    emergency:{locked:false}
  },identity);
  const serialized=JSON.stringify(snapshot);
  assert.doesNotMatch(serialized,/Secret#KR1|discord:u1|viewer-hash-secret|naverKey|discordUserId/);
  const live=buildMobileControlModel(snapshot,1000);
  assert.equal(live.access.role,'operator');assert.equal(live.actions.draw,true);assert.equal(live.actions.publish,false);
  const hub=buildMobileBroadcastModel(snapshot,1000);
  assert.equal(hub.allowed,true);assert.equal(hub.activePoll.options[0].voteCount,1);
  const health=buildMobileHealthModel({version:'4.14.7',access:snapshot.access,runtime:{status:'pass',uptimeMs:60_000},services:{},incidentWorkflow:{counts:{},incidents:[],timeline:[]}},1000);
  assert.equal(health.canManageIncidents,false);
  const recovery=buildMobileRecoveryModel({version:'4.14.7',access:snapshot.access,emergency:snapshot.emergency,recovery:{restorePoints:[],auditLog:[]},selfCheck:{ok:true,counts:{pass:1,warn:0,fail:0},checks:[]}});
  assert.equal(recovery.allowed,false);
});

test('v4.14 final: viewer self-service call pass remains private, updates operations reservation, and survives queue restart',async t=>{
  const root=await fixture(t),queueFile=path.join(root,'queue.json');
  const queue=new ParticipationQueueStore(queueFile);await queue.init();
  const entry=(await queue.register({source:'discord',displayName:'방울이',discordUserId:'u1',sessionId:'s1',game:'lol',mode:'aram',round:7})).entry;
  const discord={participationCall:async()=>({channelId:'c',id:'m'}),completeParticipationCall:async()=>{}};
  const calls=new ParticipationCallService({queue,discord,timeoutSeconds:60});await calls.start();await calls.callEntry(entry.id);
  const rawBefore=queue.read().entries.find(item=>item.id===entry.id);assert.ok(rawBefore.callToken);
  const operations=fakeOperations(openOperations());
  const result=await performParticipantSelfServiceAction({action:'call_pass',userId:'u1',profile,operations,participationQueue:queue,participationCalls:calls,records:[profile],now:Date.now()});
  assert.equal(result.state.queue.entry.status,'postponed_next');
  assert.equal(JSON.stringify(result).includes(rawBefore.callToken),false);
  assert.ok(operations.read().reservations.some(item=>item.userId==='u1'&&item.round===8));
  calls.stop();
  const rebooted=new ParticipationQueueStore(queueFile);await rebooted.init();
  const restored=rebooted.summary().entries.find(item=>item.id===entry.id);
  assert.equal(restored.status,'postponed_next');assert.equal('callToken' in restored,false);
});

test('v4.14 final: emergency lock and participant-call pause survive restart and preserve response time',async t=>{
  const root=await fixture(t),queueFile=path.join(root,'queue.json'),recoveryFile=path.join(root,'recovery.json');
  const queue=new ParticipationQueueStore(queueFile);await queue.init();
  const entry=(await queue.register({source:'discord',displayName:'방울이',discordUserId:'u1'})).entry;
  const discord={participationCall:async()=>({channelId:'c',id:'m'}),completeParticipationCall:async()=>{}};
  const service=new ParticipationCallService({queue,discord,timeoutSeconds:60});await service.start();await service.callEntry(entry.id);
  const before=queue.read().entries.find(item=>item.id===entry.id).callDeadline;
  const recovery=new RecoveryStore(recoveryFile);await recovery.init();
  const point=await recovery.checkpoint({records:[{guildId:'g',discordId:'u1',chzzkName:'방울이'}],operations:{guildId:'g',revision:4,session:null,history:[],reservations:[],sessionArchive:[],rounds:{}},label:'final-lock',guildId:'g'});
  const lockedAt=Date.now();await recovery.setEmergency({locked:true,actor:'admin',reason:'final integration',checkpointId:point.id,at:lockedAt});await service.pause('final-lock',{at:lockedAt});service.stop();

  const recoveredStore=new RecoveryStore(recoveryFile);await recoveredStore.init();const emergency=recoveredStore.emergencyState();assert.equal(emergency.locked,true);assert.equal(emergency.checkpointId,point.id);
  const rebootedQueue=new ParticipationQueueStore(queueFile);await rebootedQueue.init();
  const rebootedService=new ParticipationCallService({queue:rebootedQueue,discord,timeoutSeconds:60,paused:emergency.locked,pausedAt:emergency.lockedAt});
  const startup=await rebootedService.start();assert.equal(startup.paused,true);assert.equal(rebootedQueue.summary().entries.find(item=>item.id===entry.id).status,'called');
  const unlockAt=lockedAt+30_000;await rebootedService.resume('final-unlock',{at:unlockAt});
  const after=rebootedQueue.read().entries.find(item=>item.id===entry.id).callDeadline;assert.equal(after-before,30_000);rebootedService.stop();
});

test('v4.14 final: emergency state is visible on delegated live snapshot while recovery authority remains admin-only',()=>{
  const identity={role:'operator',user:'helper',capabilities:['live','queue']};
  const snapshot=sanitizeOperatorSnapshot({version:'4.14.7',revision:1,serverTime:1000,state:{revision:1,session:null},records:[],participationQueue:{revision:1,entries:[],counts:{},activeCount:0},participationCalls:{timeoutSeconds:60,current:null,calledCount:0},chzzkLive:{state:{lastKnownLive:false,lastStatus:'offline'}},broadcastOps:{},emergency:{locked:true,lockedAt:900,lockedBy:'admin-secret',reason:'스토리지 점검',checkpointId:'private-point'}},identity);
  assert.deepEqual(snapshot.emergency,{locked:true,lockedAt:900,reason:'스토리지 점검'});
  assert.equal(JSON.stringify(snapshot).includes('private-point'),false);assert.equal(JSON.stringify(snapshot).includes('admin-secret'),false);
  const live=buildMobileControlModel(snapshot,1000);assert.equal(live.access.role,'operator');
  const recovery=buildMobileRecoveryModel({access:snapshot.access,emergency:snapshot.emergency});assert.equal(recovery.allowed,false);assert.equal(recovery.emergency.locked,true);
});
