import { randomBytes } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { discordId, workspaceError } from './workspace-policy.js';

function validate(state) {
  if (state?.version !== 1 || !Array.isArray(state.workspaces)) throw Error('작업 공간 저장 형식 오류');
  const ids = new Set();
  for (const item of state.workspaces) {
    if (!discordId(item.guildId) || !discordId(item.createdBy) || ids.has(item.guildId) ||
        typeof item.broadcastToken !== 'string' || !/^[a-f0-9]{64}$/.test(item.broadcastToken) ||
        typeof item.disabled !== 'boolean' || !item.settings || typeof item.settings !== 'object' || Array.isArray(item.settings) || Object.entries(item.settings).some(([k,v])=>!['naverCafeId','naverMenuId','naverMemoMenuId'].includes(k)||typeof v!=='string'||!/^\d{0,20}$/.test(v))) {
      throw Error('작업 공간 저장 데이터 오류');
    }
    ids.add(item.guildId);
  }
  return true;
}

export class WorkspaceStore extends JsonStore {
  constructor(file) { super(file, { version: 1, workspaces: [] }, validate); }
  find(guildId) { return this.read().workspaces.find(w => w.guildId === guildId) || null; }
  async ensure({ guildId, userId, name }) {
    if (!discordId(guildId) || !discordId(userId)) throw workspaceError('서버와 계정 확인이 필요합니다.', 400);
    await this.update(state => {
      if (state.workspaces.some(w => w.guildId === guildId)) return;
      if (state.workspaces.length >= 25) throw workspaceError('추가 이용 서버는 제작자에게 문의하세요.', 503);
      state.workspaces.push({ guildId, createdBy: userId, name: String(name || '').slice(0,100),
        createdAt: Date.now(), disabled: false, broadcastToken: randomBytes(32).toString('hex'), settings: {} });
    });
    return this.find(guildId);
  }
  async configure(guildId, input) {
    const allowed = ['naverCafeId', 'naverMenuId', 'naverMemoMenuId'];
    if (!input || typeof input !== 'object' || Object.keys(input).some(k => !allowed.includes(k))) {
      throw workspaceError('변경할 수 없는 연결 설정입니다.', 400);
    }
    for (const value of Object.values(input)) if (typeof value !== 'string' || !/^\d{0,20}$/.test(value)) {
      throw workspaceError('카페와 게시판 ID는 숫자로 입력하세요.', 400);
    }
    await this.update(state => {
      const item = state.workspaces.find(w => w.guildId === guildId);
      if (!item || item.disabled) throw workspaceError('사용할 수 없는 작업 공간입니다.');
      Object.assign(item.settings, input);
    });
    return this.find(guildId);
  }
  publicList() { return this.read().workspaces.map(({guildId, name, disabled, createdAt}) => ({guildId, name, disabled, createdAt})); }
}
