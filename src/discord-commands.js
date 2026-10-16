import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const administrativeCommand = (name, description, adminRoleId) => new SlashCommandBuilder()
  .setName(name)
  .setDescription(description)
  .setDefaultMemberPermissions(adminRoleId ? null : PermissionFlagsBits.ManageGuild);

const introductionName = (required, description = '소개 채널에 사용할 이름 (예: 시리 → 시리소개)') => option => option
  .setName('이름')
  .setDescription(description)
  .setRequired(required)
  .setMinLength(1)
  .setMaxLength(32);

export function setupCommand({ adminRoleId = '' } = {}) {
  return administrativeCommand('setting', '카테고리·채널과 연동 패널을 자동 설정합니다', adminRoleId)
    .addStringOption(introductionName(false, '자동 생성 채널·카테고리의 XX에 넣을 이름 (예: 시리)'))
    .toJSON();
}

export function introductionCommands({ adminRoleId = '' } = {}) {
  return [
    administrativeCommand('소개', '자동 설정된 소개 채널의 이름을 변경합니다', adminRoleId)
      .addStringOption(introductionName(true))
      .toJSON()
  ];
}

// Discord.js exposes fetched command options in camelCase; REST payloads use
// snake_case. Compare their supported behavior rather than their wire shape.
export function canonicalCommandOptions(options = []) {
  if (!Array.isArray(options)) return null;
  return options.map(option => ({
    type: option.type,
    name: option.name,
    description: option.description,
    required: option.required ?? false,
    autocomplete: option.autocomplete ?? false,
    min_length: option.minLength ?? option.min_length ?? null,
    max_length: option.maxLength ?? option.max_length ?? null,
    min_value: option.minValue ?? option.min_value ?? null,
    max_value: option.maxValue ?? option.max_value ?? null,
    channel_types: option.channelTypes ?? option.channel_types ?? [],
    choices: (option.choices ?? []).map(choice => ({ name: choice.name, value: choice.value,
      name_localizations: choice.nameLocalizations ?? choice.name_localizations ?? null })),
    options: canonicalCommandOptions(option.options ?? []),
    name_localizations: option.nameLocalizations ?? option.name_localizations ?? null,
    description_localizations: option.descriptionLocalizations ?? option.description_localizations ?? null
  }));
}
