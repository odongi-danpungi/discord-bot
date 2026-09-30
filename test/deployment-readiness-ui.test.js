import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard exposes production readiness, backup retention and soak controls',async()=>{
  const [html,client,server,index]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/index.js',import.meta.url),'utf8')
  ]);
  for(const id of ['deployOverall','deployProfile','deployBackupCount','deploySoakState','deploymentChecklist','startupPreflightList','createDeploymentBackup','startSoak','stopSoak','refreshDeployment'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/data-tab="deployment"/);assert.match(html,/PRODUCTION GATE/);assert.match(html,/BACKUP RETENTION/);assert.match(html,/SOAK TEST/);
  assert.match(client,/\/api\/deployment-readiness/);assert.match(client,/\/api\/deployment\/backup/);assert.match(client,/\/api\/deployment\/soak\/start/);assert.match(client,/deploymentRefresh/);
  assert.match(server,/buildDeploymentReadiness/);assert.match(server,/SoakTestRunner/);assert.match(server,/beginShutdown/);assert.match(server,/app\.post\('\/api\/deployment\/backup'[\s\S]*?if\(busy\)/);const closeAt=index.indexOf('server.close('),destroyAt=index.indexOf('client?.destroy()');assert.ok(closeAt>=0&&destroyAt>closeAt,'Discord client must be destroyed after HTTP graceful close begins');
});

test('windows launchers expose production, development and demo profiles',async()=>{
  const [start,dev,demo,launcher,pkgText]=await Promise.all([
    readFile(new URL('../START.cmd',import.meta.url),'utf8'),
    readFile(new URL('../DEV.cmd',import.meta.url),'utf8'),
    readFile(new URL('../DEMO.cmd',import.meta.url),'utf8'),
    readFile(new URL('../scripts/windows-start.js',import.meta.url),'utf8'),
    readFile(new URL('../package.json',import.meta.url),'utf8')
  ]);
  assert.match(start,/windows-start\.js/);assert.match(dev,/--dev/);assert.match(demo,/--demo/);assert.match(launcher,/APP_PROFILE/);assert.match(launcher,/개발 프로필/);const pkg=JSON.parse(pkgText);assert.match(pkg.scripts.dev,/--dev/);
});
