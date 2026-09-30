import https from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList(),blockedV6=new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(ip,prefix,'ipv4');
for (const [ip,prefix] of [['::',128],['::1',128],['::ffff:0:0',96],['64:ff9b::',96],['100::',64],['2001::',32],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]]) blockedV6.addSubnet(ip,prefix,'ipv6');
export const publicAddress = address => {
  const family=isIP(address);
  return Boolean(family) && !(family===6?blockedV6:blocked).check(address,family===6?'ipv6':'ipv4');
};
export function publicHealthUrl(value) {
  let url;try{url=new URL(value);}catch{throw Object.assign(Error('Invalid public URL'),{code:'INVALID_PUBLIC_URL'});}
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||
    /(^|\.)(localhost|local|internal)$/.test(hostname)||!hostname.includes('.')||
    (isIP(hostname)&&!publicAddress(hostname)))throw Object.assign(Error('Invalid public URL'),{code:'INVALID_PUBLIC_URL'});
  return new URL('/healthz',url);
}
export function retryDelay(value,now=Date.now()) {
  if(!value)return 0;
  const seconds=Number(value),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
  return Number.isFinite(delay)?Math.max(0,delay):0;
}

// DNS is validated inside the connection lookup, not in a separate pre-check.
// A new connection prevents a pooled socket from bypassing this policy.
export function readPublicHealth(value,{timeoutMs=5000}={}) {
  return new Promise((resolve,reject)=>{
    let url;try{url=publicHealthUrl(value);}catch(error){reject(error);return;}
    const req=https.get(url,{agent:false,headers:{Accept:'application/json'},lookup(host,options,callback){
      lookup(host,{all:true,verbatim:true},(error,addresses)=>{
        if(error)return callback(error);
        if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))return callback(Object.assign(Error('Non-public address'),{code:'INVALID_PUBLIC_URL'}));
        return options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family);
      });
    }},response=>{
      const status=response.statusCode||0,retryAfterMs=retryDelay(response.headers['retry-after']);
      if(status!==200){response.resume();resolve({status,retryAfterMs,body:null});return;}
      let bytes=0;const chunks=[];
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384)req.destroy(Object.assign(Error('Response too large'),{code:'INVALID_RESPONSE'}));else chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{try{resolve({status,retryAfterMs,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(Object.assign(Error('Invalid health JSON'),{code:'INVALID_RESPONSE'}));}});
    });
    const timer=setTimeout(()=>req.destroy(Object.assign(Error('Probe timed out'),{code:'ETIMEDOUT'})),timeoutMs);
    req.once('close',()=>clearTimeout(timer));req.once('error',reject);
  });
}
