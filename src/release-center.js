import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify
} from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm
} from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_RELEASE_TRUST_KEYS } from './release-trust-root.js';
import { inspectProjectSupplyChain, reviewReleaseDependencies } from './supply-chain.js';
import { atomicCopyFile, atomicWriteFile, removeDurable } from './durable-file.js';

const FORMAT_V1='daengdaeng-update-v1';
const FORMAT_V2='daengdaeng-update-v2';
const FORMAT_V3='daengdaeng-update-v3';
const STATE_VERSION=3;
const TRUST_STATE_VERSION=1;
const DEFAULT_TRUST_POLICY='warn';
const TRUST_POLICIES=new Set(['warn','required']);
const MAX_FILES=400;
const MAX_FILE_BYTES=4*1024*1024;
const MAX_BUNDLE_BYTES=6*1024*1024;
const ROOT_FILES=new Set(['package.json','package-lock.json','README.md','CHANGELOG.md','START.cmd','DEV.cmd','DEMO.cmd','SETTINGS.cmd','.env.example','.gitignore','LIVE_DASHBOARD_PREVIEW.html']);
const ROOT_DIRS=['src/','public/','scripts/','test/'];
const BLOCKED_PARTS=new Set(['.git','node_modules','data','.env','config.local.json','config.json']);
const SIGNING_DOMAIN='DAENGDAENG-RELEASE-SIGNATURE-V1\0';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const safeText=(value,max=120)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const isHash=value=>/^[a-f0-9]{64}$/.test(String(value||''));
const semver=value=>{const m=String(value||'').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);return m?m.slice(1).map(Number):null;};
const normalizeChannel=value=>['stable','beta'].includes(String(value||'').toLowerCase())?String(value).toLowerCase():'stable';

export function compareVersions(a,b){
  const x=semver(a),y=semver(b);if(!x||!y)return null;
  for(let i=0;i<3;i++){if(x[i]>y[i])return 1;if(x[i]<y[i])return -1;}return 0;
}

export function normalizeReleasePath(input){
  const raw=String(input||'').replace(/\\/g,'/').replace(/^\.\//,'');
  if(!raw||raw.startsWith('/')||raw.includes('\0'))throw Error('업데이트 파일 경로가 올바르지 않습니다.');
  const normalized=path.posix.normalize(raw);
  if(normalized==='.'||normalized==='..'||normalized.startsWith('../')||normalized.includes('/../'))throw Error('프로젝트 밖의 파일은 업데이트할 수 없습니다.');
  const parts=normalized.split('/');
  if(parts.some(part=>BLOCKED_PARTS.has(part)))throw Error(`보호된 경로는 업데이트할 수 없습니다: ${normalized}`);
  const allowed=ROOT_FILES.has(normalized)||ROOT_DIRS.some(prefix=>normalized.startsWith(prefix));
  if(!allowed)throw Error(`허용되지 않은 업데이트 경로입니다: ${normalized}`);
  return normalized;
}

async function assertNoSymlinkPath(root,relative){
  const parts=normalizeReleasePath(relative).split('/');let current=path.resolve(root);
  for(const part of parts){
    current=path.join(current,part);
    try{const info=await lstat(current);if(info.isSymbolicLink())throw Error(`심볼릭 링크 경로는 업데이트할 수 없습니다: ${relative}`);}catch(error){if(error?.code==='ENOENT')break;throw error;}
  }
}

async function fileHash(file){const data=await readFile(file);return {sha256:sha256(data),bytes:data.length};}
async function fileHashOrNull(file){try{return await fileHash(file);}catch(error){if(error?.code==='ENOENT'||error?.code==='ENOTDIR')return null;throw error;}}

async function walk(dir,root,items){
  let info;try{info=await lstat(dir);}catch(error){if(error?.code==='ENOENT')return;throw error;}
  if(!info.isDirectory()||info.isSymbolicLink())throw Error('Manifest source must be a regular directory');
  const entries=await readdir(dir,{withFileTypes:true});
  for(const entry of entries){
    const absolute=path.join(dir,entry.name),relative=path.relative(root,absolute).replace(/\\/g,'/');
    if(BLOCKED_PARTS.has(entry.name))continue;
    if(entry.isSymbolicLink())throw Error('Manifest cannot include symbolic links');
    if(entry.isDirectory()){await walk(absolute,root,items);continue;}
    if(!entry.isFile())throw Error('Manifest contains an unsupported file type');
    const normalized=normalizeReleasePath(relative),meta=await fileHash(absolute);items.push({path:normalized,...meta});
  }
}

export async function buildCurrentManifest(projectRoot,version,schemaVersion){
  const root=path.resolve(projectRoot),files=[];
  for(const name of ROOT_FILES){const file=path.join(root,name);let info;try{info=await lstat(file);}catch(error){if(error?.code==='ENOENT')continue;throw error;}if(!info.isFile()||info.isSymbolicLink())throw Error('Manifest root entry must be a regular file');files.push({path:name,...await fileHash(file)});}
  for(const prefix of ROOT_DIRS)await walk(path.join(root,prefix),root,files);
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const body={format:'daengdaeng-manifest-v1',version,schemaVersion:Number(schemaVersion)||1,files};
  return {...body,digest:sha256(JSON.stringify(body))};
}

function canonicalFiles(bundle,strong){
  return (bundle.files||[]).map(file=>strong
    ?{path:file.path,sha256:file.sha256,bytes:Number(file.bytes)||0,baseExists:Boolean(file.baseExists),baseSha256:file.baseSha256||null}
    :{path:file.path,sha256:file.sha256,bytes:Number(file.bytes)||0});
}

function canonicalDeletes(bundle,strong){
  if(!strong)return [...(bundle.deletes||[])];
  return (bundle.deletes||[]).map(item=>typeof item==='string'?{path:item,baseSha256:null}:{path:item.path,baseSha256:item.baseSha256||null});
}

function canonicalBundle(bundle){
  if(bundle.format===FORMAT_V3){
    return {
      format:FORMAT_V3,
      baseVersion:bundle.baseVersion,
      targetVersion:bundle.targetVersion,
      schemaVersion:Number(bundle.schemaVersion)||1,
      baseManifestDigest:bundle.baseManifestDigest||'',
      channel:normalizeChannel(bundle.channel),
      createdAt:String(bundle.createdAt||''),
      files:canonicalFiles(bundle,true),
      deletes:canonicalDeletes(bundle,true)
    };
  }
  if(bundle.format===FORMAT_V2){
    return {
      format:FORMAT_V2,
      baseVersion:bundle.baseVersion,
      targetVersion:bundle.targetVersion,
      schemaVersion:Number(bundle.schemaVersion)||1,
      baseManifestDigest:bundle.baseManifestDigest||'',
      files:canonicalFiles(bundle,true),
      deletes:canonicalDeletes(bundle,true)
    };
  }
  return {
    format:FORMAT_V1,
    baseVersion:bundle.baseVersion,
    targetVersion:bundle.targetVersion,
    schemaVersion:Number(bundle.schemaVersion)||1,
    files:canonicalFiles(bundle,false),
    deletes:canonicalDeletes(bundle,false)
  };
}

function signingMessage(bundle){
  return Buffer.from(`${SIGNING_DOMAIN}${String(bundle.manifestDigest||'')}`,'utf8');
}

export function inspectReleasePublicKey(publicKeyPem,{name='사용자 릴리스 키'}={}){
  let key;
  try{key=createPublicKey(String(publicKeyPem||''));}catch{throw Error('Ed25519 공개키 PEM 형식을 확인해 주세요.');}
  if(key.asymmetricKeyType!=='ed25519')throw Error('릴리스 신뢰 키는 Ed25519 공개키여야 합니다.');
  const der=key.export({type:'spki',format:'der'}),fingerprint=sha256(der),keyId=`dd-${fingerprint.slice(0,16)}`;
  const normalizedPem=String(key.export({type:'spki',format:'pem'}));
  return {keyId,fingerprint,name:safeText(name,80)||'사용자 릴리스 키',publicKeyPem:normalizedPem};
}

function normalizeTrustedKeys(keys=[]){
  const normalized=[];
  for(const raw of keys){
    try{
      const parsed=inspectReleasePublicKey(raw.publicKeyPem,{name:raw.name});
      if(raw.keyId&&raw.keyId!==parsed.keyId)continue;
      if(raw.fingerprint&&raw.fingerprint!==parsed.fingerprint)continue;
      normalized.push({...parsed,builtin:Boolean(raw.builtin),addedAt:Number(raw.addedAt)||0});
    }catch{}
  }
  return normalized;
}

export function verifyReleaseSignature(bundle,{trustedKeys=[]}={}){
  const block=bundle?.signature;
  if(!block||typeof block!=='object')return {valid:false,trusted:false,status:'missing',detail:'v3 패키지에는 Ed25519 서명이 필요합니다.'};
  if(block.algorithm!=='Ed25519')return {valid:false,trusted:false,status:'invalid',detail:'지원하지 않는 릴리스 서명 알고리즘입니다.'};
  const keyId=safeText(block.keyId,80),signatureText=String(block.signatureBase64||'');
  if(!/^dd-[a-f0-9]{16}$/.test(keyId))return {valid:false,trusted:false,status:'invalid',detail:'릴리스 서명 keyId 형식이 올바르지 않습니다.'};
  let signature;try{signature=Buffer.from(signatureText,'base64');}catch{return {valid:false,trusted:false,status:'invalid',detail:'릴리스 서명을 읽지 못했습니다.'};}
  if(signature.length!==64)return {valid:false,trusted:false,status:'invalid',detail:'Ed25519 서명 길이가 올바르지 않습니다.'};
  const trusted=normalizeTrustedKeys(trustedKeys),trustedKey=trusted.find(key=>key.keyId===keyId);
  let candidate=null;
  if(block.publicKeyPem){
    try{candidate=inspectReleasePublicKey(block.publicKeyPem,{name:block.keyName||'패키지 서명 키'});}catch(error){return {valid:false,trusted:false,status:'invalid',detail:error.message};}
    if(candidate.keyId!==keyId)return {valid:false,trusted:false,status:'invalid',detail:'패키지 공개키 fingerprint와 keyId가 일치하지 않습니다.'};
    if(block.fingerprint&&block.fingerprint!==candidate.fingerprint)return {valid:false,trusted:false,status:'invalid',detail:'패키지 공개키 fingerprint가 서명 정보와 일치하지 않습니다.'};
  }
  const keyForVerification=trustedKey||candidate;
  if(!keyForVerification)return {valid:false,trusted:false,status:'untrusted',keyId,detail:`신뢰 저장소에 ${keyId} 공개키가 없습니다.`};
  let valid=false;
  try{valid=cryptoVerify(null,signingMessage(bundle),createPublicKey(keyForVerification.publicKeyPem),signature);}catch{}
  if(!valid)return {valid:false,trusted:Boolean(trustedKey),status:'invalid',keyId,detail:'Ed25519 서명 검증에 실패했습니다.'};
  if(!trustedKey)return {valid:true,trusted:false,status:'untrusted',keyId,fingerprint:candidate.fingerprint,candidateKey:candidate,detail:`서명 자체는 유효하지만 ${keyId} 키를 아직 신뢰하지 않았습니다.`};
  return {valid:true,trusted:true,status:'trusted',keyId,fingerprint:trustedKey.fingerprint,name:trustedKey.name,builtin:Boolean(trustedKey.builtin),detail:`신뢰된 Ed25519 서명 · ${trustedKey.name}`};
}

export function inspectReleaseBundle(bundle,{currentVersion,currentSchema=1,trustedKeys=[],signaturePolicy=DEFAULT_TRUST_POLICY}={}){
  const checks=[],add=(id,label,status,detail)=>checks.push({id,label,status,detail});
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle))return {ok:false,status:'fail',checks:[{id:'format',label:'업데이트 패키지',status:'fail',detail:'JSON 객체 형식이 아닙니다.'}]};
  const legacy=bundle.format===FORMAT_V1,strong=bundle.format===FORMAT_V2,signed=bundle.format===FORMAT_V3,strongBase=strong||signed;
  const base=safeText(bundle.baseVersion),target=safeText(bundle.targetVersion),baseCmp=compareVersions(base,currentVersion),targetCmp=compareVersions(target,currentVersion);
  add('format','패키지 형식',legacy||strong||signed?'pass':'fail',legacy||strong||signed?`${bundle.format}${legacy?' · 레거시 기준 무결성':signed?' · Ed25519 서명':''}`:`${FORMAT_V1}, ${FORMAT_V2} 또는 ${FORMAT_V3} 형식이 필요합니다.`);
  add('base','기준 버전',baseCmp===0?'pass':'fail',baseCmp===0?`${base} → 현재 버전 일치`:`패키지 기준 ${base||'없음'} / 현재 ${currentVersion}`);
  add('target','대상 버전',targetCmp===1?'pass':'fail',targetCmp===1?`${currentVersion} → ${target}`:'대상 버전은 현재보다 높은 정식 버전이어야 합니다.');
  const schema=Number(bundle.schemaVersion)||0;add('schema','데이터 스키마',schema>=Number(currentSchema||1)?'pass':'fail',schema>=Number(currentSchema||1)?`schema v${schema}`:`현재 schema v${currentSchema}보다 낮은 패키지는 차단됩니다.`);
  if(strongBase)add('base-manifest','기준 Manifest',isHash(bundle.baseManifestDigest)?'pass':'fail',isHash(bundle.baseManifestDigest)?bundle.baseManifestDigest:`${signed?'v3':'v2'} 패키지는 baseManifestDigest가 필요합니다.`);
  else add('base-manifest','기준 Manifest','warn','v1 호환 패키지입니다. 현재 파일의 기준 SHA-256 강제 검증은 지원하지 않습니다.');
  if(signed){
    const rawChannel=String(bundle.channel||'').toLowerCase(),createdAt=Date.parse(String(bundle.createdAt||''));
    const channelOk=['stable','beta'].includes(rawChannel),createdAtOk=Number.isFinite(createdAt),metaOk=channelOk&&createdAtOk;
    add('release-meta','릴리스 메타데이터',metaOk?'pass':'fail',metaOk?`${rawChannel} · ${new Date(createdAt).toISOString()}`:!channelOk?'v3 패키지 channel은 stable 또는 beta여야 합니다.':'v3 패키지는 유효한 createdAt이 필요합니다.');
  }
  const files=Array.isArray(bundle.files)?bundle.files:[],deletes=Array.isArray(bundle.deletes)?bundle.deletes:[];
  add('count','변경 파일 수',files.length+deletes.length>0&&files.length<=MAX_FILES&&deletes.length<=MAX_FILES?'pass':'fail',`쓰기 ${files.length}개 · 삭제 ${deletes.length}개`);
  const seen=new Set();let totalBytes=0,pathFailure=null,hashFailure=null,baseHashFailure=null;
  const normalizedFiles=[];
  for(const item of files){
    try{
      const p=normalizeReleasePath(item.path);if(seen.has(p))throw Error(`중복 경로: ${p}`);seen.add(p);
      const content=Buffer.from(String(item.contentBase64||''),'base64');totalBytes+=content.length;if(content.length>MAX_FILE_BYTES)throw Error(`파일이 너무 큽니다: ${p}`);
      const digest=sha256(content);if(!isHash(item.sha256)||digest!==item.sha256)throw Error(`SHA-256 불일치: ${p}`);if(Number(item.bytes)!==content.length)throw Error(`파일 크기 불일치: ${p}`);
      let baseExists=null,baseSha256=null;
      if(strongBase){baseExists=Boolean(item.baseExists);baseSha256=item.baseSha256||null;if(baseExists&&!isHash(baseSha256))throw Error(`기준 SHA-256 누락: ${p}`);if(!baseExists&&baseSha256!==null)throw Error(`신규 파일의 기준 SHA-256은 null이어야 합니다: ${p}`);}
      normalizedFiles.push({path:p,sha256:digest,bytes:content.length,content,baseExists,baseSha256});
    }catch(error){const msg=String(error.message);if(msg.includes('기준 SHA-256'))baseHashFailure=baseHashFailure||msg;else if(msg.includes('SHA-256')||msg.includes('크기'))hashFailure=hashFailure||msg;else pathFailure=pathFailure||msg;}
  }
  const normalizedDeletes=[];
  for(const raw of deletes){
    try{
      const item=strongBase?(typeof raw==='string'?{path:raw,baseSha256:null}:raw):{path:raw,baseSha256:null};
      const p=normalizeReleasePath(item.path);if(seen.has(p))throw Error(`쓰기/삭제가 중복된 경로: ${p}`);seen.add(p);
      if(strongBase&&!isHash(item.baseSha256))throw Error(`삭제 파일 기준 SHA-256 누락: ${p}`);
      normalizedDeletes.push({path:p,baseSha256:item.baseSha256||null});
    }catch(error){const msg=String(error.message);if(msg.includes('기준 SHA-256'))baseHashFailure=baseHashFailure||msg;else pathFailure=pathFailure||msg;}
  }
  add('paths','경로 보호',pathFailure?'fail':'pass',pathFailure||'data/.env/config/node_modules 및 프로젝트 밖 경로 차단');
  add('hash','대상 파일 무결성',hashFailure?'fail':'pass',hashFailure||`${normalizedFiles.length}개 파일 SHA-256 확인`);
  add('base-hash','기준 파일 무결성',baseHashFailure?'fail':strongBase?'pass':'warn',baseHashFailure||(strongBase?'변경/삭제 파일 기준 SHA-256 포함':'v1 호환 모드 · 적용 직전 기준 파일 강제 검증 없음'));
  add('size','패키지 크기',totalBytes<=MAX_BUNDLE_BYTES?'pass':'fail',`${Math.round(totalBytes/1024)}KB / 최대 ${Math.round(MAX_BUNDLE_BYTES/1024/1024)}MB`);
  let digestOk=false,manifestDigest='';try{manifestDigest=sha256(JSON.stringify(canonicalBundle(bundle)));digestOk=isHash(bundle.manifestDigest)&&manifestDigest===bundle.manifestDigest;}catch{}
  add('manifest','패키지 Manifest 무결성',digestOk?'pass':'fail',digestOk?manifestDigest:'manifestDigest가 패키지 내용과 일치하지 않습니다.');
  const policy=TRUST_POLICIES.has(signaturePolicy)?signaturePolicy:DEFAULT_TRUST_POLICY;
  let signature={valid:false,trusted:false,status:'unsigned',detail:'서명되지 않은 호환 패키지입니다.'};
  if(signed){
    signature=digestOk?verifyReleaseSignature({...bundle,manifestDigest},{trustedKeys}):{valid:false,trusted:false,status:'invalid',detail:'Manifest 무결성이 먼저 통과해야 서명을 검증할 수 있습니다.'};
    add('signature','릴리스 서명',signature.valid&&signature.trusted?'pass':'fail',signature.detail);
  }else add('signature','릴리스 서명',policy==='required'?'fail':'warn',policy==='required'?'현재 Trust Policy는 SIGNED REQUIRED입니다. v3 서명 패키지만 허용됩니다.':'서명되지 않은 v1/v2 호환 패키지입니다. 필요하면 Trust Policy를 SIGNED REQUIRED로 강화할 수 있습니다.');
  const fail=checks.some(c=>c.status==='fail');
  return {
    ok:!fail,
    status:fail?'fail':'pass',
    format:bundle.format,
    integrityMode:signed?'signed':strong?'strong':'legacy',
    trustPolicy:policy,
    signature,
    channel:signed?normalizeChannel(bundle.channel):null,
    createdAt:signed?String(bundle.createdAt||''):null,
    checks,
    baseVersion:base,
    targetVersion:target,
    schemaVersion:schema,
    baseManifestDigest:strongBase?bundle.baseManifestDigest||null:null,
    manifestDigest,
    stats:{files:normalizedFiles.length,deletes:normalizedDeletes.length,totalBytes},
    normalized:{files:normalizedFiles,deletes:normalizedDeletes}
  };
}

export async function compareReleaseToCurrent(bundle,projectRoot){
  const root=path.resolve(projectRoot),rows=[],strong=bundle.integrityMode!=='legacy';
  for(const item of bundle.normalized.files){
    const file=path.join(root,item.path),current=await fileHashOrNull(file);
    const action=current?.sha256===item.sha256?'unchanged':current?'change':'add';
    let baseStatus='legacy',drift=false;
    if(strong){
      if(current?.sha256===item.sha256)baseStatus='already-target';
      else if(item.baseExists&&current?.sha256===item.baseSha256)baseStatus='match';
      else if(!item.baseExists&&!current)baseStatus='match';
      else{baseStatus='drift';drift=true;}
    }
    rows.push({path:item.path,action,currentSha256:current?.sha256||null,targetSha256:item.sha256,baseSha256:item.baseSha256||null,baseStatus,drift,bytes:item.bytes});
  }
  for(const item of bundle.normalized.deletes){
    const file=path.join(root,item.path),current=await fileHashOrNull(file);
    const action=current?'delete':'missing-delete';
    let baseStatus='legacy',drift=false;
    if(strong){if(!current)baseStatus='already-target';else if(current.sha256===item.baseSha256)baseStatus='match';else{baseStatus='drift';drift=true;}}
    rows.push({path:item.path,action,currentSha256:current?.sha256||null,targetSha256:null,baseSha256:item.baseSha256||null,baseStatus,drift,bytes:0});
  }
  const counts={
    add:rows.filter(r=>r.action==='add').length,
    change:rows.filter(r=>r.action==='change').length,
    delete:rows.filter(r=>r.action==='delete').length,
    unchanged:rows.filter(r=>r.action==='unchanged').length,
    missingDelete:rows.filter(r=>r.action==='missing-delete').length,
    drift:rows.filter(r=>r.drift).length
  };
  return {rows,counts,integrityMode:bundle.integrityMode,driftRows:rows.filter(r=>r.drift)};
}

async function restoreFromRollback(projectRoot,rollbackPath){
  const meta=JSON.parse(await readFile(path.join(rollbackPath,'rollback.json'),'utf8'));let ok=true,errors=[];
  for(const item of [...(meta.files||[])].reverse()){
    try{
      const relative=normalizeReleasePath(item.path);await assertNoSymlinkPath(projectRoot,relative);const target=path.join(projectRoot,relative);
      if(item.existed){const source=path.join(rollbackPath,relative),sourceMeta=await fileHash(source);if(item.sha256&&sourceMeta.sha256!==item.sha256)throw Error(`롤백 스냅샷 SHA-256 불일치: ${relative}`);await mkdir(path.dirname(target),{recursive:true});await atomicCopyFile(source,target,{temporary:`${target}.rollback-${process.pid}.tmp`});}
      else await removeDurable(target,{force:true});
    }catch(error){ok=false;errors.push(safeText(error?.message,220));}
  }
  return {ok,errors,meta};
}

async function verifyRestored(projectRoot,rollbackPath){
  const meta=JSON.parse(await readFile(path.join(rollbackPath,'rollback.json'),'utf8'));const errors=[];
  for(const item of meta.files||[]){const target=path.join(projectRoot,normalizeReleasePath(item.path)),current=await fileHashOrNull(target);if(item.existed){if(!current||item.sha256&&current.sha256!==item.sha256)errors.push(item.path);}else if(current)errors.push(item.path);}
  return {ok:errors.length===0,errors};
}

async function verifyTargetState(inspected,projectRoot){
  const errors=[];
  for(const item of inspected.normalized.files){const current=await fileHashOrNull(path.join(projectRoot,item.path));if(!current||current.sha256!==item.sha256)errors.push(item.path);}
  for(const item of inspected.normalized.deletes){const current=await fileHashOrNull(path.join(projectRoot,item.path));if(current)errors.push(item.path);}
  return {ok:errors.length===0,errors};
}

function normalizeTrustState(raw){
  const policy=TRUST_POLICIES.has(raw?.policy)?raw.policy:DEFAULT_TRUST_POLICY,keys=[];
  for(const item of Array.isArray(raw?.keys)?raw.keys:[]){
    try{
      const parsed=inspectReleasePublicKey(item.publicKeyPem,{name:item.name});
      if(keys.some(key=>key.keyId===parsed.keyId))continue;
      keys.push({...parsed,addedAt:Number(item.addedAt)||Date.now()});
    }catch{}
  }
  return {version:TRUST_STATE_VERSION,policy,keys};
}

export class ReleaseCenter{
  constructor({projectRoot,stateDir,currentVersion,currentSchema}={}){
    this.projectRoot=path.resolve(projectRoot);
    this.stateDir=path.resolve(stateDir||path.join(this.projectRoot,'data','releases'));
    this.currentVersion=currentVersion;
    this.currentSchema=currentSchema;
    this.stateFile=path.join(this.stateDir,'release-state.json');
    this.stagedFile=path.join(this.stateDir,'staged-release.json');
    this.journalFile=path.join(this.stateDir,'transaction-journal.json');
    this.rollbackDir=path.join(this.stateDir,'rollback');
    this.trustFile=path.join(this.stateDir,'trusted-keys.json');
    this.state={version:STATE_VERSION,status:'idle',history:[]};
    this.trust={version:TRUST_STATE_VERSION,policy:DEFAULT_TRUST_POLICY,keys:[]};
    this.trustLoadError=null;
  }
  async init(){
    await mkdir(this.stateDir,{recursive:true});await mkdir(this.rollbackDir,{recursive:true});
    try{this.state=JSON.parse(await readFile(this.stateFile,'utf8'));}catch{}
    try{this.trust=normalizeTrustState(JSON.parse(await readFile(this.trustFile,'utf8')));}catch(error){if(error?.code!=='ENOENT')this.trustLoadError='trusted-keys.json을 읽지 못했습니다. 내장 신뢰 키만 사용합니다.';}
    this.state.version=STATE_VERSION;const previousStatus=this.state.status,recovery=await this.recoverInterruptedTransaction();this.recoveredThisBoot=Boolean(recovery?.ok);
    if(!recovery&&previousStatus==='crash-recovered-restart-required'){this.state={...this.state,status:'crash-recovered',lastError:null,restartedAfterRecoveryAt:Date.now()};await this.save();}
    return this;
  }
  async save(){await mkdir(this.stateDir,{recursive:true});await atomicWriteFile(this.stateFile,JSON.stringify(this.state,null,2)+'\n',{mode:0o600,temporary:this.stateFile+'.tmp'});}
  async saveTrust(){await mkdir(this.stateDir,{recursive:true});await atomicWriteFile(this.trustFile,JSON.stringify(this.trust,null,2)+'\n',{mode:0o600,temporary:this.trustFile+'.tmp'});this.trustLoadError=null;}
  async writeJournal(data){await atomicWriteFile(this.journalFile,JSON.stringify(data,null,2)+'\n',{mode:0o600,temporary:this.journalFile+'.tmp'});}
  async clearJournal(){await removeDurable(this.journalFile,{force:true});}
  snapshot(){const s=structuredClone(this.state);delete s.rollbackPath;return s;}
  allTrustedKeys(){
    const map=new Map();
    for(const key of normalizeTrustedKeys(BUILTIN_RELEASE_TRUST_KEYS))map.set(key.keyId,key);
    for(const key of normalizeTrustedKeys(this.trust.keys))if(!map.has(key.keyId))map.set(key.keyId,key);
    return [...map.values()];
  }
  trustSnapshot(){
    const builtin=normalizeTrustedKeys(BUILTIN_RELEASE_TRUST_KEYS).map(key=>({keyId:key.keyId,name:key.name,fingerprint:key.fingerprint,builtin:true,addedAt:0}));
    const local=normalizeTrustedKeys(this.trust.keys).map(key=>({keyId:key.keyId,name:key.name,fingerprint:key.fingerprint,builtin:false,addedAt:key.addedAt||0}));
    return {version:TRUST_STATE_VERSION,policy:this.trust.policy,keys:[...builtin,...local],builtinCount:builtin.length,localCount:local.length,loadError:this.trustLoadError};
  }
  previewTrustedKey(publicKeyPem,name='사용자 릴리스 키'){return inspectReleasePublicKey(publicKeyPem,{name});}
  getTrustedKey(keyId){return this.trustSnapshot().keys.find(key=>key.keyId===keyId)||null;}
  async importTrustedKey({publicKeyPem,name='사용자 릴리스 키'}={}){
    const parsed=inspectReleasePublicKey(publicKeyPem,{name});
    if(normalizeTrustedKeys(BUILTIN_RELEASE_TRUST_KEYS).some(key=>key.keyId===parsed.keyId))return {...parsed,builtin:true,addedAt:0};
    const existing=this.trust.keys.find(key=>key.keyId===parsed.keyId);
    if(existing){existing.name=parsed.name;existing.publicKeyPem=parsed.publicKeyPem;existing.fingerprint=parsed.fingerprint;await this.saveTrust();return {...parsed,builtin:false,addedAt:existing.addedAt};}
    const added={...parsed,addedAt:Date.now()};this.trust.keys.push(added);await this.saveTrust();return {...added,builtin:false};
  }
  async removeTrustedKey(keyId){
    if(normalizeTrustedKeys(BUILTIN_RELEASE_TRUST_KEYS).some(key=>key.keyId===keyId))throw Error('내장 릴리스 신뢰 키는 대시보드에서 삭제할 수 없습니다.');
    const before=this.trust.keys.length;this.trust.keys=this.trust.keys.filter(key=>key.keyId!==keyId);if(this.trust.keys.length===before)throw Error('삭제할 릴리스 신뢰 키를 찾지 못했습니다.');await this.saveTrust();return this.trustSnapshot();
  }
  async setTrustPolicy(policy){
    if(!TRUST_POLICIES.has(policy))throw Error('Trust Policy는 warn 또는 required만 사용할 수 있습니다.');
    this.trust.policy=policy;await this.saveTrust();return this.trustSnapshot();
  }
  inspect(rawBundle){return inspectReleaseBundle(rawBundle,{currentVersion:this.currentVersion,currentSchema:this.currentSchema,trustedKeys:this.allTrustedKeys(),signaturePolicy:this.trust.policy});}
  async recoverInterruptedTransaction(){
    let journal;try{journal=JSON.parse(await readFile(this.journalFile,'utf8'));}catch{return null;}
    if(journal.phase==='committed'){await this.clearJournal();return {status:'committed-cleanup'};}
    const rollbackPath=journal.rollbackPath;if(!rollbackPath){this.state={...this.state,status:'transaction-recovery-incomplete',lastError:'중단된 릴리스 트랜잭션에 rollbackPath가 없습니다.'};await this.save();return {status:'failed'};}
    const restored=await restoreFromRollback(this.projectRoot,rollbackPath),verified=restored.ok?await verifyRestored(this.projectRoot,rollbackPath):{ok:false,errors:restored.errors};
    const ok=restored.ok&&verified.ok,status=ok?'crash-recovered-restart-required':'transaction-recovery-incomplete';
    const entry={releaseId:`recovery-${journal.releaseId||'unknown'}`,at:Date.now(),fromVersion:journal.targetVersion||this.currentVersion,targetVersion:journal.fromVersion||this.currentVersion,status};
    this.state={...this.state,status,lastError:ok?'중단된 코드 전환을 시작 전 자동 복원했습니다. START.cmd를 다시 시작해 실행 코드를 맞춰 주세요.':`중단된 코드 전환 자동 복원이 완전하지 않습니다: ${(restored.errors||verified.errors||[]).join(', ')}`,recoveredAt:Date.now(),targetVersion:journal.fromVersion||this.currentVersion,smoke:null,history:[entry,...(this.state.history||[])].slice(0,20)};
    await this.save();if(ok)await this.clearJournal();return {status,ok};
  }
  async stage(rawBundle){
    const inspected=this.inspect(rawBundle);
    if(!inspected.ok){
      const failed=inspected.checks?.find(check=>check.status==='fail');await rm(this.stagedFile,{force:true});
      this.state={...this.state,status:'verify-failed',stagedAt:null,targetVersion:inspected.targetVersion||null,targetSchema:inspected.schemaVersion||null,manifestDigest:null,baseManifestDigest:null,integrity:null,signature:inspected.signature?{status:inspected.signature.status,keyId:inspected.signature.keyId||null,trusted:Boolean(inspected.signature.trusted)}:null,comparison:null,smoke:null,lastError:failed?.detail||'업데이트 패키지 검증 실패'};await this.save();
      return {...inspected,comparison:null};
    }
    const comparison=await compareReleaseToCurrent(inspected,this.projectRoot),drift=Number(comparison.counts.drift)||0;
    const dependencyReview=await reviewReleaseDependencies(this.projectRoot,inspected);
    let baseManifestMatch=null,currentManifestDigest=null;
    if(inspected.integrityMode!=='legacy'){const currentManifest=await buildCurrentManifest(this.projectRoot,inspected.baseVersion,this.currentSchema);currentManifestDigest=currentManifest.digest;baseManifestMatch=currentManifest.digest===inspected.baseManifestDigest;}
    const driftCheck={id:'base-drift',label:'변경 대상 기준 SHA-256',status:drift?'fail':inspected.integrityMode!=='legacy'?'pass':'warn',detail:drift?`${drift}개 파일이 패키지의 기준 SHA-256과 다릅니다.`:inspected.integrityMode!=='legacy'?'변경 대상 파일이 기준 상태와 일치합니다.':'v1 호환 패키지라 변경 전 SHA-256을 강제 판정할 수 없습니다.'};
    const manifestCheck={id:'base-manifest-live',label:'전체 기준 Manifest',status:inspected.integrityMode!=='legacy'?(baseManifestMatch?'pass':'fail'):'warn',detail:inspected.integrityMode!=='legacy'?(baseManifestMatch?'현재 설치 코드 전체가 패키지 기준 Manifest와 일치합니다.':`현재 코드 Manifest ${String(currentManifestDigest).slice(0,12)}… / 기대 ${String(inspected.baseManifestDigest).slice(0,12)}…`):'v1 호환 패키지는 전체 기준 Manifest를 포함하지 않습니다.'};
    const checks=[...inspected.checks,driftCheck,manifestCheck,...(dependencyReview.checks||[])];
    if(drift||baseManifestMatch===false||dependencyReview.status==='fail'){
      const failed=checks.find(check=>check.status==='fail');await rm(this.stagedFile,{force:true});
      this.state={...this.state,status:'verify-failed',stagedAt:null,targetVersion:inspected.targetVersion||null,targetSchema:inspected.schemaVersion||null,manifestDigest:null,baseManifestDigest:inspected.baseManifestDigest||null,integrity:{mode:inspected.integrityMode,drift,baseManifestMatch,checkedAt:Date.now()},signature:{status:inspected.signature?.status||'unsigned',keyId:inspected.signature?.keyId||null,trusted:Boolean(inspected.signature?.trusted)},dependency:{status:dependencyReview.status,changed:Boolean(dependencyReview.changed),diff:dependencyReview.diff||null},comparison,smoke:null,lastError:failed?.detail||'현재 코드 또는 공급망 검증에 실패했습니다.'};await this.save();
      return {...inspected,ok:false,status:'fail',checks,comparison,dependencyReview,currentManifestDigest,state:this.snapshot()};
    }
    await atomicWriteFile(this.stagedFile,JSON.stringify(rawBundle,null,2)+'\n',{mode:0o600,temporary:this.stagedFile+'.tmp'});
    this.state={...this.state,status:'staged',stagedAt:Date.now(),baseVersion:inspected.baseVersion,targetVersion:inspected.targetVersion,targetSchema:inspected.schemaVersion,manifestDigest:inspected.manifestDigest,baseManifestDigest:inspected.baseManifestDigest,integrity:{mode:inspected.integrityMode,drift,baseManifestMatch,checkedAt:Date.now()},signature:{status:inspected.signature?.status||'unsigned',keyId:inspected.signature?.keyId||null,trusted:Boolean(inspected.signature?.trusted),name:inspected.signature?.name||null},dependency:{status:dependencyReview.status,changed:Boolean(dependencyReview.changed),diff:dependencyReview.diff||null},comparison,smoke:null,lastError:null};await this.save();
    return {...inspected,checks,comparison,dependencyReview,state:this.snapshot()};
  }
  async readStaged(){return JSON.parse(await readFile(this.stagedFile,'utf8'));}
  async apply({expectedDigest}={}){
    const raw=await this.readStaged(),inspected=this.inspect(raw);if(!inspected.ok)throw Error('스테이징된 업데이트 패키지가 더 이상 유효하지 않습니다.');if(expectedDigest&&expectedDigest!==inspected.manifestDigest)throw Error('승인한 업데이트 패키지와 현재 스테이징 패키지가 다릅니다.');
    const dependencyReview=await reviewReleaseDependencies(this.projectRoot,inspected);if(dependencyReview.status==='fail')throw Object.assign(Error('적용 직전 공급망 검증에 실패했습니다. 패키지를 다시 검증해 주세요.'),{status:409});
    const comparison=await compareReleaseToCurrent(inspected,this.projectRoot);
    if(inspected.integrityMode!=='legacy'){
      if(comparison.counts.drift>0)throw Object.assign(Error(`적용 직전 코드 무결성 검사 실패: ${comparison.counts.drift}개 파일이 스테이징 이후 변경되었습니다.`),{status:409});
      const currentManifest=await buildCurrentManifest(this.projectRoot,inspected.baseVersion,this.currentSchema);if(currentManifest.digest!==inspected.baseManifestDigest)throw Object.assign(Error('적용 직전 전체 코드 Manifest가 스테이징 기준과 달라졌습니다. 새 패키지를 다시 검증해 주세요.'),{status:409});
    }
    const releaseId=`${Date.now()}-${randomUUID().slice(0,8)}`,rollbackPath=path.join(this.rollbackDir,releaseId);await mkdir(rollbackPath,{recursive:true});const rollback=[];
    try{
      for(const row of comparison.rows){
        if(row.action==='unchanged'||row.action==='missing-delete')continue;await assertNoSymlinkPath(this.projectRoot,row.path);
        const target=path.join(this.projectRoot,row.path),backup=path.join(rollbackPath,row.path);
        if(row.action==='change'||row.action==='delete'){await mkdir(path.dirname(backup),{recursive:true});await atomicCopyFile(target,backup,{temporary:backup+'.tmp'});const backupMeta=await fileHash(backup);rollback.push({path:row.path,existed:true,sha256:backupMeta.sha256});}
        else rollback.push({path:row.path,existed:false,sha256:null});
      }
      const rollbackMeta={releaseId,fromVersion:this.currentVersion,targetVersion:inspected.targetVersion,manifestDigest:inspected.manifestDigest,files:rollback};
      await atomicWriteFile(path.join(rollbackPath,'rollback.json'),JSON.stringify(rollbackMeta,null,2)+'\n',{mode:0o600,temporary:path.join(rollbackPath,'rollback.json.tmp')});
      await this.writeJournal({version:1,operation:'apply',phase:'prepared',releaseId,fromVersion:this.currentVersion,targetVersion:inspected.targetVersion,manifestDigest:inspected.manifestDigest,rollbackPath,startedAt:Date.now()});
      await this.writeJournal({version:1,operation:'apply',phase:'applying',releaseId,fromVersion:this.currentVersion,targetVersion:inspected.targetVersion,manifestDigest:inspected.manifestDigest,rollbackPath,startedAt:Date.now()});
      for(const item of inspected.normalized.files){const target=path.join(this.projectRoot,item.path),temp=`${target}.update-${process.pid}.tmp`;await mkdir(path.dirname(target),{recursive:true});await atomicWriteFile(target,item.content,{mode:0o600,temporary:temp});}
      for(const item of inspected.normalized.deletes)await removeDurable(path.join(this.projectRoot,item.path),{force:true});
      const targetVerify=await verifyTargetState(inspected,this.projectRoot);if(!targetVerify.ok)throw Error(`업데이트 적용 후 SHA-256 검증 실패: ${targetVerify.errors.join(', ')}`);
      const entry={releaseId,at:Date.now(),fromVersion:this.currentVersion,targetVersion:inspected.targetVersion,manifestDigest:inspected.manifestDigest,status:'applied',integrityMode:inspected.integrityMode,signatureKeyId:inspected.signature?.keyId||null,comparison:comparison.counts};
      this.state={...this.state,status:'restart-required',appliedAt:entry.at,releaseId,rollbackPath,targetVersion:inspected.targetVersion,manifestDigest:inspected.manifestDigest,integrity:{mode:inspected.integrityMode,drift:0,checkedAt:Date.now()},signature:{status:inspected.signature?.status||'unsigned',keyId:inspected.signature?.keyId||null,trusted:Boolean(inspected.signature?.trusted),name:inspected.signature?.name||null},smoke:null,lastError:null,history:[entry,...(this.state.history||[])].slice(0,20)};await this.save();
      await this.writeJournal({version:1,operation:'apply',phase:'committed',releaseId,fromVersion:this.currentVersion,targetVersion:inspected.targetVersion,manifestDigest:inspected.manifestDigest,rollbackPath,committedAt:Date.now()});await this.clearJournal();
      return {state:this.snapshot(),comparison,restartRequired:true};
    }catch(error){
      const restored=await restoreFromRollback(this.projectRoot,rollbackPath).catch(e=>({ok:false,errors:[safeText(e?.message,220)]})),verified=restored.ok?await verifyRestored(this.projectRoot,rollbackPath):{ok:false,errors:restored.errors||[]},rollbackOk=restored.ok&&verified.ok;
      this.state={...this.state,status:rollbackOk?'apply-failed-rolled-back':'apply-failed-rollback-incomplete',lastError:safeText(error?.message,240),failedAt:Date.now(),releaseId,rollbackPath};await this.save();if(rollbackOk)await this.clearJournal();throw error;
    }
  }
  async rollback(){
    const releaseId=this.state.releaseId,rollbackPath=this.state.rollbackPath;if(!releaseId||!rollbackPath)throw Error('복원할 코드 업데이트 기록이 없습니다.');
    const meta=JSON.parse(await readFile(path.join(rollbackPath,'rollback.json'),'utf8'));
    await this.writeJournal({version:1,operation:'rollback',phase:'applying',releaseId,fromVersion:this.currentVersion,targetVersion:meta.fromVersion,rollbackPath,startedAt:Date.now()});
    const restored=await restoreFromRollback(this.projectRoot,rollbackPath),verified=restored.ok?await verifyRestored(this.projectRoot,rollbackPath):{ok:false,errors:restored.errors};if(!restored.ok||!verified.ok)throw Error(`코드 롤백 검증 실패: ${[...(restored.errors||[]),...(verified.errors||[])].join(', ')}`);
    const entry={releaseId:`rollback-${releaseId}`,at:Date.now(),fromVersion:this.currentVersion,targetVersion:meta.fromVersion,status:'rollback-restored'};
    this.state={...this.state,status:'rollback-restart-required',rollbackAt:entry.at,targetVersion:meta.fromVersion,smoke:null,lastError:null,history:[entry,...(this.state.history||[])].slice(0,20)};await this.save();
    await this.writeJournal({version:1,operation:'rollback',phase:'committed',releaseId,fromVersion:this.currentVersion,targetVersion:meta.fromVersion,rollbackPath,committedAt:Date.now()});await this.clearJournal();
    return {state:this.snapshot(),restartRequired:true};
  }
  async smoke({operationsReadable=true,dataReadable=true}={}){
    const checks=[],add=(label,status,detail)=>checks.push({label,status,detail});const target=this.state.targetVersion;
    add('실행 버전',target===this.currentVersion?'pass':'fail',`실행 ${this.currentVersion} · 기대 ${target||'없음'}`);
    add('운영 데이터 읽기',operationsReadable?'pass':'fail',operationsReadable?'operations 정상':'operations 읽기 실패');
    add('참가자 데이터 읽기',dataReadable?'pass':'fail',dataReadable?'registrations 정상':'registrations 읽기 실패');
    let packageVersion='';try{packageVersion=JSON.parse(await readFile(path.join(this.projectRoot,'package.json'),'utf8')).version||'';}catch{}
    add('package.json 버전',packageVersion===this.currentVersion?'pass':'fail',`${packageVersion||'읽기 실패'} / ${this.currentVersion}`);
    const trust=this.trustSnapshot();add('릴리스 Trust Policy','pass',`${trust.policy.toUpperCase()} · 신뢰 키 ${trust.keys.length}개`);
    try{const supply=await inspectProjectSupplyChain(this.projectRoot,{expectedVersion:this.currentVersion});add('의존성 공급망',supply.status==='fail'?'fail':supply.status==='warn'?'warn':'pass',`${supply.stats.total}개 lock package · integrity 오류 ${supply.stats.missingIntegrity} · install script ${supply.stats.installScripts}`);}catch(error){add('의존성 공급망','fail',safeText(error?.message,180));}
    const manifest=await buildCurrentManifest(this.projectRoot,this.currentVersion,this.currentSchema);add('현재 코드 Manifest','pass',`${manifest.files.length}개 파일 · ${manifest.digest.slice(0,12)}…`);
    const status=checks.some(c=>c.status==='fail')?'fail':'pass',smoke={status,at:Date.now(),checks};this.state={...this.state,status:status==='pass'?'smoke-passed':'smoke-failed',smoke,lastError:status==='pass'?null:'배포 후 Smoke Test 실패'};await this.save();return {state:this.snapshot(),...smoke};
  }
}

export function createReleaseBundle({baseVersion,targetVersion,schemaVersion,baseManifestDigest=null,files,deletes=[],format=FORMAT_V2,channel='stable',createdAt=new Date().toISOString()}){
  const signed=format===FORMAT_V3,strong=format===FORMAT_V2||signed;
  const entries=files.map(file=>{
    const content=Buffer.isBuffer(file.content)?file.content:Buffer.from(file.content);
    const entry={path:normalizeReleasePath(file.path),sha256:sha256(content),bytes:content.length,contentBase64:content.toString('base64')};
    if(strong){entry.baseExists=Boolean(file.baseExists);entry.baseSha256=entry.baseExists?(file.baseSha256||null):null;}
    return entry;
  });
  const normalizedDeletes=strong
    ?deletes.map(item=>typeof item==='string'?{path:normalizeReleasePath(item),baseSha256:null}:{path:normalizeReleasePath(item.path),baseSha256:item.baseSha256||null})
    :deletes.map(item=>normalizeReleasePath(typeof item==='string'?item:item.path));
  const bundle={format:signed?FORMAT_V3:strong?FORMAT_V2:FORMAT_V1,baseVersion,targetVersion,schemaVersion:Number(schemaVersion)||1,files:entries,deletes:normalizedDeletes};
  if(strong)bundle.baseManifestDigest=baseManifestDigest||'';
  if(signed){
    const releaseChannel=String(channel||'').toLowerCase();
    if(!['stable','beta'].includes(releaseChannel))throw Error('v3 릴리스 channel은 stable 또는 beta여야 합니다.');
    const parsedCreatedAt=new Date(createdAt);if(Number.isNaN(parsedCreatedAt.getTime()))throw Error('v3 릴리스 createdAt이 올바르지 않습니다.');
    bundle.channel=releaseChannel;bundle.createdAt=parsedCreatedAt.toISOString();
  }
  return {...bundle,manifestDigest:sha256(JSON.stringify(canonicalBundle(bundle)))};
}

export function signReleaseBundle(bundle,{privateKeyPem,publicKeyPem=null,keyName='Release Publisher'}={}){
  if(bundle?.format!==FORMAT_V3)throw Error('Ed25519 서명은 daengdaeng-update-v3 패키지에만 추가할 수 있습니다.');
  let privateKey;try{privateKey=createPrivateKey(String(privateKeyPem||''));}catch{throw Error('Ed25519 개인키 PEM 형식을 확인해 주세요.');}
  if(privateKey.asymmetricKeyType!=='ed25519')throw Error('릴리스 서명 개인키는 Ed25519여야 합니다.');
  const publicKey=publicKeyPem?createPublicKey(String(publicKeyPem)):createPublicKey(privateKey),keyInfo=inspectReleasePublicKey(publicKey.export({type:'spki',format:'pem'}),{name:keyName});
  const normalized={...bundle,manifestDigest:sha256(JSON.stringify(canonicalBundle(bundle)))};
  const signature=cryptoSign(null,signingMessage(normalized),privateKey).toString('base64');
  return {...normalized,signature:{algorithm:'Ed25519',keyId:keyInfo.keyId,fingerprint:keyInfo.fingerprint,keyName:keyInfo.name,publicKeyPem:keyInfo.publicKeyPem,signatureBase64:signature}};
}

export const RELEASE_FORMATS={legacy:FORMAT_V1,strong:FORMAT_V2,signed:FORMAT_V3};
