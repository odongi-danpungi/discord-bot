import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RegistrationStore } from './store.js';
import { OperationsStore } from './operations.js';
import { inspectBackup, recoveryDigest } from './recovery-audit.js';
import { migrateOperationsState, repairOperationsConsistency } from './operations-guard.js';
import { RestoreTransactionCoordinator } from './restore-transaction.js';
import { APP_VERSION } from './version.js';

export async function runRecoveryDrill({backupManager,guildId,appVersion=APP_VERSION,now=Date.now()}={}){
  const startedAt=Date.now(),summary=await backupManager.summary(now),candidate=summary.latestValid;
  if(!candidate)return {status:'fail',startedAt,finishedAt:Date.now(),durationMs:Date.now()-startedAt,backup:null,checks:[{id:'backup',status:'fail',detail:'복구 훈련에 사용할 정상/레거시 백업이 없습니다.'}]};
  const bundle=await backupManager.readVerified(candidate.file),inspection=inspectBackup(bundle,guildId),checks=[{id:'backup',status:inspection.ok?'pass':'fail',detail:inspection.ok?`${candidate.file} · ${candidate.integrity}`:'백업 검증 실패'}];
  if(!inspection.ok)return {status:'fail',startedAt,finishedAt:Date.now(),durationMs:Date.now()-startedAt,backup:candidate.file,checks};
  const migrated=migrateOperationsState(bundle.operations,{guildId,appVersion}),repaired=repairOperationsConsistency(migrated.state,{now});checks.push({id:'migration',status:'pass',detail:migrated.changed?`schema/app version 정규화 ${migrated.changes.length}건`:'추가 마이그레이션 없음'});checks.push({id:'consistency',status:'pass',detail:repaired.changed?`운영 상태 일관성 보정 ${repaired.changes.length}건`:'운영 상태 일관성 정상'});
  const temp=await mkdtemp(path.join(os.tmpdir(),'daengdaeng-recovery-drill-'));
  try{
    const store=new RegistrationStore(path.join(temp,'registrations.json')),operations=new OperationsStore(path.join(temp,'operations.json'));await store.init();await operations.init();
    const coordinator=new RestoreTransactionCoordinator({file:path.join(temp,'restore-transaction.json'),guildId,store,operations});
    const targetOperations=structuredClone(repaired.state);targetOperations.appVersion=appVersion;
    const transaction=await coordinator.execute({label:'복구 훈련',reason:'drill',buildTarget:()=>({records:bundle.records,operations:targetOperations})});
    const reopenedStore=new RegistrationStore(path.join(temp,'registrations.json')),reopenedOperations=new OperationsStore(path.join(temp,'operations.json'));await reopenedStore.init();await reopenedOperations.init();
    const restoredRecords=reopenedStore.read().filter(record=>record.guildId===guildId),restoredOperations=reopenedOperations.read(),expected=recoveryDigest(bundle.records,targetOperations),actual=recoveryDigest(restoredRecords,restoredOperations),roundTripOk=expected===actual;
    checks.push({id:'transaction',status:transaction.status==='committed'?'pass':'fail',detail:transaction.status==='committed'?'트랜잭션 저널 기반 복원 완료':transaction.status});checks.push({id:'round-trip',status:roundTripOk?'pass':'fail',detail:roundTripOk?`재시작 재로딩 SHA-256 일치 · ${actual.slice(0,12)}…`:'복원 후 재로딩 데이터가 대상과 다릅니다.'});
    const status=checks.some(check=>check.status==='fail')?'fail':candidate.integrity==='legacy'?'warn':'pass';if(candidate.integrity==='legacy')checks.push({id:'legacy',status:'warn',detail:'레거시 v2 백업으로 훈련했습니다. v3 SHA-256 백업을 우선 사용하세요.'});
    return {status,startedAt,finishedAt:Date.now(),durationMs:Date.now()-startedAt,backup:candidate.file,backupIntegrity:candidate.integrity,targetDigest:actual,records:restoredRecords.length,revision:Number(restoredOperations.revision)||0,migrationChanges:migrated.changes.length,consistencyChanges:repaired.changes.length,checks};
  }catch(error){checks.push({id:'sandbox-restore',status:'fail',detail:String(error?.message||error).slice(0,180)});return {status:'fail',startedAt,finishedAt:Date.now(),durationMs:Date.now()-startedAt,backup:candidate.file,checks};}
  finally{await rm(temp,{recursive:true,force:true}).catch(()=>{});}
}
