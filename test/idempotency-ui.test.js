import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard, game studio and viewer mutation clients send idempotency keys',async()=>{
  for(const file of ['public/app.js','public/game-studio.js','public/viewer.js']){
    const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.match(source,/Idempotency-Key/,`${file} must send Idempotency-Key`);
    assert.match(source,/uncertain.*Key|uncertainRequestKeys/s,`${file} must retain a key for an uncertain retry`);
  }
});


test('viewer session replay guard runs before session validation so logout retries can replay',async()=>{
  const source=await readFile(new URL('../src/viewer.js',import.meta.url),'utf8');
  const replay=source.indexOf("router.use('/api',sessionIdempotency.middleware");
  const auth=source.indexOf("session=viewerAuth.get(token)");
  assert.ok(replay>=0&&auth>=0&&replay<auth,'viewer idempotency middleware must run before session validation');
  assert.match(source,/viewer-session:\$\{hash\(viewerToken\(req\)\)\}/);
});
