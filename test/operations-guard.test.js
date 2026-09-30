import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingsDiff, createApprovalGuard, migrateOperationsState, migrationPreview } from '../src/operations-guard.js';
import { DATA_SCHEMA_VERSION } from '../src/version.js';

const legacy={guildId:'guild',revision:4,session:null,history:[],reservations:[],sessionArchive:[],rounds:{}};

test('legacy operations migrate to current schema without dropping core state',()=>{
 const result=migrateOperationsState(legacy,{guildId:'guild',appVersion:'3.7.0'});
 assert.equal(result.to,DATA_SCHEMA_VERSION);assert.equal(result.state.schemaVersion,DATA_SCHEMA_VERSION);assert.equal(result.state.appVersion,'3.7.0');assert.equal(result.state.revision,4);
 for(const key of ['history','reservations','sessionArchive','requests','draws','avatars'])assert.ok(Array.isArray(result.state[key]));
 assert.equal(migrationPreview(result.state,{guildId:'guild',appVersion:'3.7.0'}).needed,false);
});

test('migration rejects data from a newer schema',()=>{
 assert.throws(()=>migrateOperationsState({...legacy,schemaVersion:DATA_SCHEMA_VERSION+1},{guildId:'guild',appVersion:'3.7.0'}),/더 최신 프로그램/);
});

test('settings diff only reports supported non-secret operational settings',()=>{
 const diff=buildSettingsDiff({broadcastSettings:{theme:'midnight'},token:'secret'},{broadcastSettings:{theme:'aurora'},token:'changed'});
 assert.equal(diff.length,1);assert.equal(diff[0].path,'broadcastSettings.theme');assert.ok(!JSON.stringify(diff).includes('secret'));
});

test('two-step approval is one-time, action-bound and target-bound',()=>{
 const guard=createApprovalGuard({ttlMs:5000}),approval=guard.prepare('restore-point','point:a:hash');
 assert.throws(()=>guard.consume(approval.approvalId,approval.phrase,'restore-point','point:b:hash'),/실제 요청/);
 const approval2=guard.prepare('restore-point','point:a:hash');assert.equal(guard.consume(approval2.approvalId,approval2.phrase,'restore-point','point:a:hash'),true);
 assert.throws(()=>guard.consume(approval2.approvalId,approval2.phrase,'restore-point','point:a:hash'),/없거나 만료/);
});
