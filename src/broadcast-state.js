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
