import { randomInt as cryptoRandomInt } from 'node:crypto';

const laneGroups = [['top','탑'],['jungle','정글','jg'],['mid','미드'],['adc','원딜','바텀','bot'],['support','서폿','서포터','sup']];
export const TEAM_STRATEGIES=Object.freeze(['balanced','random','tier','position']);

export function normalizeLane(value='') { return laneGroups.findIndex(names => names.includes(String(value||'').trim().toLowerCase())); }
export function tierScore(record, game) {
  const value=String(game==='er'?record?.erCurrentTier:record?.lolCurrentTier).trim().toLowerCase();
  const tiers=game==='er' ? [['아이언','iron'],['브론즈','bronze'],['실버','silver'],['골드','gold'],['플래티넘','플레티넘','platinum'],['다이아','diamond'],['미스릴','mithril'],['타이탄','titan'],['이터니티','immortal']] : [['아이언','iron'],['브론즈','bronze'],['실버','silver'],['골드','gold'],['플래티넘','플레티넘','platinum'],['에메랄드','emerald'],['다이아','diamond'],['마스터','master'],['그랜드마스터','grandmaster'],['챌린저','challenger']];
  for(let i=tiers.length-1;i>=0;i--)if(tiers[i].some(t=>value.includes(t))) {
    const division=value.match(/(?:\s|[^a-z])([1-4])\s*$/)?.[1] || value.match(/([1-4])$/)?.[1];
    return (i+1)*4+(division ? 4-Number(division) : 0);
  }
  return null;
}

function pairKey(a,b){return a<b?`${a}\0${b}`:`${b}\0${a}`;}
function normalizePreviousTeams(previousTeams=[]){
  const out=[];
  for(const entry of previousTeams||[]){
    if(Array.isArray(entry)&&entry.every(Array.isArray))out.push(entry);
    else if(Array.isArray(entry?.teams))out.push(entry.teams);
  }
  return out;
}
function previousPairCounts(previousTeams=[]){
  const counts=new Map();
  for(const teams of normalizePreviousTeams(previousTeams))for(const team of teams||[])for(let i=0;i<team.length;i++)for(let j=i+1;j<team.length;j++){
    const key=pairKey(team[i],team[j]);counts.set(key,(counts.get(key)||0)+1);
  }
  return counts;
}
function randomShuffle(items,randomInt=cryptoRandomInt){
  const out=[...items];
  for(let i=out.length-1;i>0;i--){const j=randomInt(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function splitTeams(ids,size){const teams=[];for(let i=0;i<ids.length;i+=size)teams.push(ids.slice(i,i+size));return teams;}

export function teamMetrics(teams, records, game, mode='rift', {previousTeams=[]}={}) {
  const indexed=new Map(records.map(r=>[r.discordId,r]));
  const scores=teams.map(ids=>ids.reduce((sum,id)=>sum+(tierScore(indexed.get(id),game)??16),0));
  const tierSpread=scores.length?Math.max(...scores)-Math.min(...scores):0;
  const laneDuplicates=game==='lol'&&mode==='rift'?teams.reduce((total,ids)=>{
    const lanes=ids.map(id=>normalizeLane(indexed.get(id)?.lolMainLane)).filter(l=>l>=0);
    return total+lanes.length-new Set(lanes).size;
  },0):0;
  const previous=previousPairCounts(previousTeams);
  let repeatedPairs=0,repeatedPairWeight=0;
  for(const ids of teams)for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
    const count=previous.get(pairKey(ids[i],ids[j]))||0;
    if(count){repeatedPairs++;repeatedPairWeight+=count;}
  }
  return {tierSpread,laneDuplicates,repeatedPairs,repeatedPairWeight,teamScores:scores};
}

function strategyCost(metrics,strategy,game,mode){
  const positionSupported=game==='lol'&&mode==='rift';
  if(strategy==='random')return 0;
  if(strategy==='tier')return metrics.tierSpread+metrics.repeatedPairWeight*4;
  if(strategy==='position')return (positionSupported?metrics.laneDuplicates*12:metrics.tierSpread)+metrics.repeatedPairWeight*4;
  return metrics.tierSpread+(positionSupported?metrics.laneDuplicates*12:0)+metrics.repeatedPairWeight*6;
}

export function teamCost(teams, records, game, mode='rift', options={}) {
  const strategy=TEAM_STRATEGIES.includes(options.strategy)?options.strategy:'balanced';
  return strategyCost(teamMetrics(teams,records,game,mode,options),strategy,game,mode);
}

function makeInitialTeams(records,game,mode,size,strategy,randomInt){
  if(strategy==='random')return splitTeams(randomShuffle(records.map(r=>r.discordId),randomInt),size);
  let sorted;
  if(strategy==='position'&&game==='lol'&&mode==='rift'){
    const laneBuckets=Array.from({length:6},()=>[]);
    for(const record of randomShuffle(records,randomInt)){
      const lane=normalizeLane(record.lolMainLane);laneBuckets[lane>=0?lane:5].push(record);
    }
    sorted=[];let remaining=true;
    while(remaining){remaining=false;for(const bucket of laneBuckets)if(bucket.length){sorted.push(bucket.shift());remaining=true;}}
  }else{
    sorted=randomShuffle(records,randomInt).sort((a,b)=>(tierScore(b,game)??16)-(tierScore(a,game)??16));
  }
  const teamCount=records.length/size,teams=Array.from({length:teamCount},()=>[]);
  sorted.forEach((r,i)=>{const cycle=Math.floor(i/teamCount),offset=i%teamCount,t=cycle%2?teamCount-1-offset:offset;teams[t].push(r.discordId);});
  return teams;
}

function optimizeTeams(teams,records,game,mode,size,strategy,previousTeams){
  if(strategy==='random')return teams;
  for(let iteration=0;iteration<160;iteration++){
    let best=teamCost(teams,records,game,mode,{strategy,previousTeams}),swap=null;
    for(let a=0;a<teams.length;a++)for(let b=a+1;b<teams.length;b++)for(let i=0;i<size;i++)for(let j=0;j<size;j++){
      [teams[a][i],teams[b][j]]=[teams[b][j],teams[a][i]];
      const cost=teamCost(teams,records,game,mode,{strategy,previousTeams});
      [teams[a][i],teams[b][j]]=[teams[b][j],teams[a][i]];
      if(cost<best){best=cost;swap=[a,b,i,j];}
    }
    if(!swap)break;
    const [a,b,i,j]=swap;[teams[a][i],teams[b][j]]=[teams[b][j],teams[a][i]];
  }
  return teams;
}

export function createTeams(records,game,mode='rift',{strategy='balanced',previousTeams=[],randomInt=cryptoRandomInt}={}){
  const size=game==='er'?3:5;
  if(!records.length||records.length%size)throw Error(`${size}명 단위로 팀을 구성할 수 있습니다.`);
  if(new Set(records.map(r=>r.discordId)).size!==records.length)throw Error('팀 명단에 중복이 있습니다.');
  if(!TEAM_STRATEGIES.includes(strategy))throw Error('팀 편성 방식을 확인해 주세요.');
  const normalizedHistory=normalizePreviousTeams(previousTeams);
  const teams=optimizeTeams(makeInitialTeams(records,game,mode,size,strategy,randomInt),records,game,mode,size,strategy,normalizedHistory);
  const metrics=teamMetrics(teams,records,game,mode,{previousTeams:normalizedHistory});
  return {teams,meta:{strategy,...metrics,historySamples:normalizedHistory.length}};
}

export function balanceTeams(records, game, mode='rift', options={}) {
  return createTeams(records,game,mode,{...options,strategy:options.strategy||'balanced'}).teams;
}
