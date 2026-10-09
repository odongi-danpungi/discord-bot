import path from 'node:path';
import { mkdir, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { RegistrationStore } from './store.js';
import { OperationsStore } from './operations.js';
import { RecoveryStore } from './recovery-store.js';
import { DiscordPolicyStore } from './discord-policy.js';
import { IncidentWorkflowStore } from './incident-workflow.js';
import { PersistentIdempotencyStore } from './idempotency-store.js';
import { NaverAuthStore } from './naver-auth-store.js';
import { NaverService } from './naver-service.js';
import { NaverMonitorStore } from './naver-monitor-store.js';
import { NaverParticipationStore } from './naver-participation-store.js';
import { ParticipationQueueStore } from './participation-queue-store.js';
import { ParticipationCallService } from './participation-call-service.js';
import { BroadcastOpsStore } from './broadcast-ops-store.js';
import { ChzzkLiveStore } from './chzzk-live-store.js';
import { ChzzkService } from './chzzk-service.js';
import { ChzzkLiveMonitor } from './chzzk-live-monitor.js';
import { NaverCafeMonitor } from './naver-monitor.js';
import { ChzzkVerification, ChzzkVerificationStore } from './chzzk-verification.js';
import { DiscordService } from './discord-service.js';
import { installChzzkVerificationDiscord } from './chzzk-verification-discord.js';
import { createViewerAuth } from './viewer.js';
import { installInteractions } from './interactions.js';
import { createApp } from './app.js';
import { RuntimeHealth } from './runtime-health.js';
import { BackupRetention } from './production-readiness.js';
import { acquireProcessLock } from './process-lock.js';
import { hasMeaningfulOperations, migrateOperationsState } from './operations-guard.js';
import { APP_VERSION } from './version.js';
import { workspaceDirectory, workspaceError } from './workspace-policy.js';

export async function createWorkspaceRuntime({ baseConfig, entry, root, client, interactionBus, authenticate, viewerAuthenticate, operationGuard=()=>{} }) {
  const directory=workspaceDirectory(root,entry.guildId);
  await mkdir(directory,{recursive:true});
  if((await lstat(directory)).isSymbolicLink())throw workspaceError('작업 공간 저장 경로가 올바르지 않습니다.',503);
  const config={...baseConfig, demo:false, guildId:entry.guildId, workspaceScoped:true, adminRoleId:'',
    dashboardUser:'workspace-internal',dashboardPassword:randomBytes(32).toString('hex'),
    dashboardOperatorUser:'',dashboardOperatorPassword:'',
    broadcastToken:entry.broadcastToken, viewerUrl:new URL(`/w/${entry.guildId}/viewer/`,baseConfig.publicBaseUrl).href,
    naverCafeId:'',naverMenuId:'',naverMemoMenuId:'',naverMonitorEnabled:false,naverMonitorQuery:'',naverMonitorCafeUrl:'',
    chzzkChannelId:'',chzzkMonitorEnabled:false,chzzkVerifyRoleId:'',
    productionMonitorIntervalSeconds:0,...entry.settings};
  const paths={dataFile:'registrations',operationsFile:'operations',recoveryFile:'recovery',discordPolicyFile:'discord-policy',
    incidentWorkflowFile:'incidents',idempotencyFile:'idempotency',naverAuthFile:'naver-auth',naverMonitorFile:'naver-monitor',
    naverParticipationFile:'naver-participation',participationQueueFile:'participation-queue',broadcastOpsFile:'broadcast-ops',
    chzzkLiveFile:'chzzk-live',chzzkVerificationFile:'chzzk-verification'};
  for(const [key,file] of Object.entries(paths))config[key]=path.join(directory,file+'.json');
  config.backupDir=path.join(directory,'backups');
  const lock=await acquireProcessLock({file:config.operationsFile+'.pid'});
  const stores=[],health=new RuntimeHealth();let runtime,calls,cleanup;
  const create=(Type,file,...args)=>{const s=new Type(file,...args).setObserver(e=>health.recordPersistence(e));stores.push(s);return s;};
  try {
    const store=create(RegistrationStore,config.dataFile),operations=create(OperationsStore,config.operationsFile),
      recovery=create(RecoveryStore,config.recoveryFile),discordPolicy=create(DiscordPolicyStore,config.discordPolicyFile),
      incidentWorkflow=create(IncidentWorkflowStore,config.incidentWorkflowFile),idempotencyStore=create(PersistentIdempotencyStore,config.idempotencyFile),
      naverMonitorStore=create(NaverMonitorStore,config.naverMonitorFile,{}),naverParticipation=create(NaverParticipationStore,config.naverParticipationFile),
      queue=create(ParticipationQueueStore,config.participationQueueFile),broadcastOps=create(BroadcastOpsStore,config.broadcastOpsFile),
      liveStore=create(ChzzkLiveStore,config.chzzkLiveFile,{}),
      naverAuth=config.naverTokenKey&&config.naverRedirectUri?create(NaverAuthStore,config.naverAuthFile,config.naverTokenKey):null,
      chzzkAuth=config.chzzkVerifyEnabled?create(ChzzkVerificationStore,config.chzzkVerificationFile,config.chzzkTokenKey):null;
    for(const s of stores)await s.init();
    if(operations.read().guildId && operations.read().guildId!==config.guildId)throw workspaceError('방송 데이터의 서버가 일치하지 않습니다.',503);
    const before=operations.read(),records=store.read().filter(r=>r.guildId===config.guildId);
    if(before.appVersion!==APP_VERSION&&hasMeaningfulOperations(before,records.length))await recovery.checkpoint({records,operations:before,label:'방송별 업데이트 전 보호',reason:'auto-before-update',guildId:config.guildId});
    await operations.update(state=>Object.assign(state,migrateOperationsState(state,{guildId:config.guildId,appVersion:APP_VERSION}).state));
    if(!recovery.read().restorePoints.length||lock.previousCrash)await recovery.checkpoint({records,operations:operations.read(),label:lock.previousCrash?'비정상 종료 후 방송 보호':'방송 초기 보호',reason:lock.previousCrash?'auto-after-unclean-shutdown':'initial',guildId:config.guildId});
    await Promise.all([naverMonitorStore.recoverPending(),naverParticipation.recoverPending(),liveStore.recoverPending(),idempotencyStore.recoverPreviousBoot({bootId:lock.instanceId})]);
    await queue.syncOperations({operationsState:operations.read(),records:store.read().filter(r=>r.guildId===config.guildId)});
    await queue.syncNaver(naverParticipation.summary());
    health.attachAudit(e=>recovery.audit(e)).seedFromAudit(recovery.read().auditLog);
    const recovered=stores.flatMap(s=>s.integrityRecovery||[]);
    if(lock.previousCrash||recovered.length)await recovery.audit({category:'system',action:'workspace_recovery',actor:'system',summary:'방송별 저장 상태 복구 점검',details:{integrityRecoveries:recovered.length,unclean:Boolean(lock.previousCrash)}});
    const reporter=e=>health.recordDiscord(e),discord=new DiscordService(client,config.guildId,operations,reporter),viewerAuth=createViewerAuth();
    installChzzkVerificationDiscord(DiscordService);
    const guard=()=>{operationGuard();if(recovery.emergencyState().locked)throw workspaceError('방송 운영이 일시 중지되었습니다.',423);};
    calls=new ParticipationCallService({queue,discord,guard,timeoutSeconds:config.participationCallTimeoutSeconds,audit:e=>recovery.audit(e),reporter,paused:recovery.emergencyState().locked});
    const naver=new NaverService({config,authStore:naverAuth}),naverMonitor=new NaverCafeMonitor({store:naverMonitorStore,naver,discord,guard,audit:e=>recovery.audit(e)}),
      chzzk=new ChzzkService({clientId:config.chzzkClientId,clientSecret:config.chzzkClientSecret}),
      chzzkLiveMonitor=new ChzzkLiveMonitor({store:liveStore,chzzk,discord,guard,audit:e=>recovery.audit(e)}),
      chzzkVerification=chzzkAuth?new ChzzkVerification({config,store:chzzkAuth,discord,guard:()=>{if(recovery.emergencyState().locked)throw workspaceError('방송 운영이 일시 중지되었습니다.',423);}}):null;
    const backupManager=new BackupRetention({dir:config.backupDir,keepCount:config.backupKeepCount,maxAgeDays:config.backupMaxAgeDays,minimumIntervalHours:config.backupIntervalHours});await backupManager.init();await backupManager.ensureRecent({guildId:config.guildId,records,operations:operations.read()});
    const context={config,store,operations,recovery,discord,discordPolicy,incidentWorkflow,idempotencyStore,naver,naverMonitor,naverParticipation,
      participationQueue:queue,participationCalls:calls,broadcastOps,chzzkLiveMonitor,chzzkVerification,viewerAuth,
      instanceId:lock.instanceId,runtimeHealth:health,backupManager,workspaceAuthenticate:authenticate,workspaceViewerAuthenticate:viewerAuthenticate,workspaceOperationGuard:operationGuard};
    runtime=createApp(context);
    const tick=runtime.tick;runtime.tick=async()=>{
      let permitted=true;try{guard();}catch{permitted=false;}
      if(!permitted){if(!calls.paused)await calls.pause('workspace-guard');return;}
      if(calls.paused&&calls.pauseReason==='workspace-guard')await calls.resume('workspace-resume');
      await tick();
    };
    cleanup=installInteractions({...context,client:interactionBus,emergencyState:()=>{try{operationGuard();return recovery.emergencyState();}catch{return {locked:true};}}});
    await calls.start();await lock.update({phase:'running',revision:Number(operations.read().revision)||0});
    return {runtime,context,async close(){
      runtime.beginShutdown('workspace-shutdown');calls.stop();cleanup();runtime.close();
      let timeout;
      try{
        await Promise.race([
          (async()=>{await calls.chain.catch(()=>{});await discord.queue.catch(()=>{});while(naverMonitor.busy||chzzkLiveMonitor.busy)await new Promise(r=>setTimeout(r,50));})(),
          new Promise((_,reject)=>{timeout=setTimeout(()=>reject(workspaceError('방송 종료 대기 시간이 초과되었습니다.',503)),10000);})
        ]);
        for(const s of stores)await s.flush?.();
        await lock.release();
      }finally{clearTimeout(timeout);health.close();}
    }};
  } catch(error) {
    cleanup?.();calls?.stop();runtime?.close();health.close();
    for(const s of stores)await s.flush?.().catch(()=>{});
    await lock.release().catch(()=>{});throw error;
  }
}
