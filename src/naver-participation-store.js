import { randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';

const initialState=()=>({
  version:1,
  revision:0,
  publication:null,
  session:null,
  entries:[],
  history:[]
});

function isText(value,max){return typeof value==='string'&&value.length<=max;}
function validPublication(value){
  if(value===null)return true;
  return value&&typeof value==='object'&&isText(value.id,80)&&['pending','failed','uncertain'].includes(value.status)&&isText(value.cafeId,32)&&isText(value.menuId,32)&&Number.isFinite(Number(value.startedAt))&&(!value.error||isText(value.error,500));
}
function validSession(value){
  if(value===null)return true;
  return value&&typeof value==='object'&&isText(value.id,80)&&['open','closed'].includes(value.status)&&isText(value.cafeId,32)&&isText(value.menuId,32)&&isText(value.subject,200)&&Number.isFinite(Number(value.openedAt))&&(!value.closedAt||Number.isFinite(Number(value.closedAt)))&&(!value.articleId||isText(String(value.articleId),64))&&(!value.articleUrl||isText(value.articleUrl,1000));
}
function validEntry(entry){
  return entry&&typeof entry==='object'&&isText(entry.id,80)&&Number.isInteger(entry.order)&&entry.order>0&&isText(entry.displayName,80)&&entry.displayName.trim()&&['queued','cancelled'].includes(entry.status)&&Number.isFinite(Number(entry.registeredAt))&&(!entry.cancelledAt||Number.isFinite(Number(entry.cancelledAt)));
}
function validHistory(item){return item&&typeof item==='object'&&validSession(item.session)&&Array.isArray(item.entries)&&item.entries.every(validEntry)&&Number.isFinite(Number(item.archivedAt));}
function validate(value){
  return value&&typeof value==='object'&&value.version===1&&Number.isInteger(value.revision)&&value.revision>=0&&validPublication(value.publication)&&validSession(value.session)&&Array.isArray(value.entries)&&value.entries.every(validEntry)&&Array.isArray(value.history)&&value.history.length<=20&&value.history.every(validHistory);
}
function cleanName(value){
  const name=String(value??'').trim().replace(/\s+/g,' ');
  if(!name)throw Object.assign(new Error('신청자 이름을 입력해 주세요.'),{status:400});
  if(name.length>80)throw Object.assign(new Error('신청자 이름은 80자 이하로 입력해 주세요.'),{status:400});
  return name;
}
function archiveCurrent(state,reason='closed'){
  if(!state.session)return;
  state.history.unshift({session:{...state.session,closeReason:reason},entries:state.entries.map(entry=>({...entry})),archivedAt:Date.now()});
  state.history=state.history.slice(0,20);
}

export class NaverParticipationStore extends JsonStore {
  constructor(file){super(file,initialState(),validate);}
  summary(){
    const state=this.read(),queued=state.entries.filter(entry=>entry.status==='queued');
    return {...state,counts:{queued:queued.length,cancelled:state.entries.length-queued.length},nextOrder:state.entries.reduce((max,entry)=>Math.max(max,entry.order),0)+1,registrationOpen:state.session?.status==='open',commentAutomationSupported:false,commentManualText:'칼바람 시참'};
  }
  async recoverPending(){
    let recovered=0;
    await this.update(state=>{
      if(state.publication?.status==='pending'){
        state.publication={...state.publication,status:'uncertain',error:'이전 실행이 게시 결과를 확정하기 전에 종료되었습니다. 네이버 카페에서 글 작성 여부를 확인한 뒤 초기화해 주세요.'};
        state.revision++;recovered=1;
      }
    });
    return recovered;
  }
  async beginPublication({cafeId,menuId}){
    cafeId=String(cafeId??'').trim();menuId=String(menuId??'').trim();
    if(!/^\d+$/.test(cafeId)||!/^\d+$/.test(menuId))throw Object.assign(new Error('카페 ID와 메모 게시판 ID를 확인해 주세요.'),{status:400});
    let publication;
    await this.update(state=>{
      if(state.session)throw Object.assign(new Error('이미 진행 중인 칼바람 시참 메모가 있습니다. 먼저 현재 순번을 마감/초기화해 주세요.'),{status:409});
      if(state.publication&&['pending','uncertain'].includes(state.publication.status))throw Object.assign(new Error('이전 메모 게시 결과가 미확정 상태입니다. 네이버 카페에서 확인한 뒤 초기화해 주세요.'),{status:409});
      publication={id:randomUUID(),status:'pending',cafeId,menuId,startedAt:Date.now(),error:''};
      state.publication=publication;state.revision++;
    });
    return publication;
  }
  async failPublication(id,{uncertain=false,error=''}={}){
    await this.update(state=>{
      if(state.publication?.id!==id)return;
      state.publication={...state.publication,status:uncertain?'uncertain':'failed',error:String(error||'게시 요청에 실패했습니다.').slice(0,500)};state.revision++;
    });
    return this.summary();
  }
  async completePublication(id,{articleId=null,articleUrl='',subject='칼바람 시참'}){
    await this.update(state=>{
      const pending=state.publication;
      if(!pending||pending.id!==id||pending.status!=='pending')throw Object.assign(new Error('메모 게시 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.'),{status:409});
      state.session={id:randomUUID(),status:'open',cafeId:pending.cafeId,menuId:pending.menuId,articleId:articleId==null?null:String(articleId),articleUrl:String(articleUrl||'').slice(0,1000),subject:String(subject||'칼바람 시참').slice(0,200),openedAt:Date.now()};
      state.publication=null;state.entries=[];state.revision++;
    });
    return this.summary();
  }
  async register({displayName}){
    displayName=cleanName(displayName);let created;
    await this.update(state=>{
      if(!state.session)throw Object.assign(new Error('먼저 칼바람 시참 열기 버튼으로 접수를 시작해 주세요.'),{status:409});
      if(state.session.status!=='open')throw Object.assign(new Error('현재 칼바람 시참 접수는 마감되었습니다. 초기화 후 새 접수를 시작해 주세요.'),{status:409});
      const duplicate=state.entries.find(entry=>entry.status==='queued'&&entry.displayName.toLocaleLowerCase('ko-KR')===displayName.toLocaleLowerCase('ko-KR'));
      if(duplicate)throw Object.assign(new Error(`${displayName}님은 이미 ${duplicate.order}번으로 등록되어 있습니다.`),{status:409});
      const order=state.entries.reduce((max,entry)=>Math.max(max,entry.order),0)+1;
      created={id:randomUUID(),order,displayName,status:'queued',registeredAt:Date.now()};
      state.entries.push(created);state.revision++;
    });
    return created;
  }
  async cancel(id){
    id=String(id||'').trim();let changed=false;
    await this.update(state=>{
      if(!state.session)throw Object.assign(new Error('진행 중인 칼바람 시참 접수가 없습니다.'),{status:409});
      if(state.session.status!=='open')throw Object.assign(new Error('마감된 접수는 변경할 수 없습니다. 초기화 후 새 접수를 시작해 주세요.'),{status:409});
      const entry=state.entries.find(item=>item.id===id);
      if(!entry)throw Object.assign(new Error('해당 순번을 찾지 못했습니다.'),{status:404});
      if(entry.status==='queued'){entry.status='cancelled';entry.cancelledAt=Date.now();state.revision++;changed=true;}
    });
    return {changed,summary:this.summary()};
  }
  async close(reason='manual'){
    await this.update(state=>{
      if(!state.session)throw Object.assign(new Error('진행 중인 칼바람 시참 접수가 없습니다.'),{status:409});
      if(state.session.status==='closed')return;
      state.session={...state.session,status:'closed',closedAt:Date.now(),closeReason:String(reason||'manual').slice(0,80)};
      state.revision++;
    });
    return this.summary();
  }
  async reset(reason='manual'){
    await this.update(state=>{
      archiveCurrent(state,String(reason||'manual').slice(0,80));
      state.publication=null;state.session=null;state.entries=[];state.revision++;
    });
    return this.summary();
  }
}

export const __test={validate,cleanName};
