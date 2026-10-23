import path from 'node:path';

export const discordId = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
export const workspaceError = (message, status = 403) => Object.assign(Error(message), { status });

// These are product operations, not a second way into the creator's maintenance APIs.
const reads = new Set([
  '/api/access', '/api/snapshot', '/api/participation-queue',
  '/api/broadcast-ops', '/api/broadcast-runbook', '/api/broadcast-archive',
  '/api/broadcast-control', '/api/chzzk/live', '/api/chzzk/verification',
  '/api/community', '/api/community-options', '/api/operation-tools', '/api/roulette', '/api/donation-roulette', '/api/chat-overlay', '/api/card-flip', '/api/feature-visibility', '/api/lottery-board', '/api/donation-alert',
  '/api/naver/status', '/api/naver/monitor', '/api/naver/participation',
  '/api/naver/profile', '/api/naver/search', '/api/broadcast-settings', '/api/broadcast-export'
]);
const writes = new Set([
  '/api/chzzk/verification/owner/start', '/api/chzzk/verification/panel', '/api/roulette/spin', '/api/donation-roulette', '/api/donation-roulette/test',
  '/api/chat-overlay', '/api/chat-overlay/test', '/api/chat-overlay/clear', '/api/donation-alert', '/api/donation-alert/test',
  '/api/card-flip', '/api/card-flip/image', '/api/card-flip/image/remove', '/api/card-flip/grant', '/api/card-flip/reward', '/api/card-flip/test', '/api/feature-visibility',
  // 뽑기판 settings and openings. The layout route (/api/lottery-board/layout) is creator-only and never listed here.
  '/api/lottery-board', '/api/lottery-board/new', '/api/lottery-board/open', '/api/lottery-board/pending/remove', '/api/lottery-board/test',
  '/api/naver/oauth/start', '/api/naver/disconnect', '/api/naver/join',
  '/api/naver/articles', '/api/naver/monitor/settings', '/api/naver/monitor/run', '/api/naver/monitor/retry',
  '/api/naver/participation/register', '/api/naver/participation/cancel',
  '/api/naver/participation/close', '/api/naver/participation/session', '/api/naver/participation/reset',
  '/api/broadcast-scene', '/api/broadcast-settings', '/api/broadcast-preset', '/api/broadcast-automation', '/api/broadcast-import', '/api/chzzk/live/run'
]);
const productActions = {
  '/api/participation-queue/': new Set(['register', 'call-next']),
  '/api/operations/': new Set(['open', 'close', 'reopen', 'draw', 'attendance', 'replace', 'teams', 'reshuffle', 'end', 'publish', 'setup', 'resize', 'edit_post', 'swap', 'voice', 'cancel_reservation']),
  '/api/operation-tools/': new Set(['ready/start', 'ready/answer', 'ready/close', 'undo']),
  '/api/community/': new Set(['settings', 'draft', 'publish', 'resolve', 'delete-draft', 'answer', 'panel', 'guide']),
  '/api/broadcast-runbook/': new Set(['new', 'step', 'handoff', 'closeout']),
  '/api/broadcast-ops/': new Set(['preset', 'preset/open', 'schedule', 'poll', 'notifications'])
};

export function workspaceRouteAllowed(method, pathname) {
  if (typeof pathname !== 'string' || /[\\%?#]/.test(pathname) || pathname.includes('//')) return false;
  if (method === 'GET') return reads.has(pathname) || /^\/api\/card-flip\/image\/c[a-f0-9]{8}-[a-f0-9]{16}\.(?:png|jpg|webp)$/.test(pathname);
  if (method !== 'POST') return false;
  if (writes.has(pathname)) return true;
  if (/^\/api\/participation-queue\/[A-Za-z0-9_-]{1,100}\/(call|call-cancel|status|reorder)$/.test(pathname)) return true;
  return Object.entries(productActions).some(([prefix, actions]) => pathname.startsWith(prefix) && actions.has(pathname.slice(prefix.length)));
}

export function workspaceDirectory(root, guildId) {
  if (!discordId(guildId)) throw workspaceError('올바른 Discord 서버를 선택하세요.', 400);
  const base = path.resolve(root), directory = path.resolve(base, guildId);
  if (path.dirname(directory) !== base) throw workspaceError('작업 공간 경로를 확인하세요.', 400);
  return directory;
}

export function workspacePublicSnapshot(value, identity) {
  const state = structuredClone(value.state || {});
  // Deployment records and creator diagnostics are never product data.
  for (const key of ['safeDeploy', 'release', 'recovery', 'environment', 'runtime']) delete state[key];
  return {
    state, records: value.records || [], participationQueue: value.participationQueue,
    participationCalls: value.participationCalls, broadcastOps: value.broadcastOps,
    chzzkLive: value.chzzkLive, revision: value.revision, serverTime: value.serverTime,
    csrf: identity.csrf, version: value.version,
    access: { role: 'workspace', user: identity.user, guildId: identity.guildId },
    paused: Boolean(value.emergency?.locked)
  };
}
