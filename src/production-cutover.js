const rank={pass:0,warn:1,fail:2};
const clean=(value,max=240)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const validStatus=value=>['pass','warn','fail'].includes(value)?value:'warn';
const worst=checks=>checks.reduce((state,check)=>rank[check.status]>rank[state]?check.status:state,'pass');

function add(checks,{id,label,status='warn',detail='',required=true,group='cutover'}){
  checks.push({id,label,status:validStatus(status),detail:clean(detail),required:Boolean(required),group});
}

function releaseCutoverCheck(state){
  if(!state||typeof state!=='object')return {status:'fail',detail:'Release Center 상태를 확인할 수 없습니다.'};
  const status=String(state.status||'unknown');
  if(status==='smoke-passed')return {status:'pass',detail:'배포 후 Release Smoke Test가 통과한 상태입니다.'};
  if(status==='idle')return {status:'warn',detail:'Release Center에 현재 앱 내부 배포 이력이 없습니다. 외부 배포를 사용했다면 현재 코드/런타임 검증 결과를 함께 확인하세요.'};
  if(status==='staged')return {status:'warn',detail:'업데이트 패키지가 스테이징되어 있지만 현재 실행 버전에는 아직 적용되지 않았습니다.'};
  if(status==='verify-failed')return {status:'warn',detail:'최근 업데이트 패키지 검증 실패 기록이 있습니다. 현재 실행 버전은 유지됩니다.'};
  if(status==='crash-recovered')return {status:'warn',detail:'중단된 코드 전환을 자동 복구했습니다. 현재 런타임 상태를 다시 확인하세요.'};
  if(['restart-required','rollback-restart-required','crash-recovered-restart-required','transaction-recovery-incomplete'].includes(status))return {status:'fail',detail:'코드 전환/롤백/복구가 아직 재시작 또는 후속 확인을 기다리고 있습니다.'};
  if(['smoke-failed','apply-failed','apply-failed-rolled-back','apply-failed-rollback-incomplete'].includes(status))return {status:'fail',detail:'최근 릴리스 적용 또는 Smoke Test 실패를 해결해야 합니다.'};
  return {status:'fail',detail:'Release Center 상태를 확인할 수 없습니다.'};
}

function runtimeCheck(runtime){
  if(!runtime||typeof runtime!=='object')return {status:'fail',detail:'Runtime Health 상태를 확인할 수 없습니다.'};
  const status=['pass','warn','fail'].includes(runtime.status)?runtime.status:'fail';
  if(status==='pass')return {status:'pass',detail:`Runtime Health 정상 · uptime ${Math.max(0,Number(runtime.uptimeMs)||0)}ms`};
  if(status==='warn')return {status:'warn',detail:'Runtime Health에 경고가 있습니다. 트래픽 전환 후 상태를 계속 관측하세요.'};
  return {status:'fail',detail:'Runtime Health가 FAIL입니다. 실서비스 안정화 전에 원인을 해결하세요.'};
}

function incidentCheck(incidents){
  if(!incidents||typeof incidents!=='object')return {status:'fail',detail:'Runtime Incident 상태를 확인할 수 없습니다.'};
  const counts=incidents.counts;
  if(!counts||!['critical','warning','totalActive'].every(key=>Number.isInteger(counts[key])&&counts[key]>=0))return {status:'fail',detail:'Runtime Incident 집계가 불완전합니다.'};
  const critical=Math.max(0,Number(counts.critical)||0),active=Math.max(0,Number(counts.totalActive)||0),warning=Math.max(0,Number(counts.warning)||0);
  if(critical>0)return {status:'fail',detail:`활성 CRITICAL 장애 ${critical}건이 있습니다.`};
  if(active>0||warning>0)return {status:'warn',detail:`활성 장애 ${active}건 · 경고 ${warning}건을 확인하세요.`};
  return {status:'pass',detail:'활성 Runtime Incident가 없습니다.'};
}

function manifestCheck(manifest){
  if(!manifest||manifest.status==='fail')return {status:'fail',detail:clean(manifest?.detail||'현재 코드 Manifest를 계산하지 못했습니다.')};
  const files=Math.max(0,Number(manifest.files)||0),digest=String(manifest.digest||'');
  if(!files||!/^[a-f0-9]{64}$/i.test(digest))return {status:'fail',detail:'현재 코드 Manifest 결과가 불완전합니다.'};
  return {status:'pass',detail:`현재 코드 ${files}개 파일 Manifest 계산 완료 · ${digest.slice(0,12)}…`};
}

export function buildProductionCutoverVerification({acceptance=null,runtime=null,incidents=null,releaseState=null,manifest=null,draining=false,trafficOpened=false,verified=false,now=Date.now()}={}){
  const checks=[];
  const accepted=Boolean(acceptance?.verified)&&acceptance?.launchable===true;
  add(checks,{id:'production-acceptance',label:'Production Acceptance',status:accepted?validStatus(acceptance.status):'fail',detail:accepted?(acceptance.summary||'Production acceptance 통과'):'현재 요청에서 실제 Production Acceptance를 통과해야 합니다.'});

  add(checks,{id:'traffic-cutover',label:'실서비스 트래픽 전환 확인',status:verified&&trafficOpened?'pass':'warn',detail:verified&&trafficOpened?'운영자가 외부 호스트/프록시에서 실서비스 트래픽 전환 완료를 확인했습니다.':'이 검증은 DNS·프록시·호스팅 트래픽을 직접 변경하지 않습니다. 외부 전환 완료 후 명시적으로 확인해야 합니다.'});

  add(checks,{id:'runtime-health',label:'Post-Cutover Runtime Health',...runtimeCheck(runtime)});
  add(checks,{id:'runtime-incidents',label:'Runtime Incident 상태',...incidentCheck(incidents)});
  add(checks,{id:'release-state',label:'Release / Smoke 상태',...releaseCutoverCheck(releaseState)});
  add(checks,{id:'code-manifest',label:'현재 코드 Manifest',...manifestCheck(manifest)});
  add(checks,{id:'service-state',label:'서비스 수신 상태',status:draining?'fail':'pass',detail:draining?'서버가 graceful shutdown/draining 상태입니다.':'서버가 새 요청을 받을 수 있는 상태입니다.'});

  const requiredFailures=checks.filter(check=>check.required&&check.status==='fail');
  const stabilized=Boolean(verified&&trafficOpened&&accepted)&&requiredFailures.length===0;
  const status=requiredFailures.length?'fail':!verified||!trafficOpened?'warn':worst(checks);
  const counts={pass:checks.filter(check=>check.status==='pass').length,warn:checks.filter(check=>check.status==='warn').length,fail:checks.filter(check=>check.status==='fail').length,total:checks.length,blocking:requiredFailures.length};
  const actions=checks.filter(check=>check.status!=='pass').map(check=>({id:check.id,status:check.status,required:check.required,title:check.label,detail:check.detail}));
  const summary=stabilized?(status==='pass'?'Post-Cutover smoke 및 안정화 검증을 통과했습니다.':'핵심 Post-Cutover 안정화 조건은 충족했으며 경고 항목을 계속 관측하세요.'):(requiredFailures.length?'실서비스 안정화 전에 차단 항목을 해결해야 합니다.':'실서비스 트래픽 전환 확인 후 Post-Cutover 검증을 실행하세요.');
  return {
    schema:'daengdaeng-production-cutover-v1',checkedAt:now,verified:Boolean(verified),trafficOpened:Boolean(trafficOpened),status,stabilized,fullyStable:Boolean(stabilized)&&status==='pass',counts,checks,actions,summary,
    validity:verified&&trafficOpened?{validForMs:Math.max(0,Math.min(10*60*1000,(acceptance?.validity?.expiresAt??now+10*60*1000)-now)),expiresAt:Math.max(now,Math.min(now+10*60*1000,acceptance?.validity?.expiresAt??now+10*60*1000))}:{validForMs:0,expiresAt:null}
  };
}
