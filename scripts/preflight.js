import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supportedNode } from './dependencies.js';
import { inspectDependencyDocuments } from '../src/supply-chain.js';
import { APP_VERSION, DATA_SCHEMA_VERSION } from '../src/version.js';
import { loadConfig } from '../src/config.js';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));

const checks=[];
const add=(name,ok,detail)=>checks.push({name,ok,detail});
const read=async file=>fs.readFile(file,'utf8');

try {
  add('Node.js',supportedNode(),`현재 ${process.versions.node} · 요구 >=22.22.2`);

  const [packageText,lockText]=await Promise.all([read('package.json'),read('package-lock.json')]);
  const pkg=JSON.parse(packageText),lock=JSON.parse(lockText);
  add('버전 정합성',pkg.version===APP_VERSION&&lock.version===APP_VERSION&&lock.packages?.['']?.version===APP_VERSION,`package/src/lock ${pkg.version} / ${APP_VERSION} / ${lock.version}`);
  add('데이터 스키마',DATA_SCHEMA_VERSION===2,`schema v${DATA_SCHEMA_VERSION}`);

  const supply=inspectDependencyDocuments(packageText,lockText,{expectedVersion:APP_VERSION});
  add('의존성 공급망',supply.status!=='fail',`${supply.status.toUpperCase()} · lock package ${supply.stats.total} · missing integrity ${supply.stats.missingIntegrity}`);

  const required=['START.cmd','SETTINGS.cmd','DEMO.cmd','README.md','CHANGELOG.md','.env.example','src/index.js','public/index.html'];
  const missing=[];
  for(const file of required){try{await fs.access(path.resolve(file));}catch{missing.push(file);}}
  add('배포 파일',missing.length===0,missing.length?`누락: ${missing.join(', ')}`:'필수 파일 존재');

  const forbidden=['.env','config.local.json'];
  const present=[];
  for(const file of forbidden){try{await fs.access(path.resolve(file));present.push(file);}catch{}}
  add('비밀 파일',present.length===0,present.length?`로컬 파일 존재: ${present.join(', ')} (ZIP에는 포함하지 마세요)`:'배포 루트에 비밀 설정 파일 없음');

  // Demo config validates parser/ranges without requiring real Discord credentials.
  await loadConfig({},['--demo']);
  add('설정 파서',true,'demo profile validation PASS');

  try {
    await fs.access('config.local.json');
    await loadConfig(process.env,[]);
    add('로컬 설정',true,'config.local.json validation PASS');
  } catch(error) {
    if(error?.code==='ENOENT') add('로컬 설정',true,'config.local.json 없음 · 첫 실행 마법사 사용');
    else add('로컬 설정',false,String(error?.message||error));
  }
} catch(error) {
  add('Preflight 실행',false,String(error?.message||error));
}

for(const check of checks)console.log(`${check.ok?'PASS':'FAIL'}  ${check.name} · ${check.detail}`);
const failed=checks.filter(check=>!check.ok);
if(failed.length){console.error(`\nPreflight FAIL · ${failed.length}개 항목을 수정하세요.`);process.exitCode=1;}
else console.log(`\nPreflight PASS · Discord Game Roster Bot v${APP_VERSION}`);
