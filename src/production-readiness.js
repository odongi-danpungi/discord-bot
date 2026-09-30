import { access, mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { APP_VERSION, DATA_SCHEMA_VERSION } from './version.js';
import { atomicWriteFile } from './durable-file.js';

const DAY=24*60*60*1000;
const MB=1024*1024;
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost','::1']);
const statusRank={pass:0,warn:1,fail:2};
const maxStatus=(...values)=>values.reduce((worst,value)=>statusRank[value]>statusRank[worst]?value:worst,'pass');
const finite=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const text=(value,max=180)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export function versionAtLeast(actual,minimum){
  const a=String(actual).replace(/^v/,'').split('.').map(Number),m=String(minimum).replace(/^v/,'').split('.').map(Number);
  for(let i=0;i<3;i++){if((a[i]||0)>(m[i]||0))return true;if((a[i]||0)<(m[i]||0))return false;}return true;
}

export async function probePort(host,port){
  return await new Promise(resolve=>{
    const server=createServer();let settled=false;
    const done=(result)=>{if(settled)return;settled=true;try{server.close(()=>resolve(result));}catch{resolve(result)}};
    server.once('error',error=>done({ok:false,code:error?.code||'UNKNOWN',message:error?.message||'포트 확인 실패'}));
    server.listen({host,port,exclusive:true},()=>done({ok:true}));
  });
}

async function probeDirectory(dir){
  const absolute=path.resolve(dir),probe=path.join(absolute,`.daengdaeng-write-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try{await mkdir(absolute,{recursive:true});await access(absolute,fsConstants.R_OK|fsConstants.W_OK);await writeFile(probe,'ok',{mode:0o600});await rm(probe,{force:true});return {ok:true,path:absolute};}
  catch(error){await rm(probe,{force:true}).catch(()=>{});return {ok:false,path:absolute,code:error?.code||'UNKNOWN'};}
}

async function diskSpace(dir){
  try{const info=await statfs(path.resolve(dir));return {ok:true,freeBytes:Number(info.bavail)*Number(info.bsize),totalBytes:Number(info.blocks)*Number(info.bsize)};}catch{return {ok:false,freeBytes:0,totalBytes:0};}
}

export async function runStartupPreflight({config,checkPort=true,nodeVersion=process.version,minNode='22.22.2'}={}){
  const checks=[];const add=(id,label,status,detail)=>checks.push({id,label,status,detail});
  const nodeOk=versionAtLeast(nodeVersion,minNode);add('node','Node.js 런타임',nodeOk?'pass':'fail',`${nodeVersion} · 최소 ${minNode}`);
  add('profile','실행 프로필',['production','development','demo'].includes(config.profile)?'pass':'fail',config.profile||'미설정');
  const local=LOCAL_HOSTS.has(config.host);add('host','대시보드 바인딩',local?'pass':config.profile==='production'?'warn':'warn',local?`${config.host} · 로컬 전용`:`${config.host} · 외부 네트워크 노출`);
  if(!local){const tokenOk=String(config.broadcastToken||'').length>=24;add('broadcast-token','외부 방송 화면 보호',tokenOk?'pass':'fail',tokenOk?'BROADCAST_TOKEN 24자 이상 설정됨':'외부 바인딩에서는 BROADCAST_TOKEN을 24자 이상 설정해야 합니다.');}
  if(config.profile==='production'){const passwordOk=String(config.dashboardPassword||'').length>=12;add('dashboard-auth','관리자 인증',passwordOk?'pass':'fail',passwordOk?'대시보드 비밀번호 정책 충족':'DASHBOARD_PASSWORD를 12자 이상 설정하세요.');}
  const dirs=[...new Set([path.dirname(config.dataFile),path.dirname(config.operationsFile),path.dirname(config.recoveryFile),config.discordPolicyFile?path.dirname(config.discordPolicyFile):null,config.incidentWorkflowFile?path.dirname(config.incidentWorkflowFile):null,config.idempotencyFile?path.dirname(config.idempotencyFile):null,config.backupDir].filter(Boolean))];
  for(const [index,dir] of dirs.entries()){const result=await probeDirectory(dir);add(`write-${index}`,'데이터 경로 쓰기',result.ok?'pass':'fail',result.ok?`${path.basename(result.path)||result.path} · 쓰기 가능`:`${path.basename(result.path)||result.path} · ${result.code}`);}
  const disk=await diskSpace(config.backupDir);if(disk.ok){const status=disk.freeBytes<100*MB?'fail':disk.freeBytes<500*MB?'warn':'pass';add('disk','백업 디스크 여유',status,`${Math.round(disk.freeBytes/MB)}MB 사용 가능`);}else add('disk','백업 디스크 여유','warn','파일 시스템 여유 공간을 확인하지 못했습니다.');
  if(checkPort){const port=await probePort(config.host,config.port);add('port','대시보드 포트',port.ok?'pass':'fail',port.ok?`${config.host}:${config.port} 사용 가능`:`${config.host}:${config.port} · ${port.code}`);}
  const counts={pass:checks.filter(c=>c.status==='pass').length,warn:checks.filter(c=>c.status==='warn').length,fail:checks.filter(c=>c.status==='fail').length};
  return {ok:counts.fail===0,status:counts.fail?'fail':counts.warn?'warn':'pass',checkedAt:Date.now(),profile:config.profile,checks,counts};
}

export class BackupRetention {
  constructor({dir='./data/backups',keepCount=14,maxAgeDays=30,minimumIntervalHours=24}={}){
    this.dir=path.resolve(dir);this.keepCount=Math.max(1,Math.min(90,finite(keepCount,14)));this.maxAgeDays=Math.max(1,Math.min(365,finite(maxAgeDays,30)));this.minimumIntervalMs=Math.max(1,Math.min(168,finite(minimumIntervalHours,24)))*60*60*1000;
  }
  async init(){await mkdir(this.dir,{recursive:true});return this;}
  async list(){
    await this.init();const entries=await readdir(this.dir,{withFileTypes:true});const items=[];
    for(const entry of entries){if(!entry.isFile()||!/^daengdaeng-(auto|manual)-.+\.json$/.test(entry.name))continue;try{const info=await stat(path.join(this.dir,entry.name));items.push({file:entry.name,bytes:info.size,createdAt:info.mtimeMs,type:entry.name.startsWith('daengdaeng-auto-')?'auto':'manual'});}catch{}}
    return items.sort((a,b)=>b.createdAt-a.createdAt);
  }
  async prune(now=Date.now()){
    const items=await this.list(),remove=[];
    for(let i=0;i<items.length;i++){const item=items[i],tooMany=i>=this.keepCount,tooOld=now-item.createdAt>this.maxAgeDays*DAY;if((tooMany||tooOld)&&i>0)remove.push(item);}
    for(const item of remove)await rm(path.join(this.dir,item.file),{force:true});
    return {removed:remove.map(item=>item.file),remaining:(await this.list()).length};
  }
  async create({guildId,records,operations,type='manual',now=Date.now()}={}){
    if(!['auto','manual'].includes(type))throw Error('백업 종류를 확인해 주세요.');
    await this.init();const stamp=new Date(now).toISOString().replace(/[:.]/g,'-'),name=`daengdaeng-${type}-${stamp}.json`,file=path.join(this.dir,name),temporary=file+'.tmp';
    const bundle={version:2,guildId,exportedAt:new Date(now).toISOString(),appVersion:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION,records:structuredClone(records||[]),operations:structuredClone(operations||{})};
    await atomicWriteFile(file,JSON.stringify(bundle,null,2)+'\n',{mode:0o600,temporary});await this.prune(now);const info=await stat(file);return {file:name,bytes:info.size,createdAt:now,type};
  }
  async ensureRecent(payload,now=Date.now()){
    await this.prune(now);
    const items=await this.list(),latest=items[0];if(latest&&now-latest.createdAt<this.minimumIntervalMs)return {created:false,latest};
    const created=await this.create({...payload,type:'auto',now});return {created:true,latest:created};
  }
  async summary(now=Date.now()){
    const items=await this.list(),latest=items[0]||null;return {dir:path.basename(this.dir),keepCount:this.keepCount,maxAgeDays:this.maxAgeDays,minimumIntervalHours:Math.round(this.minimumIntervalMs/3600000),count:items.length,latest,latestAgeMs:latest?Math.max(0,now-latest.createdAt):null,totalBytes:items.reduce((sum,item)=>sum+item.bytes,0),items:items.slice(0,20)};
  }
}

export class SoakTestRunner {
  constructor({sampleProvider,intervalMs=5000}={}){this.sampleProvider=sampleProvider;this.intervalMs=Math.max(1000,finite(intervalMs,5000));this.timer=null;this.state=this.empty();}
  empty(){return {status:'idle',startedAt:null,endsAt:null,finishedAt:null,durationMinutes:0,samples:0,start:null,last:null,max:{rss:0,loopP95Ms:0,apiErrors:0,serverErrors:0,persistenceFailures:0},result:null};}
  snapshot(){return structuredClone(this.state);}
  async collect(){
    if(this.state.status!=='running')return;const sample=await this.sampleProvider();if(this.state.status!=='running')return;
    const view={at:Date.now(),rss:finite(sample.memory?.rss),loopP95Ms:finite(sample.eventLoop?.p95Ms),apiErrors:finite(sample.api?.errors),serverErrors:finite(sample.api?.serverErrors),persistenceFailures:finite(sample.persistence?.failures)};
    if(!this.state.start)this.state.start=view;this.state.last=view;this.state.samples++;for(const key of Object.keys(this.state.max))this.state.max[key]=Math.max(this.state.max[key],view[key]||0);
    if(Date.now()>=this.state.endsAt)this.finish('completed');
  }
  start(minutes=10){
    if(this.state.status==='running')throw Error('Soak Test가 이미 실행 중입니다.');minutes=Math.max(1,Math.min(60,Math.round(finite(minutes,10))));const now=Date.now();this.state={...this.empty(),status:'running',startedAt:now,endsAt:now+minutes*60000,durationMinutes:minutes};this.collect().catch(()=>{});this.timer=setInterval(()=>this.collect().catch(()=>{}),this.intervalMs);this.timer.unref?.();return this.snapshot();
  }
  finish(reason='stopped'){
    if(this.timer)clearInterval(this.timer);this.timer=null;if(this.state.status!=='running')return this.snapshot();const start=this.state.start,last=this.state.last,apiDelta=Math.max(0,(last?.apiErrors||0)-(start?.apiErrors||0)),serverDelta=Math.max(0,(last?.serverErrors||0)-(start?.serverErrors||0)),storageDelta=Math.max(0,(last?.persistenceFailures||0)-(start?.persistenceFailures||0)),rssDelta=(last?.rss||0)-(start?.rss||0);const status=serverDelta>0||storageDelta>0?'fail':apiDelta>0||this.state.max.loopP95Ms>=150?'warn':'pass';this.state.status=reason==='completed'?status:'stopped';this.state.finishedAt=Date.now();this.state.result={reason,status,apiErrorDelta:apiDelta,serverErrorDelta:serverDelta,persistenceFailureDelta:storageDelta,rssDeltaBytes:rssDelta,maxLoopP95Ms:this.state.max.loopP95Ms};return this.snapshot();
  }
  stop(){return this.finish('stopped');}
  close(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}

export function buildDeploymentReadiness({config,preflight,selfCheck,runtime,capacity,backup,soak,incidents=null,environmentValidation=null,now=Date.now()}={}){
  const checks=[];const add=(id,label,status,detail)=>checks.push({id,label,status,detail});
  for(const check of preflight?.checks||[])add(`preflight-${check.id}`,check.label,check.status,check.detail);
  if(environmentValidation){const e=environmentValidation;add('environment-validation','Production Secrets & Environment',e.launchable?(e.status==='pass'?'pass':'warn'):'fail',e.summary||'환경 설정 검증 상태를 확인하세요.');}
  const self=selfCheck?.counts||{warn:0,fail:0};add('self-check','운영 Self-Check',self.fail?'fail':self.warn?'warn':'pass',self.fail?`오류 ${self.fail}건`:self.warn?`경고 ${self.warn}건`:'오류·경고 없음');
  add('runtime','Runtime Health',runtime?.status==='fail'?'fail':runtime?.status==='warn'?'warn':'pass',runtime?.status||'확인 안 됨');
  add('capacity','Performance & Capacity',capacity?.status==='fail'?'fail':capacity?.status==='warn'?'warn':'pass',capacity?.status||'확인 안 됨');
  if(incidents){const c=incidents.counts||{};add('incidents','Incident Workflow',Number(c.critical)>0?'fail':Number(c.open)>0?'warn':'pass',Number(c.critical)>0?`CRITICAL ${c.critical}건 · 미확인 ${c.open||0}건`:Number(c.open)>0?`미확인 ${c.open}건`:'미해결 긴급 장애 없음');}
  const backupRecent=backup?.latest&&backup.latestAgeMs<=48*60*60*1000;add('backup','최근 자동/수동 백업',backupRecent?'pass':backup?.latest?'warn':'fail',backup?.latest?`${Math.round(backup.latestAgeMs/3600000)}시간 전 · ${backup.latest.file}`:'보관된 배포 백업이 없습니다.');
  const soakStatus=soak?.status,stoppedResult=soakStatus==='stopped'?soak?.result?.status:null,effectiveSoak=stoppedResult==='fail'?'fail':stoppedResult==='warn'?'warn':soakStatus;
  add('soak','장시간 Soak Test',effectiveSoak==='pass'?'pass':effectiveSoak==='fail'?'fail':'warn',soakStatus==='running'?`진행 중 · ${soak.samples||0}개 샘플`:effectiveSoak==='pass'?'최근 테스트 통과':effectiveSoak==='fail'?'중지된 테스트에서 오류 감지':effectiveSoak==='warn'?'최근 테스트 경고':'아직 완료된 테스트 없음');
  if(config.profile!=='production')add('profile-production','Production 프로필',config.profile==='demo'?'warn':'warn',`${config.profile} 프로필 · 실제 배포 전 production으로 실행하세요.`);else add('profile-production','Production 프로필','pass','production');
  const status=checks.some(c=>c.status==='fail')?'fail':checks.some(c=>c.status==='warn')?'warn':'pass';const counts={pass:checks.filter(c=>c.status==='pass').length,warn:checks.filter(c=>c.status==='warn').length,fail:checks.filter(c=>c.status==='fail').length};
  return {status,checkedAt:now,profile:config.profile,checks,counts,summary:status==='pass'?'배포 전 필수 점검을 통과했습니다.':status==='warn'?'배포 전 확인할 경고 항목이 있습니다.':'배포 전에 해결해야 할 오류 항목이 있습니다.'};
}
