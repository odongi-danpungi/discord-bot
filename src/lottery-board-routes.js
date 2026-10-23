const fail = (message, status = 400) => Object.assign(Error(message), { status });
const unavailable = () => fail('뽑기판을 준비하지 못했습니다.', 503);

/** Streamer routes (`broadcast` capability, workspace allowlist, CSRF, Idempotency-Key, emergency lock). */
export function installLotteryBoardRoutes({ app, service }) {
  const json = (res, value) => res.set('Cache-Control', 'no-store').json(value);
  const post = (path, action) => app.post(path, async (req, res, next) => { try { if (!service) throw unavailable(); json(res, await action(req.body)); service.sync(); } catch (error) { next(error); } });
  app.get('/api/lottery-board', (_req, res, next) => { try { if (!service) throw unavailable(); json(res, service.adminView()); } catch (error) { next(error); } });
  post('/api/lottery-board', body => service.configure(body));
  post('/api/lottery-board/new', body => service.newBoard(body));
  post('/api/lottery-board/open', body => service.openPending(body));
  post('/api/lottery-board/pending/remove', body => service.removePending(body));
  post('/api/lottery-board/test', body => ({ ...service.adminView(), test: service.testDonation(body) }));
  // Creator only: not in the workspace allowlist and no basic-auth operator capability grants it.
  // The read is deliberately not written to the audit log or any other record.
  app.get('/api/lottery-board/layout', (req, res, next) => {
    try {
      if (req.dashboardIdentity?.role !== 'admin') throw fail('제작자만 볼 수 있습니다.', 403);
      if (!service) throw unavailable();
      json(res, service.layout());
    } catch (error) { next(error); }
  });
}
