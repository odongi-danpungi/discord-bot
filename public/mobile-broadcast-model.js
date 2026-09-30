const number=value=>Number.isFinite(Number(value))?Number(value):0;
const roleAllows=(access,capability)=>access?.role!=='operator'||(Array.isArray(access?.capabilities)&&access.capabilities.includes(capability));

export function mobileBroadcastAccess(access={}){
  return {
    broadcast:roleAllows(access,'broadcast'),
    live:roleAllows(access,'live'),
    discord:roleAllows(access,'discord'),
    admin:access?.role!=='operator'
  };
}

export function mobilePollVoteCount(option={}){
  return Array.isArray(option.votes)?option.votes.length:Math.max(0,number(option.voteCount));
}

export function parseMobilePollOptions(value){
  const out=[],seen=new Set();
  for(const item of String(value??'').split(/[\n,]/).map(part=>part.trim()).filter(Boolean)){const key=item.toLocaleLowerCase('ko-KR');if(seen.has(key))continue;seen.add(key);out.push(item);if(out.length>=8)break;}
  return out;
}

export function formatMobileScheduleTime(value,{locale='ko-KR'}={}){
  const time=number(value);if(!time)return '시간 없음';
  try{return new Intl.DateTimeFormat(locale,{month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(time));}catch{return new Date(time).toLocaleString();}
}

export function toLocalDateTimeInput(value){
  const time=number(value);if(!time)return '';
  const date=new Date(time),offset=date.getTimezoneOffset()*60_000;
  return new Date(time-offset).toISOString().slice(0,16);
}

export function buildMobileBroadcastModel(snapshot={},now=Date.now()){
  const hub=snapshot.broadcastOps&&typeof snapshot.broadcastOps==='object'?snapshot.broadcastOps:{};
  const access=mobileBroadcastAccess(snapshot.access||{});
  const session=snapshot.state?.session||null,sessionActive=Boolean(session&&session.phase!=='ended');
  const presets=(Array.isArray(hub.gamePresets)?hub.gamePresets:[]).map(item=>({
    ...item,
    id:String(item?.id||''),
    name:String(item?.name||item?.title||'프리셋'),
    builtin:Boolean(item?.builtin),
    canStart:access.broadcast&&access.live&&!sessionActive,
    canDelete:access.broadcast&&!item?.builtin
  }));
  const schedules=(Array.isArray(hub.schedules)?hub.schedules:[]).map(item=>({...item,startAt:number(item?.startAt),endAt:number(item?.endAt)})).sort((a,b)=>{
    const ar=a.status==='scheduled'?0:1,br=b.status==='scheduled'?0:1;
    if(ar!==br)return ar-br;
    if(ar===0){const af=a.startAt>=now?0:1,bf=b.startAt>=now?0:1;if(af!==bf)return af-bf;return a.startAt-b.startAt;}
    return b.startAt-a.startAt;
  });
  const poll=hub.activePoll&&typeof hub.activePoll==='object'?hub.activePoll:null;
  const activePoll=poll?{...poll,options:(Array.isArray(poll.options)?poll.options:[]).map(option=>({...option,voteCount:mobilePollVoteCount(option)}))}:null;
  if(activePoll)activePoll.totalVotes=activePoll.options.reduce((sum,item)=>sum+item.voteCount,0);
  const notifications={broadcast:true,schedule:true,participation:true,naver:true,system:true,...(hub.notifications||{})};
  const timeline=(Array.isArray(hub.timeline)?hub.timeline:[]).slice(0,12).map(item=>({...item,at:number(item?.at)}));
  const stats={completedSessions:0,totalApplicants:0,averageApplicants:0,noShows:0,liveStarts:0,queueActive:0,polls:0,...(hub.stats||{})};
  const nextSchedule=hub.nextSchedule||schedules.find(item=>item.status==='scheduled'&&item.startAt>=now)||null;
  return {allowed:access.broadcast,access,sessionActive,canSaveCurrent:access.broadcast&&sessionActive,presets,schedules,activePoll,notifications,timeline,stats,nextSchedule};
}
