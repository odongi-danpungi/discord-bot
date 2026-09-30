import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildProductionCutoverVerification } from '../src/production-cutover.js';

function readyInput(){
  return {
    acceptance:{verified:true,status:'pass',launchable:true,summary:'Production acceptance 검증을 통과했습니다.'},
    runtime:{status:'pass',uptimeMs:120000},
    incidents:{counts:{critical:0,warning:0,totalActive:0}},
    releaseState:{status:'smoke-passed'},
    manifest:{status:'pass',files:234,digest:'a'.repeat(64)},
    draining:false,trafficOpened:true,verified:true,now:1000
  };
}

test('post-cutover verification requires explicit current verification and traffic acknowledgement',()=>{
  const input=readyInput();input.verified=false;input.trafficOpened=false;
  const report=buildProductionCutoverVerification(input);
  assert.equal(report.status,'warn');
  assert.equal(report.stabilized,false);
  assert.equal(report.checks.find(item=>item.id==='traffic-cutover').status,'warn');
});

test('post-cutover verification passes when acceptance runtime incidents release and manifest are healthy',()=>{
  const report=buildProductionCutoverVerification(readyInput());
  assert.equal(report.status,'pass');
  assert.equal(report.stabilized,true);
  assert.equal(report.fullyStable,true);
  assert.equal(report.validity.expiresAt,1000+10*60*1000);
});

test('failed or unverified production acceptance blocks post-cutover stability',()=>{
  const input=readyInput();input.acceptance={verified:true,status:'fail',launchable:false};
  const report=buildProductionCutoverVerification(input);
  assert.equal(report.stabilized,false);
  assert.equal(report.checks.find(item=>item.id==='production-acceptance').status,'fail');
});

test('runtime health failure blocks post-cutover stability',()=>{
  const input=readyInput();input.runtime={status:'fail',uptimeMs:100};
  const report=buildProductionCutoverVerification(input);
  assert.equal(report.stabilized,false);
  assert.equal(report.checks.find(item=>item.id==='runtime-health').status,'fail');
});

test('critical incidents block while noncritical incidents remain warnings',()=>{
  const critical=readyInput();critical.incidents={counts:{critical:1,warning:0,totalActive:1}};
  assert.equal(buildProductionCutoverVerification(critical).stabilized,false);
  const warning=readyInput();warning.incidents={counts:{critical:0,warning:1,totalActive:1}};
  const report=buildProductionCutoverVerification(warning);
  assert.equal(report.stabilized,true);
  assert.equal(report.status,'warn');
});

test('release transitional and failed states block post-cutover stability',()=>{
  for(const status of ['restart-required','rollback-restart-required','transaction-recovery-incomplete','smoke-failed','apply-failed']){
    const input=readyInput();input.releaseState={status};
    const report=buildProductionCutoverVerification(input);
    assert.equal(report.stabilized,false,status);
    assert.equal(report.checks.find(item=>item.id==='release-state').status,'fail',status);
  }
});

test('idle release center is advisory for externally deployed production',()=>{
  const input=readyInput();input.releaseState={status:'idle'};
  const report=buildProductionCutoverVerification(input);
  assert.equal(report.stabilized,true);
  assert.equal(report.status,'warn');
  assert.equal(report.checks.find(item=>item.id==='release-state').status,'warn');
});

test('missing or malformed current code manifest fails closed',()=>{
  for(const manifest of [null,{status:'pass',files:0,digest:''},{status:'fail',detail:'failed'}]){
    const input=readyInput();input.manifest=manifest;
    const report=buildProductionCutoverVerification(input);
    assert.equal(report.stabilized,false);
    assert.equal(report.checks.find(item=>item.id==='code-manifest').status,'fail');
  }
});

test('draining service blocks post-cutover verification',()=>{
  const input=readyInput();input.draining=true;
  const report=buildProductionCutoverVerification(input);
  assert.equal(report.stabilized,false);
  assert.equal(report.checks.find(item=>item.id==='service-state').status,'fail');
});

test('post-cutover report contains no connector or dashboard secrets',()=>{
  const input=readyInput();input.acceptance={verified:true,status:'pass',launchable:true,summary:'safe'};
  const text=JSON.stringify(buildProductionCutoverVerification(input));
  for(const secret of ['bot-secret','oauth-token','client-secret','dashboard-password','csrf-secret'])assert.equal(text.includes(secret),false);
});

test('dashboard and server expose admin-only post-cutover verification without automatic traffic switching',()=>{
  const html=fs.readFileSync(path.resolve('public/index.html'),'utf8');
  const client=fs.readFileSync(path.resolve('public/app.js'),'utf8');
  const server=fs.readFileSync(path.resolve('src/app.js'),'utf8');
  assert.match(html,/Production Cutover &amp; Stabilization/);
  assert.match(html,/productionCutoverTrafficOpened/);
  assert.doesNotMatch(html,/onclick=/i);
  assert.match(client,/\/api\/production-cutover\/verify/);
  assert.match(server,/app\.get\('\/api\/production-cutover'/);
  assert.match(server,/app\.post\('\/api\/production-cutover\/verify'/);
  assert.match(server,/Post-Cutover 실제 검증은 관리자만/);
  assert.match(server,/trafficOpened!==true/);
  assert.doesNotMatch(server,/production-cutover\/verify'[\s\S]{0,800}(dns|proxy).*=(true|false)/i);
});
