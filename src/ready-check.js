import {randomUUID,createHash} from 'node:crypto';
const active=q=>(q?.entries||[]).filter(e=>['waiting','joined','called'].includes(e.status));
const fingerprint=q=>createHash('sha256').update(JSON.stringify(active(q).map(e=>[e.id,e.status,e.sessionId]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
const fail=(message,status=409)=>Object.assign(Error(message),{status,statusCode:status});
export function readyCheckView({operationsState,queue,userId=null,now=Date.now()}){
 const value=operationsState.readyCheck;if(!value)return {check:null};
 if(typeof value.id!=='string'||!Number.isFinite(value.expiresAt)||!Array.isArray(value.participants)||value.participants.length>200||value.participants.some(p=>!p||typeof p.id!=='string'||typeof p.displayName!=='string'))return {check:null,invalid:true};
 const stale=value.sessionId!==(operationsState.session?.id||null)||value.fingerprint!==fingerprint(queue),expired=value.expiresAt<=now;
 const participants=userId?value.participants.filter(p=>p.discordUserId===userId):value.participants;
 return {check:{id:value.id,createdAt:value.createdAt,expiresAt:value.expiresAt,stale,expired,closed:Boolean(value.closedAt),participants:participants.map(p=>({id:p.id,displayName:p.displayName,source:p.source,readyAt:p.readyAt||0,manual:Boolean(p.manual)})),readyCount:userId?participants.filter(p=>p.readyAt).length:value.participants.filter(p=>p.readyAt).length,total:userId?participants.length:value.participants.length}};
}
export async function startReadyCheck({operations,queue,now=Date.now()}){
 const participants=active(queue).slice(0,200);if(!participants.length)throw fail('먼저 참가자를 Queue에 등록해 주세요.',400);if(active(queue).length>200)throw fail('준비 확인은 최대 200명까지 가능합니다.',400);
 return operations.update(state=>{state.readyCheck={id:randomUUID(),createdAt:now,expiresAt:now+600000,sessionId:state.session?.id||null,fingerprint:fingerprint(queue),participants:participants.map(p=>({id:p.id,displayName:p.displayName,source:p.source,discordUserId:p.source==='discord'?p.discordUserId:null,readyAt:0,manual:false}))};state.revision=(state.revision||0)+1;});
}
export async function answerReadyCheck({operations,queue,checkId,userId=null,entryId=null,manual=false,now=Date.now()}){
 return operations.update(state=>{const view=readyCheckView({operationsState:state,queue,now}).check;if(!view||view.id!==checkId||view.stale||view.expired||view.closed)throw fail('준비 확인이 종료되거나 참가자 구성이 변경됐습니다.');const p=state.readyCheck.participants.find(p=>manual?p.id===entryId:p.discordUserId&&p.discordUserId===userId);if(!p)throw fail('본인 참가 상태만 확인할 수 있습니다.',403);if(!p.readyAt){p.readyAt=now;p.manual=manual;state.revision=(state.revision||0)+1;}});
}
