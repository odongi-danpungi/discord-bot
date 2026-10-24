// Viewer page: 뽑기판 현황 and 채팅 명령어 안내. Both are read-only views of what the streamer turned on.
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const won = n => Number(n).toLocaleString('ko-KR');

export function mountViewerExtras({ api, hidden = new Set() }) {
  const lottery = document.getElementById('viewerLottery'), commands = document.getElementById('viewerCommands');
  let lotteryTimer = 0;

  async function loadLottery() {
    if (!lottery || hidden.has('lottery-board')) return;
    let data; try { data = await api('lottery-board'); } catch { lottery.hidden = true; return; }
    const body = lottery.querySelector('.vx-body'); body.replaceChildren();
    if (!data.enabled || !data.board) { lottery.hidden = true; return; }
    const b = data.board, left = b.prizes.filter(p => p.left > 0).map(p => `${p.rank}${p.name ? ' ' + p.name : ''} ${p.left}개`).join(' · ');
    body.append(node('p', `치즈 ${won(data.amount)}마다 번호 1개 · 후원 메시지에 번호를 적어 주세요 (예: 7 23) · 한 번에 최대 ${data.perDonation}개`, 'vx-help'),
      node('p', `${b.opened.length}/100칸 열림 · 남은 상품: ${left || '없음'} · 꽝 ${b.miss.left}개`, 'vx-summary'));
    const grid = node('div', undefined, 'vx-grid'), opened = new Map(b.opened.map(o => [o.n, o]));
    grid.setAttribute('role', 'img'); grid.setAttribute('aria-label', `뽑기판 100칸 중 ${b.opened.length}칸 열림`);
    for (let n = 1; n <= 100; n++) {
      const o = opened.get(n), cell = node('span', o ? (o.place ? o.rank : '꽝') : String(n), 'vx-cell' + (o ? (o.place ? ' prize vx-place' + Math.min(o.place, 4) : ' miss') : ''));
      if (o) cell.title = `${n}번 · ${o.rank}${o.name ? ' ' + o.name : ''} · ${o.nickname}`;
      grid.append(cell);
    }
    body.append(grid); lottery.hidden = false;
  }

  async function loadCommands() {
    if (!commands || hidden.has('chat-commands')) return;
    let data; try { data = await api('chat-commands'); } catch { commands.hidden = true; return; }
    const body = commands.querySelector('.vx-body'); body.replaceChildren();
    if (!data.enabled || !data.commands.length) { commands.hidden = true; return; }
    const list = node('dl', undefined, 'vx-commands');
    for (const c of data.commands) list.append(node('dt', '!' + c.trigger), node('dd', c.about));
    body.append(node('p', '치지직 채팅에 아래 명령어를 쳐 보세요. 봇이 채팅으로 답해요.', 'vx-help'), list);
    commands.hidden = false;
  }

  void loadLottery(); void loadCommands();
  lotteryTimer = setInterval(() => { if (document.visibilityState === 'visible') void loadLottery(); }, 15000);
  return { reload: () => { void loadLottery(); void loadCommands(); }, stop: () => clearInterval(lotteryTimer) };
}
