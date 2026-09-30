import { installCommunityRoutes } from './community-routes.js';
import { fairSelect } from './community.js';
import { createViewerRouter,createViewerAuth } from './viewer.js';
import { createBroadcastRouter } from './broadcast.js';
import { DEFAULT_AVATAR } from '../public/avatar.js';
import { guideState, editGuide, guideProgress, searchGuide } from './guide.js';
import express from 'express';
import { dashboardExposureWarning } from './dashboard-exposure.js';
import { randomInt, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyAction } from './operations.js';
import { hasGame } from './profiles.js';
import { simulateDraw } from '../public/draw-engine.js';
import { normalizeBroadcastSettings, validateBroadcastSettings } from './broadcast-settings.js';
import { deleteBroadcastPreset, exportBroadcastBundle, importBroadcastBundle, normalizeBroadcastAutomation, normalizeBroadcastPresets, saveBroadcastPreset, setForcedBroadcastScene, validateBroadcastAutomation } from './broadcast-presets.js';
import { buildLocalSelfCheck, createRestorePoint, inspectBackup, verifyRestorePoint } from './recovery-audit.js';
import { buildSettingsDiff, createApprovalGuard, migrationPreview, migrateOperationsState } from './operations-guard.js';
import { APP_VERSION, DATA_SCHEMA_VERSION } from './version.js';
import { classifyRuntimeError } from './runtime-health.js';
import { PerformanceCapacity, measureDataFootprint } from './performance-capacity.js';
import { BackupRetention, SoakTestRunner, buildDeploymentReadiness, runStartupPreflight } from './production-readiness.js';
import { buildGoLiveReadiness } from './go-live-readiness.js';
import { buildHostBootstrap } from './host-bootstrap.js';
import { buildProductionEnvironmentValidation } from './production-environment.js';
import { buildConnectorVerification, runConnectorProbes } from './connector-verification.js';
import { buildProductionAcceptance } from './production-acceptance.js';
import { ProductionMonitor } from './production-monitoring.js';
import { buildProductionCutoverVerification } from './production-cutover.js';
import { buildCurrentManifest } from './release-center.js';
import { buildSupplyChainSbom, inspectProjectSupplyChain } from './supply-chain.js';
import { buildBroadcastPreflight } from './broadcast-preflight.js';
import { discordFixTargetKey, validateSafeFixSelection } from './discord-drift-fix.js';
import { compareDiscordPolicy, decideDiscordPolicyAlert, DISCORD_POLICY_ALERT_MODES, DISCORD_POLICY_MAINTENANCE_DURATIONS, DISCORD_POLICY_MONITOR_INTERVALS } from './discord-policy.js';
import { createIdempotencyGuard } from './idempotency.js';
import { authenticateDashboardBasic, canDashboard, dashboardCapabilityForRequest, operatorStaticAllowed, publicDashboardAccess, sanitizeOperatorCall, sanitizeOperatorQueueEntry, sanitizeOperatorSnapshot, sanitizeOperatorBroadcastOps, sanitizeOperatorNaverParticipation } from './dashboard-access.js';
import { assertLiveControlFresh, createLiveControlMutationGate, readExpectedLiveRevisions } from './live-control-guard.js';
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)};
export function createApp({config,store,operations,recovery,discord,discordPolicy=null,incidentWorkflow=null,idempotencyStore=null,naver=null,naverMonitor=null,naverParticipation=null,chzzkLiveMonitor=null,participationQueue=null,participationCalls=null,broadcastOps=null,viewerAuth=createViewerAuth(),instanceId='',runtimeHealth=null,performanceCapacity=null,backupManager=null,releaseCenter=null,startupPreflight=null,startupEnvironmentValidation=null}) {
  const app=express();if(Number(config.trustProxyHops)>0)app.set('trust proxy',Number(config.trustProxyHops));
  const csrf=randomBytes(24).toString('hex'),failed=new Map(),streams=new Set(),streamClosers=new Map(),streamIdentities=new Map(),approvalGuard=createApprovalGuard(),apiIdempotency=createIdempotencyGuard({persistentStore:idempotencyStore,ownerId:instanceId}),liveMutationGate=createLiveControlMutationGate(),dashboardStreamLimit=12;
  const runtime=runtimeHealth||{recordApi:()=>{},recordIncident:()=>{},recordSse:()=>{},recordTick:()=>{},snapshot:()=>({status:'pass',incidents:[]}),diagnosticBundle:()=>({format:'daengdaeng-runtime-diagnostics-v1'})};
  const performance=performanceCapacity||new PerformanceCapacity();
  const backups=backupManager||new BackupRetention({dir:config.backupDir||'./data/backups',keepCount:config.backupKeepCount||14,maxAgeDays:config.backupMaxAgeDays||30,minimumIntervalHours:config.backupIntervalHours||24});
  const recoveryStore=recovery||{recovered:false,read:()=>({version:1,restorePoints:[],auditLog:[],emergency:{locked:false,lockedAt:0,lockedBy:'',reason:'',checkpointId:'',unlockedAt:0,unlockedBy:''}}),summary:()=>({restorePoints:[],auditLog:[],emergency:{locked:false,lockedAt:0,lockedBy:'',reason:'',checkpointId:'',unlockedAt:0,unlockedBy:''}}),emergencyState:()=>({locked:false,lockedAt:0,lockedBy:'',reason:'',checkpointId:'',unlockedAt:0,unlockedBy:''}),setEmergency:async value=>value,getPoint:()=>null,checkpoint:async payload=>createRestorePoint(payload),audit:async()=>{},removePoint:async()=>false};
  const policyStore=discordPolicy||{recovered:false,read:()=>({version:1,baseline:null,journal:[],lastDigest:'',lastCheckedAt:0}),summary:()=>({baseline:null,journal:[],lastCheckedAt:0,lastDigest:'',monitor:{enabled:false,intervalMinutes:5,alertMode:'off',recoveryAlerts:true,discordAlerts:false},monitorState:{lastStatus:'idle'},maintenance:null,acknowledgement:null}),setBaseline:async()=>{throw Error('Discord Policy Store가 초기화되지 않았습니다.');},observe:async()=>false,setMonitorSettings:async()=>{throw Error('Discord Policy Store가 초기화되지 않았습니다.');},startMaintenance:async()=>{throw Error('Discord Policy Store가 초기화되지 않았습니다.');},endMaintenance:async()=>{},expireMaintenance:async()=>false,acknowledge:async()=>{},clearAcknowledgement:async()=>{},noteMonitorRun:async()=>{}};
  const incidentStore=incidentWorkflow||{recovered:false,summary:()=>({incidents:[],timeline:[],counts:{open:0,acknowledged:0,critical:0,warning:0,totalActive:0},status:'pass'}),sync:async()=>{},acknowledge:async()=>{},resolve:async()=>{},reopen:async()=>{}};
  let busy=false,statusCache=null,statusAt=0,streamSeq=0,suspendLive=false,draining=false;
  const isLoopbackRequest=req=>{const value=String(req.socket?.remoteAddress||'').toLowerCase();return value==='127.0.0.1'||value==='::1'||value==='::ffff:127.0.0.1';};
  const requireLocalRelease=req=>{if(!releaseCenter)throw Error('Release Center가 초기화되지 않았습니다.');if(!['127.0.0.1','localhost','::1'].includes(config.host)||!isLoopbackRequest(req)){const error=Error('코드 업데이트 적용·롤백은 localhost에서만 허용됩니다.');error.status=403;throw error;}};
  const safeAudit=event=>recoveryStore.audit({...event,actor:event.actor||config.dashboardUser||'admin'}).catch(()=>{});
  const auditActor=req=>req?.dashboardIdentity?.user||config.dashboardUser||'admin';
  const emergencyState=()=>recoveryStore.emergencyState?.()||{locked:false,lockedAt:0,lockedBy:'',reason:'',checkpointId:'',unlockedAt:0,unlockedBy:''};
  const delegatedAudit=(req,event)=>safeAudit({...event,actor:auditActor(req),details:{...(event.details||{}),dashboardRole:req?.dashboardIdentity?.role||'admin'}});
  const checkpoint=async(label,reason='manual')=>recoveryStore.checkpoint({records:await records(),operations:operations.read(),label,reason,guildId:config.guildId});
  const replaceAll=async(targetRecords,targetOperations,{label='복원 직전 자동 보호',reason='auto-before-restore'}={})=>{
    const beforeAll=await store.all(),beforeRecords=beforeAll.filter(record=>record.guildId===config.guildId),beforeOperations=operations.read();
    await recoveryStore.checkpoint({records:beforeRecords,operations:beforeOperations,label,reason,guildId:config.guildId});
    const nextRecords=structuredClone(targetRecords),migratedTarget=migrateOperationsState(targetOperations,{guildId:config.guildId,appVersion:APP_VERSION}),nextOperations=migratedTarget.state;
    nextOperations.safeDeploy=beforeOperations.safeDeploy||nextOperations.safeDeploy;nextOperations.requests=[];nextOperations.revision=Math.max(Number(beforeOperations.revision)||0,Number(nextOperations.revision)||0)+1;
    suspendLive=true;
    try{
      await store.update(items=>{const otherGuilds=items.filter(record=>record.guildId!==config.guildId);items.splice(0,items.length,...otherGuilds,...nextRecords);});
      await operations.update(state=>{for(const key of Object.keys(state))delete state[key];Object.assign(state,nextOperations);});
    }catch(error){
      try{await store.update(items=>{items.splice(0,items.length,...beforeAll);});await operations.update(state=>{for(const key of Object.keys(state))delete state[key];Object.assign(state,beforeOperations);});}catch{}
      throw error;
    }finally{suspendLive=false;queueMicrotask(()=>pushLive());}
  };
  const records=async()=>(await store.all()).filter(r=>r.guildId===config.guildId);
  const currentPolicyBaseline=()=>policyStore.read().baseline;
  const buildDiscordPolicyView=async({force=false,record=true}={})=>{
    const baseline=currentPolicyBaseline(),current=await discord.policySnapshot({adminRoleId:config.adminRoleId,baseline,force});
    const recent=baseline?await discord.recentConfigurationChanges({sinceAt:baseline.capturedAt,force}):{available:false,reason:'기준선이 아직 없습니다.',entries:[]};
    const comparison=compareDiscordPolicy(baseline,current,recent.entries||[]);
    if(record&&baseline)await policyStore.observe(comparison);
    return {...policyStore.summary(),comparison,current,attribution:{available:Boolean(recent.available),reason:recent.reason||'',entryCount:(recent.entries||[]).length}};
  };
  const runtimeSnapshot=()=>runtime.snapshot({liveClients:streams.size,version:APP_VERSION,revision:Number(operations.read().revision)||0,recovered:store.recovered||operations.recovered||recoveryStore.recovered||policyStore.recovered||incidentStore.recovered||Boolean(naver?.authStore?.recovered)||Boolean(naverMonitor?.store?.recovered)||Boolean(naverParticipation?.recovered)||Boolean(chzzkLiveMonitor?.store?.recovered)||Boolean(participationQueue?.recovered)||Boolean(idempotencyStore?.recovered)});
  const syncIncidentWorkflow=async({policyComparison=undefined,maintenance=policyStore.summary().maintenance}={})=>incidentStore.sync({runtimeIncidents:runtimeSnapshot().incidents||[],policyComparison,maintenance,now:Date.now()});
  const mobileServiceStatus=({enabled=true,configured=true,lastStatus='idle',lastFailureAt=0,failures=0,detail=''})=>{
    const recentFailure=Number(lastFailureAt)>0&&Date.now()-Number(lastFailureAt)<10*60*1000;
    const status=enabled===false?'idle':!configured?'warn':lastStatus==='fail'||recentFailure?'fail':lastStatus==='warn'||Number(failures)>0?'warn':lastStatus==='pass'?'pass':'idle';
    return {status,enabled:Boolean(enabled),detail:String(detail||'').slice(0,160),lastRunAt:0,failures:Math.max(0,Number(failures)||0)};
  };
  const mobileIncidentWorkflow=(summary,identity)=>({
    status:summary.status,counts:{...(summary.counts||{})},
    incidents:(summary.incidents||[]).slice(0,40).map(item=>({id:item.id,source:item.source,code:item.code,title:item.title,detail:item.detail,severity:item.severity,status:item.status,occurrences:Number(item.occurrences)||1,suppressed:Boolean(item.suppressed),escalated:Boolean(item.escalated),openedAt:Number(item.openedAt)||0,updatedAt:Number(item.updatedAt)||0,lastSeenAt:Number(item.lastSeenAt)||0,...(identity?.role==='operator'?{}:{owner:item.owner||'',note:item.note||''})})),
    timeline:(summary.timeline||[]).slice(0,20).map(item=>({id:item.id,at:Number(item.at)||0,type:item.type,severity:item.severity,summary:item.summary,detail:item.detail||''}))
  });
  const mobileHealthPayload=async identity=>{
    await syncIncidentWorkflow();
    const runtimeState=runtimeSnapshot(),incidentSummary=incidentStore.summary(),naverState=naverMonitor?.summary?.()||null,chzzkState=chzzkLiveMonitor?.summary?.()||null;
    const discordRecent=Number(runtimeState.discord?.lastFailureAt)||0,storageFailures=Number(runtimeState.persistence?.failures)||0,storageWarnings=Number(runtimeState.persistence?.durabilityWarnings)||0,sseStale=Number(runtimeState.sse?.staleReports)||0;
    const services={
      discord:mobileServiceStatus({configured:config.demo||statusCache?.connected!==false,lastStatus:discordRecent&&Date.now()-discordRecent<10*60*1000?'warn':'pass',lastFailureAt:discordRecent,failures:runtimeState.discord?.failures,detail:config.demo?'연습 모드':statusCache?.connected===false?'최근 Discord 진단에서 연결 확인 필요':'Discord 요청 상태'}),
      naver:mobileServiceStatus({enabled:naverState?.settings?.enabled!==false,configured:Boolean(naverState?.connector?.configured||naverState?.connector?.oauthConfigured),lastStatus:naverState?.state?.lastStatus||'idle',failures:naverState?.state?.consecutiveFailures,detail:naverState?.settings?.enabled===false?'모니터 꺼짐':naverState?.state?.baselineReady?'공개글 모니터 기준선 준비됨':'공개글 모니터 기준선 대기'}),
      chzzk:mobileServiceStatus({enabled:chzzkState?.settings?.enabled!==false,configured:Boolean(chzzkState?.connector?.configured),lastStatus:chzzkState?.state?.lastStatus||'idle',failures:chzzkState?.state?.consecutiveFailures,detail:chzzkState?.settings?.enabled===false?'방송 감지 꺼짐':chzzkState?.state?.lastKnownLive===true?'방송 LIVE':chzzkState?.state?.lastKnownLive===false?'방송 OFFLINE':'방송 상태 기준선 대기'}),
      storage:mobileServiceStatus({configured:true,lastStatus:storageFailures?'fail':storageWarnings?'warn':'pass',failures:storageFailures+storageWarnings,detail:`복구 ${Number(runtimeState.persistence?.recoveries)||0} · 손상 ${Number(runtimeState.persistence?.corruptions)||0}`}),
      sse:mobileServiceStatus({configured:true,lastStatus:sseStale?'warn':'pass',failures:sseStale,detail:`연결 ${Number(runtimeState.sse?.liveClients)||0} · 재연결 ${Number(runtimeState.sse?.clientReconnects)||0}`})
    };
    for(const [key,state] of [['naver',naverState?.state],['chzzk',chzzkState?.state]])if(services[key])services[key].lastRunAt=Number(state?.lastRunAt)||0;
    return {version:APP_VERSION,checkedAt:Date.now(),access:publicDashboardAccess(identity),runtime:{status:runtimeState.status,checkedAt:runtimeState.checkedAt,uptimeMs:runtimeState.uptimeMs,memory:runtimeState.memory,eventLoop:runtimeState.eventLoop,api:{requests:runtimeState.api?.requests||0,errors:runtimeState.api?.errors||0,serverErrors:runtimeState.api?.serverErrors||0,errorRate:runtimeState.api?.errorRate||0,avgMs:runtimeState.api?.avgMs||0},discord:{calls:runtimeState.discord?.calls||0,failures:runtimeState.discord?.failures||0,lastFailureAt:runtimeState.discord?.lastFailureAt||null},persistence:{writes:runtimeState.persistence?.writes||0,failures:storageFailures,recoveries:runtimeState.persistence?.recoveries||0,corruptions:runtimeState.persistence?.corruptions||0,durabilityWarnings:storageWarnings},sse:{liveClients:runtimeState.sse?.liveClients||0,connects:runtimeState.sse?.connects||0,disconnects:runtimeState.sse?.disconnects||0,clientReconnects:runtimeState.sse?.clientReconnects||0,staleReports:sseStale,maxDelayMs:runtimeState.sse?.maxDelayMs||0},ticks:{runs:runtimeState.ticks?.runs||0,failures:runtimeState.ticks?.failures||0}},services,incidentWorkflow:mobileIncidentWorkflow(incidentSummary,identity)};
  };
  let policyMonitorBusy=false;
  const runPolicyMonitor=async({force=false}={})=>{
    await policyStore.expireMaintenance?.(Date.now()).catch(()=>{});
    const before=policyStore.summary(),monitor=before.monitor||{enabled:false,intervalMinutes:5,alertMode:'off',recoveryAlerts:true},monitorState=before.monitorState||{};
    if(!before.baseline)return {skipped:'no-baseline',summary:before};
    if(!monitor.enabled&&!force)return {skipped:'disabled',summary:before};
    if(!force&&monitorState.nextRunAt&&Date.now()<monitorState.nextRunAt)return {skipped:'not-due',summary:before};
    if(policyMonitorBusy)return {skipped:'busy',summary:before};
    policyMonitorBusy=true;const started=Date.now();
    try{
      const view=await buildDiscordPolicyView({force:true,record:true}),comparison=view.comparison,priorStatus=monitorState.lastComparisonStatus||'none',priorDigest=monitorState.lastComparisonDigest||'';
      const changed=priorStatus!==comparison.status||priorDigest!==comparison.digest,maintenance=before.maintenance,acknowledgement=before.acknowledgement;
      const acknowledged=acknowledgement?.digest===comparison.digest,releasedSuppression=comparison.status==='drift'&&!maintenance?.active&&!acknowledged&&['maintenance','acknowledged'].includes(monitorState.lastSuppressedReason);
      if((changed||releasedSuppression)&&comparison.status==='drift'){
        if(maintenance?.active)runtime.recordIncident({severity:'info',source:'discord',code:'discord_policy_drift_maintenance',summary:`Discord drift 감지 · 점검 모드로 경고 보류 · ${comparison.counts.total}개`,detail:maintenance.reason||'계획된 작업',persist:false});
        else if(acknowledged)runtime.recordIncident({severity:'info',source:'discord',code:'discord_policy_drift_acknowledged',summary:`확인 처리된 Discord drift · ${comparison.counts.total}개`,detail:acknowledgement.note||'관리자가 현재 변경을 확인했습니다.',persist:false});
        else runtime.recordIncident({severity:'warn',source:'discord',code:'discord_policy_drift',summary:`Discord 기준선 drift 감지 · ${comparison.counts.total}개`,detail:`SAFE ${comparison.counts.safe} / MANUAL ${comparison.counts.manual}`,persist:true});
      }else if(changed&&comparison.status==='pass'&&priorStatus==='drift')runtime.recordIncident({severity:'info',source:'discord',code:'discord_policy_cleared',summary:'Discord 기준선 drift 해소',detail:'현재 Discord 설정이 저장된 정상 기준선과 다시 일치합니다.',persist:false});
      const route=decideDiscordPolicyAlert({monitor,monitorState,comparison,maintenance,acknowledgement});let alerted=null,alertError=null;
      try{
        if(route.send){await discord.policyAlert({status:route.status,counts:comparison.counts,items:comparison.items});alerted={status:route.status,digest:comparison.digest};}
      }catch(error){alertError=error;runtime.recordIncident({severity:'warn',source:'discord',code:'discord_policy_alert_failure',summary:'Discord Policy 알림 전송 실패',detail:error?.message});}
      const summary=await policyStore.noteMonitorRun({comparison,alerted,alertError,suppressed:route.send?null:route,now:Date.now()});
      await syncIncidentWorkflow({policyComparison:comparison,maintenance:summary.maintenance}).catch(()=>{});
      runtime.recordDiscord?.({operation:'policy-monitor',ok:true,durationMs:Date.now()-started});
      // v4.8 returned the pre-run view here, so lastRun/alert state could look stale until the next refresh.
      return {view:{...view,...summary},summary};
    }catch(error){
      await policyStore.noteMonitorRun({error,now:Date.now()}).catch(()=>{});runtime.recordIncident({severity:'warn',source:'discord',code:'discord_policy_monitor_failure',summary:'Discord Policy Monitor 점검 실패',detail:error?.message});runtime.recordDiscord?.({operation:'policy-monitor',ok:false,durationMs:Date.now()-started,error});throw error;
    }finally{policyMonitorBusy=false;}
  };
  
  const broadcastOpsSummary=()=>broadcastOps?.summary?.({operationsState:operations.read(),queueSummary:participationQueue?.summary?.()||{},chzzkSummary:chzzkLiveMonitor?.summary?.()||{},now:Date.now()})||{gamePresets:[],schedules:[],activePoll:null,pollHistory:[],notifications:{broadcast:true,participation:true,naver:true,system:true,schedule:true},timeline:[],stats:{},nextSchedule:null};
  const broadcastOpsPayload=req=>req?.dashboardIdentity?.role==='operator'?sanitizeOperatorBroadcastOps(broadcastOpsSummary()):broadcastOpsSummary();
  const broadcastRunbookPayload=req=>{const runbook=broadcastOps?.runbookSummary?.()||broadcastOpsSummary().runbook||{steps:[],handoffs:[],progress:{done:0,skipped:0,pending:0,total:0}};return req?.dashboardIdentity?.role==='operator'?sanitizeOperatorBroadcastOps({runbook}).runbook:runbook;};
  let runbookAutomationBusy=false;
  const syncRunbookAutomation=async(now=Date.now())=>{
    if(runbookAutomationBusy||!broadcastOps?.syncRunbookPhase)return {changed:false,transition:null};runbookAutomationBusy=true;
    try{
      const result=await broadcastOps.syncRunbookPhase({operationsState:operations.read(),chzzkSummary:chzzkLiveMonitor?.summary?.()||{}},'system',now);
      if(result?.changed&&result.transition&&broadcastOpsSummary().notifications.broadcast!==false){
        const labels={pre:'방송 전',live:'방송 중',post:'방송 후'},transition=result.transition;
        try{await discord.broadcastOpsNotice?.({title:'방송 Runbook 단계 전환',message:`${labels[transition.from]||transition.from} → ${labels[transition.to]||transition.to}\n${transition.reason||'방송 상태 변화 감지'}`,kind:'runbook-phase'});}
        catch(error){runtime.recordIncident({severity:'warn',source:'discord',code:'runbook_phase_alert_failure',summary:'Runbook 단계 전환 Discord 알림 실패',detail:error?.message,persist:false});}
      }
      return result;
    }finally{runbookAutomationBusy=false;}
  };
  const naverParticipationPayload=req=>{const value=naverParticipation?naverParticipation.summary():{publication:null,session:null,entries:[],history:[],counts:{queued:0,cancelled:0},nextOrder:1,registrationOpen:false,commentAutomationSupported:false,commentManualText:'칼바람 시참'};return req?.dashboardIdentity?.role==='operator'?sanitizeOperatorNaverParticipation(value):value;};
  const broadcastPreflightSnapshot=(discordDiagnostics=statusCache)=>{
    const current=operations.read(),runtimeState=runtimeSnapshot(),policySummary=policyStore.summary(),incidentSummary=incidentStore.summary(),queueSummary=participationQueue?.summary?.()||{entries:[],counts:{},activeCount:0,currentCall:null},callSummary=participationCalls?.state?.()||{timeoutSeconds:60,current:null,calledCount:0},chzzkSummary=chzzkLiveMonitor?.summary?.()||{settings:{enabled:false},state:{lastStatus:'idle',lastKnownLive:null,baselineReady:false},currentLive:null,connector:{configured:false}},naverSummary=naverParticipation?.summary?.()||{registrationOpen:false,counts:{queued:0}},naverStatus=naver?.status?.()||{connected:false};
    return buildBroadcastPreflight({state:current,records:store.read().filter(record=>record.guildId===config.guildId),participationQueue:queueSummary,participationCalls:callSummary,chzzkLive:chzzkSummary,broadcastOps:broadcastOpsSummary(),runtime:runtimeState,incidents:incidentSummary,emergency:emergencyState(),discord:discordDiagnostics,discordPolicy:policySummary,naver:naverStatus,naverParticipation:naverSummary,demo:config.demo,now:Date.now()});
  };
  const snapshot=async(includeCsrf=true,identity={role:'admin',user:config.dashboardUser||'admin',capabilities:['*']})=>{
    const current=operations.read();current.broadcastSettings=normalizeBroadcastSettings(current.broadcastSettings);current.broadcastPresets=normalizeBroadcastPresets(current.broadcastPresets);current.broadcastAutomation=normalizeBroadcastAutomation(current.broadcastAutomation,current.broadcastPresets);const policySummary=policyStore.summary(),incidentSummary=incidentStore.summary();
    const full={state:current,records:await records(),...(includeCsrf?{csrf}:{}),demo:config.demo,profile:config.profile,version:APP_VERSION,revision:Number(current.revision)||0,serverTime:Date.now(),access:publicDashboardAccess(identity),emergency:emergencyState(),policyMonitor:{baseline:Boolean(policySummary.baseline),settings:policySummary.monitor,state:policySummary.monitorState,maintenance:policySummary.maintenance,acknowledgement:policySummary.acknowledgement},incidentWorkflow:{status:incidentSummary.status,counts:incidentSummary.counts},participationQueue:participationQueue?.summary?.()||{entries:[],counts:{},activeCount:0,currentCall:null},participationCalls:participationCalls?.state?.()||{timeoutSeconds:60,current:null,calledCount:0},chzzkLive:chzzkLiveMonitor?.summary?.()||{settings:{enabled:false,channelId:'',intervalMinutes:2,discordAlerts:true,maxPages:50},state:{lastStatus:'idle',lastKnownLive:null,baselineReady:false},currentLive:null,events:[],connector:{configured:false}},broadcastOps:broadcastOpsSummary(),broadcastPreflight:broadcastPreflightSnapshot(),recovered:store.recovered||operations.recovered||recoveryStore.recovered||policyStore.recovered||incidentStore.recovered||Boolean(naver?.authStore?.recovered)||Boolean(naverMonitor?.store?.recovered)||Boolean(naverParticipation?.recovered)||Boolean(chzzkLiveMonitor?.store?.recovered)||Boolean(participationQueue?.recovered)};
    return identity?.role==='operator'?sanitizeOperatorSnapshot(full,identity):full;
  };
  const safeQueueResult=(req,result)=>{
    if(req?.dashboardIdentity?.role!=='operator'||!result||typeof result!=='object')return result;
    const safe={...result};
    if(result.entry)safe.entry=sanitizeOperatorQueueEntry(result.entry);
    if(result.next)safe.next=sanitizeOperatorQueueEntry(result.next);
    delete safe.messageRef;delete safe.previousMessage;
    return safe;
  };
  const liveControlRevisions=()=>({operations:Number(operations.read()?.revision)||0,queue:Number(participationQueue?.read?.()?.revision)||0});
  const queuePayload=(req,extras={})=>{
    const queue=participationQueue?.summary?.()||{entries:[],counts:{},activeCount:0,currentCall:null},calls=participationCalls?.state?.()||{timeoutSeconds:60,current:null,calledCount:0},controlRevisions=liveControlRevisions();
    if(req?.dashboardIdentity?.role!=='operator')return {...extras,queue,calls,controlRevisions};
    const safe=sanitizeOperatorSnapshot({state:{session:null,revision:0},records:[],demo:config.demo,profile:config.profile,version:APP_VERSION,revision:0,serverTime:Date.now(),participationQueue:queue,participationCalls:calls,chzzkLive:{state:{}},broadcastOps:{},recovered:false},req.dashboardIdentity);
    const output={...extras,queue:safe.participationQueue,calls:safe.participationCalls,controlRevisions};
    if(extras.entry)output.entry=sanitizeOperatorQueueEntry(extras.entry);
    if(extras.result)output.result=safeQueueResult(req,extras.result);
    return output;
  };
  const eventFrame=(event,data,id)=>`${id?`id: ${id}\n`:''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let pushQueued=false;
  const pushLive=()=>{
    if(suspendLive||pushQueued||!streams.size)return;pushQueued=true;
    setTimeout(async()=>{
      pushQueued=false;
      try{const id=String(++streamSeq),cache=new Map();for(const res of [...streams]){try{const identity=streamIdentities.get(res)||{role:'admin',user:config.dashboardUser||'admin',capabilities:['*']},key=`${identity.role}:${identity.user||''}:${(identity.capabilities||[]).join(',')}`;let payload=cache.get(key);if(!payload){payload=eventFrame('snapshot',await snapshot(false,identity),id);cache.set(key,payload);}res.write(payload);}catch{streamClosers.get(res)?.();}}runtime.recordSse('push');}catch(error){runtime.recordIncident({severity:'warn',source:'sse',code:'push_failure',summary:'실시간 스냅샷 전송 실패',detail:error?.message});}
    },25).unref?.();
  };
  const unsubscribeOperations=operations.subscribe(pushLive),unsubscribeStore=store.subscribe(pushLive),unsubscribeRecovery=typeof recoveryStore.subscribe==='function'?recoveryStore.subscribe(pushLive):()=>{},unsubscribeBroadcastOps=typeof broadcastOps?.subscribe==='function'?broadcastOps.subscribe(pushLive):()=>{},unsubscribePolicy=typeof policyStore.subscribe==='function'?policyStore.subscribe(pushLive):()=>{},unsubscribeIncident=typeof incidentStore.subscribe==='function'?incidentStore.subscribe(pushLive):()=>{},unsubscribeNaverParticipation=typeof naverParticipation?.subscribe==='function'?naverParticipation.subscribe(pushLive):()=>{},unsubscribeChzzkLive=typeof chzzkLiveMonitor?.store?.subscribe==='function'?chzzkLiveMonitor.store.subscribe(pushLive):()=>{},unsubscribeParticipationQueue=typeof participationQueue?.subscribe==='function'?participationQueue.subscribe(pushLive):()=>{};
  app.disable('x-powered-by');
  const broadcast=createBroadcastRouter({config,store,operations,version:APP_VERSION,participationQueue});
  const performanceSnapshot=async()=>{
    const current=operations.read(),runtimeState=runtime.snapshot({liveClients:streams.size,version:APP_VERSION,revision:Number(current.revision)||0,recovered:store.recovered||operations.recovered||recoveryStore.recovered||policyStore.recovered||incidentStore.recovered||Boolean(naver?.authStore?.recovered)||Boolean(naverMonitor?.store?.recovered)||Boolean(naverParticipation?.recovered)||Boolean(participationQueue?.recovered)}),broadcastStats=broadcast.stats?.()||{liveClients:0,limit:8};
    const dataFootprint=await measureDataFootprint([store.file,operations.file,recoveryStore.file,policyStore.file,incidentStore.file,idempotencyStore?.file,naver?.authStore?.file,naverMonitor?.store?.file,naverParticipation?.file,chzzkLiveMonitor?.store?.file,participationQueue?.file,broadcastOps?.file].filter(Boolean));
    return performance.snapshot({runtimeSnapshot:runtimeState,dashboardClients:streams.size,dashboardLimit:dashboardStreamLimit,broadcastClients:broadcastStats.liveClients,broadcastLimit:broadcastStats.limit,dataFootprint,recordCount:store.read().filter(r=>r.guildId===config.guildId).length,revision:Number(current.revision)||0});
  };
  const soak=new SoakTestRunner({sampleProvider:async()=>runtime.snapshot({liveClients:streams.size,version:APP_VERSION,revision:Number(operations.read().revision)||0,recovered:store.recovered||operations.recovered||recoveryStore.recovered||Boolean(idempotencyStore?.recovered)})});
  const capacityTimer=setInterval(()=>performanceSnapshot().catch(error=>runtime.recordIncident({severity:'warn',source:'system',code:'capacity_sample_failure',summary:'성능·용량 샘플링 실패',detail:error?.message,persist:false})),15000);capacityTimer.unref?.();
  const backupTimer=setInterval(async()=>{if(busy)return;try{const result=await backups.ensureRecent({guildId:config.guildId,records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read()});if(result.created)await safeAudit({category:'system',action:'scheduled_backup',summary:`자동 배포 백업 생성 · ${result.latest.file}`,details:{bytes:result.latest.bytes}});}catch(error){runtime.recordIncident({severity:'warn',source:'storage',code:'scheduled_backup_failure',summary:'자동 배포 백업 실패',detail:error?.message});}},30*60*1000);backupTimer.unref?.();
  const policyMonitorTimer=setInterval(()=>runPolicyMonitor().catch(()=>{}),30000);policyMonitorTimer.unref?.();queueMicrotask(()=>runPolicyMonitor().catch(()=>{}));
  const naverMonitorTimer=setInterval(()=>naverMonitor?.run?.().catch(error=>runtime.recordIncident({severity:'warn',source:'naver',code:'naver_monitor_failure',summary:'네이버 공개글 모니터 점검 실패',detail:error?.message,persist:false})),30000);naverMonitorTimer.unref?.();queueMicrotask(()=>naverMonitor?.run?.().catch(()=>{}));
  const chzzkLiveTimer=setInterval(()=>chzzkLiveMonitor?.run?.().catch(error=>runtime.recordIncident({severity:'warn',source:'chzzk',code:'chzzk_live_monitor_failure',summary:'치지직 방송 상태 점검 실패',detail:error?.message,persist:false})),30000);chzzkLiveTimer.unref?.();queueMicrotask(()=>chzzkLiveMonitor?.run?.().catch(()=>{}));
  const incidentTimer=setInterval(()=>syncIncidentWorkflow().catch(error=>runtime.recordIncident({severity:'warn',source:'system',code:'incident_sync_failure',summary:'장애 워크플로 동기화 실패',detail:error?.message,persist:false})),30000);incidentTimer.unref?.();queueMicrotask(()=>syncIncidentWorkflow().catch(()=>{}));
  performanceSnapshot().catch(()=>{});
  app.use('/broadcast',broadcast.router);
  if(instanceId)app.use((_req,res,next)=>{res.set('X-DaengDaeng-Instance',instanceId);next();});
  app.get('/healthz',(_req,res)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    const ready=!draining,emergency=emergencyState();
    res.status(ready?200:503).json({status:ready?'ok':'draining',ready,emergencyLocked:Boolean(emergency.locked),version:APP_VERSION});
  });
  app.use('/viewer',createViewerRouter({config,store,operations,viewerAuth,broadcastOps,participationQueue,participationCalls,emergencyState}));
  app.get('/naver/callback',async(req,res)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'"});
    try{
      if(!naver)throw Object.assign(new Error('네이버 연동 모듈이 초기화되지 않았습니다.'),{status:503});
      if(req.query.error){naver.consumeState(req.query.state);throw Object.assign(new Error('네이버 로그인 동의가 완료되지 않았습니다. 대시보드에서 다시 연동해 주세요.'),{status:400});}
      await naver.exchangeCode({code:req.query.code,state:req.query.state});
      await safeAudit({category:'naver',action:'oauth_connect',summary:'네이버 계정 연동 완료'});
      return res.status(200).type('html').send('<!doctype html><meta charset="utf-8"><title>네이버 연동 완료</title><body style="font-family:system-ui;padding:32px"><h1>네이버 연동 완료</h1><p>대시보드로 돌아가 상태 새로고침을 눌러 주세요. 이 창은 닫아도 됩니다.</p></body>');
    }catch(error){runtime.recordIncident({severity:'warn',source:'naver',code:'naver_oauth_callback',summary:'네이버 OAuth 콜백 처리 실패',detail:error?.message});return res.status(Number.isInteger(error?.status)?error.status:400).type('html').send('<!doctype html><meta charset="utf-8"><title>네이버 연동 실패</title><body style="font-family:system-ui;padding:32px"><h1>네이버 연동 실패</h1><p>대시보드에서 연동을 다시 시작하고 설정값을 확인해 주세요.</p></body>');}
  });
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});
    const host=(req.get('host')||'').split(':')[0];
    if(config.host==='127.0.0.1' && !['127.0.0.1','localhost'].includes(host))return res.status(403).json({error:'이 PC의 localhost 주소로 접속해 주세요.'});
    if(config.demo){req.dashboardIdentity={role:'admin',user:config.dashboardUser||'admin',capabilities:['*']};return next();}
    const stamp=failed.get(req.ip),now=Date.now();
    if(stamp&&stamp.until>now&&stamp.count>=15)return res.status(429).json({error:'로그인 시도가 많습니다. 1분 뒤 다시 시도해 주세요.'});
    const auth=req.get('authorization')||'',identity=authenticateDashboardBasic(auth,config);
    if(!identity){
      if(auth){if(failed.size>1000)failed.clear();failed.set(req.ip,{count:stamp&&stamp.until>now?stamp.count+1:1,until:now+60000});}
      res.set('WWW-Authenticate','Basic realm="DaengDaeng Dashboard", charset="UTF-8"');return res.status(401).json({error:'대시보드 로그인이 필요합니다.'});
    }
    failed.delete(req.ip);req.dashboardIdentity=identity;next();
  });
  app.use((req,res,next)=>{
    if(req.dashboardIdentity?.role!=='operator'||req.path.startsWith('/api')||operatorStaticAllowed(req.path))return next();
    return res.status(403).json({error:'운영자 계정은 모바일 Live Control만 열 수 있습니다. 관리자 설정은 관리자 계정으로 접속해 주세요.'});
  });
  app.use((req,res,next)=>{
    if(draining&&req.path.startsWith('/api')&&req.method!=='GET')return res.status(503).json({error:'서버가 안전 종료 중입니다. 잠시 후 다시 시도해 주세요.'});
    next();
  });
  app.use((req,res,next)=>{
    if(!req.path.startsWith('/api')||req.path==='/api/events')return next();
    const started=Date.now();res.once('finish',()=>{const metric={method:req.method,path:req.path,status:res.statusCode,durationMs:Date.now()-started};runtime.recordApi(metric);performance.recordApi(metric);});next();
  });
  app.use(express.json({limit:'8mb'}));
  app.use('/api',(req,res,next)=>{
    if(req.method==='GET')return next();
    if(!req.is('application/json')||!equal(req.get('X-CSRF-Token'),csrf)||req.get('Sec-Fetch-Site')==='cross-site')return res.status(403).json({error:'페이지를 새로고침한 뒤 대시보드에서 실행해 주세요.'});
    if(req.body===null||Array.isArray(req.body)||typeof req.body!=='object')return res.status(400).json({error:'요청 형식이 올바르지 않습니다.'});
    next();
  });
  app.use((req,res,next)=>{
    if(!req.path.startsWith('/api')||req.dashboardIdentity?.role!=='operator')return next();
    const required=dashboardCapabilityForRequest(req.method,req.path);
    if(required==='authenticated'||(required&&canDashboard(req.dashboardIdentity,required)))return next();
    return res.status(403).json({error:'현재 운영자 계정에 이 작업 권한이 없습니다.',requiredCapability:required||'admin'});
  });
  const emergencyMutationAllowed=path=>path.startsWith('/api/broadcast-runbook/')||path==='/api/connector-verification/probe'||path==='/api/production-acceptance/verify'||path==='/api/production-cutover/verify'||path==='/api/production-monitoring/probe'||path==='/api/guard/prepare'||path==='/api/emergency/lock'||path==='/api/emergency/unlock'||path==='/api/recovery/checkpoint'||path==='/api/recovery/restore'||path==='/api/recovery/delete'||path==='/api/backup/verify'||path==='/api/backup/restore'||path==='/api/runtime/client-metric'||path.startsWith('/api/incidents/');
  app.use((req,res,next)=>{if(req.method==='GET'||!req.path.startsWith('/api'))return next();const emergency=emergencyState();if(!emergency.locked||emergencyMutationAllowed(req.path))return next();return res.status(423).json({error:'방송 운영이 긴급 잠금 상태입니다. Recovery 탭에서 상태를 확인한 뒤 잠금을 해제해 주세요.',code:'EMERGENCY_LOCKED',emergency:{locked:true,lockedAt:emergency.lockedAt,reason:emergency.reason}});});
  app.use('/api',apiIdempotency.middleware({scope:req=>`dashboard:${req.dashboardIdentity?.role||'admin'}:${req.dashboardIdentity?.user||config.dashboardUser||'admin'}`}));
  app.use('/api',async(req,res,next)=>{
    if(req.method==='GET')return next();
    let expected;
    try{expected=readExpectedLiveRevisions(req.headers);}catch(error){return next(error)}
    if(expected.operations===null&&expected.queue===null)return next();
    const release=await liveMutationGate.enter();let handedOff=false;
    const done=()=>release();res.once('finish',done);res.once('close',done);
    try{assertLiveControlFresh(expected,liveControlRevisions());handedOff=true;return next();}
    catch(error){release();return next(error)}
    finally{if(!handedOff)release();}
  });
  installCommunityRoutes(app,{operations,config,discord,naver,guard:()=>{
    const status=releaseCenter?.snapshot?.()?.status;
    if(draining||emergencyState().locked||['staging','applying','rolling-back','restart-required','rollback-restart-required'].includes(status))throw Object.assign(Error('운영 잠금 또는 재시작 대기 중입니다.'),{statusCode:423});
  }});
  app.use(express.static(fileURLToPath(new URL('../public/',import.meta.url)),{etag:false}));
  app.get('/api/access',(req,res)=>res.json(publicDashboardAccess(req.dashboardIdentity)));
  app.get('/api/snapshot',async(req,res)=>res.json(await snapshot(true,req.dashboardIdentity)));
  app.get('/api/broadcast-preflight',async(_req,res)=>{let diagnostics=statusCache;if(!diagnostics||Date.now()-statusAt>5000){try{diagnostics=await discord.diagnostics();statusCache=diagnostics;statusAt=Date.now();}catch(error){runtime.recordIncident({severity:'warn',source:'discord',code:'preflight_diagnostics_failure',summary:'방송 사전 점검 Discord 진단 실패',detail:error?.message,persist:false});diagnostics=null;}}res.json(broadcastPreflightSnapshot(diagnostics));});
  app.get('/api/events',async(req,res)=>{
    if(streams.size>=dashboardStreamLimit)return res.status(503).json({error:'실시간 대시보드 연결이 너무 많습니다. 다른 대시보드 탭을 닫아 주세요.'});
    res.status(200);res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders?.();
    streams.add(res);streamIdentities.set(res,req.dashboardIdentity);runtime.recordSse('connect');
    let closed=false,heartbeat=null;const close=()=>{if(closed)return;closed=true;if(heartbeat)clearInterval(heartbeat);streamClosers.delete(res);streamIdentities.delete(res);if(streams.delete(res))runtime.recordSse('disconnect');};streamClosers.set(res,close);req.once('close',close);res.once('close',close);
    try{res.write('retry: 2500\n\n');res.write(eventFrame('snapshot',await snapshot(false,req.dashboardIdentity),String(++streamSeq)));}catch{return close();}
    if(closed)return;heartbeat=setInterval(()=>{
      try{const current=operations.read();res.write(eventFrame('heartbeat',{serverTime:Date.now(),version:APP_VERSION,revision:Number(current.revision)||0},null));}catch{close();}
    },15000);heartbeat.unref();
  });
  app.get('/api/broadcast-ops',(req,res)=>res.json(broadcastOpsPayload(req)));
  app.get('/api/broadcast-runbook',(req,res)=>res.json({runbook:broadcastRunbookPayload(req)}));
  app.get('/api/broadcast-archive',(req,res)=>{const reports=broadcastOps?.archiveReports?.({operationsState:operations.read(),chzzkSummary:chzzkLiveMonitor?.summary?.()||{},now:Date.now()})||[];res.json({schema:'daengdaeng-broadcast-archive-v1',generatedAt:Date.now(),reports});});
  app.post('/api/broadcast-runbook/new',async(req,res,next)=>{try{if(!broadcastOps?.startRunbook)throw Object.assign(Error('방송 Runbook이 초기화되지 않았습니다.'),{status:503});const result=await broadcastOps.startRunbook({title:req.body.title},auditActor(req));await delegatedAudit(req,{category:'broadcast',action:'runbook_new',summary:`새 방송 Runbook 시작 · ${result.title}`});res.json({runbook:broadcastRunbookPayload(req)});}catch(error){next(error)}});
  app.post('/api/broadcast-runbook/step',async(req,res,next)=>{try{if(!broadcastOps?.updateRunbookStep)throw Object.assign(Error('방송 Runbook이 초기화되지 않았습니다.'),{status:503});const result=await broadcastOps.updateRunbookStep({id:req.body.id,status:req.body.status},auditActor(req));const step=result.steps.find(item=>item.id===String(req.body.id||''));await delegatedAudit(req,{category:'broadcast',action:'runbook_step',summary:`방송 Runbook · ${step?.title||'항목'} · ${step?.status||req.body.status}`});res.json({runbook:broadcastRunbookPayload(req)});}catch(error){next(error)}});
  app.post('/api/broadcast-runbook/handoff',async(req,res,next)=>{try{if(!broadcastOps?.saveRunbookHandoff)throw Object.assign(Error('방송 Runbook이 초기화되지 않았습니다.'),{status:503});const result=await broadcastOps.saveRunbookHandoff({to:req.body.to,note:req.body.note},auditActor(req));let alertStatus=result.handoff.to?'pending':'suppressed',alertError='';if(result.handoff.to&&broadcastOpsSummary().notifications.broadcast!==false){try{await discord.broadcastOpsNotice?.({title:'방송 운영 인수인계',message:`${result.handoff.from} → ${result.handoff.to}\nRunbook에서 현재 상태와 체크리스트를 확인해 주세요.`,kind:'runbook-handoff'});alertStatus='sent';}catch(error){alertStatus='failed';alertError=error?.message||'Discord 알림 전송 실패';runtime.recordIncident({severity:'warn',source:'discord',code:'runbook_handoff_alert_failure',summary:'Runbook 인수인계 Discord 알림 실패',detail:alertError,persist:false});}}else if(result.handoff.to)alertStatus='suppressed';await broadcastOps.noteRunbookHandoffAlert?.(result.handoff.id,{status:alertStatus,error:alertError}).catch(error=>runtime.recordIncident({severity:'warn',source:'storage',code:'runbook_handoff_alert_state_failure',summary:'Runbook 인수인계 알림 상태 저장 실패',detail:error?.message,persist:false}));await delegatedAudit(req,{category:'broadcast',action:'runbook_handoff',summary:`방송 운영 인수인계 저장 · ${result.handoff.from}${result.handoff.to?` → ${result.handoff.to}`:''}`});res.json({runbook:broadcastRunbookPayload(req),handoffAlert:{status:alertStatus}});}catch(error){next(error)}});
  app.post('/api/broadcast-runbook/closeout',async(req,res,next)=>{try{if(!broadcastOps?.closeRunbook)throw Object.assign(Error('방송 Runbook이 초기화되지 않았습니다.'),{status:503});const before=broadcastOps.runbookSummary?.()||broadcastOpsSummary().runbook||{},current=operations.read(),live=chzzkLiveMonitor?.summary?.()||{};if(before.status!=='closed'){if(current.session&&current.session.phase!=='ended')throw Object.assign(Error('진행 중인 시참 회차를 먼저 종료해 주세요.'),{status:409,code:'RUNBOOK_CLOSEOUT_SESSION_ACTIVE'});if(live.state?.lastKnownLive===true)throw Object.assign(Error('CHZZK 방송이 LIVE 상태입니다. 방송 종료가 확인된 뒤 Runbook을 마감해 주세요.'),{status:409,code:'RUNBOOK_CLOSEOUT_LIVE'});if(before.phaseState?.phase!=='post')throw Object.assign(Error('POST-LIVE 단계가 확인된 뒤 Runbook을 마감해 주세요.'),{status:409,code:'RUNBOOK_CLOSEOUT_PHASE'});}const result=await broadcastOps.closeRunbook({note:req.body.note},auditActor(req));if(!result.alreadyClosed&&broadcastOpsSummary().notifications.broadcast!==false){try{await discord.broadcastOpsNotice?.({title:'방송 Runbook 마감 완료',message:`${result.closeout?.summary||'방송 운영 Runbook을 마감했습니다.'}${result.closeout?.nextOwner?`\n다음 담당: ${result.closeout.nextOwner}`:''}`,kind:'runbook-closeout'});}catch(error){runtime.recordIncident({severity:'warn',source:'discord',code:'runbook_closeout_alert_failure',summary:'Runbook 마감 Discord 알림 실패',detail:error?.message,persist:false});}}await delegatedAudit(req,{category:'broadcast',action:'runbook_closeout',summary:`방송 Runbook 마감 · ${result.runbook?.title||'Runbook'}`});res.json({runbook:broadcastRunbookPayload(req),closeout:result.closeout,alreadyClosed:Boolean(result.alreadyClosed)});}catch(error){next(error)}});
  app.post('/api/broadcast-ops/preset',async(req,res,next)=>{try{
    if(!broadcastOps)throw Object.assign(Error('방송 운영 허브가 초기화되지 않았습니다.'),{status:503});
    if(req.body.action==='delete'){const removed=await broadcastOps.deletePreset(String(req.body.id||''));await delegatedAudit(req,{category:'broadcast',action:'game_preset_delete',summary:`게임 프리셋 삭제 · ${removed.name}`});return res.json(broadcastOpsPayload(req));}
    const preset=await broadcastOps.savePreset(req.body);await delegatedAudit(req,{category:'broadcast',action:'game_preset_save',summary:`게임 프리셋 저장 · ${preset.name}`});res.json({...broadcastOpsPayload(req),preset});
  }catch(error){next(error)}});
  app.post('/api/broadcast-ops/preset/open',async(req,res,next)=>{try{
    if(req.dashboardIdentity?.role==='operator'&&!canDashboard(req.dashboardIdentity,'live'))return res.status(403).json({error:'게임 프리셋으로 모집을 시작하려면 live 권한도 필요합니다.',requiredCapability:'live'});
    if(!broadcastOps)throw Object.assign(Error('방송 운영 허브가 초기화되지 않았습니다.'),{status:503});if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;
    const summary=broadcastOpsSummary(),preset=summary.gamePresets.find(item=>item.id===String(req.body.id||''));if(!preset)throw Error('게임 프리셋을 찾지 못했습니다.');
    await discord.requireChannels(true);await operations.update(state=>applyAction(state,'open',{game:preset.game,mode:preset.mode,count:preset.count,title:preset.title,description:preset.description,closeMinutes:Number(preset.closeMinutes)||0}));
    if(participationQueue)await participationQueue.syncOperations({operationsState:operations.read(),records:await records()});try{await discord.sync('open')}catch{}
    await broadcastOps.addTimeline({type:'preset',source:'dashboard',message:`게임 프리셋 시작 · ${preset.name}`});await delegatedAudit(req,{category:'broadcast',action:'game_preset_open',summary:`게임 프리셋으로 모집 시작 · ${preset.name}`});res.json(await snapshot(true,req.dashboardIdentity));
  }catch(error){next(error)}finally{busy=false}});
  app.post('/api/broadcast-ops/schedule',async(req,res,next)=>{try{if(!broadcastOps)throw Object.assign(Error('방송 운영 허브가 초기화되지 않았습니다.'),{status:503});let result;if(req.body.action==='status')result=await broadcastOps.setScheduleStatus(String(req.body.id||''),String(req.body.status||''));else result=await broadcastOps.createSchedule(req.body);await delegatedAudit(req,{category:'broadcast',action:'schedule_update',summary:`방송 일정 ${req.body.action==='status'?'상태 변경':'등록'} · ${result.title}`});res.json(broadcastOpsPayload(req));}catch(error){next(error)}});
  app.post('/api/broadcast-ops/poll',async(req,res,next)=>{try{if(!broadcastOps)throw Object.assign(Error('방송 운영 허브가 초기화되지 않았습니다.'),{status:503});let result;if(req.body.action==='close'){result=await broadcastOps.closePoll(String(req.body.id||''));}else{result=await broadcastOps.createPoll({question:req.body.question,options:req.body.options});const prefs=broadcastOpsSummary().notifications;if(prefs.broadcast!==false)try{await discord.broadcastOpsNotice?.({title:'방송 투표가 시작되었습니다',message:`${result.question}
시청자 대시보드에서 투표할 수 있습니다.`,kind:'poll'});}catch{}}await delegatedAudit(req,{category:'broadcast',action:req.body.action==='close'?'poll_close':'poll_create',summary:`방송 투표 ${req.body.action==='close'?'종료':'시작'} · ${result.question}`});res.json(broadcastOpsPayload(req));}catch(error){next(error)}});
  app.post('/api/broadcast-ops/notifications',async(req,res,next)=>{try{if(!broadcastOps)throw Object.assign(Error('방송 운영 허브가 초기화되지 않았습니다.'),{status:503});const notifications=await broadcastOps.setNotifications(req.body);if(naverMonitor?.store?.setSettings){const current=naverMonitor.summary().settings;await naverMonitor.store.setSettings({...current,discordAlerts:notifications.naver!==false});}if(chzzkLiveMonitor?.store?.setDiscordAlerts)await chzzkLiveMonitor.store.setDiscordAlerts(notifications.broadcast!==false);await delegatedAudit(req,{category:'broadcast',action:'notification_center_settings',summary:'방송 통합 알림센터 설정 변경'});res.json({...broadcastOpsPayload(req),notifications});}catch(error){next(error)}});
  app.get('/api/naver/status',(_req,res)=>{const base=naver?naver.status():{configured:false,oauthConfigured:false,connected:false,capabilities:{oauthLogin:false,publicCafeSearch:false,publicCafeMonitor:false,cafeJoin:false,articleWrite:false,memoArticleWrite:false,comments:false,notices:false},limitations:['네이버 연동 모듈이 초기화되지 않았습니다.']};const monitorSummary=naverMonitor?.summary?.();res.json({...base,monitor:monitorSummary?{settings:monitorSummary.settings,state:monitorSummary.state,seenCount:monitorSummary.seenCount}:null});});
  app.post('/api/naver/oauth/start',async(_req,res,next)=>{try{if(!naver)throw Object.assign(new Error('네이버 연동 모듈이 초기화되지 않았습니다.'),{status:503});const result=naver.beginOAuth();await safeAudit({category:'naver',action:'oauth_start',summary:'네이버 OAuth 연동 시작'});res.json(result);}catch(error){next(error)}});
  app.post('/api/naver/disconnect',async(_req,res,next)=>{try{if(!naver)throw Object.assign(new Error('네이버 연동 모듈이 초기화되지 않았습니다.'),{status:503});const result=await naver.disconnect();await safeAudit({category:'naver',action:'oauth_disconnect',summary:'네이버 계정 연동 해제'});res.json(result);}catch(error){next(error)}});
  app.get('/api/naver/profile',async(_req,res,next)=>{try{if(!naver)throw Object.assign(new Error('네이버 연동 모듈이 초기화되지 않았습니다.'),{status:503});res.json(await naver.profile());}catch(error){next(error)}});
  app.get('/api/naver/search',async(req,res,next)=>{try{if(!naver)throw Object.assign(new Error('네이버 연동 모듈이 초기화되지 않았습니다.'),{status:503});res.json(await naver.searchCafeArticles({query:req.query.q,display:req.query.display,start:req.query.start,sort:req.query.sort}));}catch(error){next(error)}});
  app.post('/api/naver/join',async(req,res,next)=>{try{if(!naver)throw Object.assign(new Error('네이버 연동 모듈이 초기화되지 않았습니다.'),{status:503});const result=await naver.joinCafe({cafeId:req.body.cafeId,nickname:req.body.nickname});await safeAudit({category:'naver',action:'cafe_join',summary:'네이버 카페 가입 요청 완료',details:{cafeId:String(req.body.cafeId||config.naverCafeId||'')}});res.json(result);}catch(error){next(error)}});
  app.post('/api/naver/articles',async(req,res,next)=>{try{if(!naver)throw Object.assign(new Error('네이버 연동 모듈이 초기화되지 않았습니다.'),{status:503});const result=await naver.writeArticle({cafeId:req.body.cafeId,menuId:req.body.menuId,subject:req.body.subject,content:req.body.content});await safeAudit({category:'naver',action:'article_write',summary:'네이버 카페 게시글 작성 완료',details:{cafeId:String(req.body.cafeId||config.naverCafeId||''),menuId:String(req.body.menuId||config.naverMenuId||''),articleId:result.articleId||null}});res.json(result);}catch(error){next(error)}});
  app.get('/api/naver/participation',(req,res)=>res.json(naverParticipationPayload(req)));
  app.post('/api/naver/participation/session',async(req,res,next)=>{let publication=null;try{
    if(!naver||!naverParticipation)throw Object.assign(new Error('네이버 시참 연동 모듈이 초기화되지 않았습니다.'),{status:503});
    const cafeId=String(req.body.cafeId||config.naverCafeId||'').trim(),menuId=String(req.body.menuId||config.naverMemoMenuId||config.naverMenuId||'').trim();
    publication=await naverParticipation.beginPublication({cafeId,menuId});
    const result=await naver.writeArticle({cafeId,menuId,subject:'칼바람 시참',content:'칼바람 시참'});
    const summary=await naverParticipation.completePublication(publication.id,{articleId:result.articleId,articleUrl:result.articleUrl,subject:'칼바람 시참'});if(participationQueue)await participationQueue.syncNaver(summary);
    await safeAudit({category:'naver',action:'participation_session_open',summary:'칼바람 시참 메모 게시 및 순번 접수 시작',details:{cafeId,menuId,articleId:result.articleId||null}});
    res.json(summary);
  }catch(error){
    if(publication&&naverParticipation){const upstream=Number(error?.upstreamStatus)||0,uncertain=!upstream||upstream===429||upstream>=500||Number(error?.status)===504;await naverParticipation.failPublication(publication.id,{uncertain,error:error?.message}).catch(()=>{});}
    next(error);
  }});
  app.post('/api/naver/participation/register',async(req,res,next)=>{try{if(!naverParticipation)throw Object.assign(new Error('네이버 시참 순번 저장소가 초기화되지 않았습니다.'),{status:503});const entry=await naverParticipation.register({displayName:req.body.displayName});if(participationQueue)await participationQueue.syncNaver(naverParticipation.summary());await delegatedAudit(req,{category:'naver',action:'participation_register',summary:`칼바람 시참 순번 등록 · ${entry.order}번`,details:{order:entry.order}});res.json({entry:req.dashboardIdentity?.role==='operator'?sanitizeOperatorNaverParticipation({entries:[entry]}).entries[0]:entry,summary:naverParticipationPayload(req)});}catch(error){next(error)}});
  app.post('/api/naver/participation/cancel',async(req,res,next)=>{try{if(!naverParticipation)throw Object.assign(new Error('네이버 시참 순번 저장소가 초기화되지 않았습니다.'),{status:503});const result=await naverParticipation.cancel(req.body.entryId);if(participationQueue)await participationQueue.syncNaver(result.summary);await delegatedAudit(req,{category:'naver',action:'participation_cancel',summary:'칼바람 시참 순번 취소',details:{entryId:String(req.body.entryId||'').slice(0,80)}});res.json(req.dashboardIdentity?.role==='operator'?sanitizeOperatorNaverParticipation(result.summary):result.summary);}catch(error){next(error)}});
  app.post('/api/naver/participation/close',async(req,res,next)=>{try{if(!naverParticipation)throw Object.assign(new Error('네이버 시참 순번 저장소가 초기화되지 않았습니다.'),{status:503});const result=await naverParticipation.close('dashboard');await delegatedAudit(req,{category:'naver',action:'participation_close',summary:'칼바람 시참 접수 마감',details:{queued:Number(result.counts?.queued)||0}});res.json(req.dashboardIdentity?.role==='operator'?sanitizeOperatorNaverParticipation(result):result);}catch(error){next(error)}});
  app.post('/api/naver/participation/reset',async(_req,res,next)=>{try{if(!naverParticipation)throw Object.assign(new Error('네이버 시참 순번 저장소가 초기화되지 않았습니다.'),{status:503});const result=await naverParticipation.reset('manual');if(participationQueue)await participationQueue.cancelSource?.('naver','naver-reset');await safeAudit({category:'naver',action:'participation_reset',summary:'칼바람 시참 순번/메모 세션 초기화'});res.json(result);}catch(error){next(error)}});
  app.get('/api/participation-queue',(req,res)=>res.json(queuePayload(req)));
  app.post('/api/participation-queue/register',async(req,res,next)=>{try{if(!participationQueue)throw Object.assign(new Error('통합 시참 Queue가 초기화되지 않았습니다.'),{status:503});const s=operations.read().session;const result=await participationQueue.register({source:'dashboard',displayName:req.body.displayName,sessionId:s?.id||null,game:s?.game||null,mode:s?.mode||null,round:s?.round||null,status:'waiting'});await delegatedAudit(req,{category:'operation',action:'queue_register',summary:`통합 시참 Queue 등록 · ${result.entry.displayName}`,details:{source:'dashboard',duplicate:result.duplicate}});res.json(queuePayload(req,{entry:result.entry,duplicate:result.duplicate}));}catch(error){next(error)}});
  app.post('/api/participation-queue/call-next',async(req,res,next)=>{try{if(!participationCalls)throw Object.assign(new Error('시참 호출 서비스가 초기화되지 않았습니다.'),{status:503});const result=await participationCalls.callNext({reason:'dashboard'});await delegatedAudit(req,{category:'operation',action:'queue_call_next',summary:`다음 참가자 호출 · ${result.entry.displayName}`,details:{alreadyCalled:Boolean(result.alreadyCalled)}});res.json(queuePayload(req,{result}));}catch(error){next(error)}});
  app.post('/api/participation-queue/:id/call',async(req,res,next)=>{try{if(!participationCalls)throw Object.assign(new Error('시참 호출 서비스가 초기화되지 않았습니다.'),{status:503});const recall=Boolean(req.body.recall),result=recall?await participationCalls.recall(req.params.id,{reason:'dashboard-recall'}):await participationCalls.callEntry(req.params.id,{reason:'dashboard'});await delegatedAudit(req,{category:'operation',action:recall?'queue_recall':'queue_call',summary:`${recall?'참가자 재호출':'참가자 호출'} · ${result.entry.displayName}`});res.json(queuePayload(req,{result}));}catch(error){next(error)}});
  app.post('/api/participation-queue/:id/call-cancel',async(req,res,next)=>{try{if(!participationCalls)throw Object.assign(new Error('시참 호출 서비스가 초기화되지 않았습니다.'),{status:503});const result=await participationCalls.cancel(req.params.id,{reason:'dashboard-cancel'});await delegatedAudit(req,{category:'operation',action:'queue_call_cancel',summary:`참가자 호출 취소 · ${result.entry?.displayName||req.params.id}`});res.json(queuePayload(req,{result}));}catch(error){next(error)}});
  app.post('/api/participation-queue/:id/status',async(req,res,next)=>{try{if(!participationQueue)throw Object.assign(new Error('통합 시참 Queue가 초기화되지 않았습니다.'),{status:503});const entry=participationQueue.read().entries.find(item=>item.id===req.params.id);if(!entry)throw Object.assign(new Error('참가자를 찾지 못했습니다.'),{status:404});const target=String(req.body.status||''),s=operations.read().session;let mirrored=false;
    if(target==='called')throw Object.assign(new Error('called 상태는 참가자 호출 버튼으로만 시작할 수 있습니다.'),{status:409});
    if(entry.source==='discord'&&entry.discordUserId&&['cancelled','postponed_next','postponed_next2','waiting'].includes(target)){
      if(!s||entry.sessionId!==s.id||s.phase!=='open')throw Object.assign(new Error('Discord 참가자의 취소·미루기·복귀는 모집 중인 현재 회차에서만 변경할 수 있습니다.'),{status:409});
      const map={cancelled:'leave',postponed_next:'postpone_next',postponed_next2:'postpone_later',waiting:'join'},op=map[target];await operations.update(state=>applyAction(state,op,{sessionId:s.id,userId:entry.discordUserId}));mirrored=true;
    }
    const result=participationCalls?await participationCalls.resolveManual(entry.id,target,{reason:'dashboard'}):await participationQueue.setStatus(entry.id,target,{reason:'dashboard'});if(mirrored)await participationQueue.syncOperations({operationsState:operations.read(),records:await records()});await delegatedAudit(req,{category:'operation',action:'queue_status',summary:`통합 시참 Queue 상태 변경 · ${entry.displayName}`,details:{status:target,source:entry.source}});res.json(queuePayload(req,{result}));}catch(error){next(error)}});
  app.post('/api/participation-queue/:id/reorder',async(req,res,next)=>{try{if(!participationQueue)throw Object.assign(new Error('통합 시참 Queue가 초기화되지 않았습니다.'),{status:503});const result=await participationQueue.reorder(req.params.id,req.body.position);await delegatedAudit(req,{category:'operation',action:'queue_reorder',summary:`통합 시참 Queue 순서 변경 · ${result.entry.displayName}`,details:{position:result.entry.position}});res.json(queuePayload(req,{result}));}catch(error){next(error)}});
  app.get('/api/naver/monitor',(_req,res)=>res.json(naverMonitor?naverMonitor.summary():{settings:{enabled:false,query:'',cafeUrl:'',intervalMinutes:5,discordAlerts:true},state:{lastStatus:'idle'},events:[],seenCount:0}));
  app.post('/api/naver/monitor/settings',async(req,res,next)=>{try{if(!naverMonitor)throw Object.assign(new Error('네이버 카페 모니터가 초기화되지 않았습니다.'),{status:503});await naverMonitor.store.setSettings({enabled:Boolean(req.body.enabled),query:req.body.query,cafeUrl:req.body.cafeUrl,intervalMinutes:req.body.intervalMinutes,discordAlerts:req.body.discordAlerts!==false});await safeAudit({category:'naver',action:'monitor_settings',summary:`네이버 공개글 모니터 설정 · ${req.body.enabled?'ON':'OFF'}`,details:{intervalMinutes:Number(req.body.intervalMinutes)||5,discordAlerts:req.body.discordAlerts!==false}});queueMicrotask(()=>naverMonitor.run({force:false}).catch(()=>{}));res.json(naverMonitor.summary());}catch(error){next(error)}});
  app.post('/api/naver/monitor/run',async(_req,res,next)=>{try{if(!naverMonitor)throw Object.assign(new Error('네이버 카페 모니터가 초기화되지 않았습니다.'),{status:503});const result=await naverMonitor.run({force:true});await safeAudit({category:'naver',action:'monitor_manual_run',summary:'네이버 공개글 모니터 수동 점검'});res.json(result);}catch(error){next(error)}});
  app.post('/api/naver/monitor/retry',async(req,res,next)=>{try{if(!naverMonitor)throw Object.assign(new Error('네이버 카페 모니터가 초기화되지 않았습니다.'),{status:503});const id=String(req.body.eventId||'').trim();if(!id)throw Error('재전송할 이벤트가 없습니다.');res.json(await naverMonitor.retry(id));}catch(error){next(error)}});
  app.get('/api/chzzk/live',(_req,res)=>res.json(chzzkLiveMonitor?.summary?.()||{settings:{enabled:false,channelId:'',intervalMinutes:2,discordAlerts:true,maxPages:50},state:{lastStatus:'idle'},currentLive:null,events:[],connector:{configured:false}}));
  app.post('/api/chzzk/live/run',async(_req,res,next)=>{try{if(!chzzkLiveMonitor)throw Object.assign(new Error('치지직 방송 감지 모듈이 초기화되지 않았습니다.'),{status:503});const result=await chzzkLiveMonitor.run({force:true});await delegatedAudit(_req,{category:'broadcast',action:'chzzk_live_manual_check',summary:'치지직 방송 상태 수동 점검'});res.json(result);}catch(error){next(error)}});

  app.get('/api/mobile-health',async(req,res,next)=>{try{res.json(await mobileHealthPayload(req.dashboardIdentity));}catch(error){next(error)}});
  app.get('/api/incidents',async(_req,res,next)=>{try{await syncIncidentWorkflow();res.json(incidentStore.summary());}catch(error){next(error)}});
  app.post('/api/incidents/:id/ack',async(req,res,next)=>{try{const owner=String(req.body.owner||config.dashboardUser||'admin').trim().slice(0,80),note=String(req.body.note||'').trim().slice(0,180);const result=await incidentStore.acknowledge(req.params.id,{owner,note,actor:auditActor(req)});await safeAudit({category:'runtime',action:'incident_ack',summary:`장애 확인 · ${req.params.id}`,details:{owner}});res.json(result);}catch(error){next(error)}});
  app.post('/api/incidents/:id/resolve',async(req,res,next)=>{try{const note=String(req.body.note||'').trim().slice(0,180);const result=await incidentStore.resolve(req.params.id,{note,actor:auditActor(req)});await safeAudit({category:'runtime',action:'incident_resolve',summary:`장애 수동 해제 · ${req.params.id}`});res.json(result);}catch(error){next(error)}});
  app.post('/api/incidents/:id/reopen',async(req,res,next)=>{try{const result=await incidentStore.reopen(req.params.id,{actor:auditActor(req)});await safeAudit({category:'runtime',action:'incident_reopen',summary:`장애 다시 열기 · ${req.params.id}`});res.json(result);}catch(error){next(error)}});
  app.get('/api/discord-audit',async(req,res,next)=>{try{res.json(await discord.configurationAudit({adminRoleId:config.adminRoleId,force:req.query.force==='1',baseline:currentPolicyBaseline()}));}catch(error){next(error)}});
  app.get('/api/discord-fix-plan',async(req,res,next)=>{try{res.json(await discord.safeFixPlan({adminRoleId:config.adminRoleId,force:req.query.force==='1',baseline:currentPolicyBaseline()}));}catch(error){next(error)}});
  app.get('/api/discord-policy',async(req,res,next)=>{try{res.json(await buildDiscordPolicyView({force:req.query.force==='1'}));}catch(error){next(error)}});
  app.post('/api/discord-policy/monitor',async(req,res,next)=>{try{
    const intervalMinutes=Number(req.body.intervalMinutes);if(!DISCORD_POLICY_MONITOR_INTERVALS.includes(intervalMinutes))throw Error('모니터 간격은 1, 5, 15, 30, 60분 중에서 선택해 주세요.');
    const alertMode=String(req.body.alertMode??(req.body.discordAlerts?'all':'off'));if(!DISCORD_POLICY_ALERT_MODES.includes(alertMode))throw Error('Discord 알림 라우팅은 끔, MANUAL만, 전체 중에서 선택해 주세요.');
    const summary=await policyStore.setMonitorSettings({enabled:Boolean(req.body.enabled),intervalMinutes,alertMode,recoveryAlerts:req.body.recoveryAlerts!==false});
    await safeAudit({category:'discord',action:'discord_policy_monitor_settings',summary:`Discord Policy Monitor · ${summary.monitor.enabled?'ON':'OFF'} · ${summary.monitor.intervalMinutes}분 · 알림 ${summary.monitor.alertMode.toUpperCase()} · 해소 알림 ${summary.monitor.recoveryAlerts?'ON':'OFF'}`});
    if(summary.monitor.enabled)queueMicrotask(()=>runPolicyMonitor({force:true}).catch(()=>{}));res.json(await buildDiscordPolicyView({record:false}));
  }catch(error){next(error)}});
  app.post('/api/discord-policy/monitor/run',async(_req,res,next)=>{try{const result=await runPolicyMonitor({force:true});res.json(result.view||await buildDiscordPolicyView({record:false}));}catch(error){next(error)}});
  app.post('/api/discord-policy/maintenance/start',async(req,res,next)=>{try{
    if(!currentPolicyBaseline())throw Error('Discord 정상 기준선을 먼저 저장해 주세요.');
    const durationMinutes=Number(req.body.durationMinutes);if(!DISCORD_POLICY_MAINTENANCE_DURATIONS.includes(durationMinutes))throw Error('점검 모드는 15, 30, 60, 120분 중에서 선택해 주세요.');
    const reason=String(req.body.reason||'').trim();if(!reason)throw Error('점검 사유를 입력해 주세요.');if(reason.length>120)throw Error('점검 사유는 120자 이하로 입력해 주세요.');
    const summary=await policyStore.startMaintenance({durationMinutes,reason,actor:auditActor(req)});await safeAudit({category:'discord',action:'discord_policy_maintenance_start',summary:`Discord 정책 점검 모드 시작 · ${durationMinutes}분 · ${reason}`});
    res.json(await buildDiscordPolicyView({record:false}));
  }catch(error){next(error)}});
  app.post('/api/discord-policy/maintenance/end',async(req,res,next)=>{try{await policyStore.endMaintenance({actor:auditActor(req)});await safeAudit({category:'discord',action:'discord_policy_maintenance_end',summary:'Discord 정책 점검 모드 종료'});queueMicrotask(()=>runPolicyMonitor({force:true}).catch(()=>{}));res.json(await buildDiscordPolicyView({record:false}));}catch(error){next(error)}});
  app.post('/api/discord-policy/ack',async(req,res,next)=>{try{
    const view=await buildDiscordPolicyView({force:true,record:true});if(view.comparison?.status!=='drift')throw Error('현재 확인 처리할 Discord drift가 없습니다.');const note=String(req.body.note||'').trim();if(note.length>120)throw Error('확인 메모는 120자 이하로 입력해 주세요.');
    await policyStore.acknowledge({digest:view.comparison.digest,note,actor:auditActor(req)});await safeAudit({category:'discord',action:'discord_policy_ack',summary:`Discord drift 확인 처리 · ${view.comparison.counts?.total||0}개`,details:{digest:view.comparison.digest.slice(0,12)}});res.json(await buildDiscordPolicyView({record:false}));
  }catch(error){next(error)}});
  app.post('/api/discord-policy/ack/clear',async(req,res,next)=>{try{await policyStore.clearAcknowledgement({actor:auditActor(req)});await safeAudit({category:'discord',action:'discord_policy_ack_clear',summary:'Discord drift 확인 상태 해제'});queueMicrotask(()=>runPolicyMonitor({force:true}).catch(()=>{}));res.json(await buildDiscordPolicyView({record:false}));}catch(error){next(error)}});
  app.post('/api/discord-policy/baseline',async(req,res,next)=>{try{
    const audit=await discord.configurationAudit({adminRoleId:config.adminRoleId,force:true,baseline:currentPolicyBaseline()});
    const plan=await discord.safeFixPlan({adminRoleId:config.adminRoleId,force:true,baseline:currentPolicyBaseline()});
    if(!audit.connected&&!config.demo)throw Error('Discord 연결이 준비된 뒤 기준선을 저장해 주세요.');
    if((audit.counts?.fail||0)>0||plan.counts?.blocked>0||plan.counts?.safe>0)throw Error('기준선을 저장하기 전에 FAIL/BLOCKED/SAFE 항목을 먼저 정리해 주세요. MANUAL 경고는 의도된 설정이라면 기준선에 포함할 수 있습니다.');
    const current=await discord.policySnapshot({adminRoleId:config.adminRoleId,baseline:currentPolicyBaseline(),force:true});
    const baseline=await policyStore.setBaseline(current,{actor:auditActor(req)});
    await safeAudit({category:'discord',action:'discord_policy_baseline',summary:`Discord 정상 기준선 저장 · ${baseline.digest.slice(0,12)}`});
    res.json(await buildDiscordPolicyView({force:true,record:false}));
  }catch(error){next(error)}});
  app.get('/api/health',async(req,res)=>{
    if(!statusCache||Date.now()-statusAt>5000){statusCache=await discord.diagnostics();statusAt=Date.now();}
    const remoteWarning=dashboardExposureWarning(config,req.secure);
    const current=operations.read(),runtimeState=runtime.snapshot({liveClients:streams.size,version:APP_VERSION,revision:Number(current.revision)||0,recovered:store.recovered||operations.recovered||recoveryStore.recovered||policyStore.recovered||incidentStore.recovered||Boolean(naver?.authStore?.recovered)||Boolean(naverMonitor?.store?.recovered)||Boolean(naverParticipation?.recovered)}),capacityState=await performanceSnapshot(),incidentSummary=incidentStore.summary();
    const policySummary=policyStore.summary();res.json({...statusCache,warning:[discord.warning||statusCache.warning,remoteWarning].filter(Boolean).join(' · '),recovered:store.recovered||operations.recovered||recoveryStore.recovered||policyStore.recovered||incidentStore.recovered||Boolean(naver?.authStore?.recovered)||Boolean(naverMonitor?.store?.recovered)||Boolean(naverParticipation?.recovered),liveClients:streams.size,runtimeStatus:runtimeState.status,capacityStatus:capacityState.status,incidentStatus:incidentSummary.status,incidentCounts:incidentSummary.counts,policyMonitorStatus:policySummary.monitorState?.lastStatus||'idle',policyDriftStatus:policySummary.monitorState?.lastComparisonStatus||'none',policyMonitorEnabled:Boolean(policySummary.monitor?.enabled),policyMaintenance:Boolean(policySummary.maintenance?.active),policyAcknowledged:Boolean(policySummary.acknowledgement?.digest&&policySummary.acknowledgement.digest===policySummary.monitorState?.lastComparisonDigest),profile:config.profile,draining,version:APP_VERSION,revision:Number(current.revision)||0});
  });
  app.get('/api/backup',async(_req,res)=>{res.attachment(`daengdaeng-backup-${new Date().toISOString().slice(0,10)}.json`);res.json({version:2,guildId:config.guildId,exportedAt:new Date().toISOString(),records:await records(),operations:operations.read()});});
  app.get('/api/recovery',(_req,res)=>res.json(recoveryStore.summary(config.guildId)));
  const safeDeploySnapshot=()=>{
    const current=operations.read(),recoveryState=recoveryStore.read(),baseline=[...(recoveryState.restorePoints||[])].find(point=>point.guildId===config.guildId&&point.reason==='auto-before-update'&&verifyRestorePoint(point,config.guildId).ok);
    const migration=migrationPreview(current,{guildId:config.guildId,appVersion:APP_VERSION});
    return {version:APP_VERSION,dataSchemaVersion:DATA_SCHEMA_VERSION,currentSchema:Number(current.schemaVersion)||1,appVersion:current.appVersion||'legacy',migration,update:current.safeDeploy||null,baseline:baseline?{id:baseline.id,label:baseline.label,createdAt:baseline.createdAt,revision:baseline.revision}:null,settingsDiff:baseline?buildSettingsDiff(baseline.operations,current):[],pendingApprovals:approvalGuard.size()};
  };
  app.get('/api/safe-deploy',(_req,res)=>res.json(safeDeploySnapshot()));
  app.post('/api/guard/prepare',async(req,res,next)=>{try{
    const action=req.body.action;let targetKey='',summary='위험 작업';
    if(action==='restore-point'||action==='delete-restore-point'){
      const point=recoveryStore.getPoint(req.body.targetId),verified=verifyRestorePoint(point,config.guildId);if(!verified.ok)throw Error(verified.reason);targetKey=`point:${point.id}:${point.digest}`;summary=action==='restore-point'?`복원 지점 적용 · ${point.label}`:`복원 지점 삭제 · ${point.label}`;
      if(action==='delete-restore-point'){const valid=(recoveryStore.read().restorePoints||[]).filter(p=>verifyRestorePoint(p,config.guildId).ok);if(valid.length<=1)throw Error('마지막 정상 복원 지점은 삭제할 수 없습니다. 새 복원 지점을 먼저 만들어 주세요.');}
    }else if(action==='restore-backup'){
      const result=inspectBackup(req.body.bundle,config.guildId);if(!result.ok)throw Error('백업 검증에 실패했습니다. 먼저 백업 검증을 통과해 주세요.');targetKey=`backup:${result.digest}`;summary=`전체 백업 복원 · 참가자 ${result.stats.records}명`;
    }else if(action==='apply-migration'){
      const preview=migrationPreview(operations.read(),{guildId:config.guildId,appVersion:APP_VERSION});if(!preview.needed)throw Error('현재 데이터는 이미 최신 스키마입니다.');targetKey=`migration:${preview.from}:${preview.to}:${Number(operations.read().revision)||0}`;summary=`데이터 마이그레이션 v${preview.from} → v${preview.to}`;
    }else if(action==='apply-release'){
      requireLocalRelease(req);const release=releaseCenter.snapshot();if(release.status!=='staged'||!release.manifestDigest)throw Error('먼저 업데이트 패키지를 검증·스테이징해 주세요.');targetKey=`release:${release.manifestDigest}`;summary=`코드 업데이트 적용 · ${APP_VERSION} → ${release.targetVersion}`;
    }else if(action==='rollback-release'){
      requireLocalRelease(req);const release=releaseCenter.snapshot();if(!release.releaseId)throw Error('롤백할 코드 업데이트 기록이 없습니다.');targetKey=`release-rollback:${release.releaseId}`;summary=`코드 업데이트 롤백 · ${release.releaseId}`;
    }else if(action==='trust-release-key'){
      requireLocalRelease(req);const key=releaseCenter.previewTrustedKey(req.body.publicKeyPem,req.body.name||'사용자 릴리스 키');targetKey=`release-trust-key:${key.keyId}`;summary=`릴리스 공개키 신뢰 · ${key.name} (${key.keyId})`;
    }else if(action==='remove-release-key'){
      requireLocalRelease(req);const key=releaseCenter.getTrustedKey(req.body.keyId);if(!key)throw Error('삭제할 릴리스 신뢰 키를 찾지 못했습니다.');if(key.builtin)throw Error('내장 릴리스 신뢰 키는 삭제할 수 없습니다.');targetKey=`release-trust-remove:${key.keyId}`;summary=`릴리스 신뢰 키 삭제 · ${key.name} (${key.keyId})`;
    }else if(action==='set-release-policy'){
      requireLocalRelease(req);const policy=String(req.body.policy||'');if(!['warn','required'].includes(policy))throw Error('Trust Policy를 확인해 주세요.');targetKey=`release-trust-policy:${policy}`;summary=`릴리스 Trust Policy 변경 · ${policy.toUpperCase()}`;
    }else if(action==='apply-discord-fix'){
      const plan=await discord.safeFixPlan({adminRoleId:config.adminRoleId,force:true,baseline:currentPolicyBaseline()}),ids=validateSafeFixSelection(plan,req.body.actionIds);targetKey=discordFixTargetKey(plan,ids);summary=`Discord 안전 수정 · ${ids.join(', ')}`;
    }else if(action==='restore-discord-baseline'){
      const view=await buildDiscordPolicyView({force:true,record:false});if(!view.baseline)throw Error('저장된 Discord 기준선이 없습니다.');if(!view.comparison.safeActions?.length)throw Error('기준선으로 자동 복구할 SAFE drift가 없습니다.');
      const plan=await discord.safeFixPlan({adminRoleId:config.adminRoleId,force:true,baseline:currentPolicyBaseline()}),ids=validateSafeFixSelection(plan,view.comparison.safeActions);targetKey=`discord-baseline:${view.baseline.digest}:${view.comparison.digest}:${discordFixTargetKey(plan,ids)}`;summary=`Discord 기준선 SAFE 복구 · ${ids.join(', ')}`;
    }else if(action==='emergency-lock'){const emergency=emergencyState();if(emergency.locked)throw Error('이미 긴급 잠금 상태입니다.');targetKey='emergency:unlocked';summary='모바일 긴급 운영 잠금 활성화';
    }else if(action==='emergency-unlock'){const emergency=emergencyState();if(!emergency.locked)throw Error('현재 긴급 잠금 상태가 아닙니다.');targetKey=`emergency:locked:${Number(emergency.lockedAt)||0}:${emergency.checkpointId||''}`;summary='모바일 긴급 운영 잠금 해제';
    }else throw Error('지원하지 않는 승인 작업입니다.');
    const approval=approvalGuard.prepare(action,targetKey,{summary});await safeAudit({category:'system',action:'guard_prepare',summary:`2단계 승인 준비 · ${summary}`});res.json(approval);
  }catch(error){next(error)}});
  app.post('/api/discord-fix/apply',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{
    const plan=await discord.safeFixPlan({adminRoleId:config.adminRoleId,force:true,baseline:currentPolicyBaseline()}),ids=validateSafeFixSelection(plan,req.body.actionIds),targetKey=discordFixTargetKey(plan,ids);approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'apply-discord-fix',targetKey);
    const result=await discord.applySafeFix({actionIds:ids,adminRoleId:config.adminRoleId,expectedDigest:plan.digest,baseline:currentPolicyBaseline()});statusCache=null;statusAt=0;await safeAudit({category:'discord',action:'discord_safe_fix',summary:`Discord 안전 수정 ${result.partial?'부분 적용':result.ok?'적용':'실패'} · ${ids.join(', ')}`,details:{requested:ids.length,applied:result.applied||[],failed:result.failed||[]}});res.json(result);
  }catch(error){next(error)}finally{busy=false}});
  app.post('/api/discord-policy/restore',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{
    const view=await buildDiscordPolicyView({force:true,record:false});if(!view.baseline)throw Error('저장된 Discord 기준선이 없습니다.');if(!view.comparison.safeActions?.length)throw Error('기준선으로 자동 복구할 SAFE drift가 없습니다.');
    const plan=await discord.safeFixPlan({adminRoleId:config.adminRoleId,force:true,baseline:currentPolicyBaseline()}),ids=validateSafeFixSelection(plan,view.comparison.safeActions),targetKey=`discord-baseline:${view.baseline.digest}:${view.comparison.digest}:${discordFixTargetKey(plan,ids)}`;
    approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'restore-discord-baseline',targetKey);
    const result=await discord.applySafeFix({actionIds:ids,adminRoleId:config.adminRoleId,expectedDigest:plan.digest,baseline:currentPolicyBaseline()});statusCache=null;statusAt=0;
    await safeAudit({category:'discord',action:'discord_policy_restore',summary:`Discord 기준선 SAFE 복구 ${result.ok?'완료':'부분/실패'} · ${ids.join(', ')}`,details:{applied:result.applied||[],failed:result.failed||[]}});
    res.json({result,policy:await buildDiscordPolicyView({force:true})});
  }catch(error){next(error)}finally{busy=false}});
  app.post('/api/safe-deploy/migrate',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{
    const current=operations.read(),preview=migrationPreview(current,{guildId:config.guildId,appVersion:APP_VERSION}),targetKey=`migration:${preview.from}:${preview.to}:${Number(current.revision)||0}`;approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'apply-migration',targetKey);if(!preview.needed)throw Error('현재 데이터는 이미 최신 스키마입니다.');
    await checkpoint(`마이그레이션 전 자동 보호 · schema v${preview.from}`,'auto-before-migration');const migrated=migrateOperationsState(current,{guildId:config.guildId,appVersion:APP_VERSION});await operations.update(state=>{for(const key of Object.keys(state))delete state[key];Object.assign(state,migrated.state);state.revision=(Number(state.revision)||0)+1;});await safeAudit({category:'system',action:'migration_apply',summary:`데이터 마이그레이션 v${migrated.from} → v${migrated.to}`,details:{changes:migrated.changes.length}});res.json({...(await snapshot()),safeDeploy:{migration:{needed:false,from:migrated.to,to:migrated.to,changes:[]}}});
  }catch(error){next(error)}finally{busy=false}});
  const selfCheckSnapshot=async({preferCachedDiscord=false}={})=>{
    const local=buildLocalSelfCheck({config,records:await records(),operations:operations.read(),recovery:recoveryStore.read(),recovered:store.recovered||operations.recovered||recoveryStore.recovered});
    let discordCheck;try{let d;if(preferCachedDiscord&&statusCache&&Date.now()-statusAt<30000)d=statusCache;else{d=await discord.diagnostics();statusCache=d;statusAt=Date.now();}discordCheck={id:'discord',label:'Discord 연결·권한',status:config.demo||d.connected?'pass':'warn',detail:config.demo?'연습 모드 · Discord 연결 생략':d.message||d.warning||'Discord 상태를 확인하세요.'};}catch(error){runtime.recordIncident({severity:'warn',source:'discord',code:'diagnostics_failure',summary:'Discord 진단 요청 실패',detail:error?.message});discordCheck={id:'discord',label:'Discord 연결·권한',status:'warn',detail:'Discord 진단 요청에 실패했습니다.'};}
    let discordConfigCheck;try{const audit=await discord.configurationAudit({adminRoleId:config.adminRoleId});discordConfigCheck={id:'discord-config',label:'Discord 권한·설치 구성',status:config.demo?'pass':audit.status,detail:config.demo?'연습 모드 · Discord 구성 검사 생략':audit.status==='pass'?'최소 권한·Intent·Guild Command 기준 통과':`오류 ${audit.counts?.fail||0} · 경고 ${audit.counts?.warn||0} · Discord 권한 감사 센터 확인`};}catch(error){discordConfigCheck={id:'discord-config',label:'Discord 권한·설치 구성',status:'warn',detail:'Discord 구성 감사를 완료하지 못했습니다.'};}
    const checks=[...local.checks,discordCheck,discordConfigCheck];if(streams.size>=Math.ceil(dashboardStreamLimit*.75))checks.push({id:'sse-capacity',label:'실시간 대시보드 연결 수',status:'warn',detail:`${streams.size}/${dashboardStreamLimit} 연결 사용 중`});else checks.push({id:'sse-capacity',label:'실시간 대시보드 연결 수',status:'pass',detail:`${streams.size}/${dashboardStreamLimit} 연결 사용 중`});
    const broadcastStats=broadcast.stats?.()||{liveClients:0,limit:8};if(broadcastStats.liveClients>=Math.ceil(broadcastStats.limit*.75))checks.push({id:'broadcast-sse-capacity',label:'방송 화면 연결 수',status:'warn',detail:`${broadcastStats.liveClients}/${broadcastStats.limit} 연결 사용 중`});else checks.push({id:'broadcast-sse-capacity',label:'방송 화면 연결 수',status:'pass',detail:`${broadcastStats.liveClients}/${broadcastStats.limit} 연결 사용 중`});
    const counts={pass:checks.filter(c=>c.status==='pass').length,warn:checks.filter(c=>c.status==='warn').length,fail:checks.filter(c=>c.status==='fail').length};
    return {ok:counts.fail===0,counts,checks,checkedAt:Date.now(),version:APP_VERSION};
  };
  app.get('/api/self-check',async(_req,res,next)=>{try{res.json(await selfCheckSnapshot());}catch(error){next(error)}});
  app.get('/api/mobile-recovery',async(req,res,next)=>{try{if(req.dashboardIdentity?.role!=='admin')return res.status(403).json({error:'Recovery & Emergency Controls는 관리자 계정에서만 사용할 수 있습니다.'});const recoverySummary=recoveryStore.summary(config.guildId),selfCheck=await selfCheckSnapshot({preferCachedDiscord:true});res.json({version:APP_VERSION,checkedAt:Date.now(),access:publicDashboardAccess(req.dashboardIdentity),emergency:emergencyState(),recovery:{restorePoints:recoverySummary.restorePoints||[],auditLog:(recoverySummary.auditLog||[]).filter(item=>['recovery','system'].includes(item.category)).slice(0,30)},selfCheck:{ok:selfCheck.ok,counts:selfCheck.counts,checks:(selfCheck.checks||[]).slice(0,30)},downloads:{backup:'/api/backup',diagnostics:'/api/runtime/diagnostics'}});}catch(error){next(error)}});
  app.post('/api/emergency/lock',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{if(req.dashboardIdentity?.role!=='admin')return res.status(403).json({error:'긴급 잠금은 관리자만 실행할 수 있습니다.'});const current=emergencyState();if(current.locked)throw Object.assign(Error('이미 긴급 잠금 상태입니다.'),{status:409});approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'emergency-lock','emergency:unlocked');const reason=String(req.body.reason||'').replace(/[\r\n\t]+/g,' ').trim().slice(0,160)||'방송 운영 긴급 점검';const at=Date.now(),point=await checkpoint(`긴급 잠금 자동 보호 · ${new Date(at).toISOString()}`,'auto-emergency-lock');const emergency=await recoveryStore.setEmergency({locked:true,actor:auditActor(req),reason,checkpointId:point.id,at});await participationCalls?.pause?.('emergency-lock',{at});await delegatedAudit(req,{category:'recovery',action:'emergency_lock',summary:`긴급 운영 잠금 활성화 · ${reason}`,details:{checkpointId:point.id}});res.json({emergency,recovery:recoveryStore.summary(config.guildId),message:'긴급 운영 잠금을 활성화하고 자동 복원 지점을 생성했습니다.'});}catch(error){next(error)}finally{busy=false}});
  app.post('/api/emergency/unlock',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{if(req.dashboardIdentity?.role!=='admin')return res.status(403).json({error:'긴급 잠금 해제는 관리자만 실행할 수 있습니다.'});const current=emergencyState();if(!current.locked)throw Object.assign(Error('현재 긴급 잠금 상태가 아닙니다.'),{status:409});const targetKey=`emergency:locked:${Number(current.lockedAt)||0}:${current.checkpointId||''}`;approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'emergency-unlock',targetKey);const at=Date.now();await participationCalls?.resume?.('emergency-unlock',{at});let emergency;try{emergency=await recoveryStore.setEmergency({locked:false,actor:auditActor(req),at});}catch(error){await participationCalls?.pause?.('emergency-unlock-rollback',{at:Date.now()}).catch(()=>{});throw error;}await delegatedAudit(req,{category:'recovery',action:'emergency_unlock',summary:'긴급 운영 잠금 해제',details:{lockedAt:current.lockedAt,checkpointId:current.checkpointId||null}});res.json({emergency,recovery:recoveryStore.summary(config.guildId),message:'긴급 운영 잠금을 해제했습니다. 자동 타이머와 참가자 호출을 재개합니다.'});}catch(error){next(error)}finally{busy=false}});
  app.get('/api/runtime-health',(_req,res)=>{const current=operations.read();res.json({...runtime.snapshot({liveClients:streams.size,version:APP_VERSION,revision:Number(current.revision)||0,recovered:store.recovered||operations.recovered||recoveryStore.recovered||Boolean(idempotencyStore?.recovered)}),idempotency:apiIdempotency.stats()});});
  app.get('/api/performance-capacity',async(_req,res,next)=>{try{res.json(await performanceSnapshot());}catch(error){next(error)}});
  const productionMonitor=new ProductionMonitor({config,probe:()=>runConnectorProbes({config,discord,naver,chzzk:chzzkLiveMonitor?.chzzk||null})});
  const monitoringSnapshot=()=>productionMonitor.snapshot({runtime:runtimeSnapshot(),incidents:incidentStore.summary(),releaseState:releaseCenter?.snapshot?.()||null,emergency:emergencyState(),draining,environment:environmentSnapshot(),recovering:Boolean(releaseCenter?.recoveredThisBoot)});
  app.get('/api/production-monitoring',(_req,res)=>res.json(monitoringSnapshot()));
  app.post('/api/production-monitoring/probe',async(req,res,next)=>{try{
    if(req.dashboardIdentity?.role!=='admin')return res.status(403).json({error:'Production monitoring 검증은 관리자만 실행할 수 있습니다.'});
    await productionMonitor.run();const report=monitoringSnapshot();
    await delegatedAudit(req,{category:'deployment',action:'production_monitoring',summary:'Production monitoring 검사',details:{status:report.status,blocking:report.counts.blocking}});
    res.json(report);
  }catch(error){if(error?.status===429)res.set('Retry-After',String(Math.ceil(error.retryAfterMs/1000)));next(error);}});
  const environmentSnapshot=()=>buildProductionEnvironmentValidation({config});
  const deploymentSnapshot=async()=>{
    const current=operations.read(),preflight=await runStartupPreflight({config,checkPort:false}),selfCheck=await selfCheckSnapshot({preferCachedDiscord:true}),runtimeState=runtime.snapshot({liveClients:streams.size,version:APP_VERSION,revision:Number(current.revision)||0,recovered:store.recovered||operations.recovered||recoveryStore.recovered||incidentStore.recovered||Boolean(idempotencyStore?.recovered)}),capacity=await performanceSnapshot(),backup=await backups.summary(),soakState=soak.snapshot(),incidents=incidentStore.summary(),hostBootstrap=buildHostBootstrap({config}),environmentValidation=environmentSnapshot(),readiness=buildDeploymentReadiness({config,preflight,selfCheck,runtime:runtimeState,capacity,backup,soak:soakState,incidents,environmentValidation});
    return {...readiness,version:APP_VERSION,dataSchemaVersion:DATA_SCHEMA_VERSION,startupPreflight,startupEnvironmentValidation,environmentValidation,preflight,selfCheck,runtime:{status:runtimeState.status,uptimeMs:runtimeState.uptimeMs},capacity:{status:capacity.status,signals:capacity.signals},incidents:{status:incidents.status,counts:incidents.counts},idempotency:apiIdempotency.stats(),backup,soak:soakState,hostBootstrap,gracefulShutdown:{draining,timeoutMs:10000}};
  };
  app.get('/api/deployment-readiness',async(_req,res,next)=>{try{res.json(await deploymentSnapshot());}catch(error){next(error)}});
  app.get('/api/host-bootstrap',(_req,res)=>res.json(buildHostBootstrap({config})));
  app.get('/api/environment-validation',(_req,res)=>res.json(environmentSnapshot()));
  app.get('/api/connector-verification',(_req,res)=>{const base={config,discordStatus:statusCache,naverStatus:naver?.status?.()||null,chzzkStatus:chzzkLiveMonitor?.summary?.()?.connector||null};res.json(buildConnectorVerification(base));});
  app.post('/api/connector-verification/probe',async(req,res,next)=>{try{if(req.dashboardIdentity?.role!=='admin')return res.status(403).json({error:'Production connector 실제 연결 검증은 관리자만 실행할 수 있습니다.'});const base={config,discordStatus:statusCache,naverStatus:naver?.status?.()||null,chzzkStatus:chzzkLiveMonitor?.summary?.()?.connector||null};const probes=await productionMonitor.run();const report=buildConnectorVerification({...base,discordProbe:probes.discord,naverProbe:probes.naver,chzzkProbe:probes.chzzk,publicProbe:probes.public});await delegatedAudit(req,{category:'deployment',action:'connector_verification',summary:`Production connector 연결 검증 · ${report.status}`});res.json(report);}catch(error){next(error)}});
  const productionAcceptanceSnapshot=async({verify=false}={})=>{
    const deployment=await deploymentSnapshot(),incidentSummary=incidentStore.summary(),naverStatus=naver?.status?.()||{connected:false},naverSummary=naverParticipation?.summary?.()||{registrationOpen:false},chzzkSummary=chzzkLiveMonitor?.summary?.()||{settings:{enabled:false},state:{lastStatus:'idle'},connector:{configured:false}};
    const connectorBase={config,discordStatus:statusCache,naverStatus,chzzkStatus:chzzkSummary.connector};
    let connectorVerification=buildConnectorVerification(connectorBase);
    if(verify){const probes=await productionMonitor.run();connectorVerification=buildConnectorVerification({...connectorBase,discordProbe:probes.discord,naverProbe:probes.naver,chzzkProbe:probes.chzzk,publicProbe:probes.public});}
    const goLive=buildGoLiveReadiness({config,deployment,naver:naverStatus,naverParticipation:naverSummary,chzzkLive:chzzkSummary,emergency:emergencyState(),incidents:incidentSummary,hostBootstrap:deployment.hostBootstrap,environmentValidation:deployment.environmentValidation,connectorVerification,now:Date.now()});
    const releaseState=releaseCenter?.snapshot?.()||null;
    return {...buildProductionAcceptance({deployment,goLive,connectorVerification,releaseState,draining,monitoring:monitoringSnapshot(),verified:verify,now:Date.now()}),version:APP_VERSION,dataSchemaVersion:DATA_SCHEMA_VERSION};
  };
  app.get('/api/production-acceptance',async(req,res,next)=>{try{const report=await productionAcceptanceSnapshot();if(String(req.query?.download||'')==='1')res.attachment(`daengdaeng-production-acceptance-${APP_VERSION}.json`);res.json(report);}catch(error){next(error)}});
  app.post('/api/production-acceptance/verify',async(req,res,next)=>{try{if(req.dashboardIdentity?.role!=='admin')return res.status(403).json({error:'Production acceptance 실제 검증은 관리자만 실행할 수 있습니다.'});const report=await productionAcceptanceSnapshot({verify:true});await delegatedAudit(req,{category:'deployment',action:'production_acceptance',summary:`Production acceptance 검증 · ${report.status}`,details:{launchable:report.launchable,blocking:report.counts?.blocking||0}});res.json(report);}catch(error){next(error)}});
  const productionCutoverSnapshot=async({verify=false,trafficOpened=false}={})=>{
    const acceptance=await productionAcceptanceSnapshot({verify});
    const runtimeState=runtimeSnapshot(),incidents=incidentStore.summary(),releaseState=releaseCenter?.snapshot?.()||null;
    let manifest=null;
    try{if(releaseCenter?.projectRoot){const current=await buildCurrentManifest(releaseCenter.projectRoot,APP_VERSION,DATA_SCHEMA_VERSION);manifest={status:'pass',files:current.files.length,digest:current.digest};}else manifest={status:'fail',detail:'Release Center가 초기화되지 않아 현재 코드 Manifest를 계산할 수 없습니다.'};}
    catch(error){runtime.recordIncident({severity:'warn',source:'release',code:'production_cutover_manifest_failure',summary:'Post-Cutover 코드 Manifest 계산 실패',detail:error?.message,persist:false});manifest={status:'fail',detail:'현재 코드 Manifest를 계산하지 못했습니다.'};}
    return {...buildProductionCutoverVerification({acceptance,runtime:runtimeState,incidents,releaseState,manifest,draining,trafficOpened,verified:verify,now:Date.now()}),version:APP_VERSION,dataSchemaVersion:DATA_SCHEMA_VERSION};
  };
  app.get('/api/production-cutover',async(req,res,next)=>{try{const report=await productionCutoverSnapshot();if(String(req.query?.download||'')==='1')res.attachment(`daengdaeng-production-cutover-${APP_VERSION}.json`);res.json(report);}catch(error){next(error)}});
  app.post('/api/production-cutover/verify',async(req,res,next)=>{try{if(req.dashboardIdentity?.role!=='admin')return res.status(403).json({error:'Post-Cutover 실제 검증은 관리자만 실행할 수 있습니다.'});if(req.body?.trafficOpened!==true)return res.status(400).json({error:'외부 호스트 또는 Reverse Proxy에서 실서비스 트래픽 전환 완료를 확인한 뒤 검증하세요.'});const report=await productionCutoverSnapshot({verify:true,trafficOpened:true});await delegatedAudit(req,{category:'deployment',action:'production_cutover_verification',summary:`Post-Cutover smoke 검증 · ${report.status}`,details:{stabilized:report.stabilized,blocking:report.counts?.blocking||0}});res.json(report);}catch(error){next(error)}});
  app.get('/api/go-live-readiness',async(_req,res,next)=>{try{
    const deployment=await deploymentSnapshot(),incidentSummary=incidentStore.summary(),naverStatus=naver?.status?.()||{connected:false},naverSummary=naverParticipation?.summary?.()||{registrationOpen:false},chzzkSummary=chzzkLiveMonitor?.summary?.()||{settings:{enabled:false},state:{lastStatus:'idle'},connector:{configured:false}};
    const connectorVerification=buildConnectorVerification({config,discordStatus:statusCache,naverStatus,chzzkStatus:chzzkSummary.connector});const result=buildGoLiveReadiness({config,deployment,naver:naverStatus,naverParticipation:naverSummary,chzzkLive:chzzkSummary,emergency:emergencyState(),incidents:incidentSummary,hostBootstrap:deployment.hostBootstrap,environmentValidation:deployment.environmentValidation,connectorVerification,now:Date.now()});
    if(String(_req.query?.download||'')==='1')res.attachment(`daengdaeng-go-live-readiness-${APP_VERSION}.json`);
    res.json({...result,version:APP_VERSION,dataSchemaVersion:DATA_SCHEMA_VERSION});
  }catch(error){next(error)}});
  app.post('/api/deployment/backup',async(_req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.'});try{const created=await backups.create({guildId:config.guildId,records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read(),type:'manual'});await safeAudit({category:'system',action:'deployment_backup',summary:`수동 배포 백업 생성 · ${created.file}`,details:{bytes:created.bytes}});res.json({created,backup:await backups.summary()});}catch(error){next(error)}});
  app.post('/api/deployment/soak/start',async(req,res,next)=>{try{const minutes=Number(req.body.minutes||10);if(!Number.isInteger(minutes)||minutes<1||minutes>60)throw Error('Soak Test 시간은 1~60분입니다.');const state=soak.start(minutes);await safeAudit({category:'system',action:'soak_start',summary:`Soak Test 시작 · ${minutes}분`});res.json(state);}catch(error){next(error)}});
  app.post('/api/deployment/soak/stop',async(_req,res,next)=>{try{const state=soak.stop();await safeAudit({category:'system',action:'soak_stop',summary:`Soak Test 종료 · ${state.result?.status||state.status}`,details:{samples:state.samples}});res.json(state);}catch(error){next(error)}});

  app.get('/api/supply-chain',async(_req,res,next)=>{try{const root=releaseCenter?.projectRoot||process.cwd(),snapshot=await inspectProjectSupplyChain(root,{expectedVersion:APP_VERSION});res.json({status:snapshot.status,checks:snapshot.checks,package:snapshot.package,lock:snapshot.lock,stats:snapshot.stats,installScripts:snapshot.installScripts,unsafeResolved:snapshot.unsafeResolved,missingIntegrity:snapshot.missingIntegrity,licenses:snapshot.licenses,lockDigest:snapshot.lockDigest,packageDigest:snapshot.packageDigest});}catch(error){next(error)}});
  app.get('/api/supply-chain/sbom',async(_req,res,next)=>{try{const root=releaseCenter?.projectRoot||process.cwd(),snapshot=await inspectProjectSupplyChain(root,{expectedVersion:APP_VERSION}),sbom=buildSupplyChainSbom(snapshot);res.attachment(`daengdaeng-sbom-${APP_VERSION}.json`);res.json(sbom);}catch(error){next(error)}});

  app.get('/api/release',async(_req,res,next)=>{try{if(!releaseCenter)return res.status(503).json({error:'Release Center가 초기화되지 않았습니다.'});const state=releaseCenter.snapshot(),manifest=await buildCurrentManifest(releaseCenter.projectRoot,APP_VERSION,DATA_SCHEMA_VERSION);res.json({state,current:{version:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION,digest:manifest.digest,files:manifest.files.length},trust:releaseCenter.trustSnapshot(),localOnly:true});}catch(error){next(error)}});
  app.get('/api/release/manifest',async(_req,res,next)=>{try{if(!releaseCenter)throw Error('Release Center가 초기화되지 않았습니다.');const manifest=await buildCurrentManifest(releaseCenter.projectRoot,APP_VERSION,DATA_SCHEMA_VERSION);res.attachment(`daengdaeng-manifest-${APP_VERSION}.json`);res.json(manifest);}catch(error){next(error)}});
  app.post('/api/release/verify',async(req,res,next)=>{try{if(!releaseCenter)throw Error('Release Center가 초기화되지 않았습니다.');const result=await releaseCenter.stage(req.body.bundle||req.body);await safeAudit({category:'system',action:'release_verify',summary:result.ok?`업데이트 패키지 검증 성공 · ${result.targetVersion||''}`:'업데이트 패키지 검증 실패',details:{files:result.stats?.files||0,deletes:result.stats?.deletes||0}});res.status(result.ok?200:400).json(result);}catch(error){next(error)}});
  app.post('/api/release/apply',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{requireLocalRelease(req);const release=releaseCenter.snapshot(),targetKey=`release:${release.manifestDigest}`;approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'apply-release',targetKey);const readiness=await deploymentSnapshot();if(readiness.status==='fail')throw Error('배포 준비 상태가 FAIL입니다. 배포 준비 센터의 오류를 먼저 해결해 주세요.');const backup=await backups.create({guildId:config.guildId,records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read(),type:'manual'});await checkpoint(`코드 업데이트 전 자동 보호 · ${APP_VERSION} → ${release.targetVersion}`,'auto-before-release');const result=await releaseCenter.apply({expectedDigest:release.manifestDigest});await safeAudit({category:'system',action:'release_apply',summary:`코드 업데이트 파일 적용 · ${APP_VERSION} → ${release.targetVersion}`,details:{backup:backup.file,releaseId:result.state.releaseId}});res.json({...result,backup,message:'업데이트 파일 적용이 완료되었습니다. 서버를 재시작하면 새 버전이 활성화되고 자동 Smoke Test가 실행됩니다.'});}catch(error){next(error)}finally{busy=false}});
  app.post('/api/release/smoke',async(_req,res,next)=>{try{if(!releaseCenter)throw Error('Release Center가 초기화되지 않았습니다.');const result=await releaseCenter.smoke({operationsReadable:Boolean(operations.read()),dataReadable:Array.isArray(store.read())});await safeAudit({category:'system',action:'release_smoke',summary:`배포 후 Smoke Test · ${result.status.toUpperCase()}`,details:{version:APP_VERSION}});res.json(result);}catch(error){next(error)}});
  app.post('/api/release/rollback',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{requireLocalRelease(req);const release=releaseCenter.snapshot(),targetKey=`release-rollback:${release.releaseId}`;approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'rollback-release',targetKey);const backup=await backups.create({guildId:config.guildId,records:store.read().filter(r=>r.guildId===config.guildId),operations:operations.read(),type:'manual'});const result=await releaseCenter.rollback();await safeAudit({category:'system',action:'release_rollback',summary:`코드 업데이트 롤백 파일 복원 · ${release.releaseId}`,details:{backup:backup.file}});res.json({...result,backup,message:'이전 코드 파일을 복원했습니다. 서버를 재시작해 롤백을 완료하세요.'});}catch(error){next(error)}finally{busy=false}});
  app.post('/api/release/trust/key',async(req,res,next)=>{try{requireLocalRelease(req);const key=releaseCenter.previewTrustedKey(req.body.publicKeyPem,req.body.name||'사용자 릴리스 키'),targetKey=`release-trust-key:${key.keyId}`;approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'trust-release-key',targetKey);const added=await releaseCenter.importTrustedKey({publicKeyPem:req.body.publicKeyPem,name:req.body.name});await safeAudit({category:'system',action:'release_trust_key_add',summary:`릴리스 공개키 신뢰 · ${added.name}`,details:{keyId:added.keyId,fingerprint:added.fingerprint}});res.json({trust:releaseCenter.trustSnapshot(),added});}catch(error){next(error)}});
  app.post('/api/release/trust/remove',async(req,res,next)=>{try{requireLocalRelease(req);const key=releaseCenter.getTrustedKey(req.body.keyId);if(!key)throw Error('삭제할 릴리스 신뢰 키를 찾지 못했습니다.');const targetKey=`release-trust-remove:${key.keyId}`;approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'remove-release-key',targetKey);const trust=await releaseCenter.removeTrustedKey(key.keyId);await safeAudit({category:'system',action:'release_trust_key_remove',summary:`릴리스 신뢰 키 삭제 · ${key.name}`,details:{keyId:key.keyId}});res.json({trust});}catch(error){next(error)}});
  app.post('/api/release/trust/policy',async(req,res,next)=>{try{requireLocalRelease(req);const policy=String(req.body.policy||''),targetKey=`release-trust-policy:${policy}`;approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'set-release-policy',targetKey);const trust=await releaseCenter.setTrustPolicy(policy);await safeAudit({category:'system',action:'release_trust_policy',summary:`릴리스 Trust Policy · ${policy.toUpperCase()}`});res.json({trust});}catch(error){next(error)}});
  app.post('/api/runtime/client-metric',(req,res,next)=>{try{const type=req.body.type;if(!['sse-reconnect','sse-error','sse-stale','sse-delay'].includes(type))throw Error('지원하지 않는 런타임 지표입니다.');const delayMs=Math.max(0,Math.min(300000,Number(req.body.delayMs)||0));runtime.recordSse(type==='sse-reconnect'?'client-reconnect':type==='sse-error'?'client-error':type==='sse-stale'?'stale':'delay',{delayMs});res.json({ok:true});}catch(error){next(error)}});
  app.get('/api/runtime/diagnostics',async(_req,res,next)=>{try{const current=operations.read(),selfCheck=await selfCheckSnapshot(),safeDeploy=safeDeploySnapshot(),performanceState=await performanceSnapshot(),deployment=await deploymentSnapshot(),bundle=runtime.diagnosticBundle({config,liveClients:streams.size,version:APP_VERSION,revision:Number(current.revision)||0,recovered:store.recovered||operations.recovered||recoveryStore.recovered,selfCheck,safeDeploy,performance:performanceState});bundle.deployment={status:deployment.status,profile:deployment.profile,counts:deployment.counts,backup:{count:deployment.backup.count,latestAgeMs:deployment.backup.latestAgeMs},soak:deployment.soak,gracefulShutdown:deployment.gracefulShutdown};const incidentSummary=incidentStore.summary();bundle.incidentWorkflow={status:incidentSummary.status,counts:incidentSummary.counts,active:incidentSummary.incidents.filter(i=>i.status!=='resolved').slice(0,50).map(i=>({id:i.id,source:i.source,code:i.code,severity:i.severity,status:i.status,occurrences:i.occurrences,owner:i.owner||'',openedAt:i.openedAt,lastSeenAt:i.lastSeenAt,suppressed:Boolean(i.suppressed)}))};res.attachment(`daengdaeng-diagnostics-${new Date().toISOString().slice(0,10)}.json`);res.json(bundle);}catch(error){next(error)}});
  app.post('/api/backup/verify',async(req,res,next)=>{try{const result=inspectBackup(req.body,config.guildId);await safeAudit({category:'recovery',action:'backup_verify',summary:result.ok?'백업 파일 검증 성공':'백업 파일 검증 실패',details:{records:result.stats.records,archives:result.stats.archives}});res.json(result);}catch(error){next(error)}});
  app.post('/api/recovery/checkpoint',async(req,res,next)=>{try{const point=await checkpoint(req.body.label||'수동 복원 지점','manual');await safeAudit({category:'recovery',action:'checkpoint_create',summary:`복원 지점 생성 · ${point.label}`,details:{recordCount:point.recordCount,revision:point.revision}});res.json({...recoveryStore.summary(config.guildId),created:point.id});}catch(error){next(error)}});
  app.post('/api/recovery/delete',async(req,res,next)=>{try{if(typeof req.body.id!=='string')throw Error('삭제할 복원 지점을 선택해 주세요.');const point=recoveryStore.getPoint(req.body.id),verified=verifyRestorePoint(point,config.guildId);if(!verified.ok)throw Error(verified.reason);const valid=(recoveryStore.read().restorePoints||[]).filter(p=>verifyRestorePoint(p,config.guildId).ok);if(valid.length<=1)throw Error('마지막 정상 복원 지점은 삭제할 수 없습니다. 새 복원 지점을 먼저 만들어 주세요.');approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'delete-restore-point',`point:${point.id}:${point.digest}`);if(!(await recoveryStore.removePoint(req.body.id)))throw Error('복원 지점을 삭제하지 못했습니다.');await safeAudit({category:'recovery',action:'checkpoint_delete',summary:`복원 지점 삭제 · ${point.label}`});res.json(recoveryStore.summary(config.guildId));}catch(error){next(error)}});
  app.post('/api/recovery/restore',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{const point=recoveryStore.getPoint(req.body.id),verified=verifyRestorePoint(point,config.guildId);if(!verified.ok)throw Error(verified.reason);approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'restore-point',`point:${point.id}:${point.digest}`);await replaceAll(point.records,point.operations,{label:'복원 지점 적용 전 자동 보호',reason:'auto-before-checkpoint-restore'});await safeAudit({category:'recovery',action:'checkpoint_restore',summary:`복원 지점 적용 · ${point.label}`,details:{recordCount:point.recordCount,revision:point.revision}});res.json({...await snapshot(),recovery:recoveryStore.summary(config.guildId),message:'복원 지점을 적용했습니다. Discord 안내는 상태를 확인한 뒤 다시 동기화해 주세요.'});}catch(error){next(error)}finally{busy=false}});
  app.post('/api/backup/restore',async(req,res,next)=>{if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;try{if(!req.body.bundle)throw Error('검증한 백업이 필요합니다.');const result=inspectBackup(req.body.bundle,config.guildId);if(!result.ok)throw Error('백업 검증에 실패했습니다. 오류 항목을 먼저 해결해 주세요.');approvalGuard.consume(req.body.approvalId,req.body.approvalPhrase,'restore-backup',`backup:${result.digest}`);await replaceAll(req.body.bundle.records,req.body.bundle.operations,{label:'백업 파일 복원 전 자동 보호',reason:'auto-before-backup-restore'});await safeAudit({category:'recovery',action:'backup_restore',summary:'검증된 전체 백업 복원',details:{records:result.stats.records,archives:result.stats.archives}});res.json({...await snapshot(),recovery:recoveryStore.summary(config.guildId),message:'백업을 복원했습니다. Discord 안내는 상태를 확인한 뒤 다시 동기화해 주세요.'});}catch(error){next(error)}finally{busy=false}});
  // Admin-only APIs; retain the same authentication and CSRF middleware.
  app.get('/api/guide',(_req,res)=>res.json(guideState(operations.read())));
  app.get('/api/guide/search',(req,res)=>res.json({results:searchGuide(operations.read(),req.query.q||'')}));
  app.get('/api/guide/progress',async(_req,res)=>{const state=operations.read();res.json({members:(await records()).map(profile=>({discordId:profile.discordId,...guideProgress(state,profile,profile.discordId)}))});});
  app.post('/api/guide/:action',async(req,res,next)=>{
    try{await operations.update(state=>{editGuide(state,req.params.action,req.body);state.revision=(state.revision||0)+1;});await safeAudit({category:'guide',action:req.params.action,summary:`안내문 ${req.params.action} · ${req.body.key||''}`});res.json(guideState(operations.read()));}catch(error){next(error)}
  });
  app.get('/api/broadcast-settings',(_req,res)=>res.json({settings:normalizeBroadcastSettings(operations.read().broadcastSettings)}));
  app.post('/api/broadcast-settings',async(req,res,next)=>{try{const settings=validateBroadcastSettings(req.body);await operations.update(state=>{state.broadcastSettings=settings;state.revision=(state.revision||0)+1;});await safeAudit({category:'broadcast',action:'settings_save',summary:'방송 장면 설정 저장'});res.json({settings,revision:Number(operations.read().revision)||0});}catch(error){next(error)}});
  app.get('/api/broadcast-control',(_req,res)=>{const current=operations.read(),presets=normalizeBroadcastPresets(current.broadcastPresets),automation=normalizeBroadcastAutomation(current.broadcastAutomation,presets);res.json({presets,automation});});
  app.post('/api/broadcast-preset',async(req,res,next)=>{try{const action=req.body.action;if(!['save','apply','delete'].includes(action))throw Error('방송 프리셋 작업을 확인해 주세요.');let result;await operations.update(state=>{const presets=normalizeBroadcastPresets(state.broadcastPresets),automation=normalizeBroadcastAutomation(state.broadcastAutomation,presets);if(action==='save'){const saved=saveBroadcastPreset(presets,{id:req.body.id,name:req.body.name,settings:req.body.settings});state.broadcastPresets=saved.presets;result={preset:saved.preset};}else if(action==='apply'){const preset=presets.find(p=>p.id===req.body.id);if(!preset)throw Error('적용할 프리셋을 찾을 수 없습니다.');state.broadcastSettings=preset.settings;result={preset};}else{const deleted=deleteBroadcastPreset(presets,automation,req.body.id);state.broadcastPresets=deleted.presets;state.broadcastAutomation=deleted.automation;result={deleted:req.body.id};}state.revision=(state.revision||0)+1;});const current=operations.read(),presets=normalizeBroadcastPresets(current.broadcastPresets),automation=normalizeBroadcastAutomation(current.broadcastAutomation,presets);await safeAudit({category:'broadcast',action:`preset_${action}`,summary:`방송 프리셋 ${action}`,details:{presetId:result?.preset?.id||result?.deleted||req.body.id||null}});res.json({...result,settings:normalizeBroadcastSettings(current.broadcastSettings),presets,automation,revision:Number(current.revision)||0});}catch(error){next(error)}});
  app.post('/api/broadcast-automation',async(req,res,next)=>{try{let automation;await operations.update(state=>{const presets=normalizeBroadcastPresets(state.broadcastPresets),current=normalizeBroadcastAutomation(state.broadcastAutomation,presets),next=validateBroadcastAutomation(req.body,presets);automation={...next,forcedScene:current.forcedScene,forcedSceneUntil:current.forcedSceneUntil};state.broadcastAutomation=automation;state.revision=(state.revision||0)+1;});await safeAudit({category:'broadcast',action:'automation_save',summary:'게임별 방송 자동화 저장'});res.json({automation,revision:Number(operations.read().revision)||0});}catch(error){next(error)}});
  app.post('/api/broadcast-scene',async(req,res,next)=>{try{let automation;await operations.update(state=>{const presets=normalizeBroadcastPresets(state.broadcastPresets);automation=setForcedBroadcastScene(normalizeBroadcastAutomation(state.broadcastAutomation,presets),req.body,Date.now(),presets);state.broadcastAutomation=automation;state.revision=(state.revision||0)+1;});await delegatedAudit(req,{category:'broadcast',action:'scene_override',summary:`방송 장면 제어 · ${automation.forcedScene}`});res.json({automation,revision:Number(operations.read().revision)||0});}catch(error){next(error)}});
  app.get('/api/broadcast-export',(_req,res)=>{res.attachment(`daengdaeng-broadcast-${new Date().toISOString().slice(0,10)}.json`);res.json(exportBroadcastBundle(operations.read()));});
  app.post('/api/broadcast-import',async(req,res,next)=>{try{const bundle=importBroadcastBundle(req.body);await checkpoint('방송 설정 가져오기 전 자동 보호','auto-before-broadcast-import');await operations.update(state=>{state.broadcastSettings=bundle.settings;state.broadcastPresets=bundle.presets;state.broadcastAutomation=bundle.automation;state.revision=(state.revision||0)+1;});await safeAudit({category:'broadcast',action:'import',summary:'방송 설정·프리셋 가져오기'});res.json({...bundle,revision:Number(operations.read().revision)||0});}catch(error){next(error)}});
  app.get('/api/avatars',async(_req,res)=>{const state=operations.read();res.json({members:(await records()).map(r=>({userId:r.discordId,name:r.chzzkName,avatar:(state.avatars||[]).find(a=>a.userId===r.discordId)?.avatar||DEFAULT_AVATAR}))})});
  app.post('/api/operations/:action',async(req,res,next)=>{
    if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다. 완료 후 다시 실행해 주세요.'});
    busy=true;
    try{
      const {action}=req.params,body=req.body;
      const allowed=['setup','open','close','reopen','resize','edit_post','draw','attendance','replace','teams','reshuffle','swap','voice','end','publish','cancel_reservation'];
      if(!allowed.includes(action))throw Error('지원하지 않는 작업입니다.');
      if(typeof body.requestId!=='string'||!/^[-\w]{8,80}$/.test(body.requestId))throw Error('요청 번호가 없습니다. 새로고침해 주세요.');
      const previous=operations.read().requests?.find(r=>r.id===body.requestId);
      if(previous){if(previous.action!==action)throw Error('요청 번호가 다른 작업에 사용됐습니다.');const data=await snapshot(true,req.dashboardIdentity);return res.json({...data,message:'이미 처리된 요청입니다. 저장된 결과를 표시합니다.',draw:req.dashboardIdentity?.role==='operator'?null:(operations.read().draws||[]).find(d=>d.id===previous.drawId)||null});}
      const current=operations.read().session;
      if(action!=='setup'&&action!=='cancel_reservation'&&(current?.id||null)!==(body.sessionId||null))return res.status(409).json({error:'모집이 변경됐습니다. 새로고침해 주세요.'});
      if(action==='setup')await discord.setup();
      else if(action==='voice')await discord.voice();
      else if(action!=='publish') {
        if(action==='open')await discord.requireChannels(true);
        const all=await records();
        await operations.update(state=>{
          if(action!=='cancel_reservation'&&(state.session?.id||null)!==(body.sessionId||null))throw Error('모집이 변경됐습니다. 새로고침해 주세요.');
          let draw=null;
          if(action==='draw'){
            if(req.dashboardIdentity?.role==='operator'&&body.scope==='all')throw Object.assign(Error('운영자 계정은 현재 시참 회차 추첨만 실행할 수 있습니다.'),{status:403});
            if(body.ids!==undefined)throw Error('당첨자를 직접 지정할 수 없습니다.');
            if(body.scope && !['session','all'].includes(body.scope))throw Error('추첨 대상을 확인해 주세요.');
            const separate=body.scope==='all';
            if(!separate&&state.session?.phase!=='closed')throw Error('모집 마감 후 추첨해 주세요.');
            const s=state.session,ids=separate?all.map(r=>r.discordId):s.applicants.filter(id=>!s.postponed?.includes(id)&&all.some(r=>r.discordId===id&&hasGame(r,s.game)));
            if(!separate&&ids.length<s.count)throw Error('해당 게임 정보가 등록된 신청자가 부족합니다. 모집을 다시 열거나 인원을 줄여 주세요.');
            const fair=separate?null:fairSelect(state,ids,s.count);
            const trace=fair?{version:1,mode:'instant',players:ids,count:s.count,events:[],winners:fair,communityFairness:true}:simulateDraw(ids,separate?body.count:s.count,body.drawMode||'instant',randomInt,{trackId:body.trackId,laps:body.laps});
            draw={id:randomUUID(),at:Date.now(),sessionId:separate?null:s.id,...trace,avatars:Object.fromEntries(ids.map(id=>[id,structuredClone((state.avatars||[]).find(a=>a.userId===id)?.avatar||DEFAULT_AVATAR)])),names:Object.fromEntries(all.filter(r=>ids.includes(r.discordId)).map(r=>[r.discordId,r.chzzkName||r.discordUsername]))};
            if(separate){state.revision=(state.revision||0)+1;state.history.unshift({action:'standalone_draw',at:Date.now(),winners:draw.winners,applicants:ids,confirmed:[]});state.history=state.history.slice(0,200);}
            else applyAction(state,'draw',{ids:draw.winners});
            state.lastDraw=draw;state.draws=[draw,...(state.draws||[])].slice(0,5);
          }else {
            const selected=all.filter(r=>state.session?.winners.includes(r.discordId));
            applyAction(state,action,{...body,records:selected,eligibleIds:all.filter(r=>hasGame(r,state.session?.game)).map(r=>r.discordId)});
            if(action==='open')state.template={game:state.session.game,mode:state.session.mode,count:state.session.count,title:state.session.title,description:state.session.description,closeMinutes:body.closeMinutes||0,minutes:body.minutes||3};
          }
          state.requests=[{id:body.requestId,action,drawId:draw?.id},...(state.requests||[])].slice(0,100);
        });
      }
      if(participationQueue&&!['setup','voice','publish'].includes(action))await participationQueue.syncOperations({operationsState:operations.read(),records:await records()});
      let message='처리 완료';
      if(!['setup','voice'].includes(action)&&!(action==='draw'&&body.scope==='all')){
        try{await discord.sync(action==='publish'?'sync':action)}catch{message='상태는 저장됐지만 Discord 안내 동기화에 실패했습니다. 권한 점검 후 안내 동기화를 눌러 주세요.';}
      }
      if(['setup','voice','publish'].includes(action))await operations.update(state=>{state.requests=[{id:body.requestId,action},...(state.requests||[])].slice(0,100);state.revision=(state.revision||0)+1;});
      await delegatedAudit(req,{category:'operation',action,summary:`운영 작업 실행 · ${action}`,details:{sessionId:body.sessionId||null,scope:body.scope||null}});
      const data=await snapshot(true,req.dashboardIdentity);res.json({...data,message,draw:action==='draw'&&req.dashboardIdentity?.role!=='operator'?data.state.lastDraw:null});
    }catch(error){next(error)}finally{busy=false}
  });
  app.post('/api/nicknames',async(req,res,next)=>{
    if(busy)return res.status(409).json({error:'다른 작업이 진행 중입니다.'});busy=true;
    try{const ids=req.body.discordIds;if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('닉네임 적용 대상은 1~50명입니다.');
      const all=await records(),selected=all.filter(r=>ids.includes(r.discordId));if(selected.length!==ids.length)throw Error('등록 정보가 없는 멤버가 있습니다. 새로고침해 주세요.');
      const results=await discord.rename(selected);await safeAudit({category:'members',action:'nickname_apply',summary:`Discord 닉네임 적용 · ${results.filter(r=>r.ok).length}/${results.length}명`,details:{requested:ids.length,success:results.filter(r=>r.ok).length}});res.json({results});
    }catch(error){next(error)}finally{busy=false}
  });
  if(config.demo)app.post('/api/demo/:action',async(req,res,next)=>{
    try{await operations.update(state=>{
      const s=state.session;if(!s)throw Error('모집을 먼저 시작해 주세요.');
      if(req.params.action==='join_all'){for(const r of store.read())applyAction(state,'join',{sessionId:s.id,userId:r.discordId});}
      else if(req.params.action==='confirm_all'){for(const id of s.winners)applyAction(state,'confirm',{sessionId:s.id,userId:id});}
      else if(['join','leave','postpone_next','postpone_later','confirm'].includes(req.params.action))applyAction(state,req.params.action,{sessionId:s.id,userId:req.body.userId});
      else throw Error('지원하지 않는 연습 작업입니다.');
    });if(participationQueue)await participationQueue.syncOperations({operationsState:operations.read(),records:store.read().filter(r=>r.guildId===config.guildId)});res.json(await snapshot());}catch(error){next(error)}
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'지원하지 않는 API입니다.'}));
  app.use((error,req,res,_next)=>{const classified=classifyRuntimeError(error);if(error?.source==='naver')runtime.recordIncident({severity:classified.status>=500?'warn':'info',source:'naver',code:`naver_${Number(error?.upstreamStatus)||classified.status}`,summary:'NAVER API 요청 처리 실패',detail:error?.message,persist:false});else if(classified.kind==='storage')runtime.recordIncident({severity:'error',source:'storage',code:String(error?.code||'storage_error'),summary:'API 처리 중 저장소 오류',detail:error?.message});else if(classified.kind==='discord')runtime.recordIncident({severity:'warn',source:'discord',code:String(error?.code||'discord_error'),summary:'API 처리 중 Discord 오류',detail:error?.message});else if(classified.kind==='internal')runtime.recordIncident({severity:'error',source:'api',code:error?.name||'internal_error',summary:'API 내부 처리 오류',detail:error?.message});const payload={error:classified.message};if(error?.code==='STALE_LIVE_STATE'){payload.code=error.code;payload.actual=error.actual;payload.expected=error.expected;payload.stale=error.stale;}res.status(classified.status).json(payload);});
  let timerBusy=false;
  async function tick(now=Date.now()){
    if(timerBusy||busy)return;timerBusy=true;const started=Date.now();
    try{
      await syncRunbookAutomation(now).catch(error=>runtime.recordIncident({severity:'warn',source:'system',code:'runbook_phase_sync_failure',summary:'Runbook 자동 단계 감지 실패',detail:error?.message,persist:false}));
      if(emergencyState().locked){runtime.recordTick({ok:true,durationMs:Date.now()-started});return;}
      const current=operations.read(),s=current.session,automation=normalizeBroadcastAutomation(current.broadcastAutomation,normalizeBroadcastPresets(current.broadcastPresets));
      if(automation.forcedScene!=='auto'&&automation.forcedSceneUntil&&now>=automation.forcedSceneUntil){await operations.update(state=>{const presets=normalizeBroadcastPresets(state.broadcastPresets),next=normalizeBroadcastAutomation(state.broadcastAutomation,presets);if(next.forcedScene!=='auto'&&next.forcedSceneUntil&&now>=next.forcedSceneUntil){state.broadcastAutomation={...next,forcedScene:'auto',forcedSceneUntil:null};state.revision=(state.revision||0)+1;}});}
      if(s?.phase==='open'&&s.closeAt&&now>=s.closeAt){await operations.update(state=>{if(state.session?.id===s.id&&state.session.phase==='open')applyAction(state,'close',{reason:'모집 시간 자동 마감'},now);});try{await discord.sync('close')}catch{}}
      else if(s?.phase==='checking'&&now>=s.deadline&&!s.deadlineSynced){try{await discord.sync('sync');await operations.update(state=>{if(state.session?.id===s.id&&state.session.attendanceVersion===s.attendanceVersion)state.session.deadlineSynced=true;});}catch{}}
      if(broadcastOps){
        const due=await broadcastOps.markDueSchedules(now);if(due.length&&broadcastOpsSummary().notifications.schedule!==false){for(const item of due){try{await discord.broadcastOpsNotice?.({title:'방송 일정 시작 시간',message:`${item.title}${item.note?`\n${item.note}`:''}`,kind:'schedule'});}catch(error){runtime.recordIncident({severity:'warn',source:'discord',code:'broadcast_schedule_alert_failure',summary:'방송 일정 Discord 알림 실패',detail:error?.message,persist:false});}}}
      }
      runtime.recordTick({ok:true,durationMs:Date.now()-started});
    }catch(error){runtime.recordTick({ok:false,durationMs:Date.now()-started,error});throw error;}finally{timerBusy=false}
  }
  const monitorInterval=Number(config.productionMonitorIntervalSeconds)||0;
  const productionMonitorTimer=monitorInterval>=60&&!config.demo?setInterval(()=>{
    if(draining||Date.now()<productionMonitor.nextProbeAt)return;
    productionMonitor.run().catch(()=>{});
  },Math.min(3600,monitorInterval)*1000):null;
  productionMonitorTimer?.unref?.();
  let backgroundStopped=false;
  const stopBackground=()=>{if(backgroundStopped)return;backgroundStopped=true;clearInterval(productionMonitorTimer);clearInterval(capacityTimer);clearInterval(backupTimer);clearInterval(policyMonitorTimer);clearInterval(naverMonitorTimer);clearInterval(chzzkLiveTimer);clearInterval(incidentTimer);soak.close();broadcast.close();for(const res of [...streams]){try{streamClosers.get(res)?.();res.end()}catch{}}streams.clear();streamClosers.clear();streamIdentities.clear();};
  const beginShutdown=(reason='shutdown')=>{if(draining)return;draining=true;runtime.recordIncident({severity:'info',source:'system',code:'graceful_shutdown',summary:'안전 종료 시작',detail:String(reason),persist:false});stopBackground();};
  const close=()=>{draining=true;stopBackground();apiIdempotency.clear();unsubscribeOperations();unsubscribeStore();unsubscribeRecovery();unsubscribeBroadcastOps();unsubscribePolicy();unsubscribeIncident();unsubscribeNaverParticipation();unsubscribeChzzkLive();unsubscribeParticipationQueue();};
  return {app,tick,close,beginShutdown};
}
