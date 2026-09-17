import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildCurrentManifest, createReleaseBundle, RELEASE_FORMATS, signReleaseBundle } from '../src/release-center.js';
import { DATA_SCHEMA_VERSION } from '../src/version.js';
import { atomicWriteFile } from '../src/atomic-file.js';

const args=process.argv.slice(2);
const flagValue=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
const flagsWithValue=new Set(['--sign-key','--channel','--key-name']);
const positional=[];
for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(flagsWithValue.has(arg)){i++;continue;}
  if(arg.startsWith('--'))continue;
  positional.push(arg);
}
const [targetArg,outputArg]=positional,signKeyArg=flagValue('--sign-key'),channel=flagValue('--channel')||'stable',keyName=flagValue('--key-name')||'Release Publisher';
if(args.includes('--legacy')){console.error('v5.0부터 --legacy(v1) 업데이트 생성은 제거되었습니다. v2 strong-integrity 또는 v3 Ed25519 서명 패키지를 사용하세요.');process.exit(2);}
if(!targetArg){console.error('사용법: node scripts/make-release-bundle.js <새 버전 프로젝트 폴더> [출력 파일] [--sign-key private.pem] [--channel stable|beta] [--key-name 이름]');process.exit(1);}
if(!['stable','beta'].includes(channel)){console.error('--channel은 stable 또는 beta만 사용할 수 있습니다.');process.exit(1);}
const baseRoot=process.cwd(),targetRoot=path.resolve(targetArg);
const basePkg=JSON.parse(await readFile(path.join(baseRoot,'package.json'),'utf8'));
const targetPkg=JSON.parse(await readFile(path.join(targetRoot,'package.json'),'utf8'));
const targetVersionSource=await readFile(path.join(targetRoot,'src','version.js'),'utf8').catch(()=>''),schemaMatch=targetVersionSource.match(/DATA_SCHEMA_VERSION\s*=\s*(\d+)/),targetSchema=schemaMatch?Number(schemaMatch[1]):DATA_SCHEMA_VERSION;
const baseManifest=await buildCurrentManifest(baseRoot,basePkg.version,DATA_SCHEMA_VERSION),targetManifest=await buildCurrentManifest(targetRoot,targetPkg.version,targetSchema);
const baseMap=new Map(baseManifest.files.map(file=>[file.path,file])),targetMap=new Map(targetManifest.files.map(file=>[file.path,file]));
const files=[];
for(const item of targetManifest.files){const before=baseMap.get(item.path);if(before?.sha256===item.sha256)continue;files.push({path:item.path,content:await readFile(path.join(targetRoot,item.path)),baseExists:Boolean(before),baseSha256:before?.sha256||null});}
const deletes=baseManifest.files.filter(item=>!targetMap.has(item.path)).map(item=>({path:item.path,baseSha256:item.sha256}));
const format=signKeyArg?RELEASE_FORMATS.signed:RELEASE_FORMATS.strong;
let bundle=createReleaseBundle({baseVersion:basePkg.version,targetVersion:targetPkg.version,schemaVersion:targetSchema,baseManifestDigest:baseManifest.digest,files,deletes,format,channel});
if(signKeyArg){const privateKeyPem=await readFile(path.resolve(signKeyArg),'utf8');bundle=signReleaseBundle(bundle,{privateKeyPem,keyName});}
const out=path.resolve(outputArg||`daengdaeng-update-${basePkg.version}-to-${targetPkg.version}.json`);
await atomicWriteFile(out,JSON.stringify(bundle,null,2)+'\n',{mode:0o600});
console.log(`Update bundle: ${out}`);
console.log(`형식 ${bundle.format} · 변경 ${files.length}개 · 삭제 ${deletes.length}개`);
if(bundle.signature)console.log(`서명 ${bundle.signature.keyId} · ${bundle.signature.fingerprint}`);
else console.log('v2 무서명 strong-integrity 패키지입니다. 운영 배포에서는 --sign-key <Ed25519 private.pem>으로 v3 서명 패키지를 권장합니다.');
