import { readFile } from 'node:fs/promises';
export async function loadConfig(env=process.env,args=process.argv.slice(2)) {
  let local={};
  try{local=JSON.parse(await readFile('config.local.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('config.local.json 형식을 확인해 주세요.');}
  const value=key=>env[key]??local[key];
  const boolValue=(key,fallback)=>{const raw=value(key);if(raw===undefined||raw===null||raw==='')return fallback;if(typeof raw==='boolean')return raw;const text=String(raw).trim().toLowerCase();if(['1','true','yes','on'].includes(text))return true;if(['0','false','no','off'].includes(text))return false;throw Error(`${key}는 true/false 값이어야 합니다.`);};
  const demo=args.includes('--demo'),dev=args.includes('--dev');
  if(demo&&dev)throw Error('--demo와 --dev는 동시에 사용할 수 없습니다.');
  const profile=demo?'demo':dev?'development':String(value('APP_PROFILE')||'production').toLowerCase();
  if(!['production','development','demo'].includes(profile)||(!demo&&profile==='demo'))throw Error('APP_PROFILE은 production 또는 development를 사용해 주세요. 연습 모드는 DEMO.cmd를 사용합니다.');
  const port=Number(demo?(env.DEMO_PORT||3001):(value('PORT')||3000));
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT는 1~65535 사이 정수여야 합니다.');
  const keepCount=Number(value('BACKUP_KEEP_COUNT')||14),maxAgeDays=Number(value('BACKUP_MAX_AGE_DAYS')||30),backupHours=Number(value('BACKUP_INTERVAL_HOURS')||24),recoveryRpoHours=Number(value('RECOVERY_RPO_HOURS')||backupHours),recoveryDrillIntervalDays=Number(value('RECOVERY_DRILL_INTERVAL_DAYS')||7),recoveryDrillRetryHours=Number(value('RECOVERY_DRILL_RETRY_HOURS')||6),recoveryDrillAuto=boolValue('RECOVERY_DRILL_AUTO',true);
  if(!Number.isInteger(keepCount)||keepCount<1||keepCount>90)throw Error('BACKUP_KEEP_COUNT는 1~90 사이 정수여야 합니다.');
  if(!Number.isInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>365)throw Error('BACKUP_MAX_AGE_DAYS는 1~365 사이 정수여야 합니다.');
  if(!Number.isInteger(backupHours)||backupHours<1||backupHours>168)throw Error('BACKUP_INTERVAL_HOURS는 1~168 사이 정수여야 합니다.');
  if(!Number.isInteger(recoveryRpoHours)||recoveryRpoHours<1||recoveryRpoHours>168)throw Error('RECOVERY_RPO_HOURS는 1~168 사이 정수여야 합니다.');
  if(!Number.isInteger(recoveryDrillIntervalDays)||recoveryDrillIntervalDays<1||recoveryDrillIntervalDays>90)throw Error('RECOVERY_DRILL_INTERVAL_DAYS는 1~90 사이 정수여야 합니다.');
  if(!Number.isInteger(recoveryDrillRetryHours)||recoveryDrillRetryHours<1||recoveryDrillRetryHours>24)throw Error('RECOVERY_DRILL_RETRY_HOURS는 1~24 사이 정수여야 합니다.');
  const config={demo,dev,profile,port,viewerUrl:value('VIEWER_URL')||'',host:demo?'127.0.0.1':value('HOST')||'127.0.0.1',guildId:demo?'demo':value('DISCORD_GUILD_ID'),clientId:value('DISCORD_CLIENT_ID'),token:value('DISCORD_TOKEN'),adminRoleId:value('ADMIN_ROLE_ID')||'',dashboardUser:value('DASHBOARD_USER')||'admin',dashboardPassword:value('DASHBOARD_PASSWORD'),broadcastToken:value('BROADCAST_TOKEN')||'',dataFile:demo?'./data/demo/registrations.json':value('DATA_FILE')||'./data/registrations.json',operationsFile:demo?'./data/demo/operations.json':value('OPERATIONS_FILE')||'./data/operations.json',recoveryFile:demo?'./data/demo/recovery.json':value('RECOVERY_FILE')||'./data/recovery.json',discordPolicyFile:demo?'./data/demo/discord-policy.json':value('DISCORD_POLICY_FILE')||'./data/discord-policy.json',incidentWorkflowFile:demo?'./data/demo/incidents.json':value('INCIDENT_WORKFLOW_FILE')||'./data/incidents.json',restoreTransactionFile:demo?'./data/demo/restore-transaction.json':value('RESTORE_TRANSACTION_FILE')||'./data/restore-transaction.json',backupDir:demo?'./data/demo/backups':value('BACKUP_DIR')||'./data/backups',backupKeepCount:keepCount,backupMaxAgeDays:maxAgeDays,backupIntervalHours:backupHours,recoveryRpoHours,recoveryDrillIntervalDays,recoveryDrillRetryHours,recoveryDrillAuto};
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
    if(config.broadcastToken&&config.broadcastToken.length<24)throw Error('BROADCAST_TOKEN은 사용할 경우 24자 이상으로 설정해 주세요.');
  }
  return config;
}
