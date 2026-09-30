const PHASE_LABELS={open:'모집 중',closed:'마감 · 추첨 대기',drawn:'선정 완료',checking:'참석 확인 중',ended:'종료'};
const GAME_LABELS={aram:'칼바람 나락',rift:'소환사의 협곡',er:'이터널 리턴'};

export function mobileDisplayName(entry={}){
  return String(entry.displayName||entry.chzzkName||entry.discordUsername||'알 수 없음').trim()||'알 수 없음';
}

function count(session,key,countKey){return Array.isArray(session?.[key])?session[key].length:Math.max(0,Number(session?.[countKey])||0);}
function capability(snapshot,name){const access=snapshot.access||{};return access.role!=='operator'||(Array.isArray(access.capabilities)&&access.capabilities.includes(name));}

export function buildMobileControlModel(snapshot={},now=Date.now()){
  const state=snapshot.state||{},session=state.session||null,queue=snapshot.participationQueue||{entries:[],counts:{},activeCount:0,currentCall:null};
  const calls=snapshot.participationCalls||{timeoutSeconds:60,current:null};
  const entries=Array.isArray(queue.entries)?queue.entries:[];
  const currentCall=calls.current||queue.currentCall||null;
  const activeEntries=entries.filter(entry=>!['cancelled','no_show'].includes(entry.status));
  const waiting=activeEntries.filter(entry=>entry.status==='waiting').sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0));
  const joined=activeEntries.filter(entry=>entry.status==='joined');
  const winnerCount=count(session,'winners','winnerCount'),confirmedCount=count(session,'confirmed','confirmedCount'),teamCount=count(session,'teams','teamCount');
  const applicantCount=count(session,'applicants','applicantCount'),postponedCount=count(session,'postponed','postponedCount');
  const unconfirmedWinnerCount=Number.isFinite(Number(session?.unconfirmedWinnerCount))?Math.max(0,Number(session.unconfirmedWinnerCount)):Math.max(0,winnerCount-confirmedCount);
  const deadline=Number(currentCall?.callDeadline||currentCall?.deadline||0);
  const callSeconds=currentCall&&deadline?Math.max(0,Math.ceil((deadline-now)/1000)):null;
  const gameKey=session?.game==='er'?'er':session?.mode==='aram'?'aram':'rift';
  const readyCount=session?Math.max(0,applicantCount-postponedCount):waiting.length+joined.length;
  const target=Number(session?.count)||0;
  const phase=session?.phase||'idle';
  const attendanceReady=Boolean(session)&&winnerCount>0&&['drawn','checking'].includes(phase)&&(phase!=='checking'||now>=Number(session.deadline||0));
  const replaceReady=phase==='checking'&&now>=Number(session?.deadline||0)&&unconfirmedWinnerCount>0;
  const teamReady=Boolean(session)&&winnerCount>0&&winnerCount===confirmedCount;
  const queueAllowed=capability(snapshot,'queue'),liveAllowed=capability(snapshot,'live'),discordAllowed=capability(snapshot,'discord');
  const actions={
    callNext:queueAllowed&&!currentCall&&waiting.length>0,
    joined:queueAllowed&&Boolean(currentCall),
    pass:queueAllowed&&Boolean(currentCall),
    noShow:queueAllowed&&Boolean(currentCall),
    close:liveAllowed&&phase==='open',
    reopen:liveAllowed&&phase==='closed',
    draw:liveAllowed&&phase==='closed'&&readyCount>=Math.max(1,target),
    attendance:liveAllowed&&attendanceReady,
    replace:liveAllowed&&replaceReady,
    teams:liveAllowed&&teamReady,
    reshuffle:liveAllowed&&teamReady&&teamCount>1,
    publish:discordAllowed&&Boolean(session),
    end:liveAllowed&&Boolean(session)&&phase!=='ended'
  };
  let primary=snapshot.access?.role==='operator'?{action:'none',label:'현재 수행할 작업 없음',hint:'운영자에게 부여된 권한 범위에서 사용할 수 있는 작업만 표시됩니다.'}:{action:'full',label:'전체 대시보드 열기',hint:'새 시참 세션은 전체 대시보드에서 시작하세요.'};
  if(currentCall&&actions.joined)primary={action:'joined',label:`✓ ${mobileDisplayName(currentCall)} 참가 확인`,hint:callSeconds===null?'호출 응답 대기 중':`응답까지 ${callSeconds}초 남음`};
  else if(actions.callNext)primary={action:'callNext',label:'🔔 다음 참가자 호출',hint:`대기 ${waiting.length}명 · ${mobileDisplayName(waiting[0])}님이 다음 순번입니다.`};
  else if(actions.close)primary={action:'close',label:'🔒 모집 마감',hint:`현재 ${readyCount}/${target||'—'}명`};
  else if(actions.draw)primary={action:'draw',label:'🎲 추첨 시작',hint:`${readyCount}명 중 ${target}명 선정`};
  else if(actions.attendance)primary={action:'attendance',label:'✅ 참석 확인 시작',hint:`당첨 ${winnerCount}명`};
  else if(actions.replace)primary={action:'replace',label:'🔁 빈자리 재추첨',hint:'미응답 당첨자를 교체할 수 있습니다.'};
  else if(actions.teams&&teamCount===0)primary={action:'teams',label:'👥 팀 자동 편성',hint:`참석 ${confirmedCount}명 확정`};
  else if(actions.end)primary={action:'end',label:'■ 회차 종료',hint:'현재 회차를 아카이브하고 종료합니다.'};
  return {
    session,
    phase,
    phaseLabel:PHASE_LABELS[phase]||'대기',
    gameLabel:session?GAME_LABELS[gameKey]:'대기 중',
    roundLabel:session?`${Number(session.round)||1}판`:'—',
    target,
    readyCount,
    winnersCount:winnerCount,
    confirmedCount,
    waitingCount:waiting.length,
    joinedCount:joined.length,
    currentCall,
    callSeconds,
    waiting:waiting.slice(0,8),
    actions,
    primary,
    live:Boolean(snapshot.chzzkLive?.state?.lastKnownLive),
    access:snapshot.access||{role:'admin',user:'admin',capabilities:['live','queue','broadcast','discord']},
    serverTime:Number(snapshot.serverTime)||now,
    version:String(snapshot.version||'—')
  };
}

export function mobileControlSyncState({online=true,connected=false,lastEventAt=0,now=Date.now(),maxAgeMs=35000}={}){
  const ageMs=lastEventAt?Math.max(0,Number(now)-Number(lastEventAt)):Infinity;
  const stale=!Number.isFinite(ageMs)||ageMs>Math.max(5000,Number(maxAgeMs)||35000);
  const safe=Boolean(online)&&Boolean(connected)&&!stale;
  return {
    safe,
    online:Boolean(online),
    connected:Boolean(connected),
    stale,
    ageMs:Number.isFinite(ageMs)?ageMs:null,
    label:!online?'오프라인':!connected?'재연결 중':stale?'동기화 지연':'실시간 연결',
    hint:safe?'PC/다른 모바일과 최신 상태가 동기화되었습니다.':!online?'네트워크 연결이 끊겨 제어를 잠갔습니다.':!connected?'실시간 연결을 복구하는 동안 제어를 잠갔습니다.':'마지막 서버 이벤트가 오래되어 제어를 잠갔습니다.'
  };
}

export function mobileActionConfirmation(action,currentName=''){
  const name=String(currentName||'참가자').trim()||'참가자';
  const messages={
    draw:'현재 인원으로 추첨을 시작할까요?',
    replace:'미응답 당첨자를 빈자리 재추첨으로 교체할까요?',
    reshuffle:'현재 팀 편성을 새 조합으로 다시 섞을까요?',
    end:'현재 회차를 종료하고 기록을 아카이브할까요?',
    noShow:`${name}님을 노쇼 처리할까요?`
  };
  return messages[action]||'';
}
