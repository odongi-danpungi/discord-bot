import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertIntakeOperationsState, DEFAULT_INTAKE_POLICY, readIntakeSettings, readSessionIntakePolicy, saveIntakeSettings, validateIntakeSettingsInput } from '../src/intake-policy.js';
import { applyAction, OperationsStore } from '../src/operations.js';

const input=(settings={},revision=0)=>({...DEFAULT_INTAKE_POLICY,...settings,revision});
const fresh=()=>({session:null,history:[],reservations:[],sessionArchive:[],rounds:{},revision:0});
function opened(policy={},data={}){
  const state=fresh();state.intakeSettings={revision:1,settings:{...DEFAULT_INTAKE_POLICY,...policy}};
  applyAction(state,'open',{game:'lol',count:1,...data},1000);
  return state;
}
const join=(state,userId)=>applyAction(state,'join',{sessionId:state.session.id,userId},1001);
async function withStore(fn){
  const dir=await mkdtemp(path.join(tmpdir(),'daeng-intake-'));
  try{const file=path.join(dir,'operations.json'),store=new OperationsStore(file);await store.init();return await fn(store,file);}
  finally{await rm(dir,{recursive:true,force:true});}
}
const rejectsStatus=(fn,status)=>assert.rejects(fn,error=>error.status===status);

test('missing legacy settings use independent compatibility defaults; malformed present values fail closed',()=>{
  const first=readIntakeSettings(fresh());first.settings.maxApplicants=20;
  assert.deepEqual(readIntakeSettings(fresh()),{revision:0,settings:{...DEFAULT_INTAKE_POLICY}});
  for(const intakeSettings of [null,undefined,[],{}, {revision:0,settings:{...DEFAULT_INTAKE_POLICY,maxApplicants:'2'}}, {revision:0,settings:{...DEFAULT_INTAKE_POLICY},extra:true}])
    assert.throws(()=>readIntakeSettings({...fresh(),intakeSettings}),error=>error.status===503);
  assert.deepEqual(readSessionIntakePolicy({id:'legacy'}),DEFAULT_INTAKE_POLICY);
  for(const intakePolicy of [null,undefined,{...DEFAULT_INTAKE_POLICY,closeOnCapacity:true}])
    assert.throws(()=>readSessionIntakePolicy({intakePolicy}),error=>error.status===503);
});

test('input has exact fields, bounded integer limits, a valid duplicate mode and a finite revision',()=>{
  assert.deepEqual(validateIntakeSettingsInput(input({maxApplicants:1000,duplicatePolicy:'reject',closeOnCapacity:true},7)),input({maxApplicants:1000,duplicatePolicy:'reject',closeOnCapacity:true},7));
  for(const bad of [null,[],input({maxApplicants:-1}),input({maxApplicants:1001}),input({maxApplicants:1.5}),input({maxApplicants:'5'}),input({duplicatePolicy:'merge'}),input({closeOnCapacity:'true'}),input({closeOnCapacity:true}),input({},-1),input({},Number.MAX_SAFE_INTEGER+1),{...input(),extra:true},{maxApplicants:1,duplicatePolicy:'reject',revision:0}])
    assert.throws(()=>validateIntakeSettingsInput(bad),error=>error.status===400);
});

test('settings CAS is serialized; a stale save cannot change memory or file bytes',async()=>withStore(async(store,file)=>{
  const result=await Promise.allSettled([saveIntakeSettings({operations:store,input:input({maxApplicants:2})}),saveIntakeSettings({operations:store,input:input({maxApplicants:3})})]);
  assert.equal(result.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(result.find(item=>item.status==='rejected').reason.status,409);
  const before=await readFile(file);const state=store.read();
  await rejectsStatus(()=>saveIntakeSettings({operations:store,input:input({maxApplicants:4})}),409);
  assert.deepEqual(await readFile(file),before);assert.deepEqual(store.read(),state);
}));

test('save checks the guard inside the store queue after a pending operation',async()=>withStore(async(store,file)=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const blocking=store.update(async()=>{await waiting;});
  let locked=false;
  const saving=saveIntakeSettings({operations:store,input:input({maxApplicants:3}),guard:()=>{if(locked)throw Object.assign(Error('locked'),{status:423});}});
  const rejected=rejectsStatus(()=>saving,423);
  locked=true;release();await blocking;
  const before=await readFile(file);
  await rejected;
  assert.deepEqual(await readFile(file),before);assert.equal(Object.hasOwn(store.read(),'intakeSettings'),false);
}));

test('a persistence failure leaves intake policy and the running session unchanged',async()=>withStore(async(store,file)=>{
  await store.update(state=>applyAction(state,'open',{game:'lol',count:1}));
  const before=store.read(),bytes=await readFile(file),write=store.writeUnlocked;
  store.writeUnlocked=async()=>{throw Error('disk unavailable');};
  await assert.rejects(saveIntakeSettings({operations:store,input:input({maxApplicants:3})}),/disk unavailable/);
  store.writeUnlocked=write;
  assert.deepEqual(store.read(),before);assert.deepEqual(await readFile(file),bytes);
}));

test('saved settings apply only to the next round and persist across restart',async()=>withStore(async(store,file)=>{
  await saveIntakeSettings({operations:store,input:input({maxApplicants:2})});
  await store.update(state=>applyAction(state,'open',{game:'lol',count:1}));
  const current=store.read().session;
  await saveIntakeSettings({operations:store,input:input({maxApplicants:1,duplicatePolicy:'reject'},1)});
  assert.deepEqual(store.read().session,current);
  const restarted=new OperationsStore(file);await restarted.init();
  assert.equal(restarted.read().session.intakePolicy.maxApplicants,2);
  assert.equal(readIntakeSettings(restarted.read()).settings.maxApplicants,1);
  await restarted.update(state=>{applyAction(state,'end');applyAction(state,'open',{game:'lol',count:1});});
  assert.deepEqual(restarted.read().session.intakePolicy,{maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:false});
}));

test('simultaneous admissions cannot exceed a finite capacity',async()=>withStore(async(store,file)=>{
  await saveIntakeSettings({operations:store,input:input({maxApplicants:2})});
  await store.update(state=>applyAction(state,'open',{game:'lol',count:1}));
  const sessionId=store.read().session.id;
  const result=await Promise.allSettled(['first','second','third'].map(userId=>store.update(state=>applyAction(state,'join',{sessionId,userId}))));
  assert.equal(result.filter(item=>item.status==='fulfilled').length,2);
  assert.equal(result.find(item=>item.status==='rejected').reason.status,409);
  assert.deepEqual(store.read().session.applicants,['first','second']);
  const before=await readFile(file);
  await rejectsStatus(()=>store.update(state=>applyAction(state,'join',{sessionId,userId:'overflow'})),409);
  assert.deepEqual(await readFile(file),before);
}));

test('keep_existing preserves order at capacity; reject preserves existing participant state',()=>{
  const state=opened({maxApplicants:2});join(state,'first');join(state,'second');
  const before=structuredClone(state);join(state,'first');assert.deepEqual(state,before);
  assert.throws(()=>join(state,'third'),error=>error.status===409);assert.deepEqual(state,before);
  const rejected=opened({maxApplicants:2,duplicatePolicy:'reject'});join(rejected,'first');
  const original=structuredClone(rejected);
  assert.throws(()=>join(rejected,'first'),error=>error.status===409);assert.deepEqual(rejected,original);
});

test('future reservations do not use capacity, but a postponed return must have an available place',()=>{
  const state=opened({maxApplicants:1});join(state,'first');
  applyAction(state,'postpone_later',{sessionId:state.session.id,userId:'first'});
  join(state,'second');
  const before=structuredClone(state);
  assert.throws(()=>join(state,'first'),error=>error.status===409);assert.deepEqual(state,before);
  applyAction(state,'leave',{sessionId:state.session.id,userId:'second'});
  join(state,'first');
  assert.deepEqual(state.session.applicants,['first']);assert.deepEqual(state.session.postponed,[]);assert.deepEqual(state.reservations,[]);
});

test('opening below carried reservations preserves all due applicants and future reservations',()=>{
  const state=fresh();
  state.intakeSettings={revision:1,settings:{maxApplicants:1,duplicatePolicy:'keep_existing',closeOnCapacity:false}};
  state.reservations=[{game:'lol',userId:'due-1',round:1},{game:'lol',userId:'due-2',round:1},{game:'lol',userId:'future',round:2}];
  applyAction(state,'open',{game:'lol',count:1});
  assert.deepEqual(state.session.applicants,['due-1','due-2','future']);assert.deepEqual(state.session.postponed,['future']);
  assert.deepEqual(state.reservations,[{game:'lol',userId:'future',round:2}]);
  const before=structuredClone(state);assert.throws(()=>join(state,'new'),error=>error.status===409);assert.deepEqual(state,before);
});

test('capacity closure is recorded and reopening can free a place without changing the round policy',()=>{
  const state=opened({maxApplicants:1,closeOnCapacity:true});join(state,'first');
  assert.equal(state.session.phase,'closed');assert.equal(state.session.closeReason,'capacity');
  const policy=structuredClone(state.session.intakePolicy);
  applyAction(state,'reopen');assert.equal(state.session.phase,'open');assert.deepEqual(state.session.intakePolicy,policy);
  join(state,'first');assert.equal(state.session.phase,'open');
  assert.throws(()=>join(state,'second'),error=>error.status===409);assert.equal(state.session.phase,'open');
  applyAction(state,'postpone_next',{sessionId:state.session.id,userId:'first'});
  join(state,'second');assert.equal(state.session.phase,'closed');assert.equal(state.session.closeReason,'capacity');
});

test('carried reservations reaching capacity close on open without losing overflow applicants',()=>{
  const state=fresh();state.intakeSettings={revision:1,settings:{maxApplicants:1,duplicatePolicy:'reject',closeOnCapacity:true}};
  state.reservations=[{game:'lol',userId:'first',round:1},{game:'lol',userId:'second',round:1}];
  applyAction(state,'open',{game:'lol',count:1});
  assert.equal(state.session.phase,'closed');assert.equal(state.session.closeReason,'capacity');assert.deepEqual(state.session.applicants,['first','second']);
  applyAction(state,'reopen');assert.equal(state.session.phase,'open');assert.throws(()=>join(state,'third'),error=>error.status===409);
});

test('finite capacity smaller than winner count cannot start or consume reservations',async()=>withStore(async(store,file)=>{
  await saveIntakeSettings({operations:store,input:input({maxApplicants:1})});
  await store.update(state=>{state.reservations=[{game:'lol',userId:'reserved',round:1}];});
  const before=store.read(),bytes=await readFile(file);
  await rejectsStatus(()=>store.update(state=>applyAction(state,'open',{game:'lol',count:2})),400);
  assert.deepEqual(store.read(),before);assert.deepEqual(await readFile(file),bytes);
}));

test('time-based closure and stale buttons remain effective with intake limits',()=>{
  const state=opened({maxApplicants:2},{closeMinutes:1});
  assert.throws(()=>applyAction(state,'join',{sessionId:state.session.id,userId:'late'},61000),/마감/);
  assert.throws(()=>applyAction(state,'join',{sessionId:'old',userId:'stale'},1001),/이전 모집/);
  assert.deepEqual(state.session.applicants,[]);
});

test('resizing cannot exceed the current immutable intake limit after future settings change',()=>{
  const state=opened({maxApplicants:2});state.intakeSettings={revision:2,settings:{...DEFAULT_INTAKE_POLICY,maxApplicants:10}};
  const before=structuredClone(state);
  assert.throws(()=>applyAction(state,'resize',{count:3}),error=>error.status===400);assert.deepEqual(state,before);
  applyAction(state,'resize',{count:2});assert.equal(state.session.count,2);
});

test('a legacy active session ignores newly saved policy until the next round',async()=>withStore(async(store,file)=>{
  await store.update(state=>{applyAction(state,'open',{game:'lol',count:1});delete state.session.intakePolicy;});
  await saveIntakeSettings({operations:store,input:input({maxApplicants:1,duplicatePolicy:'reject'})});
  await store.update(state=>{join(state,'first');join(state,'second');join(state,'first');});
  assert.deepEqual(store.read().session.applicants,['first','second']);
  const restarted=new OperationsStore(file);await restarted.init();
  assert.equal(Object.hasOwn(restarted.read().session,'intakePolicy'),false);
  await restarted.update(state=>{applyAction(state,'end');applyAction(state,'open',{game:'lol',count:1});});
  assert.equal(restarted.read().session.intakePolicy.maxApplicants,1);
}));

test('malformed settings and session policies cannot be committed by direct writes or state replacement',async()=>withStore(async(store,file)=>{
  const state=store.read(),bytes=await readFile(file),malformed={...state,intakeSettings:null};
  assert.equal(store.validate(malformed),false);
  await assert.rejects(store.write(malformed),/형식/);
  await rejectsStatus(()=>store.update(current=>Object.assign(current,malformed)),503);
  assert.deepEqual(store.read(),state);assert.deepEqual(await readFile(file),bytes);
  const invalidSession=opened();invalidSession.session.intakePolicy=null;
  assert.equal(store.validate(invalidSession),false);
  await assert.rejects(store.write(invalidSession),/형식/);
  await rejectsStatus(()=>store.update(current=>{for(const key of Object.keys(current))delete current[key];Object.assign(current,invalidSession);}),503);
  assert.deepEqual(store.read(),state);assert.deepEqual(await readFile(file),bytes);
}));

test('all malformed disk candidates fail closed and preserve forensic bytes instead of defaulting',async()=>withStore(async(store,file)=>{
  const malformed={...store.read(),intakeSettings:null},payload=JSON.stringify(malformed)+'\n';
  await writeFile(file,payload);await writeFile(file+'.bak',payload);
  const bytes=await readFile(file),backupBytes=await readFile(file+'.bak');
  await assert.rejects(new OperationsStore(file).init(),error=>error.code==='EDATA_CORRUPT');
  assert.deepEqual(await readFile(file),bytes);assert.deepEqual(await readFile(file+'.bak'),backupBytes);
  const state=opened();state.session.intakePolicy=null;
  assert.throws(()=>join(state,'first'),error=>error.status===503);
  state.session.phase='closed';assert.throws(()=>applyAction(state,'reopen'),error=>error.status===503);
}));

test('invalid primary policy recovers only from a validated backup and retains its saved settings',async()=>withStore(async(store,file)=>{
  await saveIntakeSettings({operations:store,input:input({maxApplicants:4,duplicatePolicy:'reject'})});
  await store.update(state=>applyAction(state,'open',{game:'lol',count:1}));
  const good=store.read();await store.write(good);
  const damaged=structuredClone(good);damaged.session.intakePolicy={...damaged.session.intakePolicy,maxApplicants:'4'};
  await writeFile(file,JSON.stringify(damaged)+'\n');
  const restarted=new OperationsStore(file);await restarted.init();
  assert.equal(restarted.recovered,true);assert.equal(restarted.recoverySource,'backup');
  assert.deepEqual(restarted.read(),good);assert.equal(readIntakeSettings(restarted.read()).settings.maxApplicants,4);
  await restarted.update(state=>join(state,'first'));assert.deepEqual(restarted.read().session.applicants,['first']);
}));

test('malformed backup cannot override a valid primary policy and is repaired from that primary',async()=>withStore(async(store,file)=>{
  await saveIntakeSettings({operations:store,input:input({maxApplicants:4,duplicatePolicy:'reject'})});
  const good=store.read(),damaged={...good,intakeSettings:{revision:1,settings:{...DEFAULT_INTAKE_POLICY,maxApplicants:'4'}}};
  await writeFile(file+'.bak',JSON.stringify(damaged)+'\n');
  const primaryBytes=await readFile(file);
  const restarted=new OperationsStore(file);await restarted.init();
  assert.equal(restarted.recovered,false);assert.deepEqual(restarted.read(),good);
  assert.deepEqual(await readFile(file),primaryBytes);assert.deepEqual(JSON.parse(await readFile(file+'.bak','utf8')),good);
}));

test('the shared recovery assertion accepts genuinely absent legacy fields without adding defaults',()=>{
  const legacy=fresh();assert.equal(assertIntakeOperationsState(legacy),true);assert.equal(Object.hasOwn(legacy,'intakeSettings'),false);
  const session=opened();delete session.intakeSettings;delete session.session.intakePolicy;
  assert.equal(assertIntakeOperationsState(session),true);assert.equal(Object.hasOwn(session.session,'intakePolicy'),false);
  for(const intakeSettings of [undefined,null,{revision:0,settings:{...DEFAULT_INTAKE_POLICY,extra:true}}])
    assert.throws(()=>assertIntakeOperationsState({...legacy,intakeSettings}),error=>error.status===503);
});
