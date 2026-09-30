import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHostBootstrap } from '../src/host-bootstrap.js';
import { buildGoLiveReadiness } from '../src/go-live-readiness.js';

const baseConfig=()=>({profile:'production',host:'127.0.0.1',port:3000,publicBaseUrl:'',trustProxyHops:0,viewerUrl:'',dashboardPassword:'a-strong-dashboard-password'});

test('local host bootstrap is launchable without public exposure',()=>{
  const result=buildHostBootstrap({config:baseConfig(),env:{},nodeVersion:'22.22.2'});
  assert.equal(result.launchable,true);
  assert.equal(result.status,'pass');
  assert.equal(result.binding.loopback,true);
  assert.equal(result.health.path,'/healthz');
  assert.equal(result.runtime.gracefulTimeoutSeconds,10);
  assert.equal(result.persistence.required,true);
});

test('external binding requires a public HTTPS origin',()=>{
  const config={...baseConfig(),host:'0.0.0.0'};
  const result=buildHostBootstrap({config,env:{},nodeVersion:'22.22.2'});
  assert.equal(result.launchable,false);
  assert.equal(result.checks.find(item=>item.id==='public-url').status,'fail');
});

test('external HTTPS host with exact proxy hops is ready and Railway domain can be derived',()=>{
  const config={...baseConfig(),host:'0.0.0.0',trustProxyHops:1};
  const result=buildHostBootstrap({config,env:{RAILWAY_ENVIRONMENT:'production',RAILWAY_PUBLIC_DOMAIN:'bot.example.test'},nodeVersion:'22.22.2'});
  assert.equal(result.launchable,true);
  assert.equal(result.platform,'railway');
  assert.equal(result.public.baseUrl,'https://bot.example.test/');
  assert.equal(result.proxy.trustProxyHops,1);
});

test('host bootstrap does not serialize dashboard password or unrelated environment secrets',()=>{
  const config={...baseConfig(),host:'0.0.0.0',publicBaseUrl:'https://bot.example.test/',trustProxyHops:1,dashboardPassword:'do-not-leak-this-password'};
  const result=buildHostBootstrap({config,env:{DISCORD_TOKEN:'do-not-leak-token',NAVER_CLIENT_SECRET:'do-not-leak-naver'}});
  const text=JSON.stringify(result);
  for(const secret of ['do-not-leak-this-password','do-not-leak-token','do-not-leak-naver'])assert.equal(text.includes(secret),false);
});

test('go-live can treat a failed host bootstrap as a core blocker',()=>{
  const hostBootstrap=buildHostBootstrap({config:{...baseConfig(),host:'0.0.0.0'},env:{}});
  const result=buildGoLiveReadiness({
    config:{...baseConfig(),broadcastToken:'x'.repeat(24)},
    deployment:{status:'pass',checks:[{id:'backup',status:'pass'},{id:'soak',status:'pass'}],selfCheck:{checks:[{id:'discord',status:'pass'},{id:'discord-config',status:'pass'}]}},
    emergency:{locked:false},incidents:{counts:{critical:0,open:0}},hostBootstrap
  });
  assert.equal(result.checks.find(item=>item.id==='host-bootstrap').status,'fail');
  assert.equal(result.launchable,false);
});

test('production host artifacts and dashboard host bootstrap surface are shipped',async()=>{
  const [docker,ignore,envExample,deployDoc,html,client,server,pkgText,configText]=await Promise.all([
    readFile(new URL('../Dockerfile',import.meta.url),'utf8'),readFile(new URL('../.dockerignore',import.meta.url),'utf8'),readFile(new URL('../deploy/production.env.example',import.meta.url),'utf8'),readFile(new URL('../deploy/README_PRODUCTION.md',import.meta.url),'utf8'),readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/app.js',import.meta.url),'utf8'),readFile(new URL('../src/app.js',import.meta.url),'utf8'),readFile(new URL('../package.json',import.meta.url),'utf8'),readFile(new URL('../src/config.js',import.meta.url),'utf8')
  ]);
  assert.match(docker,/node:22\.22\.2/);assert.match(docker,/HEALTHCHECK/);assert.match(docker,/USER node/);
  assert.match(ignore,/\.env/);assert.match(ignore,/data\/\*/);assert.match(envExample,/PUBLIC_BASE_URL/);assert.match(envExample,/TRUST_PROXY_HOPS/);assert.match(deployDoc,/\/healthz/);
  for(const id of ['hostBootstrapBadge','hostBootstrapPlatform','hostBootstrapBind','hostBootstrapPublic','hostBootstrapProxy','hostBootstrapChecklist'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(client,/hostBootstrap/);assert.match(server,/app\.get\('\/api\/host-bootstrap'/);assert.match(server,/app\.set\('trust proxy'/);
  assert.match(configText,/PUBLIC_BASE_URL/);assert.match(configText,/TRUST_PROXY_HOPS/);
  const pkg=JSON.parse(pkgText);assert.equal(pkg.scripts.healthcheck,'node scripts/healthcheck.js');
});
