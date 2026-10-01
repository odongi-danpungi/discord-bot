import { createViewerAuth } from './viewer.js';
import { ChzzkVerification, ChzzkVerificationStore } from './chzzk-verification.js';
import { installChzzkVerificationDiscord } from './chzzk-verification-discord.js';
import 'dotenv/config';
import { Client, Events, GatewayIntentBits, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { RegistrationStore } from './store.js';
import { OperationsStore } from './operations.js';
import { RecoveryStore } from './recovery-store.js';
import { loadConfig } from './config.js';
import { DiscordService, DemoDiscordService } from './discord-service.js';
import { installInteractions } from './interactions.js';
import { createApp } from './app.js';
import { buildLocalSelfCheck } from './recovery-audit.js';
import { hasMeaningfulOperations, migrateOperationsState } from './operations-guard.js';
import { APP_VERSION, DATA_SCHEMA_VERSION } from './version.js';
import { RuntimeHealth } from './runtime-health.js';
import { BackupRetention, runStartupPreflight } from './production-readiness.js';
import { buildProductionEnvironmentValidation, assertProductionEnvironment } from './production-environment.js';
import { ReleaseCenter } from './release-center.js';
import { DiscordPolicyStore } from './discord-policy.js';
import { IncidentWorkflowStore } from './incident-workflow.js';
import { PersistentIdempotencyStore } from './idempotency-store.js';
import { acquireProcessLock } from './process-lock.js';
import { NaverAuthStore } from './naver-auth-store.js';
import { NaverService } from './naver-service.js';
import { NaverMonitorStore } from './naver-monitor-store.js';
import { NaverParticipationStore } from './naver-participation-store.js';
import { ParticipationQueueStore } from './participation-queue-store.js';
import { ParticipationCallService } from './participation-call-service.js';
import { ChzzkLiveStore } from './chzzk-live-store.js';
import { ChzzkService } from './chzzk-service.js';
import { ChzzkLiveMonitor } from './chzzk-live-monitor.js';
import { BroadcastOpsStore } from './broadcast-ops-store.js';
import { NaverCafeMonitor } from './naver-monitor.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let client,server,timer,cleanupInteractions,runtime,runtimeHealth,backupManager,releaseCenter,startupPreflight,startupEnvironmentValidation,processLock,operationsRef,participationCalls;
let persistentStores=[],shuttingDown=false,fatalHandling=false;

async function flushPersistentStores(){
  for(const store of persistentStores)await store.flush?.();
}

async function main(){
  const config=await loadConfig();
  startupEnvironmentValidation=buildProductionEnvironmentValidation({config});
  assertProductionEnvironment(startupEnvironmentValidation);
  processLock=await acquireProcessLock({file:path.resolve(config.operationsFile)+'.pid'});
  const instanceId=processLock.instanceId,previousCrash=processLock.previousCrash;
  runtimeHealth=new RuntimeHealth();
  backupManager=new BackupRetention({dir:config.backupDir,keepCount:config.backupKeepCount,maxAgeDays:config.backupMaxAgeDays,minimumIntervalHours:config.backupIntervalHours});await backupManager.init();
  const persistenceObserver=event=>runtimeHealth.recordPersistence(event);
  const store=new RegistrationStore(config.dataFile).setObserver(persistenceObserver),operations=new OperationsStore(config.operationsFile).setObserver(persistenceObserver),recovery=new RecoveryStore(config.recoveryFile).setObserver(persistenceObserver),discordPolicy=new DiscordPolicyStore(config.discordPolicyFile).setObserver(persistenceObserver),incidentWorkflow=new IncidentWorkflowStore(config.incidentWorkflowFile).setObserver(persistenceObserver),idempotencyStore=new PersistentIdempotencyStore(config.idempotencyFile).setObserver(persistenceObserver),naverMonitorStore=new NaverMonitorStore(config.naverMonitorFile,{enabled:config.naverMonitorEnabled,query:config.naverMonitorQuery,cafeUrl:config.naverMonitorCafeUrl,intervalMinutes:config.naverMonitorIntervalMinutes,discordAlerts:config.naverMonitorDiscordAlerts}).setObserver(persistenceObserver),naverParticipationStore=new NaverParticipationStore(config.naverParticipationFile).setObserver(persistenceObserver),participationQueueStore=new ParticipationQueueStore(config.participationQueueFile).setObserver(persistenceObserver),broadcastOpsStore=new BroadcastOpsStore(config.broadcastOpsFile).setObserver(persistenceObserver),chzzkLiveStore=new ChzzkLiveStore(config.chzzkLiveFile,{enabled:config.chzzkMonitorEnabled,channelId:config.chzzkChannelId,intervalMinutes:config.chzzkMonitorIntervalMinutes,discordAlerts:config.chzzkMonitorDiscordAlerts,maxPages:config.chzzkLiveScanMaxPages}).setObserver(persistenceObserver);
  const naverAuthStore=config.naverRedirectUri&&config.naverTokenKey?new NaverAuthStore(config.naverAuthFile,config.naverTokenKey).setObserver(persistenceObserver):null;
  const chzzkAuthStore=config.chzzkVerifyEnabled?new ChzzkVerificationStore(config.chzzkVerificationFile,config.chzzkTokenKey).setObserver(persistenceObserver):null;
  persistentStores=[store,operations,recovery,discordPolicy,incidentWorkflow,idempotencyStore,naverMonitorStore,naverParticipationStore,participationQueueStore,broadcastOpsStore,chzzkLiveStore,...(naverAuthStore?[naverAuthStore]:[])];operationsRef=operations;
  await store.init();await operations.init();await recovery.init();await discordPolicy.init();await incidentWorkflow.init();await idempotencyStore.init();await naverMonitorStore.init();await naverParticipationStore.init();await participationQueueStore.init();await broadcastOpsStore.init();await chzzkLiveStore.init();if(naverAuthStore)await naverAuthStore.init();
  if(chzzkAuthStore){persistentStores.push(chzzkAuthStore);await chzzkAuthStore.init();}
  const naverMonitorPending=await naverMonitorStore.recoverPending();
  const naverParticipationPending=await naverParticipationStore.recoverPending();
  const chzzkLivePending=await chzzkLiveStore.recoverPending();
  await participationQueueStore.syncOperations({operationsState:operations.read(),records:store.read().filter(r=>r.guildId===config.guildId)});
  await participationQueueStore.syncNaver(naverParticipationStore.summary());
  const idempotencyRecovery=await idempotencyStore.recoverPreviousBoot({bootId:instanceId});
  await processLock.update({phase:'data-ready',revision:Number(operations.read().revision)||0});
  releaseCenter=new ReleaseCenter({projectRoot:fileURLToPath(new URL('../',import.meta.url)),stateDir:path.join(path.dirname(config.operationsFile),'releases'),currentVersion:APP_VERSION,currentSchema:DATA_SCHEMA_VERSION});await releaseCenter.init();
  if(releaseCenter.recoveredThisBoot)throw Object.assign(Error('중단된 코드 업데이트를 rollback snapshot에서 자동 복구했습니다. 메모리에 이미 로드된 코드와 디스크 코드가 다를 수 있으므로 START.cmd를 한 번 더 실행해 주세요.'),{code:'ERESTART_REQUIRED'});
  if(releaseCenter.snapshot().status==='transaction-recovery-incomplete')throw Object.assign(Error('중단된 코드 업데이트 자동 복원이 완전하지 않습니다. data/releases의 rollback snapshot을 보존한 채 검토가 필요합니다.'),{code:'ERELEASE_RECOVERY'});
  runtimeHealth.attachAudit(event=>recovery.audit(event)).seedFromAudit(recovery.read().auditLog);
  const integrityRecoveries=persistentStores.flatMap(store=>(store.integrityRecovery||[]).map(item=>({file:path.basename(store.file),...item})));
  if(integrityRecoveries.length){
    const byAction=integrityRecoveries.reduce((map,item)=>{map[item.action]=(map[item.action]||0)+1;return map;},{});
    await recovery.audit({category:'system',action:'data_file_integrity_recovery',summary:`데이터 파일 무결성 복구/격리 · ${integrityRecoveries.length}건`,actor:'system',details:{total:integrityRecoveries.length,backupRecovery:byAction.backup_recovery||0,backupRepaired:byAction.backup_repaired||0,temporarySalvage:byAction.temporary_salvage||0,temporaryQuarantined:byAction.temporary_quarantined||0}});
  }
  if(operations.consistencyRecovered){
    await recovery.audit({category:'system',action:'operations_consistency_recovery',summary:`예약/추첨/session 상태 일관성 자동 복구 · ${operations.consistencyChanges.length}건`,actor:'system',details:{changes:operations.consistencyChanges.slice(0,20)}});
    runtimeHealth.recordIncident({severity:'warn',source:'storage',code:'operations_consistency_recovered',summary:'운영 상태 일관성 자동 복구 완료',detail:operations.consistencyChanges.join(' · '),persist:false});
  }
  startupPreflight=await runStartupPreflight({config,checkPort:true});
  if(!startupPreflight.ok){const failed=startupPreflight.checks.filter(check=>check.status==='fail').map(check=>check.label).join(', ');throw Error(`배포 전 시작 점검 실패: ${failed}. 설정과 파일 권한을 확인해 주세요.`);}
  const state=operations.read();
  if(state.guildId&&state.guildId!==config.guildId)throw Error('운영 데이터의 서버 ID가 다릅니다. 새 서버에는 별도의 데이터 경로를 사용해 주세요.');
  if(!state.guildId)await operations.update(s=>{s.guildId=config.guildId;});
  let updatePerformed=false,updateMeta=null;
  {
    const before=operations.read(),guildRecords=store.read().filter(r=>r.guildId===config.guildId),previousVersion=before.appVersion||'legacy';
    const needsUpdate=previousVersion!==APP_VERSION||(Number(before.schemaVersion)||1)!==DATA_SCHEMA_VERSION;
    if(needsUpdate){
      if(hasMeaningfulOperations(before,guildRecords.length)){
        await recovery.checkpoint({records:guildRecords,operations:before,label:`업데이트 전 자동 보호 · ${previousVersion} → ${APP_VERSION}`,reason:'auto-before-update',guildId:config.guildId});
        await recovery.audit({category:'system',action:'pre_update_checkpoint',summary:`업데이트 전 자동 복원 지점 생성 · ${previousVersion} → ${APP_VERSION}`,actor:'system'});
      }
      const migrated=migrateOperationsState(before,{guildId:config.guildId,appVersion:APP_VERSION}),updatedAt=Date.now();
      await operations.update(next=>{for(const key of Object.keys(next))delete next[key];Object.assign(next,migrated.state);next.revision=(Number(next.revision)||0)+1;next.safeDeploy={...(before.safeDeploy||{}),previousVersion,version:APP_VERSION,updatedAt,schemaFrom:migrated.from,schemaTo:migrated.to,migrationChanges:migrated.changes,postUpdateCheck:null};});
      updatePerformed=true;updateMeta={previousVersion,migrated,updatedAt};
      await recovery.audit({category:'system',action:'data_migration',summary:`데이터 스키마 점검 · v${migrated.from} → v${migrated.to}`,actor:'system',details:{changes:migrated.changes.length}});
    }
  }
  if(config.demo&&!store.read().length){
    for(let i=1;i<=20;i++)await store.upsert({guildId:'demo',discordId:'demo-'+i,discordUsername:'연습 참가자 '+i,chzzkName:'연습별'+i,erNickname:'ER연습'+i,erCurrentTier:['실버','골드','다이아몬드'][i%3],erPeakTier:'다이아몬드',lolRiotId:`연습${i}#KR1`,lolMainLane:['탑','정글','미드','원딜','서폿'][i%5],lolCurrentTier:['실버 2','골드 1','에메랄드 3'][i%3],lolPeakTier:'다이아몬드 4',updatedAt:new Date().toISOString()});
  }
  if(previousCrash){
    const phase=previousCrash.phase||'unknown',revision=Number(operations.read().revision)||0;
    await recovery.checkpoint({records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read(),label:`비정상 종료 후 자동 보호 · ${phase}`,reason:'auto-after-unclean-shutdown',guildId:config.guildId});
    await recovery.audit({category:'system',action:'unclean_shutdown_recovery',summary:`비정상 종료 감지 후 저장 상태 검증 완료 · ${phase}`,actor:'system',details:{previousPhase:phase,lastKnownRevision:previousCrash.lastKnownRevision,currentRevision:revision,uncertainRequests:idempotencyRecovery.uncertain}});
    runtimeHealth.recordIncident({severity:'warn',source:'system',code:'unclean_shutdown_recovered',summary:'비정상 종료 감지 후 상태 복구 완료',detail:`이전 단계 ${phase} · 미확정 요청 ${idempotencyRecovery.uncertain}건`,persist:false});
    await processLock.update({phase:'recovered',revision});
  }else if(idempotencyRecovery.uncertain){
    await recovery.audit({category:'system',action:'idempotency_recovery',summary:`이전 실행의 미완료 API 요청 ${idempotencyRecovery.uncertain}건을 재실행 차단 상태로 전환`,actor:'system',details:{uncertainRequests:idempotencyRecovery.uncertain}});
    runtimeHealth.recordIncident({severity:'warn',source:'api',code:'idempotency_recovery',summary:'이전 실행의 미완료 API 요청 보호',detail:`${idempotencyRecovery.uncertain}건을 미확정 상태로 유지`,persist:false});
  }
  if(!recovery.read().restorePoints.length){
    await recovery.checkpoint({records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read(),label:'v4.11 초기 보호 지점',reason:'initial',guildId:config.guildId});
    await recovery.audit({category:'system',action:'initial_checkpoint',summary:'Release Center 초기 보호 지점 생성',actor:'system'});
  }
  {const backup=await backupManager.ensureRecent({guildId:config.guildId,records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read()});if(backup.created)await recovery.audit({category:'system',action:'scheduled_backup',summary:`자동 배포 백업 생성 · ${backup.latest.file}`,actor:'system',details:{bytes:backup.latest.bytes}});}
  const viewerAuth=createViewerAuth();
  const naver=new NaverService({config,authStore:naverAuthStore,reporter:event=>runtimeHealth.recordApi({method:'NAVER',path:`naver:${event.operation||'api'}`,status:event.ok?200:(Number(event.status)||502),durationMs:Number(event.durationMs)||0})});
  const chzzk=new ChzzkService({clientId:config.chzzkClientId,clientSecret:config.chzzkClientSecret});
  let discord;
  const discordReporter=event=>runtimeHealth.recordDiscord(event);
  if(config.demo)discord=new DemoDiscordService(discordReporter);
  else {
    client=new Client({intents:[GatewayIntentBits.Guilds]});
    discord=new DiscordService(client,config.guildId,operations,discordReporter);
    client.on('error',error=>{runtimeHealth.recordDiscord({operation:'gateway',ok:false,error});console.error('Discord 연결 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.');});
    const ready=new Promise(resolve=>client.once(Events.ClientReady,resolve));
    await client.login(config.token);await ready;
    if(client.user.id!==config.clientId)throw Error('토큰과 애플리케이션 ID가 서로 다릅니다.');
    const settingCommand={name:'setting',description:'카테고리·채널과 연동 패널을 자동 설정합니다'};
    if(!config.adminRoleId)settingCommand.default_member_permissions=PermissionFlagsBits.ManageGuild.toString();
    await new REST({version:'10'}).setToken(config.token).put(Routes.applicationGuildCommands(config.clientId,config.guildId),{body:[
      {name:'연동',description:'내 치지직·게임 정보를 등록하거나 수정합니다'},
      settingCommand
    ]});
    console.log('Discord bot ready: '+client.user.username);
  }
  const startupEmergency=recovery.emergencyState();participationCalls=new ParticipationCallService({queue:participationQueueStore,discord,timeoutSeconds:config.participationCallTimeoutSeconds,audit:event=>recovery.audit({...event,actor:'system'}),reporter:event=>runtimeHealth.recordDiscord(event),paused:startupEmergency.locked,pausedAt:startupEmergency.lockedAt});
  let chzzkVerification = null;
  if (chzzkAuthStore) {
    installChzzkVerificationDiscord(DiscordService);
    chzzkVerification = new ChzzkVerification({ config, store: chzzkAuthStore, discord, guard: () => {
      if (shuttingDown || recovery.emergencyState().locked) throw Object.assign(Error('인증 작업이 운영 잠금 상태입니다.'), { status: 423 });
    } });
  }
  if(!config.demo)cleanupInteractions=installInteractions({client,config,store,operations,discord,viewerAuth,chzzkVerification,participationQueue:participationQueueStore,participationCalls,emergencyState:()=>recovery.emergencyState()});
  await participationCalls.start();
  const naverMonitor=new NaverCafeMonitor({store:naverMonitorStore,naver,discord,reporter:event=>runtimeHealth.recordApi({method:'NAVER',path:`naver:${event.operation||'monitor'}`,status:event.ok?200:(Number(event.status)||502),durationMs:Number(event.durationMs)||0}),audit:event=>recovery.audit({...event,actor:'system'})});
  const chzzkLiveMonitor=new ChzzkLiveMonitor({store:chzzkLiveStore,chzzk,discord,reporter:event=>runtimeHealth.recordApi({method:'CHZZK',path:`chzzk:${event.operation||'live-scan'}`,status:event.ok?(Number(event.status)||200):(Number(event.status)||502),durationMs:Number(event.durationMs)||0}),audit:event=>recovery.audit({...event,actor:'system'})});
  if(naverMonitorPending){await recovery.audit({category:'naver',action:'monitor_recovery',summary:`이전 실행의 네이버 Discord 알림 ${naverMonitorPending}건을 미확정 상태로 복구`,actor:'system',details:{uncertain:naverMonitorPending}});runtimeHealth.recordIncident({severity:'warn',source:'naver',code:'naver_monitor_uncertain',summary:'네이버 카페 알림 전송 결과 미확정',detail:`${naverMonitorPending}건은 중복 알림 방지를 위해 자동 재전송하지 않았습니다.`,persist:false});}
  if(naverParticipationPending){await recovery.audit({category:'naver',action:'participation_publish_recovery',summary:'칼바람 시참 메모 게시 결과를 미확정 상태로 복구',actor:'system'});runtimeHealth.recordIncident({severity:'warn',source:'naver',code:'naver_participation_publish_uncertain',summary:'칼바람 시참 메모 게시 결과 미확정',detail:'네이버 카페에서 게시 여부를 확인한 뒤 대시보드에서 초기화해 주세요.',persist:false});}
  if(chzzkLivePending){await recovery.audit({category:'broadcast',action:'chzzk_alert_recovery',summary:`이전 실행의 치지직 방송 알림 ${chzzkLivePending}건을 미확정 상태로 복구`,actor:'system',details:{uncertain:chzzkLivePending}});runtimeHealth.recordIncident({severity:'warn',source:'chzzk',code:'chzzk_alert_uncertain',summary:'치지직 방송 알림 전송 결과 미확정',detail:`${chzzkLivePending}건은 중복 알림 방지를 위해 자동 재전송하지 않았습니다.`,persist:false});}
  if(updatePerformed){
    const local=buildLocalSelfCheck({config,records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read(),recovery:recovery.read(),recovered:store.recovered||operations.recovered||recovery.recovered});
    let discordStatus='warn',discordDetail='Discord 진단을 확인하지 못했습니다.';
    try{const d=await discord.diagnostics();discordStatus=config.demo||d.connected?'pass':'warn';discordDetail=config.demo?'연습 모드 · Discord 연결 생략':d.message||d.warning||'Discord 상태 확인 필요';}catch{}
    const fail=local.counts.fail,warn=local.counts.warn+(discordStatus==='warn'?1:0),postUpdateCheck={at:Date.now(),status:fail?'fail':warn?'warn':'pass',pass:local.counts.pass+(discordStatus==='pass'?1:0),warn,fail,discord:discordDetail};
    await operations.update(s=>{s.safeDeploy={...(s.safeDeploy||{}),postUpdateCheck};});
    await recovery.audit({category:'system',action:'post_update_check',summary:`업데이트 후 자동 점검 · ${postUpdateCheck.status.toUpperCase()}`,actor:'system',details:{pass:postUpdateCheck.pass,warn:postUpdateCheck.warn,fail:postUpdateCheck.fail}});
    if(postUpdateCheck.status!=='pass')console.log(`업데이트 후 자동 점검: ${postUpdateCheck.status} (경고 ${warn}, 오류 ${fail}) · 대시보드 복구·감사 센터를 확인해 주세요.`);
    else console.log(`업데이트 후 자동 점검 완료: ${APP_VERSION} / schema v${DATA_SCHEMA_VERSION}`);
  }
  runtime=createApp({config,store,operations,recovery,discord,discordPolicy,incidentWorkflow,idempotencyStore,naver,naverMonitor,naverParticipation:naverParticipationStore,chzzkLiveMonitor,chzzkVerification,participationQueue:participationQueueStore,participationCalls,broadcastOps:broadcastOpsStore,viewerAuth,instanceId,runtimeHealth,backupManager,releaseCenter,startupPreflight,startupEnvironmentValidation});
  await new Promise((resolve,reject)=>{server=runtime.app.listen(config.port,config.host,resolve);server.once('error',reject);});
  if(previousCrash){
    try{await runtime.tick(Date.now());await recovery.audit({category:'system',action:'crash_catchup_tick',summary:'비정상 종료 후 예약 타이머 1회 즉시 재평가',actor:'system'});}
    catch(error){runtimeHealth.recordIncident({severity:'warn',source:'scheduler',code:'crash_catchup_failure',summary:'비정상 종료 후 자동 타이머 재평가 실패',detail:error?.message});}
  }
  await processLock.update({phase:'running',revision:Number(operations.read().revision)||0,signal:null});
  console.log(`Dashboard: http://127.0.0.1:${config.port}`);
  console.log(`Profile: ${config.profile} · Production Readiness ${startupPreflight.status.toUpperCase()} · Environment ${startupEnvironmentValidation.status.toUpperCase()}`);
  console.log(`Broadcast: http://127.0.0.1:${config.port}/broadcast/`);
  if(['restart-required','rollback-restart-required'].includes(releaseCenter.snapshot().status)){try{const smoke=await releaseCenter.smoke({operationsReadable:true,dataReadable:true});await recovery.audit({category:'system',action:'release_smoke_auto',summary:`배포 후 자동 Smoke Test · ${smoke.status.toUpperCase()}`,actor:'system',details:{version:APP_VERSION}});console.log(`Release Smoke Test: ${smoke.status.toUpperCase()}`);}catch(error){runtimeHealth.recordIncident({severity:'error',source:'system',code:'release_smoke_failure',summary:'배포 후 Smoke Test 실행 실패',detail:error?.message});}}
  if(config.demo)console.log('연습 모드입니다. Discord에 연결하거나 메시지를 보내지 않습니다.');
  if(store.recovered||operations.recovered||recovery.recovered||discordPolicy.recovered||incidentWorkflow.recovered||idempotencyStore.recovered||naverMonitorStore.recovered||naverParticipationStore.recovered||participationQueueStore.recovered||broadcastOpsStore.recovered||chzzkLiveStore.recovered||naverAuthStore?.recovered)console.log('데이터 파일 무결성 복구가 수행됐습니다. 대시보드의 복구·감사 센터에서 상태를 확인해 주세요.');
  timer=setInterval(()=>runtime.tick().catch(error=>{runtimeHealth.recordIncident({severity:'warn',source:'scheduler',code:'tick_unhandled',summary:'자동 마감 타이머 예외',detail:error?.message});console.error('자동 마감 상태를 확인해 주세요.');}),3000);timer.unref();
}
async function closeHttpServer(){
  if(!server)return true;
  const closed=new Promise(resolve=>server.close(()=>resolve('closed'))),timeout=new Promise(resolve=>setTimeout(()=>resolve('timeout'),10000));
  const result=await Promise.race([closed,timeout]);
  if(result==='timeout'){
    server.closeAllConnections?.();
    console.error('Graceful shutdown 제한 시간을 초과해 남은 HTTP 연결을 종료했습니다.');
    await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,1000))]);
    return false;
  }
  return true;
}

async function shutdown(signal='shutdown',{preserveMarker=false,startupFailure=false}={}){
  if(shuttingDown)return true;
  shuttingDown=true;clearInterval(timer);
  let clean=true;
  try{
    if(processLock?.owns)await processLock.update({phase:preserveMarker?'fatal':startupFailure?'startup-failed':'stopping',revision:Number(operationsRef?.read?.().revision)||0,signal:String(signal)});
  }catch(error){clean=false;console.error('프로세스 잠금 상태를 갱신하지 못했습니다:',error.code||error.message);}
  runtime?.beginShutdown?.(signal);participationCalls?.stop?.();cleanupInteractions?.();
  try{if(!await closeHttpServer())clean=false;}catch(error){clean=false;console.error('HTTP 종료 중 오류가 발생했습니다:',error.message);}
  runtime?.close?.();client?.destroy();
  try{await flushPersistentStores();}catch(error){clean=false;console.error('종료 전 데이터 flush에 실패했습니다:',error.code||error.message);}
  runtimeHealth?.close?.();
  if(processLock?.owns&&!preserveMarker){
    if(clean){try{await processLock.release();}catch(error){clean=false;console.error('프로세스 잠금 해제에 실패했습니다:',error.code||error.message);}}
    else{try{await processLock.update({phase:'shutdown-incomplete',revision:Number(operationsRef?.read?.().revision)||0,signal:String(signal)});}catch{}}
  }
  return clean;
}

async function fatalExit(kind,error){
  if(fatalHandling)return process.exit(1);
  fatalHandling=true;
  runtimeHealth?.recordIncident({severity:'error',source:'system',code:kind,summary:'치명적 런타임 오류로 안전 종료 시도',detail:error?.message||String(error)});
  try{await shutdown(kind,{preserveMarker:true});}catch{}
  process.exit(1);
}

process.once('SIGINT',()=>{shutdown('SIGINT').then(ok=>process.exit(ok?0:1)).catch(()=>process.exit(1));});
process.once('SIGTERM',()=>{shutdown('SIGTERM').then(ok=>process.exit(ok?0:1)).catch(()=>process.exit(1));});
process.once('uncaughtException',error=>{void fatalExit('uncaught_exception',error);});
process.once('unhandledRejection',reason=>{void fatalExit('unhandled_rejection',reason instanceof Error?reason:Error(String(reason)));});

main().catch(async error=>{
  runtimeHealth?.recordIncident({severity:'error',source:'system',code:'startup_failure',summary:'봇 시작 실패',detail:error?.message});
  const message=error.code==='EADDRINUSE'?'대시보드 포트가 사용 중입니다. 기존 봇을 종료하거나 PORT를 바꿔 주세요.':error.code==='EINSTANCEACTIVE'?'이미 봇이 실행 중이거나 시작 중입니다. 기존 실행 창을 종료한 뒤 다시 시도해 주세요.':error.code==='TokenInvalid'||error.code===50014?'봇 토큰을 확인해 주세요.':error.code===50001?'서버 접근 권한을 확인해 주세요.':error.code===4014?'Discord 개발자 포털의 봇 설정과 Gateway 인텐트를 확인해 주세요.':error.code?'시작에 실패했습니다. 오류 코드: '+error.code:error.message;
  console.error(message);
  await shutdown('startup-failure',{startupFailure:true}).catch(()=>{});
  process.exitCode=1;
});
