const PHASE_LABELS={open:'모집 중',closed:'마감 · 추첨 대기',drawn:'선정 완료',checking:'참석 확인 중',ended:'종료'};
const GAME_LABELS={er:'이터널 리턴',aram:'칼바람 나락',rift:'소환사의 협곡'};

export function quickStartPreset(kind){
  const presets={
    aram:{game:'lol',mode:'aram',count:10,title:'❄️ 칼바람 시참 모집',description:'칼바람 시참을 시작합니다.\n참가하기를 누르면 신청 명단에 올라가요.\n모집 마감 후 추첨 결과로 참가자를 선정합니다.'},
    rift:{game:'lol',mode:'rift',count:10,title:'⚔️ 협곡 내전 모집',description:'협곡 내전을 시작합니다.\n참가하기를 누르면 신청 명단에 올라가요.\n모집 마감 후 추첨 및 팀 편성을 진행합니다.'},
    er:{game:'er',mode:'rift',count:3,title:'🔷 이터널 리턴 시참 모집',description:'이터널 리턴 시참을 시작합니다.\n참가하기를 누르면 신청 명단에 올라가요.\n모집 마감 후 추첨 결과로 참가자를 선정합니다.'}
  };
  return presets[kind]?structuredClone(presets[kind]):null;
}

export function buildLiveModeModel({derived,reservations=[],health=null,liveState='connecting',now=Date.now()}={}){
  const d=derived||{},s=d.s||null,active=Boolean(d.active);
  const ready=d.ready||[],pending=d.pending||[];
  const game=s?.game==='er'?GAME_LABELS.er:s?.mode==='aram'?GAME_LABELS.aram:GAME_LABELS.rift;
  const allowed={
    close:s?.phase==='open',
    reopen:s?.phase==='closed',
    draw:s?.phase==='closed'&&ready.length>=(s?.count||1),
    attendance:active&&(s?.winners||[]).length>0&&['drawn','checking'].includes(s?.phase)&&(s?.phase!=='checking'||now>=Number(s?.deadline||0)),
    replace:s?.phase==='checking'&&now>=Number(s?.deadline||0)&&(s?.winners||[]).some(id=>!(s?.confirmed||[]).includes(id)),
    teams:active&&(s?.winners||[]).length>0&&(s?.winners||[]).every(id=>(s?.confirmed||[]).includes(id)),
    reshuffle:active&&(s?.teams||[]).length>1&&(s?.winners||[]).length>0&&(s?.winners||[]).every(id=>(s?.confirmed||[]).includes(id)),
    publish:Boolean(s),
    voice:active&&(s?.teams||[]).length>0,
    end:active
  };
  let next={title:'새 방송 시참 준비',text:'게임 프리셋으로 바로 시작하거나 상세 설정을 열 수 있습니다.',label:'상세 설정 열기',action:'configure',disabled:false};
  if(s?.phase==='open')next=ready.length>=(s.count||1)?{title:'모집 인원 준비 완료',text:`유효 참가자 ${ready.length}명입니다. 모집을 마감하고 추첨을 준비하세요.`,label:'모집 마감',action:'close',disabled:false}:{title:'참가자 모집 중',text:`유효 참가자 ${ready.length}/${s.count||0}명입니다. 신청을 더 기다리세요.`,label:'Discord 동기화',action:'publish',disabled:false};
  if(s?.phase==='closed')next=allowed.draw?{title:'추첨 준비 완료',text:`${ready.length}명 중 ${s.count||0}명을 선정합니다.`,label:'추첨 시작',action:'draw',disabled:false}:{title:'추첨 인원 부족',text:`현재 ${ready.length}/${s.count||0}명입니다. 모집을 다시 열어 주세요.`,label:'모집 다시 열기',action:'reopen',disabled:false};
  if(s?.phase==='drawn')next={title:'당첨자 선정 완료',text:`${(s.winners||[]).length}명에게 참석 확인을 요청하세요.`,label:'참석 확인 시작',action:'attendance',disabled:!allowed.attendance};
  if(s?.phase==='checking'){
    if(pending.length&&now<Number(s.deadline||0))next={title:'참석 응답 대기',text:`${pending.length}명의 응답을 기다리는 중입니다.`,label:'응답 대기 중',action:'',disabled:true};
    else if(pending.length)next={title:'빈자리 처리 필요',text:`미응답 ${pending.length}명이 있습니다. 추가 추첨으로 교체할 수 있습니다.`,label:'빈자리 재추첨',action:'replace',disabled:!allowed.replace};
    else if(!(s.teams||[]).length)next={title:'전원 참석 완료',text:'확정 참가자로 팀을 자동 편성할 수 있습니다.',label:'팀 자동 편성',action:'teams',disabled:!allowed.teams};
    else next={title:'팀 편성 완료',text:'음성방 생성 또는 회차 종료를 진행할 수 있습니다.',label:'팀 음성방 생성',action:'voice',disabled:!allowed.voice};
  }
  if(s?.phase==='ended')next={title:'회차 종료됨',text:'새 방송 시참을 시작할 수 있습니다.',label:'상세 설정 열기',action:'configure',disabled:false};
  const phaseLabel=s?PHASE_LABELS[s.phase]||s.phase:'대기';
  return {
    active,title:active?`${s.round||1}판 · ${game}`:'방송 운영 대기',
    subtitle:active?String(s.title||'시참 모집'):'방송 중 필요한 시참 기능을 큰 버튼으로 빠르게 조작합니다.',
    phaseLabel,roundLabel:s?`${s.round||1}판`:'—',gameLabel:s?game:'대기 중',
    allowed,next,reservationCount:reservations.length,
    connection:{discord:Boolean(health?.connected),live:liveState==='live'}
  };
}
