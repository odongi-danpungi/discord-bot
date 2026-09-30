export function recommendedAction({s,ready=[],pending=[],active=Boolean(s&&s.phase!=='ended')},now=Date.now()){
  if(!active)return {action:'open',title:'새 모집 시작',text:'모집 설정과 Discord 미리보기를 확인한 뒤 게시하세요.',label:'모집 시작',disabled:false};
  if(s.phase==='open'){
    const enough=ready.length>=s.count;
    return {action:'close',title:enough?'모집 인원 충족':'신청자 대기 중',text:enough?`유효 참가자 ${ready.length}명으로 추첨 조건을 충족했습니다.`:`유효 참가자가 ${Math.max(0,s.count-ready.length)}명 더 필요합니다.`,label:'모집 마감',disabled:!enough};
  }
  if(s.phase==='closed'){
    const enough=ready.length>=s.count;
    return enough?{action:'draw',title:'추첨 준비 완료',text:'현재 추첨 게임 설정으로 결과를 생성합니다.',label:'추첨 시작',disabled:false}:{action:'reopen',title:'유효 신청자 부족',text:`${Math.max(0,s.count-ready.length)}명을 더 받아야 합니다.`,label:'모집 다시 열기',disabled:false};
  }
  if(s.phase==='drawn')return {action:'attendance',title:'당첨자 참석 확인',text:'당첨자에게 준비 완료 버튼을 보내고 응답을 기다립니다.',label:'준비 완료 요청',disabled:false};
  if(s.phase==='checking'){
    // Everyone can proceed immediately; there is no reason to wait for the deadline after all winners confirmed.
    if(!pending.length){
      if(!(s.teams||[]).length)return {action:'teams',title:'팀 편성 준비 완료',text:'모든 당첨자의 참석 확인이 끝났습니다.',label:'팀 자동 편성',disabled:false};
      return {action:'end',title:'이번 회차 마무리',text:'팀 편성이 완료됐습니다. 종료하면 회차 아카이브에 저장됩니다.',label:'회차 종료',disabled:false};
    }
    if(now<s.deadline)return {action:null,title:'참석 확인 진행 중',text:`${pending.length}명의 응답을 기다리는 중입니다.`,label:'응답 대기',disabled:true};
    return {action:'replace',title:'미응답 빈자리 처리',text:`미응답 ${pending.length}명을 제외하고 빈자리를 추가 추첨합니다.`,label:'빈자리 추첨',disabled:false};
  }
  return {action:null,title:'상태 확인 필요',text:'운영 상태를 새로고침해 주세요.',label:'확인 중',disabled:true};
}
