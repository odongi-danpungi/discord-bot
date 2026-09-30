// req.secure is evaluated by Express using only the configured trusted proxy hops.
// A configured public URL alone is not evidence that this request used HTTPS.
export function dashboardExposureWarning(config,secure){
  const local=['127.0.0.1','localhost','::1'].includes(config.host);
  if(local)return '';
  const authenticated=!config.demo&&String(config.dashboardPassword||'').length>=12;
  if(secure&&authenticated)return '';
  return secure?'외부 공개 대시보드의 관리자 인증 설정을 확인하세요.':'외부 공개 대시보드입니다. HTTPS 연결과 신뢰 프록시 설정을 확인하세요.';
}
