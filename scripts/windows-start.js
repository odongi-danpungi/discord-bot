import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ensureDependencies, supportedNode } from './dependencies.js';
import readline from 'node:readline';
import { atomicWriteFile } from '../src/atomic-file.js';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));

const CONFIG_KEYS=[
  'DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID','DASHBOARD_USER','DASHBOARD_PASSWORD','BROADCAST_TOKEN',
  'HOST','PORT','ADMIN_ROLE_ID','VIEWER_URL','DATA_FILE','OPERATIONS_FILE','RECOVERY_FILE','DISCORD_POLICY_FILE',
  'INCIDENT_WORKFLOW_FILE','RESTORE_TRANSACTION_FILE','BACKUP_DIR','BACKUP_KEEP_COUNT','BACKUP_MAX_AGE_DAYS',
  'BACKUP_INTERVAL_HOURS','RECOVERY_RPO_HOURS','RECOVERY_DRILL_AUTO','RECOVERY_DRILL_INTERVAL_DAYS',
  'RECOVERY_DRILL_RETRY_HOURS','APP_PROFILE'
];

function ask(label,defaultValue='') {
  return new Promise(resolve=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});
    const suffix=defaultValue?` [${defaultValue}]`:'';
    rl.question(`${label}${suffix}: `,answer=>{rl.close();resolve(answer.trim()||defaultValue)});
  });
}

function secret(label,{allowEmpty=false}={}) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw Error('Windows 터미널에서 START.cmd 또는 SETTINGS.cmd를 실행해 주세요.');
  return new Promise(resolve => {
    let value=''; process.stdout.write(label+': ');
    readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    const finish=()=>{process.stdin.removeListener('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value)};
    const onKey=(text,key={})=>{
      if(key.ctrl&&key.name==='c'){process.stdin.setRawMode(false);process.exit(130)}
      if(key.name==='return'){if(value||allowEmpty)finish();return}
      if(key.name==='backspace'){if(value){value=value.slice(0,-1);process.stdout.write('\b \b')}return}
      if(text&&!key.ctrl&&!key.meta&&!/[\x00-\x1f\x7f]/.test(text)){value+=text;process.stdout.write('*'.repeat(text.length))}
    };
    process.stdin.on('keypress',onKey);
  });
}

async function readLocalConfig(){
  try{return JSON.parse(await fs.readFile('config.local.json','utf8'));}
  catch(error){if(error.code==='ENOENT')return {};throw Error('config.local.json을 읽지 못했습니다. 파일 형식을 확인해 주세요.');}
}

async function configure(previous={}){
  const hasToken=typeof previous.DISCORD_TOKEN==='string'&&previous.DISCORD_TOKEN.length>=30;
  const hasPassword=typeof previous.DASHBOARD_PASSWORD==='string'&&previous.DASHBOARD_PASSWORD.length>=12;
  console.log(previous.DISCORD_CLIENT_ID?'댕댕봇 설정 수정 · Enter를 누르면 기존 일반 설정을 유지합니다.':'댕댕봇 첫 실행 설정');
  console.log('비밀값은 화면에 표시하지 않으며 config.local.json에만 저장합니다. 이 파일은 공유하지 마세요.');

  let clientId=previous.DISCORD_CLIENT_ID||'';
  while(!/^\d{17,20}$/.test(clientId)){clientId=await ask('Discord 애플리케이션 ID',clientId);if(!/^\d{17,20}$/.test(clientId))console.log('17~20자리 숫자 ID를 입력해 주세요.');}
  let guildId=previous.DISCORD_GUILD_ID||'';
  while(!/^\d{17,20}$/.test(guildId)){guildId=await ask('Discord 서버 ID',guildId);if(!/^\d{17,20}$/.test(guildId))console.log('17~20자리 숫자 ID를 입력해 주세요.');}

  let token='';
  while(!/^[A-Za-z0-9._-]{30,}$/.test(token)){
    const entered=(await secret(hasToken?'봇 토큰 (Enter = 기존 값 유지)':'봇 토큰',{allowEmpty:hasToken})).trim();
    token=entered||previous.DISCORD_TOKEN||'';
    if(!/^[A-Za-z0-9._-]{30,}$/.test(token))console.log('토큰을 다시 확인해 주세요.');
  }

  let password='',passwordChanged=false;
  while(password.length<12){
    const entered=await secret(hasPassword?'대시보드 비밀번호 (Enter = 기존 값 유지)':'대시보드 비밀번호 (12자 이상)',{allowEmpty:hasPassword});
    password=entered||previous.DASHBOARD_PASSWORD||'';passwordChanged=Boolean(entered);
    if(password.length<12)console.log('12자 이상 입력해 주세요.');
  }
  if(passwordChanged||!hasPassword){
    let confirmation=await secret('대시보드 비밀번호 확인');
    while(confirmation!==password){console.log('비밀번호가 일치하지 않습니다. 다시 입력해 주세요.');confirmation=await secret('대시보드 비밀번호 확인');}
  }

  const config={
    ...previous,
    DISCORD_TOKEN:token,
    DISCORD_CLIENT_ID:clientId,
    DISCORD_GUILD_ID:guildId,
    DASHBOARD_USER:previous.DASHBOARD_USER||'admin',
    DASHBOARD_PASSWORD:password,
    BROADCAST_TOKEN:previous.BROADCAST_TOKEN||randomBytes(24).toString('base64url'),
    HOST:previous.HOST||'127.0.0.1',
    PORT:previous.PORT||'3000',
    ADMIN_ROLE_ID:previous.ADMIN_ROLE_ID||'',
    VIEWER_URL:previous.VIEWER_URL||'',
    DATA_FILE:previous.DATA_FILE||'./data/registrations.json',
    OPERATIONS_FILE:previous.OPERATIONS_FILE||'./data/operations.json',
    RECOVERY_FILE:previous.RECOVERY_FILE||'./data/recovery.json',
    DISCORD_POLICY_FILE:previous.DISCORD_POLICY_FILE||'./data/discord-policy.json',
    INCIDENT_WORKFLOW_FILE:previous.INCIDENT_WORKFLOW_FILE||'./data/incidents.json',
    RESTORE_TRANSACTION_FILE:previous.RESTORE_TRANSACTION_FILE||'./data/restore-transaction.json',
    BACKUP_DIR:previous.BACKUP_DIR||'./data/backups',
    BACKUP_KEEP_COUNT:previous.BACKUP_KEEP_COUNT||14,
    BACKUP_MAX_AGE_DAYS:previous.BACKUP_MAX_AGE_DAYS||30,
    BACKUP_INTERVAL_HOURS:previous.BACKUP_INTERVAL_HOURS||24,
    RECOVERY_RPO_HOURS:previous.RECOVERY_RPO_HOURS||24,
    RECOVERY_DRILL_AUTO:previous.RECOVERY_DRILL_AUTO??true,
    RECOVERY_DRILL_INTERVAL_DAYS:previous.RECOVERY_DRILL_INTERVAL_DAYS||7,
    RECOVERY_DRILL_RETRY_HOURS:previous.RECOVERY_DRILL_RETRY_HOURS||6,
    APP_PROFILE:previous.APP_PROFILE||'production'
  };
  await atomicWriteFile('config.local.json',JSON.stringify(config,null,2)+'\n',{mode:0o600});
  console.log('설정을 저장했습니다. config.local.json은 ZIP/Git/채팅에 올리지 마세요.');
  console.log(`서버 ${guildId} · 대시보드 http://${config.HOST}:${config.PORT} · 자동 복구 훈련 ${config.RECOVERY_DRILL_AUTO?'ON':'OFF'}`);
  return config;
}

try {
  if(!supportedNode())throw Error('Node.js 22.22.2 이상을 설치해 주세요. Node.js 24 LTS도 지원합니다.');
  const demo=process.argv.includes('--demo'),dev=process.argv.includes('--dev'),configureOnly=process.argv.includes('--configure');
  let config=demo?{}:await readLocalConfig();
  if(!demo&&(!Object.keys(config).length||configureOnly))config=await configure(config);
  if(configureOnly){console.log('설정 수정이 끝났습니다. START.cmd로 실행하세요.');process.exit(0);}

  await ensureDependencies();
  console.log(demo?'연습 모드 시작 중…':dev?'개발 프로필 시작 중… 대시보드 아이디는 '+(config.DASHBOARD_USER||'admin')+'입니다.':'프로덕션 프로필 시작 중… 대시보드 아이디는 '+(config.DASHBOARD_USER||'admin')+'입니다. 종료하려면 Ctrl+C를 누르세요.');
  const env=Object.fromEntries(CONFIG_KEYS.filter(key=>config[key]!==undefined).map(key=>[key,String(config[key])]));
  const child=spawn(process.execPath,['src/index.js',...(demo?['--demo']:dev?['--dev']:[])],{stdio:['inherit','pipe','pipe'],env:{...process.env,...env}});
  const secrets=[config.DISCORD_TOKEN,config.DASHBOARD_PASSWORD,config.BROADCAST_TOKEN].filter(Boolean);
  const redact=text=>secrets.reduce((s,v)=>s.split(v).join('[숨김]'),text);
  let opened=false;
  readline.createInterface({input:child.stdout}).on('line',line=>{
    console.log(redact(line));
    if(!opened&&/^Dashboard: http:\/\/127\.0\.0\.1:\d+$/.test(line)){opened=true;if(process.platform==='win32')spawn('explorer.exe',[line.slice('Dashboard: '.length)],{stdio:'ignore'}).on('error',()=>{});}
  });
  readline.createInterface({input:child.stderr}).on('line',line=>console.error(redact(line)));
  child.on('error',()=>{console.error('봇을 시작하지 못했습니다.');process.exitCode=1});
  child.on('exit',code=>{process.exitCode=code??1});
  process.on('SIGINT',()=>child.kill('SIGINT'));
} catch(e){console.error(e.message);process.exitCode=1}
