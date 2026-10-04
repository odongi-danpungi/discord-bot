const $ = id => document.getElementById(id);
let csrf = '', busy = false;
async function api(path, body) {
  const response = await fetch(path, { cache: 'no-store', ...(body ? { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID()
  }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || '요청을 완료할 수 없습니다.'); return data;
}
async function refresh() {
  const snapshot = await api('/api/snapshot'); csrf = snapshot.csrf;
  const summary = await api('/api/chzzk/verification');
  $('status').textContent = !summary.enabled ? '인증 기능 미설정 · Railway에서 CHZZK_VERIFY_ENABLED와 필수 환경변수를 설정하세요.' : summary.ownerConnected ? '공통 방송 채널 연결됨 · 모든 Discord 서버에 적용됩니다. 실제 팔로워 조회는 참가자 인증 시 확인합니다.' : '운영자가 공통 방송 채널을 한 번 연결하세요. 채널 ID는 자동으로 저장됩니다.';
  $('details').replaceChildren();
  if (summary.installUrl) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'), link = document.createElement('a');
    dt.textContent = '서버 추가'; link.textContent = '인증 역할 자동 설정으로 봇 초대'; link.href = summary.installUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; dd.append(link); $('details').append(dt, dd);
  }
  if (summary.ownerConnected && /^[a-f0-9]{32}$/i.test(summary.channelId)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'), link = document.createElement('a');
    dt.textContent = '공통 인증 대상'; link.textContent = summary.channelName || '연결된 방송 채널';
    link.href = `https://chzzk.naver.com/${summary.channelId}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; dd.append(link); $('details').append(dt, dd);
  }
  for (const [label, value] of [['적용 방식', '모든 Discord 서버 → 같은 방송 채널'], ['참여 중인 서버', summary.joinedGuildCount || 0], ['역할 준비된 서버', summary.guildCount || 0], ['인증 시작', '/치지직인증 · 각 서버에서 실행'], ['기본 서버 인증 완료', summary.verifiedCount || 0], ['계정 연결', summary.linkedCount || 0], ['닉네임 동기화', summary.nicknameSync ? '사용' : '사용 안 함'], ['등록할 Callback URL', summary.callbackUrl || 'PUBLIC_BASE_URL + /oauth/chzzk/callback']]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = String(value); $('details').append(dt, dd);
  }
}
async function run(fn) {
  if (busy) return; busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { $('status').textContent = e.message; }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
$('refresh').onclick = () => run(refresh);
$('owner').onclick = () => run(async () => {
  const next = await api('/api/chzzk/verification/owner/start', {});
  $('ownerLink').href = next.url; $('ownerLink').hidden = false; $('status').textContent = '인증할 방송 채널의 소유자 계정으로 동의하면 그 채널이 모든 서버의 공통 인증 대상이 됩니다. 본인 전용 링크는 10분 이내 사용하세요.';
});
$('panel').onclick = () => run(async () => {
  await api('/api/chzzk/verification/panel', { channelId: $('channel').value.trim() }); await refresh(); $('status').textContent = 'Discord 인증 패널을 게시 / 갱신했습니다.';
});
run(refresh);
