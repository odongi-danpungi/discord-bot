import { communityFor,communityView } from './community.js';
import express from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateAvatar,DEFAULT_AVATAR} from '../public/avatar.js';
import {createIdempotencyGuard} from './idempotency.js';
import { buildParticipantSelfServiceState, performParticipantSelfServiceAction } from './participant-self-service.js';
import {readyCheckView,answerReadyCheck} from './ready-check.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function createViewerAuth(){
 const codes=new Map(),sessions=new Map();
 const prune=()=>{for(const map of [codes,sessions])for(const [key,v] of map)if(v.expires<Date.now())map.delete(key)};
 return {issue(userId){prune();if(codes.size>=1000)throw Error('잠시 후 다시 시도해 주세요.');for(const [k,v] of codes)if(v.userId===userId)codes.delete(k);const code=randomBytes(18).toString('base64url');codes.set(hash(code),{userId,expires:Date.now()+600000});return code},exchange(code){prune();const key=hash(String(code)),v=codes.get(key);if(!v)return null;codes.delete(key);for(const [k,s] of sessions)if(s.userId===v.userId)sessions.delete(k);if(sessions.size>=10000)return null;const token=randomBytes(32).toString('base64url'),session={userId:v.userId,csrf:randomBytes(24).toString('hex'),expires:Date.now()+43200000};sessions.set(hash(token),session);return {token,session}},get(token){prune();return sessions.get(hash(token||''))},logout(token){sessions.delete(hash(token||''))}};
}
export function createViewerRouter({config,store,operations,viewerAuth,broadcastOps=null,participationQueue=null,participationCalls=null,emergencyState=()=>({locked:false}),readyCheckGuard=()=>{}}){
 const router=express.Router(),attempts=new Map(),loginIdempotency=createIdempotencyGuard({ttlMs:2*60*1000,recentDuplicateMs:0,maxEntries:512}),sessionIdempotency=createIdempotencyGuard({ttlMs:2*60*1000,recentDuplicateMs:1000,maxEntries:1024});
 router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});if(config.host==='127.0.0.1'&&!['localhost','127.0.0.1'].includes((req.get('host')||'').split(':')[0]))return res.sendStatus(403);next()});
  router.use(express.json({limit:'8kb'}));
 router.get('/api/mode',(_req,res)=>res.json({demo:Boolean(config.demo)}));
 if(config.demo)router.post('/api/demo-login',loginIdempotency.middleware({scope:req=>`viewer-login:${req.ip||'local'}`}),(req,res)=>{
   if(!req.is('application/json')||req.get('Sec-Fetch-Site')==='cross-site')return res.sendStatus(403);
   const person=store.read().find(r=>r.guildId===config.guildId);if(!person)return res.status(400).json({error:'연습 참가자가 없습니다.'});
   const result=viewerAuth.exchange(viewerAuth.issue(person.discordId));
   res.setHeader('Set-Cookie',`dd_viewer=${result.token}; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=43200`);res.json({ok:true});
 });
 router.post('/api/login',loginIdempotency.middleware({scope:req=>`viewer-login:${req.ip||'local'}`}),(req,res)=>{const now=Date.now();for(const [key,a] of attempts)if(a.until<now)attempts.delete(key);const ip=req.ip||'local',a=attempts.get(ip)||{count:0,until:now+60000};if(attempts.size>=1000&&!attempts.has(ip))return res.sendStatus(429);if(++a.count>10)return res.status(429).json({error:'1분 후 다시 시도해 주세요.'});attempts.set(ip,a);if(req.get('Sec-Fetch-Site')==='cross-site'||!req.is('application/json'))return res.sendStatus(403);const result=viewerAuth.exchange(req.body?.code);if(!result)return res.status(401).json({error:'코드가 만료되었거나 사용되었습니다. Discord에서 다시 발급해 주세요.'});const secure=(config.viewerUrl||config.publicBaseUrl)?.startsWith('https:')?'; Secure':'';res.setHeader('Set-Cookie',`dd_viewer=${result.token}; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=43200${secure}`);res.json({ok:true})});
 const viewerToken=req=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('dd_viewer='))?.slice(10)||'';
 // Run replay protection before session validation. A successful logout invalidates its
 // session immediately, so a network retry must be able to replay the first response
 // instead of failing with 401 and tempting the client to repeat the mutation manually.
 router.use('/api',(req,res,next)=>{
   if(req.method==='GET')return next();
   if(!req.is('application/json')||req.get('Sec-Fetch-Site')==='cross-site')return res.sendStatus(403);
   const session=viewerAuth.get(viewerToken(req));
   if(session&&req.get('X-CSRF-Token')!==session.csrf)return res.sendStatus(403);
   next();
 });
 router.use('/api',sessionIdempotency.middleware({scope:req=>`viewer-session:${hash(viewerToken(req))}:${hash(req.get('X-CSRF-Token')||'')}`}));
 router.use('/api',(req,res,next)=>{const token=viewerToken(req),session=viewerAuth.get(token);if(!session)return res.status(401).json({error:'Discord에서 시청자 대시보드 로그인 코드를 다시 발급받아 주세요.'});req.viewer=session;req.viewerToken=token;if(req.method!=='GET'&&(!req.is('application/json')||req.get('X-CSRF-Token')!==session.csrf||req.get('Sec-Fetch-Site')==='cross-site'))return res.sendStatus(403);next()});
 router.use('/api',(req,res,next)=>{if(req.method==='GET'||req.path==='/logout')return next();const emergency=emergencyState?.()||{};if(!emergency.locked)return next();return res.status(423).json({error:'방송 운영이 긴급 잠금 상태입니다. 잠금 해제 후 다시 시도해 주세요.',code:'EMERGENCY_LOCKED'});});
 const profile=id=>store.read().find(r=>r.guildId===config.guildId&&r.discordId===id);
 router.get('/api/me',(req,res)=>{const r=profile(req.viewer.userId);if(!r)return res.status(403).json({error:'먼저 /연동으로 게임 정보를 등록해 주세요.'});const saved=(operations.read().avatars||[]).find(a=>a.userId===r.discordId);res.json({name:r.chzzkName,userId:r.discordId,avatar:saved?.avatar||DEFAULT_AVATAR,revision:saved?.revision||0,csrf:req.viewer.csrf})});
 router.post('/api/avatar',async(req,res,next)=>{try{if(!profile(req.viewer.userId))return res.sendStatus(403);const avatar=validateAvatar(req.body);let saved;await operations.update(state=>{state.avatars??=[];const old=state.avatars.find(a=>a.userId===req.viewer.userId);if((old?.revision||0)!==req.body.revision){const e=Error('다른 창에서 수정됐습니다. 새로고침해 주세요.');e.statusCode=409;throw e}saved={userId:req.viewer.userId,avatar,revision:(old?.revision||0)+1};state.avatars=state.avatars.filter(a=>a.userId!==req.viewer.userId);state.avatars.push(saved)});res.json(saved)}catch(e){next(e)}});
 router.get('/api/participation',(req,res)=>{const r=profile(req.viewer.userId);if(!r)return res.status(403).json({error:'먼저 /연동으로 게임 정보를 등록해 주세요.'});res.json(buildParticipantSelfServiceState({operationsState:operations.read(),queueSummary:participationQueue?.summary?.()||{},userId:req.viewer.userId,profile:r,now:Date.now()}));});
 router.post('/api/participation/action',async(req,res,next)=>{try{if(req.body.expectedSessionId&&req.body.expectedSessionId!==operations.read().session?.id)throw Object.assign(Error('이 모집은 종료되었습니다. 최신 모집 링크를 이용하세요.'),{statusCode:409});const r=profile(req.viewer.userId);const records=store.read().filter(item=>item.guildId===config.guildId);const result=await performParticipantSelfServiceAction({action:String(req.body?.action||''),game:req.body?.game,userId:req.viewer.userId,profile:r,operations,participationQueue,participationCalls,records,now:Date.now()});res.json(result);}catch(e){next(e)}});
 router.get('/api/ready-check',(req,res)=>res.json(readyCheckView({operationsState:operations.read(),queue:participationQueue?.summary?.()||{},userId:req.viewer.userId})));
 router.post('/api/ready-check',async(req,res,next)=>{try{readyCheckGuard();await answerReadyCheck({operations,queue:participationQueue?.summary?.()||{},checkId:req.body.checkId,userId:req.viewer.userId});res.json(readyCheckView({operationsState:operations.read(),queue:participationQueue?.summary?.()||{},userId:req.viewer.userId}));}catch(e){next(e);}});
 router.get('/api/community',(req,res)=>res.json(communityView(operations,req.viewer.userId)));
 router.post('/api/community/:action',async(req,res,next)=>{try{
   const service=communityFor({operations,config});
   if(req.params.action==='subscribe')await service.subscribe(req.viewer.userId,req.body);
   else if(req.params.action==='ticket')await service.ticket(req.viewer.userId,req.body);
   else throw Error('지원하지 않는 작업입니다.');
   res.json(communityView(operations,req.viewer.userId));
 }catch(e){next(e);}});
 router.get('/api/poll',(req,res)=>{const summary=broadcastOps?.summary?.({operationsState:operations.read()})||{};const poll=summary.activePoll;if(!poll)return res.json({poll:null});const voter=hash(req.viewer.userId),choice=poll.options.find(option=>option.votes.includes(voter))?.id||null;res.json({poll:{id:poll.id,question:poll.question,options:poll.options.map(option=>({id:option.id,label:option.label,votes:option.votes.length})),createdAt:poll.createdAt},choice});});
 router.post('/api/poll/vote',async(req,res,next)=>{try{if(!broadcastOps)throw Object.assign(Error('방송 투표 기능이 초기화되지 않았습니다.'),{statusCode:503});const result=await broadcastOps.votePoll(req.body.pollId,req.body.optionId,hash(req.viewer.userId));const voter=hash(req.viewer.userId),choice=result.options.find(option=>option.votes.includes(voter))?.id||null;res.json({poll:{id:result.id,question:result.question,options:result.options.map(option=>({id:option.id,label:option.label,votes:option.votes.length})),createdAt:result.createdAt},choice});}catch(e){next(e)}});
 router.post('/api/logout',(req,res)=>{viewerAuth.logout(req.viewerToken);res.setHeader('Set-Cookie','dd_viewer=; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=0');res.json({ok:true})});
 for(const [url,file] of [['/','viewer.html'],['/viewer.js','viewer.js'],['/viewer.css','viewer.css'],['/avatar.js','avatar.js'],['/art.js','art.js'],['/community-viewer.js','community-viewer.js']])router.get(url,(_req,res)=>res.sendFile(fileURLToPath(new URL('../public/'+file,import.meta.url))));
 router.use((_req,res)=>res.sendStatus(404));router.use((e,_req,res,_next)=>res.status(e.statusCode||400).json({error:e.type?'요청 형식을 확인해 주세요.':e.message}));return router;
}
