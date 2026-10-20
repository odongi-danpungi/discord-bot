import { verificationMessages } from './chzzk-verification-discord.js';

export function installChzzkOAuthRoutes(app, service, guard) {
  if (!service) return;
  service.guard = guard;
  const cookieName=service.config?.workspaceScoped?`__Secure-chzzk-oauth-${service.config.guildId}`:'__Secure-chzzk-oauth';
  const security = res => res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
  const page = (res, title, message, status = 200) => {
    security(res); return res.status(status).type('html').send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="background:#eff3f0;color:#243b32;font:18px system-ui;padding:32px"><h1>${title}</h1><p>${message}</p><p>Discord로 돌아가 내 연동 상태를 확인하세요. 이 창은 닫아도 됩니다.</p></body></html>`);
  };
  app.get('/oauth/chzzk/start', (req, res) => {
    try {
      security(res); const next = service.start(req.query.ticket);
      res.cookie(cookieName, next.cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/oauth/chzzk/callback', maxAge: 600000 });
      res.redirect(303, next.url);
    } catch (e) { page(res, '인증 시작 실패', 'Discord 또는 관리자 화면에서 새 인증 링크를 발급해 주세요.', e.status || 400); }
  });
  app.get('/oauth/chzzk/callback', async (req, res) => {
    security(res);
    try {
      const match = String(req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(cookieName+'='));
      const cookie = match ? decodeURIComponent(match.slice(cookieName.length+1)) : '';
      res.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'lax', path: '/oauth/chzzk/callback' });
      const result = await service.callback({ state: req.query.state, cookie, code: req.query.code, denied: Boolean(req.query.error) });
      const message = result.status === 'owner_connected' ? (service.config.workspaceScoped?'이 Discord 서버의 방송 채널이 연결됐습니다. 운영 화면에서 연결 상태를 확인하세요.':'공통 방송 채널이 자동 설정됐습니다. 봇을 초대한 모든 Discord 서버에서 같은 채널의 팔로워를 인증합니다. 관리자 대시보드에서 채널을 확인하세요.') : verificationMessages[result.status];
      return page(res, result.status === 'verified' ? '치지직 팔로워 인증 완료' : '치지직 계정 연동 결과', message || '연동 확인 대기입니다.');
    } catch (e) {
      const message = e.reason === 'OWNER_CHANNEL_MISMATCH'
        ? '이미 연결된 공통 방송 채널과 다른 계정입니다. 기존 방송 채널 계정으로 로그인해 주세요. 인증 역할 보호를 위해 채널을 자동 변경하지 않았습니다.'
        : '동의 취소·링크 만료·계정 중복 또는 연결 설정을 확인하고 인증을 다시 시작하세요.';
      return page(res, '인증 완료되지 않음', message, e.status || 400);
    }
  });
}
export function installChzzkVerificationAdminRoutes(app, service, guard) {
  app.get('/api/chzzk/verification', (_req, res) => res.json(service?.summary() || { enabled: false, ownerConnected: false }));
  for (const action of ['owner/start', 'panel']) app.post(`/api/chzzk/verification/${action}`, async (req, res, next) => {
    try {
      guard(); if (!service) throw Object.assign(Error('CHZZK_VERIFY_ENABLED와 인증 환경변수를 먼저 설정하세요.'), { status: 503 });
      res.json(action === 'owner/start' ? service.begin('owner') : await service.publishPanel(req.body.channelId));
    } catch (e) { next(e); }
  });
}
