import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('process lock is acquired before any persistent JSON store initialization', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const acquire = source.indexOf('processLock=await acquireProcessLock({file:path.resolve(config.operationsFile)+\'.pid\'});');
  const backupInit = source.indexOf('backupManager=new BackupRetention');
  const storeInit = source.indexOf('new RegistrationStore(config.dataFile)');
  assert.ok(acquire >= 0);
  assert.ok(backupInit > acquire);
  assert.ok(storeInit > acquire);
  assert.match(source, /acquireProcessLock/);
  assert.match(source, /EINSTANCEACTIVE/);
});
