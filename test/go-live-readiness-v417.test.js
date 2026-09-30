import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGoLiveReadiness } from '../src/go-live-readiness.js';
import { dashboardCapabilityForRequest } from '../src/dashboard-access.js';

function base(){
  return {
    config:{profile:'production',host:'127.0.0.1',viewerUrl:'https://viewer.example.test/',dashboardOperatorUser:'operator',dashboardOperatorPassword:'operator-password-123',dashboardOperatorCapabilities:['live','queue','broadcast','discord'],broadcastToken:'',naverClientId:'id',naverClientSecret:'naver-secret-value',naverRedirectUri:'https://example.test/naver/callback',naverCafeId:'123',naverMenuId:'456',naverMemoMenuId:'789',naverTokenKey:'token-key-secret',chzzkClientId:'cid',chzzkClientSecret:'chzzk-secret-value',chzzkChannelId:'0123456789abcdef0123456789abcdef',chzzkMonitorEnabled:true},
    deployment:{status:'pass',summary:'ok',checks:[{id:'backup',status:'pass',detail:'recent'},{id:'soak',status:'pass',detail:'pass'}],selfCheck:{checks:[{id:'discord',status:'pass'},{id:'discord-config',status:'pass'}]}},
    naver:{connected:true},naverParticipation:{registrationOpen:false},chzzkLive:{settings:{enabled:true},state:{lastStatus:'pass'},connector:{configured:true}},emergency:{locked:false},incidents:{counts:{critical:0,open:0}}
  };
}

test('go-live readiness passes when core gate and integrations are ready',()=>{
  const result=buildGoLiveReadiness(base());
  assert.equal(result.status,'pass');assert.equal(result.launchable,true);assert.equal(result.fullyReady,true);assert.equal(result.actions.length,0);
});

test('go-live readiness blocks non-production profile and emergency lock',()=>{
  const input=base();input.config.profile='development';input.emergency={locked:true};
  const result=buildGoLiveReadiness(input);
  assert.equal(result.status,'fail');assert.equal(result.launchable,false);assert.ok(result.counts.blocking>=2);
  assert.equal(result.checks.find(item=>item.id==='profile').status,'fail');assert.equal(result.checks.find(item=>item.id==='emergency').status,'fail');
});

test('missing optional integrations warn without creating a launch blocker',()=>{
  const input=base();Object.assign(input.config,{viewerUrl:'',dashboardOperatorUser:'',dashboardOperatorPassword:'',naverClientId:'',naverClientSecret:'',naverRedirectUri:'',naverCafeId:'',naverMenuId:'',naverMemoMenuId:'',naverTokenKey:'',chzzkClientId:'',chzzkClientSecret:'',chzzkChannelId:'',chzzkMonitorEnabled:false});input.naver={connected:false};input.chzzkLive={settings:{enabled:false},state:{lastStatus:'idle'},connector:{configured:false}};
  const result=buildGoLiveReadiness(input);
  assert.equal(result.status,'warn');assert.equal(result.launchable,true);assert.ok(result.actions.some(item=>item.id==='naver'));assert.ok(result.actions.some(item=>item.id==='chzzk'));
});

test('go-live response never exposes secret values',()=>{
  const input=base();const result=buildGoLiveReadiness(input);const serialized=JSON.stringify(result);
  for(const secret of [input.config.naverClientSecret,input.config.naverTokenKey,input.config.chzzkClientSecret,input.config.dashboardOperatorPassword])assert.equal(serialized.includes(secret),false);
});

test('go-live dashboard uses read-only readiness endpoint and downloadable report',async()=>{
  const [html,client,server,palette]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/app.js',import.meta.url),'utf8'),readFile(new URL('../src/app.js',import.meta.url),'utf8'),readFile(new URL('../public/dashboard-command-palette-v415.js',import.meta.url),'utf8')
  ]);
  for(const id of ['goLiveOverall','goLiveBadge','goLiveSummary','goLiveActionCount','goLiveChecklist','goLiveActions'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/\/api\/go-live-readiness\?download=1/);assert.match(client,/\/api\/go-live-readiness/);assert.match(client,/Promise\.allSettled/);assert.match(server,/app\.get\('\/api\/go-live-readiness'/);assert.doesNotMatch(server,/app\.post\('\/api\/go-live-readiness'/);assert.equal(dashboardCapabilityForRequest('GET','/api/go-live-readiness'),null);assert.match(palette,/go-live/);assert.match(palette,/실서비스/);
});
