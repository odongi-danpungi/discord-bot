export const RUNBOOK_PHASES=Object.freeze([
  Object.freeze({id:'pre',label:'방송 전',eyebrow:'PRE-LIVE'}),
  Object.freeze({id:'live',label:'방송 중',eyebrow:'ON-AIR'}),
  Object.freeze({id:'post',label:'방송 후',eyebrow:'POST-LIVE'})
]);

const statuses=new Set(['pending','done','skipped']);
const phases=new Set(RUNBOOK_PHASES.map(item=>item.id));
const alertStatuses=new Set(['pending','sent','failed','suppressed']);
const clean=(value,max=1200)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const normalizePhaseState=value=>({phase:phases.has(value?.phase)?value.phase:'pre',source:clean(value?.source,40)||'system',reason:clean(value?.reason,220),detectedAt:Number(value?.detectedAt)||0});

export function normalizeRunbookForUi(value={}){
  const steps=(Array.isArray(value.steps)?value.steps:[]).map(item=>({
    id:clean(item?.id,80),phase:phases.has(item?.phase)?item.phase:'live',title:clean(item?.title,120),detail:clean(item?.detail,220),status:statuses.has(item?.status)?item.status:'pending',updatedAt:Number(item?.updatedAt)||0,updatedBy:clean(item?.updatedBy,80)
  })).filter(item=>item.id&&item.title);
  const handoffs=(Array.isArray(value.handoffs)?value.handoffs:[]).map(item=>({id:clean(item?.id,100),from:clean(item?.from,80),to:clean(item?.to,80),note:clean(item?.note,1200),at:Number(item?.at)||0,alertStatus:alertStatuses.has(item?.alertStatus)?item.alertStatus:'suppressed',alertedAt:Number(item?.alertedAt)||0,alertError:clean(item?.alertError,240)})).filter(item=>item.at&&(item.note||item.to)).sort((a,b)=>b.at-a.at);
  const activity=(Array.isArray(value.activity)?value.activity:[]).map(item=>({id:clean(item?.id,100),at:Number(item?.at)||0,type:clean(item?.type,40)||'info',source:clean(item?.source,40)||'broadcast',message:clean(item?.message,300)})).filter(item=>item.at&&item.message).sort((a,b)=>b.at-a.at);
  const phaseState=normalizePhaseState(value.phaseState||{}),phaseHistory=(Array.isArray(value.phaseHistory)?value.phaseHistory:[]).map(item=>({phase:phases.has(item?.phase)?item.phase:'pre',source:clean(item?.source,40)||'system',reason:clean(item?.reason,220),at:Number(item?.at)||0})).filter(item=>item.at).sort((a,b)=>b.at-a.at);
  const done=steps.filter(item=>item.status==='done').length,skipped=steps.filter(item=>item.status==='skipped').length,total=steps.length,pending=Math.max(0,total-done-skipped);
  const closeout=value.closeout&&typeof value.closeout==='object'?{summary:clean(value.closeout.summary,320),nextOwner:clean(value.closeout.nextOwner,80),nextNote:clean(value.closeout.nextNote,1200),generatedAt:Number(value.closeout.generatedAt)||0,schedule:value.closeout.schedule&&typeof value.closeout.schedule==='object'?{id:clean(value.closeout.schedule.id,80),title:clean(value.closeout.schedule.title,120),startAt:Number(value.closeout.schedule.startAt)||0}:null,completedCount:Number(value.closeout.completedCount)||0,skippedCount:Number(value.closeout.skippedCount)||0,handoffCount:Number(value.closeout.handoffCount)||0}:null;
  return {id:clean(value.id,100),title:clean(value.title,120)||'방송 운영 Runbook',status:value.status==='closed'?'closed':'active',createdAt:Number(value.createdAt)||0,createdBy:clean(value.createdBy,80),updatedAt:Number(value.updatedAt)||0,currentOwner:clean(value.currentOwner,80),closedAt:Number(value.closedAt)||0,closedBy:clean(value.closedBy,80),closeout,archiveCount:Number(value.archiveCount)||0,phaseState,phaseHistory,activity,steps,handoffs,progress:{done,skipped,pending,total}};
}

export function inferRunbookPhase({runbook={},session=null,chzzkLive={}}={}){
  const rb=normalizeRunbookForUi(runbook);
  if(phases.has(rb.phaseState?.phase)&&rb.phaseState.detectedAt)return rb.phaseState.phase;
  const live=chzzkLive?.state?.lastKnownLive===true,activeSession=Boolean(session&&session.phase!=='ended');
  if(live||activeSession)return 'live';
  if(rb.steps.some(item=>item.phase==='post'&&item.status!=='pending'))return 'post';
  if(rb.steps.some(item=>item.phase==='live'&&item.status!=='pending'))return 'post';
  return 'pre';
}

export function buildBroadcastRunbookModel({runbook={},session=null,chzzkLive={},access={}}={}){
  const rb=normalizeRunbookForUi(runbook),activePhase=inferRunbookPhase({runbook:rb,session,chzzkLive});
  const grouped=Object.fromEntries(RUNBOOK_PHASES.map(phase=>[phase.id,rb.steps.filter(step=>step.phase===phase.id)]));
  const complete=rb.progress.total>0&&rb.progress.pending===0;
  const percent=rb.progress.total?Math.round(((rb.progress.done+rb.progress.skipped)/rb.progress.total)*100):0;
  const canManage=access?.role==='admin'||(access?.role==='operator'&&Array.isArray(access.capabilities)&&access.capabilities.includes('broadcast'));
  const closed=rb.status==='closed',canCloseout=canManage&&!closed&&complete&&activePhase==='post';
  return {...rb,activePhase,grouped,complete,percent,canManage,closed,canCloseout,phaseMeta:RUNBOOK_PHASES,phaseReason:rb.phaseState?.reason||'',phaseSource:rb.phaseState?.source||'system',phaseDetectedAt:Number(rb.phaseState?.detectedAt)||0};
}

export function nextRunbookStatus(status){return status==='pending'?'done':status==='done'?'pending':'pending';}
export function runbookStatusLabel(status){return status==='done'?'완료':status==='skipped'?'건너뜀':'대기';}
export function runbookAlertLabel(status){return status==='sent'?'Discord 알림 전송':status==='failed'?'Discord 알림 실패':status==='pending'?'Discord 알림 대기':'Discord 알림 없음';}
export function formatRunbookTime(value){const n=Number(value)||0;if(!n)return '기록 없음';return new Date(n).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
