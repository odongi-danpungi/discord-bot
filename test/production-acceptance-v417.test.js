import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildProductionAcceptance } from '../src/production-acceptance.js';

function readyInput(){
  return {
    deployment:{status:'pass',summary:'배포 전 필수 점검을 통과했습니다.'},
    goLive:{status:'pass',launchable:true,summary:'실서비스 준비 완료'},
    connectorVerification:{status:'pass',launchable:true,probed:true},
    releaseState:{status:'smoke-passed'},draining:false,verified:true,now:1000
  };
}

test('production acceptance requires an explicit live verification run',()=>{
  const input=readyInput();input.verified=false;
  const report=buildProductionAcceptance(input);
  assert.equal(report.status,'warn');
  assert.equal(report.launchable,false);
  assert.equal(report.checks.find(item=>item.id==='live-verification').status,'warn');
});

test('production acceptance passes when core gates, connectors and release state are healthy',()=>{
  const report=buildProductionAcceptance(readyInput());
  assert.equal(report.status,'pass');
  assert.equal(report.launchable,true);
  assert.equal(report.fullyAccepted,true);
  assert.equal(report.validity.expiresAt,1000+15*60*1000);
});

test('optional connector failures remain advisory when connector verification remains launchable',()=>{
  const input=readyInput();input.connectorVerification={status:'fail',launchable:true,probed:true};
  const report=buildProductionAcceptance(input);
  assert.equal(report.status,'warn');
  assert.equal(report.launchable,true);
  assert.equal(report.fullyAccepted,false);
  assert.equal(report.checks.find(item=>item.id==='connectors').status,'warn');
});

test('pending restart or rollback blocks production cutover',()=>{
  for(const releaseStatus of ['restart-required','rollback-restart-required','transaction-recovery-incomplete']){
    const input=readyInput();input.releaseState={status:releaseStatus};
    const report=buildProductionAcceptance(input);
    assert.equal(report.launchable,false,releaseStatus);
    assert.equal(report.checks.find(item=>item.id==='release-state').status,'fail',releaseStatus);
  }
});


test('missing core readiness data fails closed instead of producing a false launchable result',()=>{
  const report=buildProductionAcceptance({verified:true,connectorVerification:{status:'pass',launchable:true},releaseState:{status:'idle'}});
  assert.equal(report.launchable,false);
  assert.equal(report.checks.find(item=>item.id==='deployment-gate').status,'fail');
  assert.equal(report.checks.find(item=>item.id==='go-live').status,'fail');
});

test('missing Release Center state fails closed',()=>{
  const input=readyInput();input.releaseState=null;
  const report=buildProductionAcceptance(input);
  assert.equal(report.launchable,false);
  assert.equal(report.checks.find(item=>item.id==='release-state').status,'fail');
});

test('draining service blocks production acceptance',()=>{
  const input=readyInput();input.draining=true;
  const report=buildProductionAcceptance(input);
  assert.equal(report.launchable,false);
  assert.equal(report.checks.find(item=>item.id==='service-state').status,'fail');
});

test('production acceptance output stays status-only and contains no connector secrets',()=>{
  const input=readyInput();input.connectorVerification={status:'pass',launchable:true,checks:[{detail:'safe'}]};
  const text=JSON.stringify(buildProductionAcceptance(input));
  for(const secret of ['bot-secret','oauth-token','client-secret','dashboard-password'])assert.equal(text.includes(secret),false);
});

test('dashboard and server expose admin POST live acceptance flow',()=>{
  const html=fs.readFileSync(path.resolve('public/index.html'),'utf8');
  const client=fs.readFileSync(path.resolve('public/app.js'),'utf8');
  const server=fs.readFileSync(path.resolve('src/app.js'),'utf8');
  assert.match(html,/Production Acceptance &amp; Cutover/);
  assert.match(html,/runProductionAcceptance/);
  assert.match(html,/downloadProductionAcceptance/);
  assert.doesNotMatch(html,/onclick=/i);
  assert.match(client,/\/api\/production-acceptance\/verify/);
  assert.match(server,/app\.get\('\/api\/production-acceptance'/);
  assert.match(server,/app\.post\('\/api\/production-acceptance\/verify'/);
  assert.match(server,/Production acceptance 실제 검증은 관리자만/);
});
