import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard exposes recovery, self-check, backup verification and audit controls',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const id of ['runSelfCheck','createCheckpoint','restorePointList','backupVerifyFile','verifyBackup','restoreBackup','auditLog','auditCategory'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/data-tab="recovery"/);assert.match(html,/복구·감사/);
});

test('recovery APIs require two-step approval and preserve a pre-restore point',async()=>{
 const server=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(server,/\/api\/self-check/);assert.match(server,/\/api\/backup\/verify/);assert.match(server,/\/api\/recovery\/checkpoint/);assert.match(server,/\/api\/recovery\/restore/);assert.match(server,/\/api\/backup\/restore/);
 assert.match(server,/approvalGuard\.consume/);assert.match(server,/\/api\/guard\/prepare/);assert.match(server,/auto-before-checkpoint-restore/);assert.match(server,/auto-before-backup-restore/);assert.match(server,/suspendLive=true/);
});
