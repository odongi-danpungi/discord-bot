export const phaseLabels={open:'모집 중',closed:'모집 마감',drawn:'선정 완료',checking:'참석 확인',ended:'종료'};
export const actionLabels={open:'모집 시작',close:'모집 마감',reopen:'모집 다시 열기',resize:'인원 변경',edit_post:'모집글 수정',draw:'게임 추첨',replace:'빈자리 추첨',attendance:'참석 확인',confirm:'참석 완료',teams:'팀 자동 편성',swap:'팀원 교환',end:'모집 종료',join:'참가',leave:'신청 취소',postpone_next:'다음 판 예약',postpone_later:'다다음 판 예약',cancel_reservation:'예약 취소',voice:'음성방 생성',setup:'채널 설정'};
const button=(id,label,style=2,disabled=false)=>({type:2,custom_id:id,label,style,disabled});
export function recruitmentCard(session,now=Date.now()) {
  const closed=session.phase!=='open'||Boolean(session.closeAt&&now>=session.closeAt),eligible=session.applicants.filter(id=>!(session.postponed||[]).includes(id)).length;
  return {content:'',embeds:[{title:session.title||'시참 모집',description:session.description||'참가하기를 눌러 신청해 주세요.',color:closed?0x747f8d:0x8bc45c,fields:[{name:'현재 모집',value:`${session.round||1}판 · ${phaseLabels[session.phase]} · 신청 ${eligible}명 / 선정 ${session.count}명${session.closeAt?`\n마감 <t:${Math.floor(session.closeAt/1000)}:R>`:''}`}],footer:{text:'다음/다다음 판은 같은 게임 기준 · 참가하기로 복귀 · 빠지기로 예약 취소'}}],components:[{type:1,components:[
    button(`roster:join:${session.id}`,'⚔️ 참가하기',1,closed),
    button(`roster:postpone_next:${session.id}`,'⏭️ 다음 판으로 미루기',2,closed),
    button(`roster:postpone_later:${session.id}`,'⏩ 다다음 판으로 미루기',2,closed),
    button(`roster:leave:${session.id}`,'👋 빠지기',2,closed)
  ]}],allowedMentions:{parse:[]}};
}
export function attendanceCard(session,now=Date.now()) {
  const disabled=session.phase!=='checking'||now>=session.deadline,remaining=session.winners.filter(id=>!session.confirmed.includes(id));
  return {content:`**당첨자 참석 확인**\n${session.winners.map(id=>`<@${id}> ${session.confirmed.includes(id)?'✅':'⌛'}`).join('\n') || '선정된 참가자 없음'}\n확인 ${session.confirmed.length}/${session.winners.length}명 · <t:${Math.floor(session.deadline/1000)}:R>`,embeds:[],components:[{type:1,components:[button(`roster:confirm:${session.id}:${session.attendanceVersion||0}`,'준비 완료',3,disabled)]}],allowedMentions:{parse:[],users:disabled?[]:remaining}};
}
export function resultCard(session) {
  const body=session.teams.length?session.teams.map((ids,i)=>`**팀 ${i+1}**\n${ids.map(id=>`<@${id}>`).join(' ')}`).join('\n\n'):`**추첨 결과**\n${session.winners.map(id=>`<@${id}>`).join(' ')||'선정된 참가자 없음'}\n선정 ${session.winners.length}/${session.count}명`;
  return {content:body,components:[],embeds:[],allowedMentions:{parse:[]}};
}
export const registrationPanel={content:'**댕댕봇 사용자 연동**\n치지직 이름과 사용하는 게임 정보를 등록해 주세요. 운영자가 확인할 수 있으며 계정 소유 인증이나 자동 전적 조회는 하지 않습니다.',components:[{type:1,components:[button('register_start','사용자 연동 / 수정',1),button('profile_view','내 정보 확인'),button('reservation_view','내 다음 판 예약'),button('guide:start','처음 참여 가이드'),button('avatar_access','내 레이스 색상',1)]}],allowedMentions:{parse:[]}};
