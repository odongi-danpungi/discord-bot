const failure=(message,status=400)=>Object.assign(Error(message),{status});
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const validRevision=value=>Number.isSafeInteger(value)&&value>=0;
const policyKeys=['maxApplicants','duplicatePolicy','closeOnCapacity'];

export const DEFAULT_INTAKE_POLICY=Object.freeze({maxApplicants:0,duplicatePolicy:'keep_existing',closeOnCapacity:false});
// A legacy cafe queue rejected repeated names. Preserve that contract until an
// operator explicitly saves a policy for a subsequent publication.
export const LEGACY_NAVER_INTAKE_POLICY=Object.freeze({maxApplicants:0,duplicatePolicy:'reject',closeOnCapacity:false});

export function isValidIntakePolicy(value) {
  return plain(value)&&Object.keys(value).length===policyKeys.length&&policyKeys.every(key=>Object.hasOwn(value,key))&&
    Number.isInteger(value.maxApplicants)&&value.maxApplicants>=0&&value.maxApplicants<=1000&&
    ['keep_existing','reject'].includes(value.duplicatePolicy)&&typeof value.closeOnCapacity==='boolean'&&
    (!value.closeOnCapacity||value.maxApplicants>0);
}

export function snapshotIntakePolicy(value,{legacy=DEFAULT_INTAKE_POLICY}={}) {
  const policy=value===undefined?legacy:value;
  if(!isValidIntakePolicy(policy))throw failure('저장된 접수 조건을 확인할 수 없습니다. 제작자에게 점검을 요청해 주세요.',503);
  return {...policy};
}

export function readSessionIntakePolicy(session,{legacy=DEFAULT_INTAKE_POLICY}={}) {
  if(!plain(session))throw failure('현재 모집의 접수 조건을 확인할 수 없습니다.',503);
  // Explicit null or undefined is corruption; only a genuinely absent field is
  // allowed to use the known compatibility default.
  return Object.hasOwn(session,'intakePolicy')?snapshotIntakePolicy(session.intakePolicy===undefined?null:session.intakePolicy):snapshotIntakePolicy(undefined,{legacy});
}

export function readIntakeSettings(state) {
  if(!plain(state))throw failure('접수 설정을 준비하지 못했습니다.',503);
  if(!Object.hasOwn(state,'intakeSettings'))return {revision:0,settings:{...DEFAULT_INTAKE_POLICY}};
  const stored=state.intakeSettings;
  if(!plain(stored)||Object.keys(stored).length!==2||!Object.hasOwn(stored,'revision')||!validRevision(stored.revision)||!Object.hasOwn(stored,'settings')||!isValidIntakePolicy(stored.settings))
    throw failure('저장된 접수 설정을 확인할 수 없습니다. 제작자에게 점검을 요청해 주세요.',503);
  return {revision:stored.revision,settings:{...stored.settings}};
}

// Use the same optional-field contract at storage, mutation and recovery
// boundaries. A present malformed policy must never become an empty default.
export function assertIntakeOperationsState(state) {
  readIntakeSettings(state);
  if(state.session!==null&&state.session!==undefined)readSessionIntakePolicy(state.session);
  return true;
}

export function validateIntakeSettingsInput(input) {
  if(!plain(input)||Object.keys(input).length!==4||!policyKeys.every(key=>Object.hasOwn(input,key))||!validRevision(input.revision)||!Object.hasOwn(input,'revision'))
    throw failure('접수 조건과 최신 설정 버전을 확인해 주세요.');
  const settings=Object.fromEntries(policyKeys.map(key=>[key,input[key]]));
  if(!isValidIntakePolicy(settings))throw failure('접수 정원은 0~1000명 사이의 정수이며, 정원 자동 마감에는 1명 이상의 정원이 필요합니다.');
  return {...settings,revision:input.revision};
}

export function activeIntakeCount(session) {
  if(!Array.isArray(session?.applicants)||!Array.isArray(session.postponed??[]))throw failure('현재 접수 인원을 확인할 수 없습니다.',503);
  const postponed=new Set(session.postponed??[]);
  return new Set(session.applicants.filter(id=>!postponed.has(id))).size;
}

export function intakeAtCapacity(policy,count) {
  if(!isValidIntakePolicy(policy)||!Number.isInteger(count)||count<0)throw failure('접수 정원 상태를 확인할 수 없습니다.',503);
  return policy.maxApplicants>0&&count>=policy.maxApplicants;
}

export function assertIntakeAdmission(policy,count) {
  if(intakeAtCapacity(policy,count))throw failure(`접수 정원 ${policy.maxApplicants}명에 도달했습니다.`,409);
}

export async function saveIntakeSettings({operations,input,guard=()=>{}}) {
  const value=validateIntakeSettingsInput(input);
  if(!operations||typeof operations.update!=='function')throw failure('접수 설정을 준비하지 못했습니다.',503);
  let result;
  await operations.update(async state=>{
    await guard();
    const current=readIntakeSettings(state);
    if(current.revision!==value.revision)throw failure('다른 운영자가 접수 조건을 변경했습니다. 최신 설정을 확인한 뒤 다시 저장하세요.',409);
    if(current.revision===Number.MAX_SAFE_INTEGER)throw failure('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청해 주세요.',409);
    if(!validRevision(state.revision??0)||state.revision===Number.MAX_SAFE_INTEGER)throw failure('운영 상태 버전을 확인할 수 없습니다.',503);
    state.intakeSettings={revision:current.revision+1,settings:Object.fromEntries(policyKeys.map(key=>[key,value[key]]))};
    state.revision=(state.revision??0)+1;
    result=readIntakeSettings(state);
  });
  return result;
}
