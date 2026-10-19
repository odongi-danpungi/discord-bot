import { randomInt, randomUUID } from 'node:crypto';

const failure=(message,status=400)=>Object.assign(Error(message),{status});
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const controls=/[\p{Cc}\p{Cf}\p{Cs}]/u;
const requestIdValid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value);
const fingerprintValid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sources=['custom','queue'];
const corrupt=()=>failure('저장된 룰렛 기록을 확인할 수 없습니다. 제작자에게 점검을 요청해 주세요.',503);

function label(value) {
  // Bound UTF-16 input before normalization or code-point allocation. NFC,
  // surrounding whitespace and case are ignored for custom duplicate checks.
  if(typeof value!=='string'||value.length>320||controls.test(value))throw failure('룰렛 항목은 제어 문자 없이 1~80자로 입력해 주세요.');
  const normalized=value.normalize('NFC').trim();
  if(!normalized||[...normalized].length>80)throw failure('룰렛 항목은 1~80자로 입력해 주세요.');
  return normalized;
}

function count(items) {
  if(!Array.isArray(items)||items.length<2||items.length>100)throw failure('룰렛 항목은 2~100개로 구성해 주세요.');
}

/** Equal-chance custom items; NFC + trim + Unicode lowercase define duplicates. */
export function normalizeRouletteItems(items) {
  count(items);
  const seen=new Set();
  return Array.from(items,(value,index)=>{
    const normalized=label(value),key=normalized.toLowerCase();
    if(seen.has(key))throw failure('같은 이름의 룰렛 항목을 중복 입력할 수 없습니다.');
    seen.add(key);
    return {id:`custom:${index}`,label:normalized};
  });
}

function normalizeEntries(entries) {
  count(entries);
  const seen=new Set();
  return Array.from(entries,entry=>{
    if(!exact(entry,['id','label'])||typeof entry.id!=='string'||!entry.id||entry.id.length>160||entry.id.trim()!==entry.id||controls.test(entry.id))throw failure('룰렛 참가자 식별 정보를 확인해 주세요.');
    if(seen.has(entry.id))throw failure('같은 참가자를 룰렛에 중복 등록할 수 없습니다.');
    seen.add(entry.id);
    // Queue participants may legitimately share a display name. Identity is
    // the stable queue entry ID, not the label or a cross-platform nickname.
    return {id:entry.id,label:label(entry.label)};
  });
}

function validResult(result) {
  if(!exact(result,['id','requestId','at','source','entries','winnerIndex','winner'])||typeof result.id!=='string'||!requestIdValid(result.id)||!requestIdValid(result.requestId)||!revision(result.at)||!sources.includes(result.source))return false;
  let entries;
  try{count(result.entries);entries=result.source==='custom'?normalizeRouletteItems(result.entries.map(entry=>entry?.label)):normalizeEntries(result.entries);}
  catch{return false;}
  if(JSON.stringify(entries)!==JSON.stringify(result.entries)||!Number.isInteger(result.winnerIndex)||result.winnerIndex<0||result.winnerIndex>=entries.length||!exact(result.winner,['id','label']))return false;
  return result.winner.id===entries[result.winnerIndex].id&&result.winner.label===entries[result.winnerIndex].label;
}

function storedRoulette(state) {
  if(!plain(state))throw corrupt();
  if(!Object.hasOwn(state,'roulette'))return {version:1,revision:0,history:[],requests:[]};
  const stored=state.roulette;
  if(!exact(stored,['version','revision','history','requests'])||stored.version!==1||!revision(stored.revision)||!Array.isArray(stored.history)||!Array.isArray(stored.requests)||stored.history.length!==Math.min(20,stored.revision)||stored.requests.length!==Math.min(100,stored.revision))throw corrupt();
  const resultIds=new Set(),requestIds=new Set(),receipts=new Map();
  for(const receipt of stored.requests){
    if(!exact(receipt,['requestId','fingerprint','result'])||!requestIdValid(receipt.requestId)||!fingerprintValid(receipt.fingerprint)||!validResult(receipt.result)||receipt.requestId!==receipt.result.requestId||requestIds.has(receipt.requestId)||resultIds.has(receipt.result.id))throw corrupt();
    resultIds.add(receipt.result.id);requestIds.add(receipt.requestId);receipts.set(receipt.result.id,receipt.result);
  }
  const historyIds=new Set();
  for(let index=0;index<stored.history.length;index++){
    const result=stored.history[index];
    if(!validResult(result)||historyIds.has(result.id)||JSON.stringify(result)!==JSON.stringify(receipts.get(result.id))||result.id!==stored.requests[index].result.id)throw corrupt();
    historyIds.add(result.id);
  }
  return stored;
}

/** Read-only, detached public history. Internal idempotency receipts stay private. */
export function readRoulette(state) {
  const stored=storedRoulette(state);
  return structuredClone({revision:stored.revision,history:stored.history});
}

/** Call before resolving a live queue, so a committed request survives changes. */
export function replayRoulette(state,input) {
  if(!exact(input,['requestId','fingerprint'])||!requestIdValid(input.requestId)||!fingerprintValid(input.fingerprint))throw failure('룰렛 요청 식별 정보를 확인해 주세요.');
  const stored=storedRoulette(state),receipt=stored.requests.find(item=>item.requestId===input.requestId);
  if(!receipt)return null;
  if(receipt.fingerprint!==input.fingerprint)throw failure('이미 다른 내용으로 사용한 룰렛 요청입니다. 새로운 요청으로 다시 시도해 주세요.',409);
  return structuredClone({revision:stored.revision,result:receipt.result,replayed:true});
}

/**
 * Mutates only the provided OperationsStore update draft. The caller must await
 * its atomic commit before returning a winner. expectedRevision is roulette's
 * revision; fingerprint is SHA-256 of the server-validated submitted payload
 * (including its revisions), never a client-chosen winner or queue snapshot.
 */
export function spinRoulette(state,input,{randomIntImpl=randomInt,now=Date.now()}={}) {
  const allowed=['requestId','expectedRevision','source','items','entries','fingerprint'];
  if(!plain(input)||Object.keys(input).some(key=>!allowed.includes(key))||!requestIdValid(input.requestId)||!fingerprintValid(input.fingerprint)||!revision(input.expectedRevision)||!sources.includes(input.source)||(input.source==='custom'?Object.hasOwn(input,'entries'):Object.hasOwn(input,'items')))throw failure('룰렛 요청과 최신 상태 버전을 확인해 주세요.');
  const replay=replayRoulette(state,{requestId:input.requestId,fingerprint:input.fingerprint});
  if(replay){
    if(replay.result.source!==input.source||(input.source==='custom'&&JSON.stringify(normalizeRouletteItems(input.items))!==JSON.stringify(replay.result.entries)))throw failure('이미 다른 내용으로 사용한 룰렛 요청입니다.',409);
    return replay;
  }
  const stored=storedRoulette(state);
  if(stored.revision!==input.expectedRevision)throw failure('다른 운영자가 룰렛을 실행했습니다. 최신 기록을 확인한 뒤 다시 실행하세요.',409);
  if(stored.revision===Number.MAX_SAFE_INTEGER||!revision(state.revision??0)||state.revision===Number.MAX_SAFE_INTEGER||(Object.hasOwn(state,'history')&&!Array.isArray(state.history)))throw corrupt();
  if(!revision(now)||typeof randomIntImpl!=='function')throw failure('룰렛 추첨을 준비하지 못했습니다.',503);
  const entries=input.source==='custom'?normalizeRouletteItems(input.items):normalizeEntries(input.entries);
  let winnerIndex;
  try{winnerIndex=randomIntImpl(entries.length);}
  catch{throw failure('룰렛 추첨을 준비하지 못했습니다.',503);}
  if(!Number.isInteger(winnerIndex)||winnerIndex<0||winnerIndex>=entries.length)throw failure('룰렛 추첨 결과를 확인할 수 없습니다.',503);
  const result={id:randomUUID(),requestId:input.requestId,at:now,source:input.source,entries,winnerIndex,winner:{...entries[winnerIndex]}};
  // No draft mutation happens before all input, state and entropy checks pass.
  state.roulette={version:1,revision:stored.revision+1,history:[result,...stored.history].slice(0,20),requests:[{requestId:input.requestId,fingerprint:input.fingerprint,result},...stored.requests].slice(0,100)};
  state.revision=(state.revision??0)+1;
  state.history=[{action:'roulette_spin',at:now,rouletteId:result.id,source:result.source,entryCount:entries.length},...(state.history??[])].slice(0,200);
  return structuredClone({revision:state.roulette.revision,result,replayed:false});
}
