import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const asObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const dependencySections=['dependencies','devDependencies','optionalDependencies','peerDependencies'];
const lifecycleScripts=['preinstall','install','postinstall','prepare','prepublish','prepublishOnly'];
const dangerousSpec=/^(?:git(?:\+[^:]+)?:|https?:|file:|link:|github:|gitlab:|bitbucket:)/i;
const registryUrl=/^https:\/\/registry\.npmjs\.org\//i;

function safeJson(text,label){try{return JSON.parse(String(text));}catch{throw Error(`${label} JSON을 읽지 못했습니다.`);}}
function packageNameFromLockPath(lockPath,meta){
  if(meta?.name)return String(meta.name);
  const marker='node_modules/';const idx=String(lockPath).lastIndexOf(marker);if(idx<0)return null;
  return String(lockPath).slice(idx+marker.length)||null;
}
function directMap(pkg){
  const rows=new Map();
  for(const section of dependencySections){
    for(const [name,spec] of Object.entries(asObject(pkg?.[section])))rows.set(`${section}:${name}`,{section,name,spec:String(spec)});
  }
  return rows;
}
function lockRoot(lock){return asObject(asObject(lock?.packages)['']);}
function statusFromChecks(checks){return checks.some(c=>c.status==='fail')?'fail':checks.some(c=>c.status==='warn')?'warn':'pass';}
function check(id,label,status,detail){return {id,label,status,detail};}

export function inspectDependencyDocuments(packageJsonText,packageLockText,{expectedVersion=null}={}){
  const pkg=safeJson(packageJsonText,'package.json'),lock=safeJson(packageLockText,'package-lock.json'),checks=[];
  const root=lockRoot(lock),packageVersion=String(pkg.version||''),lockVersion=String(root.version||lock.version||'');
  checks.push(check('lockfile-version','Lockfile 형식',Number(lock.lockfileVersion)===3?'pass':'fail',`lockfileVersion ${lock.lockfileVersion??'없음'} · npm lockfile v3 필요`));
  checks.push(check('name','패키지 이름',pkg.name&&root.name===pkg.name?'pass':'fail',`${pkg.name||'없음'} / lock ${root.name||'없음'}`));
  checks.push(check('version','패키지 버전',packageVersion&&lockVersion===packageVersion&&(!expectedVersion||packageVersion===expectedVersion)?'pass':'fail',`package ${packageVersion||'없음'} · lock ${lockVersion||'없음'}${expectedVersion?` · 기대 ${expectedVersion}`:''}`));

  const scripts=asObject(pkg.scripts),rootLifecycle=lifecycleScripts.filter(name=>typeof scripts[name]==='string'&&scripts[name].trim());
  checks.push(check('root-lifecycle','루트 install lifecycle',rootLifecycle.length?'fail':'pass',rootLifecycle.length?`금지된 lifecycle script: ${rootLifecycle.join(', ')}`:'preinstall/install/postinstall/prepare 등 자동 설치 스크립트 없음'));

  const direct=directMap(pkg),rootDirect=directMap(root),directMismatch=[];
  for(const [key,item] of direct){const locked=rootDirect.get(key);if(!locked||locked.spec!==item.spec)directMismatch.push(`${item.section}:${item.name}`);}
  for(const [key,item] of rootDirect)if(!direct.has(key))directMismatch.push(`lock-only:${item.section}:${item.name}`);
  checks.push(check('direct-lock-match','직접 의존성 Lock 일치',directMismatch.length?'fail':'pass',directMismatch.length?`불일치 ${directMismatch.slice(0,8).join(', ')}${directMismatch.length>8?'…':''}`:`직접 의존성 ${direct.size}개가 package-lock과 일치`));

  const unsafeDirect=[...direct.values()].filter(item=>dangerousSpec.test(item.spec));
  checks.push(check('direct-source','직접 의존성 소스',unsafeDirect.length?'fail':'pass',unsafeDirect.length?`비 Registry/로컬 의존성: ${unsafeDirect.map(x=>`${x.name}=${x.spec}`).slice(0,6).join(', ')}`:'Git/HTTP/file/link 직접 의존성 없음'));

  const packages=asObject(lock.packages),rows=[],missingIntegrity=[],unsafeResolved=[],installScripts=[];
  for(const [lockPath,metaRaw] of Object.entries(packages)){
    if(lockPath==='')continue;const meta=asObject(metaRaw),name=packageNameFromLockPath(lockPath,meta),version=String(meta.version||'');
    const resolved=typeof meta.resolved==='string'?meta.resolved:'',integrity=typeof meta.integrity==='string'?meta.integrity:'';
    const registry=resolved?registryUrl.test(resolved):false;
    if(resolved&&!registry&&!meta.link)unsafeResolved.push({name:name||lockPath,resolved});
    if(registry&&!/^sha512-[A-Za-z0-9+/=]+$/.test(integrity))missingIntegrity.push(name||lockPath);
    if(meta.hasInstallScript)installScripts.push({name:name||lockPath,version,lockPath});
    rows.push({path:lockPath,name:name||lockPath,version,dev:Boolean(meta.dev),optional:Boolean(meta.optional),license:String(meta.license||''),resolved:resolved||null,integrity:integrity||null,hasInstallScript:Boolean(meta.hasInstallScript)});
  }
  checks.push(check('resolved-source','Lock resolved 출처',unsafeResolved.length?'fail':'pass',unsafeResolved.length?`npm Registry 외 출처 ${unsafeResolved.length}개`:`${rows.length}개 lock package가 Registry/내부 링크 정책 통과`));
  checks.push(check('integrity','Lock SHA-512 무결성',missingIntegrity.length?'fail':'pass',missingIntegrity.length?`integrity 누락/형식 오류 ${missingIntegrity.length}개`:`Registry 패키지 SHA-512 integrity 확인`));
  checks.push(check('install-scripts','의존성 install script',installScripts.length?'warn':'pass',installScripts.length?`hasInstallScript ${installScripts.length}개: ${installScripts.slice(0,6).map(x=>x.name).join(', ')}${installScripts.length>6?'…':''}`:'lockfile 기준 install script 패키지 없음'));

  const licenses=new Map();for(const row of rows){const value=row.license||'UNKNOWN';licenses.set(value,(licenses.get(value)||0)+1);}
  const licenseRows=[...licenses.entries()].map(([license,count])=>({license,count})).sort((a,b)=>b.count-a.count||a.license.localeCompare(b.license));
  const status=statusFromChecks(checks),lockDigest=sha256(String(packageLockText)),packageDigest=sha256(String(packageJsonText));
  return {
    status,checks,package:{name:String(pkg.name||''),version:packageVersion,node:String(pkg.engines?.node||''),direct:[...direct.values()]},
    lock:{lockfileVersion:Number(lock.lockfileVersion)||0,packages:rows.length,digest:lockDigest},
    stats:{total:rows.length,runtime:rows.filter(r=>!r.dev).length,dev:rows.filter(r=>r.dev).length,direct:direct.size,installScripts:installScripts.length,unsafeSources:unsafeResolved.length,missingIntegrity:missingIntegrity.length,licenses:licenses.size},
    installScripts,unsafeResolved,missingIntegrity,licenses:licenseRows,packages:rows,packageDigest,lockDigest
  };
}

export async function inspectProjectSupplyChain(projectRoot,{expectedVersion=null}={}){
  const root=path.resolve(projectRoot),[packageJsonText,packageLockText]=await Promise.all([
    readFile(path.join(root,'package.json'),'utf8'),readFile(path.join(root,'package-lock.json'),'utf8')
  ]);
  return inspectDependencyDocuments(packageJsonText,packageLockText,{expectedVersion});
}

function targetText(inspected,fileName,currentText){
  const write=inspected?.normalized?.files?.find(item=>item.path===fileName);if(write)return write.content.toString('utf8');
  if(inspected?.normalized?.deletes?.some(item=>item.path===fileName))return null;
  return currentText;
}

export function compareDependencyDocuments(current,target){
  const currentDirect=new Map(current.package.direct.map(x=>[`${x.section}:${x.name}`,x])),targetDirect=new Map(target.package.direct.map(x=>[`${x.section}:${x.name}`,x]));
  const added=[],removed=[],changed=[];
  for(const [key,item] of targetDirect){const before=currentDirect.get(key);if(!before)added.push(item);else if(before.spec!==item.spec)changed.push({name:item.name,section:item.section,from:before.spec,to:item.spec});}
  for(const [key,item] of currentDirect)if(!targetDirect.has(key))removed.push(item);
  const currentPackages=new Map(current.packages.map(x=>[x.path,x])),targetPackages=new Map(target.packages.map(x=>[x.path,x]));
  let transitiveAdded=0,transitiveRemoved=0,transitiveChanged=0;
  for(const [p,item] of targetPackages){const before=currentPackages.get(p);if(!before)transitiveAdded++;else if(before.version!==item.version||before.integrity!==item.integrity)transitiveChanged++;}
  for(const p of currentPackages.keys())if(!targetPackages.has(p))transitiveRemoved++;
  const currentScriptKeys=new Set(current.installScripts.map(x=>`${x.name}@${x.version}:${x.path}`));
  const newInstallScripts=target.installScripts.filter(x=>!currentScriptKeys.has(`${x.name}@${x.version}:${x.path}`));
  return {added,removed,changed,transitiveAdded,transitiveRemoved,transitiveChanged,newInstallScripts};
}

export async function reviewReleaseDependencies(projectRoot,inspected){
  const root=path.resolve(projectRoot),[currentPackage,currentLock]=await Promise.all([
    readFile(path.join(root,'package.json'),'utf8'),readFile(path.join(root,'package-lock.json'),'utf8')
  ]);
  const packageTouched=inspected.normalized.files.some(x=>x.path==='package.json')||inspected.normalized.deletes.some(x=>x.path==='package.json');
  const lockTouched=inspected.normalized.files.some(x=>x.path==='package-lock.json')||inspected.normalized.deletes.some(x=>x.path==='package-lock.json');
  if(!packageTouched&&!lockTouched){const current=inspectDependencyDocuments(currentPackage,currentLock,{expectedVersion:inspected.baseVersion});return {status:current.status==='fail'?'fail':'pass',changed:false,checks:[check('supply-current','현재 공급망 기준',current.status==='fail'?'fail':'pass',current.status==='fail'?'현재 package/package-lock 공급망 무결성 오류를 먼저 해결해 주세요.':'의존성 파일 변경 없음 · 현재 공급망 기준 통과')],current,target:current,diff:{added:[],removed:[],changed:[],transitiveAdded:0,transitiveRemoved:0,transitiveChanged:0,newInstallScripts:[]}};}
  const targetPackage=targetText(inspected,'package.json',currentPackage),targetLock=targetText(inspected,'package-lock.json',currentLock),checks=[];
  if(!targetPackage||!targetLock)return {status:'fail',changed:true,checks:[check('supply-files','의존성 파일 보존','fail','package.json과 package-lock.json은 삭제할 수 없습니다.')]};
  let current,target;
  try{current=inspectDependencyDocuments(currentPackage,currentLock,{expectedVersion:inspected.baseVersion});}catch(error){return {status:'fail',changed:true,checks:[check('supply-current','현재 공급망 읽기','fail',error.message)]};}
  try{target=inspectDependencyDocuments(targetPackage,targetLock,{expectedVersion:inspected.targetVersion});}catch(error){return {status:'fail',changed:true,checks:[check('supply-target','대상 공급망 읽기','fail',error.message)]};}
  const diff=compareDependencyDocuments(current,target);
  checks.push(check('supply-files','의존성 파일 동시 변경',packageTouched===lockTouched?'pass':'fail',packageTouched===lockTouched?'package.json + package-lock.json 동기 변경':'package.json과 package-lock.json은 함께 변경해야 합니다.'));
  checks.push(...target.checks.map(item=>({...item,id:`supply-${item.id}`,label:`공급망 · ${item.label}`})));
  checks.push(check('supply-new-direct','신규 직접 의존성',diff.added.length?'warn':'pass',diff.added.length?`신규 ${diff.added.length}개: ${diff.added.slice(0,8).map(x=>x.name).join(', ')} · 발행 전 검토 필요`:'신규 직접 의존성 없음'));
  checks.push(check('supply-direct-change','직접 의존성 변경',diff.changed.length||diff.removed.length?'warn':'pass',`범위 변경 ${diff.changed.length}개 · 제거 ${diff.removed.length}개`));
  checks.push(check('supply-install-new','신규 install script',diff.newInstallScripts.length?'warn':'pass',diff.newInstallScripts.length?`새 hasInstallScript ${diff.newInstallScripts.length}개: ${diff.newInstallScripts.slice(0,6).map(x=>x.name).join(', ')}`:'새 install script 패키지 없음'));
  const status=statusFromChecks(checks);
  return {status,changed:true,checks,current,target,diff};
}

export function buildSupplyChainSbom(snapshot,{generatedAt=new Date().toISOString()}={}){
  return {
    format:'daengdaeng-sbom-v1',generatedAt,component:{type:'application',name:snapshot.package.name,version:snapshot.package.version},
    lockDigest:snapshot.lockDigest,packageDigest:snapshot.packageDigest,
    components:snapshot.packages.map(item=>({type:'library',name:item.name,version:item.version,scope:item.dev?'development':'runtime',license:item.license||'UNKNOWN',integrity:item.integrity||null,resolved:item.resolved||null,installScript:item.hasInstallScript,purl:`pkg:npm/${encodeURIComponent(item.name)}@${encodeURIComponent(item.version)}`}))
  };
}
