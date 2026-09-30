export const INK='#172b46';
export const COLORS=['#77d8be','#77aaf3','#f58d89','#f3cf72','#b3a0e8','#8ed4e3','#d9a5cb','#adce83'];
export function path(c,p,fill,stroke=INK,w=2){c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(fill){c.closePath();c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=w;c.lineJoin='round';c.lineCap='round';c.stroke()}}
export function oval(c,x,y,rx,ry,fill,stroke=null,w=2){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=w;c.stroke()}}
export function box(c,x,y,w,h,r,fill,stroke=null,lw=1){r=Math.max(0,Math.min(r,w/2,h/2));c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke()}}
export function label(c,s,x,y,size=14,color=INK,align='center',weight=600){c.font=`${weight} ${size}px "Malgun Gothic", "Noto Sans CJK KR", sans-serif`;c.textAlign=align;c.textBaseline='alphabetic';c.fillStyle=color;c.fillText(String(s),x,y)}
export function star(c,x,y,r,color='#ffe298',points=5,inner=.45,rotation=-Math.PI/2){path(c,Array.from({length:points*2},(_,i)=>{const a=rotation+i*Math.PI/points,d=i%2?r*inner:r;return[x+Math.cos(a)*d,y+Math.sin(a)*d]}),color,INK,1.5)}
export function drawWeapon(c,kind,accent='#78d8c0'){
 const steel='#e6f2f4',gold='#f3ce70',line=(p,w,col)=>path(c,p,null,col,w);
 switch(kind){
 case 'sword':box(c,-8,-3,18,6,2,INK);path(c,[[10,-5],[35,-5],[46,0],[35,5],[10,5]],steel);line([[16,-2],[36,-2]],1,'#92b7c9');box(c,6,-10,5,20,2,accent,INK);break;
 case 'bow':c.beginPath();c.moveTo(10,-25);c.quadraticCurveTo(37,0,10,25);c.strokeStyle=INK;c.lineWidth=5;c.stroke();c.strokeStyle=gold;c.lineWidth=2.5;c.stroke();line([[10,-25],[4,0],[10,25]],1,'#edf4ed');line([[-6,0],[42,0]],2,INK);path(c,[[35,-4],[44,0],[35,4]],steel);box(c,19,-5,6,10,2,accent,INK);break;
 case 'hammer':box(c,-6,-3,40,6,2,gold,INK);box(c,25,-17,23,34,7,'#f58d89',INK,2.5);line([[30,-11],[30,11]],2,'#ffe5d7');oval(c,37,0,4,4,'#fff9e9');break;
 case 'spear':box(c,-25,-2,65,4,2,gold,INK);path(c,[[36,-7],[55,0],[36,7],[40,0]],steel);box(c,29,-4,8,8,2,accent,INK);break;
 case 'axe':box(c,-9,-3,48,6,2,gold,INK);path(c,[[28,-3],[26,-20],[40,-16],[49,-7],[49,8],[32,12]],'#8eb2d0',INK,2.5);line([[45,-5],[45,6],[34,9]],2,steel);break;
 case 'daggers':for(const y of[-9,9]){box(c,-7,y-2,15,4,1,INK);path(c,[[7,y-4],[27,y-4],[35,y],[27,y+4],[7,y+4]],steel);box(c,4,y-7,4,14,1,y<0?accent:'#f58d89',INK)}break;
 case 'boomerang':path(c,[[0,-20],[11,-23],[34,0],[11,23],[0,20],[18,0]],gold,INK,2.5);line([[5,-17],[11,-16],[24,-2]],5,'#71acd6');break;
 case 'wand':box(c,-7,-3,39,6,2,gold,INK);star(c,36,0,16);oval(c,33,-2,1.2,1.8,INK);oval(c,39,-2,1.2,1.8,INK);break;
 }
}
