import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/json-store.js';
import { RuntimeHealth } from '../src/runtime-health.js';

const valid=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Number.isInteger(value.value);
const create=(file,options)=>new JsonStore(file,{value:0},valid,options);
const names=dir=>readdir(dir);

async function fixture(prefix,fn){
  const dir=await mkdtemp(path.join(tmpdir(),prefix));
  try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

test('corrupt primary recovers from validated backup and preserves damaged primary artifact',()=>fixture('json-corrupt-primary-',async dir=>{
  const file=path.join(dir,'data.json');
  await writeFile(file,'{broken');
  await writeFile(file+'.bak',JSON.stringify({value:7}));
  const store=create(file);await store.init();
  assert.equal(store.recovered,true);assert.equal(store.recoverySource,'backup');assert.equal(store.read().value,7);
  assert.equal(JSON.parse(await readFile(file,'utf8')).value,7);
  assert.ok((await names(dir)).some(name=>name.startsWith('data.json.damaged-primary-')));
}));

test('valid temporary is salvaged only when primary and backup are both unusable',()=>fixture('json-temp-salvage-',async dir=>{
  const file=path.join(dir,'data.json'),events=[];
  await writeFile(file,'{broken-primary');await writeFile(file+'.bak','{broken-backup');await writeFile(file+'.tmp',JSON.stringify({value:9}));
  const store=create(file).setObserver(event=>events.push(event));await store.init();
  assert.equal(store.recovered,true);assert.equal(store.recoverySource,'temporary');assert.equal(store.read().value,9);
  assert.equal(JSON.parse(await readFile(file+'.bak','utf8')).value,9);
  const list=await names(dir);assert.ok(list.some(name=>name.startsWith('data.json.salvaged-temp-')));assert.ok(list.some(name=>name.startsWith('data.json.damaged-primary-')));assert.ok(list.some(name=>name.startsWith('data.json.damaged-backup-')));
  assert.ok(events.some(event=>event.type==='temporary_salvage'));
}));

test('valid primary always wins over stale temporary and quarantines the uncommitted temp',()=>fixture('json-stale-temp-',async dir=>{
  const file=path.join(dir,'data.json');
  await writeFile(file,JSON.stringify({value:3}));await writeFile(file+'.tmp',JSON.stringify({value:99}));
  const store=create(file);await store.init();
  assert.equal(store.read().value,3);assert.equal(store.recovered,false);await assert.rejects(access(file+'.tmp'));
  assert.ok((await names(dir)).some(name=>name.startsWith('data.json.orphaned-temp-')));
}));

test('corrupt backup is preserved and rebuilt from a valid primary',()=>fixture('json-backup-repair-',async dir=>{
  const file=path.join(dir,'data.json'),events=[];
  await writeFile(file,JSON.stringify({value:5}));await writeFile(file+'.bak','not-json');
  const store=create(file).setObserver(event=>events.push(event));await store.init();
  assert.equal(store.read().value,5);assert.equal(JSON.parse(await readFile(file+'.bak','utf8')).value,5);
  assert.ok((await names(dir)).some(name=>name.startsWith('data.json.damaged-backup-')));assert.ok(events.some(event=>event.type==='backup_repaired'));
}));

test('all unusable candidates fail closed without modifying any candidate',()=>fixture('json-fail-closed-',async dir=>{
  const file=path.join(dir,'data.json');const before={primary:'{p',backup:'{b',temporary:'{t'};
  await writeFile(file,before.primary);await writeFile(file+'.bak',before.backup);await writeFile(file+'.tmp',before.temporary);
  await assert.rejects(create(file).init(),error=>error?.code==='EDATA_CORRUPT');
  assert.equal(await readFile(file,'utf8'),before.primary);assert.equal(await readFile(file+'.bak','utf8'),before.backup);assert.equal(await readFile(file+'.tmp','utf8'),before.temporary);
  assert.deepEqual((await names(dir)).sort(),['data.json','data.json.bak','data.json.tmp']);
}));

test('invalid UTF-8 is classified as corruption before JSON parsing',()=>fixture('json-invalid-utf8-',async dir=>{
  const file=path.join(dir,'data.json'),events=[];
  await writeFile(file,Buffer.from([0xff,0xfe,0xfd]));await writeFile(file+'.bak',JSON.stringify({value:4}));
  const store=create(file).setObserver(event=>events.push(event));await store.init();
  assert.equal(store.read().value,4);assert.ok(events.some(event=>event.type==='file_corruption_detected'&&event.reason==='utf8'));
}));

test('configured size ceiling classifies oversized primary without parsing it',()=>fixture('json-oversize-',async dir=>{
  const file=path.join(dir,'data.json'),events=[];
  await writeFile(file,JSON.stringify({value:1,padding:'x'.repeat(256)}));await writeFile(file+'.bak',JSON.stringify({value:2}));
  const store=create(file,{maxBytes:64}).setObserver(event=>events.push(event));await store.init();
  assert.equal(store.read().value,2);assert.ok(events.some(event=>event.type==='file_corruption_detected'&&event.reason==='oversize'));
}));

test('corruption and recovery telemetry warns without exposing absolute paths',()=>fixture('json-telemetry-',async dir=>{
  const file=path.join(dir,'private','data.json');await (await import('node:fs/promises')).mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,'{broken');await writeFile(file+'.bak',JSON.stringify({value:6}));
  const health=new RuntimeHealth();const store=create(file).setObserver(event=>health.recordPersistence(event));await store.init();const snap=health.snapshot();
  assert.equal(snap.status,'warn');assert.ok(snap.incidents.some(item=>item.code==='file_corruption_detected'));assert.ok(snap.incidents.some(item=>item.code==='backup_recovery'));
  assert.doesNotMatch(JSON.stringify(snap),new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));health.close();
}));
