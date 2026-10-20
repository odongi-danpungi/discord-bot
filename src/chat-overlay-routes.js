const fail = (message, status = 400) => Object.assign(Error(message), { status });
const unavailable = { state: 'unavailable', verification: 'pending' };

/** Routes inherit dashboard/workspace authentication, CSRF, `broadcast` capability and workspace allowlists. */
export function installChatOverlayRoutes({ app, store, service, guard }) {
  const ready = () => { if (!store || !service) throw fail('OBS 채팅창을 준비하지 못했습니다.', 503); };
  app.get('/api/chat-overlay', (_req, res, next) => {
    try {
      if (!store) throw fail('OBS 채팅창을 준비하지 못했습니다.', 503);
      const snapshot = store.snapshot();
      res.set('Cache-Control', 'no-store').json({ ...snapshot, status: service ? service.status() : unavailable, recent: service ? service.recent(10) : [] });
    } catch (error) { next(error); }
  });
  app.post('/api/chat-overlay', async (req, res, next) => {
    try {
      if (!store) throw fail('OBS 채팅창을 준비하지 못했습니다.', 503);
      guard();
      const result = await store.configure(req.body, { guard });
      service?.sync();
      res.set('Cache-Control', 'no-store').json({ ...result, status: service ? service.status() : unavailable });
    } catch (error) { next(error); }
  });
  // Operator test message: labelled as a test on OBS, kept only in memory like real chat.
  app.post('/api/chat-overlay/test', (req, res, next) => {
    try { ready(); guard(); const message = service.test(req.body); res.set('Cache-Control', 'no-store').json({ ok: true, id: message.id }); } catch (error) { next(error); }
  });
  app.post('/api/chat-overlay/clear', (req, res, next) => {
    try {
      ready(); guard();
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw fail('채팅창 비우기 요청을 확인해 주세요.');
      res.set('Cache-Control', 'no-store').json({ ok: true, ...service.clear() });
    } catch (error) { next(error); }
  });
}
