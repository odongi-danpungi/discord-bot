const number=value=>Number.isFinite(Number(value))?Number(value):0;
const text=value=>String(value??'');

export function buildMobileRecoveryModel(payload={}){
  const access=payload.access||{},emergency=payload.emergency||{},recovery=payload.recovery||{},selfCheck=payload.selfCheck||{};
  const restorePoints=(Array.isArray(recovery.restorePoints)?recovery.restorePoints:[]).map(item=>({id:text(item.id),label:text(item.label||'복원 지점'),reason:text(item.reason||''),createdAt:number(item.createdAt),recordCount:Math.max(0,number(item.recordCount)),revision:Math.max(0,number(item.revision)),integrity:item.integrity!==false})).sort((a,b)=>b.createdAt-a.createdAt);
  const audit=(Array.isArray(recovery.auditLog)?recovery.auditLog:[]).map(item=>({id:text(item.id),at:number(item.at),category:text(item.category),action:text(item.action),summary:text(item.summary),actor:text(item.actor)})).sort((a,b)=>b.at-a.at).slice(0,20);
  const checks=Array.isArray(selfCheck.checks)?selfCheck.checks.map(item=>({id:text(item.id),label:text(item.label),status:['pass','warn','fail'].includes(item.status)?item.status:'warn',detail:text(item.detail)})):[];
  const counts={pass:Math.max(0,number(selfCheck.counts?.pass)),warn:Math.max(0,number(selfCheck.counts?.warn)),fail:Math.max(0,number(selfCheck.counts?.fail))};
  return {allowed:access.role!=='operator',access,version:text(payload.version||'—'),checkedAt:number(payload.checkedAt),emergency:{locked:Boolean(emergency.locked),lockedAt:number(emergency.lockedAt),lockedBy:text(emergency.lockedBy),reason:text(emergency.reason),checkpointId:text(emergency.checkpointId),unlockedAt:number(emergency.unlockedAt),unlockedBy:text(emergency.unlockedBy)},restorePoints,audit,selfCheck:{ok:Boolean(selfCheck.ok),counts,checks},downloads:{backup:text(payload.downloads?.backup||'/api/backup'),diagnostics:text(payload.downloads?.diagnostics||'/api/runtime/diagnostics')}};
}

export function formatRecoveryTime(value){const at=number(value);return at?new Date(at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'기록 없음';}
export function recoveryStatusLabel(model={}){if(model.emergency?.locked)return '긴급 잠금';if(Number(model.selfCheck?.counts?.fail)>0)return '복구 필요';if(Number(model.selfCheck?.counts?.warn)>0)return '점검 필요';return '정상';}
