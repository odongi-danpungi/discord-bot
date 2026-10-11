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

const readinessFixture=()=>({checkedAt:Date.UTC(2026,9,11,3),evidence:'local',productionVerification:'pending',paused:false,summary:{configured:1,total:4,attention:1},checks:[
  {id:'discord',title:'Discord 채널 준비',status:'configured',detail:'현재 서버의 채널 설정이 저장되어 있습니다.',action:{page:'discord',label:'채널 준비 확인'}},
  {id:'chzzk',title:'방송 계정 연결',status:'attention',detail:'운영할 방송 계정을 연결해 주세요.',action:{page:'chzzk',label:'방송 계정 연결'}},
  {id:'live',title:'실제 연결 확인',status:'pending',detail:'실제 인증은 아직 검증하지 않았습니다.',action:null},
  {id:'naver',title:'네이버 카페',status:'optional',detail:'카페를 운영할 때 연결하세요.',action:{page:'naver',label:'네이버 계정 연결'}}
],handoff:{text:'댕댕봇 운영 인수인계\n저장된 설정 기준\n실제 연결 검증 대기\nDiscord 채널 설정 완료'}});
test('onboarding shows sequential local checks and only performs scoped GET requests on refresh',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(url.endsWith('/readiness')?readinessFixture():defaults(url));},'?server='+A);
  assert.ok([...w.document.querySelectorAll('#panel button')].some(b=>b.textContent==='운영 시작 안내'));
  await w.portalTest.page('onboarding');
  assert.equal(w.document.getElementById('breadcrumb').textContent,'통합 운영 / 운영 준비 / 운영 시작 안내');
  assert.equal(w.document.querySelectorAll('.readiness-list>li').length,4);
  assert.match(w.document.getElementById('panel').textContent,/저장된 설정 기준/);assert.match(w.document.getElementById('panel').textContent,/실제 연결 검증 대기/);
  for(const label of ['설정 완료','확인 필요','검증 대기','선택 사항'])assert.match(w.document.getElementById('panel').textContent,new RegExp(label));
  await [...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='설정 상태 새로고침').onclick();
  assert.equal(calls.filter(c=>c.url==='/w/'+A+'/readiness').length,2);
  assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.body===undefined),'view and refresh must not mutate settings or external services');
});
test('onboarding ignores unstructured secrets and arbitrary destinations and renders HTML as inert text',async t=>{
  const fixture=readinessFixture();fixture.secret='fixture-secret-do-not-render';fixture.rawTokens={accessToken:'fixture-token-do-not-render'};fixture.summary.secret='summary-secret-do-not-render';
  fixture.checks[0].raw='check-secret-do-not-render';fixture.checks[0].title='<img src=x onerror=alert(1)>';
  fixture.checks.push({id:'unknown',title:'임의 링크',status:'pending',detail:'안전한 내용',action:{page:'https://attacker.invalid/steal',label:'임의 이동'}},{id:'unsupported',title:'unknown-secret-do-not-render',status:'passed',detail:'unsupported-secret-do-not-render',action:null});
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(url.endsWith('/readiness')?fixture:defaults(url));},'?server='+A+'&page=onboarding');
  const panel=w.document.getElementById('panel');assert.doesNotMatch(panel.textContent,/secret-do-not-render|token-do-not-render|임의 이동|https:\/\/attacker/);assert.equal(panel.querySelector('img'),null);assert.match(panel.textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(panel.querySelector('a'),null);
  await [...panel.querySelectorAll('button')].find(b=>b.textContent==='채널 준비 확인').onclick();assert.equal(w.document.getElementById('title').textContent,'서버 채널 준비');
  assert.ok(calls.every(c=>c.options.method==='GET'),'opening the checked settings screen does not execute channel setup');
});
test('late readiness responses cannot overwrite the selected server screen',async t=>{
  let resolveOld;const w=await portal(t,url=>url==='/w/'+A+'/readiness'?new Promise(resolve=>{resolveOld=resolve;}):response(defaults(url)),'?server='+A);
  const old=w.portalTest.page('onboarding');w.document.getElementById('servers').value=B;await w.portalTest.selectServer();
  const fixture=readinessFixture();fixture.checks[0].title='오래된 서버 A 설정';resolveOld({ok:true,json:async()=>fixture});await assert.rejects(old,error=>error.stale===true);
  assert.equal(w.location.search,'?server='+B);assert.equal(w.document.getElementById('title').textContent,'운영 홈');assert.doesNotMatch(w.document.body.textContent,/오래된 서버 A 설정/);
});
test('handoff copies and downloads only the read-only summary without raw payload data',async t=>{
  const fixture=readinessFixture();fixture.handoff.raw={token:'raw-secret-do-not-export'};fixture.secret='payload-secret-do-not-export';fixture.handoff.text+='\n<svg onload=alert(1)>\u0000';
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(url.endsWith('/readiness')?fixture:defaults(url));},'?server='+A+'&page=handoff');
  const textarea=w.document.querySelector('.handoff-text');assert.equal(textarea.readOnly,true);assert.equal(textarea.value,fixture.handoff.text.replace(/\u0000/g,''));assert.equal(w.document.querySelector('#panel svg'),null);
  let copied,blob,download,revoked;Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
  await [...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='요약 복사').onclick();assert.equal(copied,textarea.value);
  w.Blob=class{constructor(parts,options){this.parts=parts;this.options=options;}};w.URL.createObjectURL=value=>{blob=value;return 'blob:https://example.invalid/fixture';};w.URL.revokeObjectURL=url=>{revoked=url;};w.HTMLAnchorElement.prototype.click=function(){download=this.download;};
  const timeout=w.setTimeout;w.setTimeout=callback=>{callback();return 1;};
  try{await [...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='요약 TXT 저장').onclick();}finally{w.setTimeout=timeout;}
  assert.equal(download,'daengdaeng-handoff.txt');assert.ok(!download.includes(A));assert.equal(revoked,'blob:https://example.invalid/fixture');assert.deepEqual([...blob.parts],[textarea.value]);assert.match(blob.parts[0],/인수인계\n저장된 설정 기준\n실제 연결 검증 대기/);assert.equal(blob.options.type,'text/plain;charset=utf-8');assert.doesNotMatch(copied,/secret-do-not-export/);assert.ok(calls.every(c=>c.options.method==='GET'));
});
test('handoff copy failures explain manual copying and do not expose clipboard error details',async t=>{
  const w=await portal(t,url=>response(url.endsWith('/readiness')?readinessFixture():defaults(url)),'?server='+A+'&page=handoff');
  const copy=[...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='요약 복사');await copy.onclick();assert.match(w.document.getElementById('notice').textContent,/직접 복사/);
  Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('clipboard-private-internal-error');}}});await copy.onclick();assert.match(w.document.getElementById('notice').textContent,/복사하지 못했습니다/);assert.doesNotMatch(w.document.body.textContent,/clipboard-private-internal-error/);
});
test('participants cannot open operator readiness or handoff screens',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(url==='/portal/api/servers/'+A?{guildId:A,name:'방송 A',role:'participant'}:defaults(url));},'?server='+A+'&page=onboarding');
  await w.portalTest.page('onboarding');await w.portalTest.page('handoff');assert.equal(w.document.getElementById('title').textContent,'내 참가 상태');assert.equal(w.document.querySelectorAll('[data-page]').length,0);assert.ok(!calls.some(c=>c.url.endsWith('/readiness')));assert.doesNotMatch(w.document.getElementById('panel').textContent,/운영 시작 안내|운영 인수인계/);
});
