import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/json-store.js';

const valid=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Number.isInteger(value.value);
const json=value=>JSON.stringify({value});
const create=file=>new JsonStore(file,{value:0},valid);

async function fixture(prefix,fn){
  const dir=await mkdtemp(path.join(tmpdir(),prefix));
  try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

async function valueOf(file){return JSON.parse(await readFile(file,'utf8')).value;}

async function missing(file){try{await access(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}

test('durable JSON commit keeps backup exactly one committed generation behind',()=>fixture('json-durable-generation-',async dir=>{
  const file=path.join(dir,'data.json'),store=await create(file).init();
  await store.update(state=>{state.value=1;});
  assert.equal(await valueOf(file),1);
  assert.equal(await valueOf(file+'.bak'),0);
  assert.equal(await missing(file+'.tmp'),true);
  assert.equal(await missing(file+'.bak.tmp'),true);

  await store.update(state=>{state.value=2;});
  assert.equal(await valueOf(file),2);
  assert.equal(await valueOf(file+'.bak'),1);
  assert.equal(await missing(file+'.tmp'),true);
  assert.equal(await missing(file+'.bak.tmp'),true);
}));

test('crash window before primary rename never replays the uncommitted new-value temp',()=>fixture('json-durable-precommit-',async dir=>{
  const file=path.join(dir,'data.json');
  // Represents: new .tmp fsynced and old primary copied/promoted to .bak,
  // then process termination before rename(.tmp, primary).
  await writeFile(file,json(5));
  await writeFile(file+'.bak',json(5));
  await writeFile(file+'.tmp',json(6));
  const store=create(file);await store.init();
  assert.equal(store.read().value,5);
  assert.equal(await valueOf(file),5);
  assert.equal(await valueOf(file+'.bak'),5);
  assert.equal(await missing(file+'.tmp'),true);
  assert.ok((await readdir(dir)).some(name=>name.startsWith('data.json.orphaned-temp-')));
}));

test('crash window during backup staging preserves primary authority and repairs redundancy',()=>fixture('json-durable-backup-stage-',async dir=>{
  const file=path.join(dir,'data.json');
  // Represents: primary=committed 10, old backup=9, .bak.tmp=copy of 10,
  // .tmp=new value 11. Neither staging file is a commit point.
  await writeFile(file,json(10));
  await writeFile(file+'.bak',json(9));
  await writeFile(file+'.bak.tmp',json(10));
  await writeFile(file+'.tmp',json(11));
  const store=create(file);await store.init();
  assert.equal(store.read().value,10);
  assert.equal(await valueOf(file),10);
  assert.equal(await valueOf(file+'.bak'),9);
  assert.equal(await missing(file+'.bak.tmp'),true);
  assert.equal(await missing(file+'.tmp'),true);
  const list=await readdir(dir);
  assert.ok(list.some(name=>name.startsWith('data.json.orphaned-backup-temp-')));
  assert.ok(list.some(name=>name.startsWith('data.json.orphaned-temp-')));
}));

test('validated backup staging file outranks uncommitted primary temp when committed files are unusable',()=>fixture('json-durable-backup-temp-salvage-',async dir=>{
  const file=path.join(dir,'data.json');
  await writeFile(file,'{broken-primary');
  await writeFile(file+'.bak','{broken-backup');
  await writeFile(file+'.bak.tmp',json(20));
  await writeFile(file+'.tmp',json(21));
  const store=create(file);await store.init();
  assert.equal(store.recovered,true);
  assert.equal(store.recoverySource,'backup-temporary');
  assert.equal(store.read().value,20);
  assert.equal(await valueOf(file),20);
  assert.equal(await valueOf(file+'.bak'),20);
  const list=await readdir(dir);
  assert.ok(list.some(name=>name.startsWith('data.json.salvaged-backup-temp-')));
  assert.ok(list.some(name=>name.startsWith('data.json.orphaned-temp-')));
}));

test('post-rename crash state keeps the new primary and the previous committed backup',()=>fixture('json-durable-postcommit-',async dir=>{
  const file=path.join(dir,'data.json');
  // Represents: rename(.tmp, primary) completed; directory fsync may have been
  // the next instruction. On a normal process crash the visible rename is the
  // logical commit and must not be rolled back from .bak.
  await writeFile(file,json(31));
  await writeFile(file+'.bak',json(30));
  const store=create(file);await store.init();
  assert.equal(store.read().value,31);
  assert.equal(await valueOf(file),31);
  assert.equal(await valueOf(file+'.bak'),30);
}));
