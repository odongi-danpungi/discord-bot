export class ChzzkLiveMonitor {
  constructor({store,chzzk,discord,reporter=null,audit=null,guard=()=>{}}={}){this.guard=guard;this.store=store;this.chzzk=chzzk;this.discord=discord;this.reporter=typeof reporter==='function'?reporter:()=>{};this.audit=typeof audit==='function'?audit:async()=>{};this.busy=false;}
  summary(){const base=this.store?.summary?.()||{settings:{enabled:false,channelId:'',intervalMinutes:2,discordAlerts:true,maxPages:50},state:{lastStatus:'idle'},currentLive:null,events:[]};return {...base,connector:this.chzzk?.status?.()||{configured:false}};}
  async run({force=false,now=Date.now()}={}){
    this.guard();
    const before=this.summary(),settings=before.settings,state=before.state;if(!settings.enabled&&!force)return {skipped:'disabled',summary:before};
    if(!this.chzzk?.configured?.()||!settings.channelId){if(force)throw Object.assign(Error('치지직 방송 감지 설정을 먼저 완료해 주세요.'),{status:400});return {skipped:'unconfigured',summary:before};}
    if(!force&&state.nextRunAt&&now<state.nextRunAt)return {skipped:'not-due',summary:before};if(this.busy)return {skipped:'busy',summary:before};this.busy=true;const started=Date.now();
    try{
      if(!state.baselineReady){
        const channelCheck=await this.chzzk.getChannel(settings.channelId);
        if(!channelCheck.channel)throw Object.assign(Error('설정한 CHZZK_CHANNEL_ID에 해당하는 치지직 채널을 찾지 못했습니다.'),{status:400,source:'chzzk',code:'CHZZK_CHANNEL_NOT_FOUND'});
      }
      const scan=await this.chzzk.scanLiveChannel(settings.channelId,{maxPages:settings.maxPages});
      if(!state.baselineReady&&scan.complete){await this.store.bootstrap(scan,now);await this.audit({category:'broadcast',action:'chzzk_live_baseline',summary:`치지직 방송 감지 기준선 생성 · ${scan.live?'LIVE':'OFFLINE'}`,details:{channelId:settings.channelId,pagesScanned:scan.pagesScanned,totalScanned:scan.totalScanned}});}
      let event=null;if(state.baselineReady&&scan.complete)event=await this.store.applyScan(scan,now);
      if(!scan.complete){await this.store.noteRun({ok:true,complete:false,now,pagesScanned:scan.pagesScanned,totalScanned:scan.totalScanned});this.reporter({operation:'live-scan',ok:true,status:206,durationMs:Date.now()-started,pagesScanned:scan.pagesScanned,totalScanned:scan.totalScanned});return {unknown:true,scan,summary:this.summary()};}
      if(event){
        if(settings.discordAlerts){
          const readiness=await this.discord?.chzzkLiveAlertReadiness?.();if(!readiness?.ready){await this.store.markEvent(event.id,{status:'failed',error:readiness?.message||'Discord 방송 알림 채널을 사용할 수 없습니다.'});}
          else{try{this.guard();const sent=await this.discord.chzzkLiveAlert(event);await this.store.markEvent(event.id,{status:'sent',discordMessageId:sent?.id||'',discordChannelId:sent?.channelId||''});}catch(error){await this.store.markEvent(event.id,{status:'failed',error:error?.message||'Discord 방송 알림 전송 실패'});}}
        }else await this.store.markEvent(event.id,{status:'suppressed',error:'Discord 방송 알림이 꺼져 있습니다.'});
        await this.audit({category:'broadcast',action:event.type==='start'?'chzzk_live_started':'chzzk_live_ended',summary:event.type==='start'?'치지직 방송 시작 감지':'치지직 방송 종료 감지',details:{channelId:settings.channelId,liveId:event.live?.liveId||null,title:event.live?.liveTitle||null}});
      }
      await this.store.noteRun({ok:true,complete:true,now,pagesScanned:scan.pagesScanned,totalScanned:scan.totalScanned});this.reporter({operation:'live-scan',ok:true,status:200,durationMs:Date.now()-started,pagesScanned:scan.pagesScanned,totalScanned:scan.totalScanned,transition:event?.type||null});return {event,scan,summary:this.summary()};
    }catch(error){await this.store.noteRun({ok:false,complete:false,now,error});this.reporter({operation:'live-scan',ok:false,status:Number(error?.upstreamStatus)||Number(error?.status)||502,durationMs:Date.now()-started,error});throw error;}finally{this.busy=false;}
  }
}
