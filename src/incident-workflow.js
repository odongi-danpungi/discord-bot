import { createHash, randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';

const MAX_INCIDENTS=200,MAX_TIMELINE=500,STALE_MS=10*60*1000,ESCALATE_AGE_MS=15*60*1000;
const activeStatus=new Set(['open','acknowledged']);
const severityRank={info:0,warning:1,critical:2};
const text=(v,n=240)=>String(v??'').trim().slice(0,n);
const hash=v=>createHash('sha256').update(String(v)).digest('hex');
const validIncident=i=>i&&typeof i.id==='string'&&typeof i.fingerprint==='string'&&['open','acknowledged','resolved'].includes(i.status)&&['info','warning','critical'].includes(i.severity);
const valid=s=>s&&s.version===1&&Array.isArray(s.incidents)&&s.incidents.every(validIncident)&&Array.isArray(s.timeline);
const initial={version:1,incidents:[],timeline:[]};

function pushTimeline(state,{type,incident,summary,actor='system',at=Date.now(),detail=''}){
  state.timeline.unshift({id:randomUUID(),at,type,incidentId:incident?.id||null,severity:incident?.severity||'info',summary:text(summary,180),actor:text(actor,80),detail:text(detail,320)});
  state.timeline=state.timeline.slice(0,MAX_TIMELINE);
}
function baseSeverity(item){return item?.severity==='error'?'critical':item?.severity==='warn'?'warning':'info';}
function elevated(severity,incident,now){
  if(severity==='critical')return 'critical';
  if((Number(incident.occurrences)||0)>=3||now-(Number(incident.openedAt)||now)>=ESCALATE_AGE_MS)return 'critical';
  return severity;
}
function runtimeFingerprint(item){return `runtime:${text(item.source,40)}:${text(item.code,80)}:${hash(text(item.summary,180)).slice(0,12)}`;}
function normalizeIncident(i){return {...i,owner:text(i.owner,80),note:text(i.note,180),detail:text(i.detail,320),occurrences:Math.max(1,Number(i.occurrences)||1),suppressed:Boolean(i.suppressed),escalated:Boolean(i.escalated)};}

export class IncidentWorkflowStore extends JsonStore{
  constructor(file){super(file,initial,valid);}
  summary(){
    const state=this.read(),incidents=state.incidents.map(normalizeIncident).sort((a,b)=>{
      const aa=activeStatus.has(a.status)?0:1,bb=activeStatus.has(b.status)?0:1;if(aa!==bb)return aa-bb;
      const sr=severityRank[b.severity]-severityRank[a.severity];return sr||Number(b.lastSeenAt||b.updatedAt||0)-Number(a.lastSeenAt||a.updatedAt||0);
    });
    const active=incidents.filter(i=>activeStatus.has(i.status));
    return {incidents,timeline:state.timeline.slice(0,150),counts:{open:active.filter(i=>i.status==='open').length,acknowledged:active.filter(i=>i.status==='acknowledged').length,critical:active.filter(i=>i.severity==='critical').length,warning:active.filter(i=>i.severity==='warning').length,totalActive:active.length},status:active.some(i=>i.severity==='critical')?'critical':active.some(i=>i.severity==='warning')?'warning':'pass'};
  }
  async sync({runtimeIncidents=[],policyComparison=undefined,maintenance=null,now=Date.now()}={}){
    const before=this.read(),next=structuredClone(before),seen=new Set();
    const upsert=(fingerprint,input)=>{
      seen.add(fingerprint);const observedAt=Math.min(now,Math.max(0,Number(input.observedAt)||now));let incident=next.incidents.find(i=>i.fingerprint===fingerprint&&activeStatus.has(i.status));
      const base=input.severity||'warning';
      if(!incident){
        const previous=[...next.incidents].filter(i=>i.fingerprint===fingerprint&&i.status==='resolved').sort((a,b)=>Number(b.resolvedAt||0)-Number(a.resolvedAt||0))[0];
        if(previous&&Number(previous.resolvedAt||0)>=observedAt)return;
        incident={id:randomUUID(),fingerprint,source:input.source||'system',code:input.code||'incident',title:text(input.title,180),detail:text(input.detail,320),severity:base,baseSeverity:base,status:'open',owner:'',note:'',openedAt:observedAt,updatedAt:now,lastSeenAt:observedAt,occurrences:Math.max(1,Number(input.occurrences)||1),suppressed:Boolean(input.suppressed),context:input.context||null,escalated:false};
        incident.severity=elevated(incident.severity,incident,now);incident.escalated=incident.severity==='critical'&&base!=='critical';next.incidents.unshift(incident);pushTimeline(next,{type:'opened',incident,summary:`장애 등록 · ${incident.title}`});
      }else{
        const prevSeverity=incident.severity,prevSuppressed=Boolean(incident.suppressed),prevCount=Number(incident.occurrences)||1,prevLast=Number(incident.lastSeenAt)||0,prevDetail=incident.detail,prevContext=JSON.stringify(incident.context??null);
        incident.lastSeenAt=Math.max(prevLast,observedAt);incident.detail=text(input.detail||incident.detail,320);incident.context=input.context??incident.context;incident.suppressed=Boolean(input.suppressed);incident.occurrences=Math.max(prevCount,Number(input.occurrences)||prevCount);incident.baseSeverity=base;
        incident.severity=elevated(base,incident,now);incident.escalated=incident.severity==='critical'&&base!=='critical';
        if(incident.lastSeenAt!==prevLast||incident.occurrences!==prevCount||incident.detail!==prevDetail||JSON.stringify(incident.context??null)!==prevContext||incident.suppressed!==prevSuppressed||incident.severity!==prevSeverity)incident.updatedAt=now;
        if(severityRank[incident.severity]>severityRank[prevSeverity])pushTimeline(next,{type:'escalated',incident,summary:`장애 심각도 상승 · ${incident.title}`,detail:`${prevSeverity} → ${incident.severity}`});
        if(prevSuppressed&&!incident.suppressed)pushTimeline(next,{type:'unsuppressed',incident,summary:`점검 종료 후 장애 재평가 · ${incident.title}`});
      }
    };
    const runtimeGroups=new Map();
    for(const item of runtimeIncidents||[]){
      if(!['warn','error'].includes(item?.severity))continue;
      const last=Number(item.lastAt||item.at)||0;if(last&&now-last>STALE_MS)continue;
      const fingerprint=runtimeFingerprint(item),previous=runtimeGroups.get(fingerprint),severity=baseSeverity(item),occurrences=Math.max(1,Number(item.count)||1);
      if(!previous){runtimeGroups.set(fingerprint,{fingerprint,source:item.source||'runtime',code:item.code||'runtime',title:item.summary||'런타임 장애',detail:item.detail||'',severity,occurrences,observedAt:last||now});continue;}
      previous.occurrences+=occurrences;
      if((last||now)>=previous.observedAt){previous.observedAt=last||now;previous.detail=item.detail||previous.detail;previous.title=item.summary||previous.title;previous.source=item.source||previous.source;previous.code=item.code||previous.code;}
      if(severityRank[severity]>severityRank[previous.severity])previous.severity=severity;
    }
    for(const group of runtimeGroups.values())upsert(group.fingerprint,group);
    const policyFp='policy:discord-policy-drift';
    if(policyComparison?.status==='drift'){
      const manual=Number(policyComparison.counts?.manual)||0,safe=Number(policyComparison.counts?.safe)||0,total=Number(policyComparison.counts?.total)||manual+safe;
      upsert(policyFp,{source:'discord',code:'discord_policy_drift',title:`Discord 기준선 Drift · ${total}개`,detail:`SAFE ${safe} / MANUAL ${manual}`,severity:maintenance?.active?'warning':manual?'critical':'warning',suppressed:Boolean(maintenance?.active),occurrences:1,observedAt:now,context:{digest:policyComparison.digest||'',manual,safe,total}});
    }
    for(const incident of next.incidents){
      if(!activeStatus.has(incident.status))continue;
      if(incident.fingerprint===policyFp){if(policyComparison===undefined)continue;if(policyComparison?.status==='drift')continue;}
      else if(seen.has(incident.fingerprint))continue;
      if(incident.source==='discord'&&incident.code==='discord_policy_drift'&&maintenance?.active)continue;
      const last=Number(incident.lastSeenAt)||0;if(now-last<STALE_MS&&incident.fingerprint!==policyFp)continue;
      incident.status='resolved';incident.resolvedAt=now;incident.updatedAt=now;incident.suppressed=false;pushTimeline(next,{type:'auto-resolved',incident,summary:`자동 해소 · ${incident.title}`});
    }
    next.incidents=next.incidents.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)).slice(0,MAX_INCIDENTS);
    if(JSON.stringify(before)===JSON.stringify(next))return this.summary();
    await this.update(state=>{for(const k of Object.keys(state))delete state[k];Object.assign(state,next);});return this.summary();
  }
  async acknowledge(id,{owner='admin',note='',actor='admin',now=Date.now()}={}){
    let found=false;await this.update(state=>{const i=state.incidents.find(x=>x.id===id&&activeStatus.has(x.status));if(!i)throw Error('확인할 활성 장애를 찾지 못했습니다.');found=true;i.status='acknowledged';i.owner=text(owner||actor,80);i.note=text(note,180);i.acknowledgedAt=now;i.updatedAt=now;pushTimeline(state,{type:'acknowledged',incident:i,summary:`장애 확인 · ${i.title}`,actor,detail:i.note});});return found?this.summary():null;
  }
  async resolve(id,{note='',actor='admin',now=Date.now()}={}){
    await this.update(state=>{const i=state.incidents.find(x=>x.id===id&&activeStatus.has(x.status));if(!i)throw Error('해제할 활성 장애를 찾지 못했습니다.');i.status='resolved';i.note=text(note||i.note,180);i.resolvedAt=now;i.updatedAt=now;i.suppressed=false;pushTimeline(state,{type:'resolved',incident:i,summary:`장애 수동 해제 · ${i.title}`,actor,detail:i.note});});return this.summary();
  }
  async reopen(id,{actor='admin',now=Date.now()}={}){
    await this.update(state=>{const i=state.incidents.find(x=>x.id===id);if(!i||i.status!=='resolved')throw Error('다시 열 장애를 찾지 못했습니다.');i.status='open';i.resolvedAt=null;i.acknowledgedAt=null;i.updatedAt=now;i.note='';pushTimeline(state,{type:'reopened',incident:i,summary:`장애 다시 열기 · ${i.title}`,actor});});return this.summary();
  }
}
