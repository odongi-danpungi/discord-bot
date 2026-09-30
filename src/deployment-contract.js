export function compareDeploymentContract({expected,actual}={}) {
  const fields=['version','manifestDigest','publicBaseUrl','naverRedirectUri','host','port'];
  const valid=expected?.schema==='daengdaeng-deployment-contract-v1'&&fields.every(key=>expected[key]!==undefined)&&/^[a-f0-9]{64}$/.test(expected?.manifestDigest||'');
  const checks=fields.map(id=>({id,status:valid&&expected[id]===actual?.[id]?'pass':'fail',detail:valid&&expected[id]===actual?.[id]?'일치':'누락·형식 오류 또는 불일치'}));
  return {schema:'daengdaeng-deployment-comparison-v1',checkedAt:Date.now(),status:checks.every(c=>c.status==='pass')?'pass':'fail',checks,scope:'현재 프로세스 설정과 운영자가 제공한 배포 계약 비교. 호스팅 서비스의 실제 라우팅이나 외부 연결 성공을 증명하지 않습니다.'};
}
