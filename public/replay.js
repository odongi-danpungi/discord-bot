import { renderRace } from './race-renderer.js';
import { MODES } from './draw-engine.js';
const $=id=>document.getElementById(id),ctx=$('gameCanvas').getContext('2d'),canvas=$('gameCanvas');let run=0;
const text=(label,x,y,size=15,color='#e9efff',align='center')=>{ctx.fillStyle=color;ctx.font=`600 ${size}px sans-serif`;ctx.textAlign=align;ctx.fillText(label,x,y)};
const color=i=>`hsl(${i*137.5%360} 75% 68%)`;
function clear(){ctx.fillStyle='#101828';ctx.fillRect(0,0,canvas.width,canvas.height)}
export function stopReplay(){run++;if($('arena').open)$('arena').close()}
$('closeArena').onclick=stopReplay;$('arena').addEventListener('cancel',()=>run++);
export async function playReplay(draw,{practice=false}={}){
 const ticket=++run;$('arenaTitle').textContent=MODES[draw.mode]||(draw.mode==='battle'?'이전 추첨 기록':'추첨');$('modeLabel').textContent=practice?'PRACTICE · 연습 결과':'SAVED MATCH · 저장된 경기';$('winnerList').replaceChildren();if(!$('arena').open)$('arena').showModal();
 const names=draw.players?.map(id=>draw.names?.[id]||id)||[],wait=async ms=>{await new Promise(r=>setTimeout(r,ms/Number($('speed').value||1)));return ticket===run};
 const finish=()=>{$('gameStatus').textContent=`${practice?'연습 완료':'저장된 결과'} · ${draw.winners.length}명 선정`;$('winnerList').replaceChildren(...draw.winners.map(id=>{const e=document.createElement('span');e.className='chip ok';e.textContent='🏆 '+(draw.names?.[id]||id);return e}));};
 $('gameStatus').textContent='경기 재생 중 · 연출을 닫아도 저장된 결과는 유지됩니다.';
 if(draw.mode==='race'&&draw.raceFrames){
   canvas.width=1000;canvas.height=640;
   for(let i=0;i<draw.raceFrames.length;i++){
     const frame=draw.raceFrames[i],previous=draw.raceFrames[Math.max(0,i-1)];
     for(let sub=1;sub<=3;sub++){if(ticket!==run)return;renderRace(ctx,draw,frame,names,sub/3,previous);if(!await wait((draw.stepMs||50)/3))return;}
     const lead=frame.positions[frame.rank[0]],lap=draw.version>=4?Math.min(draw.laps,Math.floor(Math.min(lead,(draw.finishDistance||draw.laps*1000)-1)/1000)+1):Math.min(draw.laps,Math.floor(lead/1000*draw.laps)+1);$('gameStatus').textContent='선두 '+names[frame.rank[0]]+' · '+lap+' / '+draw.laps+' LAP';
   }
 }else if(draw.mode==='race'){
   canvas.width=1100;canvas.height=Math.max(450,names.length*50+80);for(const frame of draw.events||[]){if(ticket!==run)return;clear();text('FINISH',1030,28,15,'#ffdc8a');frame.forEach((x,i)=>{const y=65+i*50;ctx.strokeStyle='#2b3c55';ctx.beginPath();ctx.moveTo(170,y+22);ctx.lineTo(1040,y+22);ctx.stroke();text(names[i].slice(0,12),15,y+14,13,'#c9d4ea','left');const cx=170+x*.82;ctx.fillStyle=color(i);ctx.fillRect(cx,y,34,16);ctx.fillStyle='#0b1019';ctx.beginPath();ctx.arc(cx+6,y+17,5,0,Math.PI*2);ctx.arc(cx+28,y+17,5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(1030,y,6,20)});if(!await wait(35))return;}
 }else if(draw.mode==='ladder'){
   canvas.width=Math.max(1000,names.length*115);canvas.height=710;const gap=(canvas.width-150)/Math.max(1,names.length-1),x=i=>75+i*gap,dy=520/Math.max(1,(draw.bridges||[]).length),y=i=>100+i*dy;
   for(let step=0;step<=(draw.bridges||[]).length;step++){clear();names.forEach((name,i)=>{ctx.strokeStyle='#334b69';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x(i),75);ctx.lineTo(x(i),635);ctx.stroke();text(name.slice(0,10),x(i),40,12);text((draw.slots||[]).includes(i)?'당첨':'—',x(i),680,16,(draw.slots||[]).includes(i)?'#86d9b5':'#66809e')});(draw.bridges||[]).forEach((b,i)=>{ctx.beginPath();ctx.moveTo(x(b),y(i));ctx.lineTo(x(b+1),y(i));ctx.stroke()});(draw.paths||[]).forEach((path,i)=>{ctx.strokeStyle=color(i);ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x(path[0]),75);for(let j=0;j<step;j++){ctx.lineTo(x(path[j]),y(j));ctx.lineTo(x(path[j+1]),y(j))}if(step===(draw.bridges||[]).length)ctx.lineTo(x(path.at(-1)),635);ctx.stroke()});if(!await wait(190))return;}
 }else{
   canvas.width=1000;canvas.height=360;clear();text(draw.mode==='battle'?'이전 추첨 기록':'추첨 완료',500,145,32);text(draw.mode==='battle'?'이전 버전 연출은 재생 지원이 종료되었습니다.':'서버에 저장된 결과를 표시합니다.',500,192,16,'#9aa9c2');text(`${draw.winners.length}명 선정`,500,235,20,'#86d9b5');
 }
 if(ticket===run)finish();
}
