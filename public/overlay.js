const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),token=params.get('token')||'',layout=['wide','compact','minimal'].includes(params.get('layout'))?params.get('layout'):'wide';
const authQuery=token?`?token=${encodeURIComponent(token)}`:'';
const root=$('obsOverlay');root.dataset.layout=layout;
if(params.get('preview')==='1')document.body.classList.add('preview');
const hidden=new Set(String(params.get('hide')||'').split(',').map(v=>v.trim()).filter(Boolean));
for(const key of ['events','teams','winners'])if(hidden.has(key))root.classList.add(`hide-${key}`);
let overlay={session:null,current:null,next:null,counts:{waiting:0,called:0,joined:0,active:0},winners:[],teams:[],eventFeed:[],serverTime:0,revision:0,version:'—'},source=null,lastEventAt=0,connection='connecting';
const phaseLabels={open:'모집 중',closed:'추첨 준비',drawn:'선정 완료',checking:'참석 확인',ended:'회차 종료'};
const gameLabel=s=>!s?'방송 대기':s.game==='er'?'이터널 리턴':s.mode==='aram'?'칼바람 나락':'소환사의 협곡';
const setText=(id,value)=>{const el=$(id);if(el)el.textContent=value};
function setConnection(state,label){connection=state;const el=$('overlayConnection');el.dataset.state=state;el.querySelector('span').textContent=label;}
function callClock(deadline){if(!deadline)return '—';const sec=Math.max(0,Math.ceil((Number(deadline)-Date.now())/1000));if(!sec)return '시간 종료';return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function timeLabel(at){const d=new Date(Number(at)||0);if(!Number.isFinite(d.getTime()))return '';return d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});}
function chip(text,className=''){const el=document.createElement('span');if(className)el.className=className;el.textContent=text;return el;}
function renderParticipants(){
  const current=overlay.current,next=overlay.next;
  setText('currentName',current?.displayName||'호출 대기');setText('currentSource',current?.source||'—');setText('currentStatus',current?current.statusLabel:'현재 참가자가 없습니다');setText('callCountdown',current?.status==='called'?callClock(current.callDeadline):current?.status==='joined'?'READY':'—');
  setText('nextName',next?.displayName||'대기 없음');setText('nextSource',next?.source||'—');setText('nextStatus',next?`${next.position||'-'}번 · ${next.statusLabel}`:'다음 참가자 대기');setText('waitingCount',overlay.counts?.waiting||0);
  $('currentCard').classList.toggle('is-empty',!current);$('nextCard').classList.toggle('is-empty',!next);
}
function renderResults(){
  const winners=Array.isArray(overlay.winners)?overlay.winners:[];$('overlayWinners').replaceChildren(...(winners.length?winners.slice(0,10).map(name=>chip(name)):[chip('결과 대기','empty')]));
  const teams=Array.isArray(overlay.teams)?overlay.teams:[];
  if(!teams.length){$('overlayTeams').replaceChildren(chip('팀 편성 대기','empty'));return;}
  $('overlayTeams').replaceChildren(...teams.slice(0,6).map((team,index)=>{const card=document.createElement('article');card.className='overlay-team';const title=document.createElement('b');title.textContent=`TEAM ${index+1}`;const names=document.createElement('div');for(const name of team.slice(0,8))names.append(chip(name));card.append(title,names);return card;}));
}
function renderEvents(){
  const events=Array.isArray(overlay.eventFeed)?overlay.eventFeed:[];
  if(!events.length){$('overlayEvents').replaceChildren(chip('새 이벤트를 기다리는 중입니다','empty'));return;}
  $('overlayEvents').replaceChildren(...events.slice(0,5).map(event=>{const item=document.createElement('span');item.className='event-item';item.dataset.type=event.type||'queue';const t=document.createElement('time');t.textContent=timeLabel(event.at);const text=document.createElement('span');text.textContent=event.message||'상태 변경';item.append(t,text);return item;}));
}
function render(){const s=overlay.session;setText('overlayGame',gameLabel(s));setText('overlayRound',s?`${s.round}판`:'READY');setText('overlayPhase',s?phaseLabels[s.phase]||s.phase:'대기');renderParticipants();renderResults();renderEvents();}
function accept(payload){if(!payload||typeof payload!=='object')return;overlay=payload.overlay&&typeof payload.overlay==='object'?payload.overlay:payload;lastEventAt=Date.now();render();}
async function refresh(){try{const res=await fetch(`/broadcast/api/snapshot${authQuery}`,{cache:'no-store'}),data=await res.json().catch(()=>({error:'오버레이 데이터를 읽지 못했습니다.'}));if(!res.ok)throw Error(data.error||'오버레이 데이터를 읽지 못했습니다.');accept(data);if(connection!=='live')setConnection('polling','안전 새로고침');}catch(error){setConnection('offline',error.message);}}
function connect(){source?.close();setConnection('connecting','실시간 연결 중');if(!('EventSource'in window)){refresh();return;}source=new EventSource(`/broadcast/api/events${authQuery}`);source.addEventListener('snapshot',event=>{try{accept(JSON.parse(event.data));setConnection('live','실시간');}catch{}});source.addEventListener('heartbeat',()=>{lastEventAt=Date.now();if(connection!=='live')setConnection('live','실시간');});source.addEventListener('error',()=>setConnection('offline','재연결 중'));}
setInterval(()=>{if(overlay.current?.status==='called')setText('callCountdown',callClock(overlay.current.callDeadline));if(connection==='live'&&lastEventAt&&Date.now()-lastEventAt>45000){setConnection('stale','연결 지연');source?.close();connect();}},500);
setInterval(()=>{if(connection!=='live')refresh();},8000);
window.addEventListener('pagehide',()=>source?.close());document.addEventListener('visibilitychange',()=>{if(!document.hidden&&connection!=='live')connect();});
render();refresh().finally(connect);
