import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscordDriftPlan, discordFixTargetKey, validateSafeFixSelection } from '../src/discord-drift-fix.js';
import { DISCORD_RECOMMENDED_INSTALL_PERMISSIONS } from '../src/discord-permission-audit.js';
import { introductionCommands, setupCommand, rouletteCommand } from '../src/discord-commands.js';

const channels={
  registration:{exists:true,name:'🎟️・시참',permissions:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks'],required:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks'],parentSynced:true},
  teams:{exists:true,name:'⚔️・내전',permissions:['ViewChannel','SendMessages','ReadMessageHistory'],required:['ViewChannel','SendMessages','ReadMessageHistory'],parentSynced:true},
  log:{exists:true,name:'📜・로그',permissions:['ViewChannel','SendMessages'],required:['ViewChannel','SendMessages'],parentSynced:true}
};
function audit(extra={}){
  const checks=[
    {id:'administrator',status:'pass'},{id:'privileged-intents',status:'pass'},{id:'portal-intents',status:'pass'},
    {id:'base-ManageChannels',status:'pass'},{id:'base-ManageNicknames',status:'pass'},{id:'install-bot',status:'pass'},
    {id:'install-commands',status:'pass'},{id:'install-permissions',status:'pass'},{id:'guild-install',status:'pass'},
    {id:'role-hierarchy',status:'pass'}
  ];
  const commandPayloads=[{name:'연동',description:'내 치지직·게임 정보를 등록하거나 수정합니다'},setupCommand(),...introductionCommands(),rouletteCommand()];
  const commands=commandPayloads.map(command=>({...command,defaultMemberPermissions:command.default_member_permissions??null}));
  return {connected:true,demo:false,status:'pass',checks,guild:{id:'g1'},bot:{basePermissions:['ManageChannels','ManageNicknames','ViewChannel','SendMessages','EmbedLinks','ReadMessageHistory']},channels:structuredClone(channels),commands,manageGuildPermissionValue:'32',adminRole:{id:'',exists:true,name:''},requiredPermissions:[...DISCORD_RECOMMENDED_INSTALL_PERMISSIONS],...extra};
}

test('clean Discord configuration produces no safe fixes',()=>{
  const plan=buildDiscordDriftPlan(audit());
  assert.equal(plan.status,'pass');
  assert.equal(plan.counts.safe,0);
  assert.equal(plan.canApply,false);
});

test('missing introduction commands are bounded repairs and preserve unrelated commands',()=>{
  const input=audit();input.commands=input.commands.filter(command=>command.name!=='소개');
  input.commands.push({name:'다른앱명령',description:'운영자가 유지하는 다른 명령',defaultMemberPermissions:'8'});
  const before=structuredClone(input.commands),plan=buildDiscordDriftPlan(input),repair=plan.items.find(item=>item.action==='sync-guild-commands');
  assert.deepEqual(repair.changes,['/소개 생성']);
  assert.match(repair.detail,/\/연동, \/setting, \/소개/);
  assert.doesNotMatch(repair.detail,/\/동동/);
  assert.deepEqual(input.commands,before);
});

test('stale setup and introduction options are detected without removing management permissions',()=>{
  const input=audit();input.commands.find(command=>command.name==='setting').options=[];
  input.commands.find(command=>command.name==='소개').options[0].required=false;
  input.commands.find(command=>command.name==='소개').defaultMemberPermissions=null;
  const repair=buildDiscordDriftPlan(input).items.find(item=>item.action==='sync-guild-commands');
  assert.deepEqual(repair.changes,['/setting 옵션 동기화','/소개 옵션 동기화','/소개 기본 권한 없음 → 32']);
  assert.equal(repair.changes.some(change=>/기본 권한 제한 해제/.test(change)),false);
});

test('delegated admin-role permissions remain compatible for all management commands',()=>{
  const input=audit({adminRole:{id:'role1',exists:true,name:'위임운영자'}});
  for(const command of input.commands)command.defaultMemberPermissions=null;
  assert.equal(buildDiscordDriftPlan(input).status,'pass');
  input.commands.find(command=>command.name==='소개').defaultMemberPermissions='32';
  assert.deepEqual(buildDiscordDriftPlan(input).items.find(item=>item.action==='sync-guild-commands').changes,['/소개 기본 권한 제한 해제']);
});

test('fetched camelCase options compare equal while obsolete choices and autocomplete are repaired',()=>{
  const input=audit();
  for(const command of input.commands)command.options=(command.options||[]).map(({min_length,max_length,...option})=>({...option,minLength:min_length,maxLength:max_length}));
  assert.equal(buildDiscordDriftPlan(input).status,'pass');
  input.commands.find(command=>command.name==='소개').options[0].choices=[{name:'고정이름',value:'fixed'}];
  input.commands.find(command=>command.name==='setting').options[0].autocomplete=true;
  assert.deepEqual(buildDiscordDriftPlan(input).items.find(item=>item.action==='sync-guild-commands').changes,['/setting 옵션 동기화','/소개 옵션 동기화']);
});

test('missing core channel and command drift become bounded SAFE actions',()=>{
  const input=audit();input.channels.log={exists:false,name:null,permissions:[],required:['ViewChannel','SendMessages'],parentSynced:null};input.commands=input.commands.filter(command=>command.name!=='연동');
  const plan=buildDiscordDriftPlan(input);
  const actions=plan.items.filter(item=>item.kind==='safe').map(item=>item.action).sort();
  assert.deepEqual(actions,['ensure-core-channels','sync-guild-commands']);
  assert.equal(plan.canApply,true);
  assert.doesNotThrow(()=>discordFixTargetKey(plan,actions));
});

test('core channel found outside the target category is manual-only to avoid duplicates',()=>{
  const input=audit();input.channels.registration={exists:false,name:null,permissions:[],required:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks'],parentSynced:null};input.outsideCoreChannels={registration:{id:'c-outside',name:'🎟️・시참',parentId:'other'},teams:null,log:null};
  const plan=buildDiscordDriftPlan(input);
  assert.ok(plan.items.some(item=>item.id==='manual-channel-location-registration'&&item.kind==='manual'));
  assert.equal(plan.items.some(item=>item.action==='ensure-core-channels'&&item.changes?.includes('registration')),false);
});

test('missing ManageChannels blocks channel creation instead of escalating permissions',()=>{
  const input=audit();input.channels.registration.exists=false;input.bot.basePermissions=input.bot.basePermissions.filter(name=>name!=='ManageChannels');input.checks=input.checks.map(item=>item.id==='base-ManageChannels'?{...item,status:'fail'}:item);
  const plan=buildDiscordDriftPlan(input),item=plan.items.find(entry=>entry.action==='ensure-core-channels');
  assert.equal(item.kind,'blocked');
  assert.equal(item.safe,false);
  assert.match(item.blockedReason,/ManageChannels/);
  assert.throws(()=>validateSafeFixSelection(plan,['ensure-core-channels']));
});

test('channel overwrite and Administrator drift stay manual-only',()=>{
  const input=audit();input.bot.basePermissions=['Administrator'];input.checks=input.checks.map(item=>item.id==='administrator'?{...item,status:'warn'}:item);input.channels.teams.permissions=['ViewChannel'];
  const plan=buildDiscordDriftPlan(input);
  assert.ok(plan.items.some(item=>item.id==='manual-administrator'&&item.kind==='manual'));
  assert.equal(plan.items.some(item=>item.action&&item.id==='manual-administrator'),false);
});

test('plan digest is stable for equivalent audit data and approval key binds actions',()=>{
  const a=audit();a.commands=[];const one=buildDiscordDriftPlan(a),two=buildDiscordDriftPlan(structuredClone(a));
  assert.equal(one.digest,two.digest);
  assert.equal(discordFixTargetKey(one,['sync-guild-commands']),discordFixTargetKey(two,['sync-guild-commands']));
});

test('baseline-resolved renamed core channel stays manual and is not duplicated',()=>{
  const input=audit({category:{exists:true,id:'cat1',name:'🎮 시참',expectedName:'🎮 시참'}});
  input.channels.registration={...input.channels.registration,exists:true,id:'c1',name:'사용자-변경-시참',expectedName:'🎟️・시참',parentId:'cat1'};
  const plan=buildDiscordDriftPlan(input);
  assert.ok(plan.items.some(item=>item.id==='manual-channel-name-registration'&&item.kind==='manual'));
  assert.equal(plan.items.some(item=>item.action==='ensure-core-channels'&&item.changes?.includes('registration')),false);
});
