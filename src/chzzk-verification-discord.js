import { PermissionFlagsBits } from 'discord.js';

export function buildChzzkVerificationPanel({ nickname = true } = {}) { return {
  embeds: [{ title: '치지직 팔로워 인증', color: 0x75c8a1,
    description: `방송 채널 팔로워임을 확인하면 인증 역할이 부여됩니다.\n\n1. 아래 치지직 계정 인증 버튼을 누르세요.\n2. 본인에게만 보이는 링크에서 로그인·동의를 진행하세요.\n3. ${nickname ? '팔로우 확인 후 역할이 부여되고 서버 닉네임이 동기화됩니다.' : '팔로우 확인 후 인증 역할이 부여됩니다. 서버 닉네임은 그대로 유지됩니다.'}\n\n※ 인증 링크는 본인 전용입니다. 다른 사람에게 전달하지 마세요.\n※ 새 팔로우가 바로 조회되지 않으면 잠시 후 내 연동 상태에서 다시 확인하세요.` }],
  components: [{ type: 1, components: [
    { type: 2, style: 3, custom_id: 'chzzk:link', label: '치지직 계정 인증' },
    { type: 2, style: 2, custom_id: 'chzzk:status', label: '내 연동 상태' }
  ] }], allowedMentions: { parse: [] }
}; }
export const verificationPanel = buildChzzkVerificationPanel();
export const verificationMessages = {
  unlinked: '아직 CHZZK 계정이 연결되지 않았습니다. 치지직 계정 인증을 눌러 주세요.',
  pending: '계정 연결 완료 · 팔로워 확인 대기입니다.',
  pending_scan: '팔로워 조회 범위 안에서 확인되지 않아 인증 대기 중입니다. 운영자에게 문의하세요.',
  not_following: '방송 채널 팔로우가 아직 확인되지 않았습니다. 팔로우 후 2분 이상 지나 다시 확인하세요.',
  applying: 'Discord 적용 결과 확인 대기입니다. 잠시 후 다시 확인하세요.',
  partial: '인증 역할은 부여됐지만 닉네임 변경에 실패했습니다. 운영자에게 역할 순서와 닉네임 변경 권한을 확인해 달라고 요청하세요.',
  apply_failed: '팔로워 확인 후 Discord 적용에 실패했습니다. 운영자에게 권한 설정을 확인해 달라고 요청하세요.',
  verified: '팔로워 인증과 Discord 역할 적용이 완료됐습니다.'
};
export function installChzzkVerificationDiscord(DiscordService) {
  DiscordService.prototype.publishChzzkVerification = function({ channelId, ref, nickname = true, guard }) {
    return this.serial('chzzk-verification-panel', async () => {
      const guild = await this.client.guilds.fetch(this.guildId), channel = await guild.channels.fetch(channelId), me = await guild.members.fetchMe();
      if (!channel?.isTextBased() || !channel.send || !channel.permissionsFor(me)?.has([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory
      ])) throw Error('인증 패널 채널의 보기·메시지·임베드·기록 권한을 확인하세요.');
      const panel = buildChzzkVerificationPanel({ nickname });
      if (ref?.channelId === channel.id) {
        try {
          const message = await channel.messages.fetch(ref.id);
          // The operation may have been locked while Discord fetched the message.
          guard(); await message.edit(panel); return ref;
        } catch (error) { if (error.code !== 10008) throw error; }
      }
      guard(); const message = await channel.send(panel); return { channelId: channel.id, id: message.id };
    });
  };
  DiscordService.prototype.applyChzzkVerification = function({ userId, guildId = this.guildId, roleId, name, nickname, guard }) {
    return this.serial('chzzk-verification-apply', async () => {
      const guild = await this.client.guilds.fetch(guildId), role = await guild.roles.fetch(roleId),
        member = await guild.members.fetch({ user: userId, force: true }), me = await guild.members.fetchMe();
      if (!role || role.id === guild.id || role.managed || role.permissions.bitfield !== 0n ||
        role.comparePositionTo(me.roles.highest) >= 0 || !me.permissions.has(PermissionFlagsBits.ManageRoles) || !member.manageable) {
        throw Error('권한 없는 인증 전용 역할과 봇의 역할 순서를 확인하세요.');
      }
      // Explicitly reject elevated roles; this feature only grants a follower badge/access role.
      guard(); if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, 'CHZZK 본인 동의 및 팔로워 확인');
      if (!nickname) return { nicknameSynced: false };
      try {
        guard();
        if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) throw Error('닉네임 변경 권한 없음');
        if (member.nickname !== name) await member.setNickname(name, '사용자가 동의한 CHZZK 채널명 동기화');
        return { nicknameSynced: true };
      } catch { return { nicknameFailed: true, nicknameSynced: false }; }
    });
  };
}
export async function handleChzzkVerification(interaction, service) {
  const command = interaction.isChatInputCommand?.() && interaction.commandName === '치지직인증';
  if (!command && (!interaction.isButton() || !['chzzk:link', 'chzzk:status'].includes(interaction.customId))) return false;
  await interaction.deferReply({ flags: 64 });
  if (!service) { await interaction.editReply('운영자가 CHZZK 인증 설정을 먼저 완료해야 합니다.'); return true; }
  const guildId = interaction.guildId;
  if (!guildId) { await interaction.editReply('Discord 서버에서 인증을 시작하세요.'); return true; }
  if (service.discord?.client) await service.ensureGuild(guildId);
  if (command || interaction.customId === 'chzzk:link') {
    const result = service.begin('participant', interaction.user.id, guildId);
    await interaction.editReply({ content: '치지직 계정 연동을 시작합니다. 아래 버튼에서 로그인·동의를 진행해 주세요.\n10분 이내 1회 사용 가능 · 본인 전용 링크이므로 다른 사람에게 전달하지 마세요.',
      components: [{ type: 1, components: [{ type: 2, style: 5, label: '치지직에서 인증 진행', url: result.url }] }], allowedMentions: { parse: [] } });
  } else {
    const own = await service.verify(interaction.user.id, guildId);
    await interaction.editReply({ content: verificationMessages[own.status] || '연동 확인 대기입니다.', allowedMentions: { parse: [] } });
  }
  return true;
}
