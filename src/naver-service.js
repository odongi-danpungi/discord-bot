import { randomBytes } from 'node:crypto';

const AUTHORIZE_URL = 'https://nid.naver.com/oauth2.0/authorize';
const TOKEN_URL = 'https://nid.naver.com/oauth2.0/token';
const REVOKE_URL = 'https://nid.naver.com/oauth2.0/revoke';
const PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';
const SEARCH_URL = 'https://openapi.naver.com/v1/search/cafearticle.json';
const CAFE_API = 'https://openapi.naver.com/v1/cafe';
const STATE_TTL_MS = 10 * 60 * 1000;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

function text(value, max, label) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label}을 입력해 주세요.`);
  if (result.length > max) throw new Error(`${label}은 ${max}자 이하로 입력해 주세요.`);
  return result;
}
function digits(value, label) {
  const result = String(value ?? '').trim();
  if (!/^\d+$/.test(result)) throw new Error(`${label}을 확인해 주세요.`);
  return result;
}
function stripHtml(value='') { return String(value).replace(/<[^>]*>/g, '').replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&#39;',"'"); }
function safeUrl(value='') { try { const url=new URL(value); return ['http:','https:'].includes(url.protocol)?url.toString():''; } catch { return ''; } }
function percentEncodeBytes(buffer) {
  let out='';
  for(const byte of buffer){
    const ch=String.fromCharCode(byte);
    if(/[A-Za-z0-9_.~-]/.test(ch)) out+=ch;
    else if(byte===0x20) out+='+';
    else out += `%${byte.toString(16).toUpperCase().padStart(2,'0')}`;
  }
  return out;
}
async function cafeForm(fields) {
  const { default: iconv } = await import('iconv-lite');
  return Object.entries(fields).map(([key,value])=>`${encodeURIComponent(key)}=${percentEncodeBytes(iconv.encode(String(value ?? ''),'cp949'))}`).join('&');
}
function mapStatus(status){
  if(status===401)return 401;
  if(status===403)return 403;
  if(status===429)return 429;
  if(status>=500)return 502;
  return 400;
}
function retryAfterMs(response){
  const raw=response?.headers?.get?.('retry-after');
  if(!raw)return 0;
  const seconds=Number(raw);
  if(Number.isFinite(seconds))return Math.max(0,Math.round(seconds*1000));
  const at=Date.parse(raw);
  return Number.isFinite(at)?Math.max(0,at-Date.now()):0;
}

export class NaverService {
  constructor({config,authStore=null,fetchImpl=globalThis.fetch,timeoutMs=10000,reporter=null,sleepImpl=null}={}) {
    this.config=config||{};
    this.authStore=authStore;
    this.fetch=fetchImpl;
    this.timeoutMs=Math.max(1000,Number(timeoutMs)||10000);
    this.reporter=typeof reporter==='function'?reporter:()=>{};
    this.sleep=typeof sleepImpl==='function'?sleepImpl:(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    this.states=new Map();
    this.refreshPromise=null;
  }
  configured() { return Boolean(this.config.naverClientId && this.config.naverClientSecret); }
  oauthConfigured() { return Boolean(this.config.naverClientId && this.config.naverClientSecret && this.config.naverRedirectUri && this.authStore); }
  status() {
    const auth = this.authStore?.summary?.() || {connected:false,expiresAt:0,hasRefreshToken:false};
    return {
      configured:this.configured(), oauthConfigured:this.oauthConfigured(), connected:Boolean(auth.connected), expiresAt:Number(auth.expiresAt||0), hasRefreshToken:Boolean(auth.hasRefreshToken),
      cafeId:this.config.naverCafeId||'', menuId:this.config.naverMenuId||'', memoMenuId:this.config.naverMemoMenuId||this.config.naverMenuId||'',
      requestPolicy:{timeoutMs:this.timeoutMs,searchRetries:2,unsafePostRetries:0,refreshSingleFlight:true},
      capabilities:{
        oauthLogin:this.oauthConfigured(), publicCafeSearch:this.configured(), publicCafeMonitor:this.configured(), cafeJoin:Boolean(auth.connected&&this.config.naverCafeId), articleWrite:Boolean(auth.connected&&this.config.naverCafeId&&this.config.naverMenuId), memoArticleWrite:Boolean(auth.connected&&this.config.naverCafeId&&(this.config.naverMemoMenuId||this.config.naverMenuId)),
        comments:false, notices:false
      },
      officialLimits:{searchPerDay:25000,joinPerAccountPerDay:50,writePerAccountPerDay:200},
      limitations:['공식 카페 API에는 댓글 작성/관리 API가 없습니다. 따라서 댓글 순서를 자동으로 읽거나 대시보드에서 댓글을 직접 작성할 수 없습니다.','공식 카페 API에는 공지 지정/해제 관리 API가 없습니다.','새 공개글 감시는 webhook이 아니라 공식 카페글 검색 API의 주기 조회 방식이며 검색어가 필요합니다.']
    };
  }
  cleanupStates(now=Date.now()) { for(const [key,expiresAt] of this.states)if(expiresAt<=now)this.states.delete(key); }
  beginOAuth() {
    if(!this.oauthConfigured())throw new Error('네이버 OAuth 설정이 완료되지 않았습니다. NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, NAVER_REDIRECT_URI, NAVER_TOKEN_KEY를 확인해 주세요.');
    this.cleanupStates();const state=randomBytes(24).toString('base64url');this.states.set(state,Date.now()+STATE_TTL_MS);
    const url=new URL(AUTHORIZE_URL);url.search=new URLSearchParams({response_type:'code',client_id:this.config.naverClientId,redirect_uri:this.config.naverRedirectUri,state}).toString();
    return {url:url.toString(),expiresAt:Date.now()+STATE_TTL_MS};
  }
  consumeState(state) { this.cleanupStates();const key=String(state||'');const expiresAt=this.states.get(key);if(!expiresAt||expiresAt<=Date.now())throw Object.assign(new Error('네이버 로그인 요청이 만료되었거나 state가 일치하지 않습니다. 대시보드에서 다시 연동해 주세요.'),{status:400});this.states.delete(key); }
  async rawRequest(url,{method='GET',headers={},body=null,expectJson=true,operation='naver-api',retries=0}={}) {
    if(Date.now()<(this.rateLimitedUntil||0))throw Object.assign(Error('Naver rate limit cooldown'),{status:429,upstreamStatus:429,retryAfterMs:this.rateLimitedUntil-Date.now()});
    if(typeof this.fetch!=='function')throw new Error('HTTP fetch를 사용할 수 없습니다.');
    const attempts=Math.max(1,Math.min(3,1+Math.max(0,Number(retries)||0)));
    let lastError;
    for(let attempt=1;attempt<=attempts;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs),started=Date.now();
      try{
        const response=await this.fetch(url,{method,headers,body,redirect:'error',signal:controller.signal});let data=null;
        if(expectJson){const raw=await response.text();if(raw){try{data=JSON.parse(raw);}catch{throw Object.assign(new Error('네이버 API 응답 형식을 읽지 못했습니다.'),{status:502,source:'naver'});}}}
        if(!response.ok){
          const message=data?.error_description||data?.message?.error?.msg||data?.message?.result?.msg||data?.error||`네이버 API 오류 (${response.status})`;
          const error=Object.assign(new Error(String(message)),{status:mapStatus(response.status),upstreamStatus:response.status,source:'naver',retryAfterMs:retryAfterMs(response)});
          if(response.status===429)this.rateLimitedUntil=Date.now()+(error.retryAfterMs||60000);
          if(attempt<attempts&&TRANSIENT_STATUSES.has(response.status)&&response.status!==429){
            clearTimeout(timer);await this.sleep(error.retryAfterMs||Math.min(2000,250*(2**(attempt-1))));lastError=error;continue;
          }
          throw error;
        }
        this.reporter({operation,ok:true,status:response.status,durationMs:Date.now()-started,attempt});return {response,data};
      }catch(error){
        let finalError=error;
        if(error?.name==='AbortError')finalError=Object.assign(new Error('네이버 API 응답 시간이 초과되었습니다.'),{status:504,source:'naver'});
        const retryableNetwork=!finalError?.upstreamStatus&&(finalError?.status===504||error instanceof TypeError);
        if(attempt<attempts&&retryableNetwork){clearTimeout(timer);await this.sleep(Math.min(2000,250*(2**(attempt-1))));lastError=finalError;continue;}
        if(operation==='profile-probe')finalError=Object.assign(new Error('Naver read-only probe failed'),{status:finalError?.status,upstreamStatus:finalError?.upstreamStatus,retryAfterMs:finalError?.retryAfterMs,code:finalError?.status===504?'ETIMEDOUT':'CONNECTION_FAILED'});
        this.reporter({operation,ok:false,status:Number(finalError?.status)||502,upstreamStatus:Number(finalError?.upstreamStatus)||0,durationMs:Date.now()-started,attempt,error:finalError});throw finalError;
      }finally{clearTimeout(timer);}
    }
    throw lastError||Object.assign(new Error('네이버 API 요청에 실패했습니다.'),{status:502,source:'naver'});
  }
  async exchangeCode({code,state}) {
    if(!this.oauthConfigured())throw new Error('네이버 OAuth 설정이 완료되지 않았습니다.');
    this.consumeState(state);
    const params=new URLSearchParams({grant_type:'authorization_code',client_id:this.config.naverClientId,client_secret:this.config.naverClientSecret,code:text(code,512,'인증 코드'),state:String(state)});
    const {data}=await this.rawRequest(`${TOKEN_URL}?${params}`,{operation:'oauth-token',retries:0});
    if(data?.error)throw Object.assign(new Error(data.error_description||data.error),{status:400,source:'naver'});
    await this.authStore.saveToken({accessToken:data.access_token,refreshToken:data.refresh_token,tokenType:data.token_type,expiresIn:Number(data.expires_in||0)});return this.status();
  }
  async refreshToken() {
    if(this.refreshPromise)return this.refreshPromise;
    this.refreshPromise=(async()=>{
      const current=this.authStore?.token?.();
      if(!current?.refreshToken)throw Object.assign(new Error('네이버 refresh token이 없습니다. 다시 연동해 주세요.'),{status:409,source:'naver'});
      const params=new URLSearchParams({grant_type:'refresh_token',client_id:this.config.naverClientId,client_secret:this.config.naverClientSecret,refresh_token:current.refreshToken});
      const {data}=await this.rawRequest(`${TOKEN_URL}?${params}`,{operation:'oauth-refresh',retries:1});
      if(!data?.access_token)throw Object.assign(new Error('네이버 access token 갱신 응답이 올바르지 않습니다.'),{status:502,source:'naver'});
      await this.authStore.saveToken({accessToken:data.access_token,refreshToken:data.refresh_token||current.refreshToken,tokenType:data.token_type,expiresIn:Number(data.expires_in||0)});
      return this.authStore.token();
    })();
    try{return await this.refreshPromise;}finally{this.refreshPromise=null;}
  }
  async accessToken({forceRefresh=false}={}) {
    const token=this.authStore?.token?.();
    if(!token?.accessToken)throw Object.assign(new Error('네이버 계정을 먼저 연동해 주세요.'),{status:409,source:'naver'});
    if(forceRefresh||(token.expiresAt&&token.expiresAt-Date.now()<60000))return (await this.refreshToken()).accessToken;
    return token.accessToken;
  }
  async authorizedRequest(url,options={}){
    let token=await this.accessToken();
    try{return await this.rawRequest(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${token}`}});}
    catch(error){
      if(error?.upstreamStatus!==401)throw error;
      token=await this.accessToken({forceRefresh:true});
      return this.rawRequest(url,{...options,retries:0,headers:{...(options.headers||{}),Authorization:`Bearer ${token}`}});
    }
  }
  async disconnect() {
    const token=this.authStore?.token?.();if(token?.accessToken&&this.configured()){
      const body=new URLSearchParams({client_id:this.config.naverClientId,client_secret:this.config.naverClientSecret,token:token.accessToken,token_type_hint:'access_token'}).toString();
      try{await this.rawRequest(REVOKE_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,expectJson:false,operation:'oauth-revoke',retries:0});}catch(error){if(error.upstreamStatus!==400)throw error;}
    }
    if(this.authStore)await this.authStore.clear();return this.status();
  }
  async profile({readOnly=false}={}) {
    if(readOnly){
      const token=this.authStore?.token?.();
      if(!token?.accessToken||(token.expiresAt&&token.expiresAt<=Date.now()))throw Object.assign(Error('OAuth reconnection required'),{code:'OAUTH_RECONNECT_REQUIRED'});
      const {data}=await this.rawRequest(PROFILE_URL,{operation:'profile-probe',retries:0,headers:{Authorization:`Bearer ${token.accessToken}`}});
      if(data?.resultcode!=='00'||!data?.response?.id)throw Object.assign(Error('Invalid profile response'),{code:'INVALID_RESPONSE'});
      return {ok:true};
    }
    const {data}=await this.authorizedRequest(PROFILE_URL,{operation:'profile',retries:2});const p=data?.response||{};return {id:String(p.id||''),nickname:String(p.nickname||''),name:String(p.name||''),profileImage:safeUrl(p.profile_image||'')};
  }
  async searchCafeArticles({query,display=10,start=1,sort='date'}) {
    if(!this.configured())throw new Error('네이버 Client ID/Secret이 설정되지 않았습니다.');query=text(query,100,'검색어');display=Math.min(100,Math.max(1,Number(display)||10));start=Math.min(1000,Math.max(1,Number(start)||1));sort=sort==='sim'?'sim':'date';const url=new URL(SEARCH_URL);url.search=new URLSearchParams({query,display:String(display),start:String(start),sort}).toString();const {data}=await this.rawRequest(url,{headers:{'X-Naver-Client-Id':this.config.naverClientId,'X-Naver-Client-Secret':this.config.naverClientSecret},operation:'cafe-search',retries:2});return {total:Number(data?.total||0),start:Number(data?.start||start),display:Number(data?.display||display),items:(data?.items||[]).map(item=>({title:stripHtml(item.title),description:stripHtml(item.description),link:safeUrl(item.link),cafeName:stripHtml(item.cafename),cafeUrl:safeUrl(item.cafeurl)}))}; }
  async joinCafe({cafeId=this.config.naverCafeId,nickname}) { cafeId=digits(cafeId,'카페 ID');nickname=text(nickname,40,'카페 별명');const body=await cafeForm({nickname});const {data}=await this.authorizedRequest(`${CAFE_API}/${cafeId}/members`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,operation:'cafe-join',retries:0});return {ok:true,message:data?.message?.result?.msg||'Success'}; }
  async writeArticle({cafeId=this.config.naverCafeId,menuId=this.config.naverMenuId,subject,content}) { cafeId=digits(cafeId,'카페 ID');menuId=digits(menuId,'게시판 ID');subject=text(subject,200,'제목');content=text(content,20000,'내용');const body=await cafeForm({subject,content});const {data}=await this.authorizedRequest(`${CAFE_API}/${cafeId}/menu/${menuId}/articles`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,operation:'article-write',retries:0});const result=data?.message?.result||{};return {ok:true,articleId:result.articleId||null,articleUrl:safeUrl(result.articleUrl||''),cafeUrl:safeUrl(result.cafeUrl||''),message:result.msg||'Success'}; }
}

export const __test={stripHtml,safeUrl,percentEncodeBytes,mapStatus,retryAfterMs};
