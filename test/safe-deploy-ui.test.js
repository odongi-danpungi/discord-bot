import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard exposes safe deploy, migration and diff controls',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const id of ['safeDeployBadge','deployVersion','deploySchema','deployPostCheck','refreshSafeDeploy','applyMigration','migrationPreview','settingsDiff'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/OPERATIONS GUARD/);
});

test('server protects destructive recovery operations with approval guard',async()=>{
 const server=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(server,/\/api\/guard\/prepare/);assert.match(server,/approvalGuard\.consume/);assert.match(server,/delete-restore-point/);assert.match(server,/restore-backup/);assert.match(server,/apply-migration/);
 assert.doesNotMatch(server,/req\.body\.confirm!==['"]RESTORE['"]/);
});
