import {randomBytes,createHash} from 'node:crypto';
import express from 'express';
import {fileURLToPath} from 'node:url';
import {authenticateDashboardBasic} from './dashboard-access.js';
const hash=v=>createHash('sha256').update(String(v)).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const cookie=(req,name)=>String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
export function createDashboardSessions({config,now=Date.now}={}){
 const sessions=new Map(),challenges=new Map(),attempts=new Map();
 const fingerprint=()=>hash(JSON.stringify([config.dashboardUser,config.dashboardPassword,config.dashboardOperatorUser,config.dashboardOperatorPassword,config.dashboardOperatorCapabilities]));
 const prune=()=>{for(const m of [sessions,challenges,attempts])for(const [k,v] of m)if(v.expires<=now())m.delete(k);};
 const secure=req=>Boolean(req.secure);
 const transport=req=>secure(req)||(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)&&['localhost','127.0.0.1','[::1]'].includes(req.hostname));
 const setCookie=(req,res,name,value,maxAge)=>res.append('Set-Cookie',`${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure(req)?'; Secure':''}`);
 const sameOrigin=req=>req.get('Sec-Fetch-Site')!=='cross-site'&&(!req.get('Origin')||req.get('Origin')===`${req.protocol}://${req.get('host')}`);
 const identity=req=>{prune();const s=sessions.get(hash(cookie(req,'dd_admin')));if(!s||s.fingerprint!==fingerprint())return null;return s.identity;};
 const router=express.Router();
 router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});if(config.host==='127.0.0.1'&&!['localhost','127.0.0.1'].includes(req.hostname))return res.sendStatus(403);next();});
 router.get('/login',(_req,res)=>res.sendFile('login.html',{root:fileURLToPath(new URL('../public/',import.meta.url))}));
 for(const file of ['login.js','login.css'])router.get('/'+file,(_req,res)=>res.sendFile(file,{root:fileURLToPath(new URL('../public/',import.meta.url))}));
 router.get('/context',(req,res)=>{prune();if(!transport(req))return res.status(403).json({error:'HTTPS 주소로 접속해 주세요.'});if(challenges.size>=1000)return res.sendStatus(429);const value=token();challenges.set(hash(value),{expires:now()+300000});setCookie(req,res,'dd_login',value,300);const s=sessions.get(hash(cookie(req,'dd_admin'))),auth=identity(req);res.json({challenge:value,authenticated:Boolean(auth),csrf:auth?s?.csrf:null,redirect:auth?.role==='operator'?'/mobile-control.html':'/'});});
 router.use(express.json({limit:'8kb'}));
 router.post('/login',(req,res)=>{
  prune();if(!transport(req)||!sameOrigin(req)||!req.is('application/json'))return res.sendStatus(403);
  const challenge=cookie(req,'dd_login');if(!challenge||req.body?.challenge!==challenge||!challenges.has(hash(challenge)))return res.status(403).json({error:'로그인 화면을 새로고침해 주세요.'});
  challenges.delete(hash(challenge));const ip=req.ip,a=attempts.get(ip)||{count:0,expires:now()+60000};if(a.count>=10||(!attempts.has(ip)&&attempts.size>=1000))return res.status(429).json({error:'로그인 시도가 많습니다. 1분 후 다시 시도해 주세요.'});a.count++;attempts.set(ip,a);
  const user=typeof req.body?.user==='string'?req.body.user:'',password=typeof req.body?.password==='string'?req.body.password:'';
  if(!password||user.length>180||password.length>1024)return res.status(401).json({error:'사용자 이름과 비밀번호를 확인해 주세요.'});
  const auth=authenticateDashboardBasic('Basic '+Buffer.from(user+':'+password).toString('base64'),config);if(!auth)return res.status(401).json({error:'사용자 이름과 비밀번호를 확인해 주세요.'});
  if(sessions.size>=1000)return res.sendStatus(429);sessions.delete(hash(cookie(req,'dd_admin')));const value=token();sessions.set(hash(value),{identity:auth,csrf:token(),fingerprint:fingerprint(),expires:now()+8*60*60*1000});attempts.delete(ip);setCookie(req,res,'dd_admin',value,28800);setCookie(req,res,'dd_login','',0);res.json({ok:true,redirect:auth.role==='operator'?'/mobile-control.html':'/'});
 });
 router.post('/logout',(req,res)=>{const s=sessions.get(hash(cookie(req,'dd_admin')));if(!sameOrigin(req)||!req.is('application/json')||!s||req.get('X-CSRF-Token')!==s.csrf)return res.sendStatus(403);sessions.delete(hash(cookie(req,'dd_admin')));setCookie(req,res,'dd_admin','',0);res.json({ok:true});});
 return {router,identity,clear(){sessions.clear();challenges.clear();attempts.clear();}};
}
