import { createHash, randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';

export const PARTICIPATION_QUEUE_STATUSES=['waiting','called','joined','postponed_next','postponed_next2','cancelled','no_show'];
export const PARTICIPATION_QUEUE_SOURCES=['discord','naver','dashboard'];
const ACTIVE_STATUSES=new Set(['waiting','called','joined','postponed_next','postponed_next2']);

function initialState(){return {version:1,revision:0,nextSequence:1,entries:[],history:[]};}
function isText(value,max){return typeof value==='string'&&value.length<=max;}
function validCallMessage(value){return !value||(value&&typeof value==='object'&&isText(value.channelId,80)&&value.channelId&&isText(value.id,80)&&value.id);}
function validEntry(entry){
  const callFieldsOk=(!entry.callToken||isText(entry.callToken,64))&&(!entry.callReason||isText(entry.callReason,80))&&(!entry.calledAt||Number.isFinite(Number(entry.calledAt)))&&(!entry.callDeadline||Number.isFinite(Number(entry.callDeadline)))&&(!entry.callAttempt||Number.isInteger(entry.callAttempt)&&entry.callAttempt>=0)&&validCallMessage(entry.callMessage);
  return entry&&typeof entry==='object'&&isText(entry.id,80)&&Number.isInteger(entry.sequence)&&entry.sequence>0&&Number.isInteger(entry.position)&&entry.position>0&&PARTICIPATION_QUEUE_SOURCES.includes(entry.source)&&PARTICIPATION_QUEUE_STATUSES.includes(entry.status)&&isText(entry.identityKey,180)&&isText(entry.displayName,80)&&entry.displayName.trim()&&(!entry.discordUserId||isText(entry.discordUserId,80))&&(!entry.naverKey||/^[a-f0-9]{64}$/.test(entry.naverKey))&&(!entry.sessionId||isText(entry.sessionId,80))&&(!entry.game||['lol','er'].includes(entry.game))&&(!entry.mode||['aram','rift'].includes(entry.mode))&&(!entry.round||Number.isInteger(entry.round))&&Number.isFinite(Number(entry.createdAt))&&Number.isFinite(Number(entry.updatedAt))&&callFieldsOk;
}
function validUndo(value){return !value||(typeof value.id==='string'&&Number.isInteger(value.revision)&&Number.isFinite(value.expiresAt)&&Array.isArray(value.before)&&value.before.length<=10000&&value.before.every(p=>typeof p.id==='string'&&Number.isInteger(p.position)&&p.position>0)&&new Set(value.before.map(p=>p.id)).size===value.before.length);}
function validate(value){return value&&typeof value==='object'&&value.version===1&&Number.isInteger(value.revision)&&value.revision>=0&&Number.isInteger(value.nextSequence)&&value.nextSequence>=1&&Array.isArray(value.entries)&&value.entries.every(validEntry)&&Array.isArray(value.history)&&value.history.length<=300&&validUndo(value.orderUndo);}
function normalizeName(value){const name=String(value??'').trim().replace(/\s+/g,' ');if(!name)throw Object.assign(new Error('참가자 이름을 입력해 주세요.'),{status:400});if(name.length>80)throw Object.assign(new Error('참가자 이름은 80자 이하로 입력해 주세요.'),{status:400});return name;}
function hashName(value){return createHash('sha256').update(normalizeName(value).normalize('NFKC').toLocaleLowerCase('ko-KR')).digest('hex');}
function identityFor({source,displayName,discordUserId,identityKey}){
  if(identityKey)return String(identityKey).slice(0,180);
  if(source==='discord'){const id=String(discordUserId||'').trim();if(!id)throw Object.assign(new Error('Discord 사용자 ID가 필요합니다.'),{status:400});return `discord:${id}`;}
  const digest=hashName(displayName);return `${source}:${digest}`;
}
function activeEntries(state){return state.entries.filter(entry=>ACTIVE_STATUSES.has(entry.status)).sort((a,b)=>a.position-b.position||a.sequence-b.sequence);}
function resequencePositions(state){activeEntries(state).forEach((entry,index)=>{entry.position=index+1;});}
function clearCall(entry){entry.callToken='';entry.callReason='';entry.calledAt=0;entry.callDeadline=0;entry.callMessage=null;}
function publicEntry(entry){const {callToken,...safe}=entry;return structuredClone(safe);}
function note(state,action,entry,details={}){state.history.unshift({id:randomUUID(),at:Date.now(),action,entryId:entry?.id||null,source:entry?.source||null,status:entry?.status||null,displayName:entry?.displayName||'',details});state.history=state.history.slice(0,300);}

export class ParticipationQueueStore extends JsonStore {
  constructor(file){super(file,initialState(),validate);}
  summary(){
    const state=this.read(),ordered=[...state.entries].sort((a,b)=>{const aa=ACTIVE_STATUSES.has(a.status)?0:1,bb=ACTIVE_STATUSES.has(b.status)?0:1;return aa-bb||a.position-b.position||a.sequence-b.sequence;}),entries=ordered.map(publicEntry);
    const counts=Object.fromEntries(PARTICIPATION_QUEUE_STATUSES.map(status=>[status,entries.filter(entry=>entry.status===status).length])),currentCall=entries.find(entry=>entry.status==='called')||null;
    return {...state,entries,counts,activeCount:entries.filter(entry=>ACTIVE_STATUSES.has(entry.status)).length,currentCall};
  }
  async register({source='dashboard',displayName,discordUserId='',sessionId=null,game=null,mode=null,round=null,status='waiting',identityKey=''}){
    if(!PARTICIPATION_QUEUE_SOURCES.includes(source))throw Object.assign(new Error('참가 경로를 확인해 주세요.'),{status:400});
    if(!PARTICIPATION_QUEUE_STATUSES.includes(status))throw Object.assign(new Error('참가 상태를 확인해 주세요.'),{status:400});
    displayName=normalizeName(displayName);const identity=identityFor({source,displayName,discordUserId,identityKey});let result;
    await this.update(state=>{
      const same=state.entries.find(entry=>entry.identityKey===identity&&ACTIVE_STATUSES.has(entry.status));
      if(same){
        same.displayName=displayName;same.discordUserId=String(discordUserId||same.discordUserId||'').slice(0,80);same.sessionId=sessionId?String(sessionId).slice(0,80):same.sessionId;same.game=game||same.game;same.mode=mode||same.mode;same.round=Number.isInteger(round)?round:same.round;same.updatedAt=Date.now();
        result={entry:{...same},duplicate:true};return;
      }
      const sequence=state.nextSequence++,position=activeEntries(state).length+1,now=Date.now();
      const entry={id:randomUUID(),sequence,position,source,status,identityKey:identity,displayName,discordUserId:String(discordUserId||'').slice(0,80),naverKey:source==='naver'?hashName(displayName):'',sessionId:sessionId?String(sessionId).slice(0,80):null,game:game||null,mode:mode||null,round:Number.isInteger(round)?round:null,createdAt:now,updatedAt:now};
      state.entries.push(entry);state.revision++;note(state,'register',entry);result={entry:{...entry},duplicate:false};
    });
    return result;
  }
  async setStatus(id,status,{reason='manual'}={}){
    if(!PARTICIPATION_QUEUE_STATUSES.includes(status))throw Object.assign(new Error('참가 상태를 확인해 주세요.'),{status:400});let result;
    await this.update(state=>{
      const entry=state.entries.find(item=>item.id===id);if(!entry)throw Object.assign(new Error('참가자를 찾지 못했습니다.'),{status:404});
      if(entry.status===status){result={entry:publicEntry(entry),changed:false};return;}
      const messageRef=entry.callMessage?{...entry.callMessage}:null;entry.status=status;entry.updatedAt=Date.now();if(status!=='called')clearCall(entry);if(ACTIVE_STATUSES.has(status)){entry.position=activeEntries(state).filter(item=>item.id!==entry.id).length+1;}
      resequencePositions(state);state.revision++;note(state,'status',entry,{reason:String(reason||'manual').slice(0,80)});result={entry:publicEntry(entry),changed:true,messageRef};
    });return result;
  }
  async beginCall(id,{token,timeoutSeconds=60,reason='manual',recall=false}={}){
    const timeout=Math.max(15,Math.min(300,Number(timeoutSeconds)||60)),safeToken=String(token||'').trim();if(!safeToken||safeToken.length>64)throw Object.assign(new Error('호출 토큰을 확인해 주세요.'),{status:400});let result;
    await this.update(state=>{
      const entry=state.entries.find(item=>item.id===id);if(!entry)throw Object.assign(new Error('참가자를 찾지 못했습니다.'),{status:404});
      const other=state.entries.find(item=>item.status==='called'&&item.id!==id);if(other)throw Object.assign(new Error(`${other.displayName}님의 응답을 먼저 처리해 주세요.`),{status:409});
      if(!['waiting','called'].includes(entry.status))throw Object.assign(new Error('대기 중인 참가자만 호출할 수 있습니다.'),{status:409});
      if(entry.status==='called'&&!recall)throw Object.assign(new Error('이미 호출 중인 참가자입니다.'),{status:409});
      const previousMessage=entry.callMessage?{...entry.callMessage}:null,now=Date.now();entry.status='called';entry.callToken=safeToken;entry.callReason=String(reason||'manual').slice(0,80);entry.calledAt=now;entry.callDeadline=now+timeout*1000;entry.callAttempt=(Number(entry.callAttempt)||0)+1;entry.updatedAt=now;state.revision++;note(state,recall?'recall':'call',entry,{timeoutSeconds:timeout,attempt:entry.callAttempt});result={entry:publicEntry(entry),previousMessage};
    });return result;
  }
  async attachCallMessage(id,{token,messageRef}={}){let result;
    await this.update(state=>{const entry=state.entries.find(item=>item.id===id);if(!entry)throw Object.assign(new Error('참가자를 찾지 못했습니다.'),{status:404});if(entry.status!=='called'||entry.callToken!==String(token||''))throw Object.assign(new Error('호출 상태가 변경되어 메시지를 연결할 수 없습니다.'),{status:409});if(!messageRef?.channelId||!messageRef?.id)throw Object.assign(new Error('Discord 호출 메시지 정보를 확인해 주세요.'),{status:400});entry.callMessage={channelId:String(messageRef.channelId).slice(0,80),id:String(messageRef.id).slice(0,80)};entry.updatedAt=Date.now();state.revision++;result={entry:publicEntry(entry)};});return result;
  }
  async extendCallDeadline(id,{token='',deltaMs=0,reason='pause'}={}){let result;const delta=Math.max(0,Math.min(7*24*60*60*1000,Number(deltaMs)||0));
    await this.update(state=>{const entry=state.entries.find(item=>item.id===id);if(!entry||entry.status!=='called'){result={entry:entry?publicEntry(entry):null,changed:false};return;}if(token&&entry.callToken!==String(token))throw Object.assign(new Error('호출 상태가 이미 변경됐습니다.'),{status:409});if(!delta){result={entry:publicEntry(entry),changed:false};return;}entry.callDeadline=(Number(entry.callDeadline)||Date.now())+delta;entry.updatedAt=Date.now();state.revision++;note(state,'call_deadline_extend',entry,{reason:String(reason||'pause').slice(0,80),deltaMs:delta});result={entry:publicEntry(entry),changed:true};});return result;
  }
  async cancelCall(id,{token='',reason='manual'}={}){let result;
    await this.update(state=>{const entry=state.entries.find(item=>item.id===id);if(!entry)throw Object.assign(new Error('참가자를 찾지 못했습니다.'),{status:404});if(entry.status!=='called'){result={entry:publicEntry(entry),changed:false,messageRef:null};return;}if(token&&entry.callToken!==String(token))throw Object.assign(new Error('호출 상태가 이미 변경됐습니다.'),{status:409});const messageRef=entry.callMessage?{...entry.callMessage}:null;entry.status='waiting';entry.updatedAt=Date.now();clearCall(entry);resequencePositions(state);state.revision++;note(state,'call_cancel',entry,{reason:String(reason||'manual').slice(0,80)});result={entry:publicEntry(entry),changed:true,messageRef};});return result;
  }
  async respondCall(id,{token,userId,action,now=Date.now()}={}){if(!['join','pass'].includes(action))throw Object.assign(new Error('지원하지 않는 호출 응답입니다.'),{status:400});let result;
    await this.update(state=>{const entry=state.entries.find(item=>item.id===id);if(!entry)throw Object.assign(new Error('참가자를 찾지 못했습니다.'),{status:404});if(entry.status!=='called'||entry.callToken!==String(token||''))throw Object.assign(new Error('이 호출은 이미 종료되었거나 갱신되었습니다.'),{status:409});if(!entry.discordUserId||entry.discordUserId!==String(userId||''))throw Object.assign(new Error('호출된 참가자만 응답할 수 있습니다.'),{status:403});if(Number(entry.callDeadline)&&Number(entry.callDeadline)<Number(now))throw Object.assign(new Error('응답 시간이 만료됐습니다.'),{status:409});const messageRef=entry.callMessage?{...entry.callMessage}:null;entry.status=action==='join'?'joined':'postponed_next';entry.updatedAt=Number(now)||Date.now();clearCall(entry);resequencePositions(state);state.revision++;note(state,action==='join'?'call_join':'call_pass',entry);result={entry:publicEntry(entry),changed:true,messageRef};});return result;
  }
  async expireCall(id,{token,now=Date.now(),reason='timeout'}={}){let result;
    await this.update(state=>{const entry=state.entries.find(item=>item.id===id);if(!entry||entry.status!=='called'||(token&&entry.callToken!==String(token))){result={entry:entry?publicEntry(entry):null,changed:false,messageRef:null};return;}if(Number(entry.callDeadline)>Number(now)){result={entry:publicEntry(entry),changed:false,messageRef:entry.callMessage?{...entry.callMessage}:null};return;}const messageRef=entry.callMessage?{...entry.callMessage}:null;entry.status='no_show';entry.updatedAt=Number(now)||Date.now();clearCall(entry);resequencePositions(state);state.revision++;note(state,'call_timeout',entry,{reason:String(reason||'timeout').slice(0,80)});result={entry:publicEntry(entry),changed:true,messageRef};});return result;
  }
  async reorder(id,targetPosition){targetPosition=Number(targetPosition);if(!Number.isInteger(targetPosition)||targetPosition<1)throw Object.assign(new Error('이동할 순서를 확인해 주세요.'),{status:400});let result;
    await this.update(state=>{
      const list=activeEntries(state),index=list.findIndex(entry=>entry.id===id);if(index<0)throw Object.assign(new Error('현재 대기열의 참가자를 찾지 못했습니다.'),{status:404});
      const before=list.map(item=>({id:item.id,position:item.position}));
      const [entry]=list.splice(index,1),next=Math.min(targetPosition,list.length+1)-1;list.splice(next,0,entry);list.forEach((item,i)=>{item.position=i+1;item.updatedAt=Date.now();});state.revision++;note(state,'reorder',entry,{targetPosition:next+1});
      state.orderUndo=index!==next?{id:randomUUID(),revision:state.revision,expiresAt:Date.now()+300000,before}:null;
      result={entry:{...entry},changed:index!==next};
    });return result;
  }
  orderUndoPreview(){const state=this.read(),undo=state.orderUndo;if(!undo||undo.expiresAt<=Date.now()||undo.revision!==state.revision)return {available:false};return {available:true,id:undo.id,revision:state.revision,expiresAt:undo.expiresAt,changes:undo.before.map(item=>{const entry=state.entries.find(e=>e.id===item.id);return {displayName:entry?.displayName||'',currentPosition:entry?.position,restorePosition:item.position};})};}
  async undoOrder({id,revision}={}){return this.update(state=>{const undo=state.orderUndo;if(!undo||undo.id!==id||undo.expiresAt<=Date.now()||state.revision!==revision||undo.revision!==state.revision)throw Object.assign(Error('Queue가 변경되었거나 되돌리기 시간이 만료됐습니다.'),{status:409});for(const item of undo.before){const entry=state.entries.find(e=>e.id===item.id);if(!entry)throw Object.assign(Error('Queue가 변경됐습니다.'),{status:409});entry.position=item.position;entry.updatedAt=Date.now();}state.orderUndo=null;state.revision++;note(state,'reorder_undo',null);return {ok:true};});}
  async cancelSource(source,reason='manual'){
    if(!PARTICIPATION_QUEUE_SOURCES.includes(source))throw Object.assign(new Error('참가 경로를 확인해 주세요.'),{status:400});let changed=0;
    await this.update(state=>{for(const entry of state.entries){if(entry.source!==source||!ACTIVE_STATUSES.has(entry.status))continue;entry.status='cancelled';entry.updatedAt=Date.now();note(state,'source_cancel',entry,{reason:String(reason||'manual').slice(0,80)});changed++;}if(changed){resequencePositions(state);state.revision++;}});return {changed,summary:this.summary()};
  }
  async syncOperations({operationsState,records=[]}={}){
    const state=operationsState||{},session=state.session,recordMap=new Map(records.map(record=>[record.discordId,record]));
    await this.update(queue=>{
      let changed=false;const now=Date.now();
      const desired=new Map();
      if(session&&session.phase!=='ended'){
        for(const userId of session.applicants||[]){
          const reservation=(state.reservations||[]).find(r=>r.game===session.game&&r.userId===userId);let status='waiting';
          if((session.confirmed||[]).includes(userId))status='joined';else if((session.postponed||[]).includes(userId)){status=reservation&&reservation.round>=session.round+2?'postponed_next2':'postponed_next';}
          const record=recordMap.get(userId),displayName=record?.chzzkName||record?.discordUsername||String(userId);desired.set(`discord:${userId}`,{displayName,userId,status,sessionId:session.id,game:session.game,mode:session.mode,round:session.round});
        }
      }
      for(const reservation of state.reservations||[]){
        const identity=`discord:${reservation.userId}`;if(desired.has(identity))continue;const record=recordMap.get(reservation.userId),displayName=record?.chzzkName||record?.discordUsername||String(reservation.userId);const baseRound=session?.game===reservation.game?session.round:Math.max(0,reservation.round-1),status=reservation.round>=baseRound+2?'postponed_next2':'postponed_next';desired.set(identity,{displayName,userId:reservation.userId,status,sessionId:session?.id||null,game:reservation.game,mode:session?.mode||null,round:reservation.round});
      }
      for(const [identity,item] of desired){
        const terminal=queue.entries.find(row=>row.identityKey===identity&&row.sessionId===item.sessionId&&['cancelled','no_show'].includes(row.status));
        if(terminal)continue;
        let entry=queue.entries.find(row=>row.identityKey===identity&&ACTIVE_STATUSES.has(row.status));
        if(!entry){const sequence=queue.nextSequence++;entry={id:randomUUID(),sequence,position:activeEntries(queue).length+1,source:'discord',status:item.status,identityKey:identity,displayName:normalizeName(item.displayName),discordUserId:String(item.userId),naverKey:'',sessionId:item.sessionId,game:item.game,mode:item.mode||null,round:Number.isInteger(item.round)?item.round:null,createdAt:now,updatedAt:now};queue.entries.push(entry);note(queue,'compat_add',entry);changed=true;}
        else{
          const before=JSON.stringify([entry.status,entry.displayName,entry.sessionId,entry.game,entry.mode,entry.round]);
          if(item.status!=='waiting'||!['called','joined'].includes(entry.status)){if(entry.status==='called'&&item.status!=='called')clearCall(entry);entry.status=item.status;}
          entry.displayName=normalizeName(item.displayName);entry.sessionId=item.sessionId;entry.game=item.game;entry.mode=item.mode||null;entry.round=Number.isInteger(item.round)?item.round:null;entry.updatedAt=now;if(JSON.stringify([entry.status,entry.displayName,entry.sessionId,entry.game,entry.mode,entry.round])!==before)changed=true;
        }
      }
      for(const entry of queue.entries){
        if(entry.source!=='discord'||!ACTIVE_STATUSES.has(entry.status))continue;if(desired.has(entry.identityKey))continue;
        if(entry.sessionId&&session?.id===entry.sessionId){if(entry.status==='called')clearCall(entry);entry.status='cancelled';entry.updatedAt=now;note(queue,'compat_cancel',entry);changed=true;}
      }
      resequencePositions(queue);if(changed)queue.revision++;
    });
    return this.summary();
  }
  async syncNaver(summary){
    const source=summary||{};for(const item of source.entries||[]){
      const identity=`naver:${hashName(item.displayName)}`;const result=await this.register({source:'naver',displayName:item.displayName,identityKey:identity,status:item.status==='cancelled'?'cancelled':'waiting'});
      if(item.status==='cancelled'&&result.entry.status!=='cancelled')await this.setStatus(result.entry.id,'cancelled',{reason:'naver-sync'});
    }
    return this.summary();
  }
}

export const __test={validate,normalizeName,hashName,identityFor,ACTIVE_STATUSES};
