import { retryDelay } from './probe-http.js';
const DEFAULT_BASE='https://openapi.chzzk.naver.com';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=value=>String(value??'').trim();
const transient=status=>status===429||status>=500;

export class ChzzkService {
  constructor({clientId='',clientSecret='',fetchImpl=globalThis.fetch,baseUrl=DEFAULT_BASE,timeoutMs=7000,sleepImpl=sleep}={}){
    this.clientId=clean(clientId);this.clientSecret=clean(clientSecret);this.fetchImpl=fetchImpl;this.baseUrl=baseUrl.replace(/\/+$/,'');this.timeoutMs=Math.max(1000,Number(timeoutMs)||7000);this.sleepImpl=typeof sleepImpl==='function'?sleepImpl:sleep;
  }
  configured(){return Boolean(this.clientId&&this.clientSecret);}
  status(){return {configured:this.configured(),baseUrl:this.baseUrl,capabilities:{liveList:this.configured(),channelLookup:this.configured()}};}
  async request(path,{search=null,retries=2}={}){
    if(Date.now()<(this.rateLimitedUntil||0))throw Object.assign(Error('CHZZK rate limit cooldown'),{status:429,upstreamStatus:429,retryAfterMs:this.rateLimitedUntil-Date.now()});
    if(!this.configured())throw Object.assign(Error('CHZZK Client 인증 정보가 없습니다.'),{status:503,source:'chzzk'});
    const url=new URL(this.baseUrl+path);for(const [key,value] of Object.entries(search||{}))if(value!==undefined&&value!==null&&String(value)!=='')url.searchParams.set(key,String(value));
    let lastError;
    for(let attempt=0;attempt<=Math.max(0,retries);attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);timer.unref?.();const started=Date.now();
      try{
        const response=await this.fetchImpl(url,{redirect:'error',headers:{'Client-Id':this.clientId,'Client-Secret':this.clientSecret,'Content-Type':'application/json'},signal:controller.signal});
        let body={};try{body=await response.json();}catch{}
        if(!response.ok){const error=Object.assign(Error(String(body?.message||`CHZZK API 요청 실패 (${response.status})`).slice(0,240)),{status:response.status>=500?502:response.status,upstreamStatus:response.status,source:'chzzk',retryAfterMs:retryDelay(response.headers?.get?.('retry-after')),code:String(body?.code||'CHZZK_API_ERROR')});if(response.status===429)this.rateLimitedUntil=Date.now()+(error.retryAfterMs||60000);if(response.status!==429&&transient(response.status)&&attempt<retries){lastError=error;await this.sleepImpl(Math.min(1500,250*(2**attempt)));continue;}throw error;}
        return {content:body?.content??body,status:response.status,durationMs:Date.now()-started};
      }catch(error){
        const normalized=error?.name==='AbortError'?Object.assign(Error('CHZZK API 응답 시간이 초과되었습니다.'),{status:504,source:'chzzk',code:'ETIMEDOUT'}):error;
        if((normalized?.name==='TypeError'||normalized?.code==='ETIMEDOUT')&&attempt<retries){lastError=normalized;await this.sleepImpl(Math.min(1500,250*(2**attempt)));continue;}
        throw normalized;
      }finally{clearTimeout(timer);}
    }
    throw lastError||Object.assign(Error('CHZZK API 요청에 실패했습니다.'),{status:502,source:'chzzk'});
  }
  async getChannel(channelId,{retries=1}={}){
    const result=await this.request('/open/v1/channels',{search:{channelIds:channelId},retries}),data=Array.isArray(result.content?.data)?result.content.data:[];
    return {channel:data.find(item=>String(item.channelId)===String(channelId))||null,durationMs:result.durationMs};
  }
  async scanLiveChannel(channelId,{maxPages=50}={}){
    const wanted=clean(channelId),limit=Math.max(1,Math.min(100,Number(maxPages)||50));let next='',pages=0,totalScanned=0,totalDurationMs=0;
    while(pages<limit){
      const result=await this.request('/open/v1/lives',{search:{size:20,...(next?{next}:{})},retries:2});pages++;totalDurationMs+=Number(result.durationMs)||0;
      const content=result.content||{},data=Array.isArray(content.data)?content.data:[];totalScanned+=data.length;
      const live=data.find(item=>String(item.channelId)===wanted);
      if(live)return {live:true,complete:true,truncated:false,item:live,pagesScanned:pages,totalScanned,durationMs:totalDurationMs,next:null};
      const pageNext=clean(content.page?.next);
      if(!pageNext)return {live:false,complete:true,truncated:false,item:null,pagesScanned:pages,totalScanned,durationMs:totalDurationMs,next:null};
      next=pageNext;
    }
    return {live:null,complete:false,truncated:true,item:null,pagesScanned:pages,totalScanned,durationMs:totalDurationMs,next};
  }
}
