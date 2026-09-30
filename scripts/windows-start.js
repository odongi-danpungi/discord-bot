import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ensureDependencies, supportedNode } from './dependencies.js';
import readline from 'node:readline';
import { atomicWriteFile } from '../src/durable-file.js';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
function ask(label,defaultValue='') {
  return new Promise(resolve=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});
    const suffix=defaultValue?` [${defaultValue}]`:'';
    rl.question(`${label}${suffix}: `,answer=>{rl.close();resolve(answer.trim()||defaultValue)});
  });
}
function secret(label) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw Error('Windows 터미널에서 START.cmd를 실행해 주세요.');
  return new Promise(resolve => {
    let value=''; process.stdout.write(label+': ');
    readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    const onKey=(text,key={})=>{
      if(key.ctrl&&key.name==='c'){process.stdin.setRawMode(false);process.exit(130)}
      if(key.name==='return'){process.stdin.removeListener('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value);return}
      if(key.name==='backspace'){if(value){value=value.slice(0,-1);process.stdout.write('\b \b')}return}
      if(text&&!key.ctrl&&!key.meta&&!/[\x00-\x1f\x7f]/.test(text)){value+=text;process.stdout.write('*'.repeat(text.length))}
    };
    process.stdin.on('keypress',onKey);
  });
}
try {
  if(!supportedNode())throw Error('Node.js 22.22.2 이상 또는 Node.js 24 LTS를 설치해 주세요.');
  const demo=process.argv.includes('--demo'),dev=process.argv.includes('--dev'),configure=process.argv.includes('--configure');
  const file='config.local.json';
  let config,previous={};
  if(configure)try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
  try { if(demo){config={};}else if(configure){throw Object.assign(Error('configure'),{code:'ENOENT'});}else config=JSON.parse(await fs.readFile(file,'utf8')); }
  catch(e) {
    if(e.code!=='ENOENT')throw Error('config.local.json을 읽지 못했습니다. 파일 형식을 확인해 주세요.');
    console.log('댕댕봇 첫 실행 설정 · 입력한 비밀값은 화면에 표시되지 않습니다.');
    console.log('Discord 개발자 포털 → 댕댕봇 → 봇에서 준비한 토큰을 입력하세요.');
    let clientId=previous.DISCORD_CLIENT_ID||'';while(!/^\d{17,20}$/.test(clientId)){clientId=await ask('Discord 애플리케이션 ID',clientId);if(!/^\d{17,20}$/.test(clientId))console.log('17~20자리 숫자 ID를 입력해 주세요.');}
    let guildId=previous.DISCORD_GUILD_ID||'';while(!/^\d{17,20}$/.test(guildId)){guildId=await ask('Discord 서버 ID',guildId);if(!/^\d{17,20}$/.test(guildId))console.log('17~20자리 숫자 ID를 입력해 주세요.');}
    let token='';while(!/^[A-Za-z0-9._-]{30,}$/.test(token)){token=(await secret('봇 토큰')).trim();if(!/^[A-Za-z0-9._-]{30,}$/.test(token))console.log('토큰을 다시 확인해 주세요.');}
    let password='';while(password.length<12){password=await secret('대시보드 비밀번호 (12자 이상)');if(password.length<12)console.log('12자 이상 입력해 주세요.');}
    config={...previous,DISCORD_TOKEN:token,DISCORD_CLIENT_ID:clientId,DISCORD_GUILD_ID:guildId,DASHBOARD_USER:previous.DASHBOARD_USER||'admin',DASHBOARD_PASSWORD:password,BROADCAST_TOKEN:previous.BROADCAST_TOKEN||randomBytes(24).toString('base64url'),HOST:previous.HOST||'127.0.0.1',PORT:previous.PORT||'3000',APP_PROFILE:previous.APP_PROFILE||'production',BACKUP_DIR:previous.BACKUP_DIR||'./data/backups',BACKUP_KEEP_COUNT:previous.BACKUP_KEEP_COUNT||14,BACKUP_MAX_AGE_DAYS:previous.BACKUP_MAX_AGE_DAYS||30,BACKUP_INTERVAL_HOURS:previous.BACKUP_INTERVAL_HOURS||24};
    let confirmation=await secret('대시보드 비밀번호 확인');
    while(confirmation!==password){console.log('비밀번호가 일치하지 않습니다. 다시 입력해 주세요.');confirmation=await secret('대시보드 비밀번호 확인');}
    await atomicWriteFile(file,JSON.stringify(config,null,2),{mode:0o600,temporary:file+'.tmp'});
    console.log('설정을 저장했습니다. config.local.json은 공유하지 마세요.');
  }
  await ensureDependencies();
  console.log(demo?'연습 모드 시작 중…':dev?'개발 프로필 시작 중… 대시보드 아이디는 '+(config.DASHBOARD_USER||'admin')+'입니다.':'프로덕션 프로필 시작 중… 대시보드 아이디는 '+(config.DASHBOARD_USER||'admin')+'입니다. 종료하려면 Ctrl+C를 누르세요.');
  const keys=['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID','DASHBOARD_USER','DASHBOARD_PASSWORD','DASHBOARD_OPERATOR_USER','DASHBOARD_OPERATOR_PASSWORD','DASHBOARD_OPERATOR_CAPABILITIES','BROADCAST_TOKEN','HOST','PORT','ADMIN_ROLE_ID','VIEWER_URL','DATA_FILE','OPERATIONS_FILE','RECOVERY_FILE','BACKUP_DIR','BACKUP_KEEP_COUNT','BACKUP_MAX_AGE_DAYS','BACKUP_INTERVAL_HOURS','APP_PROFILE'];
  const env=Object.fromEntries(keys.filter(key=>config[key]!==undefined).map(key=>[key,String(config[key])]));
  const child=spawn(process.execPath,['src/index.js',...(demo?['--demo']:dev?['--dev']:[])],{stdio:['inherit','pipe','pipe'],env:{...process.env,...env}});
  const secrets=[config.DISCORD_TOKEN,config.DASHBOARD_PASSWORD,config.DASHBOARD_OPERATOR_PASSWORD,config.BROADCAST_TOKEN].filter(Boolean);
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
