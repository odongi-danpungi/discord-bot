export const AVATAR_OPTIONS={eyes:['dot','oval','happy','sleepy'],mouth:['none','smile','o','flat'],brows:['none','soft','bold','up'],clothes:['none','vest','hoodie','jacket'],hat:['none','beret','beanie','cap','frog'],shoes:['plain','sneakers','boots'],gloves:['none','mittens','sport']};
export const DEFAULT_AVATAR={color:'#f7edcf',outfitColor:'#84986c',eyes:'dot',mouth:'smile',brows:'soft',clothes:'vest',hat:'beret',shoes:'sneakers',gloves:'mittens'};
export function validateAvatar(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('캐릭터 설정을 확인해 주세요.');const out={};for(const field of ['color','outfitColor']){if(typeof input[field]!=='string'||!/^#[0-9a-f]{6}$/i.test(input[field]))throw Error('색상은 올바른 HEX 값이어야 합니다.');out[field]=input[field]}for(const [key,values] of Object.entries(AVATAR_OPTIONS)){if(!values.includes(input[key]))throw Error('지원하지 않는 꾸미기 항목입니다: '+key);out[key]=input[key]}return out}
export function drawAvatar(ctx,avatar,pose={stride:0,sway:0,leftElbow:[-12,2],leftHand:[-18,8],rightElbow:[13,-5],rightHand:[23,-5]}){
 const a={...DEFAULT_AVATAR,...avatar},ink='#584335',step=pose.stride;
 const line=(points,width=3,color=ink)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke()};
 const oval=(x,y,rx,ry,fill)=>{ctx.fillStyle=fill;ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();ctx.stroke()};
 ctx.lineCap='round';ctx.lineJoin='round';
 line([[0,-13],[0,10]],4);line([[0,-7],pose.leftElbow,pose.leftHand],3);line([[0,-7],pose.rightElbow,pose.rightHand],3);
 line([[0,10],[-7-step*.4,23],[-10-step,34]],4);line([[0,10],[7+step*.4,23],[10+step,34]],4);
 if(a.clothes!=='none'){ctx.fillStyle=a.outfitColor;ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-9,-14);ctx.lineTo(9,-14);ctx.lineTo(12,10);ctx.lineTo(-12,10);ctx.closePath();ctx.fill();ctx.stroke();line([[0,-12],[0,9]],1);if(a.clothes==='vest'){line([[-9,-5],[9,-5]],3,'#f9f3df');line([[-10,3],[10,3]],3,'#f9f3df')}if(a.clothes==='hoodie'){line([[-5,-11],[-3,-3]],1,'#fff');line([[5,-11],[3,-3]],1,'#fff')}if(a.clothes==='jacket'){line([[-8,3],[-3,3]],2);line([[3,3],[8,3]],2)}}
 for(const [x,y] of [pose.leftHand,pose.rightHand]){oval(x,y,4,5,a.gloves==='none'?a.color:a.outfitColor);if(a.gloves==='sport')line([[x-3,y+2],[x+3,y+2]],2,'#fff')}
 for(const x of [-10-step,10+step]){if(a.shoes==='boots'){ctx.fillStyle=a.outfitColor;ctx.fillRect(x-4,27,8,8)}oval(x,35,7,3,a.shoes==='plain'?a.color:'#f8f2de');if(a.shoes==='sneakers')line([[x-4,34],[x+3,34]],1,a.outfitColor)}
 oval(0,-29,15,18,a.color);
 ctx.fillStyle=ink;
 for(const x of [-5,5]){if(a.eyes==='happy'){ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,-28,3,Math.PI,Math.PI*2);ctx.stroke()}else if(a.eyes==='sleepy')line([[x-2,-27],[x+2,-27]],2);else{ctx.beginPath();ctx.ellipse(x,-28,a.eyes==='oval'?2:1.5,a.eyes==='oval'?3.5:2,0,0,Math.PI*2);ctx.fill()}}
 if(a.brows!=='none')for(const x of [-5,5])line([[x-3,-35],[x+3,-35+(a.brows==='up'?-2:a.brows==='soft'?1:0)]],a.brows==='bold'?2:1);
 if(a.mouth==='smile'){ctx.beginPath();ctx.arc(0,-24,3,0,Math.PI);ctx.stroke()}else if(a.mouth==='flat')line([[-3,-21],[3,-21]],1);else if(a.mouth==='o')oval(0,-22,2,2,ink);
 if(a.hat!=='none'){ctx.fillStyle=a.outfitColor;ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.beginPath();if(a.hat==='beret'){ctx.ellipse(-2,-44,16,6,-.2,0,Math.PI*2)}else if(a.hat==='beanie'){ctx.arc(0,-40,16,Math.PI,0);ctx.lineTo(-16,-40)}else{ctx.moveTo(-18,-40);ctx.lineTo(-12,-52);ctx.lineTo(12,-52);ctx.lineTo(18,-40);ctx.closePath()}ctx.fill();ctx.stroke();if(a.hat==='frog'){oval(-9,-51,4,4,a.outfitColor);oval(9,-51,4,4,a.outfitColor)}if(a.hat==='cap')line([[-18,-40],[24,-40]],3,a.outfitColor)}
}
