import { assertCallPassOperationsState } from './call-pass.js';

function unavailable(){
  return Object.assign(Error('참가 응답 기록을 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.'),{
    status:503,statusCode:503,code:'participant_call_result_unavailable'
  });
}

/**
 * Read only the retained decision for this participant's exact current call.
 * An acknowledgement proves a past Queue save, not a current reservation or
 * delivery to Discord. Absence is unknown, including after history pruning.
 * The phase, Queue status and response deadline may change after acceptance;
 * only the session and call-attempt identity determine this historical result.
 */
export function buildParticipantCallResponse({operationsState={},entry=null,userId=''}={}){
  if(typeof userId!=='string'||!userId||entry?.source!=='discord'||entry.discordUserId!==userId)return null;
  const session=operationsState?.session;
  if(!session||entry.sessionId!==session.id||entry.game!==session.game||entry.round!==session.round||!Number.isSafeInteger(entry.callAttempt)||entry.callAttempt<1)return null;
  if(!Object.hasOwn(operationsState,'callPassReceipts'))return null;
  try{assertCallPassOperationsState(operationsState);}catch{throw unavailable();}
  const matches=(operationsState.callPassReceipts||[]).filter(receipt=>receipt.entryId===entry.id&&receipt.sessionId===entry.sessionId&&receipt.game===entry.game&&receipt.round===entry.round&&receipt.attempt===entry.callAttempt);
  if(matches.length>1)throw unavailable();
  const receipt=matches[0];
  if(!receipt||receipt.userId!==userId)return null;
  return {
    action:'pass',state:receipt.appliedAt===null?'confirming':'recorded',
    sessionId:receipt.sessionId,game:receipt.game,round:receipt.round,
    targetRound:receipt.targetRound,attempt:receipt.attempt,
    recordedAt:receipt.createdAt,confirmedAt:receipt.appliedAt
  };
}
