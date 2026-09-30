import { randomUUID } from 'node:crypto';
import { normalizeBroadcastSettings, validateBroadcastSettings } from './broadcast-settings.js';

export const MAX_BROADCAST_PRESETS=12;
export const BROADCAST_CONTEXTS=Object.freeze(['default','lolRift','lolAram','er']);
export const BROADCAST_SCENES=Object.freeze(['auto','standby','recruit','draw-ready','game','winners','attendance','teams','ended']);
export const DEFAULT_BROADCAST_AUTOMATION=Object.freeze({
  enabled:false,
  mapping:Object.freeze({default:'',lolRift:'',lolAram:'',er:''}),
  forcedScene:'auto',
  forcedSceneUntil:null,
  endedHoldSeconds:8
});

const text=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const isId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{6,80}$/.test(value);
const number=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};

export function normalizeBroadcastPresets(value=[]){
  if(!Array.isArray(value))return [];
  const out=[],seen=new Set();
  for(const item of value){
    if(!item||typeof item!=='object'||Array.isArray(item)||!isId(item.id)||seen.has(item.id))continue;
    const name=text(item.name,40);if(!name)continue;
    seen.add(item.id);
    out.push({id:item.id,name,settings:normalizeBroadcastSettings(item.settings),createdAt:Number(item.createdAt)||0,updatedAt:Number(item.updatedAt)||0});
    if(out.length>=MAX_BROADCAST_PRESETS)break;
  }
  return out;
}

export function normalizeBroadcastAutomation(value={},presets=[]){
  const validIds=new Set(normalizeBroadcastPresets(presets).map(p=>p.id)),rawMap=value?.mapping&&typeof value.mapping==='object'&&!Array.isArray(value.mapping)?value.mapping:{};
  const mapping=Object.fromEntries(BROADCAST_CONTEXTS.map(key=>[key,validIds.has(rawMap[key])?rawMap[key]:'']));
  const scene=BROADCAST_SCENES.includes(value?.forcedScene)?value.forcedScene:'auto';
  const until=Number(value?.forcedSceneUntil);
  return {
    enabled:value?.enabled===true,
    mapping,
    forcedScene:scene,
    forcedSceneUntil:scene==='auto'||!Number.isFinite(until)||until<=0?null:until,
    endedHoldSeconds:number(value?.endedHoldSeconds,DEFAULT_BROADCAST_AUTOMATION.endedHoldSeconds,0,60)
  };
}

export function validatePresetName(value){const name=text(value,40);if(!name)throw Error('프리셋 이름을 1~40자로 입력해 주세요.');return name;}

export function saveBroadcastPreset(presets,{id,name,settings},now=Date.now()){
  const list=normalizeBroadcastPresets(presets),safeName=validatePresetName(name),safeSettings=validateBroadcastSettings(settings);
  if(id!==undefined&&id!==null&&id!==''){
    if(!isId(id))throw Error('프리셋 ID가 올바르지 않습니다.');
    const index=list.findIndex(p=>p.id===id);if(index<0)throw Error('저장할 프리셋을 찾을 수 없습니다.');
    list[index]={...list[index],name:safeName,settings:safeSettings,updatedAt:now};return {presets:list,preset:list[index]};
  }
  if(list.length>=MAX_BROADCAST_PRESETS)throw Error(`방송 프리셋은 최대 ${MAX_BROADCAST_PRESETS}개까지 저장할 수 있습니다.`);
  if(list.some(p=>p.name.toLocaleLowerCase('ko-KR')===safeName.toLocaleLowerCase('ko-KR')))throw Error('같은 이름의 방송 프리셋이 이미 있습니다.');
  const preset={id:`bp_${randomUUID().replaceAll('-','')}`,name:safeName,settings:safeSettings,createdAt:now,updatedAt:now};
  list.unshift(preset);return {presets:list,preset};
}

export function deleteBroadcastPreset(presets,automation,id){
  if(!isId(id))throw Error('삭제할 프리셋을 선택해 주세요.');
  const list=normalizeBroadcastPresets(presets);if(!list.some(p=>p.id===id))throw Error('삭제할 프리셋을 찾을 수 없습니다.');
  const next=list.filter(p=>p.id!==id),auto=normalizeBroadcastAutomation(automation,next);
  return {presets:next,automation:auto};
}

export function validateBroadcastAutomation(input,presets=[]){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('방송 자동화 설정 형식을 확인해 주세요.');
  const known=new Set(['enabled','mapping','endedHoldSeconds']);for(const key of Object.keys(input))if(!known.has(key))throw Error(`지원하지 않는 방송 자동화 설정입니다: ${key}`);
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('자동 프리셋 사용 여부를 확인해 주세요.');
  if(input.mapping!==undefined){if(!input.mapping||typeof input.mapping!=='object'||Array.isArray(input.mapping))throw Error('게임별 프리셋 매핑을 확인해 주세요.');const keys=new Set(BROADCAST_CONTEXTS);for(const [key,value] of Object.entries(input.mapping)){if(!keys.has(key))throw Error(`지원하지 않는 방송 컨텍스트입니다: ${key}`);if(value!==''&&!isId(value))throw Error(`${key} 프리셋 ID가 올바르지 않습니다.`);}}
  if(input.endedHoldSeconds!==undefined&&(!Number.isFinite(Number(input.endedHoldSeconds))||Number(input.endedHoldSeconds)<0||Number(input.endedHoldSeconds)>60))throw Error('종료 장면 유지 시간은 0~60초입니다.');
  return normalizeBroadcastAutomation({...input,forcedScene:'auto',forcedSceneUntil:null},presets);
}

export function setForcedBroadcastScene(automation,input,now=Date.now(),presets=[]){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('장면 고정 설정 형식을 확인해 주세요.');
  const known=new Set(['scene','seconds']);for(const key of Object.keys(input))if(!known.has(key))throw Error(`지원하지 않는 장면 고정 설정입니다: ${key}`);
  const scene=String(input.scene||'auto');if(!BROADCAST_SCENES.includes(scene))throw Error('고정할 방송 장면을 확인해 주세요.');
  const seconds=Number(input.seconds??0);if(!Number.isFinite(seconds)||seconds<0||seconds>300)throw Error('장면 고정 시간은 0~300초입니다. 0은 수동 해제입니다.');
  const next={...normalizeBroadcastAutomation(automation,presets),forcedScene:scene,forcedSceneUntil:scene==='auto'||seconds===0?null:now+seconds*1000};
  return next;
}

export function contextForSession(session){if(!session)return 'default';if(session.game==='er')return 'er';return session.mode==='aram'?'lolAram':'lolRift';}

export function resolveBroadcastPresentation(state,now=Date.now()){
  const presets=normalizeBroadcastPresets(state?.broadcastPresets),automation=normalizeBroadcastAutomation(state?.broadcastAutomation,presets),base=normalizeBroadcastSettings(state?.broadcastSettings);
  let activePresetId='',settings=base;
  if(automation.enabled){const context=contextForSession(state?.session),id=automation.mapping[context]||automation.mapping.default||'',preset=presets.find(p=>p.id===id);if(preset){settings=preset.settings;activePresetId=preset.id;}}
  const forcedScene=automation.forcedScene!=='auto'&&(!automation.forcedSceneUntil||automation.forcedSceneUntil>now)?automation.forcedScene:'auto';
  return {settings,presets,automation,activePresetId,forcedScene};
}

export function exportBroadcastBundle(state){const presets=normalizeBroadcastPresets(state?.broadcastPresets),automation=normalizeBroadcastAutomation(state?.broadcastAutomation,presets);return {format:'daengdaeng-broadcast',version:1,exportedAt:new Date().toISOString(),settings:normalizeBroadcastSettings(state?.broadcastSettings),presets,automation:{enabled:automation.enabled,mapping:automation.mapping,endedHoldSeconds:automation.endedHoldSeconds}};}

export function importBroadcastBundle(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.format!=='daengdaeng-broadcast'||Number(input.version)!==1)throw Error('지원하는 방송 설정 파일이 아닙니다.');
  const settings=validateBroadcastSettings(input.settings||{}),presets=normalizeBroadcastPresets(input.presets||[]);
  if((input.presets||[]).length>MAX_BROADCAST_PRESETS)throw Error(`방송 프리셋은 최대 ${MAX_BROADCAST_PRESETS}개까지 가져올 수 있습니다.`);
  const automation=validateBroadcastAutomation(input.automation||{},presets);
  return {settings,presets,automation};
}
