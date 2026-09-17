const REQUEST_ID=/^[-\w]{8,80}$/;

export class RequestDeduper {
  constructor({ttlMs=120000,maxEntries=500}={}){
    this.ttlMs=ttlMs;this.maxEntries=maxEntries;this.entries=new Map();this.owners=new Map();
  }
  cleanup(now=Date.now()){
    for(const [key,item] of this.entries)if(item.settled&&item.expiresAt<=now)this.entries.delete(key);
    for(const [id,item] of this.owners)if(item.expiresAt<=now)this.owners.delete(id);
    if(this.entries.size>this.maxEntries){for(const [key,item] of this.entries){if(item.settled){this.entries.delete(key);if(this.entries.size<=this.maxEntries)break;}}}
    if(this.owners.size>this.maxEntries*2){for(const [id,item] of this.owners){if(item.expiresAt<=now){this.owners.delete(id);if(this.owners.size<=this.maxEntries*2)break;}}}
  }
  middleware(){
    return async(req,res,next)=>{
      if(req.method!=='POST')return next();
      const supplied=req.get?.('X-Request-Id')??req.headers?.['x-request-id']??req.body?.requestId;
      if(supplied===undefined||supplied===null||supplied==='')return next();
      const requestId=String(supplied);
      if(!REQUEST_ID.test(requestId))return res.status(400).json({error:'요청 번호 형식이 올바르지 않습니다. 페이지를 새로고침해 주세요.'});
      this.cleanup();
      const signature=`${req.method}:${req.path}`;
      const owner=this.owners.get(requestId);
      if(owner&&owner.signature!==signature&&owner.expiresAt>Date.now())return res.status(409).json({error:'같은 요청 번호가 다른 API 작업에 사용됐습니다. 새 요청으로 다시 시도해 주세요.'});
      this.owners.set(requestId,{signature,expiresAt:Date.now()+this.ttlMs});
      const key=`${signature}:${requestId}`,existing=this.entries.get(key);
      if(existing){
        const outcome=await existing.promise;
        return res.status(outcome.status).json(outcome.body);
      }
      let resolve;
      const entry={settled:false,expiresAt:Date.now()+this.ttlMs,promise:new Promise(r=>{resolve=r;})};
      this.entries.set(key,entry);
      const originalJson=res.json.bind(res);
      const settle=(status,body)=>{if(entry.settled)return;entry.settled=true;entry.expiresAt=Date.now()+this.ttlMs;this.owners.set(requestId,{signature,expiresAt:entry.expiresAt});resolve({status,body});};
      res.json=body=>{settle(res.statusCode||200,body);return originalJson(body);};
      res.once('close',()=>{if(!entry.settled)settle(503,{error:'첫 요청 연결이 완료되기 전에 종료되었습니다. 상태를 새로고침한 뒤 다시 확인해 주세요.'});});
      next();
    };
  }
}
