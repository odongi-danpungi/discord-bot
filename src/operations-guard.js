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
  const repaired=repairOperationsConsistency(state);if(repaired.changed)changes.push(...repaired.changes);
  if(state.schemaVersion!==DATA_SCHEMA_VERSION){state.schemaVersion=DATA_SCHEMA_VERSION;changes.push(`schemaVersion ${from} → ${DATA_SCHEMA_VERSION}`);}
  if(appVersion&&state.appVersion!==appVersion){state.appVersion=appVersion;changes.push(`appVersion ${text(input?.appVersion||'legacy',40)} → ${appVersion}`);}
  return {state,from,to:DATA_SCHEMA_VERSION,changed:changes.length>0,changes};
}


const uniqStrings=value=>[...new Set((Array.isArray(value)?value:[]).filter(item=>typeof item==='string'&&item))];
const validPhase=new Set(['open','closed','drawn','checking','ended']);

export function repairOperationsConsistency(state,{now=Date.now()}={}){
  const changes=[];
  if(!plainObject(state))return {state,changed:false,changes};
  const session=state.session;
  if(session&&plainObject(session)){
    const normalizeList=key=>{
      const before=Array.isArray(session[key])?session[key]:[];
      const after=uniqStrings(before);
      if(JSON.stringify(before)!==JSON.stringify(after)){session[key]=after;changes.push(`session.${key} 중복/잘못된 값 정리`);}else session[key]=after;
    };
    for(const key of ['applicants','postponed','winners','confirmed','excluded'])normalizeList(key);
    if(!Array.isArray(session.teams)){session.teams=[];changes.push('session.teams 배열 복구');}
    else {
      const teams=session.teams.map(team=>uniqStrings(team)).filter(team=>team.length);
      if(JSON.stringify(teams)!==JSON.stringify(session.teams)){session.teams=teams;changes.push('session.teams 중복/잘못된 값 정리');}
    }
    if(!validPhase.has(session.phase)){session.phase='closed';changes.push('알 수 없는 모집 상태를 closed로 복구');}
    const applicantSet=new Set(session.applicants);
    const postponed=session.postponed.filter(id=>applicantSet.has(id));
    if(JSON.stringify(postponed)!==JSON.stringify(session.postponed)){session.postponed=postponed;changes.push('신청자에 없는 미루기 상태 제거');}
    const winnerSet=new Set(session.winners);
    const confirmed=session.confirmed.filter(id=>winnerSet.has(id));
    if(JSON.stringify(confirmed)!==JSON.stringify(session.confirmed)){session.confirmed=confirmed;changes.push('당첨자에 없는 참석 확인 제거');}
    const invalidWinners=session.winners.some(id=>!applicantSet.has(id))||session.winners.length!==new Set(session.winners).size||((session.phase==='drawn'||session.phase==='checking')&&session.winners.length!==Number(session.count));
    if(invalidWinners&&session.phase!=='ended'){
      session.phase='closed';session.winners=[];session.confirmed=[];session.excluded=[];session.teams=[];delete session.deadline;session.deadlineSynced=false;
      changes.push('불완전한 추첨 상태를 closed로 되돌림');
    }else if(['open','closed'].includes(session.phase)&&(session.winners.length||session.confirmed.length||session.teams.length)){
      session.winners=[];session.confirmed=[];session.excluded=[];session.teams=[];delete session.deadline;session.deadlineSynced=false;
      changes.push('추첨 전 상태의 잔여 결과 제거');
    }
    if(session.phase==='open'&&Number.isFinite(session.closeAt)&&session.closeAt>0&&now>=session.closeAt){session.phase='closed';changes.push('중단 중 만료된 모집을 closed로 복구');}
    if(session.phase==='checking'){
      if(!Number.isFinite(session.deadline)||session.deadline<=0){session.phase='drawn';delete session.deadline;session.deadlineSynced=false;changes.push('잘못된 참석 마감 시간을 제거하고 drawn으로 복구');}
      else if(now>=session.deadline&&session.deadlineSynced!==false){session.deadlineSynced=false;changes.push('중단 중 만료된 참석 확인의 Discord 재동기화 예약');}
      if(!Number.isInteger(session.attendanceVersion)||session.attendanceVersion<1){session.attendanceVersion=1;changes.push('attendanceVersion 복구');}
    }
    const flatTeams=session.teams.flat(),expected=new Set(session.winners);
    if(session.teams.length&&(flatTeams.length!==expected.size||new Set(flatTeams).size!==flatTeams.length||flatTeams.some(id=>!expected.has(id))||session.winners.some(id=>!session.confirmed.includes(id)))){
      session.teams=[];changes.push('당첨/참석 상태와 불일치하는 팀 편성 제거');
    }
  }
  const reservations=Array.isArray(state.reservations)?state.reservations:[];
  const byKey=new Map();
  for(const row of reservations){
    if(!row||!['lol','er'].includes(row.game)||typeof row.userId!=='string'||!row.userId||!Number.isInteger(row.round)||row.round<1){changes.push('잘못된 예약 항목 제거');continue;}
    byKey.set(`${row.game}:${row.userId}`,{game:row.game,userId:row.userId,round:row.round});
  }
  const normalizedReservations=[...byKey.values()];
  if(JSON.stringify(normalizedReservations)!==JSON.stringify(reservations)){state.reservations=normalizedReservations;changes.push('예약 중복/형식 정리');}
  if(Array.isArray(state.requests)){
    const seen=new Set(),requests=[];
    for(const row of state.requests){if(!row||typeof row.id!=='string'||!row.id||typeof row.action!=='string'||seen.has(row.id))continue;seen.add(row.id);requests.push(row);if(requests.length>=100)break;}
    if(JSON.stringify(requests)!==JSON.stringify(state.requests)){state.requests=requests;changes.push('중복/잘못된 요청 이력 정리');}
  }
  return {state,changed:changes.length>0,changes};
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
