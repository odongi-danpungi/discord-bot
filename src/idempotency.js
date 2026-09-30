import { createHash } from 'node:crypto';

const MUTATING_METHODS=new Set(['POST','PUT','PATCH','DELETE']);
const HOP_BY_HOP_HEADERS=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','content-length','date']);
const KEY_RE=/^[A-Za-z0-9._:-]{8,128}$/;

function canonical(value){
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(canonical);
  const out={};
  for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);
  return out;
}

function cloneBody(body){
  if(Buffer.isBuffer(body))return Buffer.from(body);
  if(body&&typeof body==='object')return structuredClone(body);
  return body;
}

function replayHeaders(headers={}){
  const out={};
  for(const [key,value] of Object.entries(headers)){
    const lower=key.toLowerCase();
    if(HOP_BY_HOP_HEADERS.has(lower)||lower==='x-idempotency-status'||lower==='x-idempotency-replayed')continue;
    out[key]=value;
  }
  return out;
}

export function requestFingerprint(req){
  const payload={method:String(req.method||'').toUpperCase(),url:String(req.originalUrl||req.url||''),body:canonical(req.body??null)};
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function createIdempotencyGuard({ttlMs=5*60*1000,recentDuplicateMs=1500,maxEntries=2048,pendingTimeoutMs=10*60*1000,persistentStore=null,ownerId=''}={}){
  const keyed=new Map(),recent=new Map(),persistentOwner=String(ownerId||'boot');

  function removeEntry(entry){
    for(const [token,value] of keyed)if(value===entry)keyed.delete(token);
    for(const [token,value] of recent)if(value===entry)recent.delete(token);
  }
  function cleanup(now=Date.now()){
    for(const [token,entry] of keyed)if(entry.completedAt&&entry.expiresAt<=now)keyed.delete(token);
    for(const [token,entry] of recent)if(entry.completedAt&&entry.recentUntil<=now)recent.delete(token);
    if(keyed.size>maxEntries){
      const completed=[...keyed.entries()].filter(([,entry])=>entry.completedAt).sort((a,b)=>a[1].completedAt-b[1].completedAt);
      for(const [token] of completed.slice(0,Math.max(0,keyed.size-maxEntries)))keyed.delete(token);
    }
    if(recent.size>maxEntries){
      const completed=[...recent.entries()].filter(([,entry])=>entry.completedAt).sort((a,b)=>a[1].completedAt-b[1].completedAt);
      for(const [token] of completed.slice(0,Math.max(0,recent.size-maxEntries)))recent.delete(token);
    }
  }
  async function replay(entry,res,mode){
    const result=entry.result||await entry.done;
    if(!result)return res.status(503).json({error:'이전 동일 요청의 결과를 확인하지 못했습니다. 새로고침 후 다시 실행해 주세요.'});
    res.status(result.status);
    const headers=replayHeaders(result.headers);
    if(Object.keys(headers).length)res.set(headers);
    res.set('X-Idempotency-Status',mode);
    res.set('X-Idempotency-Replayed','true');
    if(result.body===undefined||result.body===null){
      if(result.status===204)return res.end();
      return res.send(result.body??'');
    }
    return res.send(cloneBody(result.body));
  }
  function recoveredBlock(res,entryStatus='completed'){
    const uncertain=entryStatus==='pending'||entryStatus==='uncertain';
    res.set('X-Idempotency-Status',uncertain?'recovered-uncertain':'recovered-completed');
    return res.status(409).json({error:uncertain?'이 요청은 이전 실행 중 처리 여부가 확정되지 않았습니다. 현재 상태를 새로고침해 반영 여부를 확인한 뒤 새 작업으로 진행해 주세요.':'이 요청은 이전 실행에서 이미 처리된 기록이 있습니다. 현재 상태를 새로고침해 결과를 확인해 주세요.'});
  }
  async function claimPersistent({scope,key,fingerprint}){
    if(!persistentStore||!key)return {status:'disabled'};
    return persistentStore.claim({scope,key,fingerprint,bootId:persistentOwner});
  }
  function completePersistent(entry,statusCode){
    if(!persistentStore||!entry.persistedKeys?.size)return;
    for(const item of entry.persistedKeys){persistentStore.complete({scope:entry.scope,key:item,fingerprint:entry.fingerprint,bootId:persistentOwner,statusCode}).catch(()=>{});}
  }
  function middleware({scope=()=> 'default'}={}){
    return async function idempotencyMiddleware(req,res,next){
      if(!MUTATING_METHODS.has(String(req.method||'').toUpperCase()))return next();
      cleanup();
      const rawHeader=req.get?.('Idempotency-Key')??req.headers?.['idempotency-key'];
      const key=rawHeader===undefined||rawHeader===null||rawHeader===''?null:String(rawHeader);
      if(key&&!KEY_RE.test(key))return res.status(400).json({error:'Idempotency-Key 형식이 올바르지 않습니다. 8~128자의 영문·숫자·._:- 문자를 사용해 주세요.'});
      const scopeValue=String(scope(req)||'default').slice(0,180),fingerprint=requestFingerprint(req),keyToken=key?`${scopeValue}\u0000${key}`:null,fingerprintToken=`${scopeValue}\u0000${fingerprint}`;
      if(keyToken){
        const existing=keyed.get(keyToken);
        if(existing){
          if(existing.fingerprint!==fingerprint)return res.status(409).json({error:'같은 Idempotency-Key가 다른 요청 내용에 사용됐습니다. 새 요청 번호로 다시 실행해 주세요.'});
          return replay(existing,res,existing.completedAt?'replayed':'coalesced');
        }
      }
      const same=recent.get(fingerprintToken);
      if(same&&(!same.completedAt||same.recentUntil>Date.now())){
        if(keyToken&&!keyed.has(keyToken)){
          const claim=await claimPersistent({scope:scopeValue,key,fingerprint});
          if(claim.status==='conflict')return res.status(409).json({error:'같은 Idempotency-Key가 다른 요청 내용에 사용됐습니다. 새 요청 번호로 다시 실행해 주세요.'});
          if(claim.status==='existing'&&claim.ownerBootId!==persistentOwner)return recoveredBlock(res,claim.entryStatus);
          if(claim.status==='existing'&&claim.ownerBootId===persistentOwner&&claim.entryStatus!=='pending')return recoveredBlock(res,claim.entryStatus);
          keyed.set(keyToken,same);same.persistedKeys??=new Set();same.persistedKeys.add(key);
          if(same.completedAt&&claim.status==='new')persistentStore?.complete({scope:scopeValue,key,fingerprint,bootId:persistentOwner,statusCode:same.result?.status}).catch(()=>{});
        }
        return replay(same,res,same.completedAt?'recent-duplicate':'coalesced');
      }

      if(keyToken&&persistentStore){
        const claim=await claimPersistent({scope:scopeValue,key,fingerprint});
        if(claim.status==='conflict')return res.status(409).json({error:'같은 Idempotency-Key가 다른 요청 내용에 사용됐습니다. 새 요청 번호로 다시 실행해 주세요.'});
        if(claim.status==='existing'){
          const memory=keyed.get(keyToken);
          if(memory&&memory.fingerprint===fingerprint)return replay(memory,res,memory.completedAt?'replayed':'coalesced');
          return recoveredBlock(res,claim.entryStatus);
        }
        // The persistent claim awaited a disk commit. Another request with the same
        // fingerprint but a different key may have become the in-memory leader while
        // we were waiting. Re-check after the await so both requests cannot execute.
        const leader=recent.get(fingerprintToken);
        if(leader&&(!leader.completedAt||leader.recentUntil>Date.now())){
          keyed.set(keyToken,leader);leader.persistedKeys??=new Set();leader.persistedKeys.add(key);
          if(leader.completedAt)persistentStore.complete({scope:scopeValue,key,fingerprint,bootId:persistentOwner,statusCode:leader.result?.status}).catch(()=>{});
          return replay(leader,res,leader.completedAt?'recent-duplicate':'coalesced');
        }
      }

      let resolveDone;
      const entry={key,keyToken,scope:scopeValue,fingerprint,fingerprintToken,persistedKeys:new Set(key?[key]:[]),createdAt:Date.now(),completedAt:0,recentUntil:0,expiresAt:0,result:null,done:new Promise(resolve=>{resolveDone=resolve;})};
      entry.resolveDone=resolveDone;
      if(keyToken)keyed.set(keyToken,entry);
      recent.set(fingerprintToken,entry);
      const timeout=setTimeout(()=>{if(!entry.completedAt){removeEntry(entry);entry.resolveDone(null);}},pendingTimeoutMs);timeout.unref?.();
      let finalized=false;
      const finalize=body=>{
        if(finalized)return;
        finalized=true;clearTimeout(timeout);
        const now=Date.now();entry.completedAt=now;entry.recentUntil=now+recentDuplicateMs;entry.expiresAt=now+ttlMs;entry.result={status:res.statusCode,headers:{...res.getHeaders()},body:cloneBody(body)};entry.resolveDone(entry.result);completePersistent(entry,res.statusCode);
        if(!entry.keyToken&&recentDuplicateMs<=0)recent.delete(entry.fingerprintToken);
        cleanup(now);
      };
      const originalSend=res.send.bind(res),originalEnd=res.end.bind(res);
      res.send=function guardedSend(body){finalize(body);return originalSend(body);};
      res.end=function guardedEnd(chunk,encoding,callback){if(!finalized)finalize(chunk);return originalEnd(chunk,encoding,callback);};
      res.set('X-Idempotency-Status',key?'new':'unkeyed');
      return next();
    };
  }
  return {middleware,stats(){cleanup();return {keyed:keyed.size,recent:recent.size,persistent:persistentStore?.stats?.()||null};},clear(){for(const entry of new Set([...keyed.values(),...recent.values()]))entry.resolveDone?.(null);keyed.clear();recent.clear();}};
}
