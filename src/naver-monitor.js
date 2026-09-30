function sameCafe(expected,actual){if(!expected)return true;try{const a=new URL(expected),b=new URL(actual);return a.hostname===b.hostname&&a.pathname.replace(/\/+$/,'')===b.pathname.replace(/\/+$/,'');}catch{return false;}}
function errorDetails(error){return {message:String(error?.message||error||'알 수 없는 오류').slice(0,240),status:Number(error?.status)||0,upstreamStatus:Number(error?.upstreamStatus)||0,code:String(error?.code||'').slice(0,80)};}

export class NaverCafeMonitor {
  constructor({store,naver,discord,reporter=null,audit=null}={}){this.store=store;this.naver=naver;this.discord=discord;this.reporter=typeof reporter==='function'?reporter:()=>{};this.audit=typeof audit==='function'?audit:async()=>{};this.busy=false;}
  summary(){const base=this.store?.summary?.()||{settings:{enabled:false,query:'',cafeUrl:'',intervalMinutes:5,discordAlerts:true},state:{lastStatus:'idle'},events:[],seenCount:0};return {...base,connector:this.naver?.status?.()||null};}
  async run({force=false,now=Date.now()}={}){
    const before=this.summary(),settings=before.settings,state=before.state;
    if(!settings.enabled&&!force)return {skipped:'disabled',summary:before};
    if(!settings.query){if(force)throw Object.assign(Error('네이버 공개글 모니터 검색어를 먼저 설정해 주세요.'),{status:400});return {skipped:'unconfigured',summary:before};}
    if(!force&&state.nextRunAt&&now<state.nextRunAt)return {skipped:'not-due',summary:before};
    if(this.busy)return {skipped:'busy',summary:before};
    this.busy=true;const started=Date.now();
    try{
      const result=await this.naver.searchCafeArticles({query:settings.query,display:100,start:1,sort:'date'}),filtered=(result.items||[]).filter(item=>sameCafe(settings.cafeUrl,item.cafeUrl));
      if(!state.baselineReady){
        const bootstrapped=await this.store.bootstrap(filtered,now);await this.store.noteRun({ok:true,now,found:filtered.length,notified:0});
        await this.audit({category:'naver',action:'monitor_baseline',summary:`네이버 공개글 모니터 기준선 생성 · ${bootstrapped}건`,details:{query:settings.query,cafeUrl:settings.cafeUrl||null}});
        this.reporter({operation:'monitor',ok:true,status:200,durationMs:Date.now()-started,found:filtered.length,notified:0});
        return {bootstrapped:true,found:filtered.length,notified:0,summary:this.summary()};
      }
      const events=await this.store.detect(filtered,now);let notified=0,failed=0;
      if(events.length&&settings.discordAlerts&&typeof this.discord?.naverCafeAlertReadiness==='function'){
        const readiness=await this.discord.naverCafeAlertReadiness();
        if(!readiness?.ready){
          for(const event of events){await this.store.markEvent(event.id,{status:'failed',error:readiness?.message||'Discord 알림 채널을 사용할 수 없습니다.'});failed++;}
          await this.store.noteRun({ok:false,now,found:filtered.length,notified:0,error:Error(readiness?.message||'Discord 알림 채널을 사용할 수 없습니다.')});
          await this.audit({category:'naver',action:'monitor_discord_unavailable',summary:`네이버 공개글 감지 후 Discord 알림 불가 · ${events.length}건`,details:{code:readiness?.code||'unavailable',channelId:readiness?.channelId||null}});
          this.reporter({operation:'monitor',ok:false,status:503,durationMs:Date.now()-started,found:filtered.length,notified:0,error:Error(readiness?.message||'Discord 알림 불가')});
          return {found:filtered.length,newCount:events.length,notified:0,failed,summary:this.summary()};
        }
      }
      for(const event of [...events].reverse()){
        if(!settings.discordAlerts){await this.store.markEvent(event.id,{status:'suppressed',error:'Discord 알림이 꺼져 있습니다.'});continue;}
        try{const sent=await this.discord.naverCafeAlert(event);await this.store.markEvent(event.id,{status:'sent',discordMessageId:sent?.id||'',discordChannelId:sent?.channelId||'',notifiedAt:Date.now()});notified++;}
        catch(error){failed++;await this.store.markEvent(event.id,{status:'failed',error:error?.message||'Discord 알림 전송 실패'});}
      }
      await this.store.noteRun({ok:failed===0,now,found:filtered.length,notified,error:failed?Error(`Discord 알림 ${failed}건 실패`):null});
      if(events.length)await this.audit({category:'naver',action:'monitor_detect',summary:`네이버 공개글 모니터 · 신규 ${events.length}건 · Discord ${notified}건`,details:{failed,query:settings.query,cafeUrl:settings.cafeUrl||null}});
      this.reporter({operation:'monitor',ok:failed===0,status:failed?502:200,durationMs:Date.now()-started,found:filtered.length,notified,error:failed?Error(`Discord 알림 ${failed}건 실패`):null});return {found:filtered.length,newCount:events.length,notified,failed,summary:this.summary()};
    }catch(error){
      await this.store.noteRun({ok:false,now,error});
      await this.audit({category:'naver',action:'monitor_failure',summary:'네이버 공개글 모니터 점검 실패',details:errorDetails(error)}).catch(()=>{});
      this.reporter({operation:'monitor',ok:false,status:Number(error?.status)||502,upstreamStatus:Number(error?.upstreamStatus)||0,durationMs:Date.now()-started,error});throw error;
    }finally{this.busy=false;}
  }
  async retry(eventId){
    const event=this.store.getEvent(eventId);if(!event)throw Object.assign(Error('네이버 모니터 이벤트를 찾지 못했습니다.'),{status:404});if(event.status==='sent')return {alreadySent:true,event};
    if(typeof this.discord?.naverCafeAlertReadiness==='function'){
      const readiness=await this.discord.naverCafeAlertReadiness();
      if(!readiness?.ready){const error=Object.assign(Error(readiness?.message||'Discord 알림 채널을 사용할 수 없습니다.'),{code:readiness?.code||'discord_unavailable'});await this.store.markEvent(event.id,{status:'failed',error:error.message});throw error;}
    }
    try{const sent=await this.discord.naverCafeAlert(event);await this.store.markEvent(event.id,{status:'sent',discordMessageId:sent?.id||'',discordChannelId:sent?.channelId||'',notifiedAt:Date.now()});await this.audit({category:'naver',action:'monitor_retry',summary:'네이버 공개글 Discord 알림 수동 재전송',details:{eventId:event.id}});return {event:this.store.getEvent(event.id)};}catch(error){await this.store.markEvent(event.id,{status:'failed',error:error?.message||'Discord 알림 전송 실패'});throw error;}
  }
}
