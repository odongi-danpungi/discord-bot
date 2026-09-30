import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Discord audit page exposes policy baseline, journal, and guarded safe restore',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  for(const id of ['discordPolicyBadge','discordPolicyBaseline','discordPolicyDrift','discordPolicySafe','discordPolicyAttribution','discordPolicyDiff','captureDiscordPolicy','refreshDiscordPolicy','restoreDiscordPolicy','discordPolicyJournal'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(js,/discordPolicyRefresh/);assert.match(js,/captureDiscordPolicy/);assert.match(js,/restore-discord-baseline/);
  assert.match(server,/\/api\/discord-policy/);assert.match(server,/\/api\/discord-policy\/baseline/);assert.match(server,/\/api\/discord-policy\/restore/);
  assert.match(server,/approvalGuard\.consume\([^;]+restore-discord-baseline/);
});


test('policy monitor controls and endpoints are wired into the Discord audit page',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  for(const id of ['discordPolicyMonitorBadge','discordPolicyMonitorState','discordPolicyMonitorLastRun','discordPolicyMonitorNextRun','discordPolicyMonitorAlert','discordPolicyMonitorEnabled','discordPolicyMonitorInterval','discordPolicyAlertMode','discordPolicyRecoveryAlerts','saveDiscordPolicyMonitor','runDiscordPolicyMonitor','discordPolicyMaintenanceBadge','discordPolicyMaintenanceState','discordPolicyAckState','startDiscordPolicyMaintenance','endDiscordPolicyMaintenance','ackDiscordPolicyDrift','clearDiscordPolicyAck'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(js,/saveDiscordPolicyMonitor/);assert.match(js,/runDiscordPolicyMonitor/);assert.match(js,/Discord 기준선 Drift 감지/);
  assert.match(server,/\/api\/discord-policy\/monitor/);assert.match(server,/\/api\/discord-policy\/monitor\/run/);assert.match(server,/\/api\/discord-policy\/maintenance\/start/);assert.match(server,/\/api\/discord-policy\/ack/);assert.match(server,/discord_policy_drift/);
});
