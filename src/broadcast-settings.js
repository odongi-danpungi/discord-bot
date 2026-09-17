export const DEFAULT_BROADCAST_SETTINGS = Object.freeze({
  brandTitle:'댕댕 플레이',
  footerTitle:'DAENGDAENG PLAY · LIVE',
  standbyTitle:'다음 시참을 준비 중입니다',
  standbyMessage:'모집이 시작되면 신청 현황과 추첨 결과가 이 화면에 자동으로 표시됩니다.',
  theme:'midnight',
  layout:'cinematic',
  transition:'fade',
  soundCue:'off',
  winnerRevealSeconds:5.5,
  showHeader:true,
  showFooter:true,
  showTelemetry:true,
  showRecentApplicants:true,
  showCountdown:true,
  scenes:Object.freeze({recruit:true,drawReady:true,winners:true,attendance:true,teams:true,ended:true})
});

const ENUMS={theme:new Set(['midnight','aurora','warm']),layout:new Set(['cinematic','compact']),transition:new Set(['fade','slide','cut']),soundCue:new Set(['off','soft','arcade'])};
const text=(value,fallback,max)=>{const v=String(value??fallback).replace(/[\u0000-\u001f\u007f]/g,' ').trim();return (v||fallback).slice(0,max)};
const bool=(value,fallback)=>typeof value==='boolean'?value:fallback;
const pick=(set,value,fallback)=>set.has(value)?value:fallback;
const number=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};

export function normalizeBroadcastSettings(input={}){
  const d=DEFAULT_BROADCAST_SETTINGS,scenes=input?.scenes&&typeof input.scenes==='object'&&!Array.isArray(input.scenes)?input.scenes:{};
  return {
    brandTitle:text(input.brandTitle,d.brandTitle,40),
    footerTitle:text(input.footerTitle,d.footerTitle,64),
    standbyTitle:text(input.standbyTitle,d.standbyTitle,80),
    standbyMessage:text(input.standbyMessage,d.standbyMessage,180),
    theme:pick(ENUMS.theme,input.theme,d.theme),
    layout:pick(ENUMS.layout,input.layout,d.layout),
    transition:pick(ENUMS.transition,input.transition,d.transition),
    soundCue:pick(ENUMS.soundCue,input.soundCue,d.soundCue),
    winnerRevealSeconds:number(input.winnerRevealSeconds,d.winnerRevealSeconds,2,15),
    showHeader:bool(input.showHeader,d.showHeader),
    showFooter:bool(input.showFooter,d.showFooter),
    showTelemetry:bool(input.showTelemetry,d.showTelemetry),
    showRecentApplicants:bool(input.showRecentApplicants,d.showRecentApplicants),
    showCountdown:bool(input.showCountdown,d.showCountdown),
    scenes:{
      recruit:bool(scenes.recruit,d.scenes.recruit),
      drawReady:bool(scenes.drawReady,d.scenes.drawReady),
      winners:bool(scenes.winners,d.scenes.winners),
      attendance:bool(scenes.attendance,d.scenes.attendance),
      teams:bool(scenes.teams,d.scenes.teams),
      ended:bool(scenes.ended,d.scenes.ended)
    }
  };
}

export function validateBroadcastSettings(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('방송 장면 설정 형식을 확인해 주세요.');
  const known=new Set(['brandTitle','footerTitle','standbyTitle','standbyMessage','theme','layout','transition','soundCue','winnerRevealSeconds','showHeader','showFooter','showTelemetry','showRecentApplicants','showCountdown','scenes']);
  for(const key of Object.keys(input))if(!known.has(key))throw Error(`지원하지 않는 방송 설정입니다: ${key}`);
  for(const key of ['brandTitle','footerTitle','standbyTitle','standbyMessage'])if(input[key]!==undefined&&typeof input[key]!=='string')throw Error(`${key} 값은 문자열이어야 합니다.`);
  for(const [key,set] of Object.entries(ENUMS))if(input[key]!==undefined&&!set.has(input[key]))throw Error(`${key} 값을 확인해 주세요.`);
  for(const key of ['showHeader','showFooter','showTelemetry','showRecentApplicants','showCountdown'])if(input[key]!==undefined&&typeof input[key]!=='boolean')throw Error(`${key} 값은 켜기/끄기 형식이어야 합니다.`);
  if(input.winnerRevealSeconds!==undefined&&(!Number.isFinite(Number(input.winnerRevealSeconds))||Number(input.winnerRevealSeconds)<2||Number(input.winnerRevealSeconds)>15))throw Error('당첨자 공개 시간은 2~15초입니다.');
  if(input.scenes!==undefined){
    if(!input.scenes||typeof input.scenes!=='object'||Array.isArray(input.scenes))throw Error('장면 표시 설정을 확인해 주세요.');
    const sceneKeys=new Set(['recruit','drawReady','winners','attendance','teams','ended']);
    for(const [key,value] of Object.entries(input.scenes)){if(!sceneKeys.has(key))throw Error(`지원하지 않는 장면입니다: ${key}`);if(typeof value!=='boolean')throw Error(`${key} 장면 값은 켜기/끄기 형식이어야 합니다.`);}
  }
  return normalizeBroadcastSettings(input);
}
