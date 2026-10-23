import { JsonStore } from './json-store.js';

// "기능 숨기기": the streamer hides features from their own portal menu and from the viewer page.
// Hiding is enforced on the server too: a request for a hidden feature's own routes is refused.
// A route shared by several screens is refused only when every screen that uses it is hidden.
// Saved in a separate file `operations.json.feature-visibility.json`.

/** Portal leaf pages (public/portal.js `menu`). `home` and `queue` can never be hidden. */
export const OPERATOR_PAGES = Object.freeze([
  'home', 'queue', 'open', 'presets', 'round', 'ready', 'undo', 'onboarding', 'handoff', 'practice',
  'intake-capacity', 'intake-duplicates', 'intake-close', 'recruitment-rules', 'call-settings',
  'subscriptions', 'recruitment', 'my-panel', 'recap', 'publication', 'guide', 'tickets', 'card-flip',
  'schedule', 'poll', 'studio', 'obs', 'obs-roulette', 'obs-chat', 'roulette', 'donation-roulette', 'lottery-board',
  'archive', 'timeline', 'stats', 'notifications', 'naver', 'cafe', 'search', 'write', 'memo', 'monitor',
  'discord', 'members', 'chzzk', 'live', 'panel'
]);
export const OPERATOR_LOCKED = Object.freeze(['home', 'queue']);

/** Viewer page sections, grouped for the settings screen. `participation` can never be hidden. */
export const VIEWER_FEATURES = Object.freeze([
  ['참가', [['participation', '참가 현황·호출·준비']]],
  ['보상', [['card-flip', '카드 뒤집기']]],
  ['방송 참여', [['poll', '방송 투표'], ['community', '알림·문의·규칙']]],
  ['내 정보', [['race-profile', '레이스 색상'], ['account-link', '네이버 계정 연결']]]
]);
export const VIEWER_LOCKED = Object.freeze(['participation']);
const VIEWER_IDS = VIEWER_FEATURES.flatMap(([, items]) => items.map(([id]) => id));

const P = (pattern, ...pages) => ({ pattern, pages });
// Paths are relative to the workspace (`/w/<guild>`), lower-case and without a trailing slash.
const OPERATOR_ROUTES = [
  P(/^\/api\/operations\/(?:open|close|reopen)$/, 'open'),
  P(/^\/api\/operations\/(?:draw|attendance|replace|teams|reshuffle|end|swap|voice|resize|edit_post|cancel_reservation)$/, 'round'),
  P(/^\/api\/operations\/setup$/, 'discord'),
  P(/^\/api\/broadcast-ops\/preset(?:\/open)?$/, 'presets'),
  P(/^\/api\/operation-tools\/ready\//, 'ready'), P(/^\/api\/operation-tools\/undo$/, 'undo'),
  P(/^\/readiness$/, 'onboarding', 'handoff'),
  P(/^\/intake-settings$/, 'intake-capacity', 'intake-duplicates', 'intake-close'),
  P(/^\/call-settings$/, 'call-settings'),
  P(/^\/api\/community\/(?:resolve|answer)$/, 'tickets'), P(/^\/api\/community\/guide$/, 'guide'),
  P(/^\/api\/community\/panel$/, 'my-panel'), P(/^\/api\/community\/publish$/, 'publication'),
  P(/^\/api\/community\/(?:draft|delete-draft)$/, 'recruitment'),
  P(/^\/api\/card-flip(?:\/|$)/, 'card-flip'),
  P(/^\/api\/broadcast-ops\/schedule$/, 'schedule'), P(/^\/api\/broadcast-ops\/poll$/, 'poll'),
  P(/^\/game-studio\.(?:html|js)$/, 'studio'),
  P(/^\/obs$/, 'obs', 'obs-roulette', 'obs-chat', 'donation-roulette', 'lottery-board'),
  P(/^\/api\/lottery-board(?:\/|$)/, 'lottery-board'),
  P(/^\/(?:roulette\.html|api\/roulette(?:\/spin)?)$/, 'roulette'),
  P(/^\/api\/donation-roulette(?:\/test)?$/, 'donation-roulette'),
  P(/^\/api\/chat-overlay(?:\/test|\/clear)?$/, 'obs-chat'),
  P(/^\/api\/broadcast-archive$/, 'archive'), P(/^\/api\/broadcast-ops\/notifications$/, 'notifications'),
  P(/^\/api\/naver\/(?:status|oauth\/start|disconnect)$/, 'naver'), P(/^\/settings$/, 'cafe'),
  P(/^\/api\/naver\/search$/, 'search'), P(/^\/api\/naver\/articles$/, 'write'),
  P(/^\/api\/naver\/participation(?:\/|$)/, 'memo'), P(/^\/api\/naver\/monitor(?:\/|$)/, 'monitor'),
  P(/^\/api\/chzzk\/verification\/owner\/start$/, 'chzzk'), P(/^\/live-settings$/, 'live'),
  P(/^\/api\/chzzk\/verification\/panel$/, 'panel')
];
const VIEWER_ROUTES = [
  P(/^\/viewer\/api\/card-flip(?:\/|$)/, 'card-flip'), P(/^\/viewer\/api\/poll(?:\/|$)/, 'poll'),
  P(/^\/viewer\/api\/community(?:\/|$)/, 'community'), P(/^\/viewer\/api\/avatar$/, 'race-profile'),
  P(/^\/viewer\/api\/account-link(?:\/|$)/, 'account-link')
];
const PAGE_FILES = { 'operation-tools.html': { ready: 'ready', undo: 'undo' } };
const COMMUNITY_PAGES = ['subscriptions', 'recruitment', 'my-panel', 'recap', 'publication', 'guide', 'tickets'];

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const validList = (list, ids, locked) => Array.isArray(list) && list.length <= ids.length && list.every(id => ids.includes(id) && !locked.includes(id)) && new Set(list).size === list.length;
const validHidden = hidden => plain(hidden) && Object.keys(hidden).sort().join() === 'operator,viewer' &&
  validList(hidden.operator, OPERATOR_PAGES, OPERATOR_LOCKED) && validList(hidden.viewer, VIEWER_IDS, VIEWER_LOCKED);

export class FeatureVisibilityStore extends JsonStore {
  constructor(operationsFile) {
    super(operationsFile + '.feature-visibility.json', { version: 1, revision: 0, hidden: { operator: [], viewer: [] } },
      state => plain(state) && state.version === 1 && revision(state.revision) && validHidden(state.hidden), { maxBytes: 64 * 1024 });
  }
  snapshot() { const state = this.read(); return { hidden: structuredClone(state.hidden), revision: state.revision }; }
  /** Input: {hidden:{operator:[page ids], viewer:[feature ids]}, revision}. */
  async configure(input, { guard = () => {} } = {}) {
    if (!plain(input) || Object.keys(input).sort().join() !== 'hidden,revision' || !revision(input.revision)) throw fail('숨길 기능과 최신 버전을 확인해 주세요.');
    if (!validHidden(input.hidden)) throw fail('숨길 수 없는 기능이거나 알 수 없는 기능입니다. 새로고침한 뒤 다시 시도하세요.');
    let result;
    await this.update(async state => {
      await guard();
      if (state.revision !== input.revision) throw fail('다른 곳에서 숨김 설정이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.', 409);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw fail('설정 변경을 완료할 수 없습니다. 제작자에게 점검을 요청하세요.', 409);
      state.hidden = { operator: [...input.hidden.operator], viewer: [...input.hidden.viewer] }; state.revision++;
      result = { hidden: structuredClone(state.hidden), revision: state.revision };
    });
    return result;
  }
}

/**
 * Hidden-feature check for one workspace request. `path` is relative to the workspace.
 * Returns the hidden page/feature id that blocks it, or null.
 */
export function hiddenFeatureFor(hidden, { method = 'GET', path = '', query = {} } = {}) {
  if (!hidden) return null;
  const route = String(path || '').replace(/\/+$/, '').toLowerCase() || '/';
  if (route.startsWith('/viewer/')) {
    const set = new Set(hidden.viewer || []);
    const rule = VIEWER_ROUTES.find(item => item.pattern.test(route));
    return rule && rule.pages.every(id => set.has(id)) ? rule.pages[0] : null;
  }
  const set = new Set(hidden.operator || []);
  if (route === '/api/feature-visibility') return null;
  const file = route.slice(1);
  if (PAGE_FILES[file]) { const id = PAGE_FILES[file][query?.feature]; return id && set.has(id) ? id : null; }
  if (file === 'community.html') {
    const feature = String(query?.feature || '');
    if (COMMUNITY_PAGES.includes(feature)) return set.has(feature) ? feature : null;
    return COMMUNITY_PAGES.every(id => set.has(id)) ? 'community' : null;
  }
  const rule = OPERATOR_ROUTES.find(item => item.pattern.test(route));
  void method;
  return rule && rule.pages.every(id => set.has(id)) ? rule.pages[0] : null;
}

/** Viewer feature ids that are hidden, for the viewer page. */
export const hiddenViewerFeatures = store => (store ? [...store.read().hidden.viewer] : []);

/** Streamer routes. They inherit workspace authentication, CSRF, Idempotency-Key and the workspace allowlist. */
export function installFeatureVisibilityRoutes({ app, store, guard }) {
  const view = () => ({ ...store.snapshot(), locked: { operator: [...OPERATOR_LOCKED], viewer: [...VIEWER_LOCKED] }, viewerFeatures: VIEWER_FEATURES });
  app.get('/api/feature-visibility', (_req, res, next) => { try { if (!store) throw fail('기능 숨기기를 준비하지 못했습니다.', 503); res.set('Cache-Control', 'no-store').json(view()); } catch (error) { next(error); } });
  app.post('/api/feature-visibility', async (req, res, next) => {
    try { if (!store) throw fail('기능 숨기기를 준비하지 못했습니다.', 503); guard(); await store.configure(req.body, { guard }); res.set('Cache-Control', 'no-store').json(view()); } catch (error) { next(error); }
  });
}
