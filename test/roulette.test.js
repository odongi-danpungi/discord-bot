import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OperationsStore } from '../src/operations.js';
import { normalizeRouletteItems, readRoulette, replayRoulette, spinRoulette } from '../src/roulette.js';

const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const request=(overrides={})=>{
  const value={requestId:'request-0001',expectedRevision:0,source:'custom',items:['달콩','봄이'],...overrides};
  return {...value,fingerprint:fingerprint({source:value.source,expectedRevision:value.expectedRevision,items:value.items})};
};
const throwsStatus=(fn,status)=>assert.throws(fn,error=>error.status===status);
const deterministic={randomIntImpl:()=>1,now:1000};

test('custom items preserve NFC labels and use stable ordinal IDs',()=>{
  assert.deepEqual(normalizeRouletteItems(['  시리  ','🐶']),[{id:'custom:0',label:'시리'},{id:'custom:1',label:'🐶'}]);
  assert.equal(normalizeRouletteItems(['😀'.repeat(80),'봄이'])[0].label.length,160);
});

test('sparse inputs and stored snapshots reject instead of creating missing participants',()=>{
  const state={};throwsStatus(()=>spinRoulette(state,request({items:Array(2)}),deterministic),400);assert.deepEqual(state,{});
  const value=request({source:'queue',items:undefined});delete value.items;value.entries=Array(2);
  throwsStatus(()=>spinRoulette(state,value,deterministic),400);assert.deepEqual(state,{});
  spinRoulette(state,request(),deterministic);state.roulette.history[0].entries=Array(2);
  throwsStatus(()=>readRoulette(state),503);
});

test('one hundred unique entries are accepted and every custom ID stays unique',()=>{
  const state={},items=Array.from({length:100},(_,index)=>`참가자 ${index}`),response=spinRoulette(state,request({items}),{now:1000,randomIntImpl:max=>max-1});
  assert.equal(response.result.entries.length,100);assert.equal(response.result.winnerIndex,99);assert.equal(new Set(response.result.entries.map(entry=>entry.id)).size,100);assert.equal(response.result.winner.label,'참가자 99');
});

for(const items of [[],['한명'],Array.from({length:101},(_,index)=>String(index)),['시리','  시리 '],['DOG','dog'],[' ','봄이'],['시리\n','봄이'],['시리\u202e','봄이'],['a'.repeat(81),'봄이'],['a'.repeat(100000),'봄이'],[null,'봄이'],['\ud800','봄이']])test(`invalid or duplicate custom items reject without mutation: ${JSON.stringify(items).slice(0,80)}`,()=>{
  const state={revision:7,history:[],session:{applicants:['a','b']}};
  const before=structuredClone(state);
  throwsStatus(()=>spinRoulette(state,request({items}),deterministic),400);
  assert.deepEqual(state,before);
});

test('equal-chance index is drawn once on the server and snapshots are detached',()=>{
  const state={revision:7,history:[],session:{applicants:['a','b']},reservations:[{userId:'a',round:2}]},beforeSession=structuredClone(state.session),beforeReservations=structuredClone(state.reservations);
  let seenMax;
  const response=spinRoulette(state,request(),{now:1000,randomIntImpl:max=>{seenMax=max;return 1;}});
  assert.equal(seenMax,2);assert.equal(response.result.winnerIndex,1);assert.deepEqual(response.result.winner,{id:'custom:1',label:'봄이'});assert.equal(response.result.requestId,'request-0001');
  assert.equal(response.revision,1);assert.equal(state.revision,8);assert.equal(state.history[0].action,'roulette_spin');assert.equal(response.replayed,false);
  assert.deepEqual(state.session,beforeSession);assert.deepEqual(state.reservations,beforeReservations);
  response.result.entries[0].label='changed';readRoulette(state).history[0].winner.label='changed';
  assert.equal(readRoulette(state).history[0].entries[0].label,'달콩');assert.equal(readRoulette(state).history[0].winner.label,'봄이');assert.equal('requests' in readRoulette(state),false);
});

test('real crypto randomInt always produces a valid winner index',()=>{
  for(let index=0;index<10;index++){
    const response=spinRoulette({},request({requestId:`crypto-${index}`.padEnd(8,'0')}));
    assert.ok([0,1].includes(response.result.winnerIndex));assert.deepEqual(response.result.winner,response.result.entries[response.result.winnerIndex]);
  }
});

test('queue identity allows same labels but rejects duplicate participant IDs',()=>{
  const entries=[{id:'discord:a',label:'동동'},{id:'naver:b',label:'동동'}],before=structuredClone(entries);
  const value=request({source:'queue',items:undefined});delete value.items;value.entries=entries;
  const state={};const response=spinRoulette(state,value,deterministic);
  assert.equal(response.result.winner.id,'naver:b');assert.deepEqual(entries,before);
  const invalid=request({source:'queue',items:undefined});delete invalid.items;invalid.entries=[{id:'same',label:'동동'},{id:'same',label:'시리'}];
  throwsStatus(()=>spinRoulette({},invalid,deterministic),400);
});

for(const entries of [[{id:'a',label:'a',weight:2},{id:'b',label:'b'}],[{id:'',label:'a'},{id:'b',label:'b'}],[{id:'a\n',label:'a'},{id:'b',label:'b'}],[{id:'a',label:'a'},null]])test(`invalid queue entries fail closed: ${JSON.stringify(entries)}`,()=>{
  const value=request({source:'queue',items:undefined});delete value.items;value.entries=entries;
  const state={};throwsStatus(()=>spinRoulette(state,value,deterministic),400);assert.deepEqual(state,{});
});

test('same request replays before revision checks with no second entropy draw',()=>{
  const state={},first=spinRoulette(state,request(),deterministic),before=structuredClone(state);
  const replay=spinRoulette(state,request(),{randomIntImpl:()=>{throw Error('must not reroll');}});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);assert.deepEqual(state,before);
  throwsStatus(()=>spinRoulette(state,request({requestId:'request-0002'}),deterministic),409);
  throwsStatus(()=>spinRoulette(state,request({items:['다른 이름','봄이']}),deterministic),409);
  throwsStatus(()=>spinRoulette(state,{...request(),items:['변경','봄이']},deterministic),409);
});

test('queue replay succeeds before resolving changed or unavailable live entries',()=>{
  const state={},value=request({source:'queue',items:undefined});delete value.items;value.entries=[{id:'a',label:'달콩'},{id:'b',label:'봄이'}];
  const first=spinRoulette(state,value,deterministic),receiptInput={requestId:value.requestId,fingerprint:value.fingerprint};
  assert.deepEqual(replayRoulette(state,receiptInput).result,first.result);
  assert.equal(spinRoulette(state,{...value,entries:[]},deterministic).replayed,true);
  assert.equal(replayRoulette(state,{...receiptInput,requestId:'unseen-request'}),null);
  throwsStatus(()=>replayRoulette(state,{...receiptInput,fingerprint:'0'.repeat(64)}),409);
});

for(const patch of [{winnerIndex:0},{winner:{id:'b',label:'b'}},{weights:[1,2]},{expectedRevision:-1},{expectedRevision:0.5},{source:'weighted'},{fingerprint:'client-text'},{requestId:'short'},{requestId:'../unsafe-request'},{entries:[]}])test(`untrusted outcome or malformed request rejects: ${JSON.stringify(patch)}`,()=>{
  const state={};throwsStatus(()=>spinRoulette(state,{...request(),...patch},deterministic),400);assert.deepEqual(state,{});
});

for(const index of [-1,2,0.5,NaN,undefined])test(`invalid entropy result ${String(index)} cannot mutate state`,()=>{
  const state={revision:2,history:[]},before=structuredClone(state);
  throwsStatus(()=>spinRoulette(state,request(),{now:1000,randomIntImpl:()=>index}),503);assert.deepEqual(state,before);
});

test('entropy provider failure has a safe error and leaves no winner or mutation',()=>{
  const state={revision:2,history:[]},before=structuredClone(state);
  assert.throws(()=>spinRoulette(state,request(),{now:1000,randomIntImpl:()=>{throw Error('internal entropy detail');}}),error=>error.status===503&&!error.message.includes('internal'));
  assert.deepEqual(state,before);
});

test('history and request receipts remain bounded while replaying a retained result',()=>{
  const state={};let retained;
  for(let index=0;index<110;index++){
    const value=request({requestId:`bounded-${index}`,expectedRevision:index});
    spinRoulette(state,value,deterministic);
    if(index===10)retained=value;
  }
  assert.equal(state.roulette.history.length,20);assert.equal(state.roulette.requests.length,100);assert.equal(readRoulette(state).revision,110);
  const replay=spinRoulette(state,retained,deterministic);assert.equal(replay.replayed,true);assert.equal(replay.revision,110);
  throwsStatus(()=>spinRoulette(state,request({requestId:'bounded-0',expectedRevision:0}),deterministic),409);
});

test('persisted malformed state is never silently initialized',()=>{
  for(const malformed of [null,undefined,{},[],{version:2,revision:0,history:[],requests:[]},{version:1,revision:1,history:[],requests:[]}]){
    const state={roulette:malformed},before=structuredClone(state);
    throwsStatus(()=>readRoulette(state),503);throwsStatus(()=>spinRoulette(state,request(),deterministic),503);assert.deepEqual(state,before);
  }
  const state={};spinRoulette(state,request(),deterministic);
  const mutations=[value=>{value.roulette.history[0].winnerIndex=5;},value=>{value.roulette.history[0].winner.label='not winner';},value=>{value.roulette.requests[0].requestId='different';},value=>{value.roulette.requests[0].fingerprint='bad';},value=>{value.roulette.history[0].entries.push({id:'duplicate',label:'달콩'});},value=>{value.roulette.requests.push(structuredClone(value.roulette.requests[0]));}];
  for(const mutate of mutations){const corrupt=structuredClone(state);mutate(corrupt);const before=structuredClone(corrupt);throwsStatus(()=>readRoulette(corrupt),503);assert.deepEqual(corrupt,before);}
});

async function fixture(fn){
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-roulette-')),file=path.join(dir,'operations.json');
  try{const operations=new OperationsStore(file);await operations.init();await fn({dir,file,operations});}
  finally{await rm(dir,{recursive:true,force:true});}
}

test('committed roulette receipt survives fresh OperationsStore initialization',()=>fixture(async({file,operations})=>{
  let first;await operations.update(state=>{first=spinRoulette(state,request(),deterministic);});
  const restarted=new OperationsStore(file);await restarted.init();
  let replay;await restarted.update(state=>{replay=spinRoulette(state,request(),{randomIntImpl:()=>{throw Error('must not reroll');}});});
  assert.deepEqual(replay.result,first.result);assert.equal(replay.replayed,true);assert.equal(restarted.read().revision,1);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).roulette.history[0],first.result);
}));

test('serialized concurrent operators with one revision commit only one spin',()=>fixture(async({operations})=>{
  const outcomes=await Promise.allSettled(['parallel-a','parallel-b'].map(requestId=>operations.update(state=>spinRoulette(state,request({requestId}),deterministic))));
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);assert.equal(outcomes.find(item=>item.status==='rejected').reason.status,409);
  assert.equal(operations.read().roulette.revision,1);assert.equal(operations.read().roulette.history.length,1);assert.equal(operations.read().revision,1);
  await operations.flush();
}));

test('a persistence failure exposes no committed result and retry draws once more',()=>fixture(async({operations})=>{
  const original=operations.writeUnlocked;operations.writeUnlocked=async()=>{throw Object.assign(Error('disk full'),{code:'ENOSPC'});};
  await assert.rejects(operations.update(state=>spinRoulette(state,request(),deterministic)),error=>error.code==='ENOSPC');
  assert.deepEqual(readRoulette(operations.read()),{revision:0,history:[]});
  operations.writeUnlocked=original;await operations.update(state=>spinRoulette(state,request(),deterministic));assert.equal(readRoulette(operations.read()).revision,1);
}));

test('storage validates a corrupt roulette field and preserves fail-closed data',()=>fixture(async({file,operations})=>{
  const state=operations.read();state.roulette={version:1,revision:1,history:[],requests:[]};
  await writeFile(file,JSON.stringify(state));await writeFile(file+'.bak',JSON.stringify(state));
  const fresh=new OperationsStore(file);
  await assert.rejects(fresh.init(),error=>error.code==='EDATA_CORRUPT');
}));
