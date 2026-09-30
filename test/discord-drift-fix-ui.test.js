import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Discord audit page exposes dry-run safe fix controls and guarded API wiring',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  for(const id of ['discordFixBadge','discordFixSafe','discordFixManual','discordFixBlocked','discordFixDigest','discordFixPlan','refreshDiscordFix','applyDiscordFix'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(js,/discordFixRefresh/);
  assert.match(js,/applyDiscordFix/);
  assert.match(js,/apply-discord-fix/);
  assert.match(server,/\/api\/discord-fix-plan/);
  assert.match(server,/\/api\/discord-fix\/apply/);
  assert.match(server,/approvalGuard\.consume\([^;]+apply-discord-fix/);
});
