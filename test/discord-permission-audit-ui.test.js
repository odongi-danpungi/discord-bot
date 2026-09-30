import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard exposes Discord permission audit center',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  for(const id of ['discordAuditStatus','discordAuditGuild','discordAuditIntents','discordAuditCommands','discordAuditInstall','discordAuditChecks','refreshDiscordAudit','discordAuditPermissionValue','discordAuditChannelList','discordAuditCommandList','discordAuditRecommendations'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(html,/data-tab="discordaudit"/);
  assert.match(js,/discordAuditRefresh/);
  assert.match(js,/renderDiscordAudit/);
  assert.match(js,/\/api\/discord-audit/);
});
