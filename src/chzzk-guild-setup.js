import { Events, PermissionFlagsBits } from 'discord.js';

const snowflake = value => /^\d{17,20}$/.test(value || '');
const unavailable = message => Object.assign(Error(message), { status: 503 });

// Only saved IDs or an explicitly configured legacy role can be reused. A matching
// role name alone is not proof of ownership (it may grant private channel access).
export async function ensureVerificationGuild(service, guildId) {
  if (!snowflake(guildId)) throw unavailable('Discord 서버에서 인증을 시작하세요.');
  if(service.config.workspaceScoped && guildId!==service.config.guildId)throw unavailable('다른 방송의 인증 설정에 접근할 수 없습니다.');
  return service.withUser(`guild:${guildId}`, async () => {
    service.guard();
    const guild = await service.discord.client.guilds.fetch(guildId);
    if (!guild || guild.unavailable) throw unavailable('서버 연결을 확인할 수 없습니다.');
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw unavailable('봇에 역할 관리 권한을 허용한 뒤 /치지직인증을 다시 실행하세요.');
    }
    const saved = service.store.read().guilds?.find(g => g.guildId === guildId);
    if (saved?.pending) throw unavailable('이전 역할 생성 결과가 미확정입니다. 운영자가 저장 상태와 Discord 역할을 확인해야 합니다.');
    const configured = guildId === service.config.guildId ? service.config.chzzkVerifyRoleId : '';
    const roleId = configured || saved?.roleId;
    let role;
    if (roleId) {
      try { role = await guild.roles.fetch(roleId); }
      catch (error) { if (error.code !== 10011) throw error; }
      if (!role && configured) throw unavailable('지정된 인증 역할이 없습니다. 기존 역할 설정을 확인하세요.');
    }
    if (!role) {
      service.guard();
      // Persist intent before the remote write. An uncertain timeout/crash must
      // never create another role blindly on the next startup.
      await saveGuild(service, { guildId, roleId: '', pending: true });
      try { service.guard(); } catch (error) {
        await saveGuild(service, { guildId, roleId: '', pending: false });
        throw error;
      }
      try {
        role = await guild.roles.create({ name: '댕댕봇 인증', permissions: 0n,
          mentionable: false, hoist: false, reason: 'CHZZK 팔로워 인증 자동 준비' });
      } catch (error) {
        if ([50013, 50001, 30005].includes(error.code)) {
          await saveGuild(service, { guildId, roleId: '', pending: false });
        }
        throw unavailable('인증 역할 생성에 실패했습니다. 봇 권한과 역할 생성 상태를 확인하세요.');
      }
      // Save the returned ID even if a lock arrived during creation, so restart
      // can reconcile the remote write without duplicating it.
      await saveGuild(service, { guildId, roleId: role.id, pending: false });
    }
    if (role.id === guild.id || role.managed || role.permissions.bitfield !== 0n || role.comparePositionTo(me.roles.highest) >= 0) {
      throw unavailable('인증 역할의 권한 또는 순서가 변경됐습니다. 봇 아래의 권한 없는 인증 역할이 필요합니다.');
    }
    service.guard();
    if (saved?.roleId !== role.id) await saveGuild(service, { guildId, roleId: role.id, pending: false });
    return role.id;
  });
}

async function saveGuild(service, entry) {
  await service.store.update(s => {
    s.guilds ||= [];
    const current = s.guilds.find(g => g.guildId === entry.guildId);
    if (current) Object.assign(current, entry);
    else {
      if (s.guilds.length >= 10000) throw unavailable('서버 설정 저장 한도에 도달했습니다.');
      s.guilds.push(entry);
    }
  });
}

export function installVerificationGuildSetup(client, service, report = () => {}) {
  let stopped = false;
  let tail = Promise.resolve();
  const schedule = guild => {
    if(service.config.workspaceScoped && guild.id!==service.config.guildId)return;
    tail = tail.then(async () => {
      if (stopped) return;
      try { await service.ensureGuild(guild.id); }
      catch { try { report({ operation: 'chzzk-guild-setup', ok: false, error: '인증 역할 자동 준비 실패 · 권한 또는 운영 잠금을 확인하세요.' }); } catch {} }
    });
  };
  client.on(Events.GuildCreate, schedule);
  for (const guild of client.guilds.cache.values()) schedule(guild);
  return async () => { stopped = true; client.off(Events.GuildCreate, schedule); await tail; };
}
