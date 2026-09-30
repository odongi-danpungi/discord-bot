import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NaverAuthStore } from '../src/naver-auth-store.js';

const key='11'.repeat(32);

test('NaverAuthStore encrypts OAuth tokens at rest and reopens with the same key',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'naver-auth-')),file=path.join(dir,'naver-auth.json');
  const store=new NaverAuthStore(file,key);await store.init();
  await store.saveToken({accessToken:'ACCESS_SECRET_VALUE',refreshToken:'REFRESH_SECRET_VALUE',tokenType:'bearer',expiresIn:3600});
  const raw=await readFile(file,'utf8');
  assert.equal(raw.includes('ACCESS_SECRET_VALUE'),false);assert.equal(raw.includes('REFRESH_SECRET_VALUE'),false);assert.match(raw,/A256GCM/);
  assert.equal(store.summary().connected,true);assert.equal(store.token().accessToken,'ACCESS_SECRET_VALUE');
  const reopened=new NaverAuthStore(file,key);await reopened.init();assert.equal(reopened.token().refreshToken,'REFRESH_SECRET_VALUE');
});

test('NaverAuthStore rejects a different encryption key',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'naver-auth-key-')),file=path.join(dir,'naver-auth.json');
  const store=new NaverAuthStore(file,key);await store.init();await store.saveToken({accessToken:'A',refreshToken:'R',expiresIn:60});
  const wrong=new NaverAuthStore(file,'22'.repeat(32));await wrong.init();assert.throws(()=>wrong.token(),/NAVER_TOKEN_KEY/);
});
