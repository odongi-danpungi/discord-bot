import {INK,path,oval,box} from './art.js';
export const AVATAR_OPTIONS={eyes:['dot','oval','happy','sleepy','wink','glasses'],mouth:['none','smile','o','flat','grin'],brows:['none','soft','bold','up'],clothes:['none','vest','hoodie','jacket'],hat:['none','beret','beanie','cap','frog'],shoes:['plain','sneakers','boots'],gloves:['none','mittens','sport']};
export const DEFAULT_AVATAR={color:'#77d8be',outfitColor:'#f8f3df',eyes:'oval',mouth:'smile',brows:'soft',clothes:'none',hat:'none',shoes:'sneakers',gloves:'sport'};
export function validateAvatar(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('캐릭터 설정을 확인해 주세요.');const out={};for(const field of['color','outfitColor']){if(typeof input[field]!=='string'||!/^#[0-9a-f]{6}$/i.test(input[field]))throw Error('색상은 올바른 HEX 값이어야 합니다.');out[field]=input[field]}for(const[key,values]of Object.entries(AVATAR_OPTIONS)){if(!values.includes(input[key]))throw Error('지원하지 않는 꾸미기 항목입니다: '+key);out[key]=input[key]}return out}
// Original front orthographic rig. Feet at y=34 match the server collision anchor.
export function drawAvatar(c,avatar,pose={}){
 const a={...DEFAULT_AVATAR,...avatar},s=pose.stride||0,le=pose.leftElbow||[-14,1],lh=pose.leftHand||[-19,12],re=pose.rightElbow||[14,1],rh=pose.rightHand||[19,12];
 const lk=pose.leftKnee||[-6-s*.42,20-Math.max(0,s)*.15],rk=pose.rightKnee||[6+s*.42,20-Math.max(0,-s)*.15],lf=pose.leftFoot||[-9-s,32-Math.max(0,s)*.38],rf=pose.rightFoot||[9+s,32-Math.max(0,-s)*.38];
 const line=(p,w=2,col=INK)=>path(c,p,null,col,w),limb=p=>{line(p,6.6);line(p,3.5,a.color)};
 c.save();c.lineCap='round';c.lineJoin='round';limb([[0,8],lk,lf]);limb([[0,8],rk,rf]);limb([[-4,-12],le,lh]);limb([[4,-12],re,rh]);box(c,-6,-20,12,33,6,a.color,INK,2.1);
 if(a.clothes!=='none'){
  path(c,[[-6,-18],[-11,-13],[-8,-4],[-7,10],[7,10],[8,-4],[11,-13],[6,-18],[0,-14]],a.outfitColor,INK,1.8);
  if(a.clothes==='vest'||a.clothes==='jacket'){line([[0,-14],[0,9]],1.2);line([[-5,-15],[-2,-9],[0,-14],[2,-9],[5,-15]],1);box(c,-6,1,4,4,.5,'#fff9ec',INK,.7);box(c,2,1,4,4,.5,'#fff9ec',INK,.7);if(a.clothes==='jacket'){line([[-10,-11],le],5,a.outfitColor);line([[10,-11],re],5,a.outfitColor)}}
  else{line([[-5,-14],[-3,-7]],1,'#fff9ed');line([[5,-14],[3,-7]],1,'#fff9ed');path(c,[[-4,2],[-5,6],[5,6],[4,2]],null,INK,1)}
 }
 for(const[x,y]of[lh,rh]){oval(c,x,y,3.7,4.3,a.gloves==='none'?a.color:a.gloves==='sport'?INK:a.outfitColor,INK,1.7);if(a.gloves!=='none')box(c,x-3.7,y-4,7.4,3,1,'#f8f5e8',INK,.8);if(a.gloves==='sport')line([[x-1.3,y],[x+1.3,y]],1.2,a.color)}
 for(const[x,y]of[lf,rf]){if(a.shoes==='plain'){oval(c,x,y+1,4.8,2.3,a.color,INK,1.5);continue}if(a.shoes==='boots')box(c,x-3,y-7,6,8,1,a.outfitColor,INK,1.3);box(c,x-5.8,y-3.5,11.6,7,2,a.shoes==='boots'?a.outfitColor:'#fff9ed',INK,1.6);line([[x-5,y+1],[x+5,y+1]],1,INK);line([[x-2,y-2],[x+2,y-2]],1.2,a.color)}
 oval(c,0,-32,14.5,14.5,a.color,INK,2.2);c.beginPath();c.arc(-1,-32,11.5,3.7,4.35);c.strokeStyle='#ffffff88';c.lineWidth=1.3;c.stroke();
 const eye=(x,closed)=>{if(closed){c.beginPath();c.moveTo(x-2,-31);c.quadraticCurveTo(x,-34,x+2,-31);c.strokeStyle=INK;c.lineWidth=1.6;c.stroke()}else if(a.eyes==='sleepy')line([[x-2,-31],[x+2,-31]],1.6);else oval(c,x,-31,a.eyes==='dot'?1.4:1.6,a.eyes==='dot'?1.7:2.5,INK)};
 eye(-5,a.eyes==='happy');eye(5,a.eyes==='happy'||a.eyes==='wink');if(a.eyes==='glasses'){oval(c,-5,-31,4.1,4.3,null,INK,1);oval(c,5,-31,4.1,4.3,null,INK,1);line([[-1,-31],[1,-31]],1)}
 if(a.brows!=='none')for(const x of[-5,5]){c.beginPath();c.moveTo(x-2.4,-37);c.quadraticCurveTo(x,-38.7,x+2.4,-37+(a.brows==='up'?-2:0));c.strokeStyle=INK;c.lineWidth=a.brows==='bold'?2:1.1;c.stroke()}
 c.strokeStyle=INK;c.lineWidth=1.4;if(a.mouth==='smile'){c.beginPath();c.arc(0,-26,3.4,.15,Math.PI-.15);c.stroke()}else if(a.mouth==='flat')line([[-3,-24],[3,-24]],1.2);else if(a.mouth==='o')oval(c,0,-24,2,2.6,INK);else if(a.mouth==='grin'){c.beginPath();c.moveTo(-4,-26);c.lineTo(4,-26);c.quadraticCurveTo(3,-19,0,-21);c.quadraticCurveTo(-3,-19,-4,-26);c.fillStyle='#fff9ed';c.fill();c.stroke()}
 if(a.hat==='beret'){oval(c,-2,-44,15,5.5,a.outfitColor,INK,1.8);line([[-2,-49],[-1,-52]],2)}
 else if(a.hat==='beanie'){c.beginPath();c.arc(0,-42,14.5,Math.PI,0);c.fillStyle=a.outfitColor;c.fill();c.strokeStyle=INK;c.lineWidth=1.8;c.stroke();box(c,-15,-44,30,5,1.5,a.outfitColor,INK,1.5);for(const x of[-9,-3,3,9])line([[x,-43],[x,-40]],.8);box(c,3,-44,6,5,1,'#fff9ed',INK,.6)}
 else if(a.hat==='cap'){c.beginPath();c.arc(0,-42,14.5,Math.PI,0);c.fillStyle=a.outfitColor;c.fill();c.strokeStyle=INK;c.lineWidth=1.8;c.stroke();box(c,-2,-43,24,5,2,a.outfitColor,INK,1.7);line([[0,-55],[0,-43]],1);oval(c,0,-56,2,1.5,INK)}
 else if(a.hat==='frog'){box(c,-16,-50,32,10,4,a.outfitColor,INK,1.8);for(const x of[-9,9]){oval(c,x,-51,4.2,4.2,a.outfitColor,INK,1.5);oval(c,x,-52,1.4,1.6,INK)}}
 c.restore();
}
