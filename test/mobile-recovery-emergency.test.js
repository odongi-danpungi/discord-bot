import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RecoveryStore } from '../src/recovery-store.js';
import { ParticipationQueueStore } from '../src/participation-queue-store.js';
import { ParticipationCallService } from '../src/participation-call-service.js';
import { buildMobileRecoveryModel,recoveryStatusLabel } from '../public/mobile-recovery-model.js';
import { dashboardCapabilityForRequest,operatorStaticAllowed } from '../src/dashboard-access.js';

const records=[{guildId:'g',discordId:'u1',chzzkName:'사용자'}];
const operations={guildId:'g',revision:3,session:null,history:[],reservations:[],sessionArchive:[],rounds:{}};

test('RecoveryStore persists emergency lock metadata without changing recovery schema',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'emergency-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new RecoveryStore(path.join(dir,'recovery.json'));await store.init();const point=await store.checkpoint({records,operations,label:'before',guildId:'g'});
 const locked=await store.setEmergency({locked:true,actor:'admin',reason:'SSE 장애',checkpointId:point.id,at:1000});assert.equal(locked.locked,true);assert.equal(store.summary('g').emergency.checkpointId,point.id);
 const unlocked=await store.setEmergency({locked:false,actor:'admin2',at:2000});assert.equal(unlocked.locked,false);assert.equal(unlocked.unlockedBy,'admin2');
});

test('participant call pause preserves remaining deadline instead of turning emergency time into no-show time',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'emergency-call-'));t.after(()=>rm(dir,{recursive:true,force:true}));const queue=new ParticipationQueueStore(path.join(dir,'queue.json'));await queue.init();const entry=(await queue.register({source:'discord',displayName:'A',discordUserId:'u1'})).entry;
 const discord={participationCall:async()=>({channelId:'c',id:'m'}),completeParticipationCall:async()=>{}};const service=new ParticipationCallService({queue,discord,timeoutSeconds:60});await service.start();await service.callEntry(entry.id);const before=queue.read().entries.find(x=>x.id===entry.id).callDeadline;await service.pause('test',{at:1000});assert.equal(service.state().paused,true);await service.resume('test',{at:61000});const after=queue.read().entries.find(x=>x.id===entry.id).callDeadline;assert.equal(after-before,60000);assert.equal(service.state().paused,false);const beforeDirect=queue.read().entries.find(x=>x.id===entry.id).callDeadline;await queue.extendCallDeadline(entry.id,{deltaMs:5000,reason:'test'});assert.equal(queue.read().entries.find(x=>x.id===entry.id).callDeadline,beforeDirect+5000);service.stop();
});

test('mobile recovery model is admin-only and surfaces verified restore/self-check state',()=>{
 const model=buildMobileRecoveryModel({version:'4.14.6',access:{role:'admin',user:'admin'},emergency:{locked:true,lockedAt:1000,reason:'점검'},recovery:{restorePoints:[{id:'p',label:'보호',createdAt:2,recordCount:4,revision:9,integrity:true}],auditLog:[]},selfCheck:{ok:false,counts:{pass:4,warn:1,fail:0},checks:[]}});assert.equal(model.allowed,true);assert.equal(model.restorePoints[0].integrity,true);assert.equal(recoveryStatusLabel(model),'긴급 잠금');
 const operator=buildMobileRecoveryModel({access:{role:'operator'},emergency:{}});assert.equal(operator.allowed,false);
});

test('recovery APIs/assets stay administrator-only while mobile script can load for operators',()=>{
 assert.equal(dashboardCapabilityForRequest('GET','/api/mobile-recovery'),null);assert.equal(dashboardCapabilityForRequest('POST','/api/emergency/lock'),null);assert.equal(operatorStaticAllowed('/mobile-recovery-model.js'),true);
 const html=fs.readFileSync(new URL('../public/mobile-control.html',import.meta.url),'utf8'),js=fs.readFileSync(new URL('../public/mobile-control.js',import.meta.url),'utf8'),server=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),viewer=fs.readFileSync(new URL('../src/viewer.js',import.meta.url),'utf8'),interactions=fs.readFileSync(new URL('../src/interactions.js',import.meta.url),'utf8');
 for(const id of ['mobileTabRecovery','mobileRecoveryView','recoveryLock','recoveryUnlock','recoveryCheckpoint','recoveryPoints','recoveryAudit'])assert.match(html,new RegExp(`id=\"${id}\"`));
 assert.match(js,/\/api\/mobile-recovery/);assert.match(js,/\/api\/emergency\/lock/);assert.match(js,/prepareRecoveryApproval/);assert.match(server,/EMERGENCY_LOCKED/);assert.match(server,/auto-emergency-lock/);assert.match(server,/participationCalls\?\.pause/);assert.match(viewer,/EMERGENCY_LOCKED/);assert.match(interactions,/긴급 잠금 상태/);assert.doesNotMatch(html,/on(click|change|submit)=/i);
});
