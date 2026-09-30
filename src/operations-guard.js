import { randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeBroadcastAutomation, normalizeBroadcastPresets } from './broadcast-presets.js';
import { normalizeBroadcastSettings } from './broadcast-settings.js';
import { DATA_SCHEMA_VERSION } from './version.js';

const text=(value,max=200)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const same=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y)};
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value);

function setDefault(state,key,value,changes){
  if(state[key]===undefined){state[key]=structuredClone(value);changes.push(`${key} 기본값 생성`);}
}
function ensureArray(state,key,changes){if(!Array.isArray(state[key])){state[key]=[];changes.push(`${key} 배열 복구`);}}
function ensureObject(state,key,changes){if(!plainObject(state[key])){state[key]={};changes.push(`${key} 객체 복구`);}}

export function migrateOperationsState(input,{guildId='',appVersion=''}={}){
  const state=structuredClone(input||{}),changes=[];
  const from=Number.isInteger(state.schemaVersion)&&state.schemaVersion>0?state.schemaVersion:1;
  if(from>DATA_SCHEMA_VERSION)throw Error(`운영 데이터 스키마 v${from}은 현재 프로그램(v${DATA_SCHEMA_VERSION})보다 새 버전입니다. 더 최신 프로그램으로 실행해 주세요.`);
  setDefault(state,'session',null,changes);ensureArray(state,'history',changes);ensureArray(state,'reservations',changes);ensureArray(state,'sessionArchive',changes);ensureObject(state,'rounds',changes);ensureArray(state,'requests',changes);ensureArray(state,'draws',changes);ensureArray(state,'avatars',changes);
  if(!Number.isFinite(state.revision)){state.revision=0;changes.push('revision 숫자 복구');}
  if(guildId&&state.guildId!==guildId){if(state.guildId)throw Error('운영 데이터의 Discord 서버 ID가 현재 설정과 다릅니다.');state.guildId=guildId;changes.push('guildId 연결');}
  {
    const settings=normalizeBroadcastSettings(state.broadcastSettings),presets=normalizeBroadcastPresets(state.broadcastPresets),automation=normalizeBroadcastAutomation(state.broadcastAutomation,presets);
    if(JSON.stringify(state.broadcastSettings)!==JSON.stringify(settings)){state.broadcastSettings=settings;changes.push('방송 장면 설정 정규화');}
    if(JSON.stringify(state.broadcastPresets)!==JSON.stringify(presets)){state.broadcastPresets=presets;changes.push('방송 프리셋 구조 정규화');}
    if(JSON.stringify(state.broadcastAutomation)!==JSON.stringify(automation)){state.broadcastAutomation=automation;changes.push('방송 자동화 구조 정규화');}
  }
  if(state.schemaVersion!==DATA_SCHEMA_VERSION){state.schemaVersion=DATA_SCHEMA_VERSION;changes.push(`schemaVersion ${from} → ${DATA_SCHEMA_VERSION}`);}
  if(appVersion&&state.appVersion!==appVersion){state.appVersion=appVersion;changes.push(`appVersion ${text(input?.appVersion||'legacy',40)} → ${appVersion}`);}
  return {state,from,to:DATA_SCHEMA_VERSION,changed:changes.length>0,changes};
}

function compact(value){
  if(value===undefined)return '없음';if(value===null)return 'null';
  if(Array.isArray(value))return `[${value.length}개]`;
  if(plainObject(value))return `{${Object.keys(value).length}개 항목}`;
  const out=String(value);return out.length>80?out.slice(0,77)+'…':out;
}
function walkDiff(before,after,path,out,depth=0){
  if(out.length>=60)return;
  if(JSON.stringify(before)===JSON.stringify(after))return;
  if(depth>=3||!plainObject(before)||!plainObject(after)){out.push({path,before:compact(before),after:compact(after)});return;}
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].sort();
  for(const key of keys){if(out.length>=60)break;walkDiff(before[key],after[key],path?`${path}.${key}`:key,out,depth+1);}
}
export function buildSettingsDiff(before={},after={}){
  const keys=['broadcastSettings','broadcastPresets','broadcastAutomation','guide','panel'];
  const out=[];for(const key of keys)walkDiff(before?.[key],after?.[key],key,out);return out;
}

export function migrationPreview(state,options={}){
  const result=migrateOperationsState(state,options);
  return {needed:result.changed,from:result.from,to:result.to,changes:result.changes};
}

export function createApprovalGuard({ttlMs=120000}={}){
  const pending=new Map();
  const cleanup=()=>{const now=Date.now();for(const [id,item] of pending)if(item.expiresAt<=now)pending.delete(id);};
  return {
    prepare(action,targetKey,{risk='high',summary='위험 작업'}={}){
      cleanup();const id=randomBytes(18).toString('base64url'),code=randomBytes(3).toString('hex').toUpperCase(),phrase=`APPLY-${code}`,expiresAt=Date.now()+ttlMs;
      pending.set(id,{action,targetKey:String(targetKey||''),phrase,expiresAt});
      return {approvalId:id,phrase,expiresAt,action,risk,summary:text(summary,160)};
    },
    consume(approvalId,phrase,action,targetKey){
      cleanup();const item=pending.get(String(approvalId||''));if(!item)throw Error('승인 요청이 없거나 만료됐습니다. 위험 작업을 다시 준비해 주세요.');
      pending.delete(String(approvalId));
      if(item.expiresAt<=Date.now())throw Error('승인 시간이 만료됐습니다. 다시 준비해 주세요.');
      if(item.action!==action||item.targetKey!==String(targetKey||''))throw Error('승인한 작업과 실제 요청이 다릅니다.');
      if(!same(item.phrase,phrase))throw Error('2단계 승인 문구가 일치하지 않습니다.');
      return true;
    },
    size(){cleanup();return pending.size;}
  };
}

export function hasMeaningfulOperations(state,recordCount=0){
  return Boolean(recordCount||state?.session||(state?.history?.length)||(state?.reservations?.length)||(state?.sessionArchive?.length)||(Number(state?.revision)>0));
}
