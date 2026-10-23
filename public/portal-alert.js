// 방송 → OBS → OBS 후원 알림. The server checks every value and every uploaded file again.
const states = { unavailable: ['준비 안 됨', 'readiness-optional'], not_connected: ['방송 계정 연결 필요', 'readiness-attention'], disabled: ['사용 안 함', 'readiness-optional'], stopped: ['중지', 'readiness-optional'], connecting: ['연결 중', 'readiness-pending'], subscribing: ['구독 요청 중', 'readiness-pending'], subscribed: ['후원 구독 요청 완료', 'readiness-configured'], reconnecting: ['재연결 대기', 'readiness-attention'], auth_required: ['후원 조회 권한 동의 필요', 'readiness-attention'] };
const time = at => new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const won = n => Number(n).toLocaleString('ko-KR');
const MAX_FILE = 2 * 1024 * 1024, MAX_TIERS = 5;
const ACCEPT = { image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], audio: ['audio/mpeg', 'audio/ogg', 'audio/wav'] };
/** Same rendering as the OBS page: {닉네임} and {금액} are filled in, everything else is plain text. */
export const fillTemplate = (template, nickname, amount) => String(template).replaceAll('{닉네임}', nickname).replaceAll('{금액}', won(amount));
const readBase64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(Error('파일을 읽지 못했어요.')); reader.readAsDataURL(file); });
// Browsers report some WAV files as audio/x-wav or audio/wave.
const fileType = file => ({ 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav', 'audio/mp3': 'audio/mpeg' })[file.type] || file.type;

export async function renderDonationAlert({ p, el, button, run, request, scope = '', reload }) {
  const data = await request('/api/donation-alert');
  if (!data || !Number.isSafeInteger(data.revision) || !data.settings || !Array.isArray(data.settings.tiers)) throw Error('저장된 후원 알림 설정을 확인하지 못했습니다. 다시 불러와 주세요.');
  const s = data.settings, st = data.status || {};
  const [label, cls] = states[st.state] || ['상태 확인 필요', 'readiness-attention'], evidence = el('div', undefined, 'readiness-evidence');
  evidence.append(el('span', label, 'badge ' + cls), el('span', '실제 후원 수신 검증 대기', 'badge readiness-pending'));
  p.append(el('p', '치즈 후원이 들어오면 OBS 화면에 알림이 뜹니다. 금액 구간마다 문구·그림·소리를 다르게 정할 수 있어요. 후원 메시지는 화면에 잠깐 보여 주기만 하고 저장하지 않아요.', 'settings-guidance'), evidence);

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
  const [soundWrap, sound] = check('알림 소리', '구간에 올린 소리를 내고, 없으면 짧은 기본 효과음을 냅니다.', s.sound);
  const [messageWrap, showMessage] = check('후원 메시지 보이기', '후원자가 쓴 메시지를 알림 아래에 보여 줍니다(저장하지 않음).', s.showMessage);
  const num = (title, value, min, max) => { const wrap = el('label', title, 'cf-num'), input = el('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = '1'; input.value = String(value); input.required = true; wrap.append(input); return [wrap, input]; };
  const [durWrap, duration] = num('표시 시간 (초)', s.durationSeconds, 3, 20);
  f.append(enabledWrap, durWrap, soundWrap, messageWrap);

  // Tiers: the alert uses the highest minimum not above the donation. Below the first one, no alert.
  f.append(el('h2', '금액 구간'), el('p', '후원 금액에 맞는 가장 높은 구간의 문구·그림·소리를 씁니다. 첫 구간보다 적은 후원은 알림이 뜨지 않아요. {닉네임}은 후원자 이름, {금액}은 치즈 금액으로 바뀌어요.', 'field-help'));
  const list = el('div', undefined, 'da-tiers'), rows = [];
  const preview = (tier, kind) => {
    const media = tier?.[kind];
    if (!media?.file) return el('span', kind === 'image' ? '기본 치즈 그림' : '기본 효과음', 'muted');
    const src = `${scope}/api/donation-alert/media/${encodeURIComponent(media.file)}`;
    if (kind === 'image') { const img = el('img', undefined, 'da-thumb'); img.alt = '올린 알림 그림'; img.src = src; img.width = img.height = 56; return img; }
    const audio = el('audio'); audio.controls = true; audio.preload = 'none'; audio.src = src; audio.setAttribute('aria-label', '올린 알림 소리'); return audio;
  };
  const upload = (tier, kind) => {
    const box = el('div', undefined, 'da-media'), picker = el('input');
    picker.type = 'file'; picker.accept = ACCEPT[kind].join(','); picker.hidden = true;
    picker.onchange = () => {
      const file = picker.files?.[0]; picker.value = '';
      if (!file) return;
      run(async () => {
        const type = fileType(file);
        if (!ACCEPT[kind].includes(type)) throw Error(kind === 'image' ? 'PNG·JPG·WEBP·GIF 그림만 올릴 수 있어요.' : 'MP3·OGG·WAV 소리만 올릴 수 있어요.');
        if (file.size > MAX_FILE) throw Error('파일은 2MB까지 올릴 수 있어요.');
        await request('/api/donation-alert/media', { tierId: tier.id, kind, type, data: await readBase64(file), revision: data.revision });
        await reload();
      });
    };
    box.append(preview(tier, kind), picker, button(kind === 'image' ? '그림 올리기' : '소리 올리기', async () => { picker.click(); }, 'secondary'));
    if (tier[kind]) box.append(button('기본으로', async () => { await request('/api/donation-alert/media/remove', { tierId: tier.id, kind, revision: data.revision }); await reload(); }, 'secondary'));
    return box;
  };
  const addRow = tier => {
    const row = el('fieldset', undefined, 'da-tier'), legend = el('legend', tier ? `${won(tier.minAmount)}치즈부터` : '새 구간');
    const [minWrap, minAmount] = num('최소 금액 (치즈)', tier?.minAmount ?? 10000, 1, 1000000);
    const tWrap = el('label', '알림 문구 (60자까지)'), template = el('input'); template.maxLength = 60; template.required = true; template.value = tier?.template ?? '{닉네임}님 {금액}치즈! 정말 고마워요!'; tWrap.append(template);
    const view = el('p', '', 'da-preview'), show = () => { view.textContent = '미리 보기: ' + fillTemplate(template.value || '(문구 없음)', '봄이', Number(minAmount.value) || 0); };
    template.oninput = show; minAmount.oninput = show; show();
    row.append(legend, minWrap, tWrap, view);
    if (tier) row.append(upload(tier, 'image'), upload(tier, 'audio'));
    else row.append(el('p', '설정을 저장한 뒤 그림과 소리를 올릴 수 있어요.', 'field-help'));
    const item = { id: tier?.id, minAmount, template, row };
    const remove = button('구간 빼기', async () => { if (rows.length <= 1) throw Error('구간은 하나 이상 있어야 해요.'); rows.splice(rows.indexOf(item), 1); row.remove(); }, 'secondary');
    row.append(remove); rows.push(item); list.append(row);
  };
  for (const tier of s.tiers) addRow(tier);
  const add = button('구간 추가', async () => { if (rows.length >= MAX_TIERS) throw Error(`구간은 ${MAX_TIERS}개까지예요.`); addRow(null); }, 'secondary');
  f.append(list, add);
  const save = el('button', '설정 저장'); save.type = 'submit'; f.append(save);
  f.onsubmit = e => {
    e.preventDefault();
    run(async () => {
      await request('/api/donation-alert', { enabled: enabled.checked, durationSeconds: Number(duration.value), sound: sound.checked, showMessage: showMessage.checked, revision: data.revision,
        tiers: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), minAmount: Number(r.minAmount.value), template: r.template.value })) });
      await reload();
    });
  };
  p.append(f);

  // Test alert
  const t = el('form', undefined, 'intake-setting-card da-test'), nickWrap = el('label', '테스트 닉네임'), nick = el('input'), amtWrap = el('label', '치즈 금액'), amount = el('input'), msgWrap = el('label', '메시지 (선택)'), msg = el('input');
  nick.value = '테스트'; nick.maxLength = 20; amount.type = 'number'; amount.min = '1'; amount.max = '10000000'; amount.value = String(s.tiers[0]?.minAmount || 1000); amount.required = true; msg.maxLength = 100; msg.placeholder = '예) 오늘 방송도 화이팅!';
  nickWrap.append(nick); amtWrap.append(amount); msgWrap.append(msg);
  const go = el('button', '테스트 알림 보내기', 'secondary'); go.type = 'submit';
  const result = el('p', '', 'field-help'); result.setAttribute('role', 'status');
  t.append(el('h2', 'OBS 테스트'), el('p', '실제 치즈 없이 OBS 알림을 확인해요. 화면에 [테스트]로 표시되고, 금액에 맞는 구간으로 보여 줘요(첫 구간보다 적으면 첫 구간).', 'field-help'), nickWrap, amtWrap, msgWrap, go, result);
  t.onsubmit = e => { e.preventDefault(); run(async () => { await request('/api/donation-alert/test', { nickname: nick.value, amount: Number(amount.value), ...(msg.value.trim() ? { message: msg.value } : {}) }); result.textContent = '테스트 알림을 보냈어요. OBS 화면을 확인해 주세요.'; }); };
  p.append(t);

  if (Array.isArray(data.recent) && data.recent.length) {
    const log = el('section', undefined, 'intake-setting-card'), wrap = el('div', undefined, 'cf-table'), table = el('table'), head = el('tr');
    for (const h of ['시간', '후원자', '금액']) head.append(el('th', h)); table.append(head);
    for (const a of data.recent) { const tr = el('tr'); tr.append(el('td', time(a.at)), el('td', (a.test ? '[테스트] ' : '') + a.nickname), el('td', won(a.amount) + '치즈')); table.append(tr); }
    wrap.append(table); log.append(el('h2', '최근 알림 (서버를 다시 시작하면 지워져요)'), wrap); p.append(log);
  }
}
