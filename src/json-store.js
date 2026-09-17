import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile, syncDirectory } from './atomic-file.js';

const fileQueues = new Map();
const sharedQueue = file => fileQueues.get(file) || Promise.resolve();
const setSharedQueue = (file, promise) => {
  fileQueues.set(file, promise);
  promise.finally(() => { if (fileQueues.get(file) === promise) fileQueues.delete(file); }).catch(() => {});
};

async function exists(file) {
  try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// A single bot process owns these files. Updates are serialized per resolved path, even across
// multiple JsonStore instances. A commit becomes visible in memory only after the durable rename.
export class JsonStore {
  constructor(file, initial, validate) {
    this.file = path.resolve(file);
    this.initial = initial;
    this.validate = validate;
    this.queue = Promise.resolve();
    this.recovered = false;
    this.recoverySource = null;
    this.listeners = new Set();
    this.observer = null;
  }
  setObserver(observer) { this.observer = typeof observer === 'function' ? observer : null; return this; }
  notify(event) { try { this.observer?.({ ...event, file: this.file, at: Date.now() }); } catch { /* diagnostics must never break storage */ } }
  async parse(file) {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!this.validate(value)) throw Error('invalid data');
    return value;
  }
  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const candidates = [
      { file: this.file, source: 'primary' },
      { file: this.file + '.tmp', source: 'temp' },
      { file: this.file + '.bak', source: 'backup' },
      { file: this.file + '.bak.prev', source: 'backup-prev' }
    ];
    let primaryError = null;
    for (const candidate of candidates) {
      try {
        this.state = await this.parse(candidate.file);
        this.recoverySource = candidate.source;
        this.recovered = candidate.source !== 'primary';
        break;
      } catch (error) {
        if (candidate.source === 'primary') primaryError = error;
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError) && error.message !== 'invalid data') throw error;
      }
    }
    if (this.state === undefined) {
      const allMissing = await Promise.all(candidates.map(candidate => exists(candidate.file).then(Boolean)));
      if (!allMissing.some(Boolean)) {
        this.state = structuredClone(this.initial);
        await this.write(this.state, { backup: false });
        this.recoverySource = 'initial';
        return this;
      }
      const failure = Error(`${path.basename(this.file)}을 읽을 수 없습니다. 원본과 복구 후보를 보존했습니다.`);
      this.notify({ type: 'read-failure', error: failure });
      throw failure;
    }
    if (this.recovered) {
      if (await exists(this.file)) {
        await copyFile(this.file, `${this.file}.damaged-${Date.now()}`).catch(() => {});
      }
      await this.write(this.state, { backup: false });
      this.notify({ type: 'recovery', detail: `${this.recoverySource} 복구 후보를 사용해 주 파일을 복원했습니다.`, source: this.recoverySource, primaryError: primaryError?.message || '' });
    } else {
      // A stale temp can remain only from an interrupted older write. It is never newer than a valid committed primary.
      await rm(this.file + '.tmp', { force: true }).catch(() => {});
    }
    return this;
  }
  read() { return structuredClone(this.state); }
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emitChange() {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* listeners must not break persisted updates */ }
    }
  }
  async rotateBackup() {
    const backup = this.file + '.bak';
    const previous = this.file + '.bak.prev';
    if (await exists(backup)) {
      await atomicWriteFile(previous, await readFile(backup), { mode: 0o600, tempFile: previous + '.tmp' });
    }
    if (await exists(this.file)) {
      await atomicWriteFile(backup, await readFile(this.file), { mode: 0o600, tempFile: backup + '.tmp' });
    }
    await syncDirectory(path.dirname(this.file));
  }
  async write(value, options = {}) {
    const backup = typeof options === 'boolean' ? options : options.backup !== false;
    try {
      if (backup) await this.rotateBackup();
      await atomicWriteFile(this.file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, tempFile: this.file + '.tmp' });
      this.notify({ type: 'write-success' });
    } catch (error) {
      this.notify({ type: 'write-failure', error });
      throw error;
    }
  }
  update(fn) {
    const predecessor = Promise.allSettled([this.queue, sharedQueue(this.file)]);
    const run = predecessor.then(async () => {
      // A second JsonStore instance can target the same file. Reload only after the shared
      // predecessor has committed so every updater starts from the latest durable snapshot.
      if (await exists(this.file)) {
        try { this.state = await this.parse(this.file); }
        catch (error) { this.notify({ type: 'read-failure', error }); throw error; }
      }
      const next = this.read();
      const result = await fn(next);
      if (!this.validate(next)) throw Error('저장할 데이터 형식이 올바르지 않습니다.');
      await this.write(next);
      this.state = next;
      this.emitChange();
      return result;
    });
    this.queue = run;
    setSharedQueue(this.file, run);
    return run;
  }
  async flush() {
    await Promise.allSettled([this.queue, sharedQueue(this.file)]);
  }
}

// Reserve multiple JsonStore paths as one write barrier. New updates to any reserved path wait
// until the callback publishes or rolls back all files, so a restore cannot interleave with
// Discord interactions, viewer writes, or dashboard mutations.
export async function runJsonStoreTransaction(stores,fn){
  if(!Array.isArray(stores)||!stores.length||typeof fn!=='function')throw new TypeError('stores and transaction callback are required');
  const unique=[];const seen=new Set();
  for(const store of stores){if(!store?.file||seen.has(store.file))continue;seen.add(store.file);unique.push(store);}
  if(!unique.length)throw new TypeError('at least one JsonStore is required');
  const predecessors=unique.map(store=>Promise.allSettled([store.queue,sharedQueue(store.file)]));
  let release;const held=new Promise(resolve=>{release=resolve});
  const reservations=unique.map((store,index)=>predecessors[index].then(()=>held));
  for(let i=0;i<unique.length;i++){unique[i].queue=reservations[i];setSharedQueue(unique[i].file,reservations[i]);}
  await Promise.all(predecessors);
  const api={
    read:store=>store.read(),
    readDisk:store=>store.parse(store.file),
    write:async(store,value,options={})=>{
      if(!unique.includes(store))throw Error('transaction store is not reserved');
      if(!store.validate(value))throw Error('저장할 데이터 형식이 올바르지 않습니다.');
      await store.write(value,options);
    },
    publish:(store,value)=>{
      if(!unique.includes(store))throw Error('transaction store is not reserved');
      if(!store.validate(value))throw Error('게시할 데이터 형식이 올바르지 않습니다.');
      store.state=structuredClone(value);store.emitChange();
    }
  };
  try{return await fn(api);}finally{release();}
}
