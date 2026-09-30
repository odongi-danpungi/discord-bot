import test from 'node:test';
import { APP_VERSION } from '../src/version.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildConnectorVerification, runConnectorProbes } from '../src/connector-verification.js';

test('connector verification keeps optional connectors non-blocking when unconfigured',()=>{
  const report=buildConnectorVerification({config:{token:'x'.repeat(30),clientId:'12345678901234567',guildId:'12345678901234567',publicBaseUrl:'https://bot.example.com'}});
  assert.equal(report.launchable,true);
  assert.equal(report.checks.find(x=>x.id==='naver-config').required,false);
  assert.equal(report.checks.find(x=>x.id==='chzzk-config').required,false);
});

test('oauth origin mismatch is blocking when redirect is configured',()=>{
  const report=buildConnectorVerification({config:{token:'x'.repeat(30),clientId:'12345678901234567',guildId:'12345678901234567',publicBaseUrl:'https://bot.example.com',naverRedirectUri:'https://other.example.com/naver/callback'}});
  assert.equal(report.launchable,false);
  assert.equal(report.checks.find(x=>x.id==='oauth-origin').status,'fail');
});

test('active probes call only read-only connector checks and expose no secrets',async()=>{
  const config={publicBaseUrl:'https://bot.example.com',chzzkChannelId:'a'.repeat(32)};
  const probes=await runConnectorProbes({config,discord:{diagnostics:async()=>({connected:true})},naver:{status:()=>({connected:true}),profile:async()=>({id:'private'})},chzzk:{getChannel:async()=>({channel:{channelId:config.chzzkChannelId}})},fetchImpl:async()=>({status:200,json:async()=>({status:'ok',ready:true,emergencyLocked:false,version:APP_VERSION})})});
  assert.equal(probes.discord.ok,true);assert.equal(probes.naver.ok,true);assert.equal(probes.chzzk.channelFound,true);assert.equal(probes.public.ok,true);
  const text=JSON.stringify(buildConnectorVerification({config,discordProbe:probes.discord,naverProbe:probes.naver,chzzkProbe:probes.chzzk,publicProbe:probes.public}));
  assert.equal(text.includes('private'),false);
});

test('dashboard has connector verification surface without inline handlers',()=>{
  const html=fs.readFileSync(path.resolve('public/index.html'),'utf8');
  const js=fs.readFileSync(path.resolve('public/app.js'),'utf8');
  assert.match(html,/Connector & OAuth Verification/);
  assert.match(html,/runConnectorVerification/);
  assert.doesNotMatch(html,/onclick=/i);
  assert.match(js,/connectorVerificationRefresh\(true\)/);
  assert.match(js,/\/api\/connector-verification/);
});

test('unknown Discord runtime state is advisory WARN instead of a false PASS',()=>{
  const report=buildConnectorVerification({config:{token:'x'.repeat(30),clientId:'12345678901234567',guildId:'12345678901234567'}});
  const live=report.checks.find(x=>x.id==='discord-live');
  assert.equal(live.status,'warn');
  assert.match(live.detail,/연결 확인 전/);
});

test('CHZZK live probe fails when configured target channel is not returned',()=>{
  const report=buildConnectorVerification({config:{token:'x'.repeat(30),clientId:'12345678901234567',guildId:'12345678901234567',chzzkClientId:'client',chzzkClientSecret:'secret',chzzkChannelId:'a'.repeat(32)},discordStatus:{connected:true},chzzkProbe:{ok:true,channelFound:false}});
  const live=report.checks.find(x=>x.id==='chzzk-live');
  assert.equal(live.status,'fail');
  assert.equal(live.required,false);
  assert.equal(report.launchable,true);
});

test('active connector probing uses CSRF-protected admin POST while status GET remains read-only',()=>{
  const app=fs.readFileSync(path.resolve('src/app.js'),'utf8');
  const client=fs.readFileSync(path.resolve('public/app.js'),'utf8');
  assert.match(app,/app\.get\('\/api\/connector-verification'/);
  assert.match(app,/app\.post\('\/api\/connector-verification\/probe'/);
  assert.match(app,/Production connector 실제 연결 검증은 관리자만/);
  assert.doesNotMatch(app,/req\.query\?\.probe/);
  assert.match(client,/request\(probe\?'\/api\/connector-verification\/probe':'\/api\/connector-verification',probe\?\{\}:undefined\)/);
  assert.doesNotMatch(client,/connector-verification\$\{probe\?'\?probe=1'/);
});
