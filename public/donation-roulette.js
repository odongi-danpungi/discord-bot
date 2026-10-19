// OBS browser source for CHZZK cheese donation roulette.
// Shows only spins that the server already saved; the winner index comes from the
// server and the animation lands on it. Existing history is not replayed on load.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token') || '';
const authQuery = token ? `?token=${encodeURIComponent(token)}` : '';
const colors = ['#c5d9b7', '#d7cce5', '#f0d5ac', '#bcdcd5', '#e3c7c7', '#d2d9b9', '#c7d0e4', '#e6cdb4'];
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const seen = new Set(), queue = [];
let primed = false, playing = false, rotation = 0, failures = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const svg = (tag, attrs) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; };

function draw(entries) {
  const wheel = $('wheel'), size = 360 / entries.length; wheel.replaceChildren();
  entries.forEach((label, index) => {
    const start = (index * size - 90) * Math.PI / 180, end = ((index + 1) * size - 90) * Math.PI / 180, large = size > 180 ? 1 : 0;
    const x1 = 200 + 190 * Math.cos(start), y1 = 200 + 190 * Math.sin(start), x2 = 200 + 190 * Math.cos(end), y2 = 200 + 190 * Math.sin(end);
    wheel.append(svg('path', { d: `M200 200L${x1} ${y1}A190 190 0 ${large} 1 ${x2} ${y2}Z`, fill: colors[index % colors.length] }));
    if (entries.length <= 16) {
      const mid = (index + .5) * size - 90, t = svg('text', { x: 200 + 120 * Math.cos(mid * Math.PI / 180), y: 200 + 120 * Math.sin(mid * Math.PI / 180), 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${mid + 90} ${200 + 120 * Math.cos(mid * Math.PI / 180)} ${200 + 120 * Math.sin(mid * Math.PI / 180)})` });
      t.textContent = [...label].length > 10 ? [...label].slice(0, 9).join('') + '…' : label; wheel.append(t);
    }
  });
}

async function play(event) {
  playing = true;
  const stage = $('stage'), result = $('result'), donor = $('donor'), wheel = $('wheel');
  donor.replaceChildren(document.createTextNode(`${event.nickname}님 ${Number(event.amount).toLocaleString('ko-KR')}치즈`), Object.assign(document.createElement('small'), { textContent: `${Number(event.tierMin).toLocaleString('ko-KR')}치즈 이상 룰렛` }));
  result.hidden = true; draw(event.entries);
  wheel.style.transition = 'none'; rotation = 0; wheel.style.transform = 'rotate(0deg)'; stage.hidden = false;
  await sleep(60);
  const size = 360 / event.entries.length, target = 360 * 6 - (event.winnerIndex + .5) * size;
  rotation = target;
  wheel.style.transition = reduced() ? 'none' : 'transform 5s cubic-bezier(.15,.85,.2,1)';
  wheel.style.transform = `rotate(${rotation}deg)`;
  await sleep(reduced() ? 300 : 5200);
  result.textContent = `결과 · ${event.winner}`; result.hidden = false;
  await sleep(6000);
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
  queue.push(...fresh.slice(-20));
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
