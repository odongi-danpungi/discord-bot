const fail = (message, status = 400) => Object.assign(Error(message), { status });
const unavailable = () => fail('카드 뒤집기를 준비하지 못했습니다.', 503);
const sendImage = (res, image) => res.set({ 'Content-Type': image.type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(image.bytes);

/** Participant profiles of this server, used for names and the direct-grant picker. */
export function cardFlipProfiles(store, guildId) {
  return store.read().filter(record => record.guildId === guildId && /^\d{17,20}$/.test(record.discordId || ''))
    .map(record => ({ userId: record.discordId, name: String(record.chzzkName || record.discordUsername || '').slice(0, 32) || '이름 없음' }));
}

/** Streamer routes. They inherit dashboard/workspace authentication, CSRF, Idempotency-Key, the `broadcast` capability and workspace allowlists. */
export function installCardFlipRoutes({ app, service, profiles }) {
  const json = (res, value) => res.set('Cache-Control', 'no-store').json(value);
  app.get('/api/card-flip', (_req, res, next) => { try { if (!service) throw unavailable(); json(res, service.adminView(profiles())); } catch (error) { next(error); } });
  app.post('/api/card-flip', async (req, res, next) => { try { if (!service) throw unavailable(); await service.configure(req.body); service.sync(); json(res, service.adminView(profiles())); } catch (error) { next(error); } });
  app.post('/api/card-flip/image', async (req, res, next) => { try { if (!service) throw unavailable(); await service.saveImage(req.body); json(res, service.adminView(profiles())); } catch (error) { next(error); } });
  app.post('/api/card-flip/image/remove', async (req, res, next) => { try { if (!service) throw unavailable(); await service.removeImage(req.body); json(res, service.adminView(profiles())); } catch (error) { next(error); } });
  app.post('/api/card-flip/grant', async (req, res, next) => {
    try {
      if (!service) throw unavailable();
      const known = new Set(profiles().map(p => p.userId)), result = await service.grant(req.body, userId => known.has(userId));
      json(res, { ...service.adminView(profiles()), added: result.added });
    } catch (error) { next(error); }
  });
  app.post('/api/card-flip/reward', async (req, res, next) => { try { if (!service) throw unavailable(); await service.resolveReward(req.body); json(res, service.adminView(profiles())); } catch (error) { next(error); } });
  app.get('/api/card-flip/image/:name', async (req, res, next) => { try { if (!service) throw unavailable(); sendImage(res, await service.image(req.params.name)); } catch (error) { next(error); } });
}

/** Viewer routes inside the viewer router (viewer session, CSRF, idempotency and emergency lock already applied). */
export function installCardFlipViewerRoutes(router, { service, registered }) {
  const ready = req => {
    const current = service();
    if (!current) throw unavailable();
    if (!registered(req.viewer.userId)) throw fail('먼저 /연동으로 게임 정보를 등록해 주세요.', 403);
    return current;
  };
  router.get('/api/card-flip', (req, res, next) => { try { res.json(ready(req).view(req.viewer.userId)); } catch (error) { next(error); } });
  router.post('/api/card-flip/new', async (req, res, next) => {
    try { if (Object.keys(req.body || {}).length) throw fail('요청 형식을 확인해 주세요.'); res.json(await ready(req).newGame(req.viewer.userId)); } catch (error) { next(error); }
  });
  router.post('/api/card-flip/flip', async (req, res, next) => { try { res.json(await ready(req).flip(req.viewer.userId, req.body)); } catch (error) { next(error); } });
  router.post('/api/card-flip/use', async (req, res, next) => { try { res.json(await ready(req).requestUse(req.viewer.userId, req.body)); } catch (error) { next(error); } });
  router.get('/api/card-flip/image/:name', async (req, res, next) => { try { sendImage(res, await ready(req).image(req.params.name)); } catch (error) { next(error); } });
}
