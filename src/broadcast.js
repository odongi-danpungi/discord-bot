import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildBroadcastSnapshot,sanitizeBroadcastDraw} from './broadcast-state.js';
import {SseHub,sseFrame} from './sse-hub.js';

const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const loopbackHost=host=>['127.0.0.1','localhost','::1'].includes(String(host||'').replace(/^\[|\]$/g,''));
const loopbackAddress=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(address||''));
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y)};

export function createBroadcastRouter({config,store,operations,version}){
  const router=express.Router();const streamLimit=8,streams=new SseHub({limit:streamLimit});let seq=0,pushQueued=false;
  const records=()=>store.read().filter(r=>r.guildId===config.guildId);
  const snapshot=()=>buildBroadcastSnapshot(operations.read(),records(),version);
  const basicAuthorized=req=>{const auth=req.get('authorization')||'';if(!auth.startsWith('Basic '))return false;let decoded='';try{decoded=Buffer.from(auth.slice(6),'base64').toString('utf8')}catch{return false}const colon=decoded.indexOf(':');return colon>=0&&equal(decoded.slice(0,colon),config.dashboardUser)&&equal(decoded.slice(colon+1),config.dashboardPassword)};
  const authorized=req=>(loopbackHost(config.host)&&loopbackAddress(req.socket?.remoteAddress))||Boolean(config.broadcastToken&&equal(req.query.token||req.get('x-broadcast-token'),config.broadcastToken))||basicAuthorized(req);
  const requireAuth=(req,res,next)=>{
    if(authorized(req))return next();
    const message=config.broadcastToken?'방송 화면 접근 토큰이 올바르지 않습니다.':'외부 방송 화면은 기본적으로 비활성화되어 있습니다. BROADCAST_TOKEN을 24자 이상으로 설정해 주세요.';
    if(req.path.startsWith('/api/'))return res.status(403).json({error:message});
    res.status(403).type('text/plain; charset=utf-8').send(message);
  };
  const push=()=>{if(pushQueued||!streams.size)return;pushQueued=true;setTimeout(()=>{pushQueued=false;const id=String(++seq),payload=sseFrame('snapshot',snapshot(),id);streams.broadcast(payload);},35).unref?.();};
  const unsubscribeOperations=operations.subscribe(push),unsubscribeStore=store.subscribe(push);

  router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'"});next();});
  router.get('/broadcast.css',(_req,res)=>res.sendFile(publicDir+'broadcast.css'));
  router.get('/broadcast.js',(_req,res)=>res.sendFile(publicDir+'broadcast.js'));
  const broadcastModules=new Set(['live-director.js','race-renderer.js','race-renderer-legacy.js','maps.js','art.js']);
  router.get('/assets/:file',(req,res)=>{if(!broadcastModules.has(req.params.file))return res.sendStatus(404);res.sendFile(publicDir+req.params.file);});
  router.get('/',requireAuth,(_req,res)=>res.sendFile(publicDir+'broadcast.html'));
  router.use('/api',requireAuth);
  router.get('/api/snapshot',(_req,res)=>res.json(snapshot()));
  router.get('/api/draw/:id',(req,res)=>{
    const state=operations.read(),draw=state.lastDraw;
    if(!draw?.id||draw.id!==req.params.id||!state.session||draw.sessionId!==state.session.id)return res.status(404).json({error:'현재 방송할 경기 기록이 없습니다.'});
    res.json({draw:sanitizeBroadcastDraw(draw,records())});
  });
  router.get('/api/events',(req,res)=>{
    if(streams.size>=streamLimit)return res.status(503).json({error:'방송 화면 연결이 너무 많습니다.'});
    res.status(200);res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders?.();
    if(!streams.add(req,res))return res.end();
    streams.write(res,'retry: 2500\n\n');
    streams.write(res,sseFrame('snapshot',snapshot(),String(++seq)));
    streams.heartbeat(res,()=>sseFrame('heartbeat',{serverTime:Date.now(),version,revision:Number(operations.read().revision)||0},null),15000);
  });
  router.use('/api',(_req,res)=>res.status(404).json({error:'지원하지 않는 방송 API입니다.'}));

  return {router,stats(){return streams.stats();},close(){unsubscribeOperations();unsubscribeStore();streams.closeAll();}};
}
