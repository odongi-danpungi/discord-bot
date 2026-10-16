import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Collection,ChannelType,Events,PermissionFlagsBits,MessageFlags } from 'discord.js';
import { DiscordService } from '../src/discord-service.js';
import { OperationsStore } from '../src/operations.js';
import { installInteractions } from '../src/interactions.js';
import { INTRODUCTION_CATEGORY,DEFAULT_INTRODUCTION_CHANNEL,normalizeIntroductionName,saveIntroductionSettings } from '../src/discord-introduction.js';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'dd-introduction-')),file=path.join(dir,'operations.json');
  const operations=new OperationsStore(file);await operations.init();
  const cache=new Collection(),renames=[],creates=[];let next=100,failRename=false,canManage=true,canCreate=true;
  function channel(name,type=ChannelType.GuildText,parentId=null){
    const messages=new Map();const c={id:String(++next),name,type,parentId,
      permissionsFor:()=>({has:()=>canManage}),
      async setName(value){renames.push({id:c.id,name:value});if(failRename){failRename=false;throw Object.assign(Error('Discord unavailable'),{code:50013});}c.name=value;return c;},
      messages:{async fetch(id){if(!messages.has(id))throw Object.assign(Error('missing'),{code:10008});return messages.get(id);}},
      async send(){const m={id:String(++next),async edit(){}};messages.set(m.id,m);return m;}
    };cache.set(c.id,c);return c;
  }
  const guild={id:'123456789012345678',members:{me:{id:'bot',permissions:{has:()=>canCreate}}},channels:{async fetch(){return cache;},async create(data){creates.push(data);return channel(data.name,data.type,data.parent);}}};
  const client={user:{id:'bot'},guilds:{async fetch(id){assert.equal(id,guild.id);return guild;}}};
  const service=new DiscordService(client,guild.id,operations);
  t.after(async()=>{await operations.flush();await rm(dir,{recursive:true,force:true});});
  return {file,operations,cache,channel,guild,client,service,creates,renames,set canManage(value){canManage=value;},set canCreate(value){canCreate=value;},set failRename(value){failRename=value;}};
}

test('requested name renames the managed introduction and repeated setup preserves its ID',async t=>{
  const f=await fixture(t);await f.service.setup();const old=f.operations.read().discordIntroduction,id=old.channelId,count=f.cache.size;
  assert.equal(f.cache.get(id).name,DEFAULT_INTRODUCTION_CHANNEL);
  const result=await f.service.renameIntroduction('동동');assert.deepEqual(result,{channelId:id,name:'동동소개'});
  await f.service.renameIntroduction('동동');await f.service.setup();
  assert.equal(f.cache.size,count);assert.equal(f.cache.get(id).name,'동동소개');assert.equal(f.renames.length,1);
  assert.equal(f.operations.read().discordIntroduction.channelId,id);
});

test('fresh setup accepts a name and subsequent no-option setup keeps it',async t=>{
  const f=await fixture(t);await f.service.setup({introductionName:'동동'});const s=f.operations.read().discordIntroduction;
  assert.equal(f.cache.get(s.channelId).name,'동동소개');assert.equal([...f.cache.values()].some(c=>c.name===DEFAULT_INTRODUCTION_CHANNEL),false);
  const count=f.cache.size;await f.service.setup();assert.equal(f.cache.size,count);assert.equal(f.cache.get(s.channelId).name,'동동소개');
});

test('persisted settings survive service reconstruction and changing to another prefix',async t=>{
  const f=await fixture(t);await f.service.setup();await f.service.renameIntroduction('동동');
  const disk=JSON.parse(await readFile(f.file,'utf8'));assert.equal(disk.discordIntroduction.name,'동동');
  const restored=new OperationsStore(f.file);await restored.init();const service=new DiscordService(f.client,f.guild.id,restored);
  await service.setup();await service.renameIntroduction('단풍');assert.equal(f.cache.get(disk.discordIntroduction.channelId).name,'단풍소개');
  assert.equal(restored.read().discordIntroduction.channelId,disk.discordIntroduction.channelId);
});

test('legacy xx introduction is reused only inside the known welcome category',async t=>{
  const f=await fixture(t),category=f.channel(INTRODUCTION_CATEGORY,ChannelType.GuildCategory),intro=f.channel('xx소개',ChannelType.GuildText,category.id),other=f.channel('내소개');
  await f.service.renameIntroduction('동동');assert.equal(intro.name,'동동소개');assert.equal(other.name,'내소개');assert.equal(f.creates.length,0);
});

test('unrelated introductions outside the setup category are never selected',async t=>{
  const f=await fixture(t),other=f.channel('xx소개');await assert.rejects(f.service.renameIntroduction('동동'),/먼저 \/setting/);
  assert.equal(other.name,'xx소개');assert.equal(f.renames.length,0);assert.equal(f.operations.read().discordIntroduction,undefined);
});

test('ambiguous legacy candidates and duplicate target names fail before mutation',async t=>{
  const f=await fixture(t),cat=f.channel(INTRODUCTION_CATEGORY,ChannelType.GuildCategory);f.channel('xx소개',ChannelType.GuildText,cat.id);f.channel(DEFAULT_INTRODUCTION_CHANNEL,ChannelType.GuildText,cat.id);
  await assert.rejects(f.service.renameIntroduction('동동'),/여러 개/);assert.equal(f.renames.length,0);
  f.cache.delete([...f.cache.values()].find(c=>c.name==='xx소개').id);await f.service.setup();
  f.channel('동동소개',ChannelType.GuildText,cat.id);const before=f.operations.read();await assert.rejects(f.service.renameIntroduction('동동'),/이미 있습니다/);
  assert.deepEqual(f.operations.read(),before);assert.equal(f.renames.length,0);
});

test('moved or deleted tracked channels are not replaced by a different channel on rename',async t=>{
  const f=await fixture(t);await f.service.setup();const saved=f.operations.read().discordIntroduction,c=f.cache.get(saved.channelId),before=f.operations.read();
  c.parentId='999';await assert.rejects(f.service.renameIntroduction('동동'),/다른 위치/);assert.deepEqual(f.operations.read(),before);
  f.cache.delete(c.id);f.channel(DEFAULT_INTRODUCTION_CHANNEL,ChannelType.GuildText,saved.categoryId);
  await assert.rejects(f.service.renameIntroduction('동동'),/찾을 수 없습니다/);assert.equal(f.renames.length,0);
});

test('tracked category can be renamed manually without setup creating another category',async t=>{
  const f=await fixture(t);await f.service.setup();const saved=f.operations.read().discordIntroduction;f.cache.get(saved.categoryId).name='우리 안내';const count=f.cache.size;
  await f.service.renameIntroduction('동동');await f.service.setup();assert.equal(f.cache.size,count);assert.equal(f.cache.get(saved.categoryId).name,'우리 안내');
});

test('missing bot ManageChannels prevents saving or renaming',async t=>{
  const f=await fixture(t);await f.service.setup();const before=f.operations.read();f.canManage=false;
  await assert.rejects(f.service.renameIntroduction('동동'),/채널 관리 권한/);assert.deepEqual(f.operations.read(),before);assert.equal(f.renames.length,0);
});

test('Discord failure retains the intended target for retry without creating duplicates',async t=>{
  const f=await fixture(t);await f.service.setup();const id=f.operations.read().discordIntroduction.channelId,count=f.cache.size;f.failRename=true;
  await assert.rejects(f.service.renameIntroduction('동동'),/unavailable/);assert.equal(f.operations.read().discordIntroduction.name,'동동');assert.equal(f.cache.get(id).name,DEFAULT_INTRODUCTION_CHANNEL);
  await f.service.setup();assert.equal(f.cache.size,count);assert.equal(f.cache.get(id).name,'동동소개');
});

test('persistence failure stops before the Discord rename',async t=>{
  const f=await fixture(t);await f.service.setup();const before=f.operations.read(),write=f.operations.update.bind(f.operations);f.operations.update=async()=>{throw Error('disk unavailable');};
  await assert.rejects(f.service.renameIntroduction('동동'),/disk unavailable/);assert.equal(f.renames.length,0);assert.deepEqual(f.operations.read(),before);
  f.operations.update=write;await f.service.renameIntroduction('동동');assert.equal(f.renames.length,1);
});

test('storage queue rechecks the emergency guard inside the committed update',async t=>{
  const f=await fixture(t);await f.service.setup();const before=f.operations.read();let release,locked=false,entered;
  const started=new Promise(resolve=>{entered=resolve;});const pending=f.operations.update(async()=>{entered();await new Promise(resolve=>{release=resolve;});});await started;
  const save=saveIntroductionSettings(f.operations,{...before.discordIntroduction,name:'동동'},{guard(){if(locked)throw Error('locked');}});locked=true;release();await pending;
  await assert.rejects(save,/locked/);assert.deepEqual(f.operations.read().discordIntroduction,before.discordIntroduction);
});

test('concurrent setup and name changes are serialized and use one introduction',async t=>{
  const f=await fixture(t);await f.service.setup();const id=f.operations.read().discordIntroduction.channelId,count=f.cache.size;
  await Promise.all([f.service.renameIntroduction('동동'),f.service.setup(),f.service.renameIntroduction('단풍')]);
  assert.equal(f.cache.size,count);assert.equal(f.cache.get(id).name,'단풍소개');assert.equal(f.operations.read().discordIntroduction.name,'단풍');
});

test('queued commands recheck the emergency guard before writing',async t=>{
  const f=await fixture(t);await f.service.setup();const before=f.operations.read();let locked=false,release;f.service.queue=new Promise(resolve=>{release=resolve;});
  const task=f.service.renameIntroduction('동동',{guard(){if(locked)throw Error('locked');}});locked=true;release();await assert.rejects(task,/locked/);
  assert.deepEqual(f.operations.read(),before);assert.equal(f.renames.length,0);
});

test('invalid input and malformed persisted IDs fail closed',async t=>{
  const f=await fixture(t);for(const input of ['', ' ', '@everyone','a\nb','a/b','`test`','a'.repeat(33),null])assert.throws(()=>normalizeIntroductionName(input));
  assert.equal(normalizeIntroductionName('  My Name  '),'my-name');
  await assert.rejects(f.operations.update(state=>{state.discordIntroduction={name:'동동',channelId:'../channel',categoryId:'123'};}));assert.equal(f.operations.read().discordIntroduction,undefined);
});

test('separate servers store and rename only their own introduction',async t=>{
  const a=await fixture(t),b=await fixture(t);await a.service.setup();await b.service.setup();await a.service.renameIntroduction('동동');
  assert.equal(a.operations.read().discordIntroduction.name,'동동');assert.equal(b.operations.read().discordIntroduction.name,null);assert.equal(b.renames.length,0);
});

function interactionFixture(t){
  const client=new EventEmitter(),calls=[],state={locked:false,blocked:false};const config={guildId:'guild',workspaceScoped:true,adminRoleId:''};
  const discord={async renameIntroduction(name,{guard}){guard();calls.push({action:'rename',name});return {name:name+'소개',channelId:'123'};},async setup(options){options.guard();calls.push({action:'setup',name:options.introductionName});}};
  const cleanup=installInteractions({client,config,store:{read:()=>[]},operations:{},discord,viewerAuth:{},emergencyState:()=>state,operationGuard(){if(state.blocked)throw Error('운영 재시작 대기 중입니다.');}});t.after(cleanup);
  const handler=client.listeners(Events.InteractionCreate)[0];
  async function run({command='소개',name='시리',guildId='guild',manage=true,roles=[]}={}){
    const replies=[],i={commandName:command,guildId,user:{id:'user'},member:{roles},memberPermissions:{has:p=>manage&&p===PermissionFlagsBits.ManageGuild},options:{getString:()=>name},isButton:()=>false,isModalSubmit:()=>false,isChatInputCommand:()=>true,deferred:false,replied:false,
      async deferReply(payload){assert.equal(payload.flags,MessageFlags.Ephemeral);this.deferred=true;},async reply(p){replies.push(p.content);this.replied=true;},async editReply(p){replies.push(typeof p==='string'?p:p.content);this.replied=true;},async followUp(p){replies.push(p.content);}};
    await handler(i);return replies;
  }
  return {calls,state,config,run};
}

test('generic /소개 and named /setting accept user-provided names without fixed slash shortcuts',async t=>{
  const f=interactionFixture(t);assert.match((await f.run())[0],/시리소개/);await f.run({command:'소개',name:'후리나기'});await f.run({command:'setting',name:'봄이'});await f.run({command:'동동'});
  assert.deepEqual(f.calls,[{action:'rename',name:'시리'},{action:'rename',name:'후리나기'},{action:'setup',name:'봄이'}]);
});

test('unauthorized, different-server and emergency commands do not mutate channels',async t=>{
  const f=interactionFixture(t);assert.match((await f.run({manage:false}))[0],/서버 관리 권한/);assert.deepEqual(await f.run({guildId:'other'}),[]);f.state.locked=true;assert.match((await f.run())[0],/긴급 잠금/);assert.equal(f.calls.length,0);
});

test('configured operator role remains compatible with introduction commands',async t=>{
  const f=interactionFixture(t);f.config.adminRoleId='operator';await f.run({manage:false,roles:['operator']});assert.equal(f.calls.length,1);
});

test('runtime draining and restart gates block every introduction or setup command',async t=>{
  const f=interactionFixture(t);f.state.blocked=true;for(const command of ['소개','setting'])assert.match((await f.run({command}))[0],/재시작 대기/);assert.equal(f.calls.length,0);
});

test('one free-form XX value applies to every branded template while generic channels retain their names',async t=>{
  const f=await fixture(t);await f.service.setup();const original=f.operations.read().discordSetupTemplate.ids,count=f.cache.size;
  const generic=[...f.cache.values()].filter(c=>!Object.values(original).includes(c.id)).map(c=>({id:c.id,name:c.name}));
  for(const name of ['동동','시리','후리나기']){
    await f.service.setup({introductionName:name});const saved=f.operations.read().discordSetupTemplate;
    assert.equal(saved.name,name);assert.deepEqual(saved.ids,original);
    assert.equal(f.cache.get(saved.ids.introduction).name,name+'소개');
    assert.equal(f.cache.get(saved.ids.welcomeCategory).name,`🔔 ᭄༄・${name}! 안내방`);
    assert.equal(f.cache.get(saved.ids.communityInfo).name,`🐱・${name}2`);
    assert.equal(f.cache.get(saved.ids.botCategory).name,`🔔・${name}`);
    assert.equal(f.cache.get(saved.ids.botInfo).name,`${name}・${name}${name}`);
    for(const c of generic)assert.equal(f.cache.get(c.id).name,c.name);
    await f.service.setup();assert.equal(f.cache.size,count);assert.equal(f.cache.get(saved.ids.introduction).name,name+'소개');
  }
});

test('free-form template persists across restart and migrates previous introduction-only settings',async t=>{
  const f=await fixture(t),cat=f.channel(INTRODUCTION_CATEGORY,ChannelType.GuildCategory),intro=f.channel('동동소개',ChannelType.GuildText,cat.id);
  await f.operations.update(s=>{s.discordIntroduction={name:'동동',channelId:intro.id,categoryId:cat.id};});
  await f.service.setup({introductionName:'시리'});const saved=f.operations.read().discordSetupTemplate;assert.equal(saved.ids.introduction,intro.id);
  const restored=new OperationsStore(f.file);await restored.init();const service=new DiscordService(f.client,f.guild.id,restored);await service.setup();
  assert.deepEqual(restored.read().discordSetupTemplate,saved);assert.equal(f.cache.get(saved.ids.botCategory).name,'🔔・시리');
});

test('all branded targets are preflighted before saving or changing the first category',async t=>{
  const f=await fixture(t);await f.service.setup();f.channel('🔔・시리',ChannelType.GuildCategory);const before=f.operations.read(),names=[...f.cache.values()].map(c=>c.name);
  await assert.rejects(f.service.setup({introductionName:'시리'}),/이미 있습니다/);assert.deepEqual(f.operations.read(),before);assert.deepEqual([...f.cache.values()].map(c=>c.name),names);assert.equal(f.renames.length,0);
});

test('partial Discord template failure retries every branded target by the same IDs',async t=>{
  const f=await fixture(t);await f.service.setup();const ids=f.operations.read().discordSetupTemplate.ids,count=f.cache.size;f.failRename=true;
  await assert.rejects(f.service.setup({introductionName:'후리나기'}),/unavailable/);assert.equal(f.operations.read().discordSetupTemplate.name,'후리나기');
  await f.service.setup();assert.deepEqual(f.operations.read().discordSetupTemplate.ids,ids);assert.equal(f.cache.size,count);
  assert.equal(f.cache.get(ids.introduction).name,'후리나기소개');assert.equal(f.cache.get(ids.botCategory).name,'🔔・후리나기');
});

test('invalid template ID maps cannot be persisted',async t=>{
  const f=await fixture(t);await assert.rejects(f.operations.update(s=>{s.discordSetupTemplate={name:'시리',ids:{unknown:'123'}};}));assert.equal(f.operations.read().discordSetupTemplate,undefined);
});

test('template logical targets reject duplicate physical channel IDs',async t=>{
  const f=await fixture(t);await f.service.setup();const before=f.operations.read();
  await assert.rejects(f.operations.update(s=>{s.discordSetupTemplate.ids.botCategory=s.discordSetupTemplate.ids.welcomeCategory;}),/같은 채널 ID/);
  assert.deepEqual(f.operations.read(),before);
});

test('missing category create permission fails before any earlier target is renamed',async t=>{
  const f=await fixture(t),category=f.channel(INTRODUCTION_CATEGORY,ChannelType.GuildCategory);f.channel(DEFAULT_INTRODUCTION_CHANNEL,ChannelType.GuildText,category.id);f.canCreate=false;
  await assert.rejects(f.service.setup({introductionName:'시리'}),/생성할 채널 관리 권한/);assert.equal(f.renames.length,0);assert.equal(f.creates.length,0);assert.equal(f.operations.read().discordSetupTemplate,undefined);
});
