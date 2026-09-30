export function renderRace(ctx,draw,frame,names,alpha=1,previous=frame,options={}){
 const light=Boolean(options.light),bg=light?'#eef2e0':'#152b30',ink=light?'#263b35':'#edf7ec',panel=light?'#fffdf3':'#163038';
 ctx.fillStyle=bg;ctx.fillRect(0,0,1000,640);
 const txt=(s,x,y,size=16,color=ink,align='center')=>{ctx.fillStyle=color;ctx.font=`500 ${size}px sans-serif`;ctx.textAlign=align;ctx.fillText(s,x,y)};
 const cx=365,cy=340,rx=275,ry=180;
 const oval=(x,y,a,b,color,width)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.ellipse(x,y,a,b,0,0,Math.PI*2);ctx.stroke()};
 oval(cx,cy,rx,ry,'#d4cfbe',100);oval(cx,cy,rx,ry,'#536267',83);ctx.setLineDash([12,12]);oval(cx,cy,rx,ry,'#cfd6c4',2);ctx.setLineDash([]);
 for(let i=0;i<18;i++){const angle=i*Math.PI/9,x=cx+Math.cos(angle)*(rx+62),y=cy+Math.sin(angle)*(ry+60);ctx.fillStyle=i%2?'#d9806e':'#efead5';ctx.fillRect(x-5,y-5,10,10)}
 ctx.fillStyle=panel;ctx.fillRect(740,85,245,530);
 const leader=frame.rank[0],lead=frame.positions[leader],lap=Math.min(3,Math.floor(lead/1000*3)+1);
 txt(lap===3?'FINAL LAP':'LAP '+lap+' / 3',365,45,27);txt('2D 서킷 · 부스터 · 추월',365,78,15);
 txt('LIVE RANKING',862,120,18);frame.rank.slice(0,10).forEach((id,i)=>{txt(`${i+1}. ${names[id]}`,754,155+i*41,14,ink,'left');txt(frame.positions[id]>=1000?'FINISH':(1000-frame.positions[id]).toFixed(1),969,155+i*41,12,ink,'right')});
 txt('댕댕 서킷',cx,cy-15,26);txt('선정 '+draw.count+'명',cx,cy+20,17);txt('동일 차량 성능 · 무작위 부스트',cx,cy+53,14);
 for(let j=0;j<9;j++)for(let k=0;k<3;k++){ctx.fillStyle=(j+k)%2?'#202528':'#fff';ctx.fillRect(cx+rx-43+j*10,cy+k*8-12,10,8)}
 frame.positions.forEach((p,i)=>{
  const value=previous.positions[i]+(p-previous.positions[i])*alpha,angle=value/1000*6*Math.PI,offset=(i%5-2)*12,x=cx+(rx+offset)*Math.cos(angle),y=cy+(ry+offset)*Math.sin(angle),heading=Math.atan2((ry+offset)*Math.cos(angle),-(rx+offset)*Math.sin(angle));
  ctx.save();ctx.translate(x,y);ctx.rotate(heading);ctx.fillStyle='#142027';ctx.fillRect(-16,-12,9,5);ctx.fillRect(7,-12,9,5);ctx.fillRect(-16,7,9,5);ctx.fillRect(7,7,9,5);
  if(frame.boost[i]>0){ctx.fillStyle='#ffc857';ctx.beginPath();ctx.moveTo(-18,-5);ctx.lineTo(-38-(frame.tick%3)*4,0);ctx.lineTo(-18,5);ctx.fill();ctx.strokeStyle='#d8fcff';ctx.lineWidth=2;for(const y of [-15,15]){ctx.beginPath();ctx.moveTo(-20,y);ctx.lineTo(-45,y);ctx.stroke()}}
  ctx.fillStyle=`hsl(${i*137.5%360} 68% 57%)`;ctx.fillRect(-18,-8,36,16);ctx.fillStyle='#e5f5f7';ctx.fillRect(0,-6,8,12);ctx.fillStyle='#273740';ctx.fillRect(-10,-6,8,12);ctx.fillStyle='#fff';ctx.fillRect(14,-6,3,4);ctx.fillRect(14,2,3,4);ctx.restore();
  txt(String(i+1),x,y-19,12);
 });
 const gap=frame.rank.length>1?frame.positions[frame.rank[0]]-frame.positions[frame.rank[1]]:0;
 txt(lead>930?'결승선 접근!':gap<5&&frame.tick>30?'선두 접전!':'순위는 결승선 통과로 결정됩니다',365,602,19);
}
