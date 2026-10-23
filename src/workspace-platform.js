import express from 'express';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { workspaceAsset } from './workspace-assets.js';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Events, PermissionFlagsBits } from 'discord.js';
import { WorkspaceStore } from './workspace-store.js';
import { createWorkspaceLogin } from './workspace-login.js';
import { createWorkspaceRuntime } from './workspace-runtime.js';
import { buildWorkspaceReadiness } from './workspace-readiness.js';
import { saveWorkspaceCallSettings } from './workspace-call-settings.js';
import { readIntakeSettings,saveIntakeSettings } from './intake-policy.js';
import { discordId, workspaceError, workspaceRouteAllowed } from './workspace-policy.js';
import { DISCORD_RECOMMENDED_INSTALL_PERMISSIONS } from './discord-permission-audit.js';
import { ParticipantNaverLinkStore,createParticipantNaverLinkService } from './participant-naver-link.js';
import { hiddenFeatureFor } from './feature-visibility.js';

const requestIdentity=Symbol('verified-workspace-identity');
const hash=value=>createHash('sha256').update(String(value||'')).digest('hex');
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const installPermissions=[...DISCORD_RECOMMENDED_INSTALL_PERMISSIONS,'ManageRoles'].reduce((bits,name)=>bits|PermissionFlagsBits[name],0n).toString();
export const workspaceViewerIdentity=req=>req[requestIdentity]?{userId:req[requestIdentity].user,csrf:req[requestIdentity].csrf}:null;
export const workspaceIdentity=req=>['workspace','admin'].includes(req[requestIdentity]?.role)?req[requestIdentity]:null;

export async function createWorkspacePlatform({config,client,fetchImpl=fetch,runtimeFactory=createWorkspaceRuntime}) {
  const app=express();if(config.trustProxyHops)app.set('trust proxy',config.trustProxyHops);
  const root=path.join(path.dirname(config.operationsFile),'workspaces');
  const registry=new WorkspaceStore(path.join(root,'registry.json'));await registry.init();
  const login=createWorkspaceLogin({config,fetchImpl});
  const runtimes=new Map(),loading=new Map(),buses=new Map(),pendingOwner=new Map(),pendingNaver=new Map(),checks=new Map(),failures=new Map();
  const participantLinks=new Map(),participantLinkLoading=new Map(),pendingParticipantNaver=new Map();
  let closed=false,legacy;
  const prune=()=>{for(const map of [pendingOwner,pendingNaver,pendingParticipantNaver,checks])for(const [key,v]of map)if(v.expires<=Date.now())map.delete(key);};
  async function identityFor(target,guildId){
    if(closed)throw workspaceError('서비스가 재시작 중입니다.',503);
    if(participantLinks.has(guildId))return participantLinks.get(guildId);
    if(participantLinkLoading.has(guildId))return participantLinkLoading.get(guildId);
    // Only real runtime contexts have a private data directory. Keep custom
    // runtime adapters compatible without inventing an identity store path.
    if(!target.context?.config?.operationsFile)return null;
    const task=(async()=>{
      const store=new ParticipantNaverLinkStore(path.join(path.dirname(target.context.config.operationsFile),'participant-identities.json'));
      store.setObserver(event=>target.context.runtimeHealth?.recordPersistence(event));
      await store.init();
      if(closed){await store.flush();throw workspaceError('서비스가 재시작 중입니다.',503);}
      const service=createParticipantNaverLinkService({config,guildId,store,fetchImpl});
      const value={store,service};participantLinks.set(guildId,value);return value;
    })();
    participantLinkLoading.set(guildId,task);
    try{return await task;}finally{participantLinkLoading.delete(guildId);}
  }
  async function membership(userId,guildId,{fresh=false}={}) {
    if(!discordId(userId)||!discordId(guildId)||!client.guilds.cache.has(guildId))throw workspaceError('봇이 있는 Discord 서버를 선택하세요.');
    const key=userId+':'+guildId;prune();const cached=checks.get(key);
    if(cached?.pending)return cached.pending;
    if(!fresh&&cached?.value)return cached.value;
    if(checks.size>=5000&&!checks.has(key))throw workspaceError('잠시 후 다시 시도하세요.',429);
    const pending=(async()=>{
      try{
        const guild=await client.guilds.fetch(guildId),member=await guild.members.fetch({user:userId,force:true});
        if(!member||member.user?.bot)throw Error('member');
        const value={guildId,name:String(guild.name||'').slice(0,100),manager:guild.ownerId===userId||member.permissions.has(PermissionFlagsBits.ManageGuild)};
        checks.set(key,{value,expires:Date.now()+15000});return value;
      }catch{checks.delete(key);throw workspaceError('현재 Discord 서버의 접근 권한을 확인할 수 없습니다.');}
    })();checks.set(key,{pending,expires:Date.now()+15000});return pending;
  }
  async function authorize(req,guildId,manager=false,fresh=false) {
    if(closed)throw workspaceError('서비스가 재시작 중입니다.',503);
    const auth=login.session(req);if(!auth)throw workspaceError('Discord 로그인이 필요합니다.',401);
    const member=await membership(auth.userId,guildId,{fresh:fresh||req.method!=='GET'});
    // A logout/relogin during the Discord request revokes this exact session,
    // even when the same Discord user later logs in again.
    if(closed||login.session(req)!==auth)throw workspaceError('Discord 로그인을 다시 확인하세요.',401);
    if(manager&&!member.manager)throw workspaceError('이 서버의 운영자 권한이 필요합니다.');
    if(registry.find(guildId)?.disabled)throw workspaceError('사용이 중지된 서버입니다.');
    req[requestIdentity]={role:member.manager?'workspace':'participant',user:auth.userId,guildId,csrf:auth.csrf};
    return {auth,member};
  }
  async function runtimeFor(guildId) {
    if(closed)throw workspaceError('서비스가 재시작 중입니다.',503);
    const entry=registry.find(guildId);
    if(entry?.disabled)throw workspaceError('사용이 중지된 서버입니다.');
    if(guildId===config.guildId&&legacy){await identityFor(legacy,guildId);return legacy;}
    if(runtimes.has(guildId))return runtimes.get(guildId);
    if(loading.has(guildId))return loading.get(guildId);
    if(!entry)throw workspaceError('운영자가 먼저 서버를 연결해야 합니다.',409);
    if(failures.get(guildId)?.retryAfter>Date.now())throw workspaceError('이 방송 공간은 제작자 점검이 필요합니다.',503);
    if(runtimes.size+loading.size>=25)throw workspaceError('새 서버 준비는 제작자에게 문의하세요.',503);
    const promise=(async()=>{
      const bus=new EventEmitter();buses.set(guildId,bus);
      try{const value=await runtimeFactory({baseConfig:config,entry,root,client,interactionBus:bus,authenticate:workspaceIdentity,viewerAuthenticate:workspaceViewerIdentity,operationGuard:()=>{if(closed||registry.find(guildId)?.disabled)throw workspaceError('방송 운영이 중지되었습니다.',503);legacy?.runtime.operationGuard();}});try{await identityFor(value,guildId);}catch(error){await value.close?.().catch(()=>{});throw error;}runtimes.set(guildId,value);failures.delete(guildId);return value;}
      catch(error){buses.delete(guildId);failures.set(guildId,{retryAfter:Date.now()+30000});legacy?.context.runtimeHealth?.recordIncident({severity:'error',source:'storage',code:'workspace_start_failed',summary:'방송 공간 시작 실패',detail:'서버별 제작자 점검이 필요합니다.'});throw error;}
      finally{loading.delete(guildId);}
    })();loading.set(guildId,promise);return promise;
  }
  const onInteraction=interaction=>{
    const bus=buses.get(interaction.guildId);if(bus){bus.emit(Events.InteractionCreate,interaction);return;}
    if(interaction.guildId&&interaction.guildId!==config.guildId&&interaction.isChatInputCommand?.())interaction.reply({content:'서버 운영자가 사용자 홈에서 이 서버를 먼저 연결해 주세요.',flags:64,allowedMentions:{parse:[]}}).catch(()=>{});
  };
  client.on(Events.InteractionCreate,onInteraction);
  app.use((req,res,next)=>{res.set({'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});next();});
  app.use('/portal/auth',login.router);
  app.get(['/portal','/portal/'],(_req,res)=>res.sendFile('portal.html',{root:publicDir}));
  for(const file of ['portal.js','portal.css','practice-model.js','portal-card-flip.js','portal-features.js','portal-lottery.js','portal-alert.js'])app.get('/portal/'+file,(_req,res)=>res.sendFile(file,{root:publicDir}));
  app.get('/portal/api/servers',(req,res)=>{
    const auth=login.session(req);if(!auth)return res.status(401).json({error:'Discord 로그인이 필요합니다.'});
    res.json({servers:auth.guilds.map(g=>({...g,botPresent:client.guilds.cache.has(g.id),prepared:g.id===config.guildId||Boolean(registry.find(g.id))})),
      installUrl:`https://discord.com/oauth2/authorize?client_id=${config.clientId}&scope=bot%20applications.commands&permissions=${installPermissions}&integration_type=0`});
  });
  app.post('/portal/api/servers/:guildId',express.json({limit:'4kb'}),async(req,res,next)=>{try{
    legacy?.runtime.operationGuard();
    login.checkMutation(req);const {auth,member}=await authorize(req,req.params.guildId,true);
    if(!registry.find(member.guildId)&&registry.read().workspaces.length>=25)throw workspaceError('새 서버 추가는 제작자에게 문의하세요.',503);
    await registry.ensure({guildId:member.guildId,userId:auth.userId,name:member.name});await runtimeFor(member.guildId);
    res.json({ok:true,guildId:member.guildId});
  }catch(error){next(error);}});
  app.get('/portal/api/servers/:guildId',async(req,res,next)=>{try{
    const {member}=await authorize(req,req.params.guildId),target=await runtimeFor(member.guildId);
    const hiddenPages=member.manager?[...(target.context.featureVisibilityStore?.read().hidden.operator||[])]:[];
    res.json({guildId:member.guildId,name:member.name,role:member.manager?'operator':'participant',...(member.manager?{hiddenPages}:{})});
  }catch(error){next(error);}});

  // Creator sessions are verified by the original dashboard; portal roles can
  // never grant this identity, even if they manage every Discord server.
  app.use('/creator',(req,res,next)=>{
    const identity=legacy?.runtime.creatorIdentity(req);
    if(identity?.role!=='admin')return res.status(403).json({error:'제작자 계정으로 로그인하세요.'});
    req[requestIdentity]=identity;next();
  });
  app.get(['/creator','/creator/'],(_req,res)=>res.sendFile('workspace-admin.html',{root:publicDir}));
  app.get('/creator/workspace-admin.js',(_req,res)=>res.sendFile('workspace-admin.js',{root:publicDir}));
  app.get('/creator/api/workspaces',(_req,res)=>{
    const list=registry.publicList();if(!list.some(w=>w.guildId===config.guildId))list.unshift({guildId:config.guildId,name:'제작자 방송',disabled:false});
    res.json({workspaces:list.map(w=>({...w,status:failures.has(w.guildId)?'blocked':w.guildId===config.guildId||runtimes.has(w.guildId)?'ready':'pending'}))});
  });
  app.use('/creator/workspaces/:guildId',async(req,res,next)=>{try{
    if(!discordId(req.params.guildId)||!req.path.startsWith('/api/'))throw workspaceError('지원하지 않는 제작자 경로입니다.',404);
    const target=await runtimeFor(req.params.guildId);
    return target.runtime.app(req,res,next);
  }catch(error){next(error);}});

  // External callbacks use a single registered URL. Resolve only a nonce already issued
  // by this process, never a caller-supplied workspace ID.
  app.get('/oauth/chzzk/:action',async(req,res,next)=>{try{
    if(!['start','callback'].includes(req.params.action))return next();
    const value=req.params.action==='start'?req.query.ticket:req.query.state;
    if(typeof value!=='string'||value.length>100)return next();
    const key=hash(value),mapName=req.params.action==='start'?'tickets':'states';
    const candidates=[...runtimes.values(),...(legacy?[legacy]:[])];
    const target=candidates.find(r=>r.context.chzzkVerification?.[mapName].has(key));
    if(!target)return next();
    const service=target.context.chzzkVerification,item=service[mapName].get(key);
    prune();
    if(item.kind==='owner'){
      const pending=pendingOwner.get(key),auth=login.session(req);
      // Legacy creator OAuth is still handled by the existing creator dashboard.
      if(!pending){if(target===legacy)return next();throw workspaceError('운영 화면에서 연결을 다시 시작하세요.');}
      if(!auth||auth.userId!==pending.userId)throw workspaceError('연결을 시작한 운영자 계정으로 로그인하세요.');
      await authorize(req,pending.guildId,true,true);
      if(req.params.action==='start'){
        const start=service.start(value),state=new URL(start.url).searchParams.get('state');
        pendingOwner.delete(key);pendingOwner.set(hash(state),pending);
        res.cookie(`__Secure-chzzk-oauth-${pending.guildId}`,start.cookie,{httpOnly:true,secure:true,sameSite:'lax',path:'/oauth/chzzk/callback',maxAge:600000});
        return res.redirect(303,start.url);
      }
      pendingOwner.delete(key);
    }
    return target.runtime.app(req,res,next);
  }catch(error){next(error);}});
  app.get('/naver/callback',async(req,res,next)=>{try{
    prune();const key=hash(req.query.state),pending=pendingNaver.get(key);if(!pending)return next();
    const auth=login.session(req);if(!auth||auth.userId!==pending.userId)throw workspaceError('연결을 시작한 운영자 계정으로 로그인하세요.');
    await authorize(req,pending.guildId,true,true);legacy?.runtime.operationGuard();pendingNaver.delete(key);
    const target=await runtimeFor(pending.guildId);return target.runtime.app(req,res,next);
  }catch(error){next(error);}});

  app.get('/naver/participant/callback',async(req,res)=>{
    try{
      const localDemo=config.demo===true&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
      if(!req.secure&&!localDemo)throw workspaceError('HTTPS 주소에서 연결을 다시 시작하세요.',403);
      prune();
      if(typeof req.query.state!=='string')throw workspaceError('연결 요청을 다시 시작하세요.',400);
      const key=hash(req.query.state),pending=pendingParticipantNaver.get(key),auth=login.session(req);
      if(!pending||!auth||auth!==pending.auth)throw workspaceError('연결을 시작한 브라우저에서 다시 로그인하세요.',403);
      await authorize(req,pending.guildId,false,true);
      const target=await runtimeFor(pending.guildId),identity=await identityFor(target,pending.guildId);
      if(!identity)throw workspaceError('참가자 연결을 준비하지 못했습니다.',503);
      const guard=()=>{
        if(closed||login.session(req)!==auth||registry.find(pending.guildId)?.disabled)throw workspaceError('현재 로그인과 서버 접근을 다시 확인하세요.',403);
        legacy?.runtime.operationGuard();target.runtime.operationGuard();
      };
      pendingParticipantNaver.delete(key);
      await identity.service.complete({state:req.query.state,code:req.query.code,error:req.query.error,userId:auth.userId,sessionBinding:auth.csrf,guard,
        reauthorize:async()=>{checks.delete(auth.userId+':'+pending.guildId);await authorize(req,pending.guildId,false,true);guard();}});
      return res.redirect(303,`/w/${pending.guildId}/viewer/`);
    }catch(error){
      const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=504?error.status:503;
      return res.status(status).type('html').send('<!doctype html><html lang="ko"><meta charset="utf-8"><title>계정 연결 확인</title><h1>계정 연결을 완료하지 못했습니다.</h1><p>사용자 홈에서 로그인과 연결 상태를 확인한 뒤 다시 시작해 주세요.</p><a href="/portal/">사용자 홈으로 돌아가기</a></html>');
    }
  });

  // Card pictures (up to 1 MB, sent as base64 JSON) are the only larger workspace request body.
  const smallJson=express.json({limit:'128kb'}),cardImageJson=express.json({limit:'1500kb'});
  app.use('/w/:guildId',(req,res,next)=>(req.method==='POST'&&req.path==='/api/card-flip/image'?cardImageJson:smallJson)(req,res,next));
  app.use('/w/:guildId',async(req,res,next)=>{try{
    const guildId=req.params.guildId;
    if(!discordId(guildId))throw workspaceError('서버 주소가 올바르지 않습니다.',400);
    if(req.path==='/broadcast'||req.path.startsWith('/broadcast/')){
      if(req.method!=='GET')throw workspaceError('지원하지 않는 방송 요청입니다.');
      const target=await runtimeFor(guildId),expected=Buffer.from(target.context.config.broadcastToken||''),supplied=Buffer.from(String(req.query.token||req.get('X-Broadcast-Token')||''));
      const publicAsset=/^\/broadcast\/(?:assets\/|[a-z-]+\.(?:js|css)$)/.test(req.path);
      if(!publicAsset&&(!expected.length||expected.length!==supplied.length||!timingSafeEqual(expected,supplied)))throw workspaceError('방송 화면 접근 토큰이 올바르지 않습니다.');
      if(await workspaceAsset(req,res,guildId))return;
      return target.runtime.app(req,res,next);
    }
    // Express accepts a trailing slash and case variants for these routes.
    // Apply the same fresh authorization to every spelling of the handler.
    const accessPath=req.path.replace(/\/+$/,'').toLowerCase();
    const {auth,member}=await authorize(req,guildId,!(req.path==='/viewer'||req.path.startsWith('/viewer/')),['/readiness','/call-settings','/intake-settings','/api/roulette','/viewer/api/participation','/viewer/api/account-link'].includes(accessPath));
    const target=await runtimeFor(guildId),ctx=target.context;
    // Features the streamer hid are refused on the server, not only removed from the menu.
    if(hiddenFeatureFor(ctx.featureVisibilityStore?.read().hidden,{method:req.method,path:req.path,query:req.query}))throw workspaceError('스트리머가 숨긴 기능입니다. 설정 → 기능 숨기기에서 다시 켤 수 있어요.',403);
    if(req.path==='/readiness'&&req.method==='GET'){
      let paused=false;try{legacy?.runtime.operationGuard();target.runtime.operationGuard();}catch{paused=true;}
      return res.json(buildWorkspaceReadiness({context:ctx,paused}));
    }
    if(req.method!=='GET'){legacy?.runtime.operationGuard();login.checkMutation(req,auth);target.runtime.operationGuard();}
    if(accessPath==='/viewer/api/account-link'||accessPath.startsWith('/viewer/api/account-link/')){
      const identity=await identityFor(target,guildId);
      if(!identity)throw workspaceError('참가자 연결을 준비하지 못했습니다.',503);
      const guard=()=>{
        if(closed||login.session(req)!==auth||registry.find(guildId)?.disabled)throw workspaceError('현재 로그인과 서버 접근을 다시 확인하세요.',403);
        legacy?.runtime.operationGuard();target.runtime.operationGuard();
      };
      if(accessPath==='/viewer/api/account-link'&&req.method==='GET')return res.json(identity.service.status(auth.userId));
      if(req.method!=='POST')throw workspaceError('지원하지 않는 계정 연결 요청입니다.',404);
      const input=req.body;
      const field=accessPath==='/viewer/api/account-link/start'?'consent':accessPath==='/viewer/api/account-link/disconnect'?'confirm':null;
      if(!field)throw workspaceError('지원하지 않는 계정 연결 요청입니다.',404);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||!Object.hasOwn(input,'revision')||input[field]!==true)throw workspaceError('현재 화면에서 본인 계정 연결을 확인해 주세요.',400);
      guard();
      if(field==='confirm'){
        const result=await identity.service.disconnect({userId:auth.userId,revision:input.revision,guard});
        for(const [key,pending]of pendingParticipantNaver)if(pending.guildId===guildId&&pending.auth.userId===auth.userId)pendingParticipantNaver.delete(key);
        return res.json(result);
      }
      prune();if(pendingParticipantNaver.size>=2000)throw workspaceError('잠시 후 다시 시도하세요.',429);
      const result=identity.service.begin({userId:auth.userId,sessionBinding:auth.csrf,revision:input.revision,consent:true,guard});
      for(const [key,pending]of pendingParticipantNaver)if(pending.guildId===guildId&&pending.auth.userId===auth.userId)pendingParticipantNaver.delete(key);
      pendingParticipantNaver.set(hash(new URL(result.url).searchParams.get('state')),{guildId,auth,expires:result.expiresAt});
      return res.json(result);
    }
    if(req.path==='/call-settings'&&req.method==='GET'){
      if(!ctx.callSettings)throw workspaceError('호출 설정을 준비하지 못했습니다. 잠시 후 다시 시도하세요.',503);
      return res.json(ctx.callSettings.snapshot());
    }
    if(req.path==='/call-settings'&&req.method==='POST'){
      const result=await saveWorkspaceCallSettings({store:ctx.callSettings,calls:ctx.participationCalls,input:req.body,
        guard:()=>{legacy?.runtime.operationGuard();target.runtime.operationGuard();}});
      return res.json(result);
    }
    if(req.path==='/intake-settings'&&req.method==='GET')return res.json(readIntakeSettings(ctx.operations.read()));
    if(req.path==='/intake-settings'&&req.method==='POST'){
      const result=await saveIntakeSettings({operations:ctx.operations,input:req.body,
        guard:()=>{legacy?.runtime.operationGuard();target.runtime.operationGuard();}});
      return res.json(result);
    }
    if(req.path==='/settings'&&req.method==='GET')return res.json({settings:{naverCafeId:ctx.config.naverCafeId,naverMenuId:ctx.config.naverMenuId,naverMemoMenuId:ctx.config.naverMemoMenuId}});
    if(req.path==='/settings'&&req.method==='POST'){
      const input=req.body;
      if(guildId===config.guildId&&!registry.find(guildId))await registry.ensure({guildId,userId:auth.userId,name:member.name});
      await registry.configure(guildId,input);Object.assign(ctx.config,input);return res.json({ok:true});
    }
    if(req.path==='/live-settings'&&req.method==='GET')return res.json({settings:ctx.chzzkLiveMonitor.summary().settings});
    if(req.path==='/live-settings'&&req.method==='POST'){
      const body=req.body;
      if(!body||Object.keys(body).some(k=>!['enabled','intervalMinutes','discordAlerts'].includes(k))||typeof body.enabled!=='boolean'||typeof body.discordAlerts!=='boolean'||![1,2,5,10,15].includes(body.intervalMinutes))throw workspaceError('방송 감지 설정을 확인하세요.',400);
      const channelId=ctx.chzzkVerification?.targetChannelId();
      if(body.enabled&&(!ctx.chzzkVerification?.summary().ownerConnected||!channelId))throw workspaceError('이 서버의 방송 계정을 먼저 연결하세요.',409);
      await ctx.chzzkLiveMonitor.store.update(state=>{
        if(channelId&&state.settings.channelId!==channelId){state.currentLive=null;state.monitor={baselineReady:false,lastKnownLive:null};}
        state.settings={...state.settings,...body,channelId:channelId||state.settings.channelId};
      });
      return res.json({settings:ctx.chzzkLiveMonitor.summary().settings});
    }
    if(req.path==='/obs'&&req.method==='GET'){const url=new URL(`/w/${guildId}/broadcast/overlay`,config.publicBaseUrl),donation=new URL(`/w/${guildId}/broadcast/donation-roulette`,config.publicBaseUrl),chat=new URL(`/w/${guildId}/broadcast/chat`,config.publicBaseUrl),lottery=new URL(`/w/${guildId}/broadcast/lottery-board`,config.publicBaseUrl),alert=new URL(`/w/${guildId}/broadcast/donation-alert`,config.publicBaseUrl);for(const item of [url,donation,chat,lottery,alert])item.searchParams.set('token',ctx.config.broadcastToken);return res.json({url:url.href,donationRouletteUrl:donation.href,chatUrl:chat.href,lotteryBoardUrl:lottery.href,donationAlertUrl:alert.href});}
    if(req.path.startsWith('/viewer/api/'))return target.runtime.app(req,res,next);
    if(await workspaceAsset(req,res,guildId))return;
    if(req.path==='/api/naver/oauth/start'&&req.method==='POST'){
      if(pendingNaver.size>=2000)throw workspaceError('잠시 후 다시 시도하세요.',429);
      const result=ctx.naver.beginOAuth(),state=new URL(result.url).searchParams.get('state');
      pendingNaver.set(hash(state),{guildId,userId:auth.userId,expires:Date.now()+600000});return res.json(result);
    }
    if(req.path==='/api/chzzk/verification/owner/start'&&req.method==='POST'){
      if(!ctx.chzzkVerification)throw workspaceError('제작자가 CHZZK 연결을 준비 중입니다.',503);
      if(pendingOwner.size>=2000)throw workspaceError('잠시 후 다시 시도하세요.',429);
      const result=ctx.chzzkVerification.begin('owner'),ticket=new URL(result.url).searchParams.get('ticket');
      pendingOwner.set(hash(ticket),{guildId,userId:auth.userId,expires:Date.now()+600000});return res.json(result);
    }
    if(req.path.startsWith('/api/')){
      if(!member.manager||!workspaceRouteAllowed(req.method,req.path))throw workspaceError('제작자 전용 기능이거나 지원하지 않는 작업입니다.');
      // The private request identity carries the verified session CSRF into the app.
      return target.runtime.app(req,res,next);
    }
    throw workspaceError('지원하지 않는 사용자 화면입니다.',404);
  }catch(error){next(error);}});
  app.use(['/portal','/w','/creator'],(_req,res)=>res.status(404).json({error:'지원하지 않는 화면입니다.'}));
  app.use((error,_req,res,_next)=>res.status(error.status||503).json({error:error.status?error.message:'요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.'}));
  return {app,registry,login,membership,authorize,runtimeFor,
    registerLegacy(value){legacy=value;Object.assign(value.context.config,registry.find(config.guildId)?.settings||{});},
    async start(){if(legacy)await identityFor(legacy,config.guildId);for(const entry of registry.read().workspaces)if(!entry.disabled&&entry.guildId!==config.guildId)await runtimeFor(entry.guildId).catch(()=>{});},
    async tick(){const results=await Promise.allSettled([...runtimes.values()].map(t=>t.runtime.tick()));if(results.some(r=>r.status==='rejected'))throw workspaceError('일부 방송의 예약 작업을 확인하세요.',503);},
    beginShutdown(){closed=true;pendingParticipantNaver.clear();for(const identity of participantLinks.values())identity.service.close();for(const target of runtimes.values())target.runtime.beginShutdown('platform-shutdown');},
    async close(){closed=true;pendingParticipantNaver.clear();client.off(Events.InteractionCreate,onInteraction);for(const identity of participantLinks.values())identity.service.close();await Promise.allSettled([...loading.values(),...participantLinkLoading.values()]);const results=await Promise.allSettled([...runtimes.values()].map(t=>t.close()));const identityResults=await Promise.allSettled([...participantLinks.values()].map(item=>item.store.flush()));await registry.flush();if([...results,...identityResults].some(r=>r.status==='rejected'))throw workspaceError('일부 방송 데이터 저장을 확인하세요.',503);}
  };
}
