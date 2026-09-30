import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl=new URL('../src/app.js',import.meta.url);

test('Railway healthcheck is public, lightweight and drain-aware',async()=>{
  const source=await readFile(appUrl,'utf8');
  const route=source.indexOf("app.get('/healthz'");
  const auth=source.indexOf("const auth=req.get('authorization')");
  assert.ok(route>=0,'/healthz route must exist');
  assert.ok(auth>route,'/healthz must be registered before dashboard Basic Auth middleware');
  const body=source.slice(route,source.indexOf("app.use('/viewer'",route));
  assert.match(body,/const ready=!draining/);
  assert.match(body,/status\(ready\?200:503\)/);
  assert.doesNotMatch(body,/discord\.diagnostics|naver|token|password/i);
});

test('full dashboard health remains separate from platform readiness probe',async()=>{
  const source=await readFile(appUrl,'utf8');
  assert.match(source,/app\.get\('\/api\/health'/);
  assert.match(source,/statusCache=await discord\.diagnostics\(\)/);
});
