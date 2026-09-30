import { createHash, randomUUID } from 'node:crypto';
import { APP_VERSION, DATA_SCHEMA_VERSION } from './version.js';

const text=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const uniq=array=>new Set(array).size===array.length;
const dangerousKeys=new Set(['__proto__','prototype','constructor']);
function hasDangerousKeys(value,depth=0){if(depth>24||value===null||typeof value!=='object')return false;for(const key of Object.keys(value)){if(dangerousKeys.has(key)||hasDangerousKeys(value[key],depth+1))return true;}return false;}

export function recoveryDigest(records,operations){
  return createHash('sha256').update(JSON.stringify({records,operations})).digest('hex');
}

export function validRegistrationRecords(records,guildId=''){
  return Array.isArray(records)&&!hasDangerousKeys(records)&&records.every(record=>record&&typeof record==='object'&&typeof record.guildId==='string'&&typeof record.discordId==='string'&&(!guildId||record.guildId===guildId));
}

export function validOperationsState(value,guildId=''){
  if(!value||typeof value!=='object'||Array.isArray(value)||hasDangerousKeys(value)||!Array.isArray(value.history))return false;
  if(value.guildId&&guildId&&value.guildId!==guildId)return false;
  if(value.sessionArchive!==undefined&&!Array.isArray(value.sessionArchive))return false;
  if(value.reservations!==undefined&&!Array.isArray(value.reservations))return false;
  if(value.session){
    const s=value.session;
    if(!s||typeof s!=='object'||!Array.isArray(s.applicants)||!Array.isArray(s.winners)||!Array.isArray(s.confirmed)||!Array.isArray(s.teams))return false;
  }
  return true;
}


function sessionReferenceStatus(operations){
  const s=operations?.session;if(!s)return {ok:true,detail:'진행 중인 회차 없음'};
  const applicants=s.applicants||[],winners=s.winners||[],confirmed=s.confirmed||[],teams=(s.teams||[]).flat();
  const unique=uniq(applicants)&&uniq(winners)&&uniq(confirmed)&&uniq(teams);
  const subset=winners.every(id=>applicants.includes(id))&&confirmed.every(id=>winners.includes(id))&&teams.every(id=>winners.includes(id));
  return {ok:unique&&subset,detail:unique&&subset?'신청·당첨·참석·팀 참조 정상':'현재 회차에 중복 또는 잘못된 참가자 참조가 있습니다.'};
}

export function inspectBackup(bundle,guildId){
  const checks=[];
  const add=(id,label,status,detail='')=>checks.push({id,label,status,detail});
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle)){
    add('format','백업 파일 형식','fail','JSON 객체가 아닙니다.');
    return {ok:false,checks,stats:{records:0,history:0,archives:0}};
  }
  const version=Number(bundle.version);
  add('version','백업 버전',version===2?'pass':'fail',version===2?'지원 버전 2':'지원하지 않는 백업 버전입니다.');
  add('guild','Discord 서버 일치',bundle.guildId===guildId?'pass':'fail',bundle.guildId===guildId?'현재 서버와 일치합니다.':'다른 Discord 서버의 백업입니다.');
  const recordsOk=validRegistrationRecords(bundle.records,guildId);
  add('records','참가자 데이터 구조',recordsOk?'pass':'fail',recordsOk?`${bundle.records.length}명 확인`:'참가자 데이터 형식 또는 서버 ID가 올바르지 않습니다.');
  const ids=recordsOk?bundle.records.map(r=>r.discordId):[];
  const duplicateIds=ids.length-new Set(ids).size;
  add('duplicates','참가자 ID 중복',duplicateIds===0?'pass':'fail',duplicateIds?`${duplicateIds}개의 중복이 있습니다.`:'중복 없음');
  const operationsOk=validOperationsState(bundle.operations,guildId);
  add('operations','운영 데이터 구조',operationsOk?'pass':'fail',operationsOk?'운영 상태를 읽을 수 있습니다.':'운영 데이터 형식 또는 서버 ID가 올바르지 않습니다.');
  if(operationsOk){const schema=Number(bundle.operations.schemaVersion)||1;add('schema','백업 데이터 스키마',schema<=DATA_SCHEMA_VERSION?'pass':'fail',schema<=DATA_SCHEMA_VERSION?`schema v${schema} · 복원 시 v${DATA_SCHEMA_VERSION}으로 자동 변환`:`schema v${schema}은 현재 프로그램이 지원하는 v${DATA_SCHEMA_VERSION}보다 새 버전입니다.`);const sessionRefs=sessionReferenceStatus(bundle.operations);add('session-refs','현재 회차 참조',sessionRefs.ok?'pass':'fail',sessionRefs.detail);}
  const exportedAt=Date.parse(bundle.exportedAt||'');
  add('date','내보낸 시각',Number.isFinite(exportedAt)?'pass':'warn',Number.isFinite(exportedAt)?new Date(exportedAt).toISOString():'내보낸 시각을 확인할 수 없습니다.');
  const ok=checks.every(c=>c.status!=='fail');
  return {ok,checks,stats:{records:recordsOk?bundle.records.length:0,history:operationsOk?(bundle.operations.history?.length||0):0,archives:operationsOk?(bundle.operations.sessionArchive?.length||0):0},digest:ok?recoveryDigest(bundle.records,bundle.operations):null};
}

export function createRestorePoint({records,operations,label='수동 복원 지점',reason='manual',guildId,at=Date.now()}){
  if(!validRegistrationRecords(records,guildId)||!validOperationsState(operations,guildId))throw Error('현재 데이터를 복원 지점으로 저장할 수 없습니다. 데이터 검사를 실행해 주세요.');
  const safeLabel=text(label,60)||'수동 복원 지점';
  const point={id:`rp_${randomUUID()}`,label:safeLabel,reason:text(reason,40)||'manual',guildId,createdAt:at,recordCount:records.length,revision:Number(operations.revision)||0,records:structuredClone(records),operations:structuredClone(operations)};
  point.digest=recoveryDigest(point.records,point.operations);
  return point;
}

export function verifyRestorePoint(point,guildId){
  if(!point||typeof point!=='object')return {ok:false,reason:'복원 지점 형식이 올바르지 않습니다.'};
  if(point.guildId!==guildId)return {ok:false,reason:'다른 Discord 서버의 복원 지점입니다.'};
  if(!validRegistrationRecords(point.records,guildId)||!validOperationsState(point.operations,guildId))return {ok:false,reason:'복원 지점 데이터 구조가 손상됐습니다.'};
  const digest=recoveryDigest(point.records,point.operations);
  if(typeof point.digest!=='string'||digest!==point.digest)return {ok:false,reason:'복원 지점 무결성 해시가 일치하지 않습니다.'};
  return {ok:true,reason:'무결성 확인 완료',digest};
}

export function auditEntry({category='system',action='event',summary='',actor='dashboard',details=null,at=Date.now()}){
  const entry={id:`au_${randomUUID()}`,at,category:text(category,40)||'system',action:text(action,60)||'event',summary:text(summary,200)||'운영 변경',actor:text(actor,60)||'dashboard'};
  if(details&&typeof details==='object'&&!Array.isArray(details)){
    const safe={};
    for(const [key,value] of Object.entries(details).slice(0,12)){
      const k=text(key,40);if(!k||/token|password|secret|csrf|authorization/i.test(k))continue;
      if(['string','number','boolean'].includes(typeof value)||value===null)safe[k]=typeof value==='string'?text(value,160):value;
    }
    if(Object.keys(safe).length)entry.details=safe;
  }
  return entry;
}

function versionAtLeast(actual,minimum){
  const a=String(actual).replace(/^v/,'').split('.').map(Number),m=String(minimum).replace(/^v/,'').split('.').map(Number);
  for(let i=0;i<3;i++){if((a[i]||0)>(m[i]||0))return true;if((a[i]||0)<(m[i]||0))return false;}return true;
}

export function buildLocalSelfCheck({config,records,operations,recovery,recovered=false,nodeVersion=process.version,minNode='22.22.2'}){
  const checks=[];
  const add=(id,label,status,detail)=>checks.push({id,label,status,detail});
  const recordsValid=validRegistrationRecords(records,config.guildId);
  add('records','참가자 저장소',recordsValid?'pass':'fail',recordsValid?`${records.length}명 · 구조 정상`:'참가자 저장소 구조 또는 서버 ID를 확인하세요.');
  const ids=recordsValid?records.map(r=>r.discordId):[];
  add('record-duplicates','참가자 ID 중복',uniq(ids)?'pass':'fail',uniq(ids)?'중복 없음':'중복 Discord 사용자 ID가 있습니다.');
  const operationsValid=validOperationsState(operations,config.guildId);
  add('operations','운영 저장소',operationsValid?'pass':'fail',operationsValid?`Revision ${Number(operations.revision)||0}`:'운영 상태 구조를 확인하세요.');
  const schema=Number(operations?.schemaVersion)||1;add('schema','데이터 스키마',schema===DATA_SCHEMA_VERSION?'pass':schema<DATA_SCHEMA_VERSION?'warn':'fail',schema===DATA_SCHEMA_VERSION?`schema v${schema} · 최신`:schema<DATA_SCHEMA_VERSION?`schema v${schema} → v${DATA_SCHEMA_VERSION} 마이그레이션 필요`:`schema v${schema}은 현재 프로그램이 지원하는 v${DATA_SCHEMA_VERSION}보다 새 버전입니다.`);
  const appVersion=String(operations?.appVersion||'legacy');add('app-version','데이터 기록 앱 버전',appVersion===APP_VERSION?'pass':'warn',appVersion===APP_VERSION?APP_VERSION:`저장된 버전 ${appVersion} · 실행 버전 ${APP_VERSION}`);
  add('recovered','자동 복구 상태',recovered?'warn':'pass',recovered?'이번 실행에서 데이터 파일 무결성 복구가 수행됐습니다. 복구·감사 기록을 확인해 주세요.':'자동 복구 없이 원본 데이터를 읽었습니다.');
  const nodeOk=versionAtLeast(nodeVersion,minNode);
  add('node','Node.js 런타임',nodeOk?'pass':'warn',`${nodeVersion} · 최소 ${minNode}`);
  const local=['127.0.0.1','localhost','::1'].includes(config.host);
  add('exposure','대시보드 네트워크 노출',local?'pass':'warn',local?'localhost 전용':'외부 바인딩 상태입니다. HTTPS 리버스 프록시와 접근 제어가 필요합니다.');
  if(!local)add('broadcast-token','방송 접근 토큰',config.broadcastToken?.length>=24?'pass':'fail',config.broadcastToken?.length>=24?'24자 이상 토큰 설정됨':'외부 바인딩에서는 BROADCAST_TOKEN을 24자 이상 설정하세요.');
  const sessionRefs=operationsValid?sessionReferenceStatus(operations):{ok:false,detail:'운영 저장소 구조를 먼저 확인하세요.'};
  add('session-integrity','현재 회차 참조 무결성',sessionRefs.ok?'pass':'fail',sessionRefs.detail);
  const points=Array.isArray(recovery?.restorePoints)?recovery.restorePoints:[];
  const badPoints=points.filter(point=>!verifyRestorePoint(point,config.guildId).ok).length;
  add('restore-points','복원 지점 무결성',badPoints?'fail':'pass',badPoints?`${badPoints}개 복원 지점의 무결성 오류`:`${points.length}개 복원 지점 확인`);
  const audit=Array.isArray(recovery?.auditLog)?recovery.auditLog:[];
  add('audit','감사 로그','pass',`${audit.length}개 변경 기록 보관`);
  const counts={pass:checks.filter(c=>c.status==='pass').length,warn:checks.filter(c=>c.status==='warn').length,fail:checks.filter(c=>c.status==='fail').length};
  return {ok:counts.fail===0,checks,counts};
}
