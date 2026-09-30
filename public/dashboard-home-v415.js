const PHASE_LABELS={open:'모집 중',closed:'마감 · 추첨 대기',drawn:'선정 완료',checking:'참석 확인 중',ended:'종료'};

const finite=value=>Number.isFinite(Number(value))?Number(value):0;
const clean=value=>String(value??'').trim();

function voteCount(option){
  if(Array.isArray(option?.votes))return option.votes.length;
  return Math.max(0,finite(option?.voteCount));
}

function nextSchedule(hub,now){
  if(hub?.nextSchedule&&finite(hub.nextSchedule.startAt)>=now)return hub.nextSchedule;
  return (Array.isArray(hub?.schedules)?hub.schedules:[])
    .filter(item=>item?.status==='scheduled'&&finite(item.startAt)>=now)
    .sort((a,b)=>finite(a.startAt)-finite(b.startAt))[0]||null;
}

export function buildDashboardHomeModel({
  state={},derived={},participationQueue={},participationCalls={},broadcastOps={},chzzkLive={},health=null,
  liveState='connecting',incidentSummary=null,policyMonitor=null,emergency=null,demo=false,now=Date.now()
}={}){
  const session=state?.session||null,active=Boolean(derived?.active ?? (session&&session.phase!=='ended'));
  const readyCount=Math.max(0,finite(derived?.readyCount)),missingCount=Math.max(0,finite(derived?.missingCount));
  const pendingCount=Math.max(0,finite(derived?.pendingCount)),postponedCount=Math.max(0,finite(derived?.postponedCount));
  const queueEntries=(Array.isArray(participationQueue?.entries)?participationQueue.entries:[]).filter(item=>!['cancelled','no_show'].includes(item?.status));
  const currentCall=participationQueue?.currentCall||participationCalls?.current||null;
  const deadline=finite(currentCall?.callDeadline||currentCall?.deadline),callSeconds=currentCall&&deadline?Math.max(0,Math.ceil((deadline-now)/1000)):0;
  const schedule=nextSchedule(broadcastOps,now),poll=broadcastOps?.activePoll||null;
  const totalVotes=poll?(Array.isArray(poll.options)?poll.options:[]).reduce((sum,item)=>sum+voteCount(item),0):0;
  const liveKnown=chzzkLive?.state?.lastKnownLive,liveConfigured=Boolean(chzzkLive?.connector?.configured),currentLive=chzzkLive?.currentLive||null;
  const incidents=incidentSummary?.counts||health?.incidentCounts||{},critical=Math.max(0,finite(incidents.critical)),open=Math.max(0,finite(incidents.open));
  const locked=Boolean(emergency?.locked),alerts=[];

  if(locked)alerts.push({severity:'danger',title:'긴급 운영 잠금 활성',text:clean(emergency?.reason)||'일반 운영 변경이 일시 중지되었습니다.',target:'recovery'});
  if(health&&!demo&&!health.connected)alerts.push({severity:'danger',title:'Discord 연결 확인 필요',text:'봇 연결 또는 서버 권한 상태를 확인하세요.',target:'runtime'});
  if(critical)alerts.push({severity:'danger',title:`CRITICAL 장애 ${critical}건`,text:'장애 워크플로에서 담당자 지정과 해결 상태를 확인하세요.',target:'incidents'});
  else if(open)alerts.push({severity:'warn',title:`미확인 장애 ${open}건`,text:'새 장애가 있습니다. 장애 워크플로를 확인하세요.',target:'incidents'});
  if(['offline','stale'].includes(liveState))alerts.push({severity:'warn',title:'실시간 동기화 불안정',text:'SSE가 재연결 또는 지연 상태입니다.',target:'runtime'});
  if(chzzkLive?.state?.lastStatus==='fail')alerts.push({severity:'warn',title:'CHZZK 상태 점검 실패',text:'CHZZK Open API 연결 상태를 확인하세요.',target:'runtime'});
  else if(chzzkLive?.state?.lastStatus==='warn')alerts.push({severity:'warn',title:'CHZZK 상태 미확정',text:'라이브 목록 스캔 결과가 확정되지 않았습니다.',target:'runtime'});
  const policyState=policyMonitor?.state||{},policyAck=policyMonitor?.acknowledgement||{},policyMaintenance=policyMonitor?.maintenance||{};
  const ackMatches=Boolean(policyAck.digest&&policyAck.digest===policyState.lastComparisonDigest);
  if(policyMonitor?.baseline&&policyMonitor?.settings?.enabled&&policyState.lastComparisonStatus==='drift'&&!policyMaintenance.active&&!ackMatches){alerts.push({severity:'warn',title:'Discord 기준선 Drift 감지',text:'권한·채널·명령 변경을 확인하세요.',target:'discordaudit'});}
  if(active&&missingCount)alerts.push({severity:'warn',title:`게임 정보 미등록 ${missingCount}명`,text:'해당 참가자는 현재 회차 추첨 대상에서 제외됩니다.',target:'operate'});

  let recommendation;
  if(locked)recommendation={title:'복구 상태 확인',text:'긴급 잠금 중입니다. 원인을 확인한 뒤 안전하게 잠금을 해제하세요.',label:'복구 센터 열기',target:'recovery',tone:'danger'};
  else if(critical)recommendation={title:'CRITICAL 장애 처리',text:'방송 운영보다 장애 확인을 우선하세요.',label:'장애 센터 열기',target:'incidents',tone:'danger'};
  else if(currentCall)recommendation={title:`${clean(currentCall.displayName)||'참가자'} 응답 대기`,text:`호출 응답을 확인하세요.${callSeconds?` 남은 시간 ${callSeconds}초.`:''}`,label:'라이브 모드 열기',target:'live',tone:'warn'};
  else if(active)recommendation={title:`${session?.round||1}판 ${PHASE_LABELS[session?.phase]||'진행 중'}`,text:'현재 회차를 라이브 모드에서 계속 운영하세요.',label:'라이브 모드 열기',target:'live',tone:'primary'};
  else if(liveKnown===true)recommendation={title:'CHZZK 방송 중 · 시참 준비',text:'방송은 시작됐지만 진행 중인 시참 회차가 없습니다.',label:'모집 설정 열기',target:'operate',tone:'primary'};
  else recommendation={title:'다음 방송 운영 준비',text:schedule?'다음 일정을 확인하고 모집 설정을 준비하세요.':'새 시참 회차 또는 방송 일정을 준비할 수 있습니다.',label:'컨트롤 센터 열기',target:'operate',tone:'primary'};

  const overall=locked?'locked':critical||alerts.some(item=>item.severity==='danger')?'danger':alerts.some(item=>item.severity==='warn')?'warn':active||liveKnown===true?'live':'ready';
  return {
    overall,
    recommendation,
    alerts:alerts.slice(0,6),
    session:{active,round:session?.round||null,phase:session?.phase||null,phaseLabel:session?PHASE_LABELS[session.phase]||session.phase:'대기',game:session?.game||'',mode:session?.mode||'',target:Math.max(0,finite(session?.count)),applicants:Array.isArray(session?.applicants)?session.applicants.length:0,readyCount,missingCount,winners:Array.isArray(session?.winners)?session.winners.length:0,confirmed:Array.isArray(session?.confirmed)?session.confirmed.length:0,pendingCount,postponedCount},
    queue:{activeCount:Math.max(0,finite(participationQueue?.activeCount)||queueEntries.length),entries:queueEntries.slice(0,5).map(item=>({id:clean(item.id),displayName:clean(item.displayName)||'참가자',status:clean(item.status)||'waiting',source:clean(item.source)||'dashboard',position:finite(item.position)})),currentCall:currentCall?{displayName:clean(currentCall.displayName)||'참가자',secondsLeft:callSeconds,source:clean(currentCall.source)||'dashboard'}:null},
    chzzk:{configured:liveConfigured,live:liveKnown===true,known:liveKnown!==null&&liveKnown!==undefined,status:clean(chzzkLive?.state?.lastStatus)||'idle',title:clean(currentLive?.liveTitle||currentLive?.title),category:clean(currentLive?.liveCategoryValue||currentLive?.categoryType),viewers:Math.max(0,finite(currentLive?.concurrentUserCount))},
    schedule:schedule?{id:clean(schedule.id),title:clean(schedule.title)||'방송 일정',startAt:finite(schedule.startAt),status:clean(schedule.status)||'scheduled'}:null,
    poll:poll?{id:clean(poll.id),question:clean(poll.question)||'진행 중인 투표',totalVotes,options:(Array.isArray(poll.options)?poll.options:[]).slice(0,5).map(option=>({label:clean(option.label),votes:voteCount(option)}))}:null,
    system:{discord:demo?'demo':health?.connected===true?'connected':health?.connected===false?'disconnected':'unknown',sync:liveState,runtime:clean(health?.runtimeStatus)||'unknown',capacity:clean(health?.capacityStatus)||'unknown',incidents:{critical,open,totalActive:Math.max(0,finite(incidents.totalActive))},recovered:Boolean(health?.recovered),emergencyLocked:locked},
    metrics:{records:Math.max(0,finite(state?.recordCount)),queue:Math.max(0,finite(participationQueue?.activeCount)||queueEntries.length),reservations:Array.isArray(state?.reservations)?state.reservations.length:0,completedSessions:Math.max(0,finite(broadcastOps?.stats?.completedSessions))}
  };
}
