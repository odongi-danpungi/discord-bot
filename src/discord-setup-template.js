import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { normalizeIntroductionName,readIntroductionSettings,introductionChannelName } from './discord-introduction.js';

const keys=['welcomeCategory','introduction','communityInfo','botCategory','botInfo'];
const id=value=>value===null||(typeof value==='string'&&/^\d{1,20}$/.test(value));

export function readSetupTemplate(state){
  const value=state?.discordSetupTemplate;if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['name','ids'].includes(k))||!value.ids||typeof value.ids!=='object'||Array.isArray(value.ids))throw Error('저장된 채널 이름 템플릿을 확인해 주세요.');
  if(value.name!==null&&normalizeIntroductionName(value.name)!==value.name)throw Error('저장된 공통 이름을 확인해 주세요.');
  if(Object.keys(value.ids).some(k=>!keys.includes(k))||keys.some(k=>!id(value.ids[k])))throw Error('저장된 채널 템플릿 ID를 확인해 주세요.');
  const assigned=Object.values(value.ids).filter(Boolean);
  if(new Set(assigned).size!==assigned.length)throw Error('서로 다른 템플릿 항목에 같은 채널 ID가 저장되어 있습니다.');
  return structuredClone(value);
}

export function setupTemplateNames(name,introductionName=name){
  const prefix=name??'방울';
  return {welcomeCategory:`🔔 ᭄༄・${prefix}! 안내방`,introduction:introductionChannelName({name:introductionName}),communityInfo:`🐱・${prefix}2`,botCategory:`🔔・${prefix}`,botInfo:`${prefix}・${prefix}${prefix}`};
}

export function prepareSetupTemplate(channels,state,input,bot){
  const previous=readSetupTemplate(state),intro=readIntroductionSettings(state),explicit=input!==undefined;
  const name=explicit?normalizeIntroductionName(input):previous?previous.name:intro?.name??null;
  const introName=explicit?name:intro?.name??name;
  const desired=setupTemplateNames(name,introName),old=setupTemplateNames(previous?.name??null,intro?.name??null),legacy=setupTemplateNames(null),placeholder=setupTemplateNames('xx'),upperPlaceholder=setupTemplateNames('XX');
  const ids=Object.fromEntries(keys.map(k=>[k,previous?.ids[k]??(k==='welcomeCategory'?intro?.categoryId:k==='introduction'?intro?.channelId:null)??null]));
  const resolved={};
  for(const key of keys){
    const type=key.endsWith('Category')?ChannelType.GuildCategory:ChannelType.GuildText,parentKey=key==='introduction'||key==='communityInfo'?'welcomeCategory':key==='botInfo'?'botCategory':null;
    const parent=parentKey?resolved[parentKey]:null,saved=ids[key]?channels.get(ids[key]):null;
    if(saved&&(saved.type!==type||(parentKey&&(!parent||saved.parentId!==parent.id))))throw Error('저장된 템플릿 채널의 종류 또는 위치가 바뀌었습니다. 서버 채널을 확인해 주세요.');
    if(previous?.ids[key]&&!saved)throw Error('저장된 템플릿 채널이 삭제되었습니다. 서버 채널을 확인해 주세요.');
    const aliases=new Set([old[key],desired[key],legacy[key],placeholder[key],upperPlaceholder[key]]);
    if(key==='introduction')for(const alias of ['xx소개','XX소개','🐱・xx소개','🐱・XX소개'])aliases.add(alias);
    const candidates=[...channels.values()].filter(c=>c?.type===type&&(!parentKey||(parent&&c.parentId===parent.id))&&aliases.has(c.name));
    if(!saved&&candidates.length>1)throw Error('이름 템플릿에 맞는 채널이 여러 개입니다. 중복 채널을 확인해 주세요.');
    const channel=saved||candidates[0]||null;
    if(!channel){
      const permitted=parentKey&&parent?parent.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels):bot?.permissions?.has(PermissionFlagsBits.ManageChannels);
      if(!permitted)throw Error('누락된 템플릿 채널·카테고리를 생성할 채널 관리 권한이 필요합니다.');
    }
    if(channel){
      const shouldRename=explicit||name!==null||key==='introduction';
      if(shouldRename&&channel.name!==desired[key]){
        if(!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels))throw Error('이름 템플릿을 적용할 채널·카테고리의 채널 관리 권한이 필요합니다.');
        const collision=[...channels.values()].some(c=>c?.type===type&&c.id!==channel.id&&c.name===desired[key]&&(!parentKey||c.parentId===parent.id));
        if(collision)throw Error('템플릿에 적용할 이름의 채널·카테고리가 이미 있습니다.');
      }
      ids[key]=channel.id;
    }
    resolved[key]=channel;
  }
  const assigned=Object.values(ids).filter(Boolean);
  if(new Set(assigned).size!==assigned.length)throw Error('템플릿의 서로 다른 항목이 같은 채널을 가리킵니다.');
  return {name,introName,names:desired,ids,resolved,rename:explicit||name!==null};
}

export async function saveSetupTemplate(operations,plan,guard=()=>{}){
  guard();const next={name:plan.name,ids:{...plan.ids}},introduction={name:plan.introName,channelId:plan.ids.introduction,categoryId:plan.ids.welcomeCategory};
  const current=operations.read();
  if(JSON.stringify(readSetupTemplate(current))===JSON.stringify(next)&&JSON.stringify(readIntroductionSettings(current))===JSON.stringify(introduction))return;
  await operations.update(state=>{guard();state.discordSetupTemplate=next;state.discordIntroduction=introduction;state.revision=(Number(state.revision)||0)+1;});
}
