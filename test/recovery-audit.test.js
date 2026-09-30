import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildLocalSelfCheck, createRestorePoint, inspectBackup, verifyRestorePoint } from '../src/recovery-audit.js';
import { RecoveryStore } from '../src/recovery-store.js';

const records=[{guildId:'guild',discordId:'u1',chzzkName:'별1'},{guildId:'guild',discordId:'u2',chzzkName:'별2'}];
const operations={guildId:'guild',revision:7,session:null,history:[],reservations:[],sessionArchive:[],rounds:{}};

test('full backup verification rejects another guild and duplicate registrations',()=>{
 const good=inspectBackup({version:2,guildId:'guild',exportedAt:new Date().toISOString(),records,operations},'guild');
 assert.equal(good.ok,true);assert.equal(good.stats.records,2);assert.match(good.digest,/^[a-f0-9]{64}$/);
 const wrong=inspectBackup({version:2,guildId:'other',records:[records[0],records[0]],operations},'guild');
 assert.equal(wrong.ok,false);assert.ok(wrong.checks.some(c=>c.id==='guild'&&c.status==='fail'));assert.ok(wrong.checks.some(c=>c.id==='duplicates'&&c.status==='fail'));
 const poisoned=JSON.parse(JSON.stringify({version:2,guildId:'guild',records,operations}).replace('\"history\":[]','\"history\":[],\"__proto__\":{\"polluted\":true}'));
 assert.equal(inspectBackup(poisoned,'guild').ok,false);
 const newer=inspectBackup({version:2,guildId:'guild',records,operations:{...operations,schemaVersion:999}},'guild');
 assert.equal(newer.ok,false);assert.ok(newer.checks.some(c=>c.id==='schema'&&c.status==='fail'));
});

test('restore point digest detects tampering',()=>{
 const point=createRestorePoint({records,operations,label:'방송 전',guildId:'guild',at:1000});
 assert.equal(verifyRestorePoint(point,'guild').ok,true);
 point.records[0].chzzkName='변조';
 assert.equal(verifyRestorePoint(point,'guild').ok,false);
});

test('self-check reports broken session references and unsafe remote broadcast exposure',()=>{
 const bad={...operations,session:{phase:'checking',applicants:['u1'],winners:['u2'],confirmed:['u2'],teams:[['u2']]}};
 const result=buildLocalSelfCheck({config:{guildId:'guild',host:'0.0.0.0',broadcastToken:''},records,operations:bad,recovery:{restorePoints:[],auditLog:[]},nodeVersion:'v22.22.2'});
 assert.equal(result.ok,false);assert.ok(result.checks.some(c=>c.id==='session-integrity'&&c.status==='fail'));assert.ok(result.checks.some(c=>c.id==='broadcast-token'&&c.status==='fail'));
});

test('RecoveryStore persists checkpoints and bounded audit metadata',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'recovery-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new RecoveryStore(path.join(dir,'recovery.json'));await store.init();
 const point=await store.checkpoint({records,operations,label:'수동',guildId:'guild'});assert.ok(point.id.startsWith('rp_'));
 await store.audit({category:'recovery',action:'checkpoint_create',summary:'복원 지점 생성',actor:'admin',details:{token:'SHOULD_NOT_SAVE',count:2}});
 const summary=store.summary('guild');assert.equal(summary.restorePoints.length,1);assert.equal(summary.restorePoints[0].integrity,true);assert.equal(summary.auditLog.length,1);assert.equal(summary.auditLog[0].details.token,undefined);assert.equal(summary.auditLog[0].details.count,2);
});
