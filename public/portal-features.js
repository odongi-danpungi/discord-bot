// 설정 → 기능 숨기기. Hidden features leave the menu and the server refuses their routes.
export async function renderFeatureVisibility({ p, el, run, request, menu, titles, locked, reload, applied }) {
  const data = await request('/api/feature-visibility');
  const valid = d => d && Number.isSafeInteger(d.revision) && d.hidden && Array.isArray(d.hidden.operator) && Array.isArray(d.hidden.viewer) && Array.isArray(d.viewerFeatures);
  if (!valid(data)) throw Error('저장된 숨김 설정을 확인하지 못했습니다. 다시 불러와 주세요.');
  const hidden = { operator: new Set(data.hidden.operator), viewer: new Set(data.hidden.viewer) };
  const lockedIds = { operator: new Set(locked), viewer: new Set(data.locked?.viewer || ['participation']) };
  applied([...hidden.operator]);

  const save = (role, ids, show) => run(async () => {
    const next = new Set(hidden[role]);
    for (const id of ids) if (!lockedIds[role].has(id)) show ? next.delete(id) : next.add(id);
    const body = { hidden: { operator: [...(role === 'operator' ? next : hidden.operator)], viewer: [...(role === 'viewer' ? next : hidden.viewer)] }, revision: data.revision };
    const result = await request('/api/feature-visibility', body);
    applied(result.hidden.operator);
    await reload();
  });
  const toggle = (label, checked, onChange, help) => {
    const wrap = el('label', undefined, 'fv-switch'), input = el('input'), track = el('span', undefined, 'fv-track'), text = el('span', label, 'fv-switch-label');
    input.type = 'checkbox'; input.checked = checked; input.setAttribute('role', 'switch'); input.setAttribute('aria-label', help);
    input.onchange = () => onChange(input.checked); wrap.append(text, input, track); return wrap;
  };
  const count = (role, ids) => `${ids.filter(id => !hidden[role].has(id)).length}/${ids.length} 표시`;

  const section = (role, title, intro, categories) => {
    const box = el('section', undefined, 'fv-section'), head = el('div', undefined, 'fv-section-head');
    const all = categories.flatMap(([, groups]) => groups.flatMap(([, items]) => items.map(([id]) => id)));
    head.append(el('h2', title), el('span', `숨김 ${all.filter(id => hidden[role].has(id)).length}개`, 'badge'));
    if (all.some(id => hidden[role].has(id))) { const reset = el('button', '모두 표시', 'secondary'); reset.type = 'button'; reset.onclick = () => save(role, all, true); head.append(reset); }
    box.append(head, el('p', intro, 'settings-guidance'));
    for (const [category, groups] of categories) {
      const ids = groups.flatMap(([, items]) => items.map(([id]) => id)), free = ids.filter(id => !lockedIds[role].has(id)), on = free.some(id => !hidden[role].has(id));
      const cat = el('div', undefined, 'fv-category'), catHead = el('div', undefined, 'fv-category-head' + (on || !free.length ? '' : ' off'));
      const name = el('strong', category); name.append(el('span', ' ' + count(role, ids), 'fv-count'));
      catHead.append(name);
      if (free.length) catHead.append(toggle(on ? '전체 숨기기' : '전체 숨김됨', on, show => save(role, free, show), `${category} 전체 표시`));
      cat.append(catHead);
      for (const [group, items] of groups) {
        const gIds = items.map(([id]) => id), gFree = gIds.filter(id => !lockedIds[role].has(id)), gOn = gFree.some(id => !hidden[role].has(id));
        const g = el('div', undefined, 'fv-group'), gHead = el('div', undefined, 'fv-group-head' + (gOn || !gFree.length ? '' : ' off'));
        const gName = el('strong', group); gName.append(el('span', ' ' + count(role, gIds), 'fv-count'));
        gHead.append(gName);
        if (gFree.length) gHead.append(toggle(gOn ? '숨기기' : '숨김됨', gOn, show => save(role, gFree, show), `${group} 묶음 표시`));
        g.append(gHead);
        for (const [id, label] of items) {
          const row = el('div', undefined, 'fv-item' + (hidden[role].has(id) ? ' off' : ''));
          row.append(el('span', label, 'fv-item-label'));
          row.append(lockedIds[role].has(id) ? el('span', '항상 표시', 'badge readiness-optional') : toggle('', !hidden[role].has(id), show => save(role, [id], show), `${label} 표시`));
          g.append(row);
        }
        cat.append(g);
      }
      box.append(cat);
    }
    return box;
  };

  const operatorTree = menu.map(([category, groups]) => [category, groups.map(([group, leaves]) => [group, leaves.map(id => [id, titles[id] || id])])]);
  const viewerTree = [['시청자 화면', data.viewerFeatures.map(([group, items]) => [group, items.map(([id, label]) => [String(id), String(label)])])]];
  const layout = el('div', undefined, 'fv-layout');
  layout.append(
    section('operator', '내 메뉴 · 스트리머', '끄면 왼쪽 메뉴에서 사라지고, 서버에서도 그 화면의 설정·실행 요청을 막아요. 운영 홈과 통합 Queue는 숨길 수 없고, 이 화면은 오른쪽 위 톱니바퀴로 언제든 열 수 있어요. 켜 둔 자동 기능(예: 치즈 후원 룰렛)은 숨겨도 계속 동작해요.', operatorTree),
    section('viewer', '시청자 화면', '끄면 시청자 화면에서 사라지고, 서버에서도 그 기능 요청을 막아요. 참가 현황은 항상 표시돼요. 숨겨도 설정과 기록은 그대로 남아요.', viewerTree)
  );
  p.append(layout);
}
