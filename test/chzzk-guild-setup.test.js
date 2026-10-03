import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Events, PermissionFlagsBits } from 'discord.js';
import { ChzzkVerification, ChzzkVerificationStore } from '../src/chzzk-verification.js';
import { installVerificationGuildSetup } from '../src/chzzk-guild-setup.js';
import { handleChzzkVerification } from '../src/chzzk-verification-discord.js';
import { installInteractions } from '../src/interactions.js';
import { loadConfig } from '../src/config.js';

const a = '111111111111111111', b = '222222222222222222', uid = '333333333333333333';
const cid = 'a'.repeat(32), target = 'b'.repeat(32);
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chzzk-guilds-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const key = randomBytes(32).toString('hex'), file = path.join(dir,'auth.json');
  const store = await new ChzzkVerificationStore(file,key).init();
  const f = { created:[], applied:[], allowed:true, locked:false, guilds:new Map(), key,file };
  for (const id of [a,b]) {
    const roles = new Map();
    const guild = {id, members:{fetchMe:async()=>({permissions:{has:()=>f.allowed},roles:{highest:{}}})},
      roles:{fetch:async roleId=>roles.get(roleId)||null,create:async options=>{
        f.created.push({guildId:id,options});
        if (f.createError) throw f.createError;
        const role = {id:String(BigInt(id)+100n+BigInt(f.created.length)),permissions:{bitfield:options.permissions},managed:false,comparePositionTo:()=>-1};
        roles.set(role.id,role); return role;
      }}, roleMap:roles};
    f.guilds.set(id,guild);
  }
  const client = new EventEmitter(); client.guilds = {cache:f.guilds,fetch:async id=>{
    if (!f.guilds.has(id)) throw Error('unknown guild'); return f.guilds.get(id);
  }};
  const config = {guildId:a,chzzkVerifyRoleId:'',chzzkChannelId:target,chzzkVerifyNickname:false,publicBaseUrl:'https://bot.example.com'};
  const service = new ChzzkVerification({config,store,now:()=>1000000,guard:()=>{if(f.locked)throw Error('locked');},discord:{client,
    applyChzzkVerification:async data=>{data.guard();f.applied.push(data);return {nicknameSynced:false};}}});
  service.followers = async()=>({ids:new Set([cid]),complete:true});
  Object.assign(f,{store,service,client}); return f;
}

test('two servers create separate least-privilege roles; repeated join and restart reuse saved IDs',async t=>{
  const f=await fixture(t);
  const ids=await Promise.all([f.service.ensureGuild(a),f.service.ensureGuild(a),f.service.ensureGuild(b)]);
  assert.equal(ids[0],ids[1]);assert.notEqual(ids[0],ids[2]);assert.equal(f.created.length,2);
  assert.ok(f.created.every(x=>x.options.permissions===0n&&!x.options.mentionable));
  f.service.store=await new ChzzkVerificationStore(f.file,f.key).init();
  assert.equal(await f.service.ensureGuild(a),ids[0]);assert.equal(f.created.length,2);
});

test('never adopts an unrelated same-name role and explicit legacy role stays primary-only',async t=>{
  const f=await fixture(t), original='555555555555555555';
  f.guilds.get(a).roleMap.set(original,{id:original,name:'댕댕봇 인증',permissions:{bitfield:0n},managed:false,comparePositionTo:()=>-1});
  assert.notEqual(await f.service.ensureGuild(a),original);
  const other=await fixture(t);other.service.config.chzzkVerifyRoleId=original;
  other.guilds.get(a).roleMap.set(original,f.guilds.get(a).roleMap.get(original));
  assert.equal(await other.service.ensureGuild(a),original);
  assert.notEqual(await other.service.ensureGuild(b),original);assert.equal(other.created.length,1);
});

test('missing permission and operational lock cause no role writes; normal retry works after permission repair',async t=>{
  const f=await fixture(t);f.allowed=false;
  await assert.rejects(f.service.ensureGuild(a),/역할 관리/);assert.equal(f.created.length,0);
  f.allowed=true;f.locked=true;await assert.rejects(f.service.ensureGuild(a),/locked/);assert.equal(f.created.length,0);
  f.locked=false;await f.service.ensureGuild(a);assert.equal(f.created.length,1);
});

test('ambiguous remote failure remains pending across restart and never retries creation blindly',async t=>{
  const f=await fixture(t);f.createError=Error('timeout');
  await assert.rejects(f.service.ensureGuild(a),/생성에 실패/);
  f.createError=null;f.service.store=await new ChzzkVerificationStore(f.file,f.key).init();
  await assert.rejects(f.service.ensureGuild(a),/미확정/);assert.equal(f.created.length,1);
});

test('definitive permission failure permits later retry and unsafe saved roles are never elevated or replaced',async t=>{
  const f=await fixture(t);f.createError=Object.assign(Error('forbidden'),{code:50013});
  await assert.rejects(f.service.ensureGuild(a));f.createError=null;
  const id=await f.service.ensureGuild(a);f.guilds.get(a).roleMap.get(id).permissions.bitfield=PermissionFlagsBits.Administrator;
  await assert.rejects(f.service.ensureGuild(a),/권한 또는 순서/);assert.equal(f.created.length,2);
});

test('deleted automatic role is recreated once and its changed ID invalidates the old verification cache',async t=>{
  const f=await fixture(t);await f.store.saveUser({userId:uid,channelId:cid,name:'가상 사용자'});
  await f.service.verify(uid,a);const old=f.service.roleFor(a);f.guilds.get(a).roleMap.delete(old);
  await f.service.verify(uid,a);assert.equal(f.applied.length,2);assert.notEqual(f.service.roleFor(a),old);
});

test('same identity verifies independently in two guilds with no cooldown or role leakage',async t=>{
  const f=await fixture(t);await f.store.saveUser({userId:uid,channelId:cid,name:'가상 사용자'});
  const results=await Promise.all([f.service.verify(uid,a),f.service.verify(uid,b)]);
  assert.deepEqual(results.map(x=>x.status),['verified','verified']);
  assert.deepEqual(f.applied.map(x=>x.guildId),[a,b]);assert.notEqual(f.applied[0].roleId,f.applied[1].roleId);
  await f.service.verify(uid,b);assert.equal(f.applied.length,2);
  f.service.store=await new ChzzkVerificationStore(f.file,f.key).init();
  assert.equal(f.service.status(uid,b).status,'verified');assert.equal(f.service.status(uid,a).status,'verified');
});

test('OAuth callback is bound to original guild and cannot redirect role application with an extra guild parameter',async t=>{
  const f=await fixture(t);f.service.request=async endpoint=>endpoint.endsWith('/token')?{accessToken:'synthetic',expiresIn:3600}:{channelId:cid,channelName:'가상 사용자'};
  const link=f.service.begin('participant',uid,b), start=f.service.start(new URL(link.url).searchParams.get('ticket'));
  await f.service.callback({state:new URL(start.url).searchParams.get('state'),cookie:start.cookie,code:'synthetic',guildId:a});
  assert.equal(f.applied.length,1);assert.equal(f.applied[0].guildId,b);assert.equal(f.service.status(uid,a).status,'pending');
});

test('slash command works in secondary guild, replies ephemerally and rejects DMs',async t=>{
  const f=await fixture(t), replies=[];
  const interaction={guildId:b,user:{id:uid},commandName:'치지직인증',isChatInputCommand:()=>true,isButton:()=>false,
    deferReply:async value=>replies.push(value),editReply:async value=>replies.push(value)};
  assert.equal(await handleChzzkVerification(interaction,f.service),true);assert.equal(replies[0].flags,64);
  assert.ok(replies[1].components[0].components[0].url.startsWith('https://bot.example.com/oauth/chzzk/start?ticket='));
  interaction.guildId=null;await handleChzzkVerification(interaction,f.service);assert.match(replies.at(-1),/서버에서/);
});

test('join listener handles startup, new joins and clean teardown without unhandled rejection',async t=>{
  const f=await fixture(t), visited=[];let finish;
  const first=new Promise(r=>finish=r);f.service.ensureGuild=async id=>{visited.push(id);finish();};
  const stop=installVerificationGuildSetup(f.client,f.service);await first;
  await new Promise(r=>setImmediate(r));f.client.emit(Events.GuildCreate,{id:a});
  await new Promise(r=>setImmediate(r));await stop();
  assert.deepEqual(visited,[a,b,a]);assert.equal(f.client.listenerCount(Events.GuildCreate),0);
  f.client.emit(Events.GuildCreate,{id:b});assert.equal(visited.length,3);
});

test('configuration accepts automatic role mode but still rejects malformed explicit roles',async()=>{
  const env={DISCORD_TOKEN:'synthetic',DISCORD_CLIENT_ID:uid,DISCORD_GUILD_ID:a,DASHBOARD_PASSWORD:'synthetic-password',
    CHZZK_VERIFY_ENABLED:'true',CHZZK_CLIENT_ID:'synthetic',CHZZK_CLIENT_SECRET:'synthetic-secret',CHZZK_CHANNEL_ID:target,
    PUBLIC_BASE_URL:'https://bot.example.com',CHZZK_TOKEN_KEY:randomBytes(32).toString('hex')};
  assert.equal((await loadConfig(env,[])).chzzkVerifyRoleId,'');
  await assert.rejects(loadConfig({...env,CHZZK_VERIFY_ROLE_ID:'not-an-id'},[]),/인증 전용 역할/);
});

test('dedicated invitation requires only role management, with optional nickname permission',async t=>{
  const f=await fixture(t);f.service.config.clientId=uid;
  let url=new URL(f.service.installUrl());assert.equal(url.searchParams.get('permissions'),PermissionFlagsBits.ManageRoles.toString());
  assert.equal(url.searchParams.get('scope'),'bot applications.commands');assert.equal(url.searchParams.get('integration_type'),'0');
  f.service.config.chzzkVerifyNickname=true;url=new URL(f.service.installUrl());
  assert.equal(url.searchParams.get('permissions'),(PermissionFlagsBits.ManageRoles|PermissionFlagsBits.ManageNicknames).toString());
});

test('secondary guild routing opens only CHZZK authentication and preserves existing primary-server isolation',async t=>{
  const client=new EventEmitter(),calls=[];
  const cleanup=installInteractions({client,config:{guildId:a},store:{read:()=>[]},chzzkVerification:{begin:(kind,userId,guildId)=>{
    calls.push({kind,userId,guildId});return {url:'https://bot.example.com/oauth/chzzk/start?ticket=synthetic'};
  }}});t.after(cleanup);
  const listener=client.listeners(Events.InteractionCreate)[0];
  const interaction={guildId:b,user:{id:uid},commandName:'치지직인증',isButton:()=>false,isChatInputCommand:()=>true,
    deferReply:async()=>{},editReply:async()=>{},reply:async()=>{throw Error('unexpected reply');}};
  await listener(interaction);assert.equal(calls.length,1);assert.equal(calls[0].guildId,b);
  await listener({...interaction,commandName:'setting'});assert.equal(calls.length,1);
});

test('secondary guild check metadata cannot override identity fields',async t=>{
  const f=await fixture(t);
  const result=f.service.checkedUser({userId:uid,channelId:cid,name:'본인',guildChecks:{[b]:{userId:a,channelId:target,name:'다른 사람'}}},b);
  assert.equal(result.userId,uid);assert.equal(result.channelId,cid);assert.equal(result.name,'본인');
});

test('changing explicit primary role updates the saved mapping without affecting secondary roles',async t=>{
  const f=await fixture(t);await f.service.ensureGuild(a);const secondary=await f.service.ensureGuild(b);
  const role={id:'666666666666666666',permissions:{bitfield:0n},managed:false,comparePositionTo:()=>-1};
  f.guilds.get(a).roleMap.set(role.id,role);f.service.config.chzzkVerifyRoleId=role.id;
  assert.equal(await f.service.ensureGuild(a),role.id);assert.equal(f.service.roleFor(a),role.id);
  assert.equal(await f.service.ensureGuild(b),secondary);
});
