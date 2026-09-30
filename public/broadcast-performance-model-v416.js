const n=value=>Math.max(0,Number(value)||0);
const pct=(a,b)=>b>0?(a/b)*100:0;
const round1=value=>Math.round((Number(value)||0)*10)/10;
const safeReport=report=>({
  id:String(report?.id||''),title:String(report?.title||'방송'),endedAt:n(report?.endedAt),durationMinutes:n(report?.durationMinutes),
  checklist:{done:n(report?.checklist?.done),skipped:n(report?.checklist?.skipped),total:n(report?.checklist?.total)},
  handoffCount:n(report?.handoffCount),
  sessionStats:{completed:n(report?.sessionStats?.completed),applicants:n(report?.sessionStats?.applicants),winners:n(report?.sessionStats?.winners),confirmed:n(report?.sessionStats?.confirmed),noShows:n(report?.sessionStats?.noShows),games:{aram:n(report?.sessionStats?.games?.aram),rift:n(report?.sessionStats?.games?.rift),er:n(report?.sessionStats?.games?.er)}}
});

export const PERFORMANCE_RANGES=Object.freeze([3,5,10,0]);

export function broadcastPerformancePoint(report={}){
  const r=safeReport(report),s=r.sessionStats;
  return {
    id:r.id,title:r.title,endedAt:r.endedAt,durationMinutes:r.durationMinutes,sessions:s.completed,applicants:s.applicants,winners:s.winners,confirmed:s.confirmed,noShows:s.noShows,
    applicantsPerSession:round1(s.completed?s.applicants/s.completed:0),attendanceRate:round1(pct(s.confirmed,s.winners)),noShowRate:round1(pct(s.noShows,s.winners)),winnerRate:round1(pct(s.winners,s.applicants)),minutesPerSession:round1(s.completed?r.durationMinutes/s.completed:0),
    checklistSkipped:r.checklist.skipped,handoffs:r.handoffCount,games:r.sessionStats.games
  };
}

export function aggregateBroadcastPerformance(reports=[]){
  const points=reports.map(broadcastPerformancePoint),sum=(key)=>points.reduce((total,item)=>total+n(item[key]),0),sessions=sum('sessions'),applicants=sum('applicants'),winners=sum('winners'),confirmed=sum('confirmed'),noShows=sum('noShows'),duration=sum('durationMinutes');
  const games=points.reduce((acc,item)=>{acc.aram+=n(item.games.aram);acc.rift+=n(item.games.rift);acc.er+=n(item.games.er);return acc;},{aram:0,rift:0,er:0});
  return {broadcasts:points.length,sessions,applicants,winners,confirmed,noShows,durationMinutes:duration,applicantsPerSession:round1(sessions?applicants/sessions:0),attendanceRate:round1(pct(confirmed,winners)),noShowRate:round1(pct(noShows,winners)),winnerRate:round1(pct(winners,applicants)),minutesPerSession:round1(sessions?duration/sessions:0),games,points};
}

const relativeDelta=(current,previous)=>previous>0?round1(((current-previous)/previous)*100):current>0?100:0;
export function compareBroadcastPerformance(currentReport,previousReport){
  if(!currentReport)return null;const current=broadcastPerformancePoint(currentReport),previous=previousReport?broadcastPerformancePoint(previousReport):null;
  const metric=(key,unit='')=>({key,current:current[key],previous:previous?.[key]??null,delta:previous?round1(current[key]-previous[key]):null,relativeDelta:previous?relativeDelta(current[key],previous[key]):null,unit});
  return {current,previous,metrics:[metric('applicantsPerSession','명/회'),metric('attendanceRate','%'),metric('noShowRate','%'),metric('minutesPerSession','분/회')]};
}

export function buildBroadcastPerformanceInsights(reports=[]){
  const points=reports.map(broadcastPerformancePoint).sort((a,b)=>b.endedAt-a.endedAt);if(!points.length)return [{tone:'info',title:'비교할 방송이 없습니다',detail:'마감된 방송이 쌓이면 방송별 추세와 운영 지표를 비교합니다.'}];
  if(points.length===1)return [{tone:'info',title:'비교 데이터가 더 필요합니다',detail:'현재 1개 방송만 있어 추세 판단 대신 기준값만 표시합니다.'}];
  const latest=points[0],prev=points[1],insights=[];
  const attendanceDelta=round1(latest.attendanceRate-prev.attendanceRate),noShowDelta=round1(latest.noShowRate-prev.noShowRate),applicationRelative=relativeDelta(latest.applicantsPerSession,prev.applicantsPerSession),paceRelative=relativeDelta(latest.minutesPerSession,prev.minutesPerSession);
  if(noShowDelta>=5)insights.push({tone:'warning',title:'노쇼 비율 상승',detail:`직전 방송 대비 ${noShowDelta}%p 높습니다. 호출 시간·참석 확인 흐름을 운영 기록과 함께 확인해 보세요.`});
  else if(noShowDelta<=-5)insights.push({tone:'success',title:'노쇼 비율 감소',detail:`직전 방송 대비 ${Math.abs(noShowDelta)}%p 낮습니다. 현재 호출·확인 흐름을 유지할 근거로 참고할 수 있습니다.`});
  if(attendanceDelta>=5)insights.push({tone:'success',title:'당첨자 참석률 상승',detail:`직전 방송 대비 ${attendanceDelta}%p 높습니다.`});
  else if(attendanceDelta<=-5)insights.push({tone:'warning',title:'당첨자 참석률 하락',detail:`직전 방송 대비 ${Math.abs(attendanceDelta)}%p 낮습니다. 원인은 이 통계만으로 확정할 수 없으므로 인수인계·Runbook 기록을 함께 확인하세요.`});
  if(applicationRelative>=20)insights.push({tone:'info',title:'회차당 신청 증가',detail:`직전 방송 대비 약 ${applicationRelative}% 증가했습니다. 모집 인원·대기열 운영 부담을 확인할 가치가 있습니다.`});
  else if(applicationRelative<=-20)insights.push({tone:'info',title:'회차당 신청 감소',detail:`직전 방송 대비 약 ${Math.abs(applicationRelative)}% 감소했습니다. 방송 주제·게임 구성·모집 시간을 함께 비교해 보세요.`});
  if(paceRelative>=25&&latest.sessions>0)insights.push({tone:'warning',title:'회차당 Runbook 시간 증가',detail:`직전 방송 대비 약 ${paceRelative}% 길어졌습니다. Runbook 생성~마감 기준이므로 Timeline과 함께 지연 구간을 확인하세요.`});
  if(latest.checklistSkipped>0)insights.push({tone:'info',title:'Runbook 건너뜀 항목 있음',detail:`최근 방송에서 ${latest.checklistSkipped}개 항목이 건너뜀 처리됐습니다. 반복되는 항목이면 Runbook 구성을 조정할 수 있습니다.`});
  if(!insights.length)insights.push({tone:'success',title:'큰 변동 없음',detail:'직전 방송 대비 주요 운영 지표에 큰 변화가 감지되지 않았습니다.'});
  return insights.slice(0,4);
}

export function buildBroadcastPerformanceModel(reports=[],{range=5}={}){
  const clean=(Array.isArray(reports)?reports.filter(Boolean):[]).slice().sort((a,b)=>n(b?.endedAt)-n(a?.endedAt)),limit=PERFORMANCE_RANGES.includes(Number(range))?Number(range):5,selected=limit>0?clean.slice(0,limit):clean.slice();
  return {range:limit,selectedCount:selected.length,aggregate:aggregateBroadcastPerformance(selected),comparison:compareBroadcastPerformance(clean[0],clean[1]),insights:buildBroadcastPerformanceInsights(clean),trend:selected.map(broadcastPerformancePoint).sort((a,b)=>a.endedAt-b.endedAt)};
}
