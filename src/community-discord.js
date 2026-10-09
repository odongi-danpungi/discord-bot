import { PermissionFlagsBits } from 'discord.js';
import { TOPICS, communityView, participantEntryUrl } from './community.js';
import { buildParticipantSelfServiceState,performParticipantSelfServiceAction } from './participant-self-service.js';

export const communityButtons=()=>[{type:1,components:[{type:2,style:1,custom_id:'community:home',label:'내 시참'},{type:2,style:2,custom_id:'community:guide',label:'규칙 · FAQ'},{type:2,style:2,custom_id:'community:subscriptions',label:'알림 구독'},{type:2,style:2,custom_id:'community:ticket',label:'운영자 문의'}]}];
export function installCommunityDiscord(DiscordService,DemoDiscord){
  DiscordService.prototype.communityOptions=async function(){const guild=await this.client.guilds.fetch(this.guildId),channels=await guild.channels.fetch(),roles=await guild.roles.fetch(),me=await guild.members.fetchMe();return {channels:[...channels.values()].filter(c=>c?.isTextBased()&&c.send&&c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages])).map(c=>({id:c.id,name:c.name})),roles:[...roles.values()].filter(r=>r.id!==guild.id&&!r.managed&&r.permissions.bitfield===0n&&r.comparePositionTo(me.roles.highest)<0&&!channels.some(c=>c?.permissionOverwrites?.cache?.get(r.id)?.allow?.bitfield>0n)).map(r=>({id:r.id,name:r.name}))};};
  DemoDiscord.prototype.communityOptions=async()=>({channels:[{id:'111111111111111111',name:'연습 공지 채널'}],roles:Object.keys(TOPICS).map((t,i)=>({id:'22222222222222222'+i,name:TOPICS[t]+' 알림'}))});
  DiscordService.prototype.communityNotice=function({channelId,title,content,roleId=''}){return this.serial('community-notice',async()=>{const guild=await this.client.guilds.fetch(this.guildId),channel=await guild.channels.fetch(channelId);if(!channel?.isTextBased()||!channel.send)throw Error('텍스트 채널을 선택하세요.');const sent=await channel.send({content:`${roleId?`<@&${roleId}>\n`:''}${title}\n${content}`,allowedMentions:{parse:[],roles:roleId?[roleId]:[],users:[],repliedUser:false}});return {id:sent.id,channelId:channel.id};});};
  DiscordService.prototype.communityPanel=function({channelId,ref}){return this.serial('community-panel',async()=>{const guild=await this.client.guilds.fetch(this.guildId),channel=await guild.channels.fetch(channelId);if(!channel?.send)throw Error('텍스트 채널을 선택하세요.');return this.editOrSend(channel,ref,{content:'내 시참 · 규칙 · 알림 · 문의\n개인 정보는 본인에게만 표시됩니다.',components:communityButtons(),allowedMentions:{parse:[]}});});};
  DiscordService.prototype.communitySubscription=async function({userId,roleId,enabled}){
    const guild=await this.client.guilds.fetch(this.guildId),role=await guild.roles.fetch(roleId),member=await guild.members.fetch(userId),me=await guild.members.fetchMe();
    if(!role||role.id===guild.id||role.managed||role.permissions.bitfield!==0n||role.comparePositionTo(me.roles.highest)>=0||!me.permissions.has(PermissionFlagsBits.ManageRoles))throw Error('권한 없는 알림 전용 역할과 역할 관리 권한이 필요합니다.');
    const channels=await guild.channels.fetch();if(channels.some(ch=>ch?.permissionOverwrites?.cache?.get(roleId)?.allow?.bitfield>0n))throw Error('채널 접근 권한이 있는 역할은 구독용으로 사용할 수 없습니다.');
    if(enabled)await member.roles.add(roleId,'사용자가 게임 알림 구독');else await member.roles.remove(roleId,'사용자가 게임 알림 해제');
  };
  DemoDiscord.prototype.communityNotice=async function(){return {id:'demo-'+Date.now(),channelId:'demo'};};
  DemoDiscord.prototype.communityPanel=async function(){return {id:'demo-panel',channelId:'demo'};};
  DemoDiscord.prototype.communitySubscription=async function(){};
}
const button=(custom_id,label)=>({type:2,style:2,custom_id,label});
export async function handleCommunityInteraction(interaction,ctx){
  const custom=interaction.customId||'';if(!custom.startsWith('community:'))return false;
  const userId=interaction.user.id,kind=custom.split(':')[1],{operations,service,viewerAuth,config,store,participationQueue,participationCalls,discord}=ctx;
  const records=store.read().filter(r=>r.guildId===config.guildId),profile=records.find(r=>r.discordId===userId);
  if(kind==='ticket'&&!interaction.isModalSubmit()){
    await interaction.showModal({custom_id:'community:ticket',title:'운영자 문의',components:[{type:1,components:[{type:4,custom_id:'message',label:'문의 내용 (비밀번호·토큰 입력 금지)',style:2,required:true,max_length:1000}]}]});return true;
  }
  await interaction.deferReply({flags:64});
  if(kind==='ticket'){await service.ticket(userId,{message:interaction.fields.getTextInputValue('message')});await interaction.editReply('문의를 접수했습니다. 내 시참 → 내 문의에서 답변을 확인하세요.');return true;}
  if(kind==='sub'){const [, ,topic,value]=custom.split(':');await service.subscribe(userId,{topic,enabled:value==='on'});}
  if(kind==='act'){
    const [, ,action,sessionId]=custom.split(':');if(sessionId!==(operations.read().session?.id||'none'))throw Error('회차가 변경됐습니다. 내 시참을 다시 열어 주세요.');
    await performParticipantSelfServiceAction({action,userId,profile,operations,participationQueue,participationCalls,records});await discord.sync('sync').catch(()=>{});
  }
  if(kind==='cancel')await performParticipantSelfServiceAction({action:'cancel_reservation',game:custom.split(':')[2],userId,profile,operations,participationQueue,participationCalls,records});
  const view=communityView(operations,userId);let content='',components=[];
  if(kind==='guide'){const p=view.guide;content=`${p.rules.published.title}\n${p.rules.published.body}\n\n${p.faq.published.items.slice(0,3).map(x=>`${x.question}\n${x.answer}`).join('\n\n')}`.slice(0,1900);}
  else if(kind==='subscriptions'||kind==='sub'){
    content='게임별 알림 구독 · 아래 버튼을 누르면 알림 전용 역할을 추가하거나 해제합니다.';
    components=Object.entries(TOPICS).map(([topic,label])=>{const s=view.subscriptions.find(s=>s.topic===topic),on=s?.enabled&&s.status==='active';return {type:1,components:[button(`community:sub:${topic}:${s?.status&&s.status!=='active'?(s.enabled?'on':'off'):on?'off':'on'}`,`${label} ${s?.status&&s.status!=='active'?(s.enabled?'구독 재시도':'해제 재시도'):on?'해제':'구독'}`)]};});
  }else if(kind==='web'){
    if(!profile)throw Error('먼저 /연동으로 게임 정보를 등록하세요.');const url=participantEntryUrl(config);
    if(config.multiWorkspaceEnabled){
      content=`내 참가 상태: ${url}\nDiscord 계정으로 로그인해 주세요.`;
    }else{
      content=`시청자 페이지: ${url}\n일회용 코드: ${viewerAuth.issue(userId)}\n10분 이내 사용하세요. 코드를 다른 사람에게 공유하지 마세요.`;
    }
  }else if(kind==='history'){content=view.history.map(s=>`${s.title} · ${s.attended?'참가 확인':'신청 기록'}`).join('\n')||'최근 참가 기록이 없습니다.';}
  else if(kind==='tickets'){content=view.tickets.slice(0,5).map(t=>`${t.status==='closed'?'처리 완료':'접수'} · ${t.message.slice(0,100)}\n답변: ${t.answer||'답변 대기'}`).join('\n\n').slice(0,1900)||'등록된 문의가 없습니다.';}
  else{
    const own=buildParticipantSelfServiceState({operationsState:operations.read(),queueSummary:participationQueue?.summary?.()||{},userId,profile});
    content=`${own.session?.title||'진행 중인 모집 없음'}\n내 상태: ${own.queue?.entry?.statusLabel||'신청 상태 확인'} · 대기 순번: ${own.queue?.entry?.position||'—'}\n${view.fairness}\n아래에서 신청·취소·호출 응답을 처리하세요. 게임 정보는 /연동에서 수정할 수 있습니다.`;
    const names={join:'참가 신청',leave:'신청 취소',postponeNext:'다음 판',postponeNext2:'다다음 판',callJoin:'참가 가능',callPass:'이번 호출 패스',confirm:'준비 완료'},map={postponeNext:'postpone_next',postponeNext2:'postpone_next2',callJoin:'call_join',callPass:'call_pass'};
    const buttons=Object.entries(names).filter(([k])=>own.actions[k]).map(([k,label])=>button(`community:act:${map[k]||k}:${own.session?.id||'none'}`,label));
    for(let i=0;i<buttons.length;i+=5)components.push({type:1,components:buttons.slice(i,i+5)});
    const reservations=(operations.read().reservations||[]).filter(r=>r.userId===userId);if(reservations.length)components.push({type:1,components:reservations.slice(0,2).map(r=>button(`community:cancel:${r.game}`,`${r.game==='er'?'이터널 리턴':'롤'} 예약 취소`))});
    components.push({type:1,components:[button('community:web',config.multiWorkspaceEnabled?'내 참가 상태 · Discord 로그인':'신청 페이지 · 로그인 코드'),button('community:history','내 참가 기록'),button('community:tickets','내 문의')]});
  }
  await interaction.editReply({content,components,allowedMentions:{parse:[]}});return true;
}
