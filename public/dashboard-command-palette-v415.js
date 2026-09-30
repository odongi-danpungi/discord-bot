import { DASHBOARD_TABS } from './dashboard-shell.js';

const TAB_KEYWORDS=Object.freeze({
  home:['홈','대시보드','요약','상태','방송 운영','overview','dashboard'],
  preflight:['방송 준비','사전 점검','체크리스트','go live','preflight','준비 상태','방송 시작 전'],
  runbook:['runbook','런북','운영 절차','체크리스트','인수인계','handoff','교대','방송 전','방송 후'],
  broadcastarchive:['방송 아카이브','방송 기록','종료 보고서','방송 리포트','성과 비교','통계 추세','운영 인사이트','performance','trend','insight','post show','post-show','report','archive','closeout'],
  live:['라이브','실시간','호출','queue','큐','시참','방송 중','live'],
  operate:['컨트롤','시참','모집','추첨','참석','팀 편성','게임','operation','control'],
  broadcast:['방송 장면','obs','overlay','오버레이','scene','프리셋','broadcast'],
  members:['참가자','멤버','사용자','닉네임','프로필','member','participant'],
  history:['기록','히스토리','회차','운영 기록','archive','history'],
  recovery:['복구','감사','백업','체크포인트','긴급 잠금','restore','recovery','audit'],
  runtime:['런타임','상태','health','sse','서버','discord 연결','runtime'],
  incidents:['장애','incident','경고','critical','담당','해결','워크플로'],
  capacity:['성능','용량','메모리','event loop','sse 용량','capacity','performance'],
  deployment:['배포','production','readiness','deploy','railway','환경','go-live','실서비스','실서비스 시작','최종 배포','운영환경','host bootstrap','호스트','https','reverse proxy','health check','헬스체크','환경 변수','환경변수','env','oauth redirect','비밀값 검증','production acceptance','acceptance','cutover','최종 production 검증','실서비스 승인','post-cutover','post cutover','smoke','stabilization','안정화','트래픽 전환','cutover smoke'],
  release:['릴리스','업데이트','update','rollback','stage','release'],
  supply:['의존성','공급망','dependency','npm','package','supply chain'],
  discordaudit:['discord','디스코드','권한','설치','intent','drift','감사','audit'],
  settings:['설정','연결','백업','naver','네이버','카페','oauth','chzzk','치지직','환경 설정','settings']
});

const EXTERNAL_COMMANDS=Object.freeze([
  {id:'external-mobile',type:'link',label:'모바일 Live Control',description:'휴대폰용 방송 운영 화면 열기',section:'방송 운영',href:'/mobile-control.html',newTab:true,keywords:['모바일','휴대폰','phone','live control','mobile']},
  {id:'external-studio',type:'link',label:'전체 화면 게임 스튜디오',description:'추첨·게임 스튜디오 화면 열기',section:'방송 운영',href:'/game-studio.html',newTab:false,keywords:['게임','스튜디오','race','레이스','studio']},
  {id:'external-overlay',type:'link',label:'방송·OBS 화면',description:'OBS Browser Source 화면 열기',section:'방송 운영',href:'/broadcast/',newTab:true,keywords:['obs','overlay','오버레이','브라우저 소스','방송 화면']}
]);

const SAFE_ACTIONS=Object.freeze([
  {id:'action-refresh-page',type:'action',action:'refresh-page',label:'현재 화면 새로고침',description:'현재 페이지의 읽기 데이터를 다시 불러옵니다',section:'빠른 작업',shortcut:'R',keywords:['새로고침','refresh','reload','동기화','sync']},
  {id:'action-refresh-all',type:'action',action:'refresh-all',label:'전체 운영 상태 새로고침',description:'Snapshot과 연결 상태를 안전하게 다시 확인합니다',section:'빠른 작업',keywords:['전체','상태','새로고침','refresh all','health','snapshot']}
]);

const compact=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s._\-/:·↗]+/g,' ').trim();
const dense=value=>compact(value).replace(/\s+/g,'');

export function buildDashboardCommandCatalog(){
  const tabs=Object.entries(DASHBOARD_TABS).map(([target,meta])=>({
    id:`tab-${target}`,type:'tab',target,label:meta.title,description:`${meta.section} 페이지로 이동`,section:meta.section,shortcut:meta.shortcut||'',keywords:TAB_KEYWORDS[target]||[]
  }));
  return [...tabs,...SAFE_ACTIONS,...EXTERNAL_COMMANDS].map(item=>Object.freeze({...item,keywords:Object.freeze([...(item.keywords||[])])}));
}

export const DASHBOARD_COMMAND_CATALOG=Object.freeze(buildDashboardCommandCatalog());

function scoreCommand(command,query){
  const q=compact(query),qd=dense(query);if(!q)return 0;
  const tokens=q.split(' ').filter(Boolean);
  const label=compact(command.label),labelDense=dense(command.label),description=compact(command.description),section=compact(command.section),keywords=(command.keywords||[]).map(compact);
  const hay=[label,description,section,...keywords].join(' '),hayDense=dense(hay);
  if(!tokens.every(token=>hay.includes(token)||hayDense.includes(dense(token))))return -1;
  let score=10;
  if(label===q||labelDense===qd)score+=1000;
  else if(label.startsWith(q)||labelDense.startsWith(qd))score+=500;
  else if(label.includes(q)||labelDense.includes(qd))score+=260;
  for(const keyword of keywords){const kd=dense(keyword);if(keyword===q||kd===qd)score+=180;else if(keyword.startsWith(q)||kd.startsWith(qd))score+=90;else if(keyword.includes(q)||kd.includes(qd))score+=45;}
  if(section.includes(q)||dense(section).includes(qd))score+=30;
  score+=Math.max(0,50-label.length);
  return score;
}

export function searchDashboardCommands(query,{limit=10,catalog=DASHBOARD_COMMAND_CATALOG}={}){
  const q=compact(query);
  if(!q){
    const defaults=['tab-home','tab-live','tab-operate','action-refresh-page','external-mobile','tab-runtime','tab-recovery'];
    const order=new Map(defaults.map((id,index)=>[id,index]));
    return [...catalog].sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999)).slice(0,limit);
  }
  return catalog.map(command=>({command,score:scoreCommand(command,q)})).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score||a.command.label.localeCompare(b.command.label,'ko')).slice(0,limit).map(item=>item.command);
}

export function commandById(id,catalog=DASHBOARD_COMMAND_CATALOG){return catalog.find(item=>item.id===id)||null;}
