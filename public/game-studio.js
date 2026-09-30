import {mountStudio} from './studio-core.js';
let csrf='',live=null,refreshTimer=0;
const inFlight=new Map(),uncertainKeys=new Map();
function retainUncertain(signature,key){const expiresAt=Date.now()+120000;uncertainKeys.set(signature,{key,expiresAt});setTimeout(()=>{if(uncertainKeys.get(signature)?.key===key)uncertainKeys.delete(signature)},120000);}
async function request(url,body){
 if(!body){const response=await fetch(url,{method:'GET'}),data=await response.json();if(!response.ok)throw Error(data.error||'요청에 실패했습니다.');if(data.csrf)csrf=data.csrf;return data}
 const signature=`${url}\n${JSON.stringify(body)}`,active=inFlight.get(signature);if(active)return active;const retained=uncertainKeys.get(signature),key=body.requestId?`req:${body.requestId}`:retained?.expiresAt>Date.now()?retained.key:crypto.randomUUID();let task;
 task=(async()=>{let response;try{response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},body:JSON.stringify(body)});}catch(error){retainUncertain(signature,key);throw error;}let data;try{data=await response.json();}catch{retainUncertain(signature,key);throw Error('서버 응답을 읽지 못했습니다.');}uncertainKeys.delete(signature);if(!response.ok)throw Error(data.error||'요청에 실패했습니다.');if(data.csrf)csrf=data.csrf;return data;})().finally(()=>{if(inFlight.get(signature)===task)inFlight.delete(signature)});inFlight.set(signature,task);return task;
}
const studio=mountStudio(document.getElementById('dd-play'),{snapshot:()=>request('/api/snapshot'),draw:async body=>{try{return await request('/api/operations/draw',body)}catch(e){if(e instanceof TypeError)return request('/api/operations/draw',body);throw e}}});
function queueRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>studio.refresh(),120)}
function connectLive(){if(!('EventSource' in window))return;live?.close();live=new EventSource('/api/events');live.addEventListener('snapshot',queueRefresh);live.addEventListener('error',()=>{});}
window.addEventListener('focus',()=>studio.refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden){studio.refresh();if(!live||live.readyState===2)connectLive()}});window.addEventListener('pagehide',()=>live?.close());connectLive();
