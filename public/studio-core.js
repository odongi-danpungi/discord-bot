import {simulateDraw} from './draw-engine.js';
import {DEFAULT_AVATAR} from './avatar.js';
import {TRACKS,drawTrackMap} from './maps.js';
import {renderRace} from './race-renderer.js';
import {raceTelemetry} from './live-director.js';

const COLORS=['#ef6d62','#4f8bd8','#e8b64d','#73b88b','#a77ad8','#ea8d4f','#5bb6b2','#d56f9b','#8899aa','#7fbd5a'];
const NAMES=['별하','방울','세모','구름','모카','라임','하루','토리','루나','초코'];
export function sampleParticipants(n){return Array.from({length:n},(_,i)=>({id:'practice-'+i,name:NAMES[i%NAMES.length]+(i>=NAMES.length?Math.floor(i/NAMES.length)+1:''),avatar:{...DEFAULT_AVATAR,color:COLORS[i%COLORS.length]}}));}

export function mountStudio(root,adapter=null){
 const $=s=>root.querySelector(s),canvas=$('[data-stage]'),ctx=canvas.getContext('2d');
 let view='race',draw=null,running=false,playhead=0,last=0,raf=0,snapshot=null,committing=false;
 const status=value=>$('[data-result]').textContent=value;
 const setControls=()=>{const frames=draw?.raceFrames;$('[data-pause]').disabled=!frames?.length;$('[data-replay]').disabled=!draw;$('[data-pause]').textContent=running?'일시 정지':'이어 보기';$('[data-commit]').disabled=committing||snapshot?.state?.session?.phase!=='closed';$('[data-last]').disabled=snapshot?.state?.lastDraw?.mode!=='race';};
 function setupTracks(){const select=$('[data-map]');select.replaceChildren();for(const track of TRACKS){const o=document.createElement('option');o.value=track.id;o.textContent=`${track.name} · ${track.difficulty}`;select.append(o)}const track=TRACKS.find(t=>t.id===select.value)||TRACKS[0];$('[data-laps]').value=String(track.defaultLaps||3);}
 function idle(){const track=TRACKS.find(t=>t.id===$('[data-map]').value)||TRACKS[0];canvas.width=1000;canvas.height=640;drawTrackMap(ctx,track);ctx.fillStyle='#fff9ed';ctx.font='700 24px sans-serif';ctx.textAlign='left';ctx.fillText(track.name,34,42);ctx.fillStyle='#5f7188';ctx.font='600 12px sans-serif';ctx.fillText(`${$('[data-laps]').value} LAPS · 동일 차량 성능 · 공통 부스트 패드`,34,63);$('[data-leader]').textContent='대기';$('[data-lap]').textContent=`0 / ${$('[data-laps]').value}`;$('[data-gap]').textContent='—';$('[data-progress]').textContent='0%';$('[data-clock]').textContent='경기 대기';}
 function displayFrame(){
  const frames=draw?.raceFrames;if(!frames?.length)return;
  const step=Math.max(1,draw.stepMs||50),max=Math.max(1,(frames.length-1)*step),at=Math.max(0,Math.min(frames.length-1,playhead/step)),index=Math.floor(at),next=Math.min(frames.length-1,index+1),alpha=at-index,names=draw.players.map(id=>draw.names?.[id]||id);
  renderRace(ctx,draw,frames[next],names,alpha,frames[index]);const stats=raceTelemetry(draw,frames[next]);if(stats){$('[data-leader]').textContent=names[stats.leader]||'—';$('[data-lap]').textContent=`${stats.lap} / ${draw.laps}`;$('[data-gap]').textContent=stats.gap.toFixed(1);$('[data-progress]').textContent=stats.percent+'%';}
  $('[data-clock]').textContent=`${Math.min(100,Math.round(playhead/max*100))}%`;
  if(playhead>=max){running=false;status(`경기 완료 · ${draw.winners.map(id=>draw.names?.[id]||id).join(' · ')}`);setControls();}
 }
 function play(result){draw=result;if(draw.mode!=='race'){running=false;status('현재 게임 스튜디오는 레이스 기록만 재생합니다.');setControls();return;}setupTracks();$('[data-map]').value=draw.track?.id||TRACKS[0].id;$('[data-laps]').value=String(draw.laps||3);running=true;playhead=0;last=0;status(result.id?'저장된 레이스 재생 중 · 결과는 이미 저장되었습니다.':'가상 레이스 진행 중');setControls();displayFrame();}
 function switchView(next){view=next;root.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('is-on',b.dataset.view===next);b.setAttribute('aria-pressed',String(b.dataset.view===next))});root.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==next);$('[data-title]').textContent=next==='race'?'댕댕 그랑프리':'레이스 서킷 도감';running=false;last=0;if(next==='race'){draw=null;idle();status('1~5랩 선택 · 대형 서킷 5종 · 공통 부스트 패드 · 동일 차량 성능');}setControls();}
 function buildMapCards(){const host=$('[data-race-maps]');host.replaceChildren();for(const track of TRACKS){const button=document.createElement('button');button.type='button';button.className='dd-mapcard';const preview=document.createElement('canvas');preview.width=1000;preview.height=640;preview.setAttribute('aria-label',track.name+' 서킷 미리보기');drawTrackMap(preview.getContext('2d'),track);const name=document.createElement('strong');name.textContent=track.name+' →';const meta=document.createElement('small');meta.textContent=`난이도 ${track.difficulty} · 기본 ${track.defaultLaps}랩 · 부스트 ${(track.boostZones||[]).length}곳`;button.append(preview,name,meta);button.onclick=()=>{switchView('race');$('[data-map]').value=track.id;$('[data-laps]').value=String(track.defaultLaps||3);idle()};host.append(button)}}
 async function refresh(){if(!adapter)return;try{snapshot=await adapter.snapshot();const s=snapshot.state.session,ids=(s?.applicants||[]).filter(id=>!s.postponed?.includes(id));$('[data-session]').textContent=s?`${s.title} · ${ids.length}명 신청 · ${s.count}명 선정`:'진행 중인 모집이 없습니다. 시참 운영에서 시작하세요.';setControls();$('[data-live]').hidden=false;}catch(e){status(e.message)}}
 async function commit(){if(!adapter||committing)return;await refresh();if(snapshot?.state?.session?.phase!=='closed')return status('모집 마감 후 추첨을 확정할 수 있습니다.');committing=true;setControls();try{const result=await adapter.draw({requestId:crypto.randomUUID(),sessionId:snapshot.state.session.id,drawMode:'race',trackId:$('[data-map]').value,laps:Number($('[data-laps]').value)});play(result.draw)}catch(e){status(e.message)}finally{committing=false;setControls();await refresh()}}
 root.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
 $('[data-map]').onchange=()=>{const track=TRACKS.find(t=>t.id===$('[data-map]').value);if(track)$('[data-laps]').value=String(track.defaultLaps||3);idle()};$('[data-laps]').onchange=idle;
 $('[data-start]').onclick=()=>{try{const n=Number($('[data-count]').value),count=Number($('[data-winners]').value);if(!Number.isInteger(n)||n<2||n>100)throw Error('가상 참가자는 2~100명으로 입력해 주세요.');const people=sampleParticipants(n),result=simulateDraw(people.map(p=>p.id),count,'race',undefined,{trackId:$('[data-map]').value,laps:Number($('[data-laps]').value)});result.names=Object.fromEntries(people.map(p=>[p.id,p.name]));result.avatars=Object.fromEntries(people.map(p=>[p.id,p.avatar]));play(result)}catch(e){status(e.message)}};
 $('[data-pause]').onclick=()=>{if(!draw?.raceFrames?.length)return;running=!running;last=0;setControls()};$('[data-replay]').onclick=()=>draw&&play(draw);$('[data-commit]').onclick=commit;$('[data-last]').onclick=async()=>{await refresh();const saved=snapshot?.state?.lastDraw;if(saved?.mode==='race')play(saved);else status('최근 저장 경기가 레이스가 아닙니다.')};
 const animation=t=>{if(!root.isConnected)return;if(document.hidden){last=0;raf=requestAnimationFrame(animation);return;}const elapsed=last?Math.min(100,t-last):0;last=t;if(running&&view==='race'){playhead+=elapsed*Number($('[data-speed]').value);displayFrame()}raf=requestAnimationFrame(animation)};
 setupTracks();buildMapCards();switchView('race');refresh();raf=requestAnimationFrame(animation);
 return {refresh,play,destroy:()=>cancelAnimationFrame(raf)};
}
