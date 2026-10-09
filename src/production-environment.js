const LOCAL_HOSTS=new Set(['127.0.0.1','localhost','::1']);
const rank={pass:0,warn:1,fail:2};
const clean=(value,max=240)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const worst=(checks=[])=>checks.reduce((status,item)=>rank[item.status]>rank[status]?item.status:status,'pass');

function placeholder(value){
  const raw=String(value??'').trim();
  if(!raw)return false;
  const normalized=raw.toLowerCase().replace(/[\s-]+/g,'_');
  return /^(your_|replace_|change_|changeme$|change_me$|example$|example_|test_secret$|secret_here$|password$|password123$|admin123$)/.test(normalized)||/^<[^>]+>$/.test(raw)||/^\$\{[^}]+\}$/.test(raw);
}
function parseUrl(value){try{return new URL(String(value||''));}catch{return null;}}
function validHttpsUrl(value,{path=null}={}){
  const url=parseUrl(value);if(!url)return false;
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return false;
  if(path!==null&&url.pathname!==path)return false;
  return true;
}
function add(checks,{id,group,label,status='warn',detail='',action='',required=true}){
  checks.push({id,group,label,status:['pass','warn','fail'].includes(status)?status:'warn',detail:clean(detail),action:clean(action),required:Boolean(required)});
}
function secretCheck(value,{required=false,min=0}={}){
  const text=String(value??'');
  if(!text)return required?'fail':'warn';
  if(placeholder(text))return 'fail';
  if(min&&text.length<min)return 'fail';
  return 'pass';
}
function validNaverTokenKey(value){const raw=String(value||'').trim();if(/^[0-9a-fA-F]{64}$/.test(raw))return true;try{return Buffer.from(raw,'base64').length===32;}catch{return false;}}
function hasNaver(config={}){return Boolean(config.naverClientId||config.naverClientSecret||config.naverRedirectUri||config.naverCafeId||config.naverMenuId||config.naverMemoMenuId||config.naverTokenKey||config.naverMonitorEnabled);}
function hasChzzk(config={}){return Boolean(config.chzzkClientId||config.chzzkClientSecret||config.chzzkChannelId||config.chzzkMonitorEnabled);}

export function buildProductionEnvironmentValidation({config={},now=Date.now()}={}){
  const checks=[];const production=config.profile==='production',external=!LOCAL_HOSTS.has(String(config.host||'127.0.0.1'));
  add(checks,{id:'profile',group:'core',label:'Production profile',status:production?'pass':'warn',detail:production?'APP_PROFILE=production':'현재 profile은 production이 아닙니다.',action:'실서비스 배포에서는 APP_PROFILE=production을 사용하세요.',required:production});
  const discordTokenStatus=secretCheck(config.token,{required:production,min:24});
  add(checks,{id:'discord-token',group:'discord',label:'Discord Bot Token',status:production?discordTokenStatus:(config.token?'pass':'warn'),detail:discordTokenStatus==='pass'?'비밀값 설정 및 기본 정책 확인됨':'비밀값 누락·placeholder·길이 정책을 확인하세요.',action:'호스트 Secret Manager에 실제 DISCORD_TOKEN을 저장하세요.',required:production});
  const idsOk=/^\d{17,20}$/.test(String(config.clientId||''))&&/^\d{17,20}$/.test(String(config.guildId||''));
  add(checks,{id:'discord-ids',group:'discord',label:'Discord Application/Guild IDs',status:idsOk?'pass':production?'fail':'warn',detail:idsOk?'Application ID와 Guild ID 형식 확인됨':'DISCORD_CLIENT_ID / DISCORD_GUILD_ID 형식 확인 필요',action:'Discord Developer Portal과 대상 서버에서 ID를 다시 확인하세요.',required:production});

  if(config.multiWorkspaceEnabled){
    const secretOk=secretCheck(config.discordClientSecret,{required:true,min:12})==='pass';
    add(checks,{id:'workspace-login',group:'discord',label:'사용자 Discord 로그인',status:secretOk?'pass':'fail',detail:secretOk?'OAuth Client Secret 기본 정책 확인됨 · 실제 로그인은 별도 검증 필요':'사용자 로그인용 Client Secret 누락·placeholder·길이 정책 확인 필요',action:'DISCORD_CLIENT_SECRET과 PUBLIC_BASE_URL + /portal/auth/callback을 Discord OAuth2에 설정하세요.',required:true});
    const originOk=validHttpsUrl(config.publicBaseUrl,{path:'/'});
    add(checks,{id:'workspace-origin',group:'network',label:'사용자 서비스 HTTPS origin',status:originOk?'pass':'fail',detail:originOk?'공유 콜백용 루트 HTTPS 주소 확인됨':'사용자 서비스는 쿼리·인증정보 없는 루트 HTTPS 주소가 필요합니다.',action:'실제 배포 도메인을 PUBLIC_BASE_URL로 지정하세요.',required:true});
  }
  const adminSecret=secretCheck(config.dashboardPassword,{required:production,min:12});
  const adminStrong=adminSecret==='pass'&&String(config.dashboardPassword).length>=16;
  add(checks,{id:'dashboard-password',group:'access',label:'Dashboard 관리자 비밀번호',status:adminSecret!=='pass'?(production?'fail':'warn'):adminStrong?'pass':'warn',detail:adminSecret!=='pass'?'비밀번호 누락·placeholder·길이 정책을 확인하세요.':adminStrong?'16자 이상 고유 비밀번호 설정됨':'최소 정책은 충족하지만 16자 이상을 권장합니다.',action:'다른 서비스와 재사용하지 않은 16자 이상 비밀번호를 사용하세요.',required:production});
  add(checks,{id:'dashboard-user',group:'access',label:'Dashboard 관리자 계정명',status:String(config.dashboardUser||'admin')==='admin'?'warn':'pass',detail:String(config.dashboardUser||'admin')==='admin'?'기본 관리자 계정명 admin 사용 중':'기본값이 아닌 관리자 계정명 사용 중',action:'외부 운영 환경이면 DASHBOARD_USER도 기본값에서 변경하는 것을 권장합니다.',required:false});

  const operatorEnabled=Boolean(config.dashboardOperatorUser||config.dashboardOperatorPassword);
  if(operatorEnabled){
    const pair=Boolean(config.dashboardOperatorUser&&config.dashboardOperatorPassword),opStatus=pair?secretCheck(config.dashboardOperatorPassword,{required:true,min:12}):'fail';
    add(checks,{id:'operator-credentials',group:'access',label:'위임 운영자 인증',status:pair&&opStatus==='pass'?'pass':'fail',detail:pair&&opStatus==='pass'?'관리자와 분리된 운영자 인증 설정됨':'운영자 ID/비밀번호 쌍 또는 비밀번호 정책을 확인하세요.',action:'DASHBOARD_OPERATOR_USER/PASSWORD를 함께 설정하고 관리자 비밀번호와 분리하세요.',required:true});
  }else add(checks,{id:'operator-credentials',group:'access',label:'위임 운영자 인증',status:'warn',detail:'위임 운영자 계정 미설정',action:'모바일 운영자를 분리할 때만 별도 운영자 계정을 설정하세요.',required:false});

  const broadcastStatus=secretCheck(config.broadcastToken,{required:external,min:24});
  add(checks,{id:'broadcast-token',group:'access',label:'Broadcast 접근 토큰',status:external?broadcastStatus:(config.broadcastToken?broadcastStatus==='pass'?'pass':'warn':'pass'),detail:external?(broadcastStatus==='pass'?'외부 노출 보호 토큰 설정됨':'외부 바인딩인데 보호 토큰 정책이 충족되지 않았습니다.'):(config.broadcastToken?'선택 토큰 설정됨':'로컬 바인딩 · 별도 토큰 선택사항'),action:'외부 노출 시 BROADCAST_TOKEN을 24자 이상의 고유 랜덤값으로 설정하세요.',required:external});

  const publicConfigured=Boolean(config.publicBaseUrl),publicOk=publicConfigured&&validHttpsUrl(config.publicBaseUrl);
  add(checks,{id:'public-base-url',group:'network',label:'Public HTTPS origin',status:external?(publicOk?'pass':'fail'):publicConfigured?(publicOk?'pass':'fail'):'pass',detail:publicOk?'HTTPS 공개 origin 형식 확인됨':publicConfigured?'PUBLIC_BASE_URL 형식이 안전하지 않습니다.':'로컬 바인딩 · 공개 URL 미설정',action:'외부 서버는 인증정보/쿼리/fragment가 없는 HTTPS PUBLIC_BASE_URL을 사용하세요.',required:external});
  const viewerConfigured=Boolean(config.viewerUrl),viewerOk=viewerConfigured&&validHttpsUrl(config.viewerUrl);
  let viewerStatus=viewerConfigured?(viewerOk?'pass':'fail'):'warn';let viewerDetail=viewerConfigured?(viewerOk?'HTTPS Viewer URL 형식 확인됨':'VIEWER_URL 형식 확인 필요'):'VIEWER_URL 미설정';
  if(viewerOk&&publicOk&&parseUrl(config.viewerUrl).origin!==parseUrl(config.publicBaseUrl).origin){viewerStatus='warn';viewerDetail='Viewer URL이 PUBLIC_BASE_URL과 다른 origin을 사용합니다.';}
  add(checks,{id:'viewer-url',group:'network',label:'Viewer 공개 URL',status:viewerStatus,detail:viewerDetail,action:'가능하면 같은 HTTPS origin의 /viewer/ 주소를 사용하세요.',required:false});

  const naverConfigured=hasNaver(config);
  if(naverConfigured){
    const clientOk=Boolean(config.naverClientId)&&secretCheck(config.naverClientSecret,{required:true})==='pass';
    add(checks,{id:'naver-client',group:'naver',label:'Naver Client 인증',status:clientOk?'pass':'fail',detail:clientOk?'Client ID/Secret 설정됨':'Client ID/Secret 누락 또는 placeholder 확인 필요',action:'Naver Developers의 Client ID/Secret을 Secret Manager에 설정하세요.',required:true});
    const callbackOk=Boolean(config.naverRedirectUri)&&validHttpsUrl(config.naverRedirectUri,{path:'/naver/callback'});
    let callbackStatus=callbackOk?'pass':'warn',callbackDetail=callbackOk?'OAuth callback HTTPS 경로 확인됨':'OAuth callback 미설정';
    if(callbackOk&&publicOk&&parseUrl(config.naverRedirectUri).origin!==parseUrl(config.publicBaseUrl).origin){callbackStatus='fail';callbackDetail='NAVER_REDIRECT_URI origin이 PUBLIC_BASE_URL과 다릅니다.';}
    add(checks,{id:'naver-redirect',group:'naver',label:'Naver OAuth Redirect URI',status:callbackStatus,detail:callbackDetail,action:'실서비스 callback은 PUBLIC_BASE_URL과 같은 origin의 /naver/callback을 등록하세요.',required:Boolean(config.naverRedirectUri)});
    const keyStatus=config.naverRedirectUri?(secretCheck(config.naverTokenKey,{required:true})==='pass'&&validNaverTokenKey(config.naverTokenKey)?'pass':'fail'):config.naverTokenKey?(validNaverTokenKey(config.naverTokenKey)?'pass':'fail'):'warn';
    add(checks,{id:'naver-token-key',group:'naver',label:'Naver OAuth 저장 암호화 키',status:keyStatus,detail:keyStatus==='pass'?'OAuth token 암호화 키 설정됨':config.naverRedirectUri?'OAuth callback 사용 중이므로 암호화 키가 필요합니다.':'OAuth 미사용 · 키 선택사항',action:'NAVER_TOKEN_KEY는 32바이트 랜덤 키를 Secret Manager에 저장하세요.',required:Boolean(config.naverRedirectUri)});
    const cafeReady=Boolean(config.naverCafeId&&(config.naverMemoMenuId||config.naverMenuId));
    add(checks,{id:'naver-cafe-target',group:'naver',label:'Naver Cafe 게시 대상',status:cafeReady?'pass':'warn',detail:cafeReady?'Cafe/Menu 대상 설정됨':'Cafe ID 또는 Menu ID가 아직 완성되지 않았습니다.',action:'칼바람 시참 메모 게시를 사용하면 NAVER_CAFE_ID와 NAVER_MEMO_MENU_ID 또는 NAVER_MENU_ID를 설정하세요.',required:false});
  }else add(checks,{id:'naver-client',group:'naver',label:'Naver Cafe 연동',status:'warn',detail:'Naver Cafe 연동 미설정',action:'Naver 기능을 사용할 때 Client/OAuth/Cafe 설정을 추가하세요.',required:false});

  const chzzkConfigured=hasChzzk(config);
  if(chzzkConfigured){
    const clientOk=Boolean(config.chzzkClientId)&&secretCheck(config.chzzkClientSecret,{required:true})==='pass',channelOk=/^[0-9a-fA-F]{32}$/.test(String(config.chzzkChannelId||''));
    add(checks,{id:'chzzk-client',group:'chzzk',label:'CHZZK Client 인증',status:clientOk?'pass':'fail',detail:clientOk?'Client ID/Secret 설정됨':'Client ID/Secret 누락 또는 placeholder 확인 필요',action:'CHZZK Developers의 Client ID/Secret을 Secret Manager에 설정하세요.',required:true});
    const autoChannel=Boolean(config.chzzkVerifyEnabled&&!config.chzzkMonitorEnabled&&!config.chzzkChannelId);
    add(checks,{id:'chzzk-channel',group:'chzzk',label:'CHZZK Channel ID',status:channelOk?'pass':autoChannel?'warn':'fail',detail:channelOk?'32자리 Channel ID 형식 확인됨':autoChannel?'팔로워 인증 대상은 운영자 동의 시 자동 저장 · 실제 연결 확인 필요':'Channel ID 형식 확인 필요',action:autoChannel?'관리자 대시보드에서 공통 방송 채널을 한 번 연결하세요.':'방송 감지에 사용할 32자리 CHZZK_CHANNEL_ID를 확인하세요.',required:!autoChannel});
    add(checks,{id:'chzzk-monitor',group:'chzzk',label:'CHZZK Monitor',status:config.chzzkMonitorEnabled?'pass':'warn',detail:config.chzzkMonitorEnabled?'방송 감지 활성화':'Client 설정됨 · Monitor 비활성',action:'자동 방송 시작/종료 감지를 사용하려면 CHZZK_MONITOR_ENABLED=true로 설정하세요.',required:false});
  }else add(checks,{id:'chzzk-client',group:'chzzk',label:'CHZZK 연동',status:'warn',detail:'CHZZK Open API 연동 미설정',action:'방송 자동 감지를 사용할 때 Client/Channel 설정을 추가하세요.',required:false});

  if(config.chzzkVerifyEnabled){
    const keyOk=validNaverTokenKey(config.chzzkTokenKey),roleOk=!config.chzzkVerifyRoleId||/^\d{17,20}$/.test(config.chzzkVerifyRoleId||'')&&config.chzzkVerifyRoleId!==config.guildId;
    add(checks,{id:'chzzk-verification-key',group:'chzzk',label:'CHZZK 인증 토큰 암호화',status:keyOk?'pass':'fail',detail:keyOk?'32바이트 암호화 키 형식 확인됨':'인증 토큰 저장 키가 필요합니다.',action:'CHZZK_TOKEN_KEY는 다른 Secret과 별개로 생성하고 재배포 후 유지하세요.',required:true});
    add(checks,{id:'chzzk-verification-role',group:'chzzk',label:'CHZZK 인증 전용 역할',status:roleOk?'pass':'fail',detail:roleOk?(config.chzzkVerifyRoleId?'역할 ID 형식 확인됨 · 실제 권한/순서는 적용 시 검사':'서버별 인증 역할 자동 생성 · Discord 역할 관리 권한 필요'):'인증 전용 역할 ID를 확인하세요.',action:'봇에 역할 관리 권한을 허용하세요. CHZZK_VERIFY_ROLE_ID는 기존 기본 서버 역할 지정 시에만 사용합니다.',required:true});
  }
  const comparable=[['DISCORD_CLIENT_SECRET',config.discordClientSecret],['DASHBOARD_PASSWORD',config.dashboardPassword],['DASHBOARD_OPERATOR_PASSWORD',config.dashboardOperatorPassword],['BROADCAST_TOKEN',config.broadcastToken],['NAVER_CLIENT_SECRET',config.naverClientSecret],['NAVER_TOKEN_KEY',config.naverTokenKey],['CHZZK_CLIENT_SECRET',config.chzzkClientSecret],['CHZZK_TOKEN_KEY',config.chzzkTokenKey]].filter(([,value])=>String(value||'').length>=12);
  const reused=[];for(let i=0;i<comparable.length;i++)for(let j=i+1;j<comparable.length;j++)if(comparable[i][1]===comparable[j][1])reused.push(`${comparable[i][0]} / ${comparable[j][0]}`);
  add(checks,{id:'secret-reuse',group:'core',label:'Secret 재사용',status:reused.length?'fail':'pass',detail:reused.length?`서로 다른 자격 증명 ${reused.length}쌍이 같은 값을 사용합니다.`:'검사 대상 Secret 간 동일 값 없음',action:'Dashboard/Broadcast/Naver/CHZZK 비밀값은 각각 독립된 랜덤값을 사용하세요.',required:production});

  const requiredChecks=checks.filter(item=>item.required),blocking=requiredChecks.filter(item=>item.status==='fail'),warnings=checks.filter(item=>item.status==='warn'),status=blocking.length?'fail':warnings.length?'warn':worst(requiredChecks);
  const groups={core:checks.filter(c=>c.group==='core'),discord:checks.filter(c=>c.group==='discord'),access:checks.filter(c=>c.group==='access'),network:checks.filter(c=>c.group==='network'),naver:checks.filter(c=>c.group==='naver'),chzzk:checks.filter(c=>c.group==='chzzk')};
  return {schema:'daengdaeng-production-environment-v1',checkedAt:now,status,launchable:blocking.length===0,production,external,counts:{pass:checks.filter(c=>c.status==='pass').length,warn:warnings.length,fail:checks.filter(c=>c.status==='fail').length,blocking:blocking.length,total:checks.length},summary:blocking.length?`시작 전 필수 환경 설정 ${blocking.length}건을 해결해야 합니다.`:warnings.length?`필수 환경 설정 통과 · 권장 확인 ${warnings.length}건`:'Production 환경 설정 검증 통과',checks,groups};
}

export function assertProductionEnvironment(report){
  if(!report||report.production!==true||report.launchable)return report;
  const labels=(report.checks||[]).filter(item=>item.required&&item.status==='fail').map(item=>item.label).slice(0,8);
  const error=Error(`Production 환경 검증 실패: ${labels.join(', ')||'필수 환경 설정'}을 확인해 주세요.`);error.code='EPRODUCTION_ENV';throw error;
}
