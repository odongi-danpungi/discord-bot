import {INK,path,oval,box,label,star} from './art.js';
export const TRACKS=[
 {id:'coast',name:'코랄 코스트',subtitle:'COAST CIRCUIT',difficulty:'보통',defaultLaps:3,roadWidth:82,ground:'#98d6ba',water:'#76c7d0',road:'#4c5b67',boostZones:[.18,.51,.78],points:[[610,520],[390,548],[174,520],[91,404],[110,245],[205,166],[330,194],[389,302],[492,318],[565,192],[684,243],[680,404]]},
 {id:'metro',name:'미드나잇 시티',subtitle:'MIDNIGHT CIRCUIT',difficulty:'어려움',defaultLaps:3,roadWidth:78,ground:'#243d57',water:'#192d43',road:'#526077',boostZones:[.12,.43,.82],points:[[604,528],[361,540],[127,500],[94,314],[152,175],[290,190],[357,288],[479,221],[615,176],[699,293],[626,416]]},
 {id:'alpine',name:'스노우 밸리',subtitle:'SNOW CIRCUIT',difficulty:'보통',defaultLaps:3,roadWidth:84,ground:'#c5e2e3',water:'#81b7cc',road:'#677c8b',boostZones:[.2,.55,.86],points:[[610,520],[384,546],[168,507],[106,382],[165,270],[110,178],[280,153],[403,247],[493,164],[672,215],[684,381]]},
 {id:'harbor',name:'하버 링',subtitle:'HARBOR RING',difficulty:'쉬움',defaultLaps:3,roadWidth:88,ground:'#9ecab7',water:'#4aa3b4',road:'#455b68',boostZones:[.09,.36,.68,.9],points:[[635,506],[472,552],[258,545],[111,474],[79,341],[112,213],[226,141],[365,158],[457,249],[552,170],[693,214],[721,351],[681,454]]},
 {id:'canyon',name:'선셋 캐니언',subtitle:'SUNSET CANYON',difficulty:'매우 어려움',defaultLaps:4,roadWidth:74,ground:'#d8b07d',water:'#6fa1a8',road:'#594d4f',boostZones:[.15,.47,.73],points:[[614,530],[416,558],[229,519],[116,430],[145,334],[80,241],[183,153],[327,193],[402,287],[487,248],[566,142],[705,207],[683,338],[735,435]]}
];
export function getTrack(id){const t=TRACKS.find(t=>t.id===id);if(!t)throw Error('등록된 서킷을 선택해 주세요.');return t}
const cache=new Map();
// Closed Catmull-Rom curve resampled by arc length; shared by simulation and rendering.
export function trackSamples(track){
 const key=JSON.stringify(track.points);if(cache.has(key))return cache.get(key);
 const raw=[],p=track.points,n=p.length;
 for(let i=0;i<n;i++)for(let k=0;k<28;k++){
  const t=k/28,t2=t*t,t3=t2*t,p0=p[(i+n-1)%n],p1=p[i],p2=p[(i+1)%n],p3=p[(i+2)%n];
  raw.push([0,1].map(j=>.5*((2*p1[j])+(-p0[j]+p2[j])*t+(2*p0[j]-5*p1[j]+4*p2[j]-p3[j])*t2+(-p0[j]+3*p1[j]-3*p2[j]+p3[j])*t3)));
 }
 raw.push(raw[0]);const ds=[0];for(let i=1;i<raw.length;i++)ds.push(ds.at(-1)+Math.hypot(raw[i][0]-raw[i-1][0],raw[i][1]-raw[i-1][1]));
 let j=1;const out=[];for(let k=0;k<900;k++){const d=ds.at(-1)*k/900;while(ds[j]<d)j++;const f=(d-ds[j-1])/(ds[j]-ds[j-1]);out.push({x:raw[j-1][0]+(raw[j][0]-raw[j-1][0])*f,y:raw[j-1][1]+(raw[j][1]-raw[j-1][1])*f})}
 for(let k=0;k<out.length;k++){const a=out[(k+out.length-3)%out.length],b=out[(k+3)%out.length];out[k].angle=Math.atan2(b.y-a.y,b.x-a.x)}
 for(let k=0;k<out.length;k++){let d=out[(k+8)%out.length].angle-out[(k+out.length-8)%out.length].angle;d=Math.atan2(Math.sin(d),Math.cos(d));out[k].curvature=d;}
 if(cache.size>24)cache.clear();cache.set(key,out);return out;
}
export function trackAt(track,progress){const a=trackSamples(track),p=((progress%1)+1)%1*a.length,i=Math.floor(p),f=p-i,x=a[i],y=a[(i+1)%a.length];let d=y.angle-x.angle;d=Math.atan2(Math.sin(d),Math.cos(d));return{x:x.x+(y.x-x.x)*f,y:x.y+(y.y-x.y)*f,angle:x.angle+d*f,curvature:x.curvature+(y.curvature-x.curvature)*f}}
function pine(c,x,y,s,light='#61a896',dark='#388979'){box(c,x-3*s,y,6*s,24*s,1,'#897b65');path(c,[[x,y-61*s],[x-22*s,y+8*s],[x+22*s,y+8*s]],light,null);path(c,[[x,y-61*s],[x,y+8*s],[x+22*s,y+8*s]],dark,null);}
function cloud(c,x,y,s=1,col='#fffaf0'){oval(c,x,y,45*s,14*s,col);oval(c,x-17*s,y-10*s,19*s,19*s,col);oval(c,x+11*s,y-17*s,24*s,24*s,col)}
export function drawBattleMap(c,arena,time=0){
 const id=arena.mapId,night=id==='forge';
 c.fillStyle=night?'#172a47':id==='temple'?'#baddf0':'#c4e9e6';c.fillRect(0,0,1000,640);
 if(night){
  oval(c,831,145,29,29,'#f7dc91');oval(c,844,134,28,29,'#172a47');
  for(let i=0;i<25;i++)oval(c,(i*167+73)%1000,98+(i*37)%240,1.1,1.1,'#badce3');
  for(let i=0;i<13;i++){const x=i*86-20,h=65+(i*41)%155;box(c,x,500-h,62,h,2,i%2?'#254860':'#203d55');for(let y=510-h;y<470;y+=22)for(let dx=10;dx<60;dx+=18)box(c,x+dx,y,5,9,1,(i+dx+y)%3?'#509ab3':'#eed38e')}
  path(c,[[120,490],[120,170],[380,170],[286,120],[120,170]],null,'#39647a',9);path(c,[[285,173],[285,350]],null,'#528899',2);box(c,264,345,40,46,3,'#edba69','#254458',3);
  box(c,696,437,187,115,3,'#305c6a');for(let x=705;x<884;x+=18)path(c,[[x,442],[x,549]],null,'#447485',2);
  c.fillStyle='#1e4056';c.fillRect(0,570,1000,70);for(let i=0;i<24;i++)path(c,[[(i*73+time)%1000,604+(i%4)*8],[(i*73+time)%1000+32,604+(i%4)*8]],null,'#3d7284',2);
 }else{
  cloud(c,180,171,.9);cloud(c,777,118,1.25);cloud(c,491,241,.7);
  path(c,[[0,461],[124,319],[265,456],[406,305],[562,470],[758,312],[1000,444],[1000,640],[0,640]],id==='temple'?'#a4cadd':'#91c9bc',null);
  path(c,[[0,523],[195,410],[340,511],[545,384],[744,528],[1000,433],[1000,640],[0,640]],id==='temple'?'#c7e1e7':'#a5d7c1',null);
  if(id==='temple'){
   for(const x of[90,865]){box(c,x,282,45,283,4,'#dae1d5');box(c,x-9,278,63,16,2,'#f4efdb');path(c,[[x+12,302],[x+12,558]],null,'#c1d2cb',4);box(c,x-9,553,63,16,2,'#e8e9d5')}
   cloud(c,220,580,2);cloud(c,750,602,3);
  }else{for(const[x,y,s]of[[50,498,1.2],[152,540,.8],[862,522,1.1],[971,493,1.6]])pine(c,x,y,s);}
 }
 for(const p of arena.platforms){
  if(id==='grove'){
   path(c,[[p.x,p.y+4],[p.x+p.width,p.y+4],[p.x+p.width-12,p.y+28],[p.x+p.width*.7,p.y+45],[p.x+p.width*.5,p.y+32],[p.x+14,p.y+34]],'#849b93',INK,1.8);
   box(c,p.x,p.y,p.width,12,5,'#91cc91',INK,1.5);path(c,[[p.x+6,p.y+2],[p.x+p.width-6,p.y+2]],null,'#d3edac',3);
   for(let x=p.x+15;x<p.x+p.width-10;x+=37){path(c,[[x,p.y],[x-3,p.y-5],[x+2,p.y-3],[x+6,p.y-7]],null,'#619976',1.4);if(x%2)oval(c,x+8,p.y-3,2,2,'#fff2bd');}
  }else if(id==='temple'){
   box(c,p.x,p.y,p.width,23,3,'#f3efdb','#617e88',1.8);for(let x=p.x+34;x<p.x+p.width;x+=48)path(c,[[x,p.y+4],[x,p.y+20]],null,'#c1ccb9',1);box(c,p.x+8,p.y+23,p.width-16,9,2,'#bccdbf');
  }else{
   box(c,p.x,p.y,p.width,25,3,'#467980','#142b41',2);box(c,p.x+3,p.y,p.width-6,5,1,'#88e3d1');for(let x=p.x+10;x<p.x+p.width-8;x+=40)box(c,x,p.y+10,19,5,1,'#edce7e');
  }
 }
}
function drawBoostPad(c,track,progress){const q=trackAt(track,progress);c.save();c.translate(q.x,q.y);c.rotate(q.angle);for(const off of[-11,0,11])path(c,[[-8,off-5],[1,off],[ -8,off+5]],null,'#80f0da',2.8);c.restore();}
export function drawTrackMap(c,track){
 c.fillStyle=track.water;c.fillRect(0,0,1000,640);
 box(c,22,92,744,526,118,track.id==='metro'?'#334c63':track.id==='canyon'?'#c99766':'#efe1b9');box(c,39,110,710,494,108,track.ground);
 const samples=trackSamples(track),rw=track.roadWidth||80,road=w=>{c.beginPath();samples.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.lineJoin='round';c.lineWidth=w;c.stroke()};
 c.strokeStyle='#23384933';road(rw+27);c.strokeStyle='#f2f2df';road(rw+17);c.setLineDash([13,13]);c.strokeStyle=track.id==='metro'?'#f590a5':track.id==='canyon'?'#f3c879':'#ec897f';road(rw+17);c.setLineDash([]);c.strokeStyle=track.road;road(rw);
 c.setLineDash([14,16]);c.strokeStyle='#dce8e068';road(1.3);c.setLineDash([]);
 if(track.id==='metro'){
  for(const[x,y,w,h]of[[257,365,52,85],[397,369,70,64],[397,128,48,51],[648,438,47,58]]){box(c,x+5,y+6,w,h,3,'#142b3d');box(c,x,y,w,h,3,'#426078','#739cab',1.5);for(let a=x+9;a<x+w-4;a+=13)for(let b=y+9;b<y+h-4;b+=16)box(c,a,b,5,5,1,'#8fe0d3')}
 }else if(track.id==='harbor'){
  for(const[x,y,w,h]of[[175,374,56,36],[322,408,72,44],[505,391,62,41]]){box(c,x,y,w,h,4,'#e9d6b1',INK,1);path(c,[[x+8,y+h],[x+8,y+h+24]],null,'#40646c',3);path(c,[[x+w-8,y+h],[x+w-8,y+h+24]],null,'#40646c',3)}
  for(const[x,y]of[[202,118],[537,111],[708,519]]){path(c,[[x,y],[x,y+58]],null,'#eef7e8',4);path(c,[[x,y],[x+34,y+16],[x,y+26]],'#f5a777',INK,1)}
  oval(c,424,356,54,24,'#6dbac4');
 }else if(track.id==='canyon'){
  for(const[x,y,s]of[[212,350,1],[284,409,.8],[452,425,.9],[610,471,.8],[415,121,.75]]){path(c,[[x-22*s,y+18*s],[x,y-24*s],[x+24*s,y+18*s]],'#b57d52',INK,1);path(c,[[x-15*s,y+10*s],[x,y-8*s],[x+16*s,y+10*s]],'#d7a26d',null)}
  for(const[x,y]of[[87,527],[713,523]])star(c,x,y,5,2.5,'#ffe19a');
 }else{
  for(const[x,y,s]of[[242,368,.55],[295,405,.7],[453,422,.55],[400,155,.6],[698,542,.6],[59,153,.7]]){oval(c,x,y+8,19*s,9*s,'#34535724');pine(c,x,y,s,track.id==='alpine'?'#f1f9ed':'#61ac87',track.id==='alpine'?'#a3c9c9':'#388c76');}
  oval(c,388,385,50,24,track.water);oval(c,377,380,22,9,track.id==='alpine'?'#cfeef0':'#b6e7dc');
 }
 for(const z of track.boostZones||[])drawBoostPad(c,track,z);
 const finish=trackAt(track,0);c.save();c.translate(finish.x,finish.y);c.rotate(finish.angle);for(let i=0;i<2;i++)for(let j=0;j<10;j++)box(c,i*7-7,j*7.5-37.5,7,7.5,0,(i+j)%2?INK:'#fff9ef');c.restore();
 label(c,'START / FINISH',finish.x,finish.y+65,10,track.id==='metro'?'#f5edd9':INK);
 for(const p of[.16,.48,.72]){const q=trackAt(track,p);c.save();c.translate(q.x,q.y);c.rotate(q.angle);path(c,[[-9,-8],[0,0],[-9,8]],null,'#e3f4e580',2);c.restore();}
}
