// OBS browser source for CHZZK chat. Polls the server's in-memory chat buffer
// (no viewer channel ids) and keeps only the newest messages on screen.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token') || '';
const roles = { streamer: '스트리머', manager: '매니저' };
const sizes = ['small', 'medium', 'large'];
let boot = '', after = 0, cleared = 0, failures = 0, settings = { maxMessages: 8, hideAfterSeconds: 60, fontSize: 'medium' };
const emojiUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)pstatic\.net$/i.test(url.hostname) ? url.href : ''; } catch { return ''; } };

/** Text with CHZZK emoji placeholders {:key:} replaced by their images. */
function content(text, emojis) {
  const span = document.createElement('span'); span.className = 'content';
  const parts = String(text).split(/\{:([A-Za-z0-9_.-]{1,64}):\}/);
  parts.forEach((part, index) => {
    if (index % 2 === 0) { if (part) span.append(document.createTextNode(part)); return; }
    const url = emojis && Object.hasOwn(emojis, part) ? emojiUrl(emojis[part]) : '';
    if (!url) { span.append(document.createTextNode(`{:${part}:}`)); return; }
    const img = document.createElement('img'); img.src = url; img.alt = `:${part}:`; img.referrerPolicy = 'no-referrer'; img.decoding = 'async'; span.append(img);
  });
  return span;
}

function hide(item, delayMs) {
  if (!settings.hideAfterSeconds) return;
  setTimeout(() => { item.classList.add('gone'); setTimeout(() => item.remove(), 700); }, Math.max(0, delayMs));
}

function add(message, serverTime) {
  const item = document.createElement('li'); item.className = 'message'; item.dataset.id = String(message.id); item.dataset.role = roles[message.role] ? message.role : 'viewer';
  if (message.test) item.append(Object.assign(document.createElement('span'), { className: 'role test', textContent: '테스트' }));
  if (roles[message.role]) item.append(Object.assign(document.createElement('span'), { className: 'role', textContent: roles[message.role] }));
  item.append(Object.assign(document.createElement('span'), { className: 'name', textContent: String(message.nickname || '익명').slice(0, 20) }), content(message.content, message.emojis));
  $('chat').append(item);
  hide(item, settings.hideAfterSeconds * 1000 - Math.max(0, serverTime - Number(message.at || serverTime)));
}

function trim() { const list = $('chat'); while (list.children.length > settings.maxMessages) list.firstElementChild.remove(); }

function accept(data) {
  if (data.settings) {
    settings = { maxMessages: Math.min(20, Math.max(3, Number(data.settings.maxMessages) || 8)), hideAfterSeconds: Math.max(0, Number(data.settings.hideAfterSeconds) || 0), fontSize: sizes.includes(data.settings.fontSize) ? data.settings.fontSize : 'medium' };
    $('chat').dataset.size = settings.fontSize;
  }
  const serverTime = Number(data.serverTime) || Date.now();
  if (data.boot !== boot) { boot = String(data.boot || ''); after = 0; cleared = Number(data.cleared) || 0; $('chat').replaceChildren(); }
  if (Number(data.cleared) > cleared) {
    cleared = Number(data.cleared);
    for (const item of [...$('chat').children]) if (Number(item.dataset.id) <= cleared) item.remove();
  }
  for (const message of Array.isArray(data.messages) ? data.messages : []) {
    if (!message || !Number.isSafeInteger(message.id) || message.id <= after || message.id <= cleared) continue;
    // On first load show only messages that would still be visible.
    if (!settings.hideAfterSeconds || serverTime - Number(message.at || 0) < settings.hideAfterSeconds * 1000) add(message, serverTime);
    after = Math.max(after, message.id);
  }
  after = Math.max(after, Number(data.last) || 0);
  trim();
}

async function poll() {
  try {
    const query = new URLSearchParams({ token, after: String(after), boot });
    const response = await fetch(`/broadcast/api/chat?${query}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '채팅을 읽지 못했습니다.');
    accept(data);
    failures = 0; $('connection').dataset.state = 'live'; $('connection').textContent = '연결됨';
  } catch (error) {
    failures++; $('connection').dataset.state = 'error'; $('connection').textContent = error.message || '연결 오류';
  }
  setTimeout(poll, Math.min(15000, 1000 * (failures + 1)));
}
void poll();
