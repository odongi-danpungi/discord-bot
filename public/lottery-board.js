// OBS browser source for the 뽑기판. Shows opened numbers only; the server never sends the hidden layout.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token') || '';
const authQuery = token ? `?token=${encodeURIComponent(token)}` : '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let boardId = '', shown = new Set(), primed = false, failures = 0, playing = false, testsPrimed = false;
const seenTests = new Set();
const queue = [];

function build(board) {
  const grid = $('grid'); grid.replaceChildren(); shown = new Set();
  for (let n = 1; n <= board.size; n++) {
    const tile = document.createElement('div'), front = document.createElement('span'), back = document.createElement('span');
    tile.className = 'tile'; tile.dataset.n = String(n); front.className = 'front'; front.textContent = String(n); back.className = 'back';
    tile.append(front, back); grid.append(tile);
  }
}
function reveal(o, fresh) {
  const tile = $('grid').querySelector(`[data-n="${o.n}"]`); if (!tile) return;
  const back = tile.querySelector('.back'), miss = o.rank === '꽝';
  back.textContent = miss ? '꽝' : o.rank; tile.classList.add(miss ? 'miss' : 'prize', 'open'); if (!miss) tile.classList.add('place' + Math.min(Number(o.place) || 4, 4)); if (fresh) tile.classList.add('fresh');
  shown.add(o.n);
}
/** Test results flash on the tile and go back: the real board is unchanged. */
function flash(o) {
  const tile = $('grid').querySelector(`[data-n="${o.n}"]`); if (!tile || shown.has(o.n)) return;
  const back = tile.querySelector('.back'), miss = o.rank === '꽝', cls = miss ? ['miss'] : ['prize', 'place' + Math.min(Number(o.place) || 4, 4)];
  back.textContent = miss ? '꽝' : o.rank; tile.classList.add(...cls, 'open', 'fresh');
  setTimeout(() => { if (!shown.has(o.n)) { tile.classList.remove(...cls, 'open', 'fresh'); back.textContent = ''; } }, 3200);
}
function left(board) {
  const prizes = board.prizes.filter(p => p.left > 0).map(p => `${p.rank} ${p.left}`).join(' · ');
  $('left').textContent = prizes ? `남은 상품 · ${prizes}` : '모든 상품이 나왔어요';
}
async function play() {
  if (playing) return; playing = true;
  while (queue.length) {
    const o = queue.shift(), banner = $('banner'), miss = o.rank === '꽝';
    if (o.test) flash(o); else reveal(o, true);
    banner.textContent = `${o.test ? '[테스트] ' : ''}${o.nickname}님 · ${o.n}번 · ${miss ? '꽝!' : `${o.rank}${o.name ? ' ' + o.name : ''}!`}`;
    banner.className = 'banner' + (miss ? '' : ' win place' + Math.min(Number(o.place) || 4, 4)); banner.hidden = false;
    await sleep(miss ? 1800 : 3500);
  }
  $('banner').hidden = true; playing = false;
}
function accept(board) {
  const stage = $('stage');
  if (!board) { stage.hidden = true; boardId = ''; return; }
  if (board.id !== boardId) { boardId = board.id; build(board); queue.length = 0; for (const o of board.opened) reveal(o, false); primed = true; }
  stage.hidden = false; left(board);
  // Oldest first so several openings play in order; openings before this page loaded are shown without effects.
  const fresh = [...board.opened].sort((a, b) => a.at - b.at || a.n - b.n).filter(o => !shown.has(o.n) && !queue.some(q => q.n === o.n));
  if (primed) { queue.push(...fresh); void play(); }
}
async function poll() {
  try {
    const response = await fetch(`/broadcast/api/lottery-board${authQuery}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '뽑기판 데이터를 읽지 못했습니다.');
    accept(data.board || null);
    for (const t of [...(data.tests || [])].reverse()) { if (!t || typeof t.id !== 'string' || seenTests.has(t.id)) continue; seenTests.add(t.id); if (testsPrimed && boardId) { queue.push(t); void play(); } }
    testsPrimed = true;
    failures = 0; $('connection').dataset.state = 'live'; $('connection').textContent = '연결됨';
  } catch (error) {
    failures++; $('connection').dataset.state = 'error'; $('connection').textContent = error.message || '연결 오류';
  }
  setTimeout(poll, Math.min(15000, 2000 * (failures + 1)));
}
void poll();
