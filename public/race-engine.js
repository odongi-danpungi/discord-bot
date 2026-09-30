import {TRACKS,getTrack,trackAt} from './maps.js';
function crossedBoostZone(before,next,track,laps){
 for(let lap=Math.max(0,Math.floor(before/1000)-1);lap<=Math.min(laps-1,Math.floor(next/1000)+1);lap++)for(const zone of track.boostZones||[]){const at=lap*1000+zone*1000;if(at>before&&at<=next)return {lap:lap+1,zone};}
 return null;
}
export function simulateRace(players,count,rng,options={}){
 const track=options.trackId?getTrack(options.trackId):TRACKS[rng(TRACKS.length)],laps=options.laps??track.defaultLaps??3;
 if(!Number.isInteger(laps)||laps<1||laps>5)throw Error('레이스 랩 수는 1~5 사이의 정수여야 합니다.');
 const finishDistance=laps*1000,positions=players.map(()=>0),speed=players.map(()=>5.3),boost=players.map(()=>0),cooldown=players.map(()=>0),target=players.map(()=>5.5),sprint=players.map(()=>false),finished=new Set(),order=[],times=[],frames=[],events=[];
 let tick=0;
 const rank=()=>[...order,...players.map((_,i)=>i).filter(i=>!finished.has(i)).sort((a,b)=>positions[b]-positions[a])];
 const save=highlights=>{events.push([...positions]);frames.push({tick,positions:[...positions],speed:[...speed],boost:[...boost],rank:rank(),highlights})};save([]);
 while(order.length<count){
  if(++tick>5000)throw Error('레이스 시간 한도를 초과했습니다.');
  const before=[...positions],oldRank=rank(),crosses=[],highlights=[];
  for(let i=0;i<players.length;i++){
   if(finished.has(i))continue;
   if(tick%11===1)target[i]=4.7+rng(211)/100;
   cooldown[i]=Math.max(0,cooldown[i]-1);
   if(!cooldown[i]&&rng(72)===0){boost[i]=Math.max(boost[i],18);cooldown[i]=72;highlights.push({type:'boost',i})}
   if(!sprint[i]&&before[i]>=finishDistance-135){sprint[i]=true;boost[i]=Math.max(boost[i],28);highlights.push({type:'sprint',i})}
   const turn=Math.min(1,Math.abs(trackAt(track,before[i]/1000).curvature)*1.75);
   const draft=before.some((x,j)=>j!==i&&!finished.has(j)&&x>before[i]&&x-before[i]<18)?.42:0;
   const desired=target[i]*(1-turn*.27)+(boost[i]>0?2.05:0)+draft;
   speed[i]+=(desired-speed[i])*.16;
   let next=before[i]+Math.max(1.2,speed[i]);
   const pad=crossedBoostZone(before[i],next,track,laps);if(pad){boost[i]=Math.max(boost[i],24);next+=.45;highlights.push({type:'pad',i,lap:pad.lap,zone:pad.zone})}
   positions[i]=Math.min(finishDistance,next);
   if(next>=finishDistance)crosses.push({i,time:tick-1+(finishDistance-before[i])/Math.max(1.2,speed[i])});
   boost[i]=Math.max(0,boost[i]-1);
  }
  for(let j=crosses.length-1;j>0;j--){const k=rng(j+1);[crosses[j],crosses[k]]=[crosses[k],crosses[j]]}
  crosses.sort((a,b)=>a.time-b.time);for(const result of crosses){finished.add(result.i);order.push(result.i);times.push(result);highlights.push({type:'finish',i:result.i})}
  const nextRank=rank();if(tick>1&&oldRank[0]!==nextRank[0])highlights.push({type:'lead',i:nextRank[0]});save(highlights);
 }
 return {version:4,events,raceFrames:frames,finishTimes:times,laps,finishDistance,stepMs:50,track:structuredClone(track),winners:order.slice(0,count).map(i=>players[i]),fairness:{equalCarStats:true,equalBoostRules:true,equalBoostPadRules:true,equalFinalSprint:true,trackCurvatureAffectsSpeed:true,variableLapCount:true,noPresetWinner:true}};
}
