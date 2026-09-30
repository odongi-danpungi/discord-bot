import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscordPermissionAudit, DISCORD_RECOMMENDED_INSTALL_PERMISSIONS } from '../src/discord-permission-audit.js';

const goodChannels={
  registration:{exists:true,permissions:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks'],required:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks'],parentSynced:true,name:'🎟️・시참'},
  teams:{exists:true,permissions:['ViewChannel','SendMessages','ReadMessageHistory'],required:['ViewChannel','SendMessages','ReadMessageHistory'],parentSynced:true,name:'⚔️・내전'},
  log:{exists:true,permissions:['ViewChannel','SendMessages'],required:['ViewChannel','SendMessages'],parentSynced:true,name:'📜・로그'}
};

function baseline(extra={}){
  return {
    connected:true,guildId:'1',guildName:'테스트 서버',memberCount:20,botId:'2',botName:'댕댕봇',
    intents:['Guilds'],applicationFlags:[],
    basePermissions:['ManageChannels','ManageNicknames','ViewChannel','SendMessages','EmbedLinks','ReadMessageHistory'],
    channels:goodChannels,installScopes:['bot','applications.commands'],installPermissions:[...DISCORD_RECOMMENDED_INSTALL_PERMISSIONS],guildInstallConfigured:true,
    commands:[{name:'연동',defaultMemberPermissions:null},{name:'setting',defaultMemberPermissions:'32'}],
    adminRoleId:'',adminRoleExists:true,manageGuildPermissionValue:'32',installPermissionValue:'134302736',
    hierarchy:{botHighestRoleName:'댕댕봇',botHighestRolePosition:4},...extra
  };
}

test('least-privilege Discord configuration passes',()=>{
  const result=buildDiscordPermissionAudit(baseline());
  assert.equal(result.status,'pass');
  assert.equal(result.counts.fail,0);
  assert.ok(result.checks.some(item=>item.id==='privileged-intents'&&item.status==='pass'));
  assert.ok(result.checks.some(item=>item.id==='administrator'&&item.status==='pass'));
});

test('unnecessary privileged intents and Administrator are warnings, not false missing-permission failures',()=>{
  const result=buildDiscordPermissionAudit(baseline({intents:['Guilds','MessageContent'],applicationFlags:['GatewayMessageContentLimited'],basePermissions:['Administrator'],installPermissions:['Administrator']}));
  assert.equal(result.status,'warn');
  assert.equal(result.counts.fail,0);
  assert.ok(result.checks.some(item=>item.id==='administrator'&&item.status==='warn'));
  assert.ok(result.checks.some(item=>item.id==='privileged-intents'&&item.status==='warn'));
});

test('missing nickname and final channel permissions fail the audit',()=>{
  const channels=structuredClone(goodChannels);channels.registration.permissions=['ViewChannel','SendMessages'];
  const result=buildDiscordPermissionAudit(baseline({basePermissions:['ManageChannels','ViewChannel','SendMessages'],channels}));
  assert.equal(result.status,'fail');
  assert.ok(result.checks.some(item=>item.id==='base-ManageNicknames'&&item.status==='fail'));
  assert.ok(result.checks.some(item=>item.id==='channel-registration'&&item.status==='fail'));
});

test('missing configured admin role fails and recommends fixing ADMIN_ROLE_ID',()=>{
  const result=buildDiscordPermissionAudit(baseline({adminRoleId:'123',adminRoleExists:false,commands:[{name:'연동',defaultMemberPermissions:null},{name:'setting',defaultMemberPermissions:null}]}));
  assert.equal(result.status,'fail');
  assert.ok(result.checks.some(item=>item.id==='admin-role'&&item.status==='fail'));
  assert.ok(result.recommendations.some(text=>text.includes('ADMIN_ROLE_ID')));
});

test('demo audit is pass without contacting Discord',()=>{
  const result=buildDiscordPermissionAudit({connected:false,demo:true});
  assert.equal(result.status,'pass');
  assert.equal(result.demo,true);
});
