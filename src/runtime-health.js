import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'node:path';

const MAX_INCIDENTS=200;
const MAX_AGGREGATES=40;
const REDACT_PATTERNS=[
  /(authorization)\s*[:=]\s*[^,;\n]+/gi,
  /(password|passwd|token|secret|api[-_ ]?key|csrf)\s*[:=]\s*([^\s,;]+)/gi,
  /(Bot\s+)[A-Za-z0-9._-]{20,}/gi
];

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clampText(value,max=320){let text=String(value??'');for(const pattern of REDACT_PATTERNS)text=text.replace(pattern,(_m,key)=>`${key}[REDACTED]`);return text.slice(0,max);}
function errorText(error){let text=String(error?.message||error||'알 수 없는 오류');if(error?.path)text=text.replaceAll(String(error.path),'[PATH]');return clampText(text);}
function fileName(value){try{return path.basename(String(value||''));}catch{return 'data.json';}}
function recent(at,windowMs,now=Date.now()){return Number.isFinite(at)&&now-at<=windowMs;}
function safeNumber(value,digits=1){return Number(finite(value).toFixed(digits));}

export function classifyRuntimeError(error){
  const code=error?.code;
  if(['ENOSPC','EACCES','EPERM','EROFS','EIO','EMFILE','ENFILE'].includes(code))return {status:500,kind:'storage',message:'데이터 저장소에 접근하지 못했습니다. 디스크 용량과 파일 권한을 확인해 주세요.'};
  if(typeof code==='number'||['DiscordAPIError','HTTPError','RateLimitError'].includes(error?.name))return {status:502,kind:'discord',message:'Discord 요청 처리에 실패했습니다. 연결과 봇 권한을 확인해 주세요.'};
  if(error?.statusCode===409)return {status:409,kind:'conflict',message:errorText(error)};
  if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)return {status:error.status,kind:'validation',message:errorText(error)};
  if(error?.type==='entity.parse.failed')return {status:400,kind:'validation',message:'JSON 요청 형식을 확인해 주세요.'};
  if(error?.type==='entity.too.large')return {status:413,kind:'validation',message:'요청 데이터가 너무 큽니다.'};
  if(error instanceof TypeError||error instanceof ReferenceError||error instanceof RangeError)return {status:500,kind:'internal',message:'서버 내부 처리 중 오류가 발생했습니다. Runtime Health에서 장애 기록을 확인해 주세요.'};
  return {status:400,kind:'validation',message:errorText(error)};
}

export class RuntimeHealth {
  constructor({startedAt=Date.now(),maxIncidents=MAX_INCIDENTS}={}){
    this.startedAt=startedAt;this.maxIncidents=maxIncidents;this.auditSink=null;this.incidents=[];
    this.metrics={
      api:{requests:0,errors:0,serverErrors:0,totalMs:0,maxMs:0,last5xxAt:null,byStatus:{}},
      discord:{calls:0,failures:0,totalMs:0,maxMs:0,lastFailureAt:null,byOperation:{}},
      persistence:{writes:0,failures:0,recoveries:0,lastFailureAt:null,lastRecoveryAt:null,byFile:{}},
      sse:{connects:0,disconnects:0,pushes:0,clientReconnects:0,clientErrors:0,staleReports:0,delayReports:0,maxDelayMs:0,lastStaleAt:null},
      ticks:{runs:0,failures:0,totalMs:0,maxMs:0,lastFailureAt:null}
    };
    this.eventLoop=monitorEventLoopDelay({resolution:20});this.eventLoop.enable();
  }
  close(){try{this.eventLoop.disable();}catch{}}
  attachAudit(fn){this.auditSink=typeof fn==='function'?fn:null;return this;}
  seedFromAudit(entries=[]){
    const seeded=[];
    for(const entry of entries){
      if(entry?.category!=='runtime')continue;
      const d=entry.details||{},severity=['info','warn','error'].includes(d.severity)?d.severity:'warn',source=clampText(d.source||'system',40),code=clampText(d.code||entry.action||'runtime',60),summary=clampText(entry.summary||'이전 런타임 이벤트',160);seeded.push({id:entry.id||randomUUID(),key:`${severity}|${source}|${code}|${summary}`,at:finite(entry.at,Date.now()),firstAt:finite(entry.at,Date.now()),lastAt:finite(entry.at,Date.now()),severity,source,code,summary,detail:clampText(d.detail||'',320),count:Math.max(1,finite(d.count,1))});
    }
    this.incidents=[...seeded,...this.incidents].sort((a,b)=>b.lastAt-a.lastAt).slice(0,this.maxIncidents);return this;
  }
  recordIncident({severity='warn',source='system',code='runtime',summary='런타임 이벤트',detail='',at=Date.now(),persist=true}={}){
    severity=['info','warn','error'].includes(severity)?severity:'warn';source=clampText(source,40);code=clampText(code,60);summary=clampText(summary,160);detail=clampText(detail,320);
    const key=`${severity}|${source}|${code}|${summary}`;const existing=this.incidents.find(item=>item.key===key&&at-item.lastAt<60000);
    if(existing){existing.lastAt=at;existing.at=at;existing.count+=1;if(detail)existing.detail=detail;}
    else this.incidents.unshift({id:randomUUID(),key,at,firstAt:at,lastAt:at,severity,source,code,summary,detail,count:1});
    this.incidents.sort((a,b)=>b.lastAt-a.lastAt);this.incidents=this.incidents.slice(0,this.maxIncidents);
    if(persist&&!existing&&severity!=='info'&&source!=='storage'&&this.auditSink){
      Promise.resolve(this.auditSink({category:'runtime',action:code,summary,actor:'system',details:{source,severity,code,detail,count:1}})).catch(()=>{});
    }
  }
  recordApi({method='GET',path='/',status=200,durationMs=0}={}){
    const m=this.metrics.api;m.requests++;m.totalMs+=finite(durationMs);m.maxMs=Math.max(m.maxMs,finite(durationMs));m.byStatus[String(status)]=(m.byStatus[String(status)]||0)+1;
    if(status>=400)m.errors++;if(status>=500){m.serverErrors++;m.last5xxAt=Date.now();this.recordIncident({severity:'error',source:'api',code:`http_${status}`,summary:`API ${status} 오류`,detail:`${clampText(method,12)} ${clampText(path,120)}`});}
  }
  recordDiscord({operation='unknown',ok=true,durationMs=0,error=null,failures=0,total=0}={}){
    const m=this.metrics.discord;m.calls++;m.totalMs+=finite(durationMs);m.maxMs=Math.max(m.maxMs,finite(durationMs));const key=clampText(operation,60);m.byOperation[key]=(m.byOperation[key]||0)+1;
    const failed=!ok||finite(failures)>0;if(failed){m.failures+=Math.max(1,finite(failures,1));m.lastFailureAt=Date.now();this.recordIncident({severity:'warn',source:'discord',code:`discord_${key}`,summary:`Discord 작업 실패 · ${key}`,detail:total?`${failures}/${total} 실패 · ${errorText(error)}`:errorText(error)});}
  }
  recordPersistence(event={}){
    const m=this.metrics.persistence,type=event.type,file=fileName(event.file),bucket=m.byFile[file]||(m.byFile[file]={writes:0,failures:0,recoveries:0});
    if(type==='write-success'){m.writes++;bucket.writes++;return;}
    if(type==='recovery'){m.recoveries++;bucket.recoveries++;m.lastRecoveryAt=Date.now();this.recordIncident({severity:'warn',source:'storage',code:'backup_recovery',summary:`백업에서 자동 복구 · ${file}`,detail:clampText(event.detail||'손상된 원본을 보존하고 .bak 파일에서 복구했습니다.')});return;}
    if(type==='write-failure'||type==='read-failure'){m.failures++;bucket.failures++;m.lastFailureAt=Date.now();this.recordIncident({severity:'error',source:'storage',code:type.replace('-','_'),summary:`데이터 ${type==='write-failure'?'저장':'읽기'} 실패 · ${file}`,detail:errorText(event.error)});}
  }
  recordSse(type,data={}){
    const m=this.metrics.sse;if(type==='connect')m.connects++;else if(type==='disconnect')m.disconnects++;else if(type==='push')m.pushes++;else if(type==='client-reconnect')m.clientReconnects++;else if(type==='client-error')m.clientErrors++;else if(type==='stale'){m.staleReports++;m.lastStaleAt=Date.now();this.recordIncident({severity:'warn',source:'sse',code:'sse_stale',summary:'실시간 대시보드 연결 지연 감지',detail:data.delayMs?`약 ${Math.round(data.delayMs)}ms 지연 보고`:'클라이언트가 45초 이상 이벤트를 받지 못했습니다.'});}else if(type==='delay'){m.delayReports++;m.maxDelayMs=Math.max(m.maxDelayMs,finite(data.delayMs));}
  }
  recordTick({ok=true,durationMs=0,error=null}={}){const m=this.metrics.ticks;m.runs++;m.totalMs+=finite(durationMs);m.maxMs=Math.max(m.maxMs,finite(durationMs));if(!ok){m.failures++;m.lastFailureAt=Date.now();this.recordIncident({severity:'warn',source:'scheduler',code:'tick_failure',summary:'자동 운영 타이머 처리 실패',detail:errorText(error)});}}
  status(now=Date.now()){
    const m=this.metrics,p95=this.eventLoop.count?this.eventLoop.percentile(95)/1e6:0;
    if(recent(m.persistence.lastFailureAt,10*60*1000,now)||recent(m.api.last5xxAt,5*60*1000,now))return 'fail';
    if(recent(m.discord.lastFailureAt,10*60*1000,now)||recent(m.sse.lastStaleAt,10*60*1000,now)||p95>200)return 'warn';
    return 'pass';
  }
  snapshot({liveClients=0,version='unknown',revision=0,recovered=false}={}){
    const now=Date.now(),memory=process.memoryUsage(),loopCount=this.eventLoop.count||0,p95=loopCount?this.eventLoop.percentile(95)/1e6:0,mean=loopCount?this.eventLoop.mean/1e6:0,max=loopCount?this.eventLoop.max/1e6:0,m=this.metrics;
    const status=this.status(now),apiAvg=m.api.requests?m.api.totalMs/m.api.requests:0,discordAvg=m.discord.calls?m.discord.totalMs/m.discord.calls:0,tickAvg=m.ticks.runs?m.ticks.totalMs/m.ticks.runs:0;
    return {status,checkedAt:now,startedAt:this.startedAt,uptimeMs:Math.max(0,now-this.startedAt),version,revision,recovered:Boolean(recovered),memory:{rss:memory.rss,heapUsed:memory.heapUsed,heapTotal:memory.heapTotal,external:memory.external},eventLoop:{p95Ms:safeNumber(p95),meanMs:safeNumber(mean),maxMs:safeNumber(max)},api:{...m.api,avgMs:safeNumber(apiAvg),errorRate:m.api.requests?safeNumber((m.api.errors/m.api.requests)*100,2):0},discord:{...m.discord,avgMs:safeNumber(discordAvg)},persistence:{...m.persistence},sse:{...m.sse,liveClients},ticks:{...m.ticks,avgMs:safeNumber(tickAvg)},incidents:this.incidents.map(({key,...item})=>item).slice(0,100)};
  }
  diagnosticBundle({config={},liveClients=0,version='unknown',revision=0,recovered=false,selfCheck=null,safeDeploy=null,performance=null}={}){
    const runtime=this.snapshot({liveClients,version,revision,recovered});
    return {format:'daengdaeng-runtime-diagnostics-v1',exportedAt:new Date().toISOString(),runtime,environment:{node:process.version,platform:process.platform,arch:process.arch},configuration:{host:clampText(config.host||'',80),port:finite(config.port),demo:Boolean(config.demo),guildConfigured:Boolean(config.guildId),adminRoleConfigured:Boolean(config.adminRoleId),broadcastTokenConfigured:Boolean(config.broadcastToken)},selfCheck:selfCheck?{ok:Boolean(selfCheck.ok),counts:selfCheck.counts,checks:(selfCheck.checks||[]).map(c=>({id:clampText(c.id,60),label:clampText(c.label,120),status:c.status,detail:clampText(c.detail,240)}))}:null,safeDeploy:safeDeploy?{version:safeDeploy.version,dataSchemaVersion:safeDeploy.dataSchemaVersion,currentSchema:safeDeploy.currentSchema,appVersion:safeDeploy.appVersion,migration:safeDeploy.migration,update:safeDeploy.update?{previousVersion:safeDeploy.update.previousVersion,version:safeDeploy.update.version,updatedAt:safeDeploy.update.updatedAt,postUpdateCheck:safeDeploy.update.postUpdateCheck}:null}:null,performance:performance?{status:performance.status,checkedAt:performance.checkedAt,signals:performance.signals,trend:{memory:performance.trend?.memory,api:performance.trend?.api},capacity:performance.capacity,recommendations:performance.recommendations}:null};
  }
}
