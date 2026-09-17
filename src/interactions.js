import { guideCard, acknowledgeRules } from './guide.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, PermissionFlagsBits, Events, MessageFlags } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { applyAction } from './operations.js';
import { validateProfile, hasGame } from './profiles.js';

const ephemeral={flags:MessageFlags.Ephemeral};
function field(id,label,placeholder,value='',required=false,max=100){
  const input=new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setRequired(required).setStyle(TextInputStyle.Short).setMaxLength(max);
  if(value)input.setValue(value.slice(0,max));return new ActionRowBuilder().addComponents(input);
}
const row=(id,label,style=ButtonStyle.Primary)=>new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style));
export function installInteractions({client,config,store,operations,discord,viewerAuth}){
  const drafts=new Map();let syncTimer;
  const queueSync=()=>{clearTimeout(syncTimer);syncTimer=setTimeout(()=>discord.sync('sync').catch(()=>{}),900);syncTimer.unref();};
  const prune=setInterval(()=>{for(const [key,value] of drafts)if(value.expiresAt<Date.now())drafts.delete(key)},60000);prune.unref();
  client.on(Events.InteractionCreate,async interaction=>{
    try{
      if(interaction.guildId!==config.guildId)return;
      const userId=interaction.user.id,key=`${config.guildId}:${userId}`;
      const current=()=>store.read().find(r=>r.guildId===config.guildId&&r.discordId===userId);
      if(interaction.isChatInputCommand()&&interaction.commandName==='setting'){
        const memberRoles=interaction.member?.roles,hasRole=Array.isArray(memberRoles)?memberRoles.includes(config.adminRoleId):memberRoles?.cache?.has(config.adminRoleId);
        if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)&&!(config.adminRoleId&&hasRole))return interaction.reply({content:'서버 관리 권한이 필요핣니다.',...ephemeral});
        await interaction.deferReply(ephemeral);await discord.setup();return interaction.editReply('카테고리·채널과 사용자 연동 패널을 설정했습니다. 반복 실행해도 기존 패널을 갱신합니다.');
      }
      if(interaction.isButton()&&interaction.customId==='avatar_access'){
        if(!current())return interaction.reply({content:'먼저 /연동으로 게임 정보를 등록해 주세요.',...ephemeral});
        const code=viewerAuth.issue(userId),url=config.viewerUrl||`http://127.0.0.1:${config.port}/viewer/`;
        return interaction.reply({content:`내 레이스 색상 설정: ${url}\n로그인 코드: \`${code}\`\n10분 이내 1회 사용 가능 · 다른 사람에게 공유하지 마세요.${config.viewerUrl?'':'\n현재 운영자 PC 전용 주소입니다. 시청자 접속에는 운영자의 공개 HTTPS 주소 설정이 필요합니다.'}`,allowedMentions:{parse:[]},...ephemeral});
      }
      if(interaction.isButton()&&interaction.customId.startsWith('guide:')){
        const [,page,value]=interaction.customId.split(':');
        await interaction.deferReply(ephemeral);
        if(page==='ack'){
          await operations.update(state=>acknowledgeRules(state,userId,Number(value)));
          return interaction.editReply(guideCard(operations.read(),current(),userId,'rules'));
        }
        return interaction.editReply(guideCard(operations.read(),current(),userId,page,value===undefined?0:Number(value)));
      }
      if(interaction.isButton()&&interaction.customId==='profile_view'){
        const r=current();if(!r)return interaction.reply({content:'아직 등록된 정보가 없습니다. 사용자 연동을 눌러 주세요.',components:[row('register_start','사용자 연동')],...ephemeral});
        return interaction.reply({content:`치지직: ${r.chzzkName}\n이터널 리턴: ${r.erNickname||'미등록'} · 현재 ${r.erCurrentTier||'미입력'} / 최고 ${r.erPeakTier||'미입력'}\n롤: ${r.lolRiotId||'미등록'} · ${r.lolMainLane||'라인 미입력'} · 현재 ${r.lolCurrentTier||'미입력'} / 최고 ${r.lolPeakTier||'미입력'}`,allowedMentions:{parse:[]},components:[row('register_start','정보 수정')],...ephemeral});
      }
      if(interaction.isButton()&&interaction.customId==='reservation_view'){
        const reservations=(operations.read().reservations||[]).filter(r=>r.userId===userId);
        return interaction.reply({content:reservations.map(r=>`${r.game==='lol'?'롤':'이터널 리턴'} ${r.round}판 자동 신청 예약`).join('\n')||'예약된 다음 판이 없습니다.',components:reservations.map(r=>row(`reservation_cancel:${r.game}`,(r.game==='lol'?'롤':'이터널 리턴')+' 예약 취소',ButtonStyle.Secondary)),...ephemeral});
      }
      if(interaction.isButton()&&interaction.customId.startsWith('reservation_cancel:')){
        await interaction.deferReply(ephemeral);await operations.update(s=>applyAction(s,'cancel_reservation',{game:interaction.customId.split(':')[1],userId}));queueSync();return interaction.editReply('다음 판 예약을 취소했습니다.');
      }
      if(interaction.isButton()&&interaction.customId.startsWith('roster:')){
        const [,action,sessionId,version]=interaction.customId.split(':');await interaction.deferReply(ephemeral);
        if(!['join','leave','confirm','postpone_next','postpone_later'].includes(action))throw Error('이전 버전의 버튼입니다. 최신 모집글을 이용해 주세요.');
        if(action==='confirm'&&version===undefined)throw Error('갱신된 참석 확인 버튼을 눌러 주세요.');
        if(action==='join'){
          const s=operations.read().session;
          if(!s||!hasGame(current(),s.game))return interaction.editReply('먼저 /연동에서 해당 게임 계정을 등록해 주세요.');
        }
        await operations.update(s=>applyAction(s,action,{sessionId,userId,attendanceVersion:version===undefined?undefined:Number(version)}));queueSync();
        const messages={join:'시참 신청 완료!',leave:'신청과 다음 판 예약을 취소했습니다.',confirm:'참석 확인 완료!',postpone_next:'같은 게임의 다음 판 모집에 자동 신청됩니다.',postpone_later:'같은 게임의 다다음 판 모집에 자동 신청됩니다.'};
        return interaction.editReply(messages[action]);
      }
      if((interaction.isChatInputCommand()&&interaction.commandName==='연동')||(interaction.isButton()&&interaction.customId==='register_start')){
        const r=current()||{},flow=randomUUID().slice(0,8);
        drafts.set(key,{flow,expiresAt:Date.now()+600000,old:r});
        const modal=new ModalBuilder().setCustomId('register_game_1:'+flow).setTitle('사용자 연동 · 사용하는 게임만 입력')
          .addComponents(field('chzzkName','치지직 닉네임','Discord에 사용할 이름',r.chzzkName,true,32),field('erNickname','이터널 리턴 닉네임 (선택)','안 하는 게임은 비워 두세요',r.erNickname),field('erCurrentTier','이터널 리턴 현재 티어 (선택)','예: 다이아몬드 2',r.erCurrentTier),field('erPeakTier','이터널 리턴 최고 티어 (선택)','예: 미스릴',r.erPeakTier),field('lolRiotId','롤 Riot ID (선택)','이름#태그',r.lolRiotId));
        return interaction.showModal(modal);
      }
      if(interaction.isModalSubmit()&&interaction.customId.startsWith('register_game_1:')){
        const draft=drafts.get(key);if(!draft||draft.flow!==interaction.customId.split(':')[1]||Date.now()>draft.expiresAt)throw Error('입력 시간이 만료됐습니다. /연동을 다시 실행해 주세요.');
        const input=Object.fromEntries(['chzzkName','erNickname','erCurrentTier','erPeakTier','lolRiotId'].map(id=>[id,interaction.fields.getTextInputValue(id)]));
        const clean=validateProfile({...input,lolMainLane:draft.old.lolMainLane,lolCurrentTier:draft.old.lolCurrentTier,lolPeakTier:draft.old.lolPeakTier});
        draft.first=clean;draft.expiresAt=Date.now()+600000;
        if(!clean.lolRiotId){await interaction.deferReply(ephemeral);await store.upsert({...clean,lolMainLane:'',lolCurrentTier:'',lolPeakTier:'',guildId:config.guildId,discordId:userId,discordUsername:interaction.user.username,updatedAt:new Date().toISOString()});drafts.delete(key);return interaction.editReply('이터널 리턴 정보를 저장했습니다. /연동으로 수정할 수 있습니다.');}
        return interaction.reply({content:'1단계를 저장했습니다. 10분 안에 롤 정보를 입력해 주세요. 입력 정보는 운영자가 확인할 수 있습니다.',components:[row('register_continue:'+draft.flow,'롤 정보 입력')],...ephemeral});
      }
      if(interaction.isButton()&&interaction.customId.startsWith('register_continue:')){
        const draft=drafts.get(key);if(!draft?.first||draft.flow!==interaction.customId.split(':')[1]||Date.now()>draft.expiresAt)throw Error('입력 시간이 만료됐습니다. /연동을 다시 실행해 주세요.');
        return interaction.showModal(new ModalBuilder().setCustomId('register_game_2:'+draft.flow).setTitle('사용자 연동 · 롤 정보').addComponents(field('lolMainLane','롤 주 라인 (선택)','탑 / 정글 / 미드 / 원딜 / 서폿',draft.first.lolMainLane),field('lolCurrentTier','롤 현재 티어 (선택)','예: 에메랄드 3',draft.first.lolCurrentTier),field('lolPeakTier','롤 최고 티어 (선택)','예: 다이아몬드 4',draft.first.lolPeakTier)));
      }
      if(interaction.isModalSubmit()&&interaction.customId.startsWith('register_game_2:')){
        const draft=drafts.get(key);if(!draft?.first||draft.flow!==interaction.customId.split(':')[1]||Date.now()>draft.expiresAt)throw Error('입력 시간이 만료됐습니다. /연동을 다시 실행해 주세요.');
        const input=Object.fromEntries(['lolMainLane','lolCurrentTier','lolPeakTier'].map(id=>[id,interaction.fields.getTextInputValue(id)]));
        const clean=validateProfile({...draft.first,...input});await interaction.deferReply(ephemeral);
        await store.upsert({...clean,guildId:config.guildId,discordId:userId,discordUsername:interaction.user.username,updatedAt:new Date().toISOString()});drafts.delete(key);
        return interaction.editReply('사용자 연동 완료! /연동으로 다시 수정할 수 있습니다.');
      }
    }catch(error){
      const content=error.code?'Discord 요청에 실패했습니다. 봇의 채널 권한을 확인해 주세요.':error.message;
      if(interaction.deferred&&!interaction.replied)await interaction.editReply({content}).catch(()=>{});
      else if(interaction.replied)await interaction.followUp({content,...ephemeral}).catch(()=>{});
      else await interaction.reply({content,...ephemeral}).catch(()=>{});
    }
  });
  return ()=>{clearInterval(prune);clearTimeout(syncTimer);};
}
