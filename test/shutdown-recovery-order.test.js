import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexUrl=new URL('../src/index.js',import.meta.url);

test('graceful shutdown drains HTTP before clearing runtime and flushes persistence before releasing crash marker',async()=>{
  const source=await readFile(indexUrl,'utf8');
  const shutdownStart=source.indexOf("async function shutdown(");
  const shutdownEnd=source.indexOf("async function fatalExit",shutdownStart);
  assert.ok(shutdownStart>=0&&shutdownEnd>shutdownStart);
  const body=source.slice(shutdownStart,shutdownEnd);
  const begin=body.indexOf('runtime?.beginShutdown?.(signal)');
  const closeHttp=body.indexOf('closeHttpServer()');
  const closeRuntime=body.indexOf('runtime?.close?.()');
  const flush=body.indexOf('flushPersistentStores()');
  const release=body.indexOf('processLock.release()');
  assert.ok(begin>=0&&closeHttp>begin,'HTTP draining must start after mutation drain mode');
  assert.ok(closeRuntime>closeHttp,'runtime idempotency/SSE cleanup must happen after HTTP handlers drain');
  assert.ok(flush>closeRuntime,'persistent stores must flush after request handlers are finished');
  assert.ok(release>flush,'clean marker must be removed only after persistent queues flush');
});

test('incomplete shutdown preserves the marker for next-boot recovery',async()=>{
  const source=await readFile(indexUrl,'utf8');
  assert.match(source,/phase:'shutdown-incomplete'/);
  assert.match(source,/if\(clean\)\{try\{await processLock\.release\(\)/);
});
