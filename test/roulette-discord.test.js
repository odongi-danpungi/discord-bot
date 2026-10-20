import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { introductionCommands, rouletteCommand, setupCommand } from '../src/discord-commands.js';
import { installInteractions } from '../src/interactions.js';
import { buildDiscordDriftPlan } from '../src/discord-drift-fix.js';

const guildId='123456789012345678';
function fixture(t,overrides={}){
  const client=new EventEmitter(),config={guildId,workspaceScoped:true,adminRoleId:'',publicBaseUrl:'https://bot.example/',multiWorkspaceEnabled:true,...overrides};
  let blocked=false,locked=false,guardCalls=0,writes=0;
  const forbidden=()=>{writes++;throw Error('roulette shortcut must not mutate state or post messages');};
  const cleanup=installInteractions({client,config,store:{read:()=>[],upsert:forbidden},operations:{update:forbidden},discord:{sync:forbidden,setup:forbidden},viewerAuth:{},emergencyState:()=>({locked}),operationGuard(){guardCalls++;if(blocked)throw Error('private runtime error');}});
  t.after(cleanup);
  const handler=client.listeners(Events.InteractionCreate)[0];
  async function run({manage=true,roles=[],server=guildId}={}){
    const replies=[],interaction={guildId:server,commandName:'룰렛',user:{id:'987654321098765432'},member:{roles},memberPermissions:{has:permission=>manage&&permission===PermissionFlagsBits.ManageGuild},
      isChatInputCommand:()=>true,isButton:()=>false,isModalSubmit:()=>false,deferred:false,replied:false,
      async reply(payload){replies.push(payload);this.replied=true;},async followUp(payload){replies.push(payload);}};
    await handler(interaction);
    for(const reply of replies){assert.equal(reply.flags,MessageFlags.Ephemeral);assert.deepEqual(reply.allowedMentions,{parse:[]});}
    assert.equal(writes,0);return replies;
  }
  return {config,run,set blocked(value){blocked=value;},set locked(value){locked=value;},get guardCalls(){return guardCalls;}};
}

test('roulette shortcut is separately owned and defaults to server management permissions',()=>{
  const command=rouletteCommand();
  assert.equal(command.name,'룰렛');assert.equal(command.default_member_permissions,PermissionFlagsBits.ManageGuild.toString());
  assert.equal(command.options.length,0);assert.deepEqual(introductionCommands().map(item=>item.name),['소개']);
  assert.equal(rouletteCommand({adminRoleId:'role'}).default_member_permissions,null);
});

test('roulette shortcut points managers to the authenticated current-server portal without spinning',async t=>{
  const f=fixture(t),[reply]=await f.run(),url=new URL(reply.content.match(/https:\/\/\S+/)[0]);
  assert.equal(url.origin,'https://bot.example');assert.equal(url.pathname,'/portal/');
  assert.equal(url.searchParams.get('server'),guildId);assert.equal(url.searchParams.get('page'),'roulette');assert.equal([...url.searchParams].length,2);
  assert.match(reply.content,/로그인/);assert.equal(f.guardCalls,1);
});

test('legacy roulette shortcut uses only the authenticated dashboard route',async t=>{
  const f=fixture(t,{multiWorkspaceEnabled:false}),[reply]=await f.run();
  assert.match(reply.content,/https:\/\/bot\.example\/roulette\.html/);assert.doesNotMatch(reply.content,/[?]|token|localhost|127\.0\.0\.1/);
});

test('roulette shortcut denies participants and ignores a different guild',async t=>{
  const f=fixture(t),[reply]=await f.run({manage:false});assert.match(reply.content,/서버 관리 권한/);assert.doesNotMatch(reply.content,/https:/);
  assert.deepEqual(await f.run({server:'222222222222222222'}),[]);assert.deepEqual(await f.run({server:null}),[]);assert.equal(f.guardCalls,0);
});

test('configured delegated role supports both raw and cached Discord role shapes',async t=>{
  const f=fixture(t,{adminRoleId:'role'});
  assert.match((await f.run({manage:false,roles:['role']}))[0].content,/https:/);
  assert.match((await f.run({manage:false,roles:{cache:new Map([['role',{}]])}}))[0].content,/https:/);
  assert.doesNotMatch((await f.run({manage:false,roles:['other']}))[0].content,/https:/);
});

test('roulette shortcut respects emergency, draining and restart gates without leaking technical errors',async t=>{
  const f=fixture(t);f.locked=true;
  assert.doesNotMatch((await f.run())[0].content,/https:/);f.locked=false;f.blocked=true;
  const [reply]=await f.run();assert.match(reply.content,/재시작/);assert.doesNotMatch(reply.content,/https:|private runtime/);
});

test('missing or unsafe public origins explain setup without exposing the configured value',async t=>{
  const f=fixture(t);
  for(const value of ['',undefined,'invalid','http://bot.example/','https://localhost/','https://127.0.0.1/','https://[::1]/','https://10.0.0.1/','https://bot.local/','https://secret-user:secret-pass@bot.example/','https://bot.example/?token=secret-value','https://bot.example/#secret-value','https://bot.example/private']){
    f.config.publicBaseUrl=value;const [reply]=await f.run();assert.match(reply.content,/PUBLIC_BASE_URL/);assert.doesNotMatch(reply.content,/https?:|secret-|127\.0\.0\.1|private/);
  }
});

test('safe repair owns missing roulette command while retaining unrelated slash commands',()=>{
  const commands=[{name:'연동',description:'내 치지직·게임 정보를 등록하거나 수정합니다'},setupCommand(),...introductionCommands(),{name:'다른명령',description:'다른 명령'}].map(command=>({...command,defaultMemberPermissions:command.default_member_permissions??null}));
  const before=structuredClone(commands),plan=buildDiscordDriftPlan({connected:true,commands,adminRole:{id:''}}),repair=plan.items.find(item=>item.action==='sync-guild-commands');
  assert.deepEqual(repair.changes,['/룰렛 생성']);assert.match(repair.detail,/\/룰렛/);assert.deepEqual(commands,before);
});
