// OBS browser source for the cheese donation goal. Polls title, target and the running total
// (no donor information) and animates the bar when the total grows.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token') || '';
const won = n => Number(n).toLocaleString('ko-KR');
let failures = 0, lastTotal = null, lastPreview = 0, plusTimer = 0;

function plus(text) {
  const el = $('plus'); el.textContent = text; el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(plusTimer); plusTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

function accept(data) {
  const box = $('goal');
  if (!data.enabled) { box.hidden = true; return; }
  const target = Math.max(1, Number(data.target) || 1), total = Math.max(0, Number(data.total) || 0), pct = Math.min(100, total / target * 100);
  box.hidden = false;
  $('title').textContent = String(data.title || '후원 목표').slice(0, 30);
  $('numbers').textContent = `${won(total)} / ${won(target)}치즈`;
  $('fill').style.width = pct.toFixed(2) + '%';
  $('percent').textContent = Math.floor(total / target * 100) + '%';
  $('track').setAttribute('aria-valuenow', String(Math.floor(pct)));
  box.classList.toggle('done', total >= target);
  if (lastTotal !== null && total > lastTotal) plus(`+${won(total - lastTotal)}`);
  lastTotal = total;
  // A test that is not counted shows briefly as a striped preview on top of the bar.
  const preview = data.preview;
  if (preview && Number(preview.at) > lastPreview) {
    lastPreview = Number(preview.at);
    const ghost = Math.min(100, (total + Number(preview.amount)) / target * 100);
    $('ghost').style.width = ghost.toFixed(2) + '%'; plus(`테스트 +${won(preview.amount)}`);
    setTimeout(() => { $('ghost').style.width = '0'; }, 3000);
  }
}

async function poll() {
  try {
    const response = await fetch(`/broadcast/api/donation-goal?${new URLSearchParams({ token })}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '후원 목표를 읽지 못했습니다.');
    accept(data);
    failures = 0; $('connection').dataset.state = 'live'; $('connection').textContent = '연결됨';
  } catch (error) {
    failures++; $('connection').dataset.state = 'error'; $('connection').textContent = error.message || '연결 오류';
  }
  setTimeout(poll, Math.min(15000, 1500 * (failures + 1)));
}
void poll();
