import { ChannelType, PermissionFlagsBits } from 'discord.js';

export const INTRODUCTION_CATEGORY='🔔 ᭄༄・방울! 안내방';
export const DEFAULT_INTRODUCTION_CHANNEL='🐱・방울소개';
const legacyNames=[DEFAULT_INTRODUCTION_CHANNEL,'xx소개','XX소개','🐱・xx소개','🐱・XX소개'];

export function normalizeIntroductionName(value){
  if(typeof value!=='string')throw Error('소개 이름을 입력해 주세요. 예: /소개 이름:동동');
  const name=value.normalize('NFC').trim();
  if(!/^[\p{L}\p{N}_ -]{1,32}$/u.test(name))throw Error('소개 이름은 한글·영문·숫자·공백·_·-로 1~32자 입력해 주세요.');
  // Discord text channels use lowercase names and hyphens in place of spaces.
  const normalized=name.toLowerCase().replace(/ +/g,'-').normalize('NFC');
  if(!/^[\p{L}\p{N}_-]{1,32}$/u.test(normalized))throw Error('Discord 채널 이름으로 사용할 수 없는 문자가 있습니다.');
  return normalized;
}

export function readIntroductionSettings(state){
  const settings=state?.discordIntroduction;
  if(settings===undefined)return null;
  if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(key=>!['name','channelId','categoryId'].includes(key)))throw Error('저장된 소개 채널 설정을 확인해 주세요.');
  if(settings.name!==null&&normalizeIntroductionName(settings.name)!==settings.name)throw Error('저장된 소개 이름을 확인해 주세요.');
  for(const key of ['channelId','categoryId'])if(settings[key]!==null&&(typeof settings[key]!=='string'||!/^\d{1,20}$/.test(settings[key])))throw Error('저장된 소개 채널 ID를 확인해 주세요.');
  return {...settings};
}

export function introductionChannelName(settings){return settings?.name?`${settings.name}소개`:DEFAULT_INTRODUCTION_CHANNEL;}

export function resolveIntroduction(channels,settings,{requireExisting=false}={}){
  const savedCategory=settings?.categoryId?channels.get(settings.categoryId):null;
  if(savedCategory&&savedCategory.type!==ChannelType.GuildCategory)throw Error('저장된 소개 카테고리의 종류가 바뀌었습니다. 서버 채널을 확인해 주세요.');
  const categories=[...channels.values()].filter(c=>c?.type===ChannelType.GuildCategory&&c.name===INTRODUCTION_CATEGORY);
  if(!savedCategory&&categories.length>1)throw Error('안내 카테고리가 여러 개입니다. 소개 채널을 확인해 주세요.');
  const category=savedCategory||categories[0]||null;
  const savedChannel=settings?.channelId?channels.get(settings.channelId):null;
  if(requireExisting&&settings?.channelId&&!savedChannel)throw Error('저장된 소개 채널을 찾을 수 없습니다. 서버의 채널 삭제 여부를 확인해 주세요.');
  if(savedChannel&&(savedChannel.type!==ChannelType.GuildText||!category||savedChannel.parentId!==category.id))throw Error('저장된 소개 채널이 다른 위치에 있습니다. 자동 이동하지 않으므로 안내 카테고리를 확인해 주세요.');
  const names=new Set([...legacyNames,introductionChannelName(settings)]);
  const candidates=category?[...channels.values()].filter(c=>c?.type===ChannelType.GuildText&&c.parentId===category.id&&names.has(c.name)):[];
  if(!savedChannel&&candidates.length>1)throw Error('소개 채널 후보가 여러 개입니다. 중복 채널을 확인해 주세요.');
  const channel=savedChannel||candidates[0]||null;
  if(requireExisting&&(!category||!channel))throw Error('자동 설정으로 만든 소개 채널이 없습니다. 먼저 /setting을 실행해 주세요.');
  return {category,channel};
}

export function assertIntroductionTarget(channels,category,channel,name,bot){
  const collision=[...channels.values()].some(c=>c?.type===ChannelType.GuildText&&c.parentId===category.id&&c.name===name&&c.id!==channel.id);
  if(collision)throw Error('같은 이름의 채널이 이미 있습니다. 기존 채널을 확인해 주세요.');
  if(channel.name!==name&&!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels))throw Error('소개 채널의 채널 관리 권한이 필요합니다.');
}

export async function saveIntroductionSettings(operations,settings,{guard=()=>{}}={}){
  guard();
  const current=readIntroductionSettings(operations.read());
  if(current&&current.name===settings.name&&current.channelId===settings.channelId&&current.categoryId===settings.categoryId)return;
  await operations.update(state=>{guard();state.discordIntroduction={...settings};state.revision=(Number(state.revision)||0)+1;});
}
