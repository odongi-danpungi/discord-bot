// CHZZK → 채팅 → 채팅 명령어. The bot answers in the broadcaster's chat; the server checks every value again.
const states = { unavailable: ['준비 안 됨', 'readiness-optional'], not_connected: ['방송 계정 연결 필요', 'readiness-attention'], disabled: ['사용 안 함', 'readiness-optional'], stopped: ['중지', 'readiness-optional'], connecting: ['연결 중', 'readiness-pending'], subscribing: ['구독 요청 중', 'readiness-pending'], subscribed: ['채팅 구독 요청 완료', 'readiness-configured'], reconnecting: ['재연결 대기', 'readiness-attention'], auth_required: ['채팅 조회 권한 동의 필요', 'readiness-attention'] };
const sendStates = { idle: ['아직 보낸 답장 없음', 'readiness-optional'], ok: ['답장 보내기 성공', 'readiness-configured'], auth_required: ['채팅 쓰기 권한 필요', 'readiness-attention'], error: ['답장 보내기 실패', 'readiness-attention'] };
const MAX = 30;

export async function renderChatCommands({ p, el, button, run, request, reload }) {
  const data = await request('/api/chat-commands');
  if (!data || !Number.isSafeInteger(data.revision) || !data.settings || !Array.isArray(data.settings.commands)) throw Error('저장된 채팅 명령어를 확인하지 못했습니다. 다시 불러와 주세요.');
  const s = data.settings, st = data.status || {}, names = data.builtinNames || { waiting: '대기', position: '순번', help: '명령어', join: '신청' };
  const [label, cls] = states[st.state] || ['상태 확인 필요', 'readiness-attention'], [sendLabel, sendCls] = sendStates[st.send?.state] || sendStates.idle;
  const evidence = el('div', undefined, 'readiness-evidence');
  evidence.append(el('span', label, 'badge ' + cls), el('span', sendLabel, 'badge ' + sendCls), el('span', '실제 채팅 답장 검증 대기', 'badge readiness-pending'));
  p.append(el('p', '시청자가 치지직 채팅에 !명령어를 치면 봇이 방송 계정으로 답해요. 치지직 개발자 앱에서 "채팅 메시지 조회"와 "채팅 메시지 쓰기" 권한을 켜고 방송 계정을 연결해 주세요. 채팅 내용과 보낸 사람은 저장하지 않아요.', 'settings-guidance'), evidence);
  if (st.send?.detail) p.append(el('p', st.send.detail, 'field-help'));
  if (st.counts) p.append(el('p', `답장 ${st.counts.replied}번 · 간격 때문에 건너뜀 ${st.counts.cooldown}번 · 너무 많아 버림 ${st.counts.dropped}번 · 실패 ${st.counts.failed}번 (서버를 다시 시작하면 0부터)`, 'muted'));

  const f = el('form', undefined, 'form settings-form cc-form');
  f.append(el('h2', '기본 설정'));
  const check = (title, help, value) => { const wrap = el('label', undefined, 'setting-toggle'), input = el('input'), text = el('span'); input.type = 'checkbox'; input.checked = value; text.append(el('strong', title), el('span', help, 'field-help')); wrap.append(input, text); return [wrap, input]; };
  const [enabledWrap, enabled] = check('채팅 명령어 사용', '방송 계정이 연결되어 있을 때만 답합니다.', s.enabled);
  const cdWrap = el('label', '같은 명령어 다시 답하기 간격 (초)', 'cf-num'), cooldown = el('input'); cooldown.type = 'number'; cooldown.min = '3'; cooldown.max = '300'; cooldown.step = '1'; cooldown.required = true; cooldown.value = String(s.cooldownSeconds); cdWrap.append(cooldown);
  f.append(enabledWrap, cdWrap, el('h2', '기본 명령어'));
  const [wWrap, waiting] = check(`!${names.waiting}`, '지금 대기 중인 참가자 수를 알려 줘요.', s.builtins.waiting);
  const [pWrap, position] = check(`!${names.position}`, '보낸 시청자의 순서를 알려 줘요. 팔로워 인증으로 디스코드 계정을 연결한 시청자만 확인돼요.', s.builtins.position);
  const [hWrap, help] = check(`!${names.help}`, '쓸 수 있는 명령어 목록을 알려 줘요.', s.builtins.help);
  const [jWrap, join] = check(`!${names.join}`, '시참 모집 중일 때 채팅으로 신청해요. 팔로워 인증으로 디스코드와 연결된 시청자는 디스코드 참가와 같은 규칙으로, 그 밖의 시청자는 치지직 닉네임으로 대기열에 들어가요(접수 정원·중복 규칙 적용). 취소는 시청자 화면에서 해요.', Boolean(s.builtins.join));
  f.append(wWrap, pWrap, hWrap, jWrap, el('h2', '내가 만든 명령어'), el('p', '명령어 이름은 한글·영문·숫자 1~12자, 답장은 100자까지예요. 답장에 {닉네임}을 쓰면 보낸 시청자 이름으로 바뀌어요. 답장은 !로 시작할 수 없어요.', 'field-help'));
  const list = el('div', undefined, 'cc-list'), rows = [];
  const addRow = cmd => {
    const row = el('div', undefined, 'cc-row'), tWrap = el('label', '명령어'), trigger = el('input'), rWrap = el('label', '답장'), response = el('input');
    trigger.maxLength = 13; trigger.required = true; trigger.placeholder = '예) 디코'; trigger.value = cmd ? '!' + cmd.trigger : '!'; tWrap.append(trigger);
    response.maxLength = 100; response.required = true; response.placeholder = '예) 디스코드: 방송 소개에 있어요!'; response.value = cmd?.response || ''; rWrap.append(response);
    const item = { id: cmd?.id, trigger, response, row };
    row.append(tWrap, rWrap, button('빼기', async () => { rows.splice(rows.indexOf(item), 1); row.remove(); }, 'secondary'));
    rows.push(item); list.append(row);
  };
  for (const cmd of s.commands) addRow(cmd);
  f.append(list, button('명령어 추가', async () => { if (rows.length >= MAX) throw Error(`명령어는 ${MAX}개까지 만들 수 있어요.`); addRow(null); }, 'secondary'));
  const save = el('button', '설정 저장'); save.type = 'submit'; f.append(save);
  f.onsubmit = e => {
    e.preventDefault();
    run(async () => {
      await request('/api/chat-commands', { enabled: enabled.checked, cooldownSeconds: Number(cooldown.value), builtins: { waiting: waiting.checked, position: position.checked, help: help.checked, join: join.checked }, revision: data.revision,
        commands: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), trigger: r.trigger.value.trim().replace(/^!/, ''), response: r.response.value })) });
      await reload();
    });
  };
  p.append(f);

  // Preview: nothing is sent to CHZZK.
  const t = el('form', undefined, 'intake-setting-card lb-test'), cWrap = el('label', '채팅 입력'), content = el('input'), go = el('button', '답장 미리 보기', 'secondary'), result = el('p', '', 'da-preview');
  content.maxLength = 100; content.required = true; content.value = '!' + names.help; cWrap.append(content); go.type = 'submit'; result.setAttribute('role', 'status');
  t.append(el('h2', '미리 보기'), el('p', '저장한 설정으로 봇이 뭐라고 답할지 확인해요. 치지직 채팅에는 보내지 않아요.', 'field-help'), cWrap, go, result);
  t.onsubmit = e => { e.preventDefault(); run(async () => { const r = await request('/api/chat-commands/test', { content: content.value }); result.textContent = r.reply ? `봇: ${r.reply}` : '답하지 않는 채팅이에요. (명령어가 아니거나 꺼져 있어요)'; }); };
  p.append(t);
}
