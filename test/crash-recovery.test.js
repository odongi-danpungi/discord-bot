import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireProcessLock } from '../src/process-lock.js';

async function tempLock(prefix='dd-lock-'){
  const dir=await mkdtemp(path.join(tmpdir(),prefix));
  return {dir,file:path.join(dir,'operations.json.pid')};
}

test('stale process lock is treated as an unclean shutdown and replaced by the new owner',async()=>{
  const {dir,file}=await tempLock();
  try{
    await writeFile(file,JSON.stringify({pid:43210,instanceId:'old-boot',phase:'running',createdAt:100,updatedAt:200,revision:17}));
    const lock=await acquireProcessLock({file,pid:54321,instanceId:'new-boot',now:1000,isAlive:()=>false});
    assert.equal(lock.previousCrash.detected,true);assert.equal(lock.previousCrash.phase,'running');assert.equal(lock.previousCrash.lastKnownRevision,17);
    const current=JSON.parse(await readFile(file,'utf8'));assert.equal(current.instanceId,'new-boot');assert.equal(current.phase,undefined);
    const lifecycle=JSON.parse(await readFile(lock.stateFile,'utf8'));assert.equal(lifecycle.phase,'starting');
    await lock.release();
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('live pid lock blocks a second process even when dashboard health is unknown',async()=>{
  const {dir,file}=await tempLock();
  try{
    await writeFile(file,JSON.stringify({pid:12345,instanceId:'live-boot',phase:'running',createdAt:1}));
    await assert.rejects(acquireProcessLock({file,pid:54321,instanceId:'new-boot',isAlive:pid=>pid===12345}),error=>error?.code==='EINSTANCEACTIVE');
    const current=JSON.parse(await readFile(file,'utf8'));assert.equal(current.instanceId,'live-boot');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('corrupt stale lock is conservatively reported as an abnormal previous run',async()=>{
  const {dir,file}=await tempLock();
  try{
    await writeFile(file,'{broken-lock');
    const lock=await acquireProcessLock({file,pid:2,instanceId:'replacement',now:Date.now()+6000,isAlive:()=>false});
    assert.equal(lock.previousCrash.corrupt,true);assert.equal(lock.previousCrash.phase,'unknown');
    await lock.release();
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('lock metadata update enforces ownership and clean release removes marker',async()=>{
  const {dir,file}=await tempLock();
  try{
    const lock=await acquireProcessLock({file,pid:777,instanceId:'owner',isAlive:()=>false});
    await lock.update({phase:'running',revision:9});
    const owner=JSON.parse(await readFile(file,'utf8'));assert.equal(owner.instanceId,'owner');assert.equal(owner.pid,777);assert.equal(owner.phase,undefined);
    const value=JSON.parse(await readFile(lock.stateFile,'utf8'));assert.equal(value.phase,'running');assert.equal(value.revision,9);
    await lock.release();
    await assert.rejects(readFile(file,'utf8'),error=>error?.code==='ENOENT');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('fresh corrupt lock is treated as another process starting instead of being deleted',async()=>{
  const {dir,file}=await tempLock();
  try{
    await writeFile(file,'');
    await assert.rejects(acquireProcessLock({file,pid:999,instanceId:'racer',now:Date.now(),isAlive:()=>false}),error=>error?.code==='EINSTANCEACTIVE');
    assert.equal(await readFile(file,'utf8'),'');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('lifecycle sidecar corruption cannot weaken live-owner exclusion',async()=>{
  const {dir,file}=await tempLock();
  try{
    const owner=await acquireProcessLock({file,pid:777,instanceId:'owner',isAlive:()=>false});
    await writeFile(owner.stateFile,'{partial-state');
    await assert.rejects(acquireProcessLock({file,pid:888,instanceId:'other',isAlive:pid=>pid===777}),error=>error?.code==='EINSTANCEACTIVE');
    await owner.release();
  }finally{await rm(dir,{recursive:true,force:true});}
});
