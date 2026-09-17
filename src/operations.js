import { randomInt, randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { balanceTeams } from './teams.js';

export function sample(items, count) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, count);
}
export function applyAction(state, action, data = {}, now = Date.now()) {
  const s = state.session;
  state.history ??= [];
  state.revision ??= 0;
  state.rounds ??= {};
  state.reservations ??= [];
  state.sessionArchive ??= [];
  if (s) { s.round ??= 1; state.rounds[s.game] ??= s.round; }
  if (action === 'cancel_reservation') {
    if (!['lol','er'].includes(data.game) || typeof data.userId !== 'string' || !data.userId) throw Error('예약을 선택해 주세요.');
    const exists=state.reservations.some(r=>r.game===data.game && r.userId===data.userId);
    if(!exists)throw Error('이미 취소되었거나 해당 회차에 반영된 예약입니다.');
    state.reservations=state.reservations.filter(r=>r.game!==data.game || r.userId!==data.userId);
    if(s?.game===data.game && s.postponed?.includes(data.userId)){s.postponed=s.postponed.filter(id=>id!==data.userId);s.applicants=s.applicants.filter(id=>id!==data.userId);}
  } else if (action === 'open') {
    if (s && s.phase !== 'ended') throw Error('진행 중인 모집을 먼저 종료해 주세요.');
    if (!['lol', 'er'].includes(data.game)) throw Error('게임을 선택해 주세요.');
    if (!Number.isInteger(data.count) || data.count < 1 || data.count > 50) throw Error('모집 인원은 1~50명입니다.');
    const closeMinutes=data.closeMinutes ?? 0;
    if(!Number.isInteger(closeMinutes)||closeMinutes<0||closeMinutes>1440)throw Error('자동 마감 시간은 0~1440분입니다. 0은 수동 마감입니다.');
    if(data.mode && !['rift','aram'].includes(data.mode))throw Error('롤 모드를 확인해 주세요.');
    const title = String(data.title || '시참 모집').trim();
    const description = String(data.description || '참가하기 버튼을 눌러 신청해 주세요.').trim();
    if (!title || title.length > 256 || !description || description.length > 4000) throw Error('제목은 1~256자, 설명은 1~4000자로 입력해 주세요.');
    const round = (state.rounds[data.game] || 0) + 1;
    state.rounds[data.game] = round;
    const due = state.reservations.filter(r => r.game === data.game && r.round <= round);
    state.reservations = state.reservations.filter(r => r.game !== data.game || r.round > round);
    const future = state.reservations.filter(r => r.game === data.game).map(r => r.userId);
    state.session = { closeAt: closeMinutes ? now+closeMinutes*60000 : null, mode:data.mode || 'rift', round, title, description, postponed: future, id: randomUUID(), game: data.game, count: data.count, phase: 'open', applicants: [...new Set([...due.map(r => r.userId), ...future])], winners: [], confirmed: [], excluded: [], teams: [], createdAt: now };
  } else {
    if (!s || s.phase === 'ended') throw Error('진행 중인 모집이 없습니다.');
    if (action === 'join' || action === 'leave' || action === 'postpone_next' || action === 'postpone_later') {
      if (s.phase !== 'open' || (s.closeAt && now >= s.closeAt) || data.sessionId !== s.id) throw Error('모집이 마감됐거나 이전 모집의 버튼입니다.');
      s.postponed ??= [];
      if (action === 'postpone_next' || action === 'postpone_later') {
        if (!s.applicants.includes(data.userId)) throw Error('참가 신청 후 순서를 미룰 수 있습니다.');
        state.reservations = state.reservations.filter(r => r.game !== s.game || r.userId !== data.userId);
        state.reservations.push({game:s.game,userId:data.userId,round:s.round+(action === 'postpone_next' ? 1 : 2)});
        if (!s.postponed.includes(data.userId)) s.postponed.push(data.userId);
      } else {
        state.reservations = state.reservations.filter(r => r.game !== s.game || r.userId !== data.userId);
        s.postponed = s.postponed.filter(id => id !== data.userId);
        if (action === 'leave') s.applicants = s.applicants.filter(id => id !== data.userId);
        else if (!s.applicants.includes(data.userId)) s.applicants.push(data.userId);
      }
    } else if (action === 'close') {
      if (s.phase !== 'open') throw Error('이미 마감된 모집입니다.');
      s.phase = 'closed';
    } else if (action === 'reopen') {
      if(s.phase!=='closed')throw Error('추첨 전 마감 상태에서만 모집을 다시 열 수 있습니다.');
      s.phase='open';s.closeAt=null;
    } else if (action === 'resize') {
      if(!['open','closed'].includes(s.phase))throw Error('추첨 전에만 인원을 바꿀 수 있습니다.');
      if(!Number.isInteger(data.count)||data.count<1||data.count>50)throw Error('모집 인원은 1~50명입니다.');
      s.count=data.count;
    } else if (action === 'edit_post') {
      if(!['open','closed'].includes(s.phase))throw Error('추첨 전에만 모집글을 수정할 수 있습니다.');
      if(typeof data.title!=='string'||!data.title.trim()||data.title.length>256||typeof data.description!=='string'||!data.description.trim()||data.description.length>4000)throw Error('제목 1~256자, 설명 1~4000자로 입력해 주세요.');
      s.title=data.title.trim();s.description=data.description.trim();
    } else if (action === 'draw') {
      if (s.phase !== 'closed') throw Error('모집을 마감한 뒤 추첨해 주세요.');
      const eligible = s.applicants.filter(id => !(s.postponed || []).includes(id));
      if (eligible.length < s.count) throw Error('신청 인원이 부족합니다.');
      const ids = data.ids ?? sample(eligible, s.count);
      if (!Array.isArray(ids) || ids.length !== s.count || new Set(ids).size !== ids.length || ids.some(id => !eligible.includes(id))) throw Error('유효하지 않은 추첨 결과입니다.');
      s.winners = ids; s.confirmed = []; s.teams = []; s.phase = 'drawn';
    } else if (action === 'attendance') {
      if (!['drawn', 'checking'].includes(s.phase)) throw Error('추첨을 먼저 완료해 주세요.');
      if (!Number.isInteger(data.minutes) || data.minutes < 1 || data.minutes > 60) throw Error('확인 시간은 1~60분입니다.');
      if (s.phase === 'checking' && now < s.deadline) throw Error('참석 확인이 이미 진행 중입니다.');
      if(!s.winners.length)throw Error('선정된 참가자가 없습니다.');
      s.deadlineSynced=false;
      s.attendanceVersion=(s.attendanceVersion || 0)+1;
      s.phase = 'checking'; s.deadline = now + data.minutes * 60000;
    } else if (action === 'confirm') {
      if (s.phase !== 'checking' || (data.attendanceVersion !== undefined && data.attendanceVersion !== s.attendanceVersion) || data.sessionId !== s.id || now >= s.deadline || !s.winners.includes(data.userId)) throw Error('현재 참석 확인 대상이 아니거나 시간이 만료됐습니다.');
      if (!s.confirmed.includes(data.userId)) s.confirmed.push(data.userId);
    } else if (action === 'replace') {
      if (s.phase !== 'checking' || now < s.deadline) throw Error('참석 확인 시간이 끝난 뒤 실행해 주세요.');
      const missing = s.winners.filter(id => !s.confirmed.includes(id));
      if (!missing.length) throw Error('추가 추첨할 빈자리가 없습니다.');
      const excluded = [...new Set([...s.excluded, ...missing])];
      const pool = s.applicants.filter(id => (!data.eligibleIds || data.eligibleIds.includes(id)) && !s.winners.includes(id) && !excluded.includes(id) && !(s.postponed || []).includes(id));
      const needed=s.count-s.confirmed.length;
      if(pool.length<needed)throw Error('해당 게임 정보가 등록된 추가 추첨 대상이 부족합니다.');
      s.excluded = excluded;
      const replacements = sample(pool, needed);
      s.winners = [...s.confirmed, ...replacements]; s.teams = []; s.phase = 'drawn';
    } else if (action === 'teams') {
      if (!['checking', 'drawn'].includes(s.phase) || !s.winners.length || s.winners.some(id => !s.confirmed.includes(id))) throw Error('모든 당첨자의 참석 확인을 먼저 완료해 주세요.');
      const records = data.records;
      if(!Array.isArray(records)||records.length!==s.winners.length||records.some(r=>!s.winners.includes(r.discordId)))throw Error('당첨자의 게임 정보를 확인해 주세요.');
      s.teams=balanceTeams(records,s.game,s.mode);
    } else if (action === 'swap') {
      if(!s.teams?.length || data.first===data.second)throw Error('서로 다른 팀의 두 사람을 선택해 주세요.');
      const a=s.teams.findIndex(ids=>ids.includes(data.first)),b=s.teams.findIndex(ids=>ids.includes(data.second));
      if(a<0||b<0||a===b)throw Error('서로 다른 팀의 두 사람을 선택해 주세요.');
      const i=s.teams[a].indexOf(data.first),j=s.teams[b].indexOf(data.second);
      [s.teams[a][i],s.teams[b][j]]=[s.teams[b][j],s.teams[a][i]];
    } else if (action === 'end') {
      const snapshot = structuredClone(s);
      s.phase = 'ended';
      const noShows = snapshot.winners.filter(id => !snapshot.confirmed.includes(id));
      state.sessionArchive.unshift({
        id: snapshot.id,
        round: snapshot.round,
        game: snapshot.game,
        mode: snapshot.mode,
        title: snapshot.title,
        count: snapshot.count,
        phaseBeforeEnd: snapshot.phase,
        createdAt: snapshot.createdAt,
        endedAt: now,
        closeAt: snapshot.closeAt ?? null,
        deadline: snapshot.deadline ?? null,
        applicants: [...snapshot.applicants],
        postponed: [...(snapshot.postponed || [])],
        winners: [...snapshot.winners],
        confirmed: [...snapshot.confirmed],
        excluded: [...(snapshot.excluded || [])],
        noShows,
        teams: (snapshot.teams || []).map(team => [...team])
      });
      state.sessionArchive = state.sessionArchive.slice(0, 50);
    }
    else throw Error('지원하지 않는 작업입니다.');
  }
  state.revision++;
  state.history.unshift({ userId:data.userId || null, details:data.reason || null, round:state.session?.round, game:state.session?.game || data.game, action, at: now, sessionId: state.session?.id, winners: [...(state.session?.winners || [])], applicants: [...(state.session?.applicants || [])], confirmed: [...(state.session?.confirmed || [])] });
  state.history = state.history.slice(0, 200);
  return state;
}
export class OperationsStore extends JsonStore {
  constructor(file) { super(file, {session:null,history:[],reservations:[],sessionArchive:[],rounds:{},revision:0}, value => value && Array.isArray(value.history) && (!value.sessionArchive || Array.isArray(value.sessionArchive)) && (!value.session || (Array.isArray(value.session.applicants) && Array.isArray(value.session.winners) && Array.isArray(value.session.confirmed) && Array.isArray(value.session.teams)))); }
}
