import { installCommunityDiscord } from './community-discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { buildDiscordPermissionAudit, DISCORD_RECOMMENDED_INSTALL_PERMISSIONS } from './discord-permission-audit.js';
import { buildDiscordDriftPlan, validateSafeFixSelection, DISCORD_EXPECTED_COMMANDS } from './discord-drift-fix.js';
import { recruitmentCard, attendanceCard, resultCard, registrationPanel, actionLabels } from './messages.js';

async function ensureSetupChannels(guild) {
  const channels = await guild.channels.fetch();
  const layout = [
    { name: '🔔 ᭄༄・방울! 안내방', channels: [
      ['📢・공지사항', '게임 추첨 결과와 서버 공지 채널입니다.'],
      ['📃・이용규칙', '서버 이용 규칙을 안내하는 채널입니다.'],
      ['🐱・방울소개', '새로 온 멤버를 환영하는 채널입니다.'],
      ['🐱・방울2', '방울 커뮤니티 안내 채널입니다.'],
      ['⭐・어서와요', '새로 온 멤버를 환영하는 채널입니다.']
    ]},
    { name: '📣 ᭄༄・방송 일정', channels: [
      ['🟡・방송안내', '방송 안내 채널입니다.'],
      ['📌・일정표', '방송 일정표 채널입니다.'],
      ['🔵・휴방안내', '휴방 안내 채널입니다.']
    ]},
    { name: '🏠 ᭄༄・커뮤니티', channels: [
      ['🧸・하루의-시작or마지막', '하루의 시작과 마지막을 기록하는 채널입니다.'],
      ['👗・대화방', '멤버 대화 채널입니다.'],
      ['👠・링크-모음', '유용한 링크를 모아두는 채널입니다.']
    ]},
    { name: '🎮 시참', channels: [
      ['🎟️・시참', '시청자 참여 게임 모집과 참가 안내 채널입니다.'],
      ['⚔️・내전', '시청자 내전 모집과 팀 안내 채널입니다.'],
      ['📜・로그', '시참 및 내전 진행 로그 채널입니다.']
    ]},
    { name: '🔔・방울', channels: [
      ['방울・방울방울', '커뮤니티 봇 안내 채널입니다.']
    ]}
  ];
  const result = {};
  for (const group of layout) {
    const categoryAliases = group.name === '🎮 시참' ? ['🎮 ꧁༺ · 시참'] : [];
    let category = channels.find(c => c?.type === ChannelType.GuildCategory && [group.name, ...categoryAliases].includes(c.name));
    if (!category) category = await guild.channels.create({ name: group.name, type: ChannelType.GuildCategory, reason: 'Game roster bot setup' });
    else if (category.name !== group.name) await category.setName(group.name, 'Match reference server layout');
    for (const [name, topic] of group.channels) {
      const aliases = name === '🎟️・시참' ? ['시참', '🎮・시참'] : name === '⚔️・내전' ? ['내전'] : name === '📜・로그' ? ['로그'] : [];
      let channel = channels.find(c => c?.parentId === category.id && [name, ...aliases].includes(c.name) && c.type === ChannelType.GuildText);
      if (!channel) channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, topic, reason: 'Game roster bot setup' });
      else if (channel.name !== name) await channel.setName(name, 'Match reference server layout');
      if (name === '🎟️・시참') result.registration = channel;
      if (name === '📢・공지사항') result.results = channel;
      if (name === '⚔️・내전') result.teams = channel;
      if (name === '📜・로그') result.log = channel;
      if (name === '📃・이용규칙') result.admin = channel;
    }
  }
  return result;
}


const CORE_CHANNEL_DEFS=Object.freeze([
  {key:'registration',name:'🎟️・시참',aliases:['시참','🎮・시참'],topic:'시청자 참여 게임 모집과 참가 안내 채널입니다.'},
  {key:'teams',name:'⚔️・내전',aliases:['내전'],topic:'시청자 내전 모집과 팀 안내 채널입니다.'},
  {key:'log',name:'📜・로그',aliases:['로그'],topic:'시참 및 내전 진행 로그 채널입니다.'}
]);
const POLICY_AUDIT_ACTIONS=new Set([10,11,12,13,14,15,30,31,32,121]);
const POLICY_AUDIT_LABELS={10:'채널 생성',11:'채널 설정 변경',12:'채널 삭제',13:'채널 권한 추가',14:'채널 권한 변경',15:'채널 권한 삭제',30:'역할 생성',31:'역할 변경',32:'역할 삭제',121:'Application Command 권한 변경'};

async function ensureCoreChannelsOnly(guild){
  const all=await guild.channels.fetch();
  let category=all.find(c=>c?.type===ChannelType.GuildCategory&&['🎮 시참','🎮 ꧁༺ · 시참'].includes(c.name));
  // Preflight before any write: never create a duplicate when a legacy/core channel exists elsewhere.
  for(const def of CORE_CHANNEL_DEFS){
    const names=[def.name,...def.aliases],inside=category&&all.find(c=>c?.type===ChannelType.GuildText&&c.parentId===category.id&&names.includes(c.name));
    if(inside)continue;
    const elsewhere=all.find(c=>c?.type===ChannelType.GuildText&&names.includes(c.name));
    if(elsewhere)throw Error(`${elsewhere.name} 채널이 예상 카테고리 밖에 있습니다. 중복 생성을 막기 위해 자동 이동하지 않습니다.`);
  }
  const created=[];
  if(!category){category=await guild.channels.create({name:'🎮 시참',type:ChannelType.GuildCategory,reason:'DaengDaeng Safe Fix · create missing core category'});created.push({type:'category',name:category.name,id:category.id});}
  for(const def of CORE_CHANNEL_DEFS){
    const names=[def.name,...def.aliases];
    let channel=all.find(c=>c?.type===ChannelType.GuildText&&c.parentId===category.id&&names.includes(c.name));
    if(!channel){channel=await guild.channels.create({name:def.name,type:ChannelType.GuildText,parent:category.id,topic:def.topic,reason:'DaengDaeng Safe Fix · create missing core channel'});created.push({type:'channel',key:def.key,name:channel.name,id:channel.id});}
  }
  return created;
}

async function syncProjectGuildCommands(guild,{adminRoleId=''}={}){
  const current=await guild.commands.fetch(),changes=[];
  for(const expected of DISCORD_EXPECTED_COMMANDS){
    const data={name:expected.name,description:expected.description,defaultMemberPermissions:null};
    if(expected.name==='setting')data.defaultMemberPermissions=adminRoleId?null:PermissionFlagsBits.ManageGuild.toString();
    const existing=[...current.values()].find(command=>command.name===expected.name);
    if(!existing){const created=await guild.commands.create(data);changes.push({action:'create',name:created.name,id:created.id});continue;}
    const desiredPermission=expected.name==='setting'?(adminRoleId?null:PermissionFlagsBits.ManageGuild.toString()):null;
    const currentPermission=existing.defaultMemberPermissions?.toString?.()??null;
    if(existing.description!==expected.description||currentPermission!==desiredPermission){
      const edited=await guild.commands.edit(existing.id,data);changes.push({action:'edit',name:edited.name,id:edited.id});
    }
  }
  return changes;
}

export class DiscordService {
  constructor(client,guildId,operations,reporter=null) { this.client=client;this.guildId=guildId;this.operations=operations;this.queue=Promise.resolve();this.warning='';this.reporter=typeof reporter==='function'?reporter:null;this.auditCache=null;this.auditAt=0;this.auditAdminRoleId='';this.auditBaselineDigest='';this.policyAuditCache=[];this.policyAuditAt=0; }
  report(event){try{this.reporter?.(event)}catch{}}
  async observe(operation,fn){const started=Date.now();try{const result=await fn();this.report({operation,ok:true,durationMs:Date.now()-started});return result;}catch(error){this.report({operation,ok:false,durationMs:Date.now()-started,error});throw error;}}
  serial(operation,fn){const run=this.queue.catch(()=>{}).then(()=>this.observe(operation,fn));this.queue=run;return run;}
  async channels() {
    const guild=await this.client.guilds.fetch(this.guildId),all=await guild.channels.fetch();
    const category=all.find(c=>c?.type===ChannelType.GuildCategory&&['🎮 시참','🎮 ꧁༺ · 시참'].includes(c.name));
    const lookup=names=>all.find(c=>category&&c?.parentId===category.id&&c.type===ChannelType.GuildText&&names.includes(c.name));
    const broadcastCategory=all.find(c=>c?.type===ChannelType.GuildCategory&&['📣 ᭄༄・방송 일정','📣・방송 일정','방송 일정'].includes(c.name));
    const broadcastNotice=all.find(c=>broadcastCategory&&c?.parentId===broadcastCategory.id&&c.type===ChannelType.GuildText&&['🟡・방송안내','방송안내'].includes(c.name));
    return {guild,all,category,broadcastCategory,broadcastNotice,registration:lookup(['🎟️・시참','시참','🎮・시참']),teams:lookup(['⚔️・내전','내전']),log:lookup(['📜・로그','로그'])};
  }
  async requireChannels(embed=false){
    const c=await this.channels();
    if(!c.registration||!c.teams||!c.log)throw Error('채널 자동 설정 버튼 또는 /setting을 먼저 실행해 주세요.');
    const registration=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory];
    if(embed)registration.push(PermissionFlagsBits.EmbedLinks);
    if(!c.registration.permissionsFor(this.client.user)?.has(registration))throw Error('시참 채널의 채널 보기·메시지 보내기·메시지 기록 보기 권한을 확인해 주세요.');
    if(!c.teams.permissionsFor(this.client.user)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]))throw Error('내전 채널의 채널 보기·메시지 보내기·메시지 기록 보기 권한을 확인해 주세요.');
    if(!c.log.permissionsFor(this.client.user)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw Error('로그 채널의 채널 보기·메시지 보내기 권한을 확인해 주세요.');
    return c;
  }
  async editOrSend(channel,ref,payload) {
    if(ref?.channelId===channel.id){
      try{const message=await channel.messages.fetch(ref.id);await message.edit(payload);return ref;}
      catch(error){if(error.code!==10008)throw error;}
    }
    const message=await channel.send(payload);return {channelId:channel.id,id:message.id};
  }
  setup(){return this.serial('setup',async()=>{
    this.auditAt=0;
    const channels=await ensureSetupChannels(await this.client.guilds.fetch(this.guildId));
    const ref=await this.editOrSend(channels.registration,this.operations.read().panel,registrationPanel);
    await this.operations.update(state=>{state.panel=ref;});this.warning='';
  });}
  sync(action){return this.serial(`sync:${action||'sync'}`,async()=>{
    const state=this.operations.read(),s=state.session;if(!s)return;
    const c=await this.requireChannels(true),refs={...(s.messages||{})};
    refs.recruitment=await this.editOrSend(c.registration,refs.recruitment,recruitmentCard(s));
    if(s.deadline){
      const payload=attendanceCard(s);
      // Only starting a check sends mentions; subsequent edits update counts quietly.
      if(action!=='attendance')payload.allowedMentions={parse:[]};
      refs.attendance=await this.editOrSend(c.registration,refs.attendance,payload);
    }
    if(s.winners.length||s.teams.length){
      refs.result=await this.editOrSend(c.registration,refs.result,resultCard({...s,teams:[]}));
      if(s.teams.length)refs.teams=await this.editOrSend(c.teams,refs.teams,resultCard(s));
    }
    await this.operations.update(next=>{if(next.session?.id===s.id)next.session.messages=refs;});
    if(action&&action!=='sync')await c.log.send({content:`[${actionLabels[action]||action}] ${s.round||1}판 · 신청 ${s.applicants.filter(id=>!(s.postponed||[]).includes(id)).length}명 · 선정 ${s.winners.length}명 · 참석 ${s.confirmed.length}명`,allowedMentions:{parse:[]}});
    this.warning='';
  }).catch(error=>{this.warning=error.code===50013?'Discord 권한이 부족합니다. 권한 점검 후 안내 동기화를 누르세요.':error.message;throw error;});}
  voice(){return this.serial('voice',async()=>{
    const s=this.operations.read().session;if(!s||s.phase==='ended'||!s.teams.length)throw Error('진행 중인 모집의 팀 편성을 먼저 완료해 주세요.');
    const c=await this.requireChannels();
    for(let i=0;i<s.teams.length;i++){
      const name=`팀 ${i+1} · ${s.id.slice(0,8)}`;
      if(!c.all.some(ch=>ch?.type===ChannelType.GuildVoice&&ch.parentId===c.category.id&&ch.name===name))await c.guild.channels.create({name,type:ChannelType.GuildVoice,parent:c.category.id,reason:'댕댕봇 팀 음성방'});
    }
  });}
  async rename(records) {
    const started=Date.now(),results=[];let guild;
    try{guild=await this.client.guilds.fetch(this.guildId);}catch(error){this.report({operation:'rename',ok:false,durationMs:Date.now()-started,error,failures:records.length,total:records.length});throw error;}
    for(const r of records){
      try{
        if(!r.chzzkName||r.chzzkName.length>32)throw Error('닉네임은 1~32자여야 합니다.');
        const member=await guild.members.fetch(r.discordId);
        if(!member.manageable)throw Error('서버 소유자이거나 봇보다 역할이 높아 변경할 수 없습니다.');
        await member.setNickname(r.chzzkName,'댕댕봇 대시보드 닉네임 적용');results.push({discordId:r.discordId,ok:true});
      }catch(error){results.push({discordId:r.discordId,ok:false,error:error.code===50013?'별명 관리 권한 또는 역할 순서를 확인해 주세요.':error.code===10007?'서버에 없는 멤버입니다.':error.message});}
    }
    const failures=results.filter(r=>!r.ok).length;this.report({operation:'rename',ok:failures===0,durationMs:Date.now()-started,failures,total:results.length,error:failures?Error(`${failures}명의 닉네임 변경 실패`):null});
    return results;
  }
  async configurationAudit({adminRoleId='',force=false,baseline=null}={}){
    const started=Date.now(),baselineDigest=String(baseline?.digest||'');
    if(!force&&this.auditCache&&this.auditAdminRoleId===adminRoleId&&this.auditBaselineDigest===baselineDigest&&Date.now()-this.auditAt<30000)return this.auditCache;
    if(!this.client.isReady())return buildDiscordPermissionAudit({connected:false,message:'Discord client is not ready'});
    try{
      const c=await this.channels(),guild=c.guild;
      const baselineSnapshot=baseline?.snapshot||baseline||null;
      const baselineCategoryId=baselineSnapshot?.category?.id||null;
      const resolvedCategory=c.category||(baselineCategoryId?c.all.get(baselineCategoryId):null);
      const resolvedChannels={};
      for(const def of CORE_CHANNEL_DEFS){const normal=c[def.key];const baselineId=baselineSnapshot?.channels?.[def.key]?.id||null;const byId=baselineId?c.all.get(baselineId):null;resolvedChannels[def.key]=normal||(byId?.type===ChannelType.GuildText?byId:null);}
      const me=guild.members.me||await guild.members.fetchMe();
      const app=await this.client.application.fetch();
      const commands=await guild.commands.fetch();
      const appFlags=app.flags?.toArray?.()||[];
      const intents=this.client.options?.intents?.toArray?.()||[];
      const installSource=(()=>{
        const config=app.integrationTypesConfig;
        if(config){
          const entries=config instanceof Map?[...config.entries()]:Object.entries(config);
          const guildInstall=entries.find(([key])=>String(key)==='0')?.[1];
          if(guildInstall?.oauth2InstallParams)return guildInstall.oauth2InstallParams;
          if(guildInstall?.scopes||guildInstall?.permissions)return guildInstall;
        }
        return app.installParams||null;
      })();
      const installScopes=[...(installSource?.scopes||[])].map(String);
      const installPermissions=installSource?.permissions?.toArray?.()||[];
      const recommendedValue=DISCORD_RECOMMENDED_INSTALL_PERMISSIONS.reduce((value,key)=>value|(PermissionFlagsBits[key]||0n),0n).toString();
      const manageGuildValue=PermissionFlagsBits.ManageGuild.toString();
      const channelSnapshot=(channel,key)=>{const def=CORE_CHANNEL_DEFS.find(item=>item.key===key);return {
        exists:Boolean(channel),
        id:channel?.id||null,
        name:channel?.name||null,
        expectedName:def?.name||null,
        parentId:channel?.parentId||null,
        topic:channel?.topic??null,
        parentSynced:channel?.permissionsLocked??null,
        permissions:channel?.permissionsFor(me)?.toArray?.()||[],
        required:key==='registration'?['ViewChannel','SendMessages','ReadMessageHistory','EmbedLinks']:key==='teams'?['ViewChannel','SendMessages','ReadMessageHistory']:['ViewChannel','SendMessages']
      };};
      const outsideCoreChannels=Object.fromEntries(CORE_CHANNEL_DEFS.map(def=>{
        if(resolvedChannels[def.key])return [def.key,null];
        const names=[def.name,...def.aliases],outside=c.all.find(channel=>channel?.type===ChannelType.GuildText&&names.includes(channel.name)&&(!resolvedCategory||channel.parentId!==resolvedCategory.id));
        return [def.key,outside?{id:outside.id,name:outside.name,parentId:outside.parentId||null}:null];
      }));
      let adminRole=null;
      if(adminRoleId)adminRole=await guild.roles.fetch(adminRoleId).catch(()=>null);
      const result=buildDiscordPermissionAudit({
        connected:true,guildId:guild.id,guildName:guild.name,memberCount:guild.memberCount,botId:this.client.user.id,botName:this.client.user.username,
        intents,applicationFlags:appFlags,basePermissions:me.permissions.toArray(),
        category:{exists:Boolean(resolvedCategory),id:resolvedCategory?.id||null,name:resolvedCategory?.name||null,expectedName:'🎮 시참'},
        channels:{registration:channelSnapshot(resolvedChannels.registration,'registration'),teams:channelSnapshot(resolvedChannels.teams,'teams'),log:channelSnapshot(resolvedChannels.log,'log')},outsideCoreChannels,
        installScopes,installPermissions,guildInstallConfigured:Boolean((app.integrationTypesConfig&&((app.integrationTypesConfig instanceof Map&&app.integrationTypesConfig.has(0))||Object.prototype.hasOwnProperty.call(app.integrationTypesConfig,'0')))||installScopes.includes('bot')),
        commands:[...commands.values()].map(command=>({name:command.name,id:command.id,description:command.description,defaultMemberPermissions:command.defaultMemberPermissions?.toString?.()??null})),
        adminRoleId,adminRoleExists:adminRoleId?Boolean(adminRole):true,adminRoleName:adminRole?.name||'',manageGuildPermissionValue:manageGuildValue,
        installPermissionValue:recommendedValue,hierarchy:{botHighestRoleId:me.roles.highest?.id||null,botHighestRoleName:me.roles.highest?.name||'',botHighestRolePosition:me.roles.highest?.position??0}
      });
      this.auditCache=result;this.auditAt=Date.now();this.auditAdminRoleId=adminRoleId;this.auditBaselineDigest=baselineDigest;
      this.report({operation:'permission-audit',ok:result.status!=='fail',durationMs:Date.now()-started,error:result.status==='fail'?Error('Discord permission audit failed'):null});
      return result;
    }catch(error){
      this.report({operation:'permission-audit',ok:false,durationMs:Date.now()-started,error});
      return buildDiscordPermissionAudit({connected:false,message:'Discord 권한·설치 구성을 확인하지 못했습니다.'});
    }
  }
  async safeFixPlan({adminRoleId='',force=false,baseline=null}={}){
    const audit=await this.configurationAudit({adminRoleId,force,baseline});
    return buildDiscordDriftPlan(audit);
  }
  applySafeFix({actionIds=[],adminRoleId='',expectedDigest='',baseline=null}={}){return this.serial('discord-safe-fix',async()=>{
    const before=await this.configurationAudit({adminRoleId,force:true,baseline}),plan=buildDiscordDriftPlan(before);
    if(expectedDigest&&plan.digest!==expectedDigest)throw Error('Discord 설정이 수정 계획을 만든 뒤 변경됐습니다. Dry Run을 다시 실행해 주세요.');
    const ids=validateSafeFixSelection(plan,actionIds),results=[];
    for(const action of ids){
      try{
        if(action==='ensure-core-channels'){
          const guild=await this.client.guilds.fetch(this.guildId),created=await ensureCoreChannelsOnly(guild);results.push({action,ok:true,changes:created});
        }else if(action==='sync-guild-commands'){
          const guild=await this.client.guilds.fetch(this.guildId),changes=await syncProjectGuildCommands(guild,{adminRoleId});results.push({action,ok:true,changes});
        }else throw Error(`지원하지 않는 Discord 안전 수정입니다: ${action}`);
      }catch(error){results.push({action,ok:false,error:error?.message||'Discord 수정 실패'});}
    }
    this.auditCache=null;this.auditAt=0;this.auditAdminRoleId='';this.auditBaselineDigest='';
    const audit=await this.configurationAudit({adminRoleId,force:true,baseline}),nextPlan=buildDiscordDriftPlan(audit),applied=results.filter(item=>item.ok).map(item=>item.action),failed=results.filter(item=>!item.ok).map(item=>item.action);
    return {ok:failed.length===0,partial:applied.length>0&&failed.length>0,applied,failed,results,audit,plan:nextPlan};
  });}
  async policySnapshot({adminRoleId='',baseline=null,force=false}={}){
    const audit=await this.configurationAudit({adminRoleId,baseline,force});
    return {
      capturedAt:Date.now(),guild:audit.guild||{id:this.guildId,name:''},category:audit.category||null,channels:audit.channels||{},commands:audit.commands||[],
      bot:{basePermissions:audit.bot?.basePermissions||[],highestRoleId:audit.hierarchy?.botHighestRoleId||null,highestRoleName:audit.hierarchy?.botHighestRoleName||null},
      intents:audit.intents||[],applicationFlags:audit.applicationFlags||[],install:audit.install||{},adminRole:audit.adminRole||{id:adminRoleId,exists:true,name:''}
    };
  }
  async recentConfigurationChanges({sinceAt=0,force=false}={}){
    if(!this.client.isReady())return {available:false,reason:'Discord 연결 대기 중',entries:[]};
    const guild=await this.client.guilds.fetch(this.guildId),me=guild.members.me||await guild.members.fetchMe();
    if(!me.permissions.has(PermissionFlagsBits.ViewAuditLog)&&!me.permissions.has(PermissionFlagsBits.Administrator))return {available:false,reason:'View Audit Log 권한을 추가하면 변경 주체를 선택적으로 표시할 수 있습니다. 기준선 비교 자체에는 이 권한이 필요하지 않습니다.',entries:[]};
    if(!force&&Date.now()-this.policyAuditAt<60000)return {available:true,entries:this.policyAuditCache.filter(entry=>entry.at>=sinceAt)};
    const logs=await guild.fetchAuditLogs({limit:50}),entries=[];
    for(const entry of logs.entries.values()){const action=Number(entry.action);if(!POLICY_AUDIT_ACTIONS.has(action))continue;const at=Number(entry.createdTimestamp)||0;entries.push({id:entry.id,at,targetId:entry.targetId||null,action,actionLabel:POLICY_AUDIT_LABELS[action]||String(action),actorName:entry.executor?.globalName||entry.executor?.username||'알 수 없음',actorBot:Boolean(entry.executor?.bot),reason:entry.reason||''});}
    this.policyAuditCache=entries;this.policyAuditAt=Date.now();return {available:true,entries:entries.filter(entry=>entry.at>=sinceAt)};
  }
  policyAlert({status='drift',counts={},items=[]}={}){return this.serial('policy-alert',async()=>{
    const c=await this.channels(),channel=c.log;if(!channel)throw Error('Discord 로그 채널을 찾지 못했습니다.');
    const me=c.guild.members.me||await c.guild.members.fetchMe();if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw Error('Discord 로그 채널에 메시지를 보낼 권한이 없습니다.');
    const drift=status==='drift',head=drift?'⚠️ Discord Policy Drift 감지':'✅ Discord Policy Drift 해소',summary=drift?`기준선과 다른 설정 ${Number(counts.total)||0}개 · SAFE ${Number(counts.safe)||0} / MANUAL ${Number(counts.manual)||0}`:'현재 Discord 설정이 저장된 정상 기준선과 다시 일치합니다.';
    const details=drift?(items||[]).slice(0,5).map(item=>`• ${item.kind==='safe'?'SAFE':'MANUAL'} · ${item.title||item.id}`).join('\n'):'';
    const content=[head,summary,details].filter(Boolean).join('\n').slice(0,1900);await channel.send({content,allowedMentions:{parse:[]}});return {channelId:channel.id};
  });}

  async chzzkLiveAlertReadiness(){
    if(!this.client.isReady())return {ready:false,code:'discord_not_ready',message:'Discord 연결 대기 중입니다.'};
    try{
      const c=await this.channels(),channel=c.broadcastNotice||c.log;
      if(!channel)return {ready:false,code:'broadcast_channel_missing',message:'Discord 방송안내 또는 로그 채널을 찾지 못했습니다. /setting으로 채널 상태를 복구해 주세요.'};
      const me=c.guild.members.me||await c.guild.members.fetchMe(),required=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks];
      if(!channel.permissionsFor(me)?.has(required))return {ready:false,code:'broadcast_channel_permission',message:'Discord 방송 알림 채널의 보기/메시지 보내기/링크 임베드 권한이 필요합니다.',channelId:channel.id};
      return {ready:true,code:'ready',channelId:channel.id,fallback:channel.id===c.log?.id};
    }catch(error){return {ready:false,code:'discord_check_failed',message:error?.message||'Discord 방송 알림 채널 상태를 확인하지 못했습니다.'};}
  }
  chzzkLiveAlert(event={}){return this.serial('chzzk-live-alert',async()=>{
    const readiness=await this.chzzkLiveAlertReadiness();if(!readiness.ready)throw Object.assign(Error(readiness.message),{code:readiness.code});
    const c=await this.channels(),channel=c.broadcastNotice||c.log,live=event.live||{},channelId=String(live.channelId||'').trim(),url=channelId?`https://chzzk.naver.com/live/${encodeURIComponent(channelId)}`:'https://chzzk.naver.com/';
    const title=String(live.liveTitle||'방송').replace(/[\r\n]+/g,' ').slice(0,240),category=String(live.liveCategoryValue||'카테고리 미지정').replace(/[\r\n]+/g,' ').slice(0,120),name=String(live.channelName||'치지직 채널').replace(/[\r\n]+/g,' ').slice(0,120),start=event.type==='start';
    const embed=new EmbedBuilder().setTitle(start?'🔴 방송이 시작되었습니다':'⚫ 방송이 종료되었습니다').setDescription(start?`**${title}**\n${category}`:`${name}님의 방송이 종료되었습니다.`).setURL(url).setFooter({text:'CHZZK 공식 Open API 방송 상태 감지'}).setTimestamp(new Date(Number(event.detectedAt)||Date.now()));
    if(start){embed.addFields({name:'채널',value:name,inline:true},{name:'시청자',value:String(Math.max(0,Number(live.concurrentUserCount)||0)),inline:true});const image=String(live.liveThumbnailImageUrl||'');if(/^https:\/\//i.test(image))embed.setImage(image);}
    const message=await channel.send({embeds:[embed],allowedMentions:{parse:[]}});return {channelId:channel.id,id:message.id};
  });}
  broadcastOpsNotice({title='방송 운영 알림',message='',kind='schedule'}={}){return this.serial('broadcast-ops-notice',async()=>{
    const c=await this.channels(),channel=c.broadcastNotice||c.log;if(!channel)throw Error('Discord 방송 알림 또는 로그 채널을 찾지 못했습니다.');
    const me=c.guild.members.me||await c.guild.members.fetchMe();if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw Error('Discord 방송 알림 채널의 보기/메시지 보내기 권한이 필요합니다.');
    const prefix=kind==='schedule'?'📅':kind==='poll'?'📊':'📣',content=[`${prefix} ${String(title).replace(/[\r\n]+/g,' ').slice(0,120)}`,String(message||'').slice(0,1600)].filter(Boolean).join('\n');
    const sent=await channel.send({content,allowedMentions:{parse:[]}});return {channelId:channel.id,id:sent.id};
  });}
  async naverCafeAlertReadiness(){
    if(!this.client.isReady())return {ready:false,code:'discord_not_ready',message:'Discord 연결 대기 중입니다.'};
    try{
      const c=await this.channels(),channel=c.log;
      if(!channel)return {ready:false,code:'log_channel_missing',message:'Discord 로그 채널을 찾지 못했습니다. /setting으로 채널 상태를 복구해 주세요.'};
      const me=c.guild.members.me||await c.guild.members.fetchMe();
      if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))return {ready:false,code:'log_channel_permission',message:'Discord 로그 채널의 보기/메시지 보내기 권한이 필요합니다.'};
      return {ready:true,code:'ready',channelId:channel.id};
    }catch(error){return {ready:false,code:'discord_check_failed',message:error?.message||'Discord 로그 채널 상태를 확인하지 못했습니다.'};}
  }
  naverCafeAlert(article={}){return this.serial('naver-cafe-alert',async()=>{
    const readiness=await this.naverCafeAlertReadiness();
    if(!readiness.ready)throw Object.assign(Error(readiness.message),{code:readiness.code});
    const c=await this.channels(),channel=c.log;
    const title=String(article.title||'새 네이버 카페글').replace(/[\r\n]+/g,' ').slice(0,240),cafe=String(article.cafeName||'네이버 카페').replace(/[\r\n]+/g,' ').slice(0,120),link=String(article.link||'').slice(0,1200);
    const content=['🟢 네이버 카페 새 공개글',`[${cafe}] ${title}`,link].filter(Boolean).join('\n').slice(0,1900);
    const message=await channel.send({content,allowedMentions:{parse:[]}});return {channelId:channel.id,id:message.id};
  });}
  participationCall(entry,{messageRef=null,token='',deadline=0,timeoutSeconds=60,recall=false}={}){return this.serial(recall?'participation-call-recall':'participation-call',async()=>{
    const c=await this.requireChannels(),channel=c.registration,discordUserId=String(entry?.discordUserId||'').trim(),name=String(entry?.displayName||'참가자').replace(/[\r\n]+/g,' ').slice(0,80),unix=Math.max(0,Math.floor(Number(deadline)/1000));
    const lines=[recall?'🔔 시참 재호출':'🔔 다음 시참 참가자 호출',discordUserId?`<@${discordUserId}> · ${name}님 차례입니다.`:`${name}님 차례입니다.`,discordUserId?`<t:${unix}:R>까지 아래 버튼으로 응답해 주세요.`:`약 ${Number(timeoutSeconds)||60}초 안에 방송 진행자에게 참가 여부를 알려 주세요.`];
    const payload={content:lines.join('\n').slice(0,1900),allowedMentions:discordUserId?{parse:[],users:[discordUserId]}:{parse:[]},components:[]};
    if(discordUserId){payload.components=[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`queuecall:join:${entry.id}:${token}`).setLabel('참가합니다').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`queuecall:pass:${entry.id}:${token}`).setLabel('이번판 패스').setStyle(ButtonStyle.Secondary))];}
    return this.editOrSend(channel,messageRef,payload);
  });}
  completeParticipationCall(ref,{entry,status}={}){return this.serial('participation-call-complete',async()=>{
    if(!ref?.channelId||!ref?.id)return null;const c=await this.channels(),channel=c.all.get(ref.channelId);if(!channel||channel.type!==ChannelType.GuildText)return null;
    const me=c.guild.members.me||await c.guild.members.fetchMe();if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]))return null;
    let message;try{message=await channel.messages.fetch(ref.id);}catch(error){if(error.code===10008)return null;throw error;}
    const labels={joined:'✅ 참가 확인 완료',postponed_next:'⏭️ 이번판 패스 · 다음판으로 이동',postponed_next2:'⏭️ 다다음판으로 이동',no_show:'⌛ 응답 시간 초과 · 노쇼 처리',cancelled:'⛔ 호출 취소',waiting:'↩️ 호출 취소 · 대기열 복귀'},label=labels[status]||'시참 호출 종료',name=String(entry?.displayName||'참가자').replace(/[\r\n]+/g,' ').slice(0,80);
    await message.edit({content:`${label}\n${name}`,components:[],allowedMentions:{parse:[]}});return ref;
  });}
  async diagnostics(){
    const started=Date.now();
    if(!this.client.isReady()){const error=Error('Discord client is not ready');this.report({operation:'diagnostics',ok:false,durationMs:Date.now()-started,error});return {connected:false,message:'Discord 연결 대기 중',warning:this.warning};}
    try{const c=await this.channels(),me=c.guild.members.me||await c.guild.members.fetchMe(),result={connected:true,guild:c.guild.name,bot:this.client.user.username,warning:this.warning,checks:[
      {label:'시참·내전·로그 채널',ok:Boolean(c.registration&&c.teams&&c.log)},
      ...[['채널 보기',PermissionFlagsBits.ViewChannel],['메시지 보내기',PermissionFlagsBits.SendMessages],['링크 임베드',PermissionFlagsBits.EmbedLinks],['메시지 기록 보기',PermissionFlagsBits.ReadMessageHistory]].map(([label,flag])=>({label,ok:Boolean(c.registration?.permissionsFor(me)?.has(flag))})),
      {label:'내전 채널 보기·전송',ok:Boolean(c.teams?.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))},
      {label:'내전 메시지 기록 보기',ok:Boolean(c.teams?.permissionsFor(me)?.has(PermissionFlagsBits.ReadMessageHistory))},
      {label:'로그 채널 보기·전송',ok:Boolean(c.log?.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))},
      {label:'채널 관리',ok:Boolean(me.permissions.has(PermissionFlagsBits.ManageChannels))},
      {label:'별명 관리',ok:Boolean(me.permissions.has(PermissionFlagsBits.ManageNicknames))}
    ]};this.report({operation:'diagnostics',ok:true,durationMs:Date.now()-started});return result;}catch(error){this.report({operation:'diagnostics',ok:false,durationMs:Date.now()-started,error});return {connected:false,message:'서버 접근 권한을 확인해 주세요.',warning:this.warning};}
  }
}

export class DemoDiscordService {
  constructor(reporter=null){this.warning='';this.messages=[];this.reporter=typeof reporter==='function'?reporter:null;}
  report(operation){try{this.reporter?.({operation,ok:true,durationMs:0})}catch{}}
  async requireChannels(){return {};}
  async setup(){this.messages.push('setup');this.report('setup');}
  async sync(action){this.messages.push(action);this.report(`sync:${action||'sync'}`);}
  async voice(){this.messages.push('voice');this.report('voice');}
  async rename(records){this.report('rename');return records.map(r=>({discordId:r.discordId,ok:true}));}
  async participationCall(entry,{messageRef=null}={}){this.messages.push(`participation-call:${String(entry?.displayName||'')}`);this.report('participation-call');return messageRef||{channelId:'demo',id:`call-${this.messages.length}`};}
  async completeParticipationCall(_ref,{entry,status}={}){this.messages.push(`participation-call-complete:${String(entry?.displayName||'')}:${String(status||'')}`);this.report('participation-call-complete');return {demo:true};}
  async diagnostics(){return {connected:false,demo:true,message:'연습 모드 · Discord로 전송하지 않습니다.',checks:[]};}
  async configurationAudit(){return buildDiscordPermissionAudit({connected:false,demo:true,message:'연습 모드'});}
  async safeFixPlan(){return buildDiscordDriftPlan(await this.configurationAudit());}
  async policySnapshot(){const audit=await this.configurationAudit();return {capturedAt:Date.now(),guild:{id:'demo',name:'연습 모드'},category:audit.category||null,channels:audit.channels||{},commands:audit.commands||[],bot:{basePermissions:[]},intents:[],applicationFlags:[],install:{},adminRole:{id:'',exists:true,name:''}};}
  async recentConfigurationChanges(){return {available:false,reason:'연습 모드',entries:[]};}
  async policyAlert(){this.messages.push('policy-alert');this.report('policy-alert');return {demo:true};}

  async chzzkLiveAlertReadiness(){return {ready:true,code:'demo',channelId:'demo'};}
  async chzzkLiveAlert(event={}){this.messages.push(`chzzk-live-alert:${String(event.type||'')}`);this.report('chzzk-live-alert');return {demo:true,channelId:'demo',id:`demo-${this.messages.length}`};}
  broadcastOpsNotice({title='방송 운영 알림',message='',kind='schedule'}={}){return this.serial('broadcast-ops-notice',async()=>{
    const c=await this.channels(),channel=c.broadcastNotice||c.log;if(!channel)throw Error('Discord 방송 알림 또는 로그 채널을 찾지 못했습니다.');
    const me=c.guild.members.me||await c.guild.members.fetchMe();if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw Error('Discord 방송 알림 채널의 보기/메시지 보내기 권한이 필요합니다.');
    const prefix=kind==='schedule'?'📅':kind==='poll'?'📊':'📣',content=[`${prefix} ${String(title).replace(/[\r\n]+/g,' ').slice(0,120)}`,String(message||'').slice(0,1600)].filter(Boolean).join('\n');
    const sent=await channel.send({content,allowedMentions:{parse:[]}});return {channelId:channel.id,id:sent.id};
  });}
  async broadcastOpsNotice({title='',kind=''}={}){this.messages.push(`broadcast-ops-notice:${String(kind)}:${String(title)}`);this.report('broadcast-ops-notice');return {demo:true,channelId:'demo',id:`demo-${this.messages.length}`};}
  async naverCafeAlertReadiness(){return {ready:true,code:'demo',channelId:'demo'};}
  async naverCafeAlert(article={}){this.messages.push(`naver-cafe-alert:${String(article.title||'')}`);this.report('naver-cafe-alert');return {demo:true,channelId:'demo',id:`demo-${this.messages.length}`};}
  async applySafeFix(){throw Error('연습 모드에서는 Discord 설정을 변경하지 않습니다.');}
}

installCommunityDiscord(DiscordService,DemoDiscordService);
