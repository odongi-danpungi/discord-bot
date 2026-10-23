// 방송 → 룰렛 → 뽑기판. The streamer never sees the hidden layout; the server checks every value again.
const states = { unavailable: ['준비 안 됨', 'readiness-optional'], not_connected: ['방송 계정 연결 필요', 'readiness-attention'], disabled: ['사용 안 함', 'readiness-optional'], stopped: ['중지', 'readiness-optional'], connecting: ['연결 중', 'readiness-pending'], subscribing: ['구독 요청 중', 'readiness-pending'], subscribed: ['후원 구독 요청 완료', 'readiness-configured'], reconnecting: ['재연결 대기', 'readiness-attention'], auth_required: ['후원 조회 권한 동의 필요', 'readiness-attention'] };
const time = at => new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function renderLotteryBoard({ p, el, button, run, request, reload }) {
  const data = await request('/api/lottery-board');
  if (!data || !Number.isSafeInteger(data.revision) || !data.settings || !Array.isArray(data.settings.prizes) || !Array.isArray(data.pending)) throw Error('저장된 뽑기판 설정을 확인하지 못했습니다. 다시 불러와 주세요.');
  const s = data.settings, st = data.status || {}, board = data.board;
  const [label, cls] = states[st.state] || ['상태 확인 필요', 'readiness-attention'], evidence = el('div', undefined, 'readiness-evidence');
  evidence.append(el('span', label, 'badge ' + cls), el('span', '실제 후원 수신 검증 대기', 'badge readiness-pending'));
  p.append(el('p', '시청자가 치즈를 후원하며 메시지에 번호를 적으면(예: 11 23) 그 칸이 열립니다. 배치는 서버가 무작위로 정하고 스트리머 화면에도 보이지 않습니다. 열 수 없는 번호는 보류 기회로 남아 스트리머가 대신 열어 줄 수 있어요.', 'settings-guidance'), evidence);

  // OBS address (browser source, transparent background)
  try {
    const obs = await request('/obs');
    if (typeof obs?.lotteryBoardUrl === 'string' && obs.lotteryBoardUrl.startsWith('http')) {
      const box = el('section', undefined, 'intake-setting-card'), wrap = el('label', 'OBS 브라우저 소스 주소 (투명 배경 · 권장 620×720)'), url = el('input');
      url.readOnly = true; url.value = obs.lotteryBoardUrl; wrap.append(url);
      box.append(el('h2', 'OBS에 뽑기판 띄우기'), wrap, button('주소 복사', async () => { await navigator.clipboard.writeText(obs.lotteryBoardUrl); }, 'secondary'), el('p', '주소에는 방송 화면 토큰이 들어 있어요. 다른 사람에게 보여 주지 마세요.', 'field-help'));
      p.append(box);
    }
  } catch { /* The board still works without the address box. */ }
  // Current board
  const now = el('section', undefined, 'intake-setting-card lb-board');
  now.append(el('h2', '지금 뽑기판'));
  if (!board) now.append(el('p', '아직 뽑기판이 없어요. 상품을 저장한 뒤 새 뽑기판을 만들어 주세요.', 'muted'));
  else {
    const left = board.prizes.map(prize => `${prize.rank}${prize.name ? ' ' + prize.name : ''} ${prize.left}/${prize.count}`).join(' · ');
    now.append(el('p', `${board.opened.length}/100칸 열림 · 남은 상품: ${left || '없음'} · 꽝 ${board.miss.left}/${board.miss.count}`, 'muted'));
    const grid = el('div', undefined, 'lb-grid'), opened = new Map(board.opened.map(o => [o.n, o]));
    for (let n = 1; n <= 100; n++) {
      const o = opened.get(n), cell = el('span', o ? (o.rank === '꽝' ? '꽝' : o.rank) : String(n), 'lb-cell' + (o ? (o.place ? ' prize lb-place' + Math.min(o.place, 4) : ' miss') : ''));
      cell.title = o ? `${n}번 · ${o.rank}${o.name ? ' ' + o.name : ''} · ${o.nickname}` : `${n}번`; grid.append(cell);
    }
    now.append(grid);
  }
  const create = button(board ? '새 뽑기판 만들기' : '뽑기판 만들기', async () => {
    if (board && board.opened.length && !confirm('지금 뽑기판을 끝내고 새 배치로 시작할까요? 열린 기록은 최근 기록에 남아요.')) return;
    await request('/api/lottery-board/new', { revision: data.revision }); await reload();
  });
  now.append(create); p.append(now);

  // Saved chances
  const pend = el('section', undefined, 'intake-setting-card');
  pend.append(el('h2', '보류 기회 (스트리머가 대신 열기)'));
  if (!data.pending.length) pend.append(el('p', '보류된 기회가 없어요.', 'muted'));
  for (const item of data.pending) {
    const row = el('form', undefined, 'lb-pending');
    row.append(el('span', `${item.nickname} · ${item.count}개 · ${item.reason} · ${time(item.at)}`, 'lb-pending-text'));
    const wrap = el('label', '번호'), input = el('input'); input.type = 'number'; input.min = '1'; input.max = '100'; input.required = true; input.setAttribute('aria-label', `${item.nickname}님 기회로 열 번호`); wrap.append(input);
    const open = el('button', '열기'); open.type = 'submit';
    row.append(wrap, open, button('지우기', async () => { if (!confirm(`${item.nickname}님의 보류 기회를 지울까요?`)) return; await request('/api/lottery-board/pending/remove', { pendingId: item.id }); await reload(); }, 'secondary'));
    row.onsubmit = e => { e.preventDefault(); run(async () => { await request('/api/lottery-board/open', { pendingId: item.id, number: Number(input.value) }); await reload(); }); };
    pend.append(row);
  }
  p.append(pend);

  // Settings
  const f = el('form', undefined, 'form settings-form lb-form');
  f.append(el('h2', '뽑기판 설정'));
  const toggle = el('label', undefined, 'setting-toggle'), enabled = el('input'), text = el('span'); enabled.type = 'checkbox'; enabled.checked = s.enabled;
  text.append(el('strong', '뽑기판 사용'), el('span', '방송 계정이 연결되어 있을 때만 후원을 받습니다.', 'field-help')); toggle.append(enabled, text); f.append(toggle);
  const num = (title, value, min, max, step = 1) => { const wrap = el('label', title, 'cf-num'), input = el('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value); input.required = true; wrap.append(input); return [wrap, input]; };
  const [amountWrap, amount] = num('번호 1개당 금액 (치즈)', s.amount, 100, 1000000, 100), [perWrap, per] = num('후원 1건 최대 번호 수', s.perDonation, 1, 20);
  const grid = el('div', undefined, 'cf-chance-grid lb-two'); grid.append(amountWrap, perWrap); f.append(grid);
  f.append(el('p', '예) 1,000치즈마다 1개라면 3,000치즈 후원에 메시지 "11 23 45"로 세 칸이 열려요. 금액보다 번호가 많으면 앞에서부터 금액만큼만 열고, 모자라거나 열 수 없는 번호는 보류 기회로 남아요.', 'field-help'));
  f.append(el('h2', '등수와 상품'));
  // Ranks follow the order: the streamer picks how many ranks and how many of each. 1·2·3등 = 금·은·동.
  const list = el('div', undefined, 'lb-prizes'), rows = [], sum = el('p', '', 'field-help');
  const countWrap = el('label', '등수 개수'), rankCount = el('select');
  for (let n = 1; n <= 10; n++) rankCount.append(new Option(`${n}개 등수 (1등~${n}등)`, String(n), false, n === s.prizes.length));
  countWrap.append(rankCount); f.append(countWrap);
  const update = () => { const total = rows.reduce((t, r) => t + (Number(r.count.value) || 0), 0); sum.textContent = `상품 ${total}개 · 꽝 ${Math.max(0, 100 - total)}개${total > 100 ? ' · 100개를 넘을 수 없어요' : ''}`; };
  const prizeRow = (prize, index) => {
    const row = el('div', undefined, 'lb-prize-row'), medal = el('span', `${index + 1}등`, 'lb-medal lb-place' + Math.min(index + 1, 4));
    const nameWrap = el('label', '상품 이름'), name = el('input'); name.maxLength = 20; name.value = prize?.name || ''; name.placeholder = '예) 신청곡 1곡'; nameWrap.append(name);
    const numWrap = el('label', `${index + 1}등 개수`), count = el('input'); count.type = 'number'; count.min = '1'; count.max = '100'; count.required = true; count.value = String(prize?.count || 1); count.oninput = update; numWrap.append(count);
    row.append(medal, nameWrap, numWrap); rows.push({ id: prize?.id, name, count, row }); list.append(row);
  };
  const kept = [...s.prizes];
  const setRanks = n => {
    while (rows.length > n) { const r = rows.pop(); r.row.remove(); }
    while (rows.length < n) prizeRow(kept[rows.length] || null, rows.length);
    update();
  };
  rankCount.onchange = () => setRanks(Number(rankCount.value));
  setRanks(s.prizes.length);
  f.append(list, sum, el('p', '1등은 금, 2등은 은, 3등은 동으로 OBS에 표시돼요. 바꾼 상품은 다음에 만드는 뽑기판부터 적용돼요. 지금 뽑기판은 그대로예요.', 'field-help'));
  const save = el('button', '설정 저장'); save.type = 'submit'; f.append(save);
  f.onsubmit = e => {
    e.preventDefault();
    run(async () => {
      const body = { enabled: enabled.checked, amount: Number(amount.value), perDonation: Number(per.value), revision: data.revision,
        prizes: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), name: r.name.value.trim(), count: Number(r.count.value) })) };
      await request('/api/lottery-board', body); await reload();
    });
  };
  p.append(f);

  if (data.log.length) {
    const log = el('section', undefined, 'intake-setting-card'), wrap = el('div', undefined, 'cf-table'), t = el('table'), head = el('tr');
    for (const h of ['시간', '번호', '후원자', '결과']) head.append(el('th', h)); t.append(head);
    for (const l of data.log) { const tr = el('tr'); tr.append(el('td', time(l.at)), el('td', l.n + '번'), el('td', l.nickname), el('td', l.rank === '꽝' ? '꽝' : `${l.rank} ${l.name}`.trim())); t.append(tr); }
    wrap.append(t); log.append(el('h2', '최근 열린 번호'), wrap); p.append(log);
  }
}
