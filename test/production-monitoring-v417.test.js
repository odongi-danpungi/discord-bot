import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductionMonitor } from '../src/production-monitoring.js';
import { runConnectorProbes } from '../src/connector-verification.js';
import { publicAddress,publicHealthUrl,retryDelay } from '../src/probe-http.js';
import { NaverService } from '../src/naver-service.js';
import { APP_VERSION } from '../src/version.js';
import { buildProductionCutoverVerification } from '../src/production-cutover.js';

const config={token:'test-only',clientId:'id',guildId:'guild',naverClientId:'id',naverClientSecret:'test-only',naverRedirectUri:'https://bot.example.com/naver/callback',chzzkClientId:'id',chzzkClientSecret:'test-only',chzzkChannelId:'channel',publicBaseUrl:'https://bot.example.com'};
const ready=()=>({runtime:{status:'pass'},incidents:{counts:{critical:0,warning:0,totalActive:0}},releaseState:{status:'idle'},emergency:{locked:false},draining:false,environment:{status:'pass'}});
const success=()=>Object.fromEntries(['discord','naver','chzzk','public'].map(id=>[id,{ok:true,channelFound:true}]));
test('monitor fails closed before first probe, expires at TTL and resets on restart',async()=>{
  let now=1000;const m=new ProductionMonitor({config,clock:()=>now,probe:async()=>success()});
  assert.equal(m.snapshot(ready()).ready,false);await m.run();assert.equal(m.snapshot(ready()).ready,true);
  now+=120000;assert.equal(m.snapshot(ready()).ready,false);now=999;assert.equal(m.snapshot(ready()).ready,false);
  assert.equal(new ProductionMonitor({config}).snapshot(ready()).ready,false);
});
test('dynamic shutdown, emergency, malformed incident and release states revoke a fresh success',async()=>{
  const m=new ProductionMonitor({config,probe:async()=>success()});await m.run();
  for(const override of [{draining:true},{emergency:{locked:true}},{recovering:true},{runtime:{}},{incidents:{}},{incidents:{counts:{critical:1,warning:0,totalActive:1}}},{environment:{status:'warn'}},...['restart-required','rollback-restart-required','transaction-recovery-incomplete','smoke-failed','unknown',undefined].map(status=>({releaseState:{status}}))])assert.equal(m.snapshot({...ready(),...override}).ready,false,JSON.stringify(override));
});
test('all four configured connectors are mandatory for production monitoring',async()=>{
  for(const key of ['discord','naver','chzzk','public']){const p=success();delete p[key];const m=new ProductionMonitor({config,probe:async()=>p});await m.run();assert.equal(m.snapshot(ready()).ready,false,key);}
  const m=new ProductionMonitor({config:{},probe:async()=>success()});await m.run();assert.equal(m.snapshot(ready()).ready,false);
});
test('concurrent probes coalesce, getters never probe, cooldown and Retry-After are enforced',async()=>{
  let now=1000,calls=0,resolve;const m=new ProductionMonitor({config,clock:()=>now,probe:()=>{calls++;return new Promise(r=>resolve=r);}});
  const a=m.run(),b=m.run();assert.equal(calls,1);assert.equal(m.snapshot(ready()).inFlight,true);
  resolve({...success(),public:{ok:false,error:{status:429,retryAfterMs:90000}}});await Promise.all([a,b]);
  for(let i=0;i<20;i++)m.snapshot(ready());assert.equal(calls,1);
  await assert.rejects(m.run(),e=>e.status===429&&e.retryAfterMs===90000);now+=89999;await assert.rejects(m.run());
});
test('history is bounded, contains only fixed failure codes and is returned as a copy',async()=>{
  let now=1000;const m=new ProductionMonitor({config,clock:()=>now,probe:async()=>({naver:{ok:false,error:{code:'upstream-secret',message:'private-person',status:401},payload:'secret-payload'}})});
  for(let i=0;i<25;i++){await m.run();now+=30000;}
  const r=m.snapshot(ready());assert.equal(r.history.length,20);
  assert.doesNotMatch(JSON.stringify(r),/upstream-secret|private-person|secret-payload|test-only/);
  r.history[0].results[0].code='changed';assert.notEqual(m.snapshot(ready()).history[0].results[0].code,'changed');
});
test('Discord incomplete diagnostics and missing permissions cannot pass; stalled calls do not pile up',async()=>{
  for(const d of [undefined,{}, {connected:true,checks:[{ok:false}]}])assert.equal((await runConnectorProbes({discord:{diagnostics:async()=>d}})).discord.ok,false);
  let calls=0,resolve;const discord={diagnostics:()=>{calls++;return new Promise(r=>resolve=r);}};
  assert.equal((await runConnectorProbes({discord,timeoutMs:10})).discord.error.code,'ETIMEDOUT');
  assert.equal((await runConnectorProbes({discord,timeoutMs:10})).discord.error.code,'PROBE_BUSY');assert.equal(calls,1);resolve({connected:true});
});
test('public health checks response body, version, lock and redirect instead of accepting HTTP 200 alone',async()=>{
  for(const body of [{}, {version:'old',status:'ok',ready:true,emergencyLocked:false},{version:APP_VERSION,status:'ok',ready:false,emergencyLocked:false},{version:APP_VERSION,status:'ok',ready:true,emergencyLocked:true}]){
    const p=await runConnectorProbes({config,healthReader:async()=>({status:200,body})});assert.equal(p.public.ok,false);
  }
  assert.equal((await runConnectorProbes({config,healthReader:async()=>({status:302})})).public.ok,false);
  assert.equal((await runConnectorProbes({config,healthReader:async()=>({status:200,body:{version:APP_VERSION,status:'ok',ready:true,emergencyLocked:false}})})).public.ok,true);
});
test('public probe rejects local, metadata, private, credential-bearing and non-HTTPS targets',()=>{
  for(const url of ['http://bot.example.com','https://127.0.0.1','https://localhost','https://169.254.169.254','https://10.0.0.1','https://user:password@bot.example.com','https://bot.example.com/path','https://bot.example.com?token=private'])assert.throws(()=>publicHealthUrl(url),undefined,url);
  for(const ip of ['::1','::ffff:127.0.0.1','fc00::1','fe80::1','192.168.1.1','100.64.0.1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(retryDelay('120'),120000);
});
test('Naver diagnostic GET never refreshes tokens, returns PII, or retries authentication failure',async()=>{
  let calls=0,saves=0;const service=new NaverService({config,authStore:{token:()=>({accessToken:'test-access',expiresAt:Date.now()+10000}),saveToken:()=>saves++},fetchImpl:async(url,options)=>{calls++;assert.equal(String(url),'https://openapi.naver.com/v1/nid/me');assert.equal(options.method,'GET');return new Response(JSON.stringify({resultcode:'00',response:{id:'private-id',name:'private-name'}}));}});
  assert.deepEqual(await service.profile({readOnly:true}),{ok:true});assert.equal(calls,1);assert.equal(saves,0);
  service.fetch=async()=>{calls++;return new Response(JSON.stringify({message:'upstream-private'}),{status:401});};
  await assert.rejects(service.profile({readOnly:true}),e=>e.message==='Naver read-only probe failed');assert.equal(calls,2);assert.equal(saves,0);
});
test('expired Naver token does not cause a token endpoint request during diagnostics',async()=>{
  const service=new NaverService({config,authStore:{token:()=>({accessToken:'test-access',expiresAt:1})},fetchImpl:()=>{throw Error('must not call');}});
  await assert.rejects(service.profile({readOnly:true}),e=>e.code==='OAUTH_RECONNECT_REQUIRED');
});
test('Step 6 rejects malformed runtime, incident and missing release status',()=>{
  const base={acceptance:{verified:true,launchable:true,status:'pass'},runtime:{status:'pass'},incidents:{counts:{critical:0,warning:0,totalActive:0}},releaseState:{status:'idle'},manifest:{files:1,digest:'a'.repeat(64)},verified:true,trafficOpened:true};
  for(const override of [{runtime:{}},{incidents:{}},{releaseState:{}}])assert.equal(buildProductionCutoverVerification({...base,...override}).stabilized,false);
});


test('deployment contract compares all expected fields and never echoes their contents',async()=>{
 const {compareDeploymentContract}=await import('../src/deployment-contract.js');
 const expected={schema:'daengdaeng-deployment-contract-v1',version:APP_VERSION,manifestDigest:'a'.repeat(64),publicBaseUrl:'https://private-host.example/',naverRedirectUri:'https://private-host.example/naver/callback',host:'0.0.0.0',port:3000};
 assert.equal(compareDeploymentContract({expected,actual:expected}).status,'pass');
 for(const id of ['version','manifestDigest','publicBaseUrl','naverRedirectUri','host','port']){const actual={...expected,[id]:'different-secret'};const result=compareDeploymentContract({expected,actual});assert.equal(result.status,'fail');assert.doesNotMatch(JSON.stringify(result),/different-secret|private-host/);}
 assert.equal(compareDeploymentContract({}).status,'fail');
});


test('monitoring blockers override optional connector acceptance and shorten validity',async()=>{
 const {buildProductionAcceptance}=await import('../src/production-acceptance.js');
 const input={deployment:{status:'pass'},goLive:{status:'pass',launchable:true},connectorVerification:{status:'pass',launchable:true},releaseState:{status:'idle'},verified:true,now:1000,monitoring:{ready:false,expiresAt:121000}};
 assert.equal(buildProductionAcceptance(input).launchable,false);input.monitoring.ready=true;
 const accepted=buildProductionAcceptance(input);assert.equal(accepted.launchable,true);assert.equal(accepted.validity.expiresAt,121000);
 const cutover=buildProductionCutoverVerification({acceptance:accepted,runtime:{status:'pass'},incidents:{counts:{critical:0,warning:0,totalActive:0}},releaseState:{status:'idle'},manifest:{files:1,digest:'a'.repeat(64)},verified:true,trafficOpened:true,now:2000});
 assert.equal(cutover.validity.expiresAt,121000);
});
