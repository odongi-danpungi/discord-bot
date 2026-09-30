import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicCopyFile, atomicWriteFile, removeDurable, syncDirectory, writeFileSynced } from '../src/durable-file.js';

async function fixture(prefix,fn){
  const dir=await mkdtemp(path.join(tmpdir(),prefix));
  try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

async function exists(file){try{await access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

test('atomicWriteFile fsyncs a temporary file then promotes it without leaving staging bytes',()=>fixture('durable-write-',async dir=>{
  const file=path.join(dir,'state.json'),temporary=file+'.tmp';
  const result=await atomicWriteFile(file,'{"ok":true}\n',{temporary});
  assert.equal(await readFile(file,'utf8'),'{"ok":true}\n');
  assert.equal(await exists(temporary),false);
  assert.equal(typeof result.directory.targetDirectory.supported,'boolean');
}));

test('atomicCopyFile replaces the destination through a separately fsynced staging file',()=>fixture('durable-copy-',async dir=>{
  const source=path.join(dir,'source.json'),target=path.join(dir,'backup.json'),temporary=target+'.tmp';
  await writeFileSynced(source,'new-backup');
  await writeFile(target,'old-backup');
  await atomicCopyFile(source,target,{temporary});
  assert.equal(await readFile(target,'utf8'),'new-backup');
  assert.equal(await exists(temporary),false);
}));

test('removeDurable removes the directory entry and directory sync has a portable result',()=>fixture('durable-remove-',async dir=>{
  const file=path.join(dir,'gone.txt');await writeFile(file,'x');
  const removed=await removeDurable(file);
  assert.equal(await exists(file),false);
  assert.equal(typeof removed.directory.supported,'boolean');
  const sync=await syncDirectory(dir);
  assert.equal(typeof sync.supported,'boolean');
  assert.equal(sync.supported?sync.synced:!sync.synced,true);
}));
