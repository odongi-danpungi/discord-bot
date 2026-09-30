import { randomUUID } from 'node:crypto';

const AUTO_ADVANCE_STATUSES=new Set(['no_show','postponed_next','postponed_next2','cancelled']);

function httpError(message,status=400,code='participation_call_error'){
  return Object.assign(new Error(message),{status,code});
}

function safeReason(value){return String(value||'manual').trim().slice(0,80)||'manual';}

export class ParticipationCallService {
  constructor({queue,discord,timeoutSeconds=60,audit=null,reporter=null,paused=false,pausedAt=0}={}){
    if(!queue)throw Error('ParticipationCallService requires a queue store.');
    if(!discord)throw Error('ParticipationCallService requires a Discord service.');
    this.queueStore=queue;
    this.discord=discord;
    this.timeoutSeconds=Math.max(15,Math.min(300,Number(timeoutSeconds)||60));
    this.audit=typeof audit==='function'?audit:null;
    this.reporter=typeof reporter==='function'?reporter:null;
    this.chain=Promise.resolve();
    this.timer=null;
    this.closed=false;
    this.paused=Boolean(paused);this.pausedAt=this.paused?Math.max(0,Number(pausedAt)||Date.now()):0;this.pauseReason=this.paused?'emergency-lock':'';
  }
  serial(fn){const task=this.chain.catch(()=>{}).then(fn);this.chain=task;return task;}
  report(event){try{this.reporter?.(event)}catch{}}
  async record(action,entry,details={}){try{await this.audit?.({category:'operation',action,summary:`시참 호출 · ${entry?.displayName||'참가자'}`,details:{entryId:entry?.id||null,source:entry?.source||null,...details}})}catch{}}
  async autoAdvance(reason,entry=null){
    try{const next=await this.callNextUnlocked({reason,allowEmpty:true});return {next,error:null};}
    catch(error){this.report({operation:'participation-call-auto-advance',ok:false,error});await this.record('participation_call_auto_advance_failed',entry,{reason:safeReason(reason),error:String(error?.message||'자동 호출 실패').slice(0,180)});return {next:null,error:String(error?.message||'다음 참가자 자동 호출에 실패했습니다.').slice(0,180)};}
  }
  state(){
    const raw=this.queueStore.read(),called=raw.entries.filter(entry=>entry.status==='called').sort((a,b)=>a.position-b.position||a.sequence-b.sequence),current=called[0]||null;
    return {timeoutSeconds:this.timeoutSeconds,current:current?this.publicCall(current):null,calledCount:called.length,paused:this.paused,pausedAt:this.pausedAt};
  }
  ensureActive(){if(this.paused)throw httpError('방송 운영이 긴급 잠금 상태입니다. 관리자가 잠금을 해제한 뒤 다시 시도해 주세요.',423,'participation_call_paused');}
  pause(reason='emergency-lock',{at=Date.now()}={}){return this.serial(async()=>{if(this.paused)return this.state();this.paused=true;this.pausedAt=Math.max(0,Number(at)||Date.now());this.pauseReason=safeReason(reason);this.clearTimer();const current=this.queueStore.read().entries.find(entry=>entry.status==='called');if(current)await this.record('participation_call_pause',current,{reason:this.pauseReason});return this.state();});}
  resume(reason='emergency-unlock',{at=Date.now()}={}){return this.serial(async()=>{if(!this.paused)return this.state();const now=Math.max(0,Number(at)||Date.now()),elapsed=Math.max(0,now-this.pausedAt),current=this.queueStore.read().entries.find(entry=>entry.status==='called');if(current&&elapsed)await this.queueStore.extendCallDeadline(current.id,{token:current.callToken,deltaMs:elapsed,reason:safeReason(reason)});this.paused=false;this.pausedAt=0;this.pauseReason='';const refreshed=this.queueStore.read().entries.find(entry=>entry.status==='called');if(refreshed)this.schedule(refreshed);if(refreshed)await this.record('participation_call_resume',refreshed,{pausedMs:elapsed,reason:safeReason(reason)});return this.state();});}
  publicCall(entry){
    if(!entry)return null;
    return {id:entry.id,displayName:entry.displayName,source:entry.source,discordUserId:entry.discordUserId||'',position:entry.position,calledAt:Number(entry.calledAt)||0,deadline:Number(entry.callDeadline)||0,attempt:Number(entry.callAttempt)||0,messageRef:entry.callMessage?{...entry.callMessage}:null};
  }
  clearTimer(){if(this.timer){clearTimeout(this.timer);this.timer=null;}}
  schedule(entry){
    this.clearTimer();if(this.closed||this.paused||!entry||entry.status!=='called')return;
    const delay=Math.max(0,Number(entry.callDeadline)-Date.now());
    this.timer=setTimeout(()=>{this.timer=null;this.serial(()=>this.expireAndAdvance(entry.id,entry.callToken)).catch(error=>this.report({operation:'participation-call-timeout',ok:false,error}));},Math.min(delay,2_147_000_000));
    this.timer.unref?.();
  }
  async start(){
    this.closed=false;
    return this.serial(async()=>{
      const called=this.queueStore.read().entries.filter(entry=>entry.status==='called').sort((a,b)=>a.position-b.position||a.sequence-b.sequence);
      if(called.length>1){
        for(const extra of called.slice(1))await this.queueStore.cancelCall(extra.id,{reason:'restart-duplicate-call'});
        await this.record('participation_call_recovery',called[0],{duplicatesReset:called.length-1});
      }
      const current=this.queueStore.read().entries.find(entry=>entry.status==='called');
      if(!current)return {recovered:false,current:null,paused:this.paused};
      if(this.paused){await this.record('participation_call_pause_recovery',current,{pausedAt:this.pausedAt});return {recovered:true,current:this.publicCall(current),paused:true};}
      if(!Number.isFinite(Number(current.callDeadline))||Number(current.callDeadline)<=Date.now()){
        const expired=await this.queueStore.expireCall(current.id,{token:current.callToken,now:Date.now(),reason:'restart-timeout'});
        if(expired.changed){await this.safeFinalize(expired,'no_show');await this.record('participation_call_timeout_recovery',expired.entry,{autoAdvance:true});}
        const advance=expired.changed?await this.autoAdvance('restart-timeout-auto',expired.entry):{next:null,error:null};
        return {recovered:true,expired:expired.changed,next:advance.next?.entry||null,advanceError:advance.error};
      }
      this.schedule(current);await this.record('participation_call_recovery',current,{deadline:current.callDeadline});return {recovered:true,current:this.publicCall(current)};
    });
  }
  stop(){this.closed=true;this.clearTimer();}
  async reconcile({autoAdvance=false,reason='external-sync'}={}){return this.serial(async()=>{
    const current=this.queueStore.read().entries.find(entry=>entry.status==='called');
    if(current){this.schedule(current);return {current:this.publicCall(current),advanced:false};}
    this.clearTimer();if(!autoAdvance)return {current:null,advanced:false};
    const next=await this.callNextUnlocked({reason,allowEmpty:true});return {current:next?.entry||null,advanced:Boolean(next)};
  });}
  async callNext({reason='dashboard'}={}){this.ensureActive();return this.serial(()=>this.callNextUnlocked({reason}));}
  async callNextUnlocked({reason='dashboard',allowEmpty=false}={}){
    const current=this.queueStore.read().entries.find(entry=>entry.status==='called');
    if(current)return {entry:this.publicCall(current),alreadyCalled:true};
    const next=this.queueStore.read().entries.filter(entry=>entry.status==='waiting').sort((a,b)=>a.position-b.position||a.sequence-b.sequence)[0];
    if(!next){if(allowEmpty)return null;throw httpError('호출할 대기 참가자가 없습니다.',409,'participation_queue_empty');}
    return this.callEntryUnlocked(next.id,{reason});
  }
  async callEntry(id,{reason='dashboard',recall=false}={}){this.ensureActive();return this.serial(()=>this.callEntryUnlocked(id,{reason,recall}));}
  async callEntryUnlocked(id,{reason='dashboard',recall=false}={}){
    if(this.closed)throw httpError('시참 호출 서비스가 종료 중입니다.',503,'participation_call_stopping');
    const raw=this.queueStore.read(),entry=raw.entries.find(item=>item.id===id);
    if(!entry)throw httpError('호출할 참가자를 찾지 못했습니다.',404,'participation_entry_missing');
    const other=raw.entries.find(item=>item.status==='called'&&item.id!==id);
    if(other)throw httpError(`${other.displayName}님의 응답을 먼저 처리해 주세요.`,409,'participation_call_active');
    if(entry.status==='called'&&!recall)return {entry:this.publicCall(entry),alreadyCalled:true};
    if(!['waiting','called'].includes(entry.status))throw httpError('대기 중인 참가자만 호출할 수 있습니다.',409,'participation_call_invalid_status');
    const token=randomUUID().replaceAll('-','').slice(0,16),call=await this.queueStore.beginCall(id,{token,timeoutSeconds:this.timeoutSeconds,reason:safeReason(reason),recall});
    let messageRef=call.previousMessage||null;
    try{
      messageRef=await this.discord.participationCall(call.entry,{messageRef,token,deadline:call.entry.callDeadline,timeoutSeconds:this.timeoutSeconds,recall});
      const delivered=await this.queueStore.attachCallMessage(id,{token,messageRef});
      this.schedule(this.queueStore.read().entries.find(item=>item.id===id));
      await this.record(recall?'participation_call_recall':'participation_call_start',delivered.entry,{deadline:delivered.entry.callDeadline,attempt:delivered.entry.callAttempt});
      this.report({operation:recall?'participation-call-recall':'participation-call-start',ok:true});
      return {entry:this.publicCall(delivered.entry),alreadyCalled:false};
    }catch(error){
      await this.queueStore.cancelCall(id,{token,reason:'discord-delivery-failed'}).catch(()=>{});this.clearTimer();
      await this.record('participation_call_delivery_failed',call.entry,{error:String(error?.message||'Discord 전송 실패').slice(0,180)});
      this.report({operation:'participation-call-start',ok:false,error});throw error;
    }
  }
  async recall(id,{reason='dashboard-recall'}={}){return this.callEntry(id,{reason,recall:true});}
  async cancel(id,{reason='dashboard-cancel'}={}){
    this.ensureActive();return this.serial(async()=>{
      const result=await this.queueStore.cancelCall(id,{reason:safeReason(reason)});if(!result.changed)return result;
      this.clearTimer();await this.safeFinalize(result,'waiting');await this.record('participation_call_cancel',result.entry,{reason:safeReason(reason)});return result;
    });
  }
  async respond({entryId,token,userId,action}){
    this.ensureActive();return this.serial(async()=>{
      const result=await this.queueStore.respondCall(entryId,{token,userId,action,now:Date.now()});
      this.clearTimer();await this.safeFinalize(result,result.entry.status);await this.record(action==='join'?'participation_call_join':'participation_call_pass',result.entry,{action});
      const advance=action==='pass'?await this.autoAdvance('pass-auto',result.entry):{next:null,error:null};
      return {entry:result.entry,next:advance.next?.entry||null,advanceError:advance.error};
    });
  }
  async resolveManual(id,status,{reason='dashboard'}={}){
    this.ensureActive();return this.serial(async()=>{
      const before=this.queueStore.read().entries.find(entry=>entry.id===id);if(!before)throw httpError('참가자를 찾지 못했습니다.',404,'participation_entry_missing');
      const wasCalled=before.status==='called',result=await this.queueStore.setStatus(id,status,{reason:safeReason(reason)});
      let advance={next:null,error:null};if(wasCalled&&result.changed){this.clearTimer();await this.safeFinalize({...result,messageRef:before.callMessage||null},status);await this.record('participation_call_manual_resolve',result.entry,{status});if(AUTO_ADVANCE_STATUSES.has(status))advance=await this.autoAdvance('manual-auto',result.entry);}
      return {...result,next:advance.next?.entry||null,advanceError:advance.error};
    });
  }
  async expireAndAdvance(id,token){
    if(this.paused)return {entry:this.queueStore.read().entries.find(entry=>entry.id===id)||null,changed:false,paused:true};
    const result=await this.queueStore.expireCall(id,{token,now:Date.now(),reason:'timeout'});if(!result.changed)return result;
    await this.safeFinalize(result,'no_show');await this.record('participation_call_timeout',result.entry,{autoAdvance:true});this.report({operation:'participation-call-timeout',ok:true});
    const advance=await this.autoAdvance('timeout-auto',result.entry);return {...result,next:advance.next?.entry||null,advanceError:advance.error};
  }
  async safeFinalize(result,status){
    const ref=result?.messageRef||result?.previousMessage||null;if(!ref)return;
    try{await this.discord.completeParticipationCall(ref,{entry:result.entry,status});}catch(error){this.report({operation:'participation-call-finalize',ok:false,error});}
  }
}
