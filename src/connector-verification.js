import { APP_VERSION } from './version.js';
import { readPublicHealth, publicHealthUrl } from './probe-http.js';
const rank={pass:0,warn:1,fail:2};
const clean=(value,max=220)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
export const safeProbeError=error=>{const allowed=new Set(['ETIMEDOUT','INVALID_PUBLIC_URL','INVALID_RESPONSE','VERSION_MISMATCH','NOT_READY','NOT_CONNECTED','PERMISSION_DENIED','NOT_CONFIGURED','OAUTH_RECONNECT_REQUIRED','PROBE_BUSY','CHANNEL_NOT_FOUND']);const code=allowed.has(error?.code)?error.code:'CONNECTION_FAILED',raw=Number(error?.upstreamStatus||error?.status),status=Number.isInteger(raw)&&raw>=400&&raw<=599?raw:0;return {code,status,retryAfterMs:Number.isFinite(error?.retryAfterMs)?Math.max(0,error.retryAfterMs):0};};
const safeError=error=>{const {code,status}=safeProbeError(error);return [code,status?`HTTP ${status}`:''].filter(Boolean).join(' · ');};
const worst=checks=>checks.reduce((s,c)=>rank[c.status]>rank[s]?c.status:s,'pass');
function item(id,label,status,detail,required=true){return {id,label,status,detail:clean(detail),required:Boolean(required)};}
function httpsOrigin(value){try{const u=new URL(String(value||''));return u.protocol==='https:'?u.origin:'';}catch{return '';}}

export function buildConnectorVerification({config={},discordStatus=null,naverStatus=null,chzzkStatus=null,publicProbe=null,discordProbe=null,naverProbe=null,chzzkProbe=null,now=Date.now()}={}){
  const checks=[];
  const discordConfigured=Boolean(config.clientId&&config.guildId&&config.token);
  checks.push(item('discord-config','Discord 연결 설정',discordConfigured?'pass':'fail',discordConfigured?'Bot Token/Application/Guild 설정됨':'Discord 필수 설정 누락'));
  if(discordProbe)checks.push(item('discord-live','Discord API 연결',discordProbe.ok?'pass':'fail',discordProbe.ok?'Gateway/API 연결 확인됨':safeError(discordProbe.error)));
  else {const discordConnected=discordStatus?.connected===true,discordKnown=typeof discordStatus?.connected==='boolean';checks.push(item('discord-live','Discord API 연결',discordConnected?'pass':'warn',discordConnected?'최근 런타임 연결 확인됨':discordKnown?'최근 연결 상태 확인 필요':'아직 런타임 연결 확인 전',false));}

  const naverConfigured=Boolean(config.naverClientId&&config.naverClientSecret),naverOauth=Boolean(config.naverRedirectUri),naverConnected=Boolean(naverStatus?.connected);
  checks.push(item('naver-config','Naver API 설정',naverConfigured?'pass':'warn',naverConfigured?'Client 인증 설정됨':'Naver 연동 미설정',false));
  if(naverConfigured&&naverOauth)checks.push(item('naver-oauth','Naver OAuth 상태',naverConnected?'pass':'warn',naverConnected?'OAuth token 연결됨':'OAuth 설정은 있으나 계정 연결이 필요합니다.',false));
  if(naverProbe)checks.push(item('naver-live','Naver API 연결',naverProbe.ok?'pass':'fail',naverProbe.ok?'인증된 Profile API 호출 성공':safeError(naverProbe.error),false));

  const chzzkConfigured=Boolean(config.chzzkClientId&&config.chzzkClientSecret&&config.chzzkChannelId);
  checks.push(item('chzzk-config','CHZZK API 설정',chzzkConfigured?'pass':'warn',chzzkConfigured?'Client/Channel 설정됨':'CHZZK 연동 미설정',false));
  if(chzzkProbe)checks.push(item('chzzk-live','CHZZK API 연결',!chzzkProbe.ok?'fail':chzzkProbe.channelFound?'pass':'fail',chzzkProbe.ok?(chzzkProbe.channelFound?'Channel API 호출 및 채널 확인 성공':'API 호출 성공 · 대상 채널을 찾지 못했습니다.'):safeError(chzzkProbe.error),false));

  const publicBase=String(config.publicBaseUrl||''),publicHttps=httpsOrigin(publicBase),redirectOrigin=httpsOrigin(config.naverRedirectUri||'');
  const callbackOk=!config.naverRedirectUri||Boolean(publicHttps&&redirectOrigin===publicHttps&&new URL(config.naverRedirectUri).pathname==='/naver/callback');
  checks.push(item('oauth-origin','OAuth/Public HTTPS 정합성',callbackOk?'pass':'fail',callbackOk?(config.naverRedirectUri?'Naver callback이 Public HTTPS origin과 일치':'OAuth callback 미사용'):'NAVER_REDIRECT_URI와 PUBLIC_BASE_URL origin/path 불일치',Boolean(config.naverRedirectUri)));
  if(publicProbe)checks.push(item('public-health','Public HTTPS Health',publicProbe.ok?'pass':'fail',publicProbe.ok?`외부 health 응답 ${publicProbe.status}`:safeError(publicProbe.error),Boolean(publicBase)));
  else checks.push(item('public-health','Public HTTPS Health',publicHttps?'warn':publicBase?'fail':'warn',publicHttps?'수동 연결 검증을 실행하면 외부 /healthz를 확인합니다.':publicBase?'PUBLIC_BASE_URL이 HTTPS가 아닙니다.':'공개 URL 미설정',false));

  const required=checks.filter(c=>c.required),blocking=required.filter(c=>c.status==='fail');
  return {schema:'daengdaeng-connector-verification-v1',checkedAt:now,status:blocking.length?'fail':worst(checks),launchable:blocking.length===0,probed:Boolean(discordProbe||naverProbe||chzzkProbe||publicProbe),counts:{pass:checks.filter(c=>c.status==='pass').length,warn:checks.filter(c=>c.status==='warn').length,fail:checks.filter(c=>c.status==='fail').length,total:checks.length,blocking:blocking.length},checks};
}

const pending=new WeakSet();
async function bounded(service,fn,timeoutMs){
  if(pending.has(service))throw Object.assign(Error('Probe already running'),{code:'PROBE_BUSY'});
  pending.add(service);let timer;
  const operation=Promise.resolve().then(fn).finally(()=>pending.delete(service));
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Probe deadline'),{code:'ETIMEDOUT'})),timeoutMs);})]);}finally{clearTimeout(timer);}
}
export async function runConnectorProbes({config={},discord=null,naver=null,chzzk=null,fetchImpl=null,healthReader=readPublicHealth,timeoutMs=12000}={}){
  const result={};
  const probe=async(key,service,fn)=>{const start=Date.now();try{result[key]={...await bounded(service,fn,timeoutMs),durationMs:Date.now()-start};}catch(error){result[key]={ok:false,error:safeProbeError(error),durationMs:Date.now()-start};}};
  const jobs=[];
  if(discord)jobs.push(probe('discord',discord,async()=>{const d=await discord.diagnostics();const connected=d?.connected===true,permissions=!Array.isArray(d?.checks)||d.checks.every(check=>check.ok===true);return {ok:connected&&permissions,error:connected?(permissions?undefined:{code:'PERMISSION_DENIED'}):{code:'NOT_CONNECTED'}};}));
  if(naver)jobs.push(probe('naver',naver,async()=>{if(naver.status?.().connected!==true)return {ok:false,error:{code:'OAUTH_RECONNECT_REQUIRED'}};await naver.profile({readOnly:true});return {ok:true};}));
  if(chzzk&&config.chzzkChannelId)jobs.push(probe('chzzk',chzzk,async()=>{const r=await chzzk.getChannel(config.chzzkChannelId,{retries:0});return {ok:Boolean(r?.channel),channelFound:Boolean(r?.channel),error:r?.channel?undefined:{code:'CHANNEL_NOT_FOUND'}};}));
  if(config.publicBaseUrl)jobs.push(probe('public',config,async()=>{
    const url=publicHealthUrl(config.publicBaseUrl);let response;
    if(fetchImpl){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const r=await fetchImpl(url,{method:'GET',redirect:'manual',signal:controller.signal});response={status:r.status,body:r.status===200?await r.json():null};}finally{clearTimeout(timer);}}
    else response=await healthReader(config.publicBaseUrl);
    const {status,body,retryAfterMs=0}=response;
    if(status!==200)return {ok:false,status,error:{status,retryAfterMs}};
    if(body?.version!==APP_VERSION)return {ok:false,status,error:{code:'VERSION_MISMATCH'}};
    const ok=body?.status==='ok'&&body.ready===true&&body.emergencyLocked===false;
    return {ok,status,error:ok?undefined:{code:'NOT_READY'}};
  }));
  await Promise.all(jobs);return result;
}
