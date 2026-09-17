const laneGroups = [['top','탑'],['jungle','정글','jg'],['mid','미드'],['adc','원딜','바텀','bot'],['support','서폿','서포터','sup']];
export function normalizeLane(value='') { return laneGroups.findIndex(names => names.includes(value.trim().toLowerCase())); }
export function tierScore(record, game) {
  const value=String(game==='er'?record.erCurrentTier:record.lolCurrentTier).trim().toLowerCase();
  const tiers=game==='er' ? [['아이언','iron'],['브론즈','bronze'],['실버','silver'],['골드','gold'],['플래티넘','플레티넘','platinum'],['다이아','diamond'],['미스릴','미스릴','mithril'],['타이탄','titan'],['이터니티','immortal']] : [['아이언','iron'],['브론즈','bronze'],['실버','silver'],['골드','gold'],['플래티넘','플레티넘','platinum'],['에메랄드','emerald'],['다이아','diamond'],['마스터','master'],['그랜드마스터','grandmaster'],['챌린저','challenger']];
  for(let i=tiers.length-1;i>=0;i--)if(tiers[i].some(t=>value.includes(t))) {
    const division=value.match(/(?:\s|[^a-z])([1-4])\s*$/)?.[1] || value.match(/([1-4])$/)?.[1];
    return (i+1)*4+(division ? 4-Number(division) : 0);
  }
  return null;
}
export function teamCost(teams, records, game, mode='rift') {
  const indexed=new Map(records.map(r=>[r.discordId,r]));
  const scores=teams.map(ids=>ids.reduce((sum,id)=>sum+(tierScore(indexed.get(id),game)??16),0));
  const spread=Math.max(...scores)-Math.min(...scores);
  const duplicates=game==='lol'&&mode==='rift'?teams.reduce((total,ids)=>{
    const lanes=ids.map(id=>normalizeLane(indexed.get(id).lolMainLane)).filter(l=>l>=0);
    return total+lanes.length-new Set(lanes).size;
  },0):0;
  return spread+duplicates*12;
}
export function balanceTeams(records, game, mode='rift') {
  const size=game==='er'?3:5;
  if (!records.length || records.length%size) throw Error(`${size}명 단위로 팀을 구성할 수 있습니다.`);
  if (new Set(records.map(r=>r.discordId)).size!==records.length)throw Error('팀 명단에 중복이 있습니다.');
  const sorted=[...records].sort((a,b)=>(tierScore(b,game)??16)-(tierScore(a,game)??16));
  const teams=Array.from({length:records.length/size},()=>[]);
  sorted.forEach((r,i)=>{ const cycle=Math.floor(i/teams.length); const t=cycle%2?teams.length-1-i%teams.length:i%teams.length;teams[t].push(r.discordId); });
  // Improve tier spread and repeated main positions without changing team sizes.
  for(let iteration=0;iteration<100;iteration++) {
    let best=teamCost(teams,records,game,mode),swap=null;
    for(let a=0;a<teams.length;a++)for(let b=a+1;b<teams.length;b++)for(let i=0;i<size;i++)for(let j=0;j<size;j++) {
      [teams[a][i],teams[b][j]]=[teams[b][j],teams[a][i]];
      const cost=teamCost(teams,records,game,mode);
      [teams[a][i],teams[b][j]]=[teams[b][j],teams[a][i]];
      if(cost<best){best=cost;swap=[a,b,i,j];}
    }
    if(!swap)break;
    const [a,b,i,j]=swap;[teams[a][i],teams[b][j]]=[teams[b][j],teams[a][i]];
  }
  return teams;
}
