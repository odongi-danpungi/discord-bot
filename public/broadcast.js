import {createLiveDirector} from './assets/live-director.js';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),token=params.get('token')||'',speed=Math.max(.5,Math.min(4,Number(params.get('speed'))||1)),muted=params.get('mute')==='1';
const authQuery=token?`?token=${encodeURIComponent(token)}`:'';
if(params.get('transparent')==='1')$('broadcastRoot').classList.add('transparent');

const DEFAULT_SETTINGS={
  brandTitle:'댕댕 플레이',footerTitle:'DAENGDAENG PLAY · LIVE',standbyTitle:'다음 시참을 준비 중입니다',standbyMessage:'모집이 시작되면 신청 현황과 추첨 결과가 이 화면에 자동으로 표시됩니다.',
  theme:'midnight',layout:'cinematic',transition:'fade',soundCue:'off',winnerRevealSeconds:5.5,
  showHeader:true,showFooter:true,showTelemetry:true,showRecentApplicants:true,showCountdown:true,
  scenes:{recruit:true,drawReady:true,winners:true,attendance:true,teams:true,ended:true}
};
const mergeSettings=value=>({...DEFAULT_SETTINGS,...(value||{}),scenes:{...DEFAULT_SETTINGS.scenes,...(value?.scenes||{})}});
let settings=mergeSettings(),snapshot={session:null,draw:null,settings,revision:0,serverTime:0,version:'—',sceneOverride:'auto',automation:{enabled:false,endedHoldSeconds:8}},source=null,liveState='connecting',lastEventAt=0,drawLoading='',playingDraw='',playedDraw='',winnerRevealUntil=0,drawCache=new Map(),activePanel='',endedSeenId='',endedSeenAt=0;
const modeLabels={legacy:'이전 추첨 기록',race:'자동차 레이스',ladder:'사다리 추첨',instant:'즉시 추첨'};
const phaseLabels={open:'모집 중',closed:'추첨 준비',drawn:'선정 완료',checking:'참석 확인',ended:'회차 종료'};
const gameLabel=s=>!s?'대기':s.game==='er'?'이터널 리턴':s.mode==='aram'?'칼바람 나락':'소환사의 협곡';
const unique=list=>[...new Set((list||[]).filter(Boolean))];
const setText=(id,value)=>{const el=$(id);if(el)el.textContent=value};

let audioContext=null;
function playCue(){
  if(muted||settings.soundCue==='off')return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;audioContext??=new Ctx();
    const now=audioContext.currentTime,gain=audioContext.createGain();gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(settings.soundCue==='arcade'?.07:.035,now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+.22);gain.connect(audioContext.destination);
    const tone=(freq,start,duration,type)=>{const osc=audioContext.createOscillator();osc.type=type;osc.frequency.setValueAtTime(freq,now+start);osc.connect(gain);osc.start(now+start);osc.stop(now+start+duration)};
    if(settings.soundCue==='arcade'){tone(660,0,.11,'square');tone(880,.11,.11,'square');}else tone(520,0,.2,'sine');
  }catch{}
}

const director=createLiveDirector({
  canvas:$('directorCanvas'),status:$('directorStatus'),result:$('directorResult'),modeBadge:$('directorMode'),session:$('directorSession'),eligible:$('directorEligible'),lastSaved:$('directorLastSaved'),leader:$('directorLeader'),lap:$('directorLap'),gap:$('directorGap'),progress:$('directorProgress'),getSpeed:()=>speed,
  onComplete:()=>{if(playingDraw){playedDraw=playingDraw;playingDraw='';winnerRevealUntil=Date.now()+Number(settings.winnerRevealSeconds||5.5)*1000;render();}}
});
const progressMirror=new MutationObserver(()=>setText('directorProgressMirror',$('directorProgress').textContent||'0%'));progressMirror.observe($('directorProgress'),{childList:true,subtree:true,characterData:true});

function sceneAllowed(name){const key={'recruit':'recruit','draw-ready':'drawReady','winners':'winners','attendance':'attendance','teams':'teams','ended':'ended'}[name];return !key||settings.scenes?.[key]!==false;}
function showPanel(name,force=false){
  const resolved=force||sceneAllowed(name)?name:'standby';
  document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==resolved);
  if(activePanel!==resolved){const panel=document.querySelector(`[data-panel="${resolved}"]`);if(panel){panel.classList.remove('scene-enter');void panel.offsetWidth;panel.classList.add('scene-enter');}if(activePanel)playCue();activePanel=resolved;}
}
function applySettings(next){
  settings=mergeSettings(next);snapshot.settings=settings;
  const root=$('broadcastRoot');root.dataset.theme=settings.theme;root.dataset.layout=settings.layout;root.dataset.transition=settings.transition;root.dataset.header=settings.showHeader?'on':'off';root.dataset.footer=settings.showFooter?'on':'off';
  document.querySelector('.broadcast-header').hidden=!settings.showHeader;document.querySelector('.broadcast-footer').hidden=!settings.showFooter;
  document.querySelector('.telemetry').hidden=!settings.showTelemetry;document.querySelector('.applicant-board').hidden=!settings.showRecentApplicants;
  document.querySelectorAll('.countdown').forEach(el=>{el.hidden=!settings.showCountdown;});
  setText('broadcastBrandTitle',settings.brandTitle);setText('standbyTitle',settings.standbyTitle);setText('standbyMessage',settings.standbyMessage);
}
function setConnection(state,label){liveState=state;const el=$('connection');el.dataset.state=state;el.textContent=label;setText('footerStatus',label+(snapshot.version?` · v${snapshot.version}`:''));}
function formatClock(deadline,empty='수동 마감'){
  if(!deadline)return empty;const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
  if(seconds<=0)return '시간 종료';return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
function renderHeader(){const s=snapshot.session;setText('gameBadge',gameLabel(s));setText('roundText',s?`${s.round}판 · ${phaseLabels[s.phase]||s.phase}`:'READY');setText('footerTitle',s?`${settings.footerTitle} · ${gameLabel(s)} · ${s.title}`:settings.footerTitle);}
function renderRecruit(s){
  setText('recruitTitle',s.title);setText('recruitDescription',s.description||'참가하기 버튼을 눌러 신청해 주세요.');setText('applicantCount',s.applicants.length);setText('targetCount',s.count);setText('recruitCountdown',formatClock(s.closeAt));
  $('applicantMeter').style.width=`${Math.min(100,s.count?Math.round(s.applicants.length/s.count*100):0)}%`;
  const latest=s.applicants.slice(-18).reverse();$('applicantNames').replaceChildren(...(latest.length?latest:['신청 대기 중']).map(name=>{const e=document.createElement('span');e.className='chip';e.textContent=name;return e}));
}
function renderReady(s){setText('readyApplicants',s.applicants.length);setText('readyTarget',s.count);}
function renderWinners(s){
  const winners=unique(s.winners);$('winnerCards').replaceChildren(...(winners.length?winners:['선정 결과 대기']).map((name,i)=>{const card=document.createElement('article');card.className='winner-card';const rank=document.createElement('b');rank.textContent=i+1;const strong=document.createElement('strong');strong.textContent=name;card.append(rank,strong);return card}));
}
function renderAttendance(s){
  setText('attendanceCountdown',formatClock(s.deadline,'—'));setText('confirmedCount',s.confirmed.length);setText('winnerCount',s.winners.length);const confirmed=new Set(s.confirmed);
  $('attendanceCards').replaceChildren(...s.winners.map(name=>{const card=document.createElement('span');card.className='attendance-card'+(confirmed.has(name)?' ok':'');card.textContent=`${name} · ${confirmed.has(name)?'확인 완료':'응답 대기'}`;return card}));
}
function renderTeams(s){
  $('teamCards').replaceChildren(...s.teams.map((team,i)=>{const card=document.createElement('article');card.className='team-card';const h=document.createElement('h2');h.textContent=`TEAM ${i+1}`;const ol=document.createElement('ol');for(const name of team){const li=document.createElement('li');li.textContent=name;ol.append(li)}card.append(h,ol);return card}));
}
function renderEnded(s){$('endedSummary').replaceChildren(...[[`신청 ${s.applicants.length}명`],[`당첨 ${s.winners.length}명`],[`참석 ${s.confirmed.length}명`],[s.teams.length?`팀 ${s.teams.length}개`:'팀 미편성']].map(([text])=>{const e=document.createElement('span');e.textContent=text;return e}));}

async function fetchJson(path){const response=await fetch(path,{cache:'no-store'});const data=await response.json().catch(()=>({error:'방송 데이터를 읽지 못했습니다.'}));if(!response.ok)throw Error(data.error||'방송 데이터를 읽지 못했습니다.');return data;}
async function loadDraw(meta){
  if(!meta?.id||drawLoading===meta.id||playingDraw===meta.id||playedDraw===meta.id)return;
  drawLoading=meta.id;
  try{
    let draw=drawCache.get(meta.id);if(!draw){const data=await fetchJson(`api/draw/${encodeURIComponent(meta.id)}${authQuery}`);draw=data.draw;drawCache.set(meta.id,draw);if(drawCache.size>3)drawCache.delete(drawCache.keys().next().value);}
    if(snapshot.draw?.id!==meta.id)return;
    playingDraw=meta.id;winnerRevealUntil=0;showPanel('game');await director.play(draw);
  }catch(error){setConnection('offline',error.message);playingDraw='';render();}
  finally{if(drawLoading===meta.id)drawLoading='';}
}

function renderForced(scene,s){
  if(scene==='auto')return false;
  if(scene==='standby'||!s){showPanel('standby',true);return true;}
  if(scene==='recruit'){showPanel('recruit',true);renderRecruit(s);return true;}
  if(scene==='draw-ready'){showPanel('draw-ready',true);renderReady(s);return true;}
  if(scene==='winners'){showPanel('winners',true);renderWinners(s);return true;}
  if(scene==='attendance'){showPanel('attendance',true);renderAttendance(s);return true;}
  if(scene==='teams'){showPanel('teams',true);renderTeams(s);return true;}
  if(scene==='ended'){showPanel('ended',true);renderEnded(s);return true;}
  if(scene==='game'){
    const meta=snapshot.draw;if(playingDraw){showPanel('game',true);return true;}
    if(meta?.id){showPanel('game',true);loadDraw(meta);return true;}
    showPanel('draw-ready',true);renderReady(s);return true;
  }
  return false;
}
function render(){
  renderHeader();const s=snapshot.session;if(renderForced(snapshot.sceneOverride||'auto',s))return;if(!s){showPanel('standby');return;}
  if(s.phase==='ended'){
    if(endedSeenId!==s.key){endedSeenId=s.key;endedSeenAt=Date.now();}
    const hold=Number(snapshot.automation?.endedHoldSeconds??8);
    if(hold>0&&Date.now()-endedSeenAt>=hold*1000){showPanel('standby');return;}
    showPanel('ended');renderEnded(s);return;
  }else if(endedSeenId){endedSeenId='';endedSeenAt=0;}
  if(playingDraw){showPanel('game');return;}
  if(s.teams?.length){showPanel('teams');renderTeams(s);return;}
  const meta=snapshot.draw;
  if(meta?.id&&meta.id!==playedDraw&&['drawn','checking'].includes(s.phase)){showPanel('game');loadDraw(meta);return;}
  if(winnerRevealUntil>Date.now()&&s.winners.length){showPanel('winners');renderWinners(s);return;}
  if(s.phase==='open'){showPanel('recruit');renderRecruit(s);return;}
  if(s.phase==='closed'){showPanel('draw-ready');renderReady(s);return;}
  if(s.phase==='checking'){showPanel('attendance');renderAttendance(s);return;}
  if(s.phase==='drawn'){showPanel('winners');renderWinners(s);return;}
  showPanel('standby');
}
function accept(next){if(!next||typeof next!=='object')return;snapshot=next;applySettings(next.settings);lastEventAt=Date.now();render();}
async function refresh(){try{const data=await fetchJson(`api/snapshot${authQuery}`);accept(data);if(liveState!=='live')setConnection('polling','안전 새로고침');}catch(error){setConnection('offline',error.message);}}
function connect(){
  source?.close();setConnection('connecting','실시간 연결 중');
  if(!('EventSource'in window)){refresh();return;}
  source=new EventSource(`api/events${authQuery}`);
  source.addEventListener('snapshot',event=>{try{accept(JSON.parse(event.data));setConnection('live','실시간 연결됨');}catch{}});
  source.addEventListener('heartbeat',()=>{lastEventAt=Date.now();if(liveState!=='live')setConnection('live','실시간 연결됨');});
  source.addEventListener('error',()=>setConnection('offline','실시간 재연결 중'));
}

applySettings(settings);
setInterval(()=>{
  const s=snapshot.session;if(s?.phase==='open')setText('recruitCountdown',formatClock(s.closeAt));if(s?.phase==='checking')setText('attendanceCountdown',formatClock(s.deadline,'—'));
  if(winnerRevealUntil&&Date.now()>=winnerRevealUntil){winnerRevealUntil=0;render();}
  if(snapshot.session?.phase==='ended'&&Number(snapshot.automation?.endedHoldSeconds)>0)render();
  if(liveState==='live'&&lastEventAt&&Date.now()-lastEventAt>45000){setConnection('stale','연결 지연 · 재연결');source?.close();connect();}
},500);
setInterval(()=>{if(liveState!=='live')refresh();},8000);
window.addEventListener('pagehide',()=>{source?.close();director.destroy();progressMirror.disconnect();audioContext?.close?.();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&liveState!=='live')connect();});
refresh().finally(connect);
