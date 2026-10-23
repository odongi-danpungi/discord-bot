// OBS browser source for cheese donation alerts. Polls the server's in-memory alert buffer
// (no donor channel ids) and shows one alert at a time with an optional short chime.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token') || '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let boot = '', after = 0, primed = false, failures = 0, playing = false, audio = null;
let settings = { durationSeconds: 6, sound: true, showMessage: true, tiers: [{ id: '', minAmount: 1, template: '{닉네임}님 {금액}치즈 후원 감사합니다!', image: null, audio: null }] };
const media = name => `/broadcast/api/donation-alert/media/${encodeURIComponent(name)}?${new URLSearchParams({ token })}`;
const MEDIA = /^t[a-f0-9]{8}-(?:image|audio)-[a-f0-9]{16}\.(?:png|jpg|webp|gif|mp3|ogg|wav)$/;
/** The alert's tier (saved when it arrived), else the highest minimum not above the amount, else the lowest. */
const tierOf = a => settings.tiers.find(t => t.id === a.tier) || [...settings.tiers].reverse().find(t => Number(a.amount) >= t.minAmount) || settings.tiers[0];
const queue = [];

/** Template text with {닉네임} and {금액} as highlighted spans. Everything stays plain text. */
export function headline(template, nickname, amount) {
  const out = document.createDocumentFragment();
  for (const part of String(template).split(/(\{닉네임\}|\{금액\})/)) {
    if (part === '{닉네임}') out.append(Object.assign(document.createElement('span'), { className: 'name', textContent: nickname }));
    else if (part === '{금액}') out.append(Object.assign(document.createElement('span'), { className: 'amount', textContent: Number(amount).toLocaleString('ko-KR') }));
    else if (part) out.append(document.createTextNode(part));
  }
  return out;
}

/** A short two-note chime made in the browser (no sound files). OBS allows it without a click. */
function chime() {
  try {
    audio ||= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime + 0.02;
    for (const [i, freq] of [[0, 784], [1, 1175]]) {
      const osc = audio.createOscillator(), gain = audio.createGain(), at = start + i * 0.16;
      osc.type = 'triangle'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(audio.destination); osc.start(at); osc.stop(at + 0.55);
    }
  } catch { /* No audio is fine. */ }
}

async function play() {
  if (playing) return; playing = true;
  const box = $('alert');
  while (queue.length) {
    const a = queue.shift();
    const tier = tierOf(a);
    $('tag').hidden = !a.test;
    $('headline').replaceChildren(headline(tier.template, String(a.nickname || '익명').slice(0, 20), a.amount));
    const picture = $('picture'), useImage = MEDIA.test(tier.image || '');
    picture.hidden = !useImage; $('cheese').toggleAttribute('hidden', useImage);
    if (useImage) picture.src = media(tier.image);
    const text = settings.showMessage ? String(a.message || '').slice(0, 100) : '';
    $('message').textContent = text; $('message').hidden = !text;
    box.classList.remove('leave'); box.hidden = false;
    // Restart the entry animation for back-to-back alerts.
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    if (settings.sound) { if (MEDIA.test(tier.audio || '')) { try { const sound = new Audio(media(tier.audio)); sound.volume = 0.8; void sound.play().catch(chime); } catch { chime(); } } else chime(); }
    await sleep(settings.durationSeconds * 1000);
    box.classList.add('leave'); await sleep(450); box.hidden = true; await sleep(250);
  }
  playing = false;
}

function accept(data) {
  if (data.settings) {
    const tiers = (Array.isArray(data.settings.tiers) ? data.settings.tiers : []).filter(t => t && typeof t.template === 'string' && t.template)
      .map(t => ({ id: String(t.id || ''), minAmount: Number(t.minAmount) || 1, template: t.template.slice(0, 60), image: typeof t.image === 'string' ? t.image : null, audio: typeof t.audio === 'string' ? t.audio : null }));
    settings = { durationSeconds: Math.min(20, Math.max(3, Number(data.settings.durationSeconds) || 6)), sound: data.settings.sound !== false, showMessage: data.settings.showMessage !== false, tiers: tiers.length ? tiers : settings.tiers };
  }
  const serverTime = Number(data.serverTime) || Date.now(), alerts = Array.isArray(data.alerts) ? data.alerts : [];
  if (data.boot !== boot) {
    boot = String(data.boot || ''); after = 0;
    // First load: start from now. After a server restart: only alerts from the last few seconds.
    for (const a of alerts) if (primed && serverTime - Number(a.at || 0) < 15000) queue.push(a);
    after = Number(data.last) || 0; primed = true;
  } else {
    for (const a of alerts) if (a && Number.isSafeInteger(a.id) && a.id > after) { queue.push(a); after = a.id; }
    after = Math.max(after, Number(data.last) || 0);
  }
  void play();
}

async function poll() {
  try {
    const query = new URLSearchParams({ token, after: String(after), boot });
    const response = await fetch(`/broadcast/api/donation-alert?${query}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '후원 알림을 읽지 못했습니다.');
    accept(data);
    failures = 0; $('connection').dataset.state = 'live'; $('connection').textContent = '연결됨';
  } catch (error) {
    failures++; $('connection').dataset.state = 'error'; $('connection').textContent = error.message || '연결 오류';
  }
  setTimeout(poll, Math.min(15000, 1000 * (failures + 1)));
}
void poll();
