export function sseFrame(event,data,id=null){
  const idLine=id===null||id===undefined||id===''?'':`id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class SseHub {
  constructor({limit=12,onMetric=null}={}){
    if(!Number.isInteger(limit)||limit<1)throw Error('SSE connection limit must be a positive integer.');
    this.limit=limit;
    this.onMetric=typeof onMetric==='function'?onMetric:null;
    this.clients=new Map();
  }
  get size(){return this.clients.size;}
  stats(){
    let backpressured=0,pending=0;
    for(const client of this.clients.values()){
      if(client.blocked)backpressured++;
      if(client.pending!==null)pending++;
    }
    return {liveClients:this.clients.size,limit:this.limit,backpressured,pending};
  }
  has(res){return this.clients.has(res);}
  add(req,res){
    if(this.clients.size>=this.limit)return false;
    const client={req,res,blocked:false,pending:null,closed:false,heartbeat:null,drain:null};
    const close=()=>this.close(res);
    client.close=close;
    this.clients.set(res,client);
    req?.once?.('close',close);
    res?.once?.('close',close);
    this.onMetric?.('connect',this.stats());
    return true;
  }
  write(res,payload){
    const client=this.clients.get(res);
    if(!client||client.closed)return false;
    if(client.blocked){client.pending=payload;return false;}
    try{
      const writable=res.write(payload);
      if(writable===false){
        client.blocked=true;
        const drain=()=>{
          if(client.closed)return;
          client.blocked=false;
          client.drain=null;
          const pending=client.pending;
          client.pending=null;
          if(pending!==null)this.write(res,pending);
        };
        client.drain=drain;
        res.once?.('drain',drain);
        this.onMetric?.('backpressure',this.stats());
      }
      return writable!==false;
    }catch{
      this.close(res);
      return false;
    }
  }
  broadcast(payload){
    for(const res of [...this.clients.keys()])this.write(res,payload);
  }
  heartbeat(res,makePayload,intervalMs=15000){
    const client=this.clients.get(res);
    if(!client||client.closed)return null;
    if(client.heartbeat)clearInterval(client.heartbeat);
    const timer=setInterval(()=>{
      if(client.closed)return;
      let payload;
      try{payload=typeof makePayload==='function'?makePayload():makePayload;}catch{return this.close(res);}
      if(typeof payload!=='string')return;
      this.write(res,payload);
    },intervalMs);
    timer.unref?.();client.heartbeat=timer;return timer;
  }
  close(res){
    const client=this.clients.get(res);
    if(!client||client.closed)return false;
    client.closed=true;
    if(client.heartbeat)clearInterval(client.heartbeat);
    if(client.drain&&typeof res.off==='function')res.off('drain',client.drain);
    client.pending=null;
    this.clients.delete(res);
    this.onMetric?.('disconnect',this.stats());
    return true;
  }
  closeAll({end=true}={}){
    for(const [res] of [...this.clients]){
      this.close(res);
      if(end)try{res.end?.();}catch{}
    }
  }
}
