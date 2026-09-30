import {resolveBroadcastPresentation} from './broadcast-presets.js';
const DRAW_KEYS = [
  'version','mode','count','events','raceFrames',
  'fairness','bridges','slots','paths','finishTimes','laps','finishDistance','stepMs','track'
];

const clone = value => value === undefined ? undefined : structuredClone(value);

function recordName(records,id){
  const record=records.find(r=>r.discordId===id);
  return record?.chzzkName || record?.discordUsername || '참가자';
}

function buildNameMap(ids,records,preferred={}){
  const used=new Map(),map=new Map();
  for(const id of [...new Set(ids)]){
    const base=String(preferred?.[id] || recordName(records,id) || '참가자').trim() || '참가자';
    const count=(used.get(base)||0)+1;used.set(base,count);map.set(id,count===1?base:`${base} ${count}`);
  }
  return map;
}
function uniqueDisplayNames(ids,records,preferred={}){const map=buildNameMap(ids,records,preferred);return ids.map(id=>map.get(id)||'참가자');}

export function sanitizeBroadcastDraw(draw,records=[]){
  if(!draw||!Array.isArray(draw.players))return null;
  const aliases=draw.players.map((_,i)=>`p${i+1}`),idToAlias=new Map(draw.players.map((id,i)=>[id,aliases[i]]));
  const displayNames=uniqueDisplayNames(draw.players,records,draw.names||{});
  const names=Object.fromEntries(aliases.map((alias,i)=>[alias,displayNames[i]]));
  const avatars={};
  for(let i=0;i<draw.players.length;i++){
    const avatar=draw.avatars?.[draw.players[i]];
    if(avatar)avatars[aliases[i]]=clone(avatar);
  }
  const safe={id:String(draw.id||''),at:Number(draw.at)||0,mode:draw.mode==='battle'?'legacy':String(draw.mode||'instant'),players:aliases,names,winners:(draw.winners||[]).map(id=>idToAlias.get(id)).filter(Boolean)};
  if(Object.keys(avatars).length)safe.avatars=avatars;
  for(const key of DRAW_KEYS)if(draw[key]!==undefined)safe[key]=clone(draw[key]);
  return safe;
}

export function buildBroadcastSnapshot(state,records=[],version='0.0.0',now=Date.now()){
  const session=state?.session||null;
  const active=session&&session.phase!=='ended'?session:null;
  const participantIds=[...(session?.applicants||[]),...(session?.postponed||[]),...(session?.winners||[]),...(session?.confirmed||[]),...(session?.excluded||[]),...(session?.teams||[]).flat()];
  const sessionNames=buildNameMap(participantIds,records),names=ids=>(Array.isArray(ids)?ids:[]).map(id=>sessionNames.get(id)||recordName(records,id));
  const presentation=resolveBroadcastPresentation(state,now);
  const snapshot={version,serverTime:now,revision:Number(state?.revision)||0,settings:presentation.settings,activePresetId:presentation.activePresetId,sceneOverride:presentation.forcedScene,automation:{enabled:presentation.automation.enabled,endedHoldSeconds:presentation.automation.endedHoldSeconds},session:null,draw:null};
  if(!session)return snapshot;
  snapshot.session={
    key:String(session.id||''),round:Number(session.round)||1,game:session.game||'',mode:session.mode||'',title:String(session.title||'시참 모집'),description:String(session.description||''),phase:session.phase||'ended',count:Number(session.count)||0,createdAt:Number(session.createdAt)||0,closeAt:session.closeAt==null?null:Number(session.closeAt),deadline:session.deadline==null?null:Number(session.deadline),applicants:names(session.applicants),postponed:names(session.postponed),winners:names(session.winners),confirmed:names(session.confirmed),excluded:names(session.excluded),teams:(session.teams||[]).map(team=>names(team))
  };
  const draw=state?.lastDraw;
  if(active&&draw?.id&&draw.sessionId===active.id){
    const drawIds=Array.isArray(draw.players)&&draw.players.length?draw.players:(draw.winners||[]),drawNames=buildNameMap(drawIds,records,draw.names||{});
    const winnerNames=(draw.winners||[]).map(id=>drawNames.get(id)||recordName(records,id));
    snapshot.draw={id:String(draw.id),at:Number(draw.at)||0,mode:String(draw.mode||'instant'),winners:winnerNames};
  }
  return snapshot;
}

const OVERLAY_ACTIVE_STATUSES=new Set(['waiting','called','joined','postponed_next','postponed_next2']);
const OVERLAY_STATUS_LABELS={waiting:'대기',called:'호출 중',joined:'참가 확정',postponed_next:'다음 판',postponed_next2:'다다음 판',cancelled:'취소',no_show:'노쇼'};
const OVERLAY_SOURCE_LABELS={discord:'Discord',naver:'Naver',dashboard:'Dashboard'};

function safeOverlayEntry(entry){
  if(!entry||typeof entry!=='object')return null;
  return {
    position:Number(entry.position)||0,
    source:OVERLAY_SOURCE_LABELS[entry.source]||'기타',
    status:String(entry.status||''),
    statusLabel:OVERLAY_STATUS_LABELS[entry.status]||String(entry.status||''),
    displayName:String(entry.displayName||'참가자').slice(0,80),
    calledAt:Number(entry.calledAt)||0,
    callDeadline:Number(entry.callDeadline)||0,
    updatedAt:Number(entry.updatedAt)||0
  };
}

function overlayEventMessage(item){
  const name=String(item?.displayName||'참가자').slice(0,80),status=String(item?.status||''),position=Number(item?.details?.targetPosition)||0;
  if(item?.action==='register')return `${name} · 대기열 등록`;
  if(item?.action==='call')return `${name} · 참가 호출`;
  if(item?.action==='recall')return `${name} · 다시 호출`;
  if(item?.action==='call_join')return `${name} · 참가 확정`;
  if(item?.action==='call_pass')return `${name} · 다음 판으로 미루기`;
  if(item?.action==='call_timeout')return `${name} · 응답 없음`;
  if(item?.action==='call_cancel')return `${name} · 호출 취소`;
  if(item?.action==='reorder')return `${name} · ${position?`${position}번으로 `:''}순서 변경`;
  if(item?.action==='source_cancel')return `${name} · 참가 취소`;
  if(item?.action==='status')return `${name} · ${OVERLAY_STATUS_LABELS[status]||status||'상태 변경'}`;
  return `${name} · ${String(item?.action||'상태 변경').replaceAll('_',' ')}`;
}

export function buildBroadcastOverlaySnapshot(state,records=[],queueSummary=null,version='0.0.0',now=Date.now()){
  const broadcast=buildBroadcastSnapshot(state,records,version,now),queue=queueSummary&&typeof queueSummary==='object'?queueSummary:{entries:[],history:[],counts:{}};
  const entries=Array.isArray(queue.entries)?queue.entries.filter(entry=>OVERLAY_ACTIVE_STATUSES.has(entry.status)).sort((a,b)=>(Number(a.position)||9999)-(Number(b.position)||9999)||(Number(a.sequence)||0)-(Number(b.sequence)||0)):[];
  const currentRaw=entries.find(entry=>entry.status==='called')||entries.find(entry=>entry.status==='joined')||null;
  const nextRaw=entries.find(entry=>entry.status==='waiting'&&entry.id!==currentRaw?.id)||null;
  const current=safeOverlayEntry(currentRaw),next=safeOverlayEntry(nextRaw);
  const session=broadcast.session;
  const events=[];
  for(const item of Array.isArray(queue.history)?queue.history.slice(0,16):[]){
    const at=Number(item?.at)||0;if(!at)continue;
    events.push({id:`queue:${String(item.id||at)}`,at,type:'queue',message:overlayEventMessage(item)});
  }
  if(state?.lastDraw?.id&&Number(state.lastDraw.at)){
    const winners=broadcast.draw?.winners||session?.winners||[];
    events.push({id:`draw:${String(state.lastDraw.id)}`,at:Number(state.lastDraw.at),type:'draw',message:winners.length?`추첨 완료 · ${winners.join(', ')}`:'추첨 완료'});
  }
  if(state?.session?.teamMeta?.generatedAt&&session?.teams?.length){
    events.push({id:`teams:${String(state.session.id||'session')}:${Number(state.session.teamMeta.generatedAt)}`,at:Number(state.session.teamMeta.generatedAt),type:'teams',message:`팀 편성 완료 · ${session.teams.length}개 팀`});
  }
  if(state?.session?.createdAt){events.push({id:`session:${String(state.session.id||'session')}`,at:Number(state.session.createdAt),type:'session',message:`${session?.round||1}판 ${session?.title||'시참'} 시작`});}
  events.sort((a,b)=>b.at-a.at);
  const counts=queue.counts&&typeof queue.counts==='object'?queue.counts:{};
  return {
    version,serverTime:now,revision:Number(state?.revision)||0,
    session:session?{round:session.round,game:session.game,mode:session.mode,title:session.title,phase:session.phase,count:session.count}:null,
    current,next,
    counts:{waiting:Number(counts.waiting)||0,called:Number(counts.called)||0,joined:Number(counts.joined)||0,active:Number(queue.activeCount)||entries.length},
    winners:[...(broadcast.draw?.winners||session?.winners||[])].slice(0,20),
    teams:(session?.teams||[]).map(team=>team.slice(0,20)).slice(0,8),
    eventFeed:events.slice(0,8)
  };
}
