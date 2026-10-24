// Viewer reward "카드 뒤집기". The server holds the deck; this page only animates what the server reveals.
const SYMBOLS = ['♛', '♪', '♥', '★', '☀', '◆', '♣', '●'];
const IMAGE_BASE = '/viewer/api/card-flip/image/';
const FLIP_MS = 600, SHUFFLE_MS = 3700, FLY_MS = 420;

const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
/** Columns (4–7, or 3–4 on a phone) that leave the fewest empty places on the last row. */
export function cardColumns(total, narrow = false) {
  const options = narrow ? [3, 4] : [4, 5, 6, 7], middle = narrow ? 3.5 : 5.5;
  let best = options[0], waste = 99;
  for (const c of options) { const w = Math.ceil(total / c) * c - total; if (w < waste || (w === waste && Math.abs(c - middle) < Math.abs(best - middle))) { best = c; waste = w; } }
  return best;
}

let audio = null, muted = false;
function sound(kind) {
  if (muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const ac = audio, t0 = ac.currentTime; if (ac.state === 'suspended') ac.resume();
    const burst = (at, len, filter, freq, vol, shape = 8) => {
      const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * len)), ac.sampleRate), d = buf.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * Math.exp(-j / d.length * shape);
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = buf; f.type = filter; f.frequency.value = freq; f.Q.value = 0.8; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(ac.destination); src.start(at);
    };
    const tone = (at, freq, len, vol) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = freq; g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + len); o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at + len + 0.02); };
    if (kind === 'tap') burst(t0, 0.06, 'lowpass', 1200, 0.08);
    else if (kind === 'riffle') for (let q = 0; q < 38; q++) burst(t0 + q * 0.022 + Math.random() * 0.006, 0.02, 'bandpass', 2400 + Math.random() * 1200, 0.045 * (1 - q / 50), 6);
    else if (kind === 'bridge') for (let q = 0; q < 30; q++) burst(t0 + q * 0.018 + Math.random() * 0.004, 0.018, 'bandpass', 1800 + Math.random() * 900, 0.04 * (1 - q / 40), 7);
    else if (kind === 'spread') { for (let q = 0; q < 16; q++) burst(t0 + q * 0.02, 0.03, 'bandpass', 3000 + q * 120, 0.03, 5); }
    else if (kind === 'chak') burst(t0, 0.05, 'bandpass', 2200, 0.1, 10);
    else if (kind === 'flip') { burst(t0, 0.07, 'bandpass', 3200, 0.12, 7); burst(t0 + 0.06, 0.05, 'lowpass', 900, 0.08, 9); }
    else if (kind === 'pair') [523, 659].forEach((f, j) => tone(t0 + j * 0.09, f, 0.22, 0.035));
    else if (kind === 'win') [523, 659, 784, 1047].forEach((f, j) => tone(t0 + j * 0.1, f, j === 3 ? 0.6 : 0.25, 0.04));
  } catch { /* Sound is optional. */ }
}

export function mountViewerCardFlip({ api, host }) {
  if (!host || host.dataset.mounted) return; host.dataset.mounted = '1';
  let state = null, busy = false, animating = false, loadVersion = 0, fresh = true;
  const status = node('p', '', 'cf-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');

  const card = id => state.cards.find(c => c.id === id), cardIndex = id => state.cards.findIndex(c => c.id === id);
  const picture = (c, size) => {
    if (c?.image) { const img = node('img'); img.alt = ''; img.width = img.height = size; img.src = IMAGE_BASE + encodeURIComponent(c.image); return img; }
    const i = Math.max(0, state.cards.indexOf(c)); const b = node('b', SYMBOLS[i % SYMBOLS.length], 'cf-symbol cf-s' + (i % SYMBOLS.length)); b.setAttribute('aria-hidden', 'true'); return b;
  };
  const face = id => { const c = card(id), wrap = document.createDocumentFragment(); wrap.append(picture(c, 36), node('span', c?.reward || '상품')); return wrap; };
  const say = text => { status.textContent = text; };
  const statusText = () => {
    const g = state.game;
    if (!g) return `카드 ${state.cards.length * state.need}장 · 꽝 없이 같은 카드 ${state.need}장이 모일 때까지 뒤집어요`;
    if (g.done) return `「${card(g.win)?.reward || '상품'}」 ${g.need}장 완성! 상품을 받았어요`;
    const counts = {}; for (const o of g.open) counts[o.card] = (counts[o.card] || 0) + 1;
    const best = Math.max(0, ...Object.values(counts));
    return `뒤집은 카드 ${g.open.length}장 · 같은 카드 ${g.need}장을 모으면 끝나요${best === g.need - 1 && g.need === 3 ? ' · 하나만 더!' : ''}`;
  };

  async function act(fn) {
    if (busy || animating) return; busy = true;
    try { await fn(); } catch (e) { say(e.message || '처리하지 못했어요. 다시 시도해 주세요.'); } finally { busy = false; renderButtons(); }
  }

  function render() {
    host.replaceChildren();
    if (!state) return;
    const head = node('div', undefined, 'cf-head'), title = node('div');
    title.append(node('p', 'VIEWER REWARD', 'eyebrow'), node('h2', `카드 뒤집기 · 같은 카드 ${state.need}장 모으기`));
    const tools = node('div', undefined, 'cf-tools'), mute = node('button', muted ? '소리 꺼짐' : '소리 켜짐', 'secondary compact');
    mute.type = 'button'; mute.setAttribute('aria-pressed', String(!muted)); mute.onclick = () => { muted = !muted; mute.textContent = muted ? '소리 꺼짐' : '소리 켜짐'; mute.setAttribute('aria-pressed', String(!muted)); };
    tools.append(mute, node('span', `남은 기회 ${state.chances}회`, 'cf-chip'));
    head.append(title, tools);
    const layout = node('div', undefined, 'cf-layout'), main = node('div', undefined, 'cf-main'), side = node('aside', undefined, 'cf-side');
    main.append(table(), status, node('div', undefined, 'cf-buttons'));
    side.append(prizes(), ways(), rewards());
    layout.append(main, side); host.append(head, layout);
    say(state.enabled ? statusText() : '지금은 카드 뒤집기를 쉬고 있어요.');
    renderButtons();
  }

  function table() {
    const felt = node('div', undefined, 'cf-felt'); felt.append(node('div', 'DANG DANG · CARD MATCH', 'cf-felt-title'));
    const g = state.game, total = g ? g.total : state.cards.length * state.need, cols = cardColumns(total, window.matchMedia?.('(max-width: 500px)').matches);
    // A finished game from an earlier visit starts again from the deck in the middle.
    if (!g || (g.done && fresh)) {
      const wrap = node('div', undefined, 'cf-deckwrap'), deck = node('div', undefined, 'cf-deck');
      wrap.style.minHeight = `${Math.ceil(total / cols) * 114 - 10}px`;
      for (let k = 0; k < 6; k++) { const s = node('span'); s.style.setProperty('--k', String(k)); deck.append(s); }
      deck.setAttribute('aria-label', `카드 ${total}장이 모여 있어요`); deck.setAttribute('role', 'img');
      wrap.append(deck, node('div', `카드 ${total}장`, 'cf-deck-count')); felt.append(wrap); return felt;
    }
    const grid = node('div', undefined, 'cf-grid'); grid.style.setProperty('--cols', String(cols));
    const opened = new Map(g.open.map(o => [o.index, o.card]));
    for (let i = 0; i < total; i++) {
      const b = node('button', undefined, 'cf-card'), inner = node('span', undefined, 'cf-in'), back = node('span', undefined, 'cf-back'), front = node('span', undefined, 'cf-front');
      b.type = 'button'; b.dataset.index = String(i); b.setAttribute('aria-label', `카드 ${i + 1}`);
      if (opened.has(i)) { b.classList.add('up'); front.append(face(opened.get(i))); b.setAttribute('aria-label', `카드 ${i + 1} · ${card(opened.get(i))?.reward || ''}`); }
      if (g.done) { b.disabled = true; if (opened.get(i) === g.win) b.classList.add('win'); else b.classList.add('dim'); }
      inner.append(back, front); b.append(inner); b.onclick = () => flip(i, b); grid.append(b);
    }
    felt.append(grid); return felt;
  }

  function prizes() {
    const box = node('section', undefined, 'cf-box'); box.append(node('h3', `상품 · 같은 카드 ${state.need}장 모으면`));
    const list = node('ul', undefined, 'cf-prizes');
    for (const c of state.cards) { const li = node('li'); li.append(picture(c, 28), node('span', c.reward)); list.append(li); }
    box.append(list); return box;
  }
  function ways() {
    const box = node('section', undefined, 'cf-box'), list = node('ul', undefined, 'cf-ways'), w = state.ways;
    box.append(node('h3', '기회 얻는 법'));
    if (w.join) list.append(node('li', `시참 참가 · 참가할 때마다 ${w.join}회`));
    if (w.cheese) list.append(node('li', `치즈 후원 · ${w.cheese.amount.toLocaleString('ko-KR')}치즈마다 ${w.cheese.count}회 (팔로워 인증으로 치지직 계정 연결 필요)`));
    list.append(node('li', '스트리머 선물 · 스트리머가 직접 줄 수 있어요'), node('li', `하루 최대 · 시참·후원으로 ${state.dailyMax}회까지 (오늘 ${state.earnedToday}회 받음)`));
    box.append(list); return box;
  }
  function rewards() {
    const box = node('section', undefined, 'cf-box'); box.append(node('h3', '내 보상'));
    if (!state.rewards.length) { box.append(node('p', '아직 받은 상품이 없어요.', 'cf-muted')); return box; }
    const list = node('ul', undefined, 'cf-rewards');
    for (const r of state.rewards.slice(0, 10)) {
      const li = node('li'); li.append(node('span', r.reward));
      if (r.status === 'ready') { const b = node('button', '사용 요청', 'secondary compact'); b.type = 'button'; b.onclick = () => act(async () => { state = await api('card-flip/use', { rewardId: r.id }); render(); say('스트리머에게 사용을 요청했어요.'); }); li.append(b); }
      else li.append(node('span', r.status === 'requested' ? '요청함' : '사용 완료', 'cf-tag'));
      list.append(li);
    }
    box.append(list); return box;
  }

  function renderButtons() {
    const row = host.querySelector('.cf-buttons'); if (!row || !state) return;
    row.replaceChildren();
    const g = state.game, playing = g && !g.done;
    if (!playing) {
      const b = node('button', g?.done ? '한 판 더 (기회 1회)' : '새 판 받기 (기회 1회)'); b.type = 'button';
      b.disabled = busy || animating || !state.enabled || state.chances <= 0;
      b.onclick = () => act(async () => { state = await api('card-flip/new', {}); fresh = false; render(); await deal(); });
      row.append(b);
      if (state.enabled && state.chances <= 0) row.append(node('p', '남은 기회가 없어요. 기회 얻는 법을 확인해 주세요.', 'cf-muted'));
    }
  }

  async function flip(index, button) {
    const g = state?.game;
    if (!g || g.done || busy || animating || g.open.some(o => o.index === index)) return;
    await act(async () => {
      const next = await api('card-flip/flip', { gameId: g.id, index });
      const opened = next.game?.open.find(o => o.index === index);
      if (!opened) { state = next; render(); return; }
      animating = true;
      try {
        const front = button.querySelector('.cf-front'); front.replaceChildren(face(opened.card));
        setTimeout(() => sound('flip'), FLIP_MS * 0.4);
        button.classList.add('flipping');
        await new Promise(r => setTimeout(r, FLIP_MS));
        const inner = button.querySelector('.cf-in'); inner.style.transition = 'none'; button.classList.remove('flipping'); button.classList.add('up'); void inner.offsetWidth; inner.style.transition = '';
      } finally { animating = false; }
      state = next;
      const same = next.game.open.filter(o => o.card === opened.card);
      if (next.game.done) { sound('win'); setTimeout(render, 700); say(statusText()); }
      else { if (same.length > 1) { sound('pair'); for (const o of same) host.querySelector(`[data-index="${o.index}"]`)?.classList.add('pair'); } say(statusText()); }
      host.querySelector('.cf-chip').textContent = `남은 기회 ${state.chances}회`;
    });
  }

  /**
   * Riffle shuffle with a bridge, a fan flourish, then each card is thrown to its place:
   * split into two halves → riffle into a V → bend into an arch (bridge) and let the cards cascade →
   * square up → spread a fan and close it → deal.
   */
  async function deal() {
    const grid = host.querySelector('.cf-grid');
    if (!grid || !grid.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const cards = [...grid.querySelectorAll('.cf-card')], g = grid.getBoundingClientRect(), cx = g.left + g.width / 2, cy = g.top + g.height / 2, n = cards.length, half = Math.ceil(n / 2), gap = Math.min(150, 2400 / n);
    const spread = Math.min(70, g.width * 0.18), fanR = Math.min(110, g.width * 0.28);
    animating = true; say('카드를 섞는 중…'); renderButtons();
    setTimeout(() => sound('tap'), 300); setTimeout(() => sound('riffle'), 380); setTimeout(() => sound('bridge'), 1720); setTimeout(() => sound('tap'), 2360);
    setTimeout(() => { sound('spread'); say('카드를 펼치는 중…'); }, 2460); setTimeout(() => sound('tap'), 3560);
    const done = cards.map((el, i) => new Promise(resolve => {
      const r = el.getBoundingClientRect(), dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2), left = i < half, k = left ? i : i - half, order = left ? 2 * k : 2 * k + 1, sd = left ? -1 : 1;
      const at = (x, y, rot, scale = 1) => `translate(${(dx + x).toFixed(1)}px,${(dy + y).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${scale})`;
      const home = at(0, -order * 0.35, 0), lift = -k * 0.4;
      // 1. Split: two halves to the sides.
      const halfPos = at(sd * spread, lift, sd * 4);
      // 2. Riffle: the cards drop alternately into a V in the middle.
      const vPos = at(sd * 16, -order * 0.35, -sd * 8), drop = 360 + 800 * order / n;
      // 3. Bridge: both halves bend up into an arch, then cascade down into one deck.
      const arch = at(sd * 10, -26 - order * 0.35 - (1 - Math.abs(order / Math.max(1, n - 1) - 0.5) * 2) * 6, sd * 16, 1.02), fall = 1720 + 540 * order / n;
      // 4. Flourish: spread a fan, hold it, and close it again.
      const a = n > 1 ? -55 + 110 * order / (n - 1) : 0, rad = a * Math.PI / 180;
      const fan = at(Math.sin(rad) * fanR, -Math.cos(rad) * fanR * 0.45 + fanR * 0.2, a, 1.04), open = 2460 + 300 * order / n;
      const frames = [[0, home], [300, halfPos], [drop, halfPos], [drop + 80, vPos], [1260, vPos], [1600, arch], [fall, arch], [fall + 90, home],
        [2360, home], [2400, at(0, -6 - order * 0.35, 0)], [2460, home], [open, home], [open + 260, fan], [3260, fan], [3520, home], [SHUFFLE_MS, home]];
      el.style.zIndex = String(order + 1);
      // Keyframe offsets must never go backwards.
      for (let f = 1; f < frames.length; f++) frames[f][0] = Math.max(frames[f][0], frames[f - 1][0]);
      const a1 = el.animate(frames.map(([t, transform]) => ({ transform, offset: Math.min(1, t / SHUFFLE_MS) })), { duration: SHUFFLE_MS, easing: 'ease-in-out', fill: 'both' });
      a1.finished.then(() => {
        if (i === 0) say('카드를 나눠 주는 중…');
        el.style.zIndex = String(200 + i);
        const spin = (i % 2 ? -1 : 1) * (160 + (i % 3) * 40);
        const a2 = el.animate([{ transform: home }, { transform: `translate(${(dx * 0.4).toFixed(1)}px,${(dy * 0.4 - 22).toFixed(1)}px) rotate(${spin * 0.6}deg) scale(1.08)`, offset: 0.5 }, { transform: 'translate(0,0) rotate(0deg) scale(1)' }], { duration: FLY_MS, delay: i * gap, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'backwards' });
        a1.cancel(); setTimeout(() => sound('chak'), i * gap + FLY_MS - 20);
        return a2.finished;
      }).catch(() => {}).finally(() => { el.style.zIndex = ''; resolve(); });
    }));
    await Promise.all(done);
    animating = false; say(statusText()); renderButtons();
  }

  async function load() {
    const version = ++loadVersion;
    try {
      const data = await api('card-flip');
      if (version !== loadVersion) return;
      state = data; fresh = !(data.game && !data.game.done); host.hidden = false; render();
    } catch { if (version === loadVersion) { state = null; host.hidden = true; host.replaceChildren(); } }
  }
  void load();
  return { reload: load };
}
