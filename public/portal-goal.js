// 방송 → OBS → OBS 후원 목표. Only the running total is saved; who donated is not.
const states = { unavailable: ['준비 안 됨', 'readiness-optional'], not_connected: ['방송 계정 연결 필요', 'readiness-attention'], disabled: ['사용 안 함', 'readiness-optional'], stopped: ['중지', 'readiness-optional'], connecting: ['연결 중', 'readiness-pending'], subscribing: ['구독 요청 중', 'readiness-pending'], subscribed: ['후원 구독 요청 완료', 'readiness-configured'], reconnecting: ['재연결 대기', 'readiness-attention'], auth_required: ['후원 조회 권한 동의 필요', 'readiness-attention'] };
const won = n => Number(n).toLocaleString('ko-KR');

export async function renderDonationGoal({ p, el, button, run, request, reload }) {
  const data = await request('/api/donation-goal');
  if (!data || !Number.isSafeInteger(data.revision) || !data.settings || !data.progress) throw Error('저장된 후원 목표를 확인하지 못했습니다. 다시 불러와 주세요.');
  const s = data.settings, g = data.progress, st = data.status || {};
  const [label, cls] = states[st.state] || ['상태 확인 필요', 'readiness-attention'], evidence = el('div', undefined, 'readiness-evidence');
  evidence.append(el('span', label, 'badge ' + cls), el('span', '실제 후원 수신 검증 대기', 'badge readiness-pending'));
  p.append(el('p', '치즈 후원이 쌓일수록 OBS의 목표 막대가 차올라요. 누적 금액과 횟수만 저장하고, 누가 얼마를 냈는지는 저장하지 않아요.', 'settings-guidance'), evidence);

  try {
    const obs = await request('/obs');
    if (typeof obs?.donationGoalUrl === 'string' && obs.donationGoalUrl.startsWith('http')) {
      const box = el('section', undefined, 'intake-setting-card'), wrap = el('label', 'OBS 브라우저 소스 주소 (투명 배경 · 권장 900×140)'), url = el('input');
      url.readOnly = true; url.value = obs.donationGoalUrl; wrap.append(url);
      box.append(el('h2', 'OBS에 후원 목표 띄우기'), wrap, button('주소 복사', async () => { await navigator.clipboard.writeText(obs.donationGoalUrl); }, 'secondary'), el('p', '주소에는 방송 화면 토큰이 들어 있어요. 다른 사람에게 보여 주지 마세요.', 'field-help'));
      p.append(box);
    }
  } catch { /* The goal still works without the address box. */ }

  // Current progress
  const now = el('section', undefined, 'intake-setting-card dg-now'), pct = Math.min(100, Math.floor(g.total / s.target * 100));
  const bar = el('div', undefined, 'dg-bar'), fill = el('span'); fill.style.width = pct + '%'; bar.append(fill);
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(pct));
  now.append(el('h2', '지금 진행'), el('p', `${won(g.total)} / ${won(s.target)}치즈 (${Math.floor(g.total / s.target * 100)}%) · 후원 ${won(g.count)}번`, 'dg-numbers'), bar,
    button('0부터 다시 시작', async () => { if (!confirm('누적 금액을 0으로 되돌릴까요? 되돌린 뒤에는 이전 금액을 복구할 수 없어요.')) return; await request('/api/donation-goal/reset', { revision: data.revision }); await reload(); }, 'secondary'));
  p.append(now);

  // Settings
  const f = el('form', undefined, 'form settings-form');
  f.append(el('h2', '목표 설정'));
  const check = (title, help, value) => { const wrap = el('label', undefined, 'setting-toggle'), input = el('input'), text = el('span'); input.type = 'checkbox'; input.checked = value; text.append(el('strong', title), el('span', help, 'field-help')); wrap.append(input, text); return [wrap, input]; };
  const [enabledWrap, enabled] = check('후원 목표 사용', '켜면 OBS에 막대가 보이고, 방송 계정이 연결되어 있으면 후원을 더해요.', s.enabled);
  const titleWrap = el('label', '목표 제목 (30자까지)'), title = el('input'); title.maxLength = 30; title.required = true; title.value = s.title; titleWrap.append(title);
  const targetWrap = el('label', '목표 금액 (치즈)', 'cf-num'), target = el('input'); target.type = 'number'; target.min = '100'; target.max = '100000000'; target.step = '1'; target.required = true; target.value = String(s.target); targetWrap.append(target);
  const [testWrap, countTests] = check('테스트 후원도 더하기', '끄면 테스트는 OBS에 잠깐 줄무늬로만 보이고 누적 금액은 그대로예요.', s.countTests);
  const save = el('button', '설정 저장'); save.type = 'submit';
  f.append(enabledWrap, titleWrap, targetWrap, testWrap, save);
  f.onsubmit = e => { e.preventDefault(); run(async () => { await request('/api/donation-goal', { enabled: enabled.checked, title: title.value, target: Number(target.value), countTests: countTests.checked, revision: data.revision }); await reload(); }); };
  p.append(f);

  // Test
  const t = el('form', undefined, 'intake-setting-card lb-test'), amtWrap = el('label', '치즈 금액'), amount = el('input'), go = el('button', '테스트 후원', 'secondary'), result = el('p', '', 'field-help');
  amount.type = 'number'; amount.min = '1'; amount.max = '10000000'; amount.value = '1000'; amount.required = true; amtWrap.append(amount); go.type = 'submit'; result.setAttribute('role', 'status');
  t.append(el('h2', 'OBS 테스트'), el('p', '실제 치즈 없이 막대가 차오르는 모습을 확인해요. 1초에 한 번 보낼 수 있어요.', 'field-help'), amtWrap, go, result);
  t.onsubmit = e => { e.preventDefault(); run(async () => { const r = await request('/api/donation-goal/test', { amount: Number(amount.value) }); result.textContent = r.test?.counted ? '누적 금액에 더했어요.' : 'OBS에 테스트로만 보여 줬어요(누적 금액은 그대로).'; if (r.test?.counted) await reload(); }); };
  p.append(t);
}
