import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildBroadcastSnapshot,buildBroadcastOverlaySnapshot,sanitizeBroadcastDraw} from './broadcast-state.js';

const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const loopbackHost=host=>['127.0.0.1','localhost','::1'].includes(String(host||'').replace(/^\[|\]$/g,''));
const loopbackAddress=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(address||''));
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y)};

export function createBroadcastRouter({config,store,operations,version,participationQueue=null,sessionIdentity=()=>null}){
  const router=express.Router(),streams=new Set(),streamClosers=new Map();const streamLimit=8;let seq=0,pushQueued=false;
  const records=()=>store.read().filter(r=>r.guildId===config.guildId);
  const snapshot=()=>{const state=operations.read(),safeRecords=records();return {...buildBroadcastSnapshot(state,safeRecords,version),overlay:buildBroadcastOverlaySnapshot(state,safeRecords,participationQueue?.summary?.()||null,version)};};
  const basicAuthorized=req=>{const auth=req.get('authorization')||'';if(!auth.startsWith('Basic '))return false;let decoded='';try{decoded=Buffer.from(auth.slice(6),'base64').toString('utf8')}catch{return false}const colon=decoded.indexOf(':');return colon>=0&&equal(decoded.slice(0,colon),config.dashboardUser)&&equal(decoded.slice(colon+1),config.dashboardPassword)};
  const authorized=req=>(loopbackHost(config.host)&&loopbackAddress(req.socket?.remoteAddress))||Boolean(config.broadcastToken&&equal(req.query.token||req.get('x-broadcast-token'),config.broadcastToken))||sessionIdentity(req)?.role==='admin'||basicAuthorized(req);
  const requireAuth=(req,res,next)=>{
    if(authorized(req))return next();
    const message=config.broadcastToken?'방송 화면 접근 토큰이 올바르지 않습니다.':'외부 방송 화면은 기본적으로 비활성화되어 있습니다. BROADCAST_TOKEN을 24자 이상으로 설정해 주세요.';
    if(req.path.startsWith('/api/'))return res.status(403).json({error:message});
    res.status(403).type('text/plain; charset=utf-8').send(message);
  };
  const frame=(event,data,id)=>`${id?`id: ${id}\n`:''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const push=()=>{if(pushQueued||!streams.size)return;pushQueued=true;setTimeout(()=>{pushQueued=false;const id=String(++seq),payload=frame('snapshot',snapshot(),id);for(const res of [...streams]){try{res.write(payload)}catch{streamClosers.get(res)?.();}}},35).unref?.();};
  const unsubscribeOperations=operations.subscribe(push),unsubscribeStore=store.subscribe(push),unsubscribeQueue=participationQueue?.subscribe?.(push)||(()=>{});

  router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'"});next();});
  router.get('/broadcast.css',(_req,res)=>res.sendFile(publicDir+'broadcast.css'));
  router.get('/broadcast.js',(_req,res)=>res.sendFile(publicDir+'broadcast.js'));
  router.get('/overlay.css',(_req,res)=>res.sendFile(publicDir+'overlay.css'));
  router.get('/overlay.js',(_req,res)=>res.sendFile(publicDir+'overlay.js'));
  router.use('/assets',express.static(publicDir,{etag:false,index:false}));
  router.get('/',requireAuth,(_req,res)=>res.sendFile(publicDir+'broadcast.html'));
  router.get(['/overlay','/overlay/'],requireAuth,(_req,res)=>res.sendFile(publicDir+'overlay.html'));
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
    let closed=false,heartbeat=null;const close=()=>{if(closed)return;closed=true;if(heartbeat)clearInterval(heartbeat);streamClosers.delete(res);streams.delete(res);};
    streams.add(res);streamClosers.set(res,close);req.once('close',close);res.once('close',close);
    try{res.write('retry: 2500\n\n');res.write(frame('snapshot',snapshot(),String(++seq)));}catch{return close();}
    if(closed)return;heartbeat=setInterval(()=>{try{res.write(frame('heartbeat',{serverTime:Date.now(),version,revision:Number(operations.read().revision)||0},null));}catch{close();}},15000);heartbeat.unref();
  });
  router.use('/api',(_req,res)=>res.status(404).json({error:'지원하지 않는 방송 API입니다.'}));

  return {router,stats(){return {liveClients:streams.size,limit:streamLimit};},close(){unsubscribeOperations();unsubscribeStore();unsubscribeQueue();for(const res of [...streams]){try{streamClosers.get(res)?.();res.end()}catch{}}streams.clear();streamClosers.clear();}};
}
