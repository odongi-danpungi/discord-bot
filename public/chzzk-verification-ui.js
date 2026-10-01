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
  $('status').textContent = !summary.enabled ? '인증 기능 미설정 · Railway에서 CHZZK_VERIFY_ENABLED와 필수 환경변수를 설정하세요.' : summary.ownerConnected ? '방송 채널 인증 정보 저장됨 · 실제 팔로워 조회는 참가자 인증 시 확인합니다.' : '참가자 인증 전에 방송 채널 연결이 필요합니다.';
  $('details').replaceChildren();
  for (const [label, value] of [['인증 완료', summary.verifiedCount || 0], ['계정 연결', summary.linkedCount || 0], ['닉네임 동기화', summary.nicknameSync ? '사용' : '사용 안 함'], ['등록할 Callback URL', summary.callbackUrl || 'PUBLIC_BASE_URL + /oauth/chzzk/callback']]) {
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
  $('ownerLink').href = next.url; $('ownerLink').hidden = false; $('status').textContent = '본인 전용 링크를 10분 이내 사용하세요. 다른 사람에게 공유하지 마세요.';
});
$('panel').onclick = () => run(async () => {
  await api('/api/chzzk/verification/panel', { channelId: $('channel').value.trim() }); await refresh(); $('status').textContent = 'Discord 인증 패널을 게시 / 갱신했습니다.';
});
run(refresh);
