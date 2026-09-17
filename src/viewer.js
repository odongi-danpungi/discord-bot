import express from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateAvatar,DEFAULT_AVATAR} from '../public/avatar.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function createViewerAuth(){
 const codes=new Map(),sessions=new Map();
 const prune=()=>{for(const map of [codes,sessions])for(const [key,v] of map)if(v.expires<Date.now())map.delete(key)};
 return {issue(userId){prune();if(codes.size>=1000)throw Error('잠시 후 다시 시도해 주세요.');for(const [k,v] of codes)if(v.userId===userId)codes.delete(k);const code=randomBytes(18).toString('base64url');codes.set(hash(code),{userId,expires:Date.now()+600000});return code},exchange(code){prune();const key=hash(String(code)),v=codes.get(key);if(!v)return null;codes.delete(key);for(const [k,s] of sessions)if(s.userId===v.userId)sessions.delete(k);if(sessions.size>=10000)return null;const token=randomBytes(32).toString('base64url'),session={userId:v.userId,csrf:randomBytes(24).toString('hex'),expires:Date.now()+43200000};sessions.set(hash(token),session);return {token,session}},get(token){prune();return sessions.get(hash(token||''))},logout(token){sessions.delete(hash(token||''))}};
}
export function createViewerRouter({config,store,operations,viewerAuth}){
 const router=express.Router(),attempts=new Map();
 router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});if(config.host==='127.0.0.1'&&!['localhost','127.0.0.1'].includes((req.get('host')||'').split(':')[0]))return res.sendStatus(403);next()});
  router.use(express.json({limit:'8kb'}));
 router.get('/api/mode',(_req,res)=>res.json({demo:Boolean(config.demo)}));
 if(config.demo)router.post('/api/demo-login',(req,res)=>{
   if(!req.is('application/json')||req.get('Sec-Fetch-Site')==='cross-site')return res.sendStatus(403);
   const person=store.read().find(r=>r.guildId===config.guildId);if(!person)return res.status(400).json({error:'연습 참가자가 없습니다.'});
   const result=viewerAuth.exchange(viewerAuth.issue(person.discordId));
   res.setHeader('Set-Cookie',`dd_viewer=${result.token}; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=43200`);res.json({ok:true});
 });
 router.post('/api/login',(req,res)=>{const now=Date.now();for(const [key,a] of attempts)if(a.until<now)attempts.delete(key);const ip=req.ip||'local',a=attempts.get(ip)||{count:0,until:now+60000};if(attempts.size>=1000&&!attempts.has(ip))return res.sendStatus(429);if(++a.count>10)return res.status(429).json({error:'1분 후 다시 시도해 주세요.'});attempts.set(ip,a);if(req.get('Sec-Fetch-Site')==='cross-site'||!req.is('application/json'))return res.sendStatus(403);const result=viewerAuth.exchange(req.body?.code);if(!result)return res.status(401).json({error:'코드가 만료되었거나 사용되었습니다. Discord에서 다시 발급해 주세요.'});const secure=config.viewerUrl?.startsWith('https:')?'; Secure':'';res.setHeader('Set-Cookie',`dd_viewer=${result.token}; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=43200${secure}`);res.json({ok:true})});
 router.use('/api',(req,res,next)=>{const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('dd_viewer='))?.slice(10),session=viewerAuth.get(token);if(!session)return res.status(401).json({error:'Discord에서 내 레이스 색상 코드를 발급받아 로그인해 주세요.'});req.viewer=session;req.viewerToken=token;if(req.method!=='GET'&&(!req.is('application/json')||req.get('X-CSRF-Token')!==session.csrf||req.get('Sec-Fetch-Site')==='cross-site'))return res.sendStatus(403);next()});
 const profile=id=>store.read().find(r=>r.guildId===config.guildId&&r.discordId===id);
 router.get('/api/me',(req,res)=>{const r=profile(req.viewer.userId);if(!r)return res.status(403).json({error:'먼저 /연동으로 게임 정보를 등록해 주세요.'});const saved=(operations.read().avatars||[]).find(a=>a.userId===r.discordId);res.json({name:r.chzzkName,userId:r.discordId,avatar:saved?.avatar||DEFAULT_AVATAR,revision:saved?.revision||0,csrf:req.viewer.csrf})});
 router.post('/api/avatar',async(req,res,next)=>{try{if(!profile(req.viewer.userId))return res.sendStatus(403);const avatar=validateAvatar(req.body);let saved;await operations.update(state=>{state.avatars??=[];const old=state.avatars.find(a=>a.userId===req.viewer.userId);if((old?.revision||0)!==req.body.revision){const e=Error('다른 창에서 수정됐습니다. 새로고침해 주세요.');e.statusCode=409;throw e}saved={userId:req.viewer.userId,avatar,revision:(old?.revision||0)+1};state.avatars=state.avatars.filter(a=>a.userId!==req.viewer.userId);state.avatars.push(saved)});res.json(saved)}catch(e){next(e)}});
 router.post('/api/logout',(req,res)=>{viewerAuth.logout(req.viewerToken);res.setHeader('Set-Cookie','dd_viewer=; HttpOnly; SameSite=Strict; Path=/viewer; Max-Age=0');res.json({ok:true})});
 for(const [url,file] of [['/','viewer.html'],['/viewer.js','viewer.js'],['/viewer.css','viewer.css'],['/avatar.js','avatar.js'],['/art.js','art.js']])router.get(url,(_req,res)=>res.sendFile(fileURLToPath(new URL('../public/'+file,import.meta.url))));
 router.use((_req,res)=>res.sendStatus(404));router.use((e,_req,res,_next)=>res.status(e.statusCode||400).json({error:e.type?'요청 형식을 확인해 주세요.':e.message}));return router;
}
