const rank={pass:0,warn:1,fail:2};
const clean=(value,max=240)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const validStatus=value=>['pass','warn','fail'].includes(value)?value:'warn';
const worst=checks=>checks.reduce((state,check)=>rank[check.status]>rank[state]?check.status:state,'pass');

function add(checks,{id,label,status='warn',detail='',required=true,group='core'}){
  checks.push({id,label,status:validStatus(status),detail:clean(detail),required:Boolean(required),group});
}

function releaseStateCheck(state){
  if(!state||typeof state!=='object')return {status:'fail',detail:'Release Center 상태를 확인할 수 없습니다.'};
  const status=String(state.status||'unknown');
  if(status==='idle')return {status:'pass',detail:'현재 코드 전환 또는 롤백 대기 작업 없음'};
  if(status==='smoke-passed')return {status:'pass',detail:'배포 후 Smoke Test 통과'};
  if(status==='staged')return {status:'warn',detail:'검증된 업데이트가 스테이징되어 있으나 아직 적용되지 않았습니다.'};
  if(status==='verify-failed')return {status:'warn',detail:'최근 업데이트 패키지 검증 실패 기록이 있습니다. 현재 실행 버전은 유지됩니다.'};
  if(status==='crash-recovered')return {status:'warn',detail:'중단된 코드 전환을 자동 복구했습니다. 릴리스 상태를 다시 확인하세요.'};
  if(['restart-required','rollback-restart-required','crash-recovered-restart-required','transaction-recovery-incomplete'].includes(status))return {status:'fail',detail:'코드 전환/복구가 아직 재시작 또는 확인을 기다리고 있습니다.'};
  if(['smoke-failed','apply-failed','apply-failed-rolled-back','apply-failed-rollback-incomplete'].includes(status))return {status:'fail',detail:'최근 릴리스 적용 또는 Smoke Test 실패를 해결해야 합니다.'};
  return {status:'fail',detail:'Release Center 상태를 확인할 수 없습니다.'};
}

export function buildProductionAcceptance({deployment={},goLive={},connectorVerification=null,releaseState=null,draining=false,monitoring=null,verified=false,now=Date.now()}={}){
  const checks=[];
  const deploymentStatus=['pass','warn','fail'].includes(deployment?.status)?deployment.status:'fail';
  add(checks,{id:'deployment-gate',label:'Production Gate',status:deploymentStatus,detail:deployment?.summary||'배포 준비 상태를 확인하세요.'});

  const goLiveLaunchable=goLive?.launchable===true;
  const goLiveStatus=!goLiveLaunchable?'fail':validStatus(goLive?.status);
  add(checks,{id:'go-live',label:'Go-Live Readiness',status:goLiveStatus,detail:goLive?.summary||'Go-Live 준비 상태를 확인하세요.'});

  if(!verified){
    add(checks,{id:'live-verification',label:'Live Production Verification',status:'warn',detail:'실제 Production 검증을 아직 실행하지 않았습니다. 관리자 검증을 실행하세요.'});
  }else{
    add(checks,{id:'live-verification',label:'Live Production Verification',status:'pass',detail:'현재 요청에서 외부 read-only 연결 검증을 실행했습니다.'});
  }

  if(connectorVerification){
    const connectorLaunchable=connectorVerification.launchable===true;
    const raw=validStatus(connectorVerification.status),status=!connectorLaunchable?'fail':raw==='fail'?'warn':raw;
    add(checks,{id:'connectors',label:'Discord · Naver · CHZZK · HTTPS',status,detail:verified?'실제 API/HTTPS 연결 검증 결과를 반영했습니다.':'설정/런타임 기반 상태입니다. 실제 외부 연결 검증이 필요합니다.'});
  }else add(checks,{id:'connectors',label:'Discord · Naver · CHZZK · HTTPS',status:'fail',detail:'Connector 검증 결과를 만들지 못했습니다.'});

  const releaseCheck=releaseStateCheck(releaseState);
  add(checks,{id:'release-state',label:'Release / Rollback 상태',...releaseCheck});
  add(checks,{id:'service-state',label:'서비스 수신 상태',status:draining?'fail':'pass',detail:draining?'서버가 graceful shutdown/draining 상태입니다.':'새 요청을 받을 수 있는 실행 상태입니다.'});

  if(monitoring!==null)add(checks,{id:'operational-monitoring',label:'Production Monitoring Gate',status:(monitoring?.ready===true&&Number.isFinite(monitoring.expiresAt)&&monitoring.expiresAt>now)?'pass':'fail',detail:(monitoring?.ready===true&&Number.isFinite(monitoring.expiresAt)&&monitoring.expiresAt>now)?'최근 연결 및 현재 운영 상태 정상':'실패·미확인·만료·복구 대기 항목을 해결하세요.'});
  const requiredFailures=checks.filter(check=>check.required&&check.status==='fail');
  const launchable=Boolean(verified)&&requiredFailures.length===0;
  const status=requiredFailures.length?'fail':!verified?'warn':worst(checks);
  const counts={pass:checks.filter(check=>check.status==='pass').length,warn:checks.filter(check=>check.status==='warn').length,fail:checks.filter(check=>check.status==='fail').length,total:checks.length,blocking:requiredFailures.length};
  const actions=[];
  for(const check of checks){
    if(check.status==='pass')continue;
    actions.push({id:check.id,status:check.status,required:check.required,title:check.label,detail:check.detail});
  }
  const summary=launchable?(status==='pass'?'Production acceptance 검증을 통과했습니다.':'핵심 Production cutover 조건은 충족했으며 경고 항목을 확인하세요.'):(requiredFailures.length?'Production cutover 전에 차단 항목을 해결해야 합니다.':'실제 Production verification을 실행해야 최종 판정할 수 있습니다.');
  return {
    schema:'daengdaeng-production-acceptance-v1',checkedAt:now,verified:Boolean(verified),status,launchable,fullyAccepted:Boolean(verified)&&status==='pass',counts,checks,actions,summary,
    validity:verified?{validForMs:monitoring?Math.max(0,Math.min(15*60*1000,(monitoring.expiresAt||now)-now)):15*60*1000,expiresAt:monitoring?Math.max(now,Math.min(now+15*60*1000,monitoring.expiresAt||now)):now+15*60*1000}:{validForMs:0,expiresAt:null}
  };
}
