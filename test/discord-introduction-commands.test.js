import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord.js';
import { canonicalCommandOptions, introductionCommands, setupCommand } from '../src/discord-commands.js';

test('intro and shortcut commands require server management by default', () => {
  const commands = introductionCommands();
  assert.deepEqual(commands.map(command => command.name), ['소개', '동동']);
  for (const command of [...commands, setupCommand()]) {
    assert.equal(command.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
    assert.ok(command.description.length >= 1 && command.description.length <= 100);
  }
  const option = commands[0].options[0];
  assert.equal(option.name, '이름');
  assert.equal(option.type, ApplicationCommandOptionType.String);
  assert.equal(option.required, true);
  assert.equal(option.min_length, 1);
  assert.equal(option.max_length, 32);
  assert.equal(commands[1].options.length, 0);
});

test('setup preserves the existing description and accepts an optional introduction name', () => {
  const command = setupCommand();
  assert.equal(command.name, 'setting');
  assert.equal(command.description, '카테고리·채널과 연동 패널을 자동 설정합니다');
  assert.equal(command.options.length, 1);
  assert.deepEqual({ ...command.options[0], required: true }, introductionCommands()[0].options[0]);
  assert.equal(command.options[0].required, false);
});

test('configured admin roles use runtime role checks without an incompatible Discord default permission filter', () => {
  for (const command of [...introductionCommands({ adminRoleId: '123456789012345678' }), setupCommand({ adminRoleId: '123456789012345678' })]) {
    assert.equal(command.default_member_permissions, null);
  }
  assert.equal(introductionCommands()[0].default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
});

test('command payloads remain independent when reused for guild and global registration', () => {
  const original = introductionCommands();
  original[0].options[0].max_length = 100;
  original[1].name = 'changed';
  assert.equal(introductionCommands()[0].options[0].max_length, 32);
  assert.equal(introductionCommands()[1].name, '동동');
  assert.equal(setupCommand().options[0].max_length, 32);
});

test('option comparison accepts equivalent API and Discord.js fields and keeps meaningful restrictions', () => {
  const wire = [{ type: 3, name: '이름', description: '이름', min_length: 1, max_length: 32 }];
  const fetched = [{ type: 3, name: '이름', description: '이름', minLength: 1, maxLength: 32, required: false, autocomplete: false, choices: [] }];
  assert.deepEqual(canonicalCommandOptions(wire), canonicalCommandOptions(fetched));
  assert.notDeepEqual(canonicalCommandOptions(wire), canonicalCommandOptions([{ ...wire[0], required: true }]));
  assert.notDeepEqual(canonicalCommandOptions(wire), canonicalCommandOptions([{ ...wire[0], choices: [{ name: '동동', value: '동동' }] }]));
  assert.notDeepEqual(canonicalCommandOptions(wire), canonicalCommandOptions([{ ...wire[0], autocomplete: true }]));
});
