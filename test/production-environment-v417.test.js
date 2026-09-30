import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProductionEnvironmentValidation, assertProductionEnvironment } from '../src/production-environment.js';

const strongConfig=()=>({
  profile:'production',host:'0.0.0.0',port:3000,
  token:'discord-production-token-value-abcdefghijklmnopqrstuvwxyz',clientId:'123456789012345678',guildId:'234567890123456789',
  dashboardUser:'producer-admin',dashboardPassword:'Admin-Only-Password-2026!',dashboardOperatorUser:'mobile-operator',dashboardOperatorPassword:'Operator-Only-Password-2026!',dashboardOperatorCapabilities:['live','queue','broadcast'],
  broadcastToken:'broadcast-token-0123456789-unique-2026',publicBaseUrl:'https://bot.example.test/',viewerUrl:'https://bot.example.test/viewer/',
  naverClientId:'naver-client-id',naverClientSecret:'naver-client-secret-unique-2026',naverRedirectUri:'https://bot.example.test/naver/callback',naverCafeId:'123',naverMemoMenuId:'456',naverMenuId:'',naverTokenKey:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',naverMonitorEnabled:true,
  chzzkClientId:'chzzk-client-id',chzzkClientSecret:'chzzk-client-secret-unique-2026',chzzkChannelId:'0123456789abcdef0123456789abcdef',chzzkMonitorEnabled:true
});

test('production environment validation is launchable without exposing credential values',()=>{
  const config=strongConfig();
  const report=buildProductionEnvironmentValidation({config,now:1234});
  assert.equal(report.launchable,true);
  assert.equal(report.counts.blocking,0);
  assert.equal(report.checkedAt,1234);
  const serialized=JSON.stringify(report);
  for(const secret of [config.token,config.dashboardPassword,config.dashboardOperatorPassword,config.broadcastToken,config.naverClientSecret,config.naverTokenKey,config.chzzkClientSecret])assert.equal(serialized.includes(secret),false);
  assert.doesNotThrow(()=>assertProductionEnvironment(report));
});

test('external production blocks missing public HTTPS and broadcast protection',()=>{
  const config=strongConfig();
  config.publicBaseUrl='';config.broadcastToken='';
  const report=buildProductionEnvironmentValidation({config});
  assert.equal(report.launchable,false);
  assert.equal(report.checks.find(x=>x.id==='public-base-url').status,'fail');
  assert.equal(report.checks.find(x=>x.id==='broadcast-token').status,'fail');
  assert.throws(()=>assertProductionEnvironment(report),/Production 환경 검증 실패/);
});

test('credential reuse is a blocking production error but values are not reported',()=>{
  const config=strongConfig();
  config.broadcastToken=config.dashboardPassword;
  const report=buildProductionEnvironmentValidation({config});
  const reuse=report.checks.find(x=>x.id==='secret-reuse');
  assert.equal(reuse.status,'fail');
  assert.equal(report.launchable,false);
  assert.equal(JSON.stringify(report).includes(config.dashboardPassword),false);
});

test('configured Naver OAuth callback must use the production public origin',()=>{
  const config=strongConfig();
  config.naverRedirectUri='https://other.example.test/naver/callback';
  const report=buildProductionEnvironmentValidation({config});
  const callback=report.checks.find(x=>x.id==='naver-redirect');
  assert.equal(callback.status,'fail');
  assert.equal(callback.required,true);
  assert.equal(report.launchable,false);
});

test('optional Naver and CHZZK integrations do not prevent core production startup when absent',()=>{
  const config=strongConfig();
  for(const key of ['naverClientId','naverClientSecret','naverRedirectUri','naverCafeId','naverMemoMenuId','naverMenuId','naverTokenKey','chzzkClientId','chzzkClientSecret','chzzkChannelId'])config[key]='';
  config.naverMonitorEnabled=false;config.chzzkMonitorEnabled=false;
  const report=buildProductionEnvironmentValidation({config});
  assert.equal(report.launchable,true);
  assert.equal(report.checks.find(x=>x.id==='naver-client').status,'warn');
  assert.equal(report.checks.find(x=>x.id==='chzzk-client').status,'warn');
});

test('startup runs production environment validation before acquiring process lock',async()=>{
  const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
  const envAt=source.indexOf('startupEnvironmentValidation=buildProductionEnvironmentValidation');
  const assertAt=source.indexOf('assertProductionEnvironment(startupEnvironmentValidation)');
  const lockAt=source.indexOf('processLock=await acquireProcessLock');
  assert.ok(envAt>0&&assertAt>envAt&&lockAt>assertAt);
});

test('dashboard exposes safe environment validation panel and read-only endpoint',async()=>{
  const [html,client,app,pkg]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/app.js',import.meta.url),'utf8'),
    readFile(new URL('../package.json',import.meta.url),'utf8')
  ]);
  for(const id of ['environmentValidationBadge','environmentValidationSummary','environmentValidationCounts','environmentValidationChecklist'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/\/api\/environment-validation/);
  assert.match(client,/environment=d\.environmentValidation\|\|d\.startupEnvironmentValidation/);
  assert.match(app,/app\.get\('\/api\/environment-validation'/);
  assert.doesNotMatch(app,/app\.post\('\/api\/environment-validation'/);
  assert.equal(JSON.parse(pkg).scripts['env:check'],'node scripts/env-check.js');
});
