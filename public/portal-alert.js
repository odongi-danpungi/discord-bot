// 방송 → OBS → OBS 후원 알림. The server checks every value again.
const states = { unavailable: ['준비 안 됨', 'readiness-optional'], not_connected: ['방송 계정 연결 필요', 'readiness-attention'], disabled: ['사용 안 함', 'readiness-optional'], stopped: ['중지', 'readiness-optional'], connecting: ['연결 중', 'readiness-pending'], subscribing: ['구독 요청 중', 'readiness-pending'], subscribed: ['후원 구독 요청 완료', 'readiness-configured'], reconnecting: ['재연결 대기', 'readiness-attention'], auth_required: ['후원 조회 권한 동의 필요', 'readiness-attention'] };
const time = at => new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const won = n => Number(n).toLocaleString('ko-KR');
/** Same rendering as the OBS page: {닉네임} and {금액} are filled in, everything else is plain text. */
export const fillTemplate = (template, nickname, amount) => String(template).replaceAll('{닉네임}', nickname).replaceAll('{금액}', won(amount));

export async function renderDonationAlert({ p, el, button, run, request, reload }) {
  const data = await request('/api/donation-alert');
  if (!data || !Number.isSafeInteger(data.revision) || !data.settings) throw Error('저장된 후원 알림 설정을 확인하지 못했습니다. 다시 불러와 주세요.');
  const s = data.settings, st = data.status || {};
  const [label, cls] = states[st.state] || ['상태 확인 필요', 'readiness-attention'], evidence = el('div', undefined, 'readiness-evidence');
  evidence.append(el('span', label, 'badge ' + cls), el('span', '실제 후원 수신 검증 대기', 'badge readiness-pending'));
  p.append(el('p', '치즈 후원이 들어오면 OBS 화면에 알림이 뜹니다. 후원 메시지는 화면에 잠깐 보여 주기만 하고 저장하지 않아요.', 'settings-guidance'), evidence);

  try {
    const obs = await request('/obs');
    if (typeof obs?.donationAlertUrl === 'string' && obs.donationAlertUrl.startsWith('http')) {
      const box = el('section', undefined, 'intake-setting-card'), wrap = el('label', 'OBS 브라우저 소스 주소 (투명 배경 · 권장 800×300, "OBS에서 오디오 제어" 켜기)'), url = el('input');
      url.readOnly = true; url.value = obs.donationAlertUrl; wrap.append(url);
      box.append(el('h2', 'OBS에 후원 알림 띄우기'), wrap, button('주소 복사', async () => { await navigator.clipboard.writeText(obs.donationAlertUrl); }, 'secondary'), el('p', '주소에는 방송 화면 토큰이 들어 있어요. 다른 사람에게 보여 주지 마세요.', 'field-help'));
      p.append(box);
    }
  } catch { /* The alert still works without the address box. */ }

  // Settings
  const f = el('form', undefined, 'form settings-form da-form');
  f.append(el('h2', '알림 설정'));
  const check = (title, help, value) => { const wrap = el('label', undefined, 'setting-toggle'), input = el('input'), text = el('span'); input.type = 'checkbox'; input.checked = value; text.append(el('strong', title), el('span', help, 'field-help')); wrap.append(input, text); return [wrap, input]; };
  const [enabledWrap, enabled] = check('후원 알림 사용', '방송 계정이 연결되어 있을 때만 후원을 받습니다.', s.enabled);
  const [soundWrap, sound] = check('알림 소리', 'OBS 브라우저 소스에서 짧은 효과음을 냅니다.', s.sound);
  const [messageWrap, showMessage] = check('후원 메시지 보이기', '후원자가 쓴 메시지를 알림 아래에 보여 줍니다(저장하지 않음).', s.showMessage);
  f.append(enabledWrap);
  const templateWrap = el('label', '알림 문구 (60자까지)'), template = el('input');
  template.maxLength = 60; template.required = true; template.value = s.template; templateWrap.append(template);
  const preview = el('p', '', 'da-preview'); preview.setAttribute('aria-live', 'polite');
  const show = () => { preview.textContent = '미리 보기: ' + fillTemplate(template.value || '(문구 없음)', '봄이', 3000); };
  template.oninput = show; show();
  f.append(templateWrap, el('p', '{닉네임}은 후원자 이름, {금액}은 치즈 금액으로 바뀌어요.', 'field-help'), preview);
  const num = (title, value, min, max, step = 1) => { const wrap = el('label', title, 'cf-num'), input = el('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value); input.required = true; wrap.append(input); return [wrap, input]; };
  const [minWrap, minAmount] = num('최소 금액 (치즈)', s.minAmount, 1, 1000000), [durWrap, duration] = num('표시 시간 (초)', s.durationSeconds, 3, 20);
  const grid = el('div', undefined, 'cf-chance-grid lb-two'); grid.append(minWrap, durWrap);
  f.append(grid, soundWrap, messageWrap);
  const save = el('button', '설정 저장'); save.type = 'submit'; f.append(save);
  f.onsubmit = e => {
    e.preventDefault();
    run(async () => {
      await request('/api/donation-alert', { enabled: enabled.checked, minAmount: Number(minAmount.value), template: template.value, durationSeconds: Number(duration.value), sound: sound.checked, showMessage: showMessage.checked, revision: data.revision });
      await reload();
    });
  };
  p.append(f);

  // Test alert
  const t = el('form', undefined, 'intake-setting-card da-test'), nickWrap = el('label', '테스트 닉네임'), nick = el('input'), amtWrap = el('label', '치즈 금액'), amount = el('input'), msgWrap = el('label', '메시지 (선택)'), msg = el('input');
  nick.value = '테스트'; nick.maxLength = 20; amount.type = 'number'; amount.min = '1'; amount.max = '10000000'; amount.value = '1000'; amount.required = true; msg.maxLength = 100; msg.placeholder = '예) 오늘 방송도 화이팅!';
  nickWrap.append(nick); amtWrap.append(amount); msgWrap.append(msg);
  const go = el('button', '테스트 알림 보내기', 'secondary'); go.type = 'submit';
  const result = el('p', '', 'field-help'); result.setAttribute('role', 'status');
  t.append(el('h2', 'OBS 테스트'), el('p', '실제 치즈 없이 OBS 알림을 확인해요. 화면에 [테스트]로 표시되고 최소 금액과 상관없이 보낼 수 있어요.', 'field-help'), nickWrap, amtWrap, msgWrap, go, result);
  t.onsubmit = e => { e.preventDefault(); run(async () => { await request('/api/donation-alert/test', { nickname: nick.value, amount: Number(amount.value), ...(msg.value.trim() ? { message: msg.value } : {}) }); result.textContent = '테스트 알림을 보냈어요. OBS 화면을 확인해 주세요.'; }); };
  p.append(t);

  if (Array.isArray(data.recent) && data.recent.length) {
    const log = el('section', undefined, 'intake-setting-card'), wrap = el('div', undefined, 'cf-table'), table = el('table'), head = el('tr');
    for (const h of ['시간', '후원자', '금액']) head.append(el('th', h)); table.append(head);
    for (const a of data.recent) { const tr = el('tr'); tr.append(el('td', time(a.at)), el('td', (a.test ? '[테스트] ' : '') + a.nickname), el('td', won(a.amount) + '치즈')); table.append(tr); }
    wrap.append(table); log.append(el('h2', '최근 알림 (서버를 다시 시작하면 지워져요)'), wrap); p.append(log);
  }
}
