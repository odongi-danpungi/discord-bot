import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { buildCurrentManifest } from '../src/release-center.js';
import { APP_VERSION,DATA_SCHEMA_VERSION } from '../src/version.js';
import { compareDeploymentContract } from '../src/deployment-contract.js';

try {
  const file=process.argv[2];if(!file)throw Error('missing contract');
  const expected=JSON.parse(await readFile(file,'utf8'));
  const config=await loadConfig(process.env,[]),manifest=await buildCurrentManifest(process.cwd(),APP_VERSION,DATA_SCHEMA_VERSION);
  const report=compareDeploymentContract({expected,actual:{version:APP_VERSION,manifestDigest:manifest.digest,publicBaseUrl:config.publicBaseUrl,naverRedirectUri:config.naverRedirectUri,host:config.host,port:config.port}});
  console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='pass'?0:1;
} catch {
  console.error(JSON.stringify({status:'fail',code:'DEPLOYMENT_COMPARISON_UNAVAILABLE',detail:'계약 파일·운영 환경 설정·Manifest를 확인하세요. 입력값과 오류 원문은 출력하지 않습니다.'}));process.exitCode=2;
}
