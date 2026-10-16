import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { discordId, workspaceError } from './workspace-policy.js';

const hash = v => createHash('sha256').update(String(v || '')).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const cookie = (req, name) => String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
const same = (a,b) => { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y); };

export function createWorkspaceLogin({ config, fetchImpl = fetch, now = Date.now }) {
  const sessions = new Map(), states = new Map(), attempts = new Map();
  const origin = new URL(config.publicBaseUrl).origin;
  const callbackUrl = origin + '/portal/auth/callback';
  const router = express.Router();
  function prune() { for (const map of [sessions,states,attempts]) for (const [key,value] of map) if (value.expires <= now()) map.delete(key); }
  const session = req => { prune();return sessions.get(hash(cookie(req,'dd_portal'))) || null; };
  const secure = req => req.secure || (config.demo && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress));
  const setCookie = (res,name,value,maxAge) => res.append('Set-Cookie',`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.demo?'':'; Secure'}`);
  async function discord(pathname, options = {}) {
    let response;
    try { response = await fetchImpl('https://discord.com/api/v10' + pathname, { ...options, redirect:'error', signal:AbortSignal.timeout(10000) }); }
    catch { throw workspaceError('Discord에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',502); }
    if (!response.ok) throw workspaceError(response.status===429?'Discord 요청이 많습니다. 잠시 후 다시 로그인하세요.':'Discord 로그인 정보를 확인하지 못했습니다.',response.status===429?429:502);
    const text = await response.text();
    if (text.length > 1024*1024) throw workspaceError('Discord 응답을 확인하지 못했습니다.',502);
    try { return JSON.parse(text); } catch { throw workspaceError('Discord 응답을 확인하지 못했습니다.',502); }
  }
  function checkMutation(req, auth = session(req)) {
    if (!secure(req) || !auth || req.get('Sec-Fetch-Site')==='cross-site' ||
      (req.get('Origin') && req.get('Origin')!==origin) || !req.is('application/json') || !same(req.get('X-CSRF-Token'),auth.csrf)) {
      throw workspaceError('다시 로그인한 뒤 화면에서 실행하세요.');
    }
    return auth;
  }
  router.use((req,res,next) => {res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});if(!secure(req))return res.status(403).json({error:'HTTPS 주소로 접속하세요.'});next();});
  router.get('/session',(req,res)=>{
    const auth=session(req);
    res.json(auth?{authenticated:true,user:{id:auth.userId,name:auth.name},guilds:auth.guilds,csrf:auth.csrf}:{authenticated:false,configured:Boolean(config.discordClientSecret)});
  });
  router.get('/login',(req,res,next)=>{try {
    prune();
    if (!config.discordClientSecret) throw workspaceError('제작자가 Discord 로그인을 준비 중입니다.',503);
    const key=req.ip, attempt=attempts.get(key)||{count:0,expires:now()+60000};
    if (attempt.count>=10 || (!attempts.has(key)&&attempts.size>=2000) || states.size>=2000) throw workspaceError('잠시 후 다시 로그인하세요.',429);
    attempt.count++;attempts.set(key,attempt);
    const targetServer=discordId(req.query.server)?req.query.server:'',targetSession=typeof req.query.session==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(req.query.session)?req.query.session:'';
    const state=random(), browser=random();states.set(hash(state),{browser:hash(browser),expires:now()+600000,targetServer,targetSession});
    setCookie(res,'dd_portal_login',browser,600);
    const url=new URL('https://discord.com/oauth2/authorize');
    for(const [name,value] of Object.entries({client_id:config.clientId,response_type:'code',redirect_uri:callbackUrl,scope:'identify guilds',state}))url.searchParams.set(name,value);
    res.redirect(303,url.href);
  } catch(error){next(error);}});
  router.get('/callback',async(req,res,next)=>{try {
    prune();const key=hash(req.query.state),state=states.get(key);
    if (!state || !same(state.browser,hash(cookie(req,'dd_portal_login')))) throw workspaceError('로그인 링크가 만료되었습니다. 다시 로그인하세요.',400);
    states.delete(key);setCookie(res,'dd_portal_login','',0);
    if(req.query.error || typeof req.query.code!=='string' || req.query.code.length>4096) throw workspaceError('Discord 로그인이 취소되었습니다.',400);
    const token=await discord('/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.discordClientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:callbackUrl})});
    if(typeof token.access_token!=='string'||token.token_type?.toLowerCase()!=='bearer')throw workspaceError('로그인 결과를 확인하지 못했습니다.',502);
    const headers={Authorization:`Bearer ${token.access_token}`};
    const user=await discord('/users/@me',{headers});
    if(!discordId(user.id))throw workspaceError('계정 확인에 실패했습니다.',502);
    const guilds=[];let after='';
    for(let page=0;page<10;page++){
      const items=await discord('/users/@me/guilds?limit=200'+(after?'&after='+after:''),{headers});
      if(!Array.isArray(items)||items.some(g=>!discordId(g.id)))throw workspaceError('서버 목록을 확인하지 못했습니다.',502);
      for(const g of items)guilds.push({id:g.id,name:String(g.name||'').slice(0,100)});
      if(items.length<200)break;
      if(page===9)throw workspaceError('서버 목록이 너무 많습니다. 제작자에게 문의하세요.',503);
      after=items.at(-1).id;
    }
    // OAuth tokens are used only for identity discovery; no token is retained in sessions or on disk.
    if(sessions.size>=10000)throw workspaceError('잠시 후 다시 로그인하세요.',503);
    sessions.delete(hash(cookie(req,'dd_portal')));
    const value=random();sessions.set(hash(value),{userId:user.id,name:String(user.global_name||user.username||'사용자').slice(0,80),guilds,csrf:random(),expires:now()+8*60*60*1000});
    const destination=new URL('/portal/',origin);
    if(state.targetServer&&guilds.some(g=>g.id===state.targetServer)){destination.searchParams.set('server',state.targetServer);if(state.targetSession)destination.searchParams.set('session',state.targetSession);}
    setCookie(res,'dd_portal',value,8*60*60);res.redirect(303,destination.pathname+destination.search);
  } catch(error){next(error);}});
  router.post('/logout',express.json({limit:'4kb'}),(req,res,next)=>{try{checkMutation(req);sessions.delete(hash(cookie(req,'dd_portal')));setCookie(res,'dd_portal','',0);res.json({ok:true});}catch(error){next(error);}});
  router.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.status?error.message:'로그인을 완료하지 못했습니다.'}));
  return { router, session, checkMutation, callbackUrl };
}
