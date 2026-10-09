import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { workspaceAsset } from '../src/workspace-assets.js';
const A='111111111111111111',B='222222222222222222';
async function portal(t,fetcher,query=''){
  const html=await readFile(new URL('../public/portal.html',import.meta.url),'utf8'),source=await readFile(new URL('../public/portal.js',import.meta.url),'utf8');
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(html,{url:'https://example.invalid/portal/'+query,runScripts:'outside-only',virtualConsole});
  t.after(async()=>{await new Promise(resolve=>setTimeout(resolve,20));for(const node of dom.window.document.querySelectorAll('details'))node.ontoggle=null;dom.window.close();assert.deepEqual(errors,[],'portal must not raise unhandled DOM errors');});
  dom.window.fetch=fetcher;dom.window.confirm=()=>true;
  await dom.window.eval('(async()=>{'+source+';globalThis.portalTest={page,selectServer};})()');return dom.window;
}
const response=data=>Promise.resolve({ok:true,json:async()=>structuredClone(data)});
const defaults=url=>url==='/portal/auth/session'?{authenticated:true,user:{name:'가상 운영자'},csrf:'fixture-csrf'}:url==='/portal/api/servers'?{servers:[{id:A,name:'방송 A',botPresent:true},{id:B,name:'방송 B',botPresent:true}],installUrl:'https://discord.com/oauth2/authorize'}:url.startsWith('/portal/api/servers/')?{guildId:url.split('/').at(-1),name:'선택한 방송',role:'operator'}:url.endsWith('/api/snapshot')?{state:{session:null},participationQueue:{activeCount:0},paused:false}:{};
test('late server responses never replace the active server or redirect subsequent mutations',async t=>{
  let delayed;const calls=[];
  const w=await portal(t,(url,options)=>{calls.push({url,options});if(url==='/portal/api/servers/'+A)return new Promise(resolve=>{delayed=resolve;});return response(defaults(url));});
  const select=w.document.getElementById('servers');select.value=A;const first=w.portalTest.selectServer();
  select.value=B;await w.portalTest.selectServer();delayed({ok:true,json:async()=>({guildId:A,name:'stale A',role:'operator'})});await first;
  assert.equal(w.location.search,'?server='+B);assert.doesNotMatch(w.document.body.textContent,/stale A/);
  await w.portalTest.page('discord');const button=[...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='서버 채널 준비');await button.onclick();
  assert.ok(calls.some(c=>c.url==='/w/'+B+'/api/operations/setup'));assert.ok(!calls.some(c=>c.url==='/w/'+A+'/api/operations/setup'));
  assert.doesNotMatch(w.document.getElementById('menu').textContent,/런타임|롤백|복구|Secret|진단/);
});
test('participant portal offers only personal entry and preserves the invitation round through login',async t=>{
  const w=await portal(t,url=>response(url==='/portal/api/servers/'+A?{guildId:A,name:'방송 A',role:'participant'}:defaults(url)),'?server='+A+'&session=round-test');
  assert.equal(w.document.querySelectorAll('[data-page]').length,0);
  const links=[...w.document.querySelectorAll('#panel a')];assert.equal(links[0].getAttribute('href'),'/w/'+A+'/viewer/?session=round-test');
  const anon=await portal(t,()=>response({authenticated:false,configured:true}),'?server='+A+'&session=round-test');
  assert.equal(anon.document.querySelector('#panel a').getAttribute('href'),'/portal/auth/login?server='+A+'&session=round-test');
});
test('selected Queue actions and schedules submit supported backend schemas',async t=>{
  const calls=[];const w=await portal(t,(url,options)=>{calls.push({url,options});return response(url.endsWith('/api/participation-queue')?{queue:{entries:[{id:'q_example',position:1,displayName:'가상 참가자',source:'dashboard',status:'waiting'}]}}:url.endsWith('/api/broadcast-ops')?{schedules:[]}:defaults(url));},'?server='+A);
  await w.portalTest.page('queue');w.document.querySelector('.person').click();await [...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='참가 확인').onclick();
  assert.ok(calls.some(c=>c.url.endsWith('/status')&&JSON.parse(c.options.body).status==='joined'));
  await w.portalTest.page('schedule');const f=w.document.querySelector('form');f.elements.title.value='테스트 일정';f.elements.startAt.value='2030-10-09T20:00';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setImmediate(r));const saved=calls.find(c=>c.url.endsWith('/api/broadcast-ops/schedule'));assert.ok(saved);assert.ok(Number.isFinite(JSON.parse(saved.options.body).startAt));
});
test('scoped assets keep participant, race and preparation pages inside their workspace',async()=>{
  async function read(p,query={}){let body;const res={type(){return this;},send(text){body=text;},redirect(){throw Error('unexpected redirect');}};assert.equal(await workspaceAsset({method:'GET',path:p,query},res,A),true);return body;}
  assert.match(await read('/viewer/viewer.js'),new RegExp('/w/'+A+'/viewer/api/'));
  assert.match(await read('/game-studio.js'),new RegExp('/w/'+A+'/api/snapshot'));
  assert.doesNotMatch(await read('/community.html'),/navigation-tree.js|business-theme.css/);
  const ready=new JSDOM(await read('/operation-tools.html',{feature:'ready'}));assert.equal(ready.window.document.getElementById('ready').hidden,false);assert.equal(ready.window.document.getElementById('undo').hidden,true);ready.window.close();
  assert.equal(await workspaceAsset({method:'GET',path:'/index.html',query:{}},{},A),false);
  assert.equal(await workspaceAsset({method:'GET',path:'/broadcast/assets/app.js',query:{}},{},A),false);
});

test('OBS links open the selected feature while invalid page values fall back to home',async t=>{
  const w=await portal(t,url=>response(defaults(url)),'?server='+A+'&page=obs');
  assert.equal(w.document.getElementById('title').textContent,'OBS 화면');
  assert.ok([...w.document.querySelectorAll('#panel button')].some(b=>b.textContent==='OBS 주소 복사'));
  const invalid=await portal(t,url=>response(defaults(url)),'?server='+A+'&page=../../creator');
  assert.equal(invalid.document.getElementById('title').textContent,'운영 홈');
});
