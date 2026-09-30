import {renderRace as renderLegacyRace} from './race-renderer-legacy.js';
import {drawTrackMap,trackAt,TRACKS} from './maps.js';
import {INK,COLORS,path,oval,box,label} from './art.js';
export function drawCar(c,color,number,boost=0,time=0){
 oval(c,0,3,24,14,'#112b4340');
 for(const x of[-13,12])for(const y of[-11,8])box(c,x-5,y,11,5,1.8,INK);
 if(boost){path(c,[[-21,-5],[-39-(Math.sin(time*2)+1)*8,0],[-21,5]],'#83e3f1',null);path(c,[[-22,-2],[-36,0],[-22,2]],'#fffce2',null);for(const y of[-14,14])path(c,[[-17,y],[-34,y]],null,'#9af4ef',1.5)}
 box(c,-22,-10,6,20,2,color,INK,1.2);path(c,[[-17,-9],[4,-10],[20,-6],[24,-3],[24,3],[20,6],[4,10],[-17,9]],color,INK,1.6);
 path(c,[[-4,-7],[7,-6],[10,0],[7,6],[-4,7]],'#dceff0',INK,1.1);box(c,-13,-5,9,10,2,INK);path(c,[[3,-4],[6,-3],[7,0]],null,'#fffefa',1.3);box(c,20,-6,3,4,1,'#fff6ca');box(c,20,2,3,4,1,'#fff6ca');
 label(c,number,-8,3,7,'#fff9ed');
}
function metrics(draw,value){
 if(draw.version>=4){const finish=draw.finishDistance||draw.laps*1000;return {trackProgress:value/1000,percent:Math.min(100,Math.round(value/finish*100)),lap:Math.min(draw.laps,Math.floor(Math.min(value,finish-1)/1000)+1),finish};}
 return {trackProgress:value/1000*draw.laps,percent:Math.min(100,Math.round(value/10)),lap:Math.min(draw.laps,Math.floor(value/1000*draw.laps)+1),finish:1000};
}
export function renderRace(c,draw,frame,names,alpha=1,previous=frame,options={}){
 if(draw.version<3)return renderLegacyRace(c,draw,frame,names,alpha,previous,options);
 const track=draw.track||TRACKS[0],night=track.id==='metro',lead=frame.positions[frame.rank[0]],leadMetrics=metrics(draw,lead),lap=leadMetrics.lap,time=frame.tick-1+alpha;
 c.save();drawTrackMap(c,track);
 box(c,18,16,727,65,16,'#fffaf0',INK,1.5);label(c,track.subtitle,36,38,10,'#647b82','left');label(c,track.name,36,61,21,INK,'left');
 box(c,409,30,174,36,8,lap===draw.laps?'#f3cf72':'#dcefe7');label(c,lap===draw.laps?'FINAL LAP':'LAP  '+lap+' / '+draw.laps,496,54,17);
 label(c,(frame.tick*.05).toFixed(2)+' s',722,55,21,INK,'right');
 box(c,771,16,211,608,15,'#fffaf0',INK,1.5);label(c,'RACE ORDER',789,43,11,'#627981','left');label(c,'실시간 순위',789,67,20,INK,'left');
 const rows=frame.rank.slice(0,10);rows.forEach((id,i)=>colorRow(c,draw,id,i,94+i*45,frame,names));
 if(frame.rank.length>10)label(c,'외 '+(frame.rank.length-10)+'명 참가',789,562,11,'#60747b','left');
 label(c,'선정 '+draw.count+'명',789,592,13,INK,'left');label(c,'동일 성능 · 공통 부스트 패드',789,610,10,'#627981','left');
 const labels=[];
 frame.positions.forEach((p,i)=>{
  const value=previous.positions[i]+(p-previous.positions[i])*alpha,m=metrics(draw,value),q=trackAt(track,m.trackProgress),boost=frame.boost[i]>0;
  const lateral=((i%5)-2)*10+Math.sin(time*.025+i*1.73)*2,x=q.x-Math.sin(q.angle)*lateral,y=q.y+Math.cos(q.angle)*lateral;
  const avatar=draw.avatars?.[draw.players[i]],color=avatar?.color||COLORS[i%COLORS.length],drifting=Math.abs(q.curvature)>.18&&frame.speed[i]>(draw.version>=4?4.6:1.6),drift=drifting?Math.max(-.32,Math.min(.32,q.curvature*.65)):0;
  if(drifting){for(const d of[-9,9])path(c,[[x-Math.cos(q.angle)*16-Math.sin(q.angle)*d,y-Math.sin(q.angle)*16+Math.cos(q.angle)*d],[x-Math.cos(q.angle)*34-Math.sin(q.angle)*d,y-Math.sin(q.angle)*34+Math.cos(q.angle)*d]],null,'#172b4630',2);oval(c,x-Math.cos(q.angle)*27,y-Math.sin(q.angle)*27,7,5,'#f6f8eb66');}
  c.save();c.translate(x,y);c.rotate(q.angle+drift);drawCar(c,color,i+1,boost,time+i);c.restore();
  if(names.length<=12||frame.rank.indexOf(i)<3){
   const name=String(names[i]),short=Array.from(name).length>12?Array.from(name).slice(0,11).join('')+'…':name;c.font='600 11px sans-serif';const w=Math.max(40,(c.measureText(short)?.width||short.length*11)+12);let tx=Math.max(w/2+5,Math.min(752-w/2,x)),ty=y-28;
   while(labels.some(a=>Math.abs(a.x-tx)<(a.w+w)/2&&Math.abs(a.y-ty)<22))ty-=23;ty=Math.max(104,ty);labels.push({x:tx,y:ty,w});path(c,[[tx,ty+5],[x,y-11]],null,night?'#bbdbe1':'#476963',.8);box(c,tx-w/2,ty-13,w,20,6,'#fffaf0',INK,.8);label(c,short,tx,ty+1,11);
  }
 });
 const recent=draw.raceFrames.slice(Math.max(0,frame.tick-30),frame.tick+1).flatMap(f=>f.highlights||[]),event=recent.findLast(h=>['lead','finish','sprint','pad'].includes(h.type));
 const status=lead>=leadMetrics.finish?'FINISH!':leadMetrics.percent>94?'결승선까지 마지막 질주':event?.type==='lead'?'선두 교체 · '+names[event.i]:event?.type==='sprint'?'파이널 스프린트 · '+names[event.i]:event?.type==='pad'?'부스트 패드 진입 · '+names[event.i]:'코너를 지나, 다음 추월 기회';
 box(c,114,89,523,29,12,INK);label(c,status,375,109,12,'#fff8e5');
 const gap=frame.rank.length>1?frame.positions[frame.rank[0]]-frame.positions[frame.rank[1]]:0;
 box(c,287,354,187,46,10,night?'#20364b':'#fff9e9');label(c,gap<(draw.version>=4?18:5)&&frame.tick>30?'선두 접전':'DAENGDAENG GP',380,373,13,night?'#fff9e9':INK);label(c,'BOOST PADS · '+draw.laps+' LAPS',380,390,10,night?'#bfd7dd':'#69827b');
 c.restore();
}
function colorRow(c,draw,id,rank,y,frame,names){
 const color=draw.avatars?.[draw.players[id]]?.color||COLORS[id%COLORS.length],m=metrics(draw,frame.positions[id]);if(rank===0)box(c,781,y-10,191,39,7,'#deefe5');label(c,String(rank+1).padStart(2,'0'),792,y+10,13,INK,'left');oval(c,822,y+5,5,5,color,INK,.7);
 const name=Array.from(String(names[id]));label(c,name.length>8?name.slice(0,7).join('')+'…':name.join(''),836,y+4,12,INK,'left');const finish=(draw.finishTimes||[]).find(t=>t.i===id),done=frame.positions[id]>=m.finish;
 label(c,done&&finish?(finish.time*.05).toFixed(3)+' s':frame.boost[id]>0?'BOOST':`L${m.lap} · ${m.percent}%`,836,y+19,10,done?'#358b73':'#667d82','left');
}
