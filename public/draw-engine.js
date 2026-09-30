import { simulateRace } from './race-engine.js';

export const MODES = { race:'자동차 레이스', ladder:'사다리 게임', instant:'즉시 추첨' };

export function randomInteger(n) {
  if(!Number.isInteger(n)||n<1)throw Error('잘못된 무작위 범위');
  const limit=4294967296-4294967296%n;let value;
  do{value=crypto.getRandomValues(new Uint32Array(1))[0]}while(value>=limit);
  return value%n;
}
function shuffled(items,rng){const a=[...items];for(let i=a.length-1;i>0;i--){const j=rng(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
export function simulateDraw(ids,count,mode,rng=randomInteger,options={}) {
  if(!Object.hasOwn(MODES,mode)||!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||!Number.isInteger(count)||count<1||count>Math.min(50,ids.length))throw Error('참가자는 1~100명, 선정 인원은 참가 인원 이하의 정수(1~50)여야 합니다.');
  const players=shuffled(ids,rng),trace={version:1,mode,players,count,events:[],winners:[]};
  if(mode==='instant'){trace.winners=players.slice(0,count);return trace;}
  if(mode==='race') {
    Object.assign(trace,simulateRace(players,count,rng,options));
  } else {
    const n=players.length,bridges=n<2?[]:Array.from({length:18},()=>rng(n-1)),slots=shuffled(Array.from({length:n},(_,i)=>i),rng).slice(0,count);
    const paths=players.map((_,i)=>[i]);
    for(const bridge of bridges)for(const route of paths){const x=route.at(-1);route.push(x===bridge?x+1:x===bridge+1?x-1:x)}
    trace.bridges=bridges;trace.slots=slots;trace.paths=paths;
    trace.winners=players.filter((id,i)=>slots.includes(paths[i].at(-1)));
  }
  return trace;
}
