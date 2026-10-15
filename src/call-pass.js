import { createHash } from 'node:crypto';

const HASH=/^[a-f0-9]{64}$/;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\r\n\t]/.test(value);
const error=(message,status=409,code='call_pass_conflict')=>Object.assign(Error(message),{status,code});
export const CALL_PASS_COMPLETED_LIMIT=200;
export const CALL_PASS_PENDING_LIMIT=1000;

/** The digest binds a decision to one exact call, without retaining its bearer token. */
export function callPassId(entryId,token){return createHash('sha256').update(JSON.stringify([String(entryId),String(token)])).digest('hex');}

export function canBookCallPass({state,entry}={}){
  const session=state?.session;
  return Boolean(entry?.source==='discord'&&entry.status==='called'&&session&&entry.sessionId===session.id&&entry.game===session.game&&Number.isSafeInteger(session.round)&&session.round>0&&Number.isSafeInteger(session.round+1)&&entry.round===session.round&&(!entry.mode||entry.mode===session.mode)&&['open','closed'].includes(session.phase)&&session.applicants?.includes(entry.discordUserId)&&!(session.postponed||[]).includes(entry.discordUserId)&&!session.winners?.length&&!session.confirmed?.length&&!session.teams?.length&&!(state.reservations||[]).some(item=>item.game===session.game&&item.userId===entry.discordUserId));
}
export function hasPendingCallPass({state,entry}={}){
  return Boolean(entry&&(state?.callPassReceipts||[]).some(item=>item.appliedAt===null&&item.entryId===entry.id&&item.userId===entry.discordUserId&&item.sessionId===entry.sessionId&&item.game===entry.game&&item.round===entry.round&&item.attempt===entry.callAttempt));
}

export function assertCallPassOperationsState(state){
  if(!Object.hasOwn(state,'callPassReceipts'))return true;
  const list=state.callPassReceipts;
  if(!Array.isArray(list)||list.length>CALL_PASS_PENDING_LIMIT+CALL_PASS_COMPLETED_LIMIT)throw error('호출 패스 복구 기록 형식이 올바르지 않습니다.',503,'call_pass_corrupt');
  const ids=new Set();let pending=0,completed=0;
  const keys=new Set(['id','entryId','userId','sessionId','game','round','targetRound','attempt','deadline','createdAt','appliedAt']);
  for(const receipt of list){
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||Object.keys(receipt).length!==keys.size||Object.keys(receipt).some(key=>!keys.has(key))||!HASH.test(receipt.id)||ids.has(receipt.id)||!text(receipt.entryId)||!text(receipt.userId)||!text(receipt.sessionId)||!['lol','er'].includes(receipt.game)||!Number.isSafeInteger(receipt.round)||receipt.round<1||!Number.isSafeInteger(receipt.targetRound)||receipt.targetRound!==receipt.round+1||!Number.isSafeInteger(receipt.attempt)||receipt.attempt<1||!Number.isFinite(receipt.deadline)||receipt.deadline<=0||!Number.isFinite(receipt.createdAt)||receipt.createdAt<0||receipt.createdAt>=receipt.deadline||(receipt.appliedAt!==null&&(!Number.isFinite(receipt.appliedAt)||receipt.appliedAt<receipt.createdAt)))throw error('호출 패스 복구 기록이 손상됐습니다.',503,'call_pass_corrupt');
    ids.add(receipt.id);if(receipt.appliedAt===null)pending++;else completed++;
  }
  if(pending>CALL_PASS_PENDING_LIMIT||completed>CALL_PASS_COMPLETED_LIMIT)throw error('호출 패스 복구 기록 한도를 확인해 주세요.',503,'call_pass_corrupt');
  return true;
}

export function acceptCallPass(state,{entry,token,userId},now){
  assertCallPassOperationsState(state);
  const id=callPassId(entry.id,token),existing=(state.callPassReceipts||[]).find(item=>item.id===id);
  if(existing){
    if(existing.userId!==String(userId))throw error('호출된 참가자만 응답할 수 있습니다.',403,'call_pass_owner');
    return {receipt:structuredClone(existing),replayed:true};
  }
  if(entry.status!=='called'||entry.callToken!==String(token||''))throw error('이 호출은 이미 종료되었거나 갱신되었습니다.');
  if(!entry.discordUserId||entry.discordUserId!==String(userId||''))throw error('호출된 참가자만 응답할 수 있습니다.',403,'call_pass_owner');
  if(!Number.isFinite(entry.callDeadline)||now>=entry.callDeadline)throw error('응답 시간이 만료됐습니다.');
  if(!canBookCallPass({state,entry}))throw error('현재 모집과 호출 상태를 확인할 수 없어 패스 예약을 변경할 수 없습니다. 진행자에게 문의해 주세요.');
  state.callPassReceipts??=[];
  if(state.callPassReceipts.filter(item=>item.appliedAt===null).length>=CALL_PASS_PENDING_LIMIT)throw error('완료되지 않은 패스 복구가 많아 접수를 잠시 중단했습니다.',503,'call_pass_recovery_pending');
  const session=state.session;
  const receipt={id,entryId:entry.id,userId:String(userId),sessionId:session.id,game:session.game,round:session.round,targetRound:session.round+1,attempt:entry.callAttempt,deadline:entry.callDeadline,createdAt:now,appliedAt:null};
  state.reservations??=[];state.reservations.push({game:receipt.game,userId:receipt.userId,round:receipt.targetRound});
  session.postponed??=[];session.postponed.push(receipt.userId);
  state.callPassReceipts.push(receipt);state.revision=(state.revision||0)+1;
  state.history??=[];state.history.unshift({action:'call_pass',userId:receipt.userId,sessionId:session.id,game:session.game,round:session.round,at:now});state.history=state.history.slice(0,200);
  return {receipt:structuredClone(receipt),replayed:false};
}

export function acknowledgeCallPasses(state,ids,now){
  assertCallPassOperationsState(state);let changed=false;const selected=new Set(ids);
  for(const receipt of state.callPassReceipts||[])if(selected.has(receipt.id)&&receipt.appliedAt===null){receipt.appliedAt=Math.max(receipt.createdAt,now);changed=true;}
  if(changed){
    const list=state.callPassReceipts,pending=list.filter(item=>item.appliedAt===null),completed=list.filter(item=>item.appliedAt!==null).sort((a,b)=>b.createdAt-a.createdAt).slice(0,CALL_PASS_COMPLETED_LIMIT);
    state.callPassReceipts=[...pending,...completed];state.revision=(state.revision||0)+1;
  }
  return changed;
}
