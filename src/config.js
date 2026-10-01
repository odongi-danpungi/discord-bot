import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDashboardOperatorCapabilities } from './dashboard-access.js';
export async function loadConfig(env=process.env,args=process.argv.slice(2)) {
  let local={};
  try{local=JSON.parse(await readFile('config.local.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('config.local.json 형식을 확인해 주세요.');}
  const value=key=>env[key]??local[key];
  const demo=args.includes('--demo'),dev=args.includes('--dev');
  if(demo&&dev)throw Error('--demo와 --dev는 동시에 사용할 수 없습니다.');
  const profile=demo?'demo':dev?'development':String(value('APP_PROFILE')||'production').toLowerCase();
  if(!['production','development','demo'].includes(profile)||(!demo&&profile==='demo'))throw Error('APP_PROFILE은 production 또는 development를 사용해 주세요. 연습 모드는 DEMO.cmd를 사용합니다.');
  const port=Number(demo?(env.DEMO_PORT||3001):(value('PORT')||3000));
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT는 1~65535 사이 정수여야 합니다.');
  const keepCount=Number(value('BACKUP_KEEP_COUNT')||14),maxAgeDays=Number(value('BACKUP_MAX_AGE_DAYS')||30),backupHours=Number(value('BACKUP_INTERVAL_HOURS')||24),naverMonitorInterval=Number(value('NAVER_MONITOR_INTERVAL_MINUTES')||5),participationCallTimeout=Number(value('PARTICIPATION_CALL_TIMEOUT_SECONDS')||60),chzzkMonitorInterval=Number(value('CHZZK_MONITOR_INTERVAL_MINUTES')||2),chzzkMaxPages=Number(value('CHZZK_LIVE_SCAN_MAX_PAGES')||50);
  if(!Number.isInteger(keepCount)||keepCount<1||keepCount>90)throw Error('BACKUP_KEEP_COUNT는 1~90 사이 정수여야 합니다.');
  if(!Number.isInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>365)throw Error('BACKUP_MAX_AGE_DAYS는 1~365 사이 정수여야 합니다.');
  if(!Number.isInteger(backupHours)||backupHours<1||backupHours>168)throw Error('BACKUP_INTERVAL_HOURS는 1~168 사이 정수여야 합니다.');
  if(![1,5,15,30,60].includes(naverMonitorInterval))throw Error('NAVER_MONITOR_INTERVAL_MINUTES는 1, 5, 15, 30, 60 중 하나여야 합니다.');
  if(!Number.isInteger(participationCallTimeout)||participationCallTimeout<15||participationCallTimeout>300)throw Error('PARTICIPATION_CALL_TIMEOUT_SECONDS는 15~300 사이 정수여야 합니다.');
  if(![1,2,5,10,15].includes(chzzkMonitorInterval))throw Error('CHZZK_MONITOR_INTERVAL_MINUTES는 1, 2, 5, 10, 15 중 하나여야 합니다.');
  if(!Number.isInteger(chzzkMaxPages)||chzzkMaxPages<1||chzzkMaxPages>100)throw Error('CHZZK_LIVE_SCAN_MAX_PAGES는 1~100 사이 정수여야 합니다.');
  const dashboardOperatorUser=String(value('DASHBOARD_OPERATOR_USER')||'').trim(),dashboardOperatorPassword=String(value('DASHBOARD_OPERATOR_PASSWORD')||''),dashboardOperatorCapabilities=parseDashboardOperatorCapabilities(value('DASHBOARD_OPERATOR_CAPABILITIES'));
  const trustProxyHops=Number(value('TRUST_PROXY_HOPS')||0);
  if(!Number.isInteger(trustProxyHops)||trustProxyHops<0||trustProxyHops>5)throw Error('TRUST_PROXY_HOPS는 0~5 사이 정수여야 합니다.');
  const config={demo,dev,profile,port,viewerUrl:value('VIEWER_URL')||'',publicBaseUrl:String(value('PUBLIC_BASE_URL')||'').trim(),trustProxyHops,host:demo?'127.0.0.1':value('HOST')||'127.0.0.1',guildId:demo?'demo':value('DISCORD_GUILD_ID'),clientId:value('DISCORD_CLIENT_ID'),token:value('DISCORD_TOKEN'),adminRoleId:value('ADMIN_ROLE_ID')||'',dashboardUser:value('DASHBOARD_USER')||'admin',dashboardPassword:value('DASHBOARD_PASSWORD'),dashboardOperatorUser,dashboardOperatorPassword,dashboardOperatorCapabilities,broadcastToken:value('BROADCAST_TOKEN')||'',dataFile:demo?'./data/demo/registrations.json':value('DATA_FILE')||'./data/registrations.json',operationsFile:demo?'./data/demo/operations.json':value('OPERATIONS_FILE')||'./data/operations.json',recoveryFile:demo?'./data/demo/recovery.json':value('RECOVERY_FILE')||'./data/recovery.json',discordPolicyFile:demo?'./data/demo/discord-policy.json':value('DISCORD_POLICY_FILE')||'./data/discord-policy.json',incidentWorkflowFile:demo?'./data/demo/incidents.json':value('INCIDENT_WORKFLOW_FILE')||'./data/incidents.json',idempotencyFile:demo?'./data/demo/idempotency.json':value('IDEMPOTENCY_FILE')||'./data/idempotency.json',naverAuthFile:demo?'./data/demo/naver-auth.json':value('NAVER_AUTH_FILE')||'./data/naver-auth.json',naverMonitorFile:demo?'./data/demo/naver-monitor.json':value('NAVER_MONITOR_FILE')||'./data/naver-monitor.json',naverParticipationFile:demo?'./data/demo/naver-participation.json':value('NAVER_PARTICIPATION_FILE')||'./data/naver-participation.json',participationQueueFile:demo?'./data/demo/participation-queue.json':value('PARTICIPATION_QUEUE_FILE')||'./data/participation-queue.json',broadcastOpsFile:demo?'./data/demo/broadcast-ops.json':value('BROADCAST_OPS_FILE')||'./data/broadcast-ops.json',participationCallTimeoutSeconds:participationCallTimeout,chzzkClientId:String(value('CHZZK_CLIENT_ID')||'').trim(),chzzkClientSecret:String(value('CHZZK_CLIENT_SECRET')||'').trim(),chzzkChannelId:String(value('CHZZK_CHANNEL_ID')||'').trim(),chzzkMonitorEnabled:String(value('CHZZK_MONITOR_ENABLED')||'false').trim().toLowerCase()==='true',chzzkMonitorIntervalMinutes:chzzkMonitorInterval,chzzkMonitorDiscordAlerts:String(value('CHZZK_MONITOR_DISCORD_ALERTS')||'true').trim().toLowerCase()!=='false',chzzkLiveScanMaxPages:chzzkMaxPages,chzzkLiveFile:demo?'./data/demo/chzzk-live.json':value('CHZZK_LIVE_FILE')||'./data/chzzk-live.json',naverClientId:String(value('NAVER_CLIENT_ID')||'').trim(),naverClientSecret:String(value('NAVER_CLIENT_SECRET')||'').trim(),naverRedirectUri:String(value('NAVER_REDIRECT_URI')||'').trim(),naverCafeId:String(value('NAVER_CAFE_ID')||'').trim(),naverMenuId:String(value('NAVER_MENU_ID')||'').trim(),naverMemoMenuId:String(value('NAVER_MEMO_MENU_ID')||'').trim(),naverTokenKey:String(value('NAVER_TOKEN_KEY')||'').trim(),naverMonitorEnabled:String(value('NAVER_MONITOR_ENABLED')||'').trim().toLowerCase()==='true',naverMonitorQuery:String(value('NAVER_MONITOR_QUERY')||'').trim(),naverMonitorCafeUrl:String(value('NAVER_MONITOR_CAFE_URL')||'').trim(),naverMonitorIntervalMinutes:naverMonitorInterval,naverMonitorDiscordAlerts:String(value('NAVER_MONITOR_DISCORD_ALERTS')||'true').trim().toLowerCase()!=='false',backupDir:demo?'./data/demo/backups':value('BACKUP_DIR')||'./data/backups',backupKeepCount:keepCount,backupMaxAgeDays:maxAgeDays,backupIntervalHours:backupHours};
  const storagePaths=[['DATA_FILE',config.dataFile],['OPERATIONS_FILE',config.operationsFile],['RECOVERY_FILE',config.recoveryFile],['DISCORD_POLICY_FILE',config.discordPolicyFile],['INCIDENT_WORKFLOW_FILE',config.incidentWorkflowFile],['IDEMPOTENCY_FILE',config.idempotencyFile],['NAVER_AUTH_FILE',config.naverAuthFile],['NAVER_MONITOR_FILE',config.naverMonitorFile],['NAVER_PARTICIPATION_FILE',config.naverParticipationFile],['PARTICIPATION_QUEUE_FILE',config.participationQueueFile],['BROADCAST_OPS_FILE',config.broadcastOpsFile],['CHZZK_LIVE_FILE',config.chzzkLiveFile]];
  Object.assign(config, {
    chzzkVerifyEnabled: !demo && String(value('CHZZK_VERIFY_ENABLED') || 'false').toLowerCase() === 'true',
    chzzkVerifyRoleId: String(value('CHZZK_VERIFY_ROLE_ID') || '').trim(),
    chzzkVerifyNickname: String(value('CHZZK_VERIFY_NICKNAME_SYNC') || 'true').toLowerCase() !== 'false',
    chzzkTokenKey: String(value('CHZZK_TOKEN_KEY') || '').trim(),
    chzzkVerificationFile: value('CHZZK_VERIFICATION_FILE') || path.join(path.dirname(config.dataFile), 'chzzk-verification.json')
  });
  if (config.chzzkVerifyEnabled) {
    if (!config.chzzkClientId || !config.chzzkClientSecret || !/^[a-f0-9]{32}$/i.test(config.chzzkChannelId)) throw Error('CHZZK 인증의 Client ID·Secret·Channel ID가 필요합니다.');
    if (!/^\d{17,20}$/.test(config.chzzkVerifyRoleId) || config.chzzkVerifyRoleId === config.guildId) throw Error('CHZZK_VERIFY_ROLE_ID는 인증 전용 역할 ID여야 합니다.');
    const bytes = /^[a-f0-9]{64}$/i.test(config.chzzkTokenKey) ? Buffer.from(config.chzzkTokenKey, 'hex') : Buffer.from(config.chzzkTokenKey, 'base64');
    if (bytes.length !== 32) throw Error('CHZZK_TOKEN_KEY는 32바이트 HEX 또는 Base64 키여야 합니다.');
    let base;
    try { base = new URL(config.publicBaseUrl); } catch { throw Error('CHZZK 인증에 공개 HTTPS 주소가 필요합니다.'); }
    if (base.protocol !== 'https:' || base.username || base.password || /^(localhost|127\.|\[?::1)/i.test(base.hostname)) throw Error('CHZZK 인증에 공개 HTTPS 주소가 필요합니다.');
    storagePaths.push(['CHZZK_VERIFICATION_FILE', config.chzzkVerificationFile]);
  }
  const seenStoragePaths=new Map();
  for(const [label,file] of storagePaths){const absolute=path.resolve(file),previous=seenStoragePaths.get(absolute);if(previous)throw Error(`${previous}와 ${label}은 같은 JSON 파일을 사용할 수 없습니다.`);seenStoragePaths.set(absolute,label);}

  const chzzkAny=Boolean(config.chzzkClientId||config.chzzkClientSecret||config.chzzkChannelId||config.chzzkMonitorEnabled);
  if(chzzkAny){
    if(!config.chzzkClientId||!config.chzzkClientSecret)throw Error('치지직 방송 감지를 사용하려면 CHZZK_CLIENT_ID와 CHZZK_CLIENT_SECRET이 모두 필요합니다.');
    if(!/^[0-9a-fA-F]{32}$/.test(config.chzzkChannelId||''))throw Error('CHZZK_CHANNEL_ID는 32자리 치지직 채널 ID여야 합니다.');
  }
  const naverAny=Boolean(config.naverClientId||config.naverClientSecret||config.naverRedirectUri||config.naverCafeId||config.naverMenuId||config.naverMemoMenuId||config.naverTokenKey||config.naverMonitorEnabled||config.naverMonitorQuery||config.naverMonitorCafeUrl);
  if(naverAny){
    if(!config.naverClientId||!config.naverClientSecret)throw Error('네이버 연동을 사용하려면 NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET이 모두 필요합니다.');
    if(config.naverCafeId&&!/^\d+$/.test(config.naverCafeId))throw Error('NAVER_CAFE_ID는 숫자 clubid여야 합니다.');
    if(config.naverMenuId&&!/^\d+$/.test(config.naverMenuId))throw Error('NAVER_MENU_ID는 숫자 menuid여야 합니다.');
    if(config.naverMemoMenuId&&!/^\d+$/.test(config.naverMemoMenuId))throw Error('NAVER_MEMO_MENU_ID는 숫자 menuid여야 합니다.');
    if(config.naverMenuId&&!config.naverCafeId)throw Error('NAVER_MENU_ID를 사용하려면 NAVER_CAFE_ID도 설정해야 합니다.');
    if(config.naverMemoMenuId&&!config.naverCafeId)throw Error('NAVER_MEMO_MENU_ID를 사용하려면 NAVER_CAFE_ID도 설정해야 합니다.');
    if(config.naverTokenKey){
      let keyBytes=null;
      if(/^[0-9a-fA-F]{64}$/.test(config.naverTokenKey))keyBytes=Buffer.from(config.naverTokenKey,'hex');
      else{try{keyBytes=Buffer.from(config.naverTokenKey,'base64')}catch{keyBytes=null}}
      if(!keyBytes||keyBytes.length!==32)throw Error('NAVER_TOKEN_KEY는 32바이트 키여야 합니다. 64자리 HEX 또는 Base64 형식을 사용해 주세요.');
    }

    if(config.naverMonitorQuery.length>100)throw Error('NAVER_MONITOR_QUERY는 100자 이하로 설정해 주세요.');
    if(config.naverMonitorEnabled&&!config.naverMonitorQuery)throw Error('NAVER_MONITOR_ENABLED=true이면 NAVER_MONITOR_QUERY가 필요합니다.');
    if(config.naverMonitorCafeUrl){
      let monitorUrl;try{monitorUrl=new URL(config.naverMonitorCafeUrl)}catch{throw Error('NAVER_MONITOR_CAFE_URL에 올바른 네이버 카페 URL을 입력해 주세요.');}
      if(monitorUrl.protocol!=='https:'||monitorUrl.hostname!=='cafe.naver.com'||monitorUrl.username||monitorUrl.password||monitorUrl.hash)throw Error('NAVER_MONITOR_CAFE_URL은 https://cafe.naver.com/... 형식이어야 합니다.');
      monitorUrl.search='';monitorUrl.pathname=monitorUrl.pathname.replace(/\/+$/,'')||'/';config.naverMonitorCafeUrl=monitorUrl.toString();
    }
    if(config.naverRedirectUri){
      let callback;try{callback=new URL(config.naverRedirectUri)}catch{throw Error('NAVER_REDIRECT_URI에 올바른 콜백 URL을 입력해 주세요.');}
      const localHttp=callback.protocol==='http:'&&['127.0.0.1','localhost'].includes(callback.hostname);
      if(callback.protocol!=='https:'&&!localHttp)throw Error('NAVER_REDIRECT_URI는 HTTPS 주소를 사용해 주세요. 로컬 개발에서는 localhost/127.0.0.1 HTTP만 허용됩니다.');
      if(callback.username||callback.password||callback.hash||callback.search)throw Error('NAVER_REDIRECT_URI에는 인증정보, 쿼리, fragment를 넣을 수 없습니다.');
      if(callback.pathname!=='/naver/callback')throw Error('NAVER_REDIRECT_URI의 경로는 /naver/callback 이어야 합니다.');
      config.naverRedirectUri=callback.toString();
      if(!config.naverTokenKey)throw Error('NAVER_REDIRECT_URI를 사용하면 암호화 토큰 저장용 NAVER_TOKEN_KEY가 필요합니다.');
    }
  }
  config.productionMonitorIntervalSeconds=Number(env.PRODUCTION_MONITOR_INTERVAL_SECONDS||0);
  if(!Number.isInteger(config.productionMonitorIntervalSeconds)||(config.productionMonitorIntervalSeconds!==0&&(config.productionMonitorIntervalSeconds<60||config.productionMonitorIntervalSeconds>3600)))throw Error('PRODUCTION_MONITOR_INTERVAL_SECONDS는 0 또는 60~3600초여야 합니다.');
  if(config.publicBaseUrl){
    let base;try{base=new URL(config.publicBaseUrl)}catch{throw Error('PUBLIC_BASE_URL에 올바른 HTTPS 주소를 입력해 주세요.');}
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('PUBLIC_BASE_URL은 인증정보와 쿼리가 없는 HTTPS 주소여야 합니다.');
    base.pathname=base.pathname.replace(/\/+$/,'')+'/';config.publicBaseUrl=base.toString();
  }
  if(config.viewerUrl){
    let url;try{url=new URL(config.viewerUrl)}catch{throw Error('VIEWER_URL에 올바른 HTTPS 주소를 입력해 주세요.');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('VIEWER_URL은 인증정보와 쿼리가 없는 HTTPS 주소여야 합니다.');
    config.viewerUrl=url.toString();
  }
  if(!demo){
    if(!config.token||config.token==='your_bot_token')throw Error('봇 토큰이 없습니다. START.cmd로 설정해 주세요.');
    if(!/^\d{17,20}$/.test(config.guildId||'')||!/^\d{17,20}$/.test(config.clientId||''))throw Error('서버 ID와 애플리케이션 ID를 확인해 주세요.');
    if(config.adminRoleId&&!/^\d{17,20}$/.test(config.adminRoleId))throw Error('ADMIN_ROLE_ID는 Discord 역할 ID여야 합니다.');
    if(typeof config.dashboardPassword!=='string'||config.dashboardPassword.length<12)throw Error('대시보드 비밀번호를 12자 이상으로 설정해 주세요.');
    if((config.dashboardOperatorUser&&!config.dashboardOperatorPassword)||(!config.dashboardOperatorUser&&config.dashboardOperatorPassword))throw Error('운영자 계정을 사용하려면 DASHBOARD_OPERATOR_USER와 DASHBOARD_OPERATOR_PASSWORD를 모두 설정해 주세요.');
    if(config.dashboardOperatorUser){
      if(config.dashboardOperatorUser.length>64||config.dashboardOperatorUser.includes(':'))throw Error('DASHBOARD_OPERATOR_USER는 64자 이하이며 콜론(:)을 포함할 수 없습니다.');
      if(config.dashboardOperatorPassword.length<12)throw Error('DASHBOARD_OPERATOR_PASSWORD는 12자 이상으로 설정해 주세요.');
      if(config.dashboardOperatorUser===config.dashboardUser)throw Error('관리자와 운영자 대시보드 아이디는 서로 달라야 합니다.');
      if(config.dashboardOperatorPassword===config.dashboardPassword)throw Error('관리자와 운영자 대시보드 비밀번호는 서로 다르게 설정해 주세요.');
    }
    if(config.broadcastToken&&config.broadcastToken.length<24)throw Error('BROADCAST_TOKEN은 사용할 경우 24자 이상으로 설정해 주세요.');
  }
  return config;
}
