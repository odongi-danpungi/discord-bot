import { applyAction } from './operations.js';
import { hasGame } from './profiles.js';

const ACTIVE_QUEUE_STATUSES=new Set(['waiting','called','joined','postponed_next','postponed_next2']);
const STATUS_LABELS={
  waiting:'대기 중',
  called:'호출됨',
  joined:'참가 확인',
  postponed_next:'다음판 예약',
  postponed_next2:'다다음판 예약',
  cancelled:'취소됨',
  no_show:'노쇼'
};
const GAME_LABELS={lol:'리그 오브 레전드',er:'이터널 리턴'};
const MODE_LABELS={aram:'칼바람 나락',rift:'소환사의 협곡'};

function httpError(message,status=400,code='participant_self_service_error'){
  return Object.assign(new Error(message),{status,statusCode:status,code});
}

function currentOwnEntry(queueSummary,userId){
  const entries=Array.isArray(queueSummary?.entries)?queueSummary.entries:[];
  const mine=entries.filter(entry=>entry?.source==='discord'&&entry?.discordUserId===userId);
  const active=mine.filter(entry=>ACTIVE_QUEUE_STATUSES.has(entry.status)).sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0)||(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
  if(active.length)return active[0];
  return mine.sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0))[0]||null;
}

function publicOwnEntry(entry){
  if(!entry)return null;
  return {
    id:entry.id,
    status:entry.status,
    statusLabel:STATUS_LABELS[entry.status]||entry.status,
    position:Number(entry.position)||null,
    displayName:entry.displayName||'',
    sessionId:entry.sessionId||null,
    game:entry.game||null,
    mode:entry.mode||null,
    round:Number(entry.round)||null,
    calledAt:Number(entry.calledAt)||0,
    callDeadline:Number(entry.callDeadline||entry.deadline)||0,
    callAttempt:Number(entry.callAttempt||entry.attempt)||0,
    updatedAt:Number(entry.updatedAt)||0
  };
}

export function buildParticipantSelfServiceState({operationsState={},queueSummary={},userId='',profile=null,now=Date.now()}={}){
  const session=operationsState?.session||null;
  const reservations=(operationsState?.reservations||[]).filter(item=>item?.userId===userId).map(item=>({game:item.game,round:Number(item.round)||0}));
  const ownEntry=currentOwnEntry(queueSummary,userId);
  const open=Boolean(session&&session.phase==='open'&&(!session.closeAt||Number(session.closeAt)>now));
  const applicant=Boolean(session?.applicants?.includes(userId));
  const postponed=Boolean(session?.postponed?.includes(userId));
  const winner=Boolean(session?.winners?.includes(userId));
  const confirmed=Boolean(session?.confirmed?.includes(userId));
  const called=ownEntry?.status==='called'&&Number(ownEntry.callDeadline||ownEntry.deadline||0)>now;
  const canJoinCurrent=Boolean(open&&profile&&hasGame(profile,session.game)&&(!applicant||postponed)&&!called);
  const actions={
    join:canJoinCurrent,
    leave:Boolean(open&&applicant&&!called),
    postponeNext:Boolean(open&&applicant&&!postponed&&!called),
    postponeNext2:Boolean(open&&applicant&&!postponed&&!called),
    callJoin:Boolean(called),
    callPass:Boolean(called),
    confirm:Boolean(session?.phase==='checking'&&winner&&!confirmed&&Number(session.deadline)>now),
    cancelReservation:reservations.length>0&&!called
  };
  return {
    session:session?{
      id:session.id,
      title:session.title||'시참 모집',
      game:session.game,
      gameLabel:GAME_LABELS[session.game]||session.game||'—',
      mode:session.mode||null,
      modeLabel:MODE_LABELS[session.mode]||'',
      round:Number(session.round)||1,
      phase:session.phase,
      count:Number(session.count)||0,
      closeAt:Number(session.closeAt)||0,
      deadline:Number(session.deadline)||0,
      attendanceVersion:Number(session.attendanceVersion)||0,
      applicant,
      postponed,
      winner,
      confirmed
    }:null,
    queue:{
      entry:publicOwnEntry(ownEntry),
      waitingCount:Number(queueSummary?.counts?.waiting)||0,
      activeCount:Number(queueSummary?.activeCount)||0
    },
    reservations,
    actions,
    serverTime:now
  };
}

export async function performParticipantSelfServiceAction({
  action,
  game,
  userId,
  profile,
  operations,
  participationQueue,
  participationCalls,
  records=[],
  now=Date.now()
}={}){
  if(!userId)throw httpError('로그인 정보를 확인할 수 없습니다.',401,'participant_auth_missing');
  if(!profile)throw httpError('먼저 /연동으로 게임 정보를 등록해 주세요.',403,'participant_profile_missing');
  if(!operations)throw httpError('시참 운영 상태를 불러올 수 없습니다.',503,'participant_operations_unavailable');
  const allowed=new Set(['join','leave','postpone_next','postpone_next2','call_join','call_pass','confirm','cancel_reservation']);
  if(!allowed.has(action))throw httpError('지원하지 않는 시참 작업입니다.',400,'participant_action_invalid');

  const rawQueue=participationQueue?.read?.();
  const calledEntry=rawQueue?.entries?.find(entry=>entry?.source==='discord'&&entry?.discordUserId===userId&&entry?.status==='called')||null;
  if(calledEntry&&!['call_join','call_pass'].includes(action))throw httpError('현재 호출에 먼저 응답해 주세요.',409,'participant_call_pending');

  if(action==='call_join'||action==='call_pass'){
    if(!participationQueue||!participationCalls)throw httpError('시참 호출 기능이 준비되지 않았습니다.',503,'participant_call_unavailable');
    const entry=participationQueue.read().entries.find(item=>item?.source==='discord'&&item?.discordUserId===userId&&item?.status==='called');
    if(!entry)throw httpError('현재 응답할 호출이 없습니다.',409,'participant_call_missing');
    if(Number(entry.callDeadline)&&Number(entry.callDeadline)<=now)throw httpError('응답 시간이 만료됐습니다.',409,'participant_call_expired');
    const callAction=action==='call_join'?'join':'pass';
    if(callAction==='pass'){
      const state=operations.read(),session=state.session;
      if(session&&session.phase==='open'&&entry.sessionId===session.id&&entry.source==='discord'){
        await operations.update(next=>applyAction(next,'postpone_next',{sessionId:session.id,userId},now));
      }
    }
    const result=await participationCalls.respond({entryId:entry.id,token:entry.callToken,userId,action:callAction});
    if(callAction==='pass')await participationQueue.syncOperations({operationsState:operations.read(),records});
    return {result,state:buildParticipantSelfServiceState({operationsState:operations.read(),queueSummary:participationQueue.summary(),userId,profile,now:Date.now()})};
  }

  if(action==='cancel_reservation'){
    const selected=String(game||'');
    if(!['lol','er'].includes(selected))throw httpError('취소할 예약 게임을 선택해 주세요.',400,'participant_reservation_game_invalid');
    const exists=(operations.read().reservations||[]).some(item=>item.game===selected&&item.userId===userId);
    if(!exists)throw httpError('이미 취소되었거나 현재 회차에 반영된 예약입니다.',409,'participant_reservation_missing');
    await operations.update(state=>applyAction(state,'cancel_reservation',{game:selected,userId},now));
  }else{
    const current=operations.read().session;
    if(!current)throw httpError('진행 중인 시참 모집이 없습니다.',409,'participant_session_missing');
    if(action==='join'&&!hasGame(profile,current.game))throw httpError('먼저 /연동에서 해당 게임 계정을 등록해 주세요.',409,'participant_game_profile_missing');
    const mapped=action==='postpone_next2'?'postpone_later':action;
    await operations.update(state=>applyAction(state,mapped,{sessionId:current.id,userId,attendanceVersion:current.attendanceVersion},now));
  }

  if(participationQueue)await participationQueue.syncOperations({operationsState:operations.read(),records});
  return {state:buildParticipantSelfServiceState({operationsState:operations.read(),queueSummary:participationQueue?.summary?.()||{},userId,profile,now:Date.now()})};
}

export const __test={currentOwnEntry,publicOwnEntry,STATUS_LABELS};
