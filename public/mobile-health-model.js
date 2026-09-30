const number=value=>Number.isFinite(Number(value))?Number(value):0;
const STATUS_LABELS={pass:'정상',warn:'주의',warning:'주의',fail:'오류',critical:'긴급',idle:'대기',unknown:'확인 필요'};
const SEVERITY_RANK={critical:3,warning:2,info:1};

export function mobileHealthStatusLabel(value){return STATUS_LABELS[String(value||'').toLowerCase()]||String(value||'확인 필요');}

export function formatMobileUptime(ms){
  let sec=Math.max(0,Math.floor(number(ms)/1000));const days=Math.floor(sec/86400);sec%=86400;const hours=Math.floor(sec/3600);sec%=3600;const minutes=Math.floor(sec/60);
  return days?`${days}일 ${hours}시간`:hours?`${hours}시간 ${minutes}분`:`${minutes}분`;
}

export function formatMobileBytes(value){
  const n=Math.max(0,number(value));if(n<1024)return `${Math.round(n)} B`;if(n<1024**2)return `${(n/1024).toFixed(1)} KB`;if(n<1024**3)return `${(n/1024**2).toFixed(1)} MB`;return `${(n/1024**3).toFixed(2)} GB`;
}

function normalizeService(service={},fallback='unknown'){
  const status=['pass','warn','fail','idle','unknown'].includes(service.status)?service.status:fallback;
  return {status,label:String(service.label||''),detail:String(service.detail||''),lastRunAt:number(service.lastRunAt),failures:Math.max(0,number(service.failures)),enabled:service.enabled!==false};
}

export function buildMobileHealthModel(payload={},now=Date.now()){
  const runtime=payload.runtime&&typeof payload.runtime==='object'?payload.runtime:{};
  const workflow=payload.incidentWorkflow&&typeof payload.incidentWorkflow==='object'?payload.incidentWorkflow:{};
  const access=payload.access||{};
  const incidents=(Array.isArray(workflow.incidents)?workflow.incidents:[]).map(item=>({...item,occurrences:Math.max(1,number(item.occurrences)),lastSeenAt:number(item.lastSeenAt),openedAt:number(item.openedAt)})).sort((a,b)=>{
    const activeA=['open','acknowledged'].includes(a.status)?0:1,activeB=['open','acknowledged'].includes(b.status)?0:1;if(activeA!==activeB)return activeA-activeB;
    const severity=(SEVERITY_RANK[b.severity]||0)-(SEVERITY_RANK[a.severity]||0);if(severity)return severity;return number(b.lastSeenAt||b.updatedAt)-number(a.lastSeenAt||a.updatedAt);
  });
  const active=incidents.filter(item=>['open','acknowledged'].includes(item.status));
  const counts={open:0,acknowledged:0,critical:0,warning:0,totalActive:active.length,...(workflow.counts||{})};
  const services=payload.services||{};
  return {
    status:runtime.status||workflow.status||'pass',
    statusLabel:mobileHealthStatusLabel(runtime.status||workflow.status||'pass'),
    checkedAt:number(payload.checkedAt||runtime.checkedAt)||now,
    uptime:formatMobileUptime(runtime.uptimeMs),
    apiErrorRate:number(runtime.api?.errorRate),
    apiRequests:Math.max(0,number(runtime.api?.requests)),
    apiErrors:Math.max(0,number(runtime.api?.errors)),
    memory:formatMobileBytes(runtime.memory?.rss),
    eventLoopP95:number(runtime.eventLoop?.p95Ms),
    sseClients:Math.max(0,number(runtime.sse?.liveClients)),
    storageRecoveries:Math.max(0,number(runtime.persistence?.recoveries)),
    storageFailures:Math.max(0,number(runtime.persistence?.failures)),
    services:{
      discord:normalizeService(services.discord),
      naver:normalizeService(services.naver),
      chzzk:normalizeService(services.chzzk),
      storage:normalizeService(services.storage,runtime.persistence?.failures?'fail':'pass'),
      sse:normalizeService(services.sse,runtime.sse?.staleReports?'warn':'pass')
    },
    counts,
    incidents:incidents.slice(0,40),
    activeIncidents:active.slice(0,20),
    timeline:(Array.isArray(workflow.timeline)?workflow.timeline:[]).slice(0,20),
    canManageIncidents:access.role!=='operator',
    access,
    version:String(payload.version||runtime.version||'—')
  };
}

export function mobileHealthSummaryText(model={}){
  const services=model.services||{},lines=[`댕댕봇 Runtime Health: ${model.statusLabel||'확인 필요'}`,`Uptime: ${model.uptime||'—'} · API errors: ${Number(model.apiErrorRate||0).toFixed(2)}% · Active incidents: ${Number(model.counts?.totalActive)||0}`];
  for(const [key,label] of [['discord','Discord'],['naver','Naver Cafe'],['chzzk','CHZZK'],['storage','Storage'],['sse','SSE']]){const service=services[key]||{};lines.push(`${label}: ${mobileHealthStatusLabel(service.status)}${service.detail?` · ${service.detail}`:''}`);}
  const first=(model.activeIncidents||[])[0];if(first)lines.push(`Top incident: [${String(first.severity||'warning').toUpperCase()}] ${first.title||first.code||'incident'}`);
  return lines.join('\n');
}
