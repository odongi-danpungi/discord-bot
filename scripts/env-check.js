import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { buildProductionEnvironmentValidation,assertProductionEnvironment } from '../src/production-environment.js';

try{
  const config=await loadConfig();
  const report=buildProductionEnvironmentValidation({config});
  console.log(`[env-check] ${report.status.toUpperCase()} · blocking ${report.counts.blocking} · warn ${report.counts.warn}`);
  for(const item of report.checks)console.log(`[env-check] ${item.status.toUpperCase()} ${item.label}: ${item.detail}`);
  assertProductionEnvironment(report);
  if(report.status==='warn')console.log('[env-check] 필수 시작 조건은 통과했습니다. WARN 항목은 배포 전에 검토하세요.');
  else console.log('[env-check] PASS. Production 환경 설정 검증을 통과했습니다.');
}catch(error){
  console.error(`[env-check] FAIL: ${error?.message||'환경 설정을 확인해 주세요.'}`);
  process.exitCode=2;
}
