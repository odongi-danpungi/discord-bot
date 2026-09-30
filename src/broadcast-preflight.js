const MINUTE=60*1000;
const finite=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const text=(value,max=180)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const recent=(at,windowMs,now)=>finite(at)>0&&now-finite(at)>=0&&now-finite(at)<=windowMs;
const rank={pass:0,warn:1,fail:2};
const worst=(checks=[])=>checks.reduce((value,item)=>rank[item.status]>rank[value]?item.status:value,'pass');

function policyDrift(policy={}){
  const state=policy.monitorState||policy.state||{},ack=policy.acknowledgement||{},maintenance=policy.maintenance||{};
  const digest=state.lastComparisonDigest||'';
  return Boolean(policy.baseline&&policy.monitor?.enabled&&state.lastComparisonStatus==='drift'&&!maintenance.active&&!(ack.digest&&ack.digest===digest));
}

function activeSession(state={}){
  const session=state.session;
  return session&&session.phase!=='ended'?session:null;
}

function sessionCheck({state,records=[],chzzkLive,queue,now}){
  const session=activeSession(state),live=chzzkLive?.state?.lastKnownLive===true;
  if(!session){
    if(live)return {id:'participation-session',label:'시참 회차',status:'warn',detail:'CHZZK 방송은 LIVE지만 진행 중인 시참 회차가 없습니다.',target:'operate'};
    return {id:'participation-session',label:'시참 회차',status:'pass',detail:'진행 중인 시참 회차 없음 · 방송만 진행하거나 새 모집을 시작할 수 있습니다.',target:'operate'};
  }
  const applicants=Array.isArray(session.applicants)?session.applicants:[],postponed=new Set(Array.isArray(session.postponed)?session.postponed:[]),target=Math.max(0,finite(session.count));
  const byId=new Map((Array.isArray(records)?records:[]).map(item=>[String(item.discordId||''),item]));
  const hasGame=(id)=>{const profile=byId.get(String(id));if(!profile)return false;return session.game==='er'?Boolean(profile.erNickname):Boolean(profile.lolRiotId);};
  const ready=applicants.filter(id=>!postponed.has(id)&&hasGame(id)).length;
  if(session.phase==='open'&&target>0&&ready<target)return {id:'participation-session',label:'시참 회차',status:'warn',detail:`${session.round||1}판 모집 중 · 추첨 가능 ${ready}/${target}명 · 목표 인원까지 ${target-ready}명 부족`,target:'live'};
  if(session.phase==='checking'&&Array.isArray(session.winners)){const confirmed=new Set(Array.isArray(session.confirmed)?session.confirmed:[]),pending=session.winners.filter(id=>!confirmed.has(id)).length;if(pending)return {id:'participation-session',label:'시참 회차',status:'warn',detail:`${session.round||1}판 참석 확인 중 · 응답 대기 ${pending}명`,target:'live'};}
  const activeQueue=Math.max(0,finite(queue?.activeCount));
  return {id:'participation-session',label:'시참 회차',status:'pass',detail:`${session.round||1}판 ${text(session.phase,30)} · 통합 Queue ${activeQueue}명`,target:'live'};
}

export function buildBroadcastPreflight({
  state={},records=[],participationQueue={},participationCalls={},chzzkLive={},broadcastOps={},runtime={},incidents={},emergency={},discord=null,discordPolicy={},naver={},naverParticipation={},demo=false,now=Date.now()
}={}){
  const checks=[];const add=(id,label,status,detail,target='runtime')=>checks.push({id,label,status,detail:text(detail,220),target});
  const locked=Boolean(emergency?.locked);
  add('emergency','긴급 운영 잠금',locked?'fail':'pass',locked?(text(emergency?.reason)||'Emergency Operation Lock이 활성화되어 일반 운영 변경이 차단됩니다.'):'긴급 운영 잠금이 해제되어 있습니다.','recovery');

  const incidentCounts=incidents?.counts||{},critical=Math.max(0,finite(incidentCounts.critical)),active=Math.max(0,finite(incidentCounts.totalActive)||finite(incidentCounts.open)+finite(incidentCounts.acknowledged));
  add('incidents','활성 장애',critical?'fail':active?'warn':'pass',critical?`CRITICAL 장애 ${critical}건 · 방송 시작 전에 장애 센터에서 확인이 필요합니다.`:active?`활성 장애 ${active}건 · 현재 영향 범위를 확인하세요.`:'활성 장애가 없습니다.','incidents');

  if(demo)add('discord','Discord 연결','pass','연습 모드 · 실제 Discord 연결 점검을 생략합니다.','runtime');
  else if(discord?.connected===true)add('discord','Discord 연결','pass','최근 Discord 진단에서 봇 연결이 정상입니다.','discordaudit');
  else if(discord?.connected===false)add('discord','Discord 연결','fail','최근 Discord 진단에서 연결 또는 서버 권한 확인이 필요합니다.','discordaudit');
  else add('discord','Discord 연결','warn','최근 Discord 진단 결과가 없습니다. 방송 전 상태 새로고침을 실행하세요.','discordaudit');

  const runtimeStatus=['pass','warn','fail'].includes(runtime?.status)?runtime.status:'warn';
  add('runtime','Runtime Health',runtimeStatus,runtimeStatus==='pass'?'서버 런타임 상태가 정상입니다.':runtimeStatus==='warn'?'최근 런타임 경고가 있습니다. Runtime Health를 확인하세요.':'최근 서버/API 오류가 감지되었습니다. 방송 시작 전에 Runtime Health를 확인하세요.','runtime');

  const persistence=runtime?.persistence||{};
  let storageStatus='pass',storageDetail='최근 저장 실패·손상·내구성 경고가 없습니다.';
  if(recent(persistence.lastFailureAt,10*MINUTE,now)){storageStatus='fail';storageDetail='최근 10분 내 데이터 읽기/쓰기 실패가 감지되었습니다.';}
  else if(recent(persistence.lastCorruptionAt,30*MINUTE,now)||recent(persistence.lastDurabilityWarningAt,30*MINUTE,now)||recent(persistence.lastRecoveryAt,30*MINUTE,now)){storageStatus='warn';storageDetail='최근 30분 내 파일 복구·손상·내구성 경고 이력이 있습니다.';}
  add('storage','데이터 저장소',storageStatus,storageDetail,'recovery');

  const connectorConfigured=Boolean(chzzkLive?.connector?.configured),chzzkState=chzzkLive?.state||{};
  let chzzkStatus='pass',chzzkDetail='CHZZK 공식 Open API 상태 감지가 준비되어 있습니다.';
  if(!connectorConfigured){chzzkStatus='warn';chzzkDetail='CHZZK 공식 Open API 연결이 설정되지 않아 방송 시작/종료 자동 감지를 사용할 수 없습니다.';}
  else if(chzzkState.lastStatus==='fail'){chzzkStatus='warn';chzzkDetail='최근 CHZZK 방송 상태 확인에 실패했습니다. 방송 전 수동 상태 확인을 권장합니다.';}
  else if(chzzkState.lastStatus==='warn'){chzzkStatus='warn';chzzkDetail='최근 CHZZK 방송 상태가 확정되지 않았습니다.';}
  else if(chzzkState.lastKnownLive===true){chzzkDetail=`CHZZK LIVE 감지됨${chzzkLive.currentLive?.liveTitle?` · ${text(chzzkLive.currentLive.liveTitle,100)}`:''}`;}
  else if(!chzzkState.baselineReady){chzzkStatus='warn';chzzkDetail='CHZZK 라이브 기준선이 아직 준비되지 않았습니다.';}
  add('chzzk','CHZZK 방송 감지',chzzkStatus,chzzkDetail,'live');

  if(policyDrift(discordPolicy))add('discord-policy','Discord 기준선','warn','확인되지 않은 Discord 권한/채널/명령 Drift가 있습니다.','discordaudit');
  else add('discord-policy','Discord 기준선','pass',discordPolicy?.baseline?'저장된 기준선에 미확인 Drift가 없습니다.':'Discord 기준선 감시는 선택 기능이며 현재 방송을 차단하지 않습니다.','discordaudit');

  checks.push(sessionCheck({state,records,chzzkLive,queue:participationQueue,now}));

  const currentCall=participationQueue?.currentCall||participationCalls?.current||null;
  if(currentCall){const deadline=finite(currentCall.callDeadline||currentCall.deadline),seconds=deadline?Math.max(0,Math.ceil((deadline-now)/1000)):0;add('participant-call','참가자 호출','warn',`${text(currentCall.displayName)||'참가자'} 응답 대기${deadline?` · ${seconds}초 남음`:''}`,'live');}
  else add('participant-call','참가자 호출','pass','응답 대기 중인 참가자 호출이 없습니다.','live');

  const naverOpen=Boolean(naverParticipation?.registrationOpen),naverConnected=Boolean(naver?.connected);
  if(naverOpen&&!naverConnected)add('naver','Naver Cafe 시참','warn','Naver 시참 접수는 열려 있지만 OAuth 연결 상태를 확인해야 합니다.','settings');
  else if(naverOpen)add('naver','Naver Cafe 시참','pass',`Naver 시참 접수 중 · 대기 ${Math.max(0,finite(naverParticipation?.counts?.queued))}명`,'live');
  else add('naver','Naver Cafe 시참','pass',naverConnected?'Naver Cafe 연결됨 · 현재 시참 접수는 닫혀 있습니다.':'Naver Cafe 연동은 선택 기능이며 현재 접수는 닫혀 있습니다.','settings');

  const schedule=broadcastOps?.nextSchedule||null;
  if(schedule&&finite(schedule.startAt)>=now){const minutes=Math.round((finite(schedule.startAt)-now)/MINUTE);add('schedule','다음 방송 일정','pass',`${text(schedule.title,100)||'방송 일정'} · ${minutes<=180?`${minutes}분 후`:'예정됨'}`,'live');}
  else add('schedule','다음 방송 일정','pass','임박한 등록 일정이 없습니다. 일정 등록은 선택 사항입니다.','live');

  const status=worst(checks),blockers=checks.filter(item=>item.status==='fail'),warnings=checks.filter(item=>item.status==='warn'),passes=checks.filter(item=>item.status==='pass');
  const first=blockers[0]||warnings[0]||null,session=activeSession(state),isLive=chzzkState.lastKnownLive===true;
  const recommendation=first?{title:first.label,text:first.detail,target:first.target,label:first.status==='fail'?'문제 확인':'확인하기',tone:first.status==='fail'?'danger':'warn'}:session||isLive?{title:'방송 운영 계속',text:'주요 사전 점검 항목이 모두 정상입니다.',target:'live',label:'라이브 모드',tone:'primary'}:{title:'방송 준비 완료',text:'주요 사전 점검 항목이 모두 정상입니다. 다음 방송을 준비할 수 있습니다.',target:'operate',label:'컨트롤 센터',tone:'primary'};
  return {
    version:1,checkedAt:now,status,ready:status!=='fail',mode:isLive?'live':session?'session':'prelive',counts:{pass:passes.length,warn:warnings.length,fail:blockers.length,total:checks.length},checks,recommendation,
    summary:blockers.length?`방송 전 해결 필요 ${blockers.length}건 · 주의 ${warnings.length}건`:warnings.length?`방송 가능 · 주의 ${warnings.length}건 확인 권장`:'방송 시작 전 주요 점검 통과'
  };
}
