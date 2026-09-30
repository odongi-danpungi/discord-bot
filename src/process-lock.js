import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile, syncDirectory } from './durable-file.js';
const processOwnedLocks=new Map();

function defaultAlive(pid){
  if(!Number.isInteger(pid)||pid<1)return false;
  try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
}

function parseLock(raw){
  const text=String(raw??'').trim();
  try{
    const value=JSON.parse(text);
    if(value&&typeof value==='object'&&!Array.isArray(value))return {...value,legacy:false,corrupt:false};
  }catch{}
  const pid=Number(text);
  if(Number.isInteger(pid)&&pid>0)return {pid,legacy:true,corrupt:false,phase:'legacy'};
  return {pid:null,legacy:false,corrupt:true,phase:'unknown'};
}

function parseState(raw){
  try{
    const value=JSON.parse(String(raw??''));
    if(value&&typeof value==='object'&&!Array.isArray(value))return {...value,stateCorrupt:false};
  }catch{}
  return {stateCorrupt:true};
}

function crashSummary(previous,now){
  if(!previous)return null;
  return {
    detected:true,
    pid:Number.isInteger(previous.pid)?previous.pid:null,
    instanceId:typeof previous.instanceId==='string'?previous.instanceId:null,
    phase:typeof previous.phase==='string'?previous.phase:'unknown',
    createdAt:Number.isFinite(previous.createdAt)?previous.createdAt:null,
    updatedAt:Number.isFinite(previous.updatedAt)?previous.updatedAt:null,
    lastKnownRevision:Number.isFinite(previous.revision)?previous.revision:null,
    signal:typeof previous.signal==='string'?previous.signal:null,
    legacy:Boolean(previous.legacy),
    corrupt:Boolean(previous.corrupt||previous.stateCorrupt),
    detectedAt:now
  };
}

async function unlinkIfExists(file){
  try{await unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}
}

export class ProcessLock {
  constructor({file,stateFile,instanceId,pid,meta,previousCrash}){
    this.file=path.resolve(file);this.stateFile=path.resolve(stateFile||`${file}.state`);this.instanceId=instanceId;this.pid=pid;this.meta=meta;this.previousCrash=previousCrash;this.owns=true;
  }
  async assertOwnership(){
    if(!this.owns)throw Object.assign(Error('프로세스 잠금 소유권이 없습니다.'),{code:'ELOCKLOST'});
    let current;
    try{current=parseLock(await readFile(this.file,'utf8'));}
    catch(error){if(error.code==='ENOENT')throw Object.assign(Error('프로세스 잠금 파일이 사라졌습니다.'),{code:'ELOCKLOST'});throw error;}
    if(current.instanceId!==this.instanceId||current.pid!==this.pid)throw Object.assign(Error('프로세스 잠금 소유권이 변경됐습니다.'),{code:'ELOCKLOST'});
    return current;
  }
  async update(patch={}){
    await this.assertOwnership();
    this.meta={...this.meta,...patch,pid:this.pid,instanceId:this.instanceId,updatedAt:Date.now()};
    // Keep the exclusive lock file immutable. Mutable lifecycle metadata lives in
    // a sidecar so a torn metadata write can never make another process mistake
    // a live owner for a stale/corrupt lock.
    await atomicWriteFile(this.stateFile,JSON.stringify(this.meta),{mode:0o600,temporary:this.stateFile+'.tmp'});
    return {...this.meta};
  }
  async release(){
    if(!this.owns)return false;
    await this.assertOwnership();
    await unlinkIfExists(this.stateFile+'.tmp');
    await unlinkIfExists(this.stateFile);
    await unlink(this.file);
    this.owns=false;
    if(processOwnedLocks.get(this.file)===this.instanceId)processOwnedLocks.delete(this.file);
    await syncDirectory(path.dirname(this.file));
    return true;
  }
}

export async function acquireProcessLock({file,pid=process.pid,instanceId=randomUUID(),now=Date.now(),isAlive=defaultAlive,corruptGraceMs=5000}={}){
  if(!file)throw new TypeError('lock file is required');
  const absolute=path.resolve(file),stateFile=`${absolute}.state`;
  await mkdir(path.dirname(absolute),{recursive:true});
  let previous=null,previousCrash=null,hadPrevious=false;
  try{
    const raw=await readFile(absolute,'utf8');hadPrevious=true;previous=parseLock(raw);
    if(previous.corrupt){
      const info=await stat(absolute);
      if(now-info.mtimeMs<Math.max(1000,Number(corruptGraceMs)||5000)){
        const error=Error('다른 봇 프로세스가 잠금 파일을 생성 중입니다. 잠시 후 다시 시도해 주세요.');error.code='EINSTANCEACTIVE';throw error;
      }
    }
    // A process cannot be its own previous incarnation. PID 1 is commonly
    // reused after a container restart with a persistent volume. Retain an
    // in-process ownership registry so a second acquisition in this same
    // process is still rejected. Never override another live process's PID.
    const reusedSelfPid=pid===process.pid&&previous.pid===process.pid&&isAlive===defaultAlive&&!processOwnedLocks.has(absolute);
    if(Number.isInteger(previous.pid)&&previous.pid>0&&!reusedSelfPid&&isAlive(previous.pid)){
      const error=Error('이미 봇 프로세스가 실행 중입니다. 기존 실행 창을 종료한 뒤 다시 시도해 주세요.');
      error.code='EINSTANCEACTIVE';throw error;
    }
    try{
      const state=parseState(await readFile(stateFile,'utf8'));
      previous={...previous,...state,pid:previous.pid,instanceId:previous.instanceId,createdAt:previous.createdAt};
    }catch(error){if(error.code!=='ENOENT')throw error;}
    previousCrash=crashSummary(previous,now);
    await unlinkIfExists(stateFile+'.tmp');
    await unlinkIfExists(stateFile);
    await unlink(absolute);
  }catch(error){if(error.code!=='ENOENT')throw error;}

  let handle;
  try{handle=await open(absolute,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')throw Object.assign(Error('이미 봇이 시작 중입니다. 기존 실행 창을 이용해 주세요.'),{code:'EINSTANCEACTIVE'});throw error;}
  processOwnedLocks.set(absolute,instanceId);
  const meta={pid,instanceId,createdAt:now,updatedAt:now,phase:'starting',revision:null,signal:null};
  try{
    await handle.writeFile(JSON.stringify({pid,instanceId,createdAt:now}));
    await handle.sync();
    await handle.close();handle=null;
    await syncDirectory(path.dirname(absolute));
  }
  catch(error){processOwnedLocks.delete(absolute);await handle?.close().catch(()=>{});await unlinkIfExists(absolute).catch(()=>{});throw error;}
  // A state sidecar may be orphaned only when the lock itself was absent. Now that
  // this process owns the exclusive file it is safe to replace that stale sidecar.
  if(!hadPrevious){await unlinkIfExists(stateFile+'.tmp');await unlinkIfExists(stateFile);}
  const lock=new ProcessLock({file:absolute,stateFile,instanceId,pid,meta,previousCrash});
  await lock.update({phase:'starting'});
  return lock;
}

export const __test={parseLock,parseState,crashSummary};
