import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentIdempotencyStore } from '../src/idempotency-store.js';
import { createIdempotencyGuard, requestFingerprint } from '../src/idempotency.js';

function response(){
  let done;const finished=new Promise(resolve=>{done=resolve;});
  const res={statusCode:200,headers:{},body:undefined,status(code){this.statusCode=code;return this;},set(name,value){if(name&&typeof name==='object')Object.assign(this.headers,name);else this.headers[String(name).toLowerCase()]=value;return this;},getHeaders(){return {...this.headers};},json(body){this.set('content-type','application/json');return this.send(body);},send(body){this.body=body;done();return this;},end(body){this.body=body;done();return this;}};
  return {res,finished};
}
function request({key,body={value:1},url='/api/test'}={}){const headers={'idempotency-key':key};return {method:'POST',originalUrl:url,url,body,headers,get(name){return headers[String(name).toLowerCase()];}};}
async function dispatch(middleware,{key,body,url,handler}){const req=request({key,body,url}),{res,finished}=response();const result=middleware(req,res,()=>handler(req,res));await Promise.all([Promise.resolve(result),finished]);return res;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function withStore(fn){const dir=await mkdtemp(path.join(tmpdir(),'dd-idem-persist-'));try{const store=await new PersistentIdempotencyStore(path.join(dir,'idempotency.json')).init();await fn(store);}finally{await rm(dir,{recursive:true,force:true});}}

test('completed admin request remains duplicate-blocked after process restart',async()=>withStore(async store=>{
  const req=request({key:'persist-key-0001',body:{a:1}}),fingerprint=requestFingerprint(req);
  assert.equal((await store.claim({scope:'admin',key:'persist-key-0001',fingerprint,bootId:'boot-a'})).status,'new');
  await store.complete({scope:'admin',key:'persist-key-0001',fingerprint,bootId:'boot-a',statusCode:200});
  const guard=createIdempotencyGuard({persistentStore:store,ownerId:'boot-b'}),middleware=guard.middleware({scope:()=> 'admin'});let runs=0;
  const result=await dispatch(middleware,{key:'persist-key-0001',body:{a:1},handler:(_req,res)=>{runs++;res.json({ok:true});}});
  assert.equal(runs,0);assert.equal(result.statusCode,409);assert.equal(result.headers['x-idempotency-status'],'recovered-completed');
  guard.clear();
}));

test('pending request from a dead boot becomes uncertain and cannot be executed again automatically',async()=>withStore(async store=>{
  const req=request({key:'persist-key-0002',body:{a:2}}),fingerprint=requestFingerprint(req);
  await store.claim({scope:'admin',key:'persist-key-0002',fingerprint,bootId:'boot-a'});
  const recovery=await store.recoverPreviousBoot({bootId:'boot-b'});assert.equal(recovery.uncertain,1);assert.equal(store.stats().uncertain,1);
  const guard=createIdempotencyGuard({persistentStore:store,ownerId:'boot-b'}),middleware=guard.middleware({scope:()=> 'admin'});let runs=0;
  const result=await dispatch(middleware,{key:'persist-key-0002',body:{a:2},handler:(_req,res)=>{runs++;res.json({ok:true});}});
  assert.equal(runs,0);assert.equal(result.statusCode,409);assert.equal(result.headers['x-idempotency-status'],'recovered-uncertain');
  guard.clear();
}));

test('coalesced alias keys are both persisted as completed before a later boot',async()=>withStore(async store=>{
  const guard=createIdempotencyGuard({persistentStore:store,ownerId:'boot-a',recentDuplicateMs:100,ttlMs:1000}),middleware=guard.middleware({scope:()=> 'admin'});let runs=0;
  const handler=async(_req,res)=>{runs++;await sleep(15);res.json({ok:true});};
  await Promise.all([
    dispatch(middleware,{key:'persist-alias-001',body:{same:true},handler}),
    dispatch(middleware,{key:'persist-alias-002',body:{same:true},handler})
  ]);
  await store.flush();assert.equal(runs,1);assert.equal(store.stats().completed,2);guard.clear();
  const reboot=createIdempotencyGuard({persistentStore:store,ownerId:'boot-b'}),rebootMw=reboot.middleware({scope:()=> 'admin'});let rebootRuns=0;
  const retry=await dispatch(rebootMw,{key:'persist-alias-002',body:{same:true},handler:(_req,res)=>{rebootRuns++;res.json({ok:true});}});
  assert.equal(rebootRuns,0);assert.equal(retry.statusCode,409);reboot.clear();
}));
