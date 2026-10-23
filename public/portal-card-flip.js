// 통합 운영 → 커뮤니티 → 시청자 보상 (카드 뒤집기 설정). The server checks every value again.
export const CARD_SYMBOLS = ['♛', '♪', '♥', '★', '☀', '◆', '♣', '●'];
const MAX_IMAGE = 1024 * 1024, TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const sources = { join: '시참 참가', cheese: '치즈 후원', direct: '직접 지급' };
const states = { disabled: ['치즈 기회 꺼짐', 'readiness-optional'], unavailable: ['준비 안 됨', 'readiness-optional'], not_connected: ['방송 계정 연결 필요', 'readiness-attention'], stopped: ['중지', 'readiness-optional'], connecting: ['연결 중', 'readiness-pending'], subscribing: ['구독 요청 중', 'readiness-pending'], subscribed: ['후원 구독 요청 완료', 'readiness-configured'], reconnecting: ['재연결 대기', 'readiness-attention'], auth_required: ['후원 조회 권한 동의 필요', 'readiness-attention'] };
const time = at => new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const value = String(reader.result || ''); resolve(value.slice(value.indexOf(',') + 1)); };
    reader.onerror = () => reject(Error('그림을 읽지 못했어요. 다른 파일로 다시 시도해 주세요.'));
    reader.readAsDataURL(file);
  });
}

export async function renderCardFlip({ p, el, button, run, request, scope, reload }) {
  let data = await request('/api/card-flip');
  const valid = d => d && Number.isSafeInteger(d.revision) && d.settings && Array.isArray(d.settings.cards) && Array.isArray(d.viewers);
  if (!valid(data)) throw Error('저장된 카드 뒤집기 설정을 확인하지 못했습니다. 다시 불러와 주세요.');
  const s = data.settings, st = data.status || {};
  const picture = (card, index, size) => {
    if (card.image?.file) { const img = el('img', undefined, 'cf-thumb'); img.alt = ''; img.width = img.height = size; img.src = `${scope}/api/card-flip/image/${encodeURIComponent(card.image.file)}`; return img; }
    const b = el('b', CARD_SYMBOLS[index % CARD_SYMBOLS.length], 'cf-symbol cf-s' + (index % CARD_SYMBOLS.length)); b.setAttribute('aria-hidden', 'true'); return b;
  };

  const [label, cls] = states[st.cheese] || ['상태 확인 필요', 'readiness-attention'], evidence = el('div', undefined, 'readiness-evidence');
  evidence.append(el('span', label, 'badge ' + cls), el('span', '실제 후원 수신 검증 대기', 'badge readiness-pending'));
  p.append(el('p', '시청자가 기회를 써서 카드를 뒤집고, 같은 카드가 먼저 모인 상품을 받습니다. 꽝은 없고, 카드 배치는 서버가 정해 시청자에게 미리 보여 주지 않습니다.', 'settings-guidance'), evidence);

  const f = el('form', undefined, 'form settings-form cf-form'), message = el('p', '', 'settings-feedback'); message.setAttribute('role', 'status');
  const toggle = (name, title, help, checked) => { const wrap = el('label', undefined, 'setting-toggle'), input = el('input'), text = el('span'); input.type = 'checkbox'; input.name = name; input.checked = checked; text.append(el('strong', title)); if (help) text.append(el('span', help, 'field-help')); wrap.append(input, text); return [wrap, input]; };
  const number = (labelText, value, min, max, step = 1) => { const wrap = el('label', labelText, 'cf-num'), input = el('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value); input.required = true; wrap.append(input); return [wrap, input]; };

  const [enabledWrap, enabled] = toggle('enabled', '카드 뒤집기 사용', '끄면 시청자는 새 판을 시작할 수 없습니다. 받은 상품은 그대로 남습니다.', s.enabled);
  const needWrap = el('label', '같은 카드 몇 장을 모으면 상품을 줄까요?'), need = el('select');
  for (const n of [2, 3]) need.append(new Option(n + '장', String(n), false, n === s.need));
  needWrap.append(need); f.append(enabledWrap, needWrap);

  f.append(el('h2', '카드와 상품'));
  const list = el('div', undefined, 'cf-cards'), rows = [];
  const add = el('button', '카드 추가', 'secondary'); add.type = 'button';
  const refreshButtons = () => { add.disabled = rows.length >= 8; for (const row of rows) row.remove.disabled = rows.length <= 2; };
  const cardRow = (card, index) => {
    const row = el('div', undefined, 'cf-card-row'), pic = el('div', undefined, 'cf-pic');
    pic.append(card ? picture(card, index, 48) : picture({}, index, 48));
    const tools = el('div', undefined, 'cf-pic-tools');
    if (card) {
      const upload = el('label', '그림 올리기', 'button secondary cf-upload'), file = el('input'); file.type = 'file'; file.accept = TYPES.join(','); file.className = 'cf-file';
      file.setAttribute('aria-label', `${card.reward} 카드 그림 올리기`); upload.append(file); tools.append(upload);
      file.onchange = () => { const chosen = file.files?.[0]; file.value = ''; if (!chosen) return; run(async () => {
        if (!TYPES.includes(chosen.type)) throw Error('PNG·JPG·WEBP 그림만 올릴 수 있어요.');
        if (chosen.size > MAX_IMAGE) throw Error('그림은 1MB까지 올릴 수 있어요.');
        await request('/api/card-flip/image', { cardId: card.id, type: chosen.type, data: await readBase64(chosen), revision: data.revision }); await reload();
      }); };
      if (card.image) tools.append(button('기본 그림', async () => { await request('/api/card-flip/image/remove', { cardId: card.id, revision: data.revision }); await reload(); }, 'secondary'));
    } else tools.append(el('span', '저장한 뒤 그림을 올릴 수 있어요.', 'field-help'));
    pic.append(tools);
    const rewardWrap = el('label', '상품 이름 (카드에 표시)'), reward = el('input'); reward.maxLength = 20; reward.required = true; reward.value = card?.reward || ''; reward.placeholder = '예) 신청곡 1곡'; rewardWrap.append(reward);
    const remove = el('button', '삭제', 'secondary cf-remove'); remove.type = 'button';
    const entry = { id: card?.id, reward, remove, row };
    remove.onclick = () => { if (rows.length <= 2) return; rows.splice(rows.indexOf(entry), 1); row.remove(); refreshButtons(); };
    row.append(pic, rewardWrap, remove); list.append(row); rows.push(entry);
  };
  s.cards.forEach(cardRow);
  add.onclick = () => { if (rows.length < 8) { cardRow(null, rows.length); refreshButtons(); } };
  refreshButtons();
  f.append(list, add, el('p', '카드는 2~8종, 상품 이름은 20자까지예요. 그림은 PNG·JPG·WEBP 1MB까지이고, 올리지 않으면 기본 그림을 씁니다. 카드나 장수를 바꾸면 진행 중인 판은 취소되고 기회가 돌아갑니다.', 'field-help'));

  f.append(el('h2', '기회 주는 방법'));
  const c = s.chances;
  const [joinWrap, joinOn] = toggle('join', '시참에 참가하면', '경기에 참가 확정된 Discord 참가자에게 회차마다 한 번 줍니다.', c.join.enabled);
  const [joinCountWrap, joinCount] = number('참가 1회당 기회', c.join.count, 1, 5);
  const [cheeseWrap, cheeseOn] = toggle('cheese', '치즈를 후원하면', '팔로워 인증으로 치지직 계정을 연결한 시청자만 받습니다. 연결하지 않은 후원자는 알 수 없어 지급되지 않습니다.', c.cheese.enabled);
  const [amountWrap, amount] = number('기준 금액 (치즈)', c.cheese.amount, 100, 1000000, 100);
  const [cheeseCountWrap, cheeseCount] = number('기준 금액마다 기회', c.cheese.count, 1, 5);
  const [dailyWrap, daily] = number('하루 최대 기회 (시참·후원)', c.dailyMax, 1, 20);
  const grid = el('div', undefined, 'cf-chance-grid'); grid.append(joinCountWrap, amountWrap, cheeseCountWrap, dailyWrap);
  f.append(joinWrap, cheeseWrap, grid, el('p', '예) 1,000치즈마다 1회라면 3,000치즈 후원 시 3회. 하루 최대를 넘으면 더 쌓이지 않습니다. 스트리머가 직접 주는 기회는 하루 최대와 상관없습니다.', 'field-help'));
  const save = el('button', '설정 저장'); save.type = 'submit'; f.append(save, message);
  f.onsubmit = e => {
    e.preventDefault();
    run(async () => {
      const body = { enabled: enabled.checked, need: Number(need.value), cards: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), reward: r.reward.value.trim() })),
        chances: { join: { enabled: joinOn.checked, count: Number(joinCount.value) }, cheese: { enabled: cheeseOn.checked, amount: Number(amount.value), count: Number(cheeseCount.value) }, dailyMax: Number(daily.value) }, revision: data.revision };
      if (body.cards.some(card => !card.reward)) throw Error('상품 이름을 모두 입력해 주세요.');
      await request('/api/card-flip', body); await reload();
    });
  };
  p.append(f);

  const grant = el('section', undefined, 'intake-setting-card cf-grant'); grant.append(el('h2', '기회 직접 주기'));
  if (!data.viewers.length) grant.append(el('p', '/연동으로 게임 정보를 등록한 시청자가 아직 없습니다.', 'muted'));
  else {
    const form = el('form', undefined, 'cf-grant-form'), whoWrap = el('label', '시청자'), who = el('select'), countWrap = el('label', '기회'), count = el('select');
    for (const v of data.viewers) who.append(new Option(v.name, v.userId));
    for (const n of [1, 2, 3, 5, 10]) count.append(new Option(n + '회', String(n)));
    whoWrap.append(who); countWrap.append(count);
    const go = el('button', '기회 주기'); go.type = 'submit'; form.append(whoWrap, countWrap, go);
    form.onsubmit = e => { e.preventDefault(); run(async () => { await request('/api/card-flip/grant', { userId: who.value, count: Number(count.value) }); await reload(); }); };
    grant.append(form);
  }
  if (data.grants.length) {
    const log = el('div', undefined, 'cf-table'), t = el('table'), head = el('tr');
    for (const h of ['시간', '시청자', '기회', '이유']) head.append(el('th', h)); t.append(head);
    for (const g of data.grants.slice(0, 10)) { const tr = el('tr'); tr.append(el('td', time(g.at)), el('td', g.name), el('td', '+' + g.count), el('td', g.source === 'cheese' ? `치즈 ${Number(g.amount || 0).toLocaleString('ko-KR')} 후원` : sources[g.source] || '')); t.append(tr); }
    log.append(t); grant.append(log);
  }
  p.append(grant);

  const req = el('section', undefined, 'intake-setting-card'); req.append(el('h2', '상품 사용 요청'));
  if (!data.requests.length) req.append(el('p', '처리할 상품이 없습니다.', 'muted'));
  else {
    const wrap = el('div', undefined, 'cf-table'), t = el('table'), head = el('tr');
    for (const h of ['시청자', '상품', '상태', '']) head.append(el('th', h)); t.append(head);
    for (const r of data.requests) {
      const tr = el('tr'), act = el('td');
      act.append(button('사용 완료', async () => { await request('/api/card-flip/reward', { userId: r.userId, rewardId: r.id }); await reload(); }, r.status === 'requested' ? '' : 'secondary'));
      tr.append(el('td', r.name), el('td', r.reward), el('td', r.status === 'requested' ? '사용 요청' : '받음'), act); t.append(tr);
    }
    wrap.append(t); req.append(wrap);
  }
  p.append(req);
}
