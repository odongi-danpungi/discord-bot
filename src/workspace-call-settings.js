import { JsonStore } from './json-store.js';

const error=(message,status=400)=>Object.assign(Error(message),{status});
const validTimeout=value=>Number.isInteger(value)&&value>=15&&value<=300;
const validRevision=value=>Number.isSafeInteger(value)&&value>=0;

export function resolveLegacyCallTimeout({config,callSettings}) {
  if(!validTimeout(config?.participationCallTimeoutSeconds))throw error('호출 시간 환경 설정을 확인하세요.',503);
  // The existing single-server app keeps its environment-variable contract.
  // Only an explicitly enabled portal gives the saved preference precedence.
  if(config.multiWorkspaceEnabled!==true)return config.participationCallTimeoutSeconds;
  if(!callSettings||typeof callSettings.snapshot!=='function')throw error('호출 설정을 준비하지 못했습니다.',503);
  const snapshot=callSettings.snapshot();
  if(!validTimeout(snapshot?.settings?.timeoutSeconds)||!validRevision(snapshot?.revision))throw error('저장된 호출 설정을 확인하세요.',503);
  return snapshot.settings.timeoutSeconds;
}

export function validateCallSettingsInput(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||
    !Object.hasOwn(input,'timeoutSeconds')||!Object.hasOwn(input,'revision')||
    !validTimeout(input.timeoutSeconds)||!validRevision(input.revision)) {
    throw error('호출 시간은 15~300초 사이의 정수로 입력하고 최신 설정을 다시 확인하세요.');
  }
  return {timeoutSeconds:input.timeoutSeconds,revision:input.revision};
}

function validate(state) {
  return Boolean(state&&typeof state==='object'&&!Array.isArray(state)&&Object.keys(state).length===3&&
    state.version===1&&validTimeout(state.timeoutSeconds)&&validRevision(state.revision));
}

// Keep preferences separate from operations and the workspace registry so older
// releases can still read all existing queue, recovery and registry data.
export class WorkspaceCallSettingsStore extends JsonStore {
  constructor(operationsFile,timeoutSeconds=60) {
    const initial=Math.max(15,Math.min(300,Math.round(Number(timeoutSeconds)||60)));
    super(operationsFile+'.call-settings.json',{version:1,timeoutSeconds:initial,revision:0},validate,{maxBytes:8192});
  }
  snapshot() {
    const state=this.read();
    return {settings:{timeoutSeconds:state.timeoutSeconds},revision:state.revision};
  }
  async configure(input,{guard=()=>{}}={}) {
    const value=validateCallSettingsInput(input);
    let result;
    await this.update(async state=>{
      await guard();
      if(state.revision!==value.revision)throw error('다른 운영자가 설정을 변경했습니다. 최신 설정을 확인한 뒤 다시 저장하세요.',409);
      if(state.revision===Number.MAX_SAFE_INTEGER)throw error('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.',409);
      state.timeoutSeconds=value.timeoutSeconds;state.revision++;
      result={settings:{timeoutSeconds:state.timeoutSeconds},revision:state.revision};
    });
    return result;
  }
}

export async function saveWorkspaceCallSettings({store,calls,input,guard=()=>{}}) {
  const value=validateCallSettingsInput(input);
  if(!store||!calls)throw error('호출 설정을 준비하지 못했습니다. 잠시 후 다시 시도하세요.',503);
  // Serialize with call creation so a call never receives a partially saved
  // preference. Existing deadlines and timers remain unchanged.
  return calls.serial(async()=>{
    await guard();
    calls.ensureActive();
    if(calls.closed)throw error('서비스가 재시작 중입니다.',503);
    const result=await store.configure(value,{guard:async()=>{await guard();calls.ensureActive();if(calls.closed)throw error('서비스가 재시작 중입니다.',503);}});
    calls.timeoutSeconds=result.settings.timeoutSeconds;
    return result;
  });
}
