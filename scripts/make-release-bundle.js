import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCurrentManifest, createReleaseBundle, RELEASE_FORMATS, signReleaseBundle } from '../src/release-center.js';
import { DATA_SCHEMA_VERSION } from '../src/version.js';

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
const [targetArg,outputArg]=positional,legacy=args.includes('--legacy'),signKeyArg=flagValue('--sign-key'),channel=flagValue('--channel')||'stable',keyName=flagValue('--key-name')||'Release Publisher';
if(!targetArg){console.error('사용법: node scripts/make-release-bundle.js <새 버전 프로젝트 폴더> [출력 파일] [--legacy] [--sign-key private.pem] [--channel stable|beta] [--key-name 이름]');process.exit(1);}
if(legacy&&signKeyArg){console.error('--legacy와 --sign-key는 같이 사용할 수 없습니다.');process.exit(1);}
if(!['stable','beta'].includes(channel)){console.error('--channel은 stable 또는 beta만 사용할 수 있습니다.');process.exit(1);}
const baseRoot=process.cwd(),targetRoot=path.resolve(targetArg);
const basePkg=JSON.parse(await readFile(path.join(baseRoot,'package.json'),'utf8'));
const targetPkg=JSON.parse(await readFile(path.join(targetRoot,'package.json'),'utf8'));
const targetVersionSource=await readFile(path.join(targetRoot,'src','version.js'),'utf8').catch(()=>''),schemaMatch=targetVersionSource.match(/DATA_SCHEMA_VERSION\s*=\s*(\d+)/),targetSchema=schemaMatch?Number(schemaMatch[1]):DATA_SCHEMA_VERSION;
const baseManifest=await buildCurrentManifest(baseRoot,basePkg.version,DATA_SCHEMA_VERSION),targetManifest=await buildCurrentManifest(targetRoot,targetPkg.version,targetSchema);
const baseMap=new Map(baseManifest.files.map(file=>[file.path,file])),targetMap=new Map(targetManifest.files.map(file=>[file.path,file]));
const files=[];
for(const item of targetManifest.files){const before=baseMap.get(item.path);if(before?.sha256===item.sha256)continue;files.push({path:item.path,content:await readFile(path.join(targetRoot,item.path)),baseExists:Boolean(before),baseSha256:before?.sha256||null});}
const strong=!legacy,deletes=baseManifest.files.filter(item=>!targetMap.has(item.path)).map(item=>strong?{path:item.path,baseSha256:item.sha256}:item.path);
const format=legacy?RELEASE_FORMATS.legacy:signKeyArg?RELEASE_FORMATS.signed:RELEASE_FORMATS.strong;
let bundle=createReleaseBundle({baseVersion:basePkg.version,targetVersion:targetPkg.version,schemaVersion:targetSchema,baseManifestDigest:baseManifest.digest,files,deletes,format,channel});
if(signKeyArg){const privateKeyPem=await readFile(path.resolve(signKeyArg),'utf8');bundle=signReleaseBundle(bundle,{privateKeyPem,keyName});}
const out=path.resolve(outputArg||`daengdaeng-update-${basePkg.version}-to-${targetPkg.version}.json`);
await writeFile(out,JSON.stringify(bundle,null,2)+'\n');
console.log(`Update bundle: ${out}`);
console.log(`형식 ${bundle.format} · 변경 ${files.length}개 · 삭제 ${deletes.length}개`);
if(bundle.signature)console.log(`서명 ${bundle.signature.keyId} · ${bundle.signature.fingerprint}`);
if(legacy)console.log('주의: --legacy는 v4.1 호환용입니다. v4.2+에서는 v2 이상을 사용하세요. v4.3+에서는 서명 v3를 권장합니다.');
if(!legacy&&!bundle.signature)console.log('v2 무서명 패키지입니다. v4.3+에서 서명하려면 --sign-key <Ed25519 private.pem>을 사용하세요.');
