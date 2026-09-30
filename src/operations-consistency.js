const GAMES=new Set(['lol','er']);
const PHASES=new Set(['open','closed','drawn','checking','ended']);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\r\n\t]/.test(value);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const unique=list=>[...new Set(list)];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function require(condition,message){if(!condition)throw Error(`운영 상태 일관성 오류: ${message}`);}
function normalizeIds(value,label,changes){
  require(Array.isArray(value),`${label} 배열이 없습니다.`);
  require(value.every(id),`${label}에 잘못된 사용자 ID가 있습니다.`);
  const next=unique(value);
  if(next.length!==value.length)changes.push(`${label} 중복 ${value.length-next.length}건 제거`);
  return next;
}
function normalizeTeams(value,winners,confirmed,changes){
  require(Array.isArray(value),'teams 배열이 없습니다.');
  if(!value.length)return [];
  const winnerSet=new Set(winners),confirmedSet=new Set(confirmed),flat=[];
  let valid=true;
  for(const team of value){
    if(!Array.isArray(team)||!team.length||team.some(member=>!id(member))){valid=false;break;}
    flat.push(...team);
  }
  if(valid){
    const flatSet=new Set(flat);
    valid=flatSet.size===flat.length&&flat.every(member=>winnerSet.has(member)&&confirmedSet.has(member))&&flat.length===winners.length;
  }
  if(!valid){changes.push('파생 팀 편성 초기화');return [];}
  return value.map(team=>[...team]);
}
function reservationKey(item){return `${item.game}:${item.userId}`;}
function normalizeReservations(value,changes){
  require(Array.isArray(value),'reservations 배열이 없습니다.');
  const seen=new Set(),out=[];
  for(let i=value.length-1;i>=0;i--){
    const item=value[i];
    require(plain(item)&&GAMES.has(item.game)&&id(item.userId)&&Number.isInteger(item.round)&&item.round>=1,`예약 ${i+1}번 항목이 올바르지 않습니다.`);
    const key=reservationKey(item);if(seen.has(key)){changes.push(`중복 예약 제거 · ${key}`);continue;}seen.add(key);out.push({game:item.game,userId:item.userId,round:item.round});
  }
  return out.reverse();
}
function normalizeArchive(value,changes){
  require(Array.isArray(value),'sessionArchive 배열이 없습니다.');
  const seen=new Set(),out=[];
  for(const item of value){
    if(!plain(item)||!id(item.id)||seen.has(item.id)){changes.push('잘못되거나 중복된 회차 보관 기록 제외');continue;}
    seen.add(item.id);out.push(item);
  }
  return out.slice(0,50);
}

/**
 * Repairs only deterministic, loss-minimizing drift. Ambiguous committed outcomes
 * (winner membership/count, confirmation ownership, invalid session identity) fail
 * closed instead of being guessed or silently rewritten.
 */
export function reconcileOperationsState(input){
  require(plain(input),'운영 상태가 객체가 아닙니다.');
  const state=structuredClone(input),changes=[];
  state.history=Array.isArray(state.history)?state.history:[];
  state.reservations=normalizeReservations(state.reservations??[],changes);
  state.sessionArchive=normalizeArchive(state.sessionArchive??[],changes);
  state.rounds=plain(state.rounds)?state.rounds:{};
  for(const game of GAMES){if(Object.hasOwn(state.rounds,game)){const n=Number(state.rounds[game]);if(Number.isInteger(n)&&n>=0)state.rounds[game]=n;else{state.rounds[game]=0;changes.push(`rounds.${game} 숫자 복구`);}}}
  state.revision=Number.isFinite(state.revision)?Number(state.revision):0;

  const archiveMax={lol:0,er:0};
  for(const item of state.sessionArchive){if(GAMES.has(item.game)&&Number.isInteger(item.round)&&item.round>archiveMax[item.game])archiveMax[item.game]=item.round;}

  const s=state.session;
  if(s!==null&&s!==undefined){
    require(plain(s),'session이 객체가 아닙니다.');
    require(id(s.id),'session.id가 올바르지 않습니다.');
    require(GAMES.has(s.game),'session.game이 올바르지 않습니다.');
    require(Number.isInteger(s.round)&&s.round>=1,'session.round가 올바르지 않습니다.');
    require(Number.isInteger(s.count)&&s.count>=1&&s.count<=50,'session.count가 1~50 범위가 아닙니다.');
    require(PHASES.has(s.phase),'session.phase가 올바르지 않습니다.');
    s.applicants=normalizeIds(s.applicants,'applicants',changes);
    s.postponed=normalizeIds(s.postponed??[],'postponed',changes);
    s.winners=normalizeIds(s.winners,'winners',changes);
    s.confirmed=normalizeIds(s.confirmed,'confirmed',changes);
    s.excluded=normalizeIds(s.excluded??[],'excluded',changes);

    // A postponed marker is a promise to carry this user forward. If its
    // reservation disappeared, conservatively recreate the next-round booking.
    const reservationMap=new Map(state.reservations.map(r=>[reservationKey(r),r]));
    for(const userId of s.postponed){
      if(!s.applicants.includes(userId)){s.applicants.push(userId);changes.push(`미루기 참가자 신청 목록 복구 · ${userId}`);}
      const key=`${s.game}:${userId}`,existing=reservationMap.get(key);
      if(!existing){const item={game:s.game,userId,round:s.round+1};state.reservations.push(item);reservationMap.set(key,item);changes.push(`미루기 예약 재생성 · ${userId}`);}
    }

    // Reservations due for the active round should already have been consumed
    // by open(). Consume any stale copy without losing the applicant.
    const kept=[];
    for(const r of state.reservations){
      if(r.game!==s.game){kept.push(r);continue;}
      if(r.round<=s.round){
        if(!s.applicants.includes(r.userId)){s.applicants.push(r.userId);changes.push(`도래 예약 신청 반영 · ${r.userId}`);}
        if(s.postponed.includes(r.userId)){s.postponed=s.postponed.filter(v=>v!==r.userId);changes.push(`도래 예약 미루기 해제 · ${r.userId}`);}
        changes.push(`도래 예약 소비 · ${r.userId}`);continue;
      }
      if(s.winners.includes(r.userId)){
        // Current winner state is already a committed outcome. Never rewrite it
        // to honor a conflicting future reservation; remove the impossible queue entry.
        changes.push(`당첨자와 충돌한 미래 예약 제거 · ${r.userId}`);continue;
      }
      if(!s.applicants.includes(r.userId)){s.applicants.push(r.userId);changes.push(`미래 예약 신청 목록 연결 · ${r.userId}`);}
      if(!s.postponed.includes(r.userId)){s.postponed.push(r.userId);changes.push(`미래 예약 미루기 목록 연결 · ${r.userId}`);}
      kept.push(r);
    }
    state.reservations=normalizeReservations(kept,changes);

    const applicantSet=new Set(s.applicants),postponedSet=new Set(s.postponed),winnerSet=new Set(s.winners);
    require(s.postponed.every(userId=>applicantSet.has(userId)),'postponed 사용자가 applicants에 없습니다.');
    require(s.winners.every(userId=>applicantSet.has(userId)),'당첨자가 applicants에 없습니다.');
    require(s.winners.every(userId=>!postponedSet.has(userId)),'미루기 사용자가 현재 회차 당첨자로 저장되어 있습니다.');
    require(s.confirmed.every(userId=>winnerSet.has(userId)),'참석 확인 사용자가 현재 당첨자에 없습니다.');
    require(s.excluded.every(userId=>applicantSet.has(userId)),'제외 사용자가 applicants에 없습니다.');

    if(['open','closed'].includes(s.phase))require(s.winners.length===0&&s.confirmed.length===0,'추첨 전 단계에 당첨/참석 결과가 남아 있습니다.');
    if(['drawn','checking'].includes(s.phase))require(s.winners.length===s.count,'추첨 완료 단계의 당첨자 수가 모집 인원과 다릅니다.');
    if(s.phase==='checking'){
      if(!Number.isFinite(s.deadline)||s.deadline<=0){s.phase='drawn';s.deadline=null;s.deadlineSynced=false;changes.push('유효하지 않은 참석 확인 기한 해제 · 선정 완료 단계로 복귀');}
      if(!Number.isInteger(s.attendanceVersion)||s.attendanceVersion<1){s.attendanceVersion=1;changes.push('attendanceVersion 기본값 복구');}
    }else if(s.deadline!==undefined&&s.deadline!==null&&s.phase==='drawn'){
      s.deadline=null;s.deadlineSynced=false;changes.push('선정 완료 단계의 만료된 참석 기한 제거');
    }
    s.teams=normalizeTeams(s.teams,s.winners,s.confirmed,changes);
    if(!s.teams.length&&s.teamMeta){s.teamMeta=null;changes.push('팀 편성 메타데이터 초기화');}
    else if(s.teams.length&&s.teamMeta!==undefined&&s.teamMeta!==null&&!plain(s.teamMeta)){s.teamMeta=null;changes.push('잘못된 팀 편성 메타데이터 초기화');}
    state.rounds[s.game]=Math.max(Number(state.rounds[s.game])||0,s.round);
  }else state.session=null;

  for(const game of GAMES)if(archiveMax[game]>0)state.rounds[game]=Math.max(Number(state.rounds[game])||0,archiveMax[game]);
  return {state,changed:!same(state,input),changes:[...new Set(changes)]};
}

export function assertOperationsStateConsistency(state){
  const result=reconcileOperationsState(state);
  require(!result.changed,`저장 직전 자동 수정이 필요한 상태입니다: ${result.changes.join(', ')||'정규화 필요'}`);
  return true;
}
