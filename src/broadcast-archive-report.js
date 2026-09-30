const clean=(value,max=320)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const time=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:0;};
const countList=(value,key)=>Array.isArray(value?.[key])?value[key].length:0;
const gameKey=session=>session?.game==='er'?'er':session?.mode==='aram'?'aram':'rift';

export function buildBroadcastArchiveReport(runbook,{operationsState={},chzzkSummary={},now=Date.now()}={}){
  if(!runbook||runbook.status!=='closed'||!runbook.id)return null;
  const startedAt=time(runbook.createdAt),endedAt=time(runbook.closedAt)||time(runbook.closeout?.generatedAt)||now;
  const sessions=(Array.isArray(operationsState.sessionArchive)?operationsState.sessionArchive:[]).filter(item=>{
    const at=time(item?.endedAt)||time(item?.updatedAt)||time(item?.createdAt);
    return at>=startedAt&&at<=endedAt;
  });
  const sessionStats=sessions.reduce((acc,item)=>{
    acc.completed+=1;acc.applicants+=countList(item,'applicants');acc.winners+=countList(item,'winners');acc.confirmed+=countList(item,'confirmed');acc.noShows+=countList(item,'noShows');acc.games[gameKey(item)]+=1;return acc;
  },{completed:0,applicants:0,winners:0,confirmed:0,noShows:0,games:{aram:0,rift:0,er:0}});
  const events=(Array.isArray(chzzkSummary?.events)?chzzkSummary.events:[]).filter(item=>{const at=time(item?.detectedAt);return at>=startedAt&&at<=endedAt;});
  const chzzk={starts:events.filter(item=>item?.type==='start').length,ends:events.filter(item=>item?.type==='end').length};
  const progress=runbook.progress||{};
  const schedule=runbook.closeout?.schedule&&typeof runbook.closeout.schedule==='object'?{title:clean(runbook.closeout.schedule.title,120),startAt:time(runbook.closeout.schedule.startAt)}:null;
  return {
    schema:'daengdaeng-broadcast-report-v1',id:clean(runbook.id,100),title:clean(runbook.title,120),startedAt,endedAt,
    durationMinutes:startedAt&&endedAt>=startedAt?Math.max(0,Math.round((endedAt-startedAt)/60000)):0,
    checklist:{done:Math.max(0,Number(progress.done)||0),skipped:Math.max(0,Number(progress.skipped)||0),total:Math.max(0,Number(progress.total)||0)},
    handoffCount:Array.isArray(runbook.handoffs)?runbook.handoffs.length:Math.max(0,Number(runbook.closeout?.handoffCount)||0),
    sessionStats,chzzk,
    nextBroadcast:{owner:clean(runbook.closeout?.nextOwner,80),note:clean(runbook.closeout?.nextNote,1200),schedule},
    summary:clean(runbook.closeout?.summary,320),generatedAt:now
  };
}

export function buildBroadcastArchiveReports(runbooks,context={}){
  const seen=new Set();return (Array.isArray(runbooks)?runbooks:[]).map(item=>buildBroadcastArchiveReport(item,context)).filter(item=>item&&!seen.has(item.id)&&seen.add(item.id)).sort((a,b)=>b.endedAt-a.endedAt);
}
