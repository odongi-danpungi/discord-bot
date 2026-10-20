import { publicDonationEvents } from './donation-roulette.js';

const fail = (message, status = 400) => Object.assign(Error(message), { status });

/** Routes inherit dashboard/workspace authentication, CSRF, `broadcast` capability and workspace allowlists. */
export function installDonationRouletteRoutes({ app, store, service, guard }) {
  app.get('/api/donation-roulette', (_req, res, next) => {
    try {
      if (!store) throw fail('치즈 후원 룰렛을 준비하지 못했습니다.', 503);
      const snapshot = store.snapshot();
      res.set('Cache-Control', 'no-store').json({ settings: snapshot.settings, revision: snapshot.revision, events: publicDonationEvents(snapshot.events),
        status: service ? service.status() : { state: 'unavailable', verification: 'pending' } });
    } catch (error) { next(error); }
  });
  app.post('/api/donation-roulette', async (req, res, next) => {
    try {
      if (!store) throw fail('치즈 후원 룰렛을 준비하지 못했습니다.', 503);
      guard();
      const result = await store.configure(req.body, { guard });
      service?.sync();
      res.set('Cache-Control', 'no-store').json({ ...result, status: service ? service.status() : { state: 'unavailable', verification: 'pending' } });
    } catch (error) { next(error); }
  });
  // Operator test donation: shown on the log and OBS as a test, never written to roulette history.
  app.post('/api/donation-roulette/test', async (req, res, next) => {
    try {
      if (!store || !service) throw fail('치즈 후원 룰렛을 준비하지 못했습니다.', 503);
      guard();
      const result = await service.test(req.body);
      const events = (Array.isArray(result) ? result : result ? [result] : []).map(event => event.id);
      res.set('Cache-Control', 'no-store').json({ ok: true, events });
    } catch (error) { next(error); }
  });
}
