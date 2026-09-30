const REQUIRED_GUILD_PERMISSIONS=['ManageChannels','ManageNicknames'];
const REQUIRED_TEXT_PERMISSIONS=['ViewChannel','SendMessages'];
const RECOMMENDED_TEXT_PERMISSIONS=['EmbedLinks','ReadMessageHistory'];
const PRIVILEGED_INTENTS=['GuildMembers','GuildPresences','MessageContent'];
const PRIVILEGED_APP_FLAGS=['GatewayGuildMembers','GatewayGuildMembersLimited','GatewayPresence','GatewayPresenceLimited','GatewayMessageContent','GatewayMessageContentLimited'];

function check(status,label,detail,id){return {id:id||label,status,label,detail};}
function uniq(values){return [...new Set((values||[]).filter(Boolean).map(String))];}

export const DISCORD_REQUIRED_GUILD_PERMISSIONS=Object.freeze([...REQUIRED_GUILD_PERMISSIONS]);
export const DISCORD_RECOMMENDED_INSTALL_PERMISSIONS=Object.freeze([...REQUIRED_GUILD_PERMISSIONS,...REQUIRED_TEXT_PERMISSIONS,...RECOMMENDED_TEXT_PERMISSIONS]);
export const DISCORD_REQUIRED_CHANNEL_PERMISSIONS=Object.freeze({
  registration:['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks'],
  teams:['ViewChannel','SendMessages','ReadMessageHistory'],
  log:['ViewChannel','SendMessages']
});

export function summarizeChecks(checks=[]){
  const counts={pass:0,warn:0,fail:0};
  for(const item of checks)if(counts[item.status]!==undefined)counts[item.status]++;
  return {counts,status:counts.fail?'fail':counts.warn?'warn':'pass'};
}

export function buildDiscordPermissionAudit(input={}){
  const checks=[];
  const connected=Boolean(input.connected);
  if(!connected){
    checks.push(check(input.demo?'pass':'fail','Discord 연결',input.demo?'연습 모드에서는 Discord 권한 검사를 생략합니다.':input.message||'Discord에 연결되지 않았습니다.','connected'));
    const summary=summarizeChecks(checks);
    return {...summary,connected,demo:Boolean(input.demo),checks,recommendations:[],requiredPermissions:DISCORD_RECOMMENDED_INSTALL_PERMISSIONS,installPermissionValue:String(input.installPermissionValue||'0')};
  }

  checks.push(check('pass','Discord 연결',`${input.guildName||'서버'} · ${input.botName||'봇'}`,'connected'));
  const intents=new Set(uniq(input.intents));
  const privilegedRequested=PRIVILEGED_INTENTS.filter(name=>intents.has(name));
  checks.push(check(intents.has('Guilds')?'pass':'fail','Gateway Intent · Guilds',intents.has('Guilds')?'현재 기능에 필요한 Guilds Intent만 사용합니다.':'Guilds Intent가 없어 서버 상호작용을 안정적으로 처리할 수 없습니다.','intent-guilds'));
  checks.push(check(privilegedRequested.length?'warn':'pass','Privileged Intents',privilegedRequested.length?`현재 기능에 필요하지 않은 privileged intent 요청: ${privilegedRequested.join(', ')}`:'GuildMembers / GuildPresences / MessageContent를 요청하지 않습니다.','privileged-intents'));

  const applicationFlags=new Set(uniq(input.applicationFlags));
  const privilegedEnabled=PRIVILEGED_APP_FLAGS.filter(name=>applicationFlags.has(name));
  checks.push(check(privilegedEnabled.length?'warn':'pass','Developer Portal Privileged Intent 토글',privilegedEnabled.length?`현재 코드가 사용하지 않는 intent가 Developer Portal에서 활성/승인된 것으로 보입니다: ${privilegedEnabled.join(', ')}`:'현재 애플리케이션 플래그에서 불필요한 privileged intent 활성화가 감지되지 않았습니다.','portal-intents'));

  const base=new Set(uniq(input.basePermissions));
  if(base.has('Administrator'))checks.push(check('warn','Administrator 권한', '현재 봇 역할에 Administrator가 있습니다. 이 프로젝트는 Administrator 없이 동작하도록 설계되어 있습니다.','administrator'));
  else checks.push(check('pass','Administrator 권한','Administrator를 사용하지 않습니다. 최소 권한 원칙을 유지합니다.','administrator'));
  for(const permission of REQUIRED_GUILD_PERMISSIONS){
    const granted=base.has(permission)||base.has('Administrator');
    checks.push(check(granted?'pass':'fail',`서버 권한 · ${permission}`,granted?'필요 권한이 있습니다.':permission==='ManageChannels'?'카테고리·채널 자동 설정과 팀 음성방 생성에 필요합니다.':'대시보드에서 Discord 닉네임을 변경할 때 필요합니다.',`base-${permission}`));
  }

  const category=input.category||{};
  if(category.exists&&category.expectedName&&category.name!==category.expectedName)checks.push(check('warn','시참 카테고리 이름',`기준 이름 ${category.expectedName}과 현재 이름 ${category.name||'—'}이 다릅니다. 정책 기준선에서 의도된 변경인지 확인하세요.`,'category-name'));
  const channels=input.channels||{};
  for(const [key,required] of Object.entries(DISCORD_REQUIRED_CHANNEL_PERMISSIONS)){
    const channel=channels[key];
    const label={registration:'시참 채널',teams:'내전 채널',log:'로그 채널'}[key]||key;
    if(!channel?.exists){checks.push(check('warn',`${label} 존재`,`아직 ${label}을 찾지 못했습니다. /setting 또는 대시보드 자동 설정을 실행하세요.`,`channel-${key}`));continue;}
    if(channel.expectedName&&channel.name!==channel.expectedName)checks.push(check('warn',`${label} 이름 drift`,`기준 이름 ${channel.expectedName}과 현재 ${channel.name||'—'}이 다릅니다. 자동으로 이름을 덮어쓰지 않습니다.`,`name-${key}`));
    if(category.exists&&channel.parentId&&channel.parentId!==category.id)checks.push(check('warn',`${label} 위치 drift`,'기준 시참 카테고리 밖에 있습니다. 중복 생성이나 자동 이동 대신 수동 확인이 필요합니다.',`location-${key}`));
    const final=new Set(uniq(channel.permissions));
    const missing=required.filter(permission=>!final.has(permission)&&!base.has('Administrator'));
    checks.push(check(missing.length?'fail':'pass',`${label} 최종 권한`,missing.length?`누락: ${missing.join(', ')}`:`필수 권한 ${required.join(', ')} 확인`, `channel-${key}`));
    if(channel.parentSynced===false)checks.push(check('warn',`${label} 카테고리 동기화`,'상위 카테고리와 권한 overwrite가 분리되어 있습니다. 의도한 설정인지 확인하세요.',`sync-${key}`));
  }

  const scopes=new Set(uniq(input.installScopes).map(v=>v.toLowerCase()));
  const hasBotScope=scopes.has('bot');
  const hasCommandScope=scopes.has('applications.commands')||hasBotScope;
  checks.push(check(hasBotScope?'pass':'warn','Guild Install · bot scope',hasBotScope?'기본 설치 설정에 bot scope가 있습니다.':'기본 설치 설정에서 bot scope를 확인하지 못했습니다. Developer Portal Installation 설정을 확인하세요.','install-bot'));
  checks.push(check(hasCommandScope?'pass':'warn','Application Commands scope',scopes.has('applications.commands')?'applications.commands scope가 설정되어 있습니다.':hasBotScope?'Discord 문서 기준 bot scope 설치에 application commands가 포함됩니다.':'applications.commands 설정을 확인하세요.','install-commands'));
  if(input.guildInstallConfigured===false)checks.push(check('warn','Guild Install 컨텍스트','Guild Install 기본 설정을 확인하지 못했습니다. 이 봇은 서버 설치형으로 사용하는 것이 맞습니다.','guild-install'));
  else checks.push(check('pass','Guild Install 컨텍스트','서버 설치형 구성으로 확인됩니다.','guild-install'));

  const requestedInstall=new Set(uniq(input.installPermissions));
  if(requestedInstall.size){
    const missing=DISCORD_RECOMMENDED_INSTALL_PERMISSIONS.filter(permission=>!requestedInstall.has(permission)&&!requestedInstall.has('Administrator'));
    const excessive=requestedInstall.has('Administrator');
    checks.push(check(excessive?'warn':missing.length?'warn':'pass','기본 설치 권한',excessive?'Developer Portal 기본 설치 권한에 Administrator가 포함되어 있습니다.':missing.length?`권장 최소 권한 중 기본 설치 요청에 없는 항목: ${missing.join(', ')}`:'현재 기능에 맞는 권장 최소 권한이 기본 설치 설정에 포함되어 있습니다.','install-permissions'));
  }else checks.push(check('warn','기본 설치 권한','Developer Portal 기본 설치 permission 값을 확인하지 못했습니다.','install-permissions'));

  const commands=Array.isArray(input.commands)?input.commands:[];
  const names=new Set(commands.map(command=>command.name));
  const missingCommands=['연동','setting'].filter(name=>!names.has(name));
  checks.push(check(missingCommands.length?'fail':'pass','Guild Application Commands',missingCommands.length?`누락된 명령: ${missingCommands.map(n=>`/${n}`).join(', ')}`:'/연동, /setting 명령이 현재 서버에 등록되어 있습니다.','commands'));
  const setting=commands.find(command=>command.name==='setting');
  if(setting){
    if(input.adminRoleId){
      checks.push(check(input.adminRoleExists?'pass':'fail','관리자 역할 설정',input.adminRoleExists?`ADMIN_ROLE_ID 역할 확인 · ${input.adminRoleName||input.adminRoleId}`:'ADMIN_ROLE_ID에 해당하는 역할을 서버에서 찾지 못했습니다.','admin-role'));
      checks.push(check('pass','/setting 런타임 권한','지정 관리자 역할 또는 Manage Guild 권한을 서버 코드에서 다시 검증합니다. 명령 기본 표시 범위와 별개로 실행은 제한됩니다.','setting-runtime'));
    }else{
      const requiredDefault=String(input.manageGuildPermissionValue||'');
      checks.push(check(setting.defaultMemberPermissions===requiredDefault?'pass':'warn','/setting 기본 권한',setting.defaultMemberPermissions===requiredDefault?'Manage Guild 보유 멤버가 기본 실행 대상입니다.':'Discord 명령 기본 권한이 Manage Guild와 일치하는지 확인하세요.','setting-default'));
    }
  }

  const hierarchy=input.hierarchy||{};
  if(hierarchy.botHighestRolePosition===undefined)checks.push(check('warn','역할 hierarchy','봇의 최고 역할 위치를 확인하지 못했습니다.','role-hierarchy'));
  else checks.push(check(hierarchy.botHighestRolePosition>0?'pass':'warn','역할 hierarchy',`봇 최고 역할: ${hierarchy.botHighestRoleName||'알 수 없음'} · 위치 ${hierarchy.botHighestRolePosition}. 닉네임 변경 대상의 최고 역할보다 위에 있어야 합니다.`,'role-hierarchy'));

  const recommendations=[];
  if(base.has('Administrator'))recommendations.push('봇 역할에서 Administrator를 제거하고 필요한 권한만 부여하세요.');
  if(privilegedRequested.length||privilegedEnabled.length)recommendations.push('현재 기능은 Guilds Intent만 사용하므로 GuildMembers, Presence, Message Content intent가 필요하지 않습니다.');
  if(checks.some(item=>item.id?.startsWith('channel-')&&item.status==='fail'))recommendations.push('시참/내전/로그 채널의 permission overwrite에서 봇 역할의 최종 권한을 확인하세요.');
  if(input.adminRoleId&&!input.adminRoleExists)recommendations.push('ADMIN_ROLE_ID를 실제 관리자 역할 ID로 수정하거나 비워 Manage Guild 권한을 사용하세요.');
  recommendations.push(`권장 설치 permission 값: ${String(input.installPermissionValue||'0')} · scopes: bot, applications.commands`);

  const summary=summarizeChecks(checks);
  return {...summary,connected:true,demo:false,checks,recommendations,requiredPermissions:DISCORD_RECOMMENDED_INSTALL_PERMISSIONS,installPermissionValue:String(input.installPermissionValue||'0'),manageGuildPermissionValue:String(input.manageGuildPermissionValue||''),adminRole:{id:input.adminRoleId||'',exists:input.adminRoleId?Boolean(input.adminRoleExists):true,name:input.adminRoleName||''},guild:{name:input.guildName||'',id:input.guildId||'',memberCount:input.memberCount??null},category:input.category||{},bot:{name:input.botName||'',id:input.botId||'',basePermissions:uniq(input.basePermissions)},intents:uniq(input.intents),applicationFlags:uniq(input.applicationFlags),install:{scopes:uniq(input.installScopes),permissions:uniq(input.installPermissions),guildInstallConfigured:input.guildInstallConfigured!==false},commands,channels,outsideCoreChannels:input.outsideCoreChannels||{},hierarchy};
}

