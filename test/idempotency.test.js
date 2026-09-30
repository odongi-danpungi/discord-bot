import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdempotencyGuard, requestFingerprint } from '../src/idempotency.js';

function response(){
  let done;
  const finished=new Promise(resolve=>{done=resolve;});
  const res={statusCode:200,headers:{},body:undefined,
    status(code){this.statusCode=code;return this;},
    set(name,value){if(name&&typeof name==='object'){Object.assign(this.headers,name);}else this.headers[String(name).toLowerCase()]=value;return this;},
    getHeaders(){return {...this.headers};},
    json(body){this.set('content-type','application/json');return this.send(body);},
    send(body){this.body=body;done();return this;},
    end(body){this.body=body;done();return this;}
  };
  return {res,finished};
}
function request({key,body={value:1},url='/api/test'}={}){
  const headers={};if(key)headers['idempotency-key']=key;
  return {method:'POST',originalUrl:url,url,body,headers,get(name){return headers[String(name).toLowerCase()];}};
}
async function dispatch(middleware,{key,body,url,handler}){
  const req=request({key,body,url}),{res,finished}=response();
  const result=middleware(req,res,()=>handler(req,res));
  await Promise.all([Promise.resolve(result),finished]);
  return res;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('fingerprint canonicalizes JSON object key order',()=>{
  const a=request({body:{z:1,a:{y:2,x:3}}}),b=request({body:{a:{x:3,y:2},z:1}});
  assert.equal(requestFingerprint(a),requestFingerprint(b));
});

test('same idempotency key coalesces in-flight request and replays completed response',async()=>{
  const guard=createIdempotencyGuard({recentDuplicateMs:0}),middleware=guard.middleware({scope:()=> 'admin'});let runs=0;
  const handler=async(_req,res)=>{runs++;await sleep(20);res.status(201).set('X-Test','one').send({ok:true,runs});};
  const [first,second]=await Promise.all([
    dispatch(middleware,{key:'retry-key-0001',body:{a:1},handler}),
    dispatch(middleware,{key:'retry-key-0001',body:{a:1},handler})
  ]);
  assert.equal(runs,1);assert.equal(first.statusCode,201);assert.equal(second.statusCode,201);assert.deepEqual(second.body,{ok:true,runs:1});assert.equal(second.headers['x-idempotency-replayed'],'true');
  const third=await dispatch(middleware,{key:'retry-key-0001',body:{a:1},handler});
  assert.equal(runs,1);assert.equal(third.statusCode,201);assert.equal(third.headers['x-idempotency-status'],'replayed');
  guard.clear();
});

test('same idempotency key cannot be reused for a different payload',async()=>{
  const guard=createIdempotencyGuard({recentDuplicateMs:0}),middleware=guard.middleware({scope:()=> 'admin'});let runs=0;
  const handler=(_req,res)=>{runs++;res.json?res.json({ok:true}):res.send({ok:true});};
  await dispatch(middleware,{key:'conflict-key-001',body:{a:1},handler});
  const conflict=await dispatch(middleware,{key:'conflict-key-001',body:{a:2},handler});
  assert.equal(runs,1);assert.equal(conflict.statusCode,409);assert.match(conflict.body.error,/다른 요청 내용/);
  guard.clear();
});

test('identical unkeyed concurrent requests are coalesced and short duplicate window suppresses double submit',async()=>{
  const guard=createIdempotencyGuard({recentDuplicateMs:30}),middleware=guard.middleware({scope:()=> 'admin'});let runs=0;
  const handler=async(_req,res)=>{runs++;await sleep(15);res.send({ok:true,runs});};
  const [a,b]=await Promise.all([dispatch(middleware,{body:{same:true},handler}),dispatch(middleware,{body:{same:true},handler})]);
  assert.equal(runs,1);assert.deepEqual(a.body,b.body);
  const immediate=await dispatch(middleware,{body:{same:true},handler});assert.equal(runs,1);assert.equal(immediate.headers['x-idempotency-status'],'recent-duplicate');
  await sleep(40);await dispatch(middleware,{body:{same:true},handler});assert.equal(runs,2);
  guard.clear();
});

test('a second explicit key coalesced by fingerprint stays bound for later retry',async()=>{
  const guard=createIdempotencyGuard({recentDuplicateMs:20,ttlMs:500}),middleware=guard.middleware({scope:()=> 'admin'});let runs=0;
  const handler=async(_req,res)=>{runs++;await sleep(15);res.send({ok:true,runs});};
  await Promise.all([
    dispatch(middleware,{key:'alias-key-000001',body:{same:'mutation'},handler}),
    dispatch(middleware,{key:'alias-key-000002',body:{same:'mutation'},handler})
  ]);
  assert.equal(runs,1);
  await sleep(30);
  const retry=await dispatch(middleware,{key:'alias-key-000002',body:{same:'mutation'},handler});
  assert.equal(runs,1);assert.equal(retry.headers['x-idempotency-status'],'replayed');
  guard.clear();
});

test('invalid idempotency keys are rejected before the handler runs',async()=>{
  const guard=createIdempotencyGuard(),middleware=guard.middleware();let runs=0;
  const result=await dispatch(middleware,{key:'short',handler:(_req,res)=>{runs++;res.send({ok:true});}});
  assert.equal(runs,0);assert.equal(result.statusCode,400);assert.match(result.body.error,/Idempotency-Key/);
  guard.clear();
});
