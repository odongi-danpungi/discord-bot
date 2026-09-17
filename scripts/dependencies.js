import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inspectDependencyDocuments } from '../src/supply-chain.js';
export function supportedNode(version=process.versions.node){const [major,minor,patch]=version.split('.').map(Number);return major>22||(major===22&&(minor>22||(minor===22&&(patch||0)>=2)));}
export async function ensureDependencies(){
  const [packageText,lockText]=await Promise.all([fs.readFile('package.json','utf8'),fs.readFile('package-lock.json','utf8')]),pkg=JSON.parse(packageText),supply=inspectDependencyDocuments(packageText,lockText,{expectedVersion:pkg.version});
  if(supply.status==='fail'){const failures=supply.checks.filter(item=>item.status==='fail').map(item=>item.detail).join(' / ');throw Error(`의존성 공급망 검증 실패: ${failures}`);}
  if(supply.stats.installScripts)console.warn(`주의: lockfile에 install script 패키지 ${supply.stats.installScripts}개가 있지만 설치는 --ignore-scripts로 실행합니다.`);
  const hash=createHash('sha256').update(lockText).digest('hex'),stamp='node_modules/.daengdaeng-lock';
  try{if((await fs.readFile(stamp,'utf8'))===hash){await fs.access('node_modules/discord.js/package.json');await fs.access('node_modules/express/package.json');await fs.access('node_modules/dotenv/package.json');return;}}catch{}
  console.log('검증된 lockfile 기준으로 실행 패키지를 설치합니다. 첫 실행이나 업데이트 때만 필요합니다…');
  const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit',shell:process.platform==='win32'});
  if(result.status!==0)throw Error('패키지 설치 실패: Node.js 설치와 인터넷 연결을 확인해 주세요.');
  await fs.writeFile(stamp,hash);
}
