import { PermissionFlagsBits } from 'discord.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const read = (value, key) => { try { return record(value) ? value[key] : undefined; } catch { return undefined; } };
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const channelId = value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value);
const boardId = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
const present = value => typeof value === 'string' && value.trim().length > 0;
const action = (page, label) => ({ page, label });

function localCall(owner, method, ...args) {
  try {
    const fn = read(owner, method);
    if (typeof fn !== 'function' || fn.constructor?.name === 'AsyncFunction') return { ok: false };
    const value = fn.apply(owner, args);
    if (value instanceof Promise) { void value.catch(() => {}); return { ok: false }; }
    return { ok: true, value };
  } catch { return { ok: false }; }
}

function roleReadiness({ guild, roleId, guildId }) {
  if (!snowflake(roleId)) return ['attention', '인증 역할이 아직 저장되지 않았습니다. 인증 안내를 준비해 주세요.'];
  if (read(guild, 'id') !== guildId) return ['pending', '인증 역할은 저장되어 있습니다. 현재 서버의 캐시 정보가 부족해 권한·역할 순서는 실제 확인이 필요합니다.'];
  const role = localCall(read(read(guild, 'roles'), 'cache'), 'get', roleId).value;
  const me = read(read(guild, 'members'), 'me');
  if (!record(role) || !record(me)) return ['pending', '인증 역할은 저장되어 있습니다. 캐시 정보가 부족해 권한·역할 순서는 실제 확인이 필요합니다.'];
  if (roleId === guildId || read(role, 'managed') === true) return ['attention', '인증 역할이 자동 관리 역할이거나 기본 역할입니다. 권한 없는 인증 전용 역할을 확인하세요.'];
  if (read(role, 'managed') !== false) return ['pending', '인증 역할의 종류를 캐시에서 확인할 수 없습니다. 실제 확인이 필요합니다.'];
  const bitfield = read(read(role, 'permissions'), 'bitfield');
  if (typeof bitfield !== 'bigint') return ['pending', '인증 역할의 권한 정보를 캐시에서 확인할 수 없습니다. 실제 확인이 필요합니다.'];
  if (bitfield !== 0n) return ['attention', '인증 역할에 추가 권한이 있습니다. 권한 없는 인증 전용 역할을 확인하세요.'];
  const permission = localCall(read(me, 'permissions'), 'has', PermissionFlagsBits.ManageRoles);
  const highest = read(read(me, 'roles'), 'highest');
  const position = record(highest) ? localCall(role, 'comparePositionTo', highest) : { ok: false };
  if (permission.ok && permission.value === false) return ['attention', '캐시 기준으로 봇에 역할 관리 권한이 없습니다. Discord에서 권한을 확인하세요.'];
  if (position.ok && typeof position.value === 'number' && Number.isFinite(position.value) && position.value >= 0) return ['attention', '캐시 기준으로 인증 역할이 봇의 최고 역할보다 높거나 같습니다. 역할 순서를 확인하세요.'];
  if (!permission.ok || permission.value !== true || !position.ok || typeof position.value !== 'number' || !Number.isFinite(position.value)) return ['pending', '인증 역할은 저장되어 있습니다. 캐시 정보가 부족해 권한·역할 순서는 실제 확인이 필요합니다.'];
  return ['configured', '캐시 기준으로 인증 전용 역할과 봇의 권한·역할 순서가 설정되어 있습니다. 실제 역할 부여 검증은 대기 중입니다.'];
}

/** Build a bounded, read-only view of saved settings and the current Discord cache. */
export function buildWorkspaceReadiness({ context, paused = false, now = Date.now() } = {}) {
  const checkedAt = typeof now === 'number' && Number.isFinite(now) && now >= 0 && now <= 8640000000000000 ? Math.trunc(now) : Date.now();
  const config = read(context, 'config');
  const guildId = read(config, 'guildId');
  const validGuild = snowflake(guildId);
  const client = read(read(context, 'discord'), 'client');
  const guild = validGuild ? localCall(read(read(client, 'guilds'), 'cache'), 'get', guildId).value : undefined;
  const ready = localCall(client, 'isReady');
  const operations = localCall(read(context, 'operations'), 'read');
  const saved = operations.value;
  const panel = read(saved, 'panel');
  const savedGuild = read(saved, 'guildId');
  const matchingGuild = validGuild && (savedGuild === undefined || savedGuild === '' || savedGuild === guildId);
  const chzzk = localCall(read(context, 'chzzkVerification'), 'summary');
  const chzzkSaved = chzzk.value;
  const chzzkTarget = read(chzzkSaved, 'channelId');
  const roleId = read(chzzkSaved, 'roleId');
  const naver = localCall(read(context, 'naver'), 'status');
  const naverSaved = naver.value;
  const cafe = read(config, 'naverCafeId');
  const menu = read(config, 'naverMemoMenuId') || read(config, 'naverMenuId');
  const naverSelected = present(cafe) || present(read(config, 'naverMenuId')) || present(read(config, 'naverMemoMenuId')) || read(config, 'naverMonitorEnabled') === true || read(naverSaved, 'connected') === true;
  const checks = [];
  const add = (id, title, status, detail, next = null) => checks.push({ id, title, status, detail, action: next });

  if (!validGuild || ready.value === false || (snowflake(read(guild, 'id')) && read(guild, 'id') !== guildId)) add('discord', 'Discord 연결', 'attention', '현재 서버의 Discord 연결을 확인할 수 없습니다. 연결 상태를 다시 확인하세요.', action('discord', 'Discord 확인'));
  else if (!ready.ok || ready.value !== true || !record(guild) || read(guild, 'id') !== guildId) add('discord', 'Discord 연결', 'pending', '봇 연결 또는 서버 캐시 정보가 부족합니다. 현재 서버 접근 여부는 실제 확인이 필요합니다.', action('discord', 'Discord 확인'));
  else add('discord', 'Discord 연결', 'configured', '봇 연결과 현재 서버 캐시가 확인되었습니다. 실제 메시지 전송·권한 검증은 대기 중입니다.');

  if (operations.ok && record(saved) && matchingGuild && snowflake(read(panel, 'channelId')) && snowflake(read(panel, 'id'))) add('channels', 'Discord 운영 채널 기록', 'configured', '현재 서버의 참가 안내 패널 참조가 저장되어 있습니다. 채널 존재·메시지 권한은 실제 확인이 필요합니다.', action('discord', '채널 준비 보기'));
  else add('channels', 'Discord 운영 채널 기록', 'attention', '현재 서버의 참가 안내 패널 기록이 없거나 올바르지 않습니다. 운영 채널을 준비해 주세요.', action('discord', '채널 준비'));

  if (chzzk.ok && record(chzzkSaved) && read(chzzkSaved, 'enabled') === true && read(chzzkSaved, 'ownerConnected') === true && channelId(chzzkTarget) && validGuild) add('chzzk', 'CHZZK 방송 계정', 'configured', '이 서버의 방송 계정 연결과 인증 대상이 저장되어 있습니다. 현재 OAuth·팔로워 조회 성공을 의미하지 않습니다.', action('chzzk', '방송 계정 보기'));
  else add('chzzk', 'CHZZK 방송 계정', 'attention', '이 서버의 저장된 방송 계정 연결을 확인할 수 없습니다. 방송 계정을 연결하거나 제작자에게 확인해 주세요.', action('chzzk', '방송 계정 연결'));
  const [roleStatus, roleDetail] = roleReadiness({ guild, roleId, guildId });
  add('verification-role', '팔로워 인증 역할', roleStatus, roleDetail, action('panel', '인증 안내 보기'));

  if (!record(context) || !record(config)) {
    add('naver', '네이버 계정', 'pending', '방송 공간 설정을 확인할 수 없습니다. 네이버 사용 여부와 저장된 연결을 확인해 주세요.', action('naver', '네이버 연결 보기'));
    add('naver-board', '네이버 카페·게시판', 'pending', '방송 공간 설정을 확인할 수 없습니다. 카페·게시판 설정을 확인해 주세요.', action('cafe', '카페 설정 보기'));
  } else if (!naverSelected && ((naver.ok && record(naverSaved) && read(naverSaved, 'connected') === false) || !read(context, 'naver'))) {
    add('naver', '네이버 계정', 'optional', '네이버 기능을 선택하지 않았습니다. 사용할 때 이 방송 공간에 계정을 연결하세요.', action('naver', '네이버 연결'));
    add('naver-board', '네이버 카페·게시판', 'optional', '네이버 기능을 사용할 때 카페·게시판을 설정하세요.', action('cafe', '카페 설정'));
  } else {
    const next = action('naver', '네이버 연결 확인');
    const expiry = read(naverSaved, 'expiresAt');
    if (!naver.ok || !record(naverSaved) || read(naverSaved, 'oauthConfigured') !== true || read(naverSaved, 'connected') !== true) add('naver', '네이버 계정', 'attention', '저장된 네이버 로그인 설정 또는 계정 연결을 확인할 수 없습니다. 연결을 확인해 주세요.', next);
    else if (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= 0) add('naver', '네이버 계정', 'pending', '네이버 연결 기록은 있으나 만료 시간을 확인할 수 없습니다. 실제 인증 상태를 확인해 주세요.', next);
    else if (expiry <= checkedAt) add('naver', '네이버 계정', read(naverSaved, 'hasRefreshToken') === true ? 'pending' : 'attention', read(naverSaved, 'hasRefreshToken') === true ? '저장된 네이버 로그인 유효 시간이 지났습니다. 갱신 정보는 있으나 실제 갱신 성공은 확인이 필요합니다.' : '저장된 네이버 로그인 유효 시간이 지났습니다. 네이버 계정을 다시 연결해 주세요.', next);
    else add('naver', '네이버 계정', 'configured', '유효 시간 안의 네이버 로그인 기록이 저장되어 있습니다. 현재 외부 API 인증 성공은 실제 확인이 필요합니다.', next);
    add('naver-board', '네이버 카페·게시판', boardId(cafe) && boardId(menu) ? 'configured' : 'attention', boardId(cafe) && boardId(menu) ? '카페·게시판 번호가 저장되어 있습니다. 실제 게시판 접근·시참 접수 검증은 대기 중입니다.' : '카페 또는 게시판 번호가 없거나 올바르지 않습니다. 사용할 게시판을 설정해 주세요.', action('cafe', '카페 설정'));
  }

  add('obs', 'OBS 화면 접근 설정', present(read(config, 'broadcastToken')) && validGuild ? 'configured' : 'attention', present(read(config, 'broadcastToken')) && validGuild ? '이 방송 공간의 OBS 접근 설정이 저장되어 있습니다. 브라우저 소스 표시 검증은 대기 중입니다.' : '이 방송 공간의 OBS 접근 설정을 확인할 수 없습니다. 제작자에게 확인해 주세요.', action('obs', 'OBS 화면 보기'));
  const required = checks.filter(check => check.status !== 'optional');
  const summary = { configured: required.filter(check => check.status === 'configured').length, total: required.length, attention: required.filter(check => check.status === 'attention' || check.status === 'pending').length };
  const isPaused = paused === true;
  const status = { configured: '저장 설정 확인', attention: '확인 필요', pending: '실제 확인 대기', optional: '선택 기능' };
  const text = [`댕댕봇 운영 인계 · ${isPaused ? '운영 일시 중지' : '운영 잠금 표시 없음'}`, `확인 시각: ${new Date(checkedAt).toISOString()} (UTC)`, `로컬 저장 설정 ${summary.configured}/${summary.total} · 확인할 항목 ${summary.attention}`, ...checks.map(check => `${check.title}: ${status[check.status]}`), '실서비스 검증: 대기 · 실제 로그인, 권한, 시참 흐름과 재시작 복구를 별도로 확인해야 합니다.'].join('\n');
  return { checkedAt, evidence: 'local', productionVerification: 'pending', paused: isPaused, summary, checks, handoff: { text } };
}
