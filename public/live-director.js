import { renderRace } from './race-renderer.js';
import { TRACKS, drawTrackMap } from './maps.js';

const MODE_LABELS={race:'자동차 레이스',ladder:'사다리',instant:'즉시 추첨',battle:'이전 추첨 기록'};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export function raceTelemetry(draw,frame){
 if(!draw||draw.mode!=='race'||!frame)return null;
 const leader=frame.rank?.[0];if(leader===undefined)return null;
 const finish=draw.version>=4?(draw.finishDistance||draw.laps*1000):1000;
 const value=frame.positions[leader]||0;
 const second=frame.rank?.[1];
 const gap=second===undefined?0:value-(frame.positions[second]||0);
 const lap=draw.version>=4?Math.min(draw.laps,Math.floor(Math.min(value,finish-1)/1000)+1):Math.min(draw.laps,Math.floor(value/1000*draw.laps)+1);
 return {leader,lap,percent:clamp(Math.round(value/finish*100),0,100),gap};
}

export function createLiveDirector({canvas,status,result,modeBadge,session,eligible,lastSaved,leader,lap,gap,progress,pause,replay,getSpeed=()=>1,onComplete=()=>{}}){
 const ctx=canvas.getContext('2d');
 let draw=null,running=false,playhead=0,lastTime=0,raf=0,practice=false,completionSent=false,previewConfig={mode:'race'};
 const setText=(el,value)=>{if(el)el.textContent=value};
 const names=()=>draw?.players?.map(id=>draw.names?.[id]||id)||[];
 const frames=()=>draw?.mode==='race'?draw.raceFrames:null;
 const stepMs=()=>draw?.stepMs||50;
 const updateControls=()=>{if(pause){pause.disabled=!draw||!frames()?.length;pause.textContent=running?'일시 정지':'이어 보기';}if(replay)replay.disabled=!draw;};
 const paintBackdrop=(title,subtitle='')=>{
  canvas.width=1000;canvas.height=640;ctx.fillStyle='#0b1220';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#111b2d';ctx.fillRect(42,54,916,532);ctx.strokeStyle='#30415f';ctx.lineWidth=2;ctx.strokeRect(42,54,916,532);
  ctx.textAlign='center';ctx.fillStyle='#e8eefc';ctx.font='700 28px sans-serif';ctx.fillText(title,500,285);
  ctx.fillStyle='#8f9db6';ctx.font='500 15px sans-serif';ctx.fillText(subtitle,500,318);
 };
 const renderLadder=()=>{
  const list=names(),n=Math.max(2,list.length);canvas.width=1000;canvas.height=640;ctx.fillStyle='#0b1220';ctx.fillRect(0,0,1000,640);
  const left=90,right=910,top=110,bottom=500,dx=(right-left)/(n-1);ctx.strokeStyle='#91a0bb';ctx.lineWidth=2;
  for(let i=0;i<n;i++){ctx.beginPath();ctx.moveTo(left+i*dx,top);ctx.lineTo(left+i*dx,bottom);ctx.stroke();ctx.textAlign='center';ctx.fillStyle='#e7edf8';ctx.font='600 11px sans-serif';ctx.fillText(list[i]||'',left+i*dx,86)}
  const bridges=draw?.bridges||[];bridges.forEach((b,index)=>{const y=top+(index+1)*(bottom-top)/(bridges.length+1);ctx.beginPath();ctx.moveTo(left+b*dx,y);ctx.lineTo(left+(b+1)*dx,y);ctx.stroke();});
  ctx.fillStyle='#a6b2c7';ctx.font='600 13px sans-serif';ctx.fillText('사다리 결과 · 당첨 '+(draw?.winners?.map(id=>draw.names?.[id]||id).join(', ')||'—'),500,566);
 };
 const renderInstant=(legacy=false)=>{
  paintBackdrop(legacy?'이전 추첨 기록':'즉시 추첨 완료',legacy?'이전 버전의 연출은 재생하지 않고 저장된 결과만 표시합니다.':'서버에서 저장된 결과를 표시합니다.');const winners=draw?.winners||[];
  ctx.fillStyle='#8fe0bc';ctx.font='700 23px sans-serif';ctx.fillText(winners.map(id=>draw.names?.[id]||id).join(' · ')||'선정 결과 없음',500,378);
 };
 const renderPreview=cfg=>{
  cancelAnimationFrame(raf);running=false;draw=null;practice=false;previewConfig={...previewConfig,...cfg};
  const mode=previewConfig.mode;setText(modeBadge,MODE_LABELS[mode]||mode);setText(result,'선택한 추첨 설정의 실시간 미리보기입니다.');
  if(mode==='race'){
   const track=TRACKS.find(t=>t.id===previewConfig.trackId)||TRACKS[0];canvas.width=1000;canvas.height=640;drawTrackMap(ctx,track);
   ctx.fillStyle='#fff9ed';ctx.font='700 24px sans-serif';ctx.textAlign='left';ctx.fillText(track.name,34,42);ctx.fillStyle='#5f7188';ctx.font='600 12px sans-serif';ctx.fillText(`${previewConfig.laps||track.defaultLaps||3} LAPS · 난이도 ${track.difficulty} · 추첨 전 미리보기`,34,63);
   setText(leader,'대기');setText(lap,`0 / ${previewConfig.laps||track.defaultLaps||3}`);setText(gap,'—');setText(progress,'0%');
  }else if(mode==='ladder'){paintBackdrop('사다리 추첨','경기 시작 시 참가자 경로를 무작위로 생성합니다.');setText(leader,'대기');setText(lap,'사다리');setText(gap,'—');setText(progress,'0%');}
  else{paintBackdrop('즉시 추첨','서버에서 무작위 결과를 계산해 바로 저장합니다.');setText(leader,'대기');setText(lap,'즉시');setText(gap,'—');setText(progress,'0%');}
  setText(status,'DIRECTOR READY · 추첨 설정을 확인하세요.');updateControls();
 };
 const complete=()=>{if(completionSent||!draw)return;completionSent=true;try{onComplete(draw,{practice});}catch{}};
 const renderFrame=()=>{
  if(!draw)return;const list=frames();
  if(!list?.length){if(draw.mode==='ladder')renderLadder();else renderInstant(draw.mode==='battle');return;}
  const step=stepMs(),max=Math.max(1,(list.length-1)*step),at=clamp(playhead/step,0,list.length-1),index=Math.floor(at),next=Math.min(list.length-1,index+1),alpha=at-index,allNames=names();
  renderRace(ctx,draw,list[next],allNames,alpha,list[index]);const t=raceTelemetry(draw,list[next]);if(t){setText(leader,allNames[t.leader]||'—');setText(lap,`${t.lap} / ${draw.laps}`);setText(gap,t.gap.toFixed(1));setText(progress,`${t.percent}%`);}
  if(playhead>=max){running=false;setText(status,`${practice?'연습':'저장 경기'} 완료 · ${draw.winners.length}명 선정`);setText(result,draw.winners.map(id=>draw.names?.[id]||id).join(' · ')||'선정 결과 없음');updateControls();complete();}
 };
 const loop=now=>{if(!running)return;if(!lastTime)lastTime=now;const delta=Math.min(100,now-lastTime);lastTime=now;playhead+=delta*Math.max(.25,Number(getSpeed())||1);renderFrame();if(running)raf=requestAnimationFrame(loop);};
 const play=async(resultDraw,{practice:practiceMode=false}={})=>{
  cancelAnimationFrame(raf);draw=resultDraw;practice=practiceMode;running=false;completionSent=false;lastTime=0;playhead=0;setText(modeBadge,MODE_LABELS[draw.mode]||draw.mode);setText(status,practice?'PRACTICE · 가상 경기 재생':'LIVE RESULT · 저장된 경기 재생');setText(result,'경기 진행 중…');
  const list=frames();if(list?.length){canvas.width=1000;canvas.height=640;running=true;renderFrame();raf=requestAnimationFrame(loop);}else{renderFrame();setText(status,`${practice?'연습':'저장 경기'} 완료 · ${draw.winners.length}명 선정`);setText(result,draw.winners.map(id=>draw.names?.[id]||id).join(' · ')||'선정 결과 없음');queueMicrotask(complete);}updateControls();
 };
 const replayCurrent=()=>{if(draw)play(draw,{practice});};
 if(pause)pause.onclick=()=>{if(!draw||!frames()?.length)return;running=!running;lastTime=0;if(running)raf=requestAnimationFrame(loop);updateControls();};
 if(replay)replay.onclick=replayCurrent;
 const updateContext=({session:activeSession,eligibleCount=0,lastDraw=null}={})=>{setText(session,activeSession?`${activeSession.round||1}판 · ${activeSession.title}`:'진행 중인 모집 없음');setText(eligible,activeSession?`${eligibleCount} / ${activeSession.count}명`:'—');setText(lastSaved,lastDraw?`${MODE_LABELS[lastDraw.mode]||lastDraw.mode} · ${new Date(lastDraw.at).toLocaleTimeString('ko-KR')}`:'저장 경기 없음');};
 renderPreview(previewConfig);
 return {preview:renderPreview,play,replay:replayCurrent,current:()=>draw,updateContext,destroy:()=>{cancelAnimationFrame(raf);running=false;}};
}
