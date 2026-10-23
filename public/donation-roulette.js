// OBS browser source for CHZZK cheese donation roulette.
// Shows only spins that the server already saved; the winner index comes from the
// server and the animation lands on it. Existing history is not replayed on load.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token') || '';
const authQuery = token ? `?token=${encodeURIComponent(token)}` : '';
// Circus wheel (user choice 2026-10-23): pins on the rim knock the flapper and slow the wheel down.
const colors = [['#d7263d', '#fff'], ['#f6e7c1', '#5a2a16'], ['#1b8f84', '#fff'], ['#f2b33d', '#5a2a16'], ['#2e5eaa', '#fff'], ['#c2508a', '#fff'], ['#2f7a45', '#fff'], ['#e8712d', '#fff']];
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const seen = new Set(), queue = [];
let primed = false, playing = false, failures = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const svg = (tag, attrs) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; };
const point = (deg, r) => { const t = (deg - 90) * Math.PI / 180; return [100 + r * Math.cos(t), 100 + r * Math.sin(t)]; };
const fx = v => v.toFixed(2);

/** Flapper angle: a pin pushes it up as it comes (0.78–1 of a segment) and it bounces back after (0–0.12). */
function flapAngle(rotation, count) {
  const a = 360 / count, phase = (((rotation % a) + a) % a) / a;
  if (phase > 0.78) return -24 * Math.sin((phase - 0.78) / 0.22 * Math.PI / 2);
  if (phase < 0.12) { const k = phase / 0.12; return -24 * Math.cos(k * Math.PI / 2) * Math.cos(k * Math.PI * 2.2) * (1 - k); }
  return 0;
}

function draw(entries) {
  const wheel = $('wheel'), n = entries.length, a = 360 / n; wheel.replaceChildren();
  const defs = svg('defs', {}), gold = svg('radialGradient', { id: 'gold', cx: '35%', cy: '30%' }), hub = svg('radialGradient', { id: 'hub', cx: '35%', cy: '30%' });
  for (const [o, c] of [['0', '#fff6c8'], ['.45', '#f2c14e'], ['1', '#a0701a']]) gold.append(svg('stop', { offset: o, 'stop-color': c }));
  for (const [o, c] of [['0', '#fff'], ['1', '#d9c08a']]) hub.append(svg('stop', { offset: o, 'stop-color': c }));
  defs.append(gold, hub); wheel.append(defs);
  wheel.append(svg('circle', { cx: 100, cy: 100, r: 99, fill: '#7a1626', stroke: '#f2c14e', 'stroke-width': 1.6 }));
  const bulbs = [svg('g', { class: 'bulbs b1' }), svg('g', { class: 'bulbs b2' })];
  for (let k = 0; k < 24; k++) { const [x, y] = point(k * 15, 93.5); bulbs[k % 2].append(svg('circle', { cx: fx(x), cy: fx(y), r: 2.6 })); }
  wheel.append(...bulbs, svg('circle', { cx: 100, cy: 100, r: 87.5, fill: 'none', stroke: 'url(#gold)', 'stroke-width': 4 }));
  const rot = svg('g', { id: 'rot' }), lines = svg('g', { stroke: '#ffffff66', 'stroke-width': 0.8 });
  entries.forEach((label, i) => {
    const [x1, y1] = point(i * a, 84), [x2, y2] = point((i + 1) * a, 84), mid = (i + 0.5) * a, [tx, ty] = point(mid, 54), [bg, fg] = colors[i % colors.length];
    rot.append(svg('path', { d: `M100 100L${fx(x1)} ${fx(y1)}A84 84 0 ${a > 180 ? 1 : 0} 1 ${fx(x2)} ${fx(y2)}Z`, fill: bg }));
    lines.append(svg('line', { x1: 100, y1: 100, x2: fx(x1), y2: fx(y1) }));
    if (n <= 16) { const t = svg('text', { x: fx(tx), y: fx(ty), transform: `rotate(${fx(mid - 90)} ${fx(tx)} ${fx(ty)})`, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': n > 8 ? 7 : 8.6, 'font-weight': 900, fill: fg }); t.textContent = [...label].length > 7 ? [...label].slice(0, 6).join('') + '…' : label; rot.append(t); }
  });
  rot.append(lines);
  for (let i = 0; i < n; i++) { const [px, py] = point(i * a, 81); rot.append(svg('circle', { cx: fx(px), cy: fx(py), r: 2.7, fill: 'url(#gold)', stroke: '#4a2a0a', 'stroke-width': 0.7 })); }
  wheel.append(rot, svg('circle', { cx: 100, cy: 100, r: 15, fill: 'url(#hub)', stroke: '#a0701a', 'stroke-width': 2 }), svg('circle', { cx: 100, cy: 100, r: 6.5, fill: '#d7263d', stroke: '#7a1626', 'stroke-width': 1.2 }));
  const flap = svg('g', { id: 'flap' });
  flap.append(svg('path', { d: 'M93.5 -6 Q100 -11 106.5 -6 L102.4 24 Q100 27.5 97.6 24 Z', fill: '#d7263d', stroke: '#fff', 'stroke-width': 1.4 }), svg('circle', { cx: 100, cy: -5, r: 3.4, fill: 'url(#gold)', stroke: '#4a2a0a', 'stroke-width': 0.7 }));
  wheel.append(flap);
}

function spin(count, winnerIndex) {
  const a = 360 / count, stop = 0.22 + Math.random() * 0.11, over = 0.07 * a, to = 360 * 5 - (winnerIndex + stop) * a, D = 8000;
  const rot = $('rot'), flap = $('flap'), stage = $('stage');
  const set = r => { rot.setAttribute('transform', `rotate(${r.toFixed(3)} 100 100)`); flap.setAttribute('transform', `rotate(${flapAngle(r, count).toFixed(2)} 100 -5)`); };
  if (reduced()) { set(to); return Promise.resolve(); }
  stage.classList.add('spinning');
  return new Promise(resolve => {
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / D);
      // Ease out to a little past the stop, then settle back (the last pin pushing the wheel back).
      const r = p < 0.9 ? (to + over) * (1 - Math.pow(1 - p / 0.9, 2.6)) : to + over * Math.pow(1 - (p - 0.9) / 0.1, 2);
      set(r);
      if (p < 1) requestAnimationFrame(step); else { stage.classList.remove('spinning'); resolve(); }
    };
    requestAnimationFrame(step);
  });
}

async function play(event) {
  playing = true;
  const stage = $('stage'), result = $('result'), donor = $('donor');
  const count = event.spins > 1 ? ` · ${event.spin}/${event.spins}회` : '';
  donor.replaceChildren(document.createTextNode(`${event.test ? '[테스트] ' : ''}${event.nickname}님 ${Number(event.amount).toLocaleString('ko-KR')}치즈`), Object.assign(document.createElement('small'), { textContent: `${Number(event.tierMin).toLocaleString('ko-KR')}치즈 이상 룰렛${count}${event.test ? ' · 테스트 후원' : ''}` }));
  result.hidden = true; draw(event.entries); stage.hidden = false;
  $('rot').setAttribute('transform', 'rotate(0 100 100)');
  await sleep(60);
  await spin(event.entries.length, event.winnerIndex);
  result.textContent = `결과 · ${event.winner}`; result.hidden = false;
  // Several spins of one donation follow each other with a shorter pause.
  await sleep(event.spins > 1 && event.spin < event.spins ? 2500 : 6000);
  stage.hidden = true; playing = false;
  void next();
}
async function next() { if (playing || !queue.length) return; await play(queue.shift()); }

function accept(events) {
  // Oldest first so several donations play in arrival order.
  const fresh = [];
  for (const event of [...events].reverse()) {
    if (!event || typeof event.id !== 'string' || seen.has(event.id)) continue;
    seen.add(event.id);
    if (primed && Array.isArray(event.entries) && Number.isInteger(event.winnerIndex)) fresh.push(event);
  }
  if (seen.size > 500) { const keep = [...seen].slice(-200); seen.clear(); keep.forEach(id => seen.add(id)); }
  primed = true;
  queue.push(...fresh.slice(-30));
  void next();
}

async function poll() {
  try {
    const response = await fetch(`/broadcast/api/donation-roulette${authQuery}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '후원 룰렛 데이터를 읽지 못했습니다.');
    accept(Array.isArray(data.events) ? data.events : []);
    failures = 0; $('connection').dataset.state = 'live'; $('connection').textContent = '연결됨';
  } catch (error) {
    failures++; $('connection').dataset.state = 'error'; $('connection').textContent = error.message || '연결 오류';
  }
  setTimeout(poll, Math.min(15000, 2000 * (failures + 1)));
}
void poll();
