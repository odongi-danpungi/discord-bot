const statusRank={pass:0,warn:1,fail:2};
const maxStatus=(...values)=>values.reduce((worst,value)=>statusRank[value]>statusRank[worst]?value:worst,'pass');
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost','::1']);
const clean=value=>String(value??'').replace(/[\r\n\t]+/g,' ').trim();

function findCheck(checks,id){return (checks||[]).find(item=>item?.id===id)||null;}
function checkStatus(checks,id,fallback='warn'){const item=findCheck(checks,id);return ['pass','warn','fail'].includes(item?.status)?item.status:fallback;}
function add(checks,{id,group,label,status='warn',detail='',target='deployment',action='',required=true}){
  checks.push({id,group,label,status:['pass','warn','fail'].includes(status)?status:'warn',detail:clean(detail).slice(0,240),target,action:clean(action).slice(0,240),required:Boolean(required)});
}

export function buildGoLiveReadiness({config={},deployment={},naver={},naverParticipation={},chzzkLive={},emergency={},incidents={},hostBootstrap=null,environmentValidation=null,connectorVerification=null,now=Date.now()}={}){
  const checks=[];
  const depChecks=deployment?.checks||[];
  const selfChecks=deployment?.selfCheck?.checks||[];
  const deploymentStatus=['pass','warn','fail'].includes(deployment?.status)?deployment.status:'warn';
  add(checks,{id:'deployment-gate',group:'core',label:'Production Gate',status:deploymentStatus,detail:deployment?.summary||'배포 준비 센터 상태를 확인하세요.',action:'배포 준비 센터의 FAIL/WARN 항목을 먼저 확인하세요.'});
  add(checks,{id:'profile',group:'core',label:'Production 프로필',status:config.profile==='production'?'pass':'fail',detail:config.profile==='production'?'production 프로필로 실행 중':`${config.profile||'미설정'} 프로필`,action:'APP_PROFILE=production으로 실행하세요.'});
  const discordStatus=maxStatus(checkStatus(selfChecks,'discord'),checkStatus(selfChecks,'discord-config'));
  add(checks,{id:'discord',group:'core',label:'Discord 연결·최소 권한',status:discordStatus,detail:discordStatus==='pass'?'Discord 연결과 최소 권한 구성이 확인되었습니다.':'Discord 연결 또는 권한 감사를 확인하세요.',target:'discordaudit',action:'Discord 권한 감사에서 연결, Guild Command, 최소 권한을 확인하세요.'});
  add(checks,{id:'backup',group:'core',label:'최근 운영 백업',status:checkStatus(depChecks,'backup'),detail:findCheck(depChecks,'backup')?.detail||'최근 백업 상태를 확인하세요.',action:'배포 준비에서 최신 수동 백업을 1회 생성하세요.'});
  add(checks,{id:'soak',group:'core',label:'Soak Test',status:checkStatus(depChecks,'soak'),detail:findCheck(depChecks,'soak')?.detail||'Soak Test 상태를 확인하세요.',action:'운영 환경에서 Soak Test를 완료하고 오류 증가가 없는지 확인하세요.'});
  const incidentCounts=incidents?.counts||deployment?.incidents?.counts||{};
  add(checks,{id:'incidents',group:'core',label:'미해결 장애',status:Number(incidentCounts.critical)>0?'fail':Number(incidentCounts.open)>0?'warn':'pass',detail:Number(incidentCounts.critical)>0?`CRITICAL ${incidentCounts.critical}건`:Number(incidentCounts.open)>0?`미해결 ${incidentCounts.open}건`:'미해결 긴급 장애 없음',target:'incidents',action:'실서비스 시작 전 열린 장애를 확인하고 필요한 항목을 해결하세요.'});
  add(checks,{id:'emergency',group:'core',label:'Emergency Operation Lock',status:emergency?.locked?'fail':'pass',detail:emergency?.locked?'긴급 운영 잠금이 활성화되어 있습니다.':'긴급 운영 잠금 해제 상태',target:'recovery',action:'실서비스 시작 전 긴급 잠금 원인을 확인한 뒤 안전하게 해제하세요.'});
  if(hostBootstrap)add(checks,{id:'host-bootstrap',group:'core',label:'Production Host Bootstrap',status:hostBootstrap.launchable?(hostBootstrap.status==='pass'?'pass':'warn'):'fail',detail:hostBootstrap.launchable?`호스트 계약 확인 · ${hostBootstrap.platform||'generic'}`:'호스트 배포 필수 항목이 준비되지 않았습니다.',target:'deployment',action:'배포 준비의 Host Bootstrap 카드에서 HTTPS, 바인딩, health check, graceful shutdown, persistent storage를 확인하세요.'});
  if(environmentValidation)add(checks,{id:'environment-validation',group:'core',label:'Secrets & Environment Validation',status:environmentValidation.launchable?(environmentValidation.status==='pass'?'pass':'warn'):'fail',detail:environmentValidation.summary||'환경 변수와 Secret 정책을 확인하세요.',target:'deployment',action:'배포 준비의 Secrets & Environment 카드에서 누락, placeholder, Secret 재사용, OAuth URL 정합성을 확인하세요.'});
  if(connectorVerification)add(checks,{id:'connector-verification',group:'core',label:'Connector & OAuth Verification',status:connectorVerification.launchable?(connectorVerification.status==='fail'?'warn':connectorVerification.status):'fail',detail:connectorVerification.probed?'실제 API/HTTPS 연결 검증 결과':'설정 기반 점검 · 실제 연결 검증 권장',target:'deployment',action:'배포 준비에서 실제 연결 검증을 실행해 Discord, Naver OAuth, CHZZK, Public HTTPS를 확인하세요.',required:false});

  const local=LOCAL_HOSTS.has(String(config.host||''));
  add(checks,{id:'network',group:'access',label:'대시보드 네트워크 노출',status:local?'pass':String(config.broadcastToken||'').length>=24?'warn':'fail',detail:local?`${config.host||'127.0.0.1'} 로컬 바인딩`:'외부 네트워크 바인딩',action:local?'리버스 프록시를 사용할 경우 HTTPS와 접근제어를 유지하세요.':'외부 바인딩은 HTTPS 리버스 프록시와 BROADCAST_TOKEN 보호를 확인하세요.'});
  add(checks,{id:'viewer-url',group:'access',label:'Viewer 공개 URL',status:config.viewerUrl?'pass':'warn',detail:config.viewerUrl?'HTTPS Viewer URL 설정됨':'VIEWER_URL 미설정',action:'외부 시청자 셀프서비스를 사용할 경우 HTTPS VIEWER_URL을 설정하세요.',required:false});
  const operatorReady=Boolean(config.dashboardOperatorUser&&config.dashboardOperatorPassword);
  add(checks,{id:'operator',group:'access',label:'위임 운영자 계정',status:operatorReady?'pass':'warn',detail:operatorReady?`운영자 계정 설정됨 · 권한 ${Array.isArray(config.dashboardOperatorCapabilities)?config.dashboardOperatorCapabilities.join(', '):'기본값'}`:'위임 운영자 계정 미설정',action:'모바일 운영자를 분리하려면 관리자와 다른 운영자 계정을 설정하세요.',required:false});

  const naverConfigured=Boolean(config.naverClientId&&config.naverClientSecret&&config.naverRedirectUri&&config.naverCafeId&&(config.naverMemoMenuId||config.naverMenuId)&&config.naverTokenKey);
  const naverConnected=Boolean(naver?.connected);
  add(checks,{id:'naver',group:'integrations',label:'Naver Cafe 연동',status:naverConfigured&&naverConnected?'pass':'warn',detail:naverConfigured?(naverConnected?'OAuth 연결됨':'설정 완료 · OAuth 연결 필요'):'필수 Naver Cafe 설정 일부 누락',target:'settings',action:naverConfigured?'대시보드에서 Naver OAuth 연결을 완료하세요.':'Naver Client ID/Secret, Redirect URI, Cafe/Menu ID, Token Key를 설정하세요.',required:false});
  const memoReady=Boolean(config.naverCafeId&&(config.naverMemoMenuId||config.naverMenuId));
  add(checks,{id:'naver-memo',group:'integrations',label:'Naver 메모 시참 게시판',status:memoReady?'pass':'warn',detail:memoReady?'Cafe ID와 메모 게시판 Menu ID 설정됨':'메모 게시판 대상 미설정',target:'settings',action:'NAVER_CAFE_ID와 NAVER_MEMO_MENU_ID(또는 NAVER_MENU_ID)를 설정하세요.',required:false});
  const chzzkConfigured=Boolean(config.chzzkClientId&&config.chzzkClientSecret&&config.chzzkChannelId);
  const chzzkConnector=chzzkLive?.connector?.configured??chzzkConfigured;
  const chzzkEnabled=Boolean(config.chzzkMonitorEnabled||chzzkLive?.settings?.enabled);
  const chzzkState=String(chzzkLive?.state?.lastStatus||'idle');
  add(checks,{id:'chzzk',group:'integrations',label:'CHZZK 방송 감지',status:chzzkConfigured&&chzzkConnector&&chzzkEnabled&&chzzkState!=='fail'?'pass':'warn',detail:!chzzkConfigured?'CHZZK Open API 설정 누락':!chzzkEnabled?'연동 설정됨 · Monitor 비활성':chzzkState==='fail'?'최근 상태 확인 실패':'CHZZK Monitor 준비됨',target:'live',action:'CHZZK Client ID/Secret/Channel ID와 Monitor 활성 상태를 확인하세요.',required:false});
  const naverRegistrationOpen=Boolean(naverParticipation?.registrationOpen);
  if(naverRegistrationOpen&&!naverConnected)add(checks,{id:'naver-open-without-oauth',group:'integrations',label:'Naver 시참 접수 상태',status:'warn',detail:'Naver 시참 접수는 열려 있지만 OAuth 연결이 확인되지 않습니다.',target:'settings',action:'방송 시작 전 OAuth 연결 또는 시참 접수 상태를 정리하세요.',required:false});

  const blocking=checks.filter(item=>item.required&&item.status==='fail');
  const warnings=checks.filter(item=>item.status==='warn');
  const status=blocking.length?'fail':warnings.length?'warn':'pass';
  const actions=checks.filter(item=>item.status!=='pass').sort((a,b)=>statusRank[b.status]-statusRank[a.status]).map(item=>({id:item.id,status:item.status,title:item.label,detail:item.action||item.detail,target:item.target,required:item.required}));
  const groups={core:checks.filter(item=>item.group==='core'),access:checks.filter(item=>item.group==='access'),integrations:checks.filter(item=>item.group==='integrations')};
  return {
    schema:'daengdaeng-go-live-readiness-v1',checkedAt:now,status,launchable:blocking.length===0,fullyReady:status==='pass',
    counts:{pass:checks.filter(c=>c.status==='pass').length,warn:warnings.length,fail:checks.filter(c=>c.status==='fail').length,blocking:blocking.length,total:checks.length},
    summary:blocking.length?`실서비스 시작 전 필수 해결 ${blocking.length}건 · 확인 ${warnings.length}건`:warnings.length?`핵심 실행 가능 · 권장 확인 ${warnings.length}건`:'실서비스 시작 준비 완료',
    checks,groups,actions,
    integrations:{naver:{configured:naverConfigured,connected:naverConnected,memoBoardConfigured:memoReady},chzzk:{configured:chzzkConfigured,monitorEnabled:chzzkEnabled,connectorConfigured:Boolean(chzzkConnector)}},
    exposure:{localBind:local,viewerUrlConfigured:Boolean(config.viewerUrl),delegatedOperatorConfigured:operatorReady}
  };
}
