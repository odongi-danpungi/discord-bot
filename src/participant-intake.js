import { activeIntakeCount, intakeAtCapacity, readSessionIntakePolicy } from './intake-policy.js';

const PHASES=new Set(['open','closed','drawn','checking','ended']);
const CLOSED_REASONS=new Set(['capacity','deadline','manual']);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\r\n\t]/.test(value);

function unavailable(){
  return Object.assign(new Error('현재 모집의 접수 상태를 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.'),{status:503,statusCode:503,code:'participant_intake_unavailable'});
}

/** Participant-safe aggregate of this Discord round, with no Queue or identity data. */
export function buildParticipantRecruitmentState({session=null,now=Date.now()}={}){
  if(session===null||session===undefined)return {
    status:'inactive',reason:'no_session',maxApplicants:null,activeApplicants:0,
    remainingSlots:null,unlimited:false,closeAt:0,drawCount:0,duplicatePolicy:null
  };
  const policy=readSessionIntakePolicy(session);
  if(!PHASES.has(session.phase)||!Number.isInteger(session.count)||session.count<1||session.count>50||
    !Number.isSafeInteger(now)||now<0||
    !Array.isArray(session.applicants)||!session.applicants.every(validId)||
    (session.postponed!==undefined&&(!Array.isArray(session.postponed)||!session.postponed.every(validId))))throw unavailable();
  const closeAt=session.closeAt??0;
  if(!Number.isSafeInteger(closeAt)||closeAt<0)throw unavailable();
  const activeApplicants=activeIntakeCount(session),atCapacity=intakeAtCapacity(policy,activeApplicants);
  const unlimited=policy.maxApplicants===0;
  const result={
    status:'open',reason:null,maxApplicants:policy.maxApplicants,activeApplicants,
    remainingSlots:unlimited?null:Math.max(0,policy.maxApplicants-activeApplicants),
    unlimited,closeAt,drawCount:session.count,duplicatePolicy:policy.duplicatePolicy
  };
  // A completed intake remains closed even if reservations are later cancelled.
  // Reopen() removes closeReason; a full reopened round can still free a place.
  if(['drawn','checking','ended'].includes(session.phase))return {...result,status:'closed',reason:'progress'};
  if(session.phase==='closed'){
    if(session.closeReason!==undefined&&!CLOSED_REASONS.has(session.closeReason))throw unavailable();
    return {...result,status:'closed',reason:session.closeReason??(closeAt&&closeAt<=now?'deadline':'manual')};
  }
  if(closeAt&&closeAt<=now)return {...result,status:'closed',reason:'deadline'};
  if(atCapacity)return {...result,status:'full',reason:'capacity'};
  return result;
}
