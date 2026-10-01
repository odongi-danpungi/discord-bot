import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { buildChzzkVerificationPanel, installChzzkVerificationDiscord, verificationPanel } from '../src/chzzk-verification-discord.js';

const guildId = '111111111111111111', roleId = '222222222222222222', userId = '333333333333333333', channelId = '444444444444444444';
function fixture() {
  class Service { serial(_name, fn) { return fn(); } }
  installChzzkVerificationDiscord(Service);
  const f = { writes: [], locked: false, channelAllowed: true, permissions: new Set([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageNicknames]) };
  f.guard = () => { if (f.locked) throw Object.assign(Error('locked'), { status: 423 }); };
  f.member = { manageable: true, nickname: '', roles: { cache: new Map(), add: async id => { f.writes.push(['role', id]); f.member.roles.cache.set(id, {}); } }, setNickname: async name => { f.writes.push(['nickname', name]); f.member.nickname = name; } };
  f.role = { id: roleId, managed: false, permissions: { bitfield: 0n }, comparePositionTo: () => -1 };
  f.me = { roles: { highest: {} }, permissions: { has: bit => f.permissions.has(bit) } };
  f.message = { id: '555555555555555555', edit: async payload => { f.writes.push(['edit', payload]); } };
  f.channel = { id: channelId, isTextBased: () => true, permissionsFor: () => ({ has: () => f.channelAllowed }),
    messages: { fetch: async () => f.message }, send: async payload => { f.writes.push(['send', payload]); return f.message; } };
  f.guild = { id: guildId, roles: { fetch: async () => f.role }, members: { fetch: async () => f.member, fetchMe: async () => f.me }, channels: { fetch: async () => f.channel } };
  f.service = new Service(); f.service.guildId = guildId; f.service.client = { guilds: { fetch: async id => { assert.equal(id, guildId); return f.guild; } } };
  f.apply = extra => f.service.applyChzzkVerification({ userId, roleId, name: '가상 참가자', nickname: true, guard: f.guard, ...extra });
  f.publish = extra => f.service.publishChzzkVerification({ channelId, ref: { channelId, id: f.message.id }, guard: f.guard, ...extra });
  return f;
}

test('verification panel reflects optional nickname synchronization without changing button IDs', () => {
  assert.match(verificationPanel.embeds[0].description, /닉네임이 동기화/);
  const panel = buildChzzkVerificationPanel({ nickname: false });
  assert.match(panel.embeds[0].description, /닉네임은 그대로 유지/);
  assert.doesNotMatch(panel.embeds[0].description, /닉네임이 동기화/);
  assert.deepEqual(panel.components, verificationPanel.components);
  assert.deepEqual(panel.allowedMentions, { parse: [] });
});

test('panel publication uses configured nickname policy for both edits and new messages', async () => {
  for (const ref of [null, { channelId, id: '555555555555555555' }]) {
    const f = fixture(); await f.publish({ ref, nickname: false });
    assert.equal(f.writes.length, 1); assert.match(f.writes[0][1].embeds[0].description, /닉네임은 그대로 유지/);
  }
});

test('panel does not edit or send if operation locks during the message fetch', async () => {
  const f = fixture(); f.channel.messages.fetch = async () => { f.locked = true; return f.message; };
  await assert.rejects(f.publish(), /locked/); assert.equal(f.writes.length, 0);
});

test('only unknown-message errors allow panel replacement and lock is checked again', async () => {
  const missing = fixture(); missing.channel.messages.fetch = async () => { throw Object.assign(Error('missing'), { code: 10008 }); };
  assert.deepEqual(await missing.publish(), { channelId, id: missing.message.id }); assert.equal(missing.writes[0][0], 'send');
  const forbidden = fixture(); forbidden.channel.messages.fetch = async () => { throw Object.assign(Error('forbidden'), { code: 50013 }); };
  await assert.rejects(forbidden.publish(), /forbidden/); assert.equal(forbidden.writes.length, 0);
  const locked = fixture(); locked.channel.messages.fetch = async () => { locked.locked = true; throw Object.assign(Error('missing'), { code: 10008 }); };
  await assert.rejects(locked.publish(), /locked/); assert.equal(locked.writes.length, 0);
});

test('panel publication refuses missing channel permissions without writes', async () => {
  const f = fixture(); f.channelAllowed = false;
  await assert.rejects(f.publish(), /권한/); assert.equal(f.writes.length, 0);
});

test('role application rejects unsafe roles, hierarchy and missing permissions before any write', async t => {
  const cases = {
    elevated: f => { f.role.permissions.bitfield = PermissionFlagsBits.ManageGuild; },
    managed: f => { f.role.managed = true; },
    everyone: f => { f.role.id = guildId; },
    hierarchy: f => { f.role.comparePositionTo = () => 0; },
    permission: f => { f.permissions.delete(PermissionFlagsBits.ManageRoles); },
    member: f => { f.member.manageable = false; }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async () => {
    const f = fixture(); change(f); await assert.rejects(f.apply(), /역할/); assert.equal(f.writes.length, 0);
  });
});

test('already-applied role and nickname produce no duplicate Discord writes', async () => {
  const f = fixture(); f.member.roles.cache.set(roleId, {}); f.member.nickname = '가상 참가자';
  assert.deepEqual(await f.apply(), { nicknameSynced: true }); assert.equal(f.writes.length, 0);
});

test('disabled nickname synchronization requires no ManageNicknames permission', async () => {
  const f = fixture(); f.permissions.delete(PermissionFlagsBits.ManageNicknames);
  assert.deepEqual(await f.apply({ nickname: false }), { nicknameSynced: false }); assert.deepEqual(f.writes, [['role', roleId]]);
});

test('nickname failure preserves partial role success and a new lock prevents nickname writes', async () => {
  const failed = fixture(); failed.member.setNickname = async () => { throw Error('nickname denied'); };
  assert.deepEqual(await failed.apply(), { nicknameFailed: true, nicknameSynced: false }); assert.deepEqual(failed.writes, [['role', roleId]]);
  const locked = fixture(); locked.member.roles.add = async id => { locked.writes.push(['role', id]); locked.locked = true; };
  assert.deepEqual(await locked.apply(), { nicknameFailed: true, nicknameSynced: false }); assert.deepEqual(locked.writes, [['role', roleId]]);
});
