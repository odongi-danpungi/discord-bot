import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { workspaceAsset } from '../src/workspace-assets.js';
import { newPractice, practiceAction } from '../public/practice-model.js';
const A='111111111111111111',B='222222222222222222';
async function portal(t,fetcher,query=''){
  const html=await readFile(new URL('../public/portal.html',import.meta.url),'utf8'),source=await readFile(new URL('../public/portal.js',import.meta.url),'utf8');
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(html,{url:'https://example.invalid/portal/'+query,runScripts:'outside-only',virtualConsole});
  t.after(async()=>{await new Promise(resolve=>setTimeout(resolve,20));for(const node of dom.window.document.querySelectorAll('details'))node.ontoggle=null;dom.window.close();assert.deepEqual(errors,[],'portal must not raise unhandled DOM errors');});
  dom.window.fetch=fetcher;dom.window.confirm=()=>true;dom.window.newPractice=newPractice;dom.window.practiceAction=practiceAction;
  await dom.window.eval('(async()=>{'+source.replace(/^import \{newPractice,practiceAction\} from '\.\/practice-model\.js';\r?\n/,'')+';globalThis.portalTest={page,selectServer};})()');return dom.window;
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

const communityFixture=()=>({revision:41,settings:{channelId:'333333333333333333',roles:{aram:'444444444444444444',live:'555555555555555555'},fairness:{enabled:false,unplayedFirst:true,waitFirst:false,maxConsecutive:0,newcomerSlots:0}},session:{phase:'open'}});
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const submit=async(w,form)=>{form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();};
test('native recruitment rules preserve hidden channel and role settings and use the loaded community revision',async t=>{
  const calls=[],fixture=communityFixture(),w=await portal(t,(url,options)=>{calls.push({url,options});if(options.method==='POST')fixture.revision++;return response(url.endsWith('/api/community')?fixture:defaults(url));},'?server='+A+'&page=recruitment-rules');
  assert.equal(w.document.getElementById('breadcrumb').textContent,'통합 운영 / 참가 설정 / 참가 선발 규칙');
  assert.match(w.document.getElementById('panel').textContent,/다음에 여는 모집부터/);assert.match(w.document.getElementById('panel').textContent,/현재 열린 회차.*바뀌지/);
  const f=w.document.querySelector('form');f.elements.enabled.checked=true;f.elements.unplayedFirst.checked=false;f.elements.waitFirst.checked=true;f.elements.maxConsecutive.value='2';f.elements.newcomerSlots.value='1';await submit(w,f);
  const saved=calls.find(c=>c.url==='/w/'+A+'/api/community/settings');assert.ok(saved);const payload=JSON.parse(saved.options.body);
  assert.deepEqual(payload,{revision:41,channelId:fixture.settings.channelId,roles:fixture.settings.roles,fairness:{enabled:true,unplayedFirst:false,waitFirst:true,maxConsecutive:2,newcomerSlots:1}});
  assert.equal(saved.options.headers['X-CSRF-Token'],'fixture-csrf');assert.ok(!calls.some(c=>/\/operations\/|\/community\/(publish|panel)/.test(c.url)));
  await submit(w,w.document.querySelector('form'));assert.equal(JSON.parse(calls.filter(c=>c.options.method==='POST').at(-1).options.body).revision,42,'a successful save reloads the fresh revision before the next edit');
  assert.equal(w.document.querySelectorAll('[data-page="fairness"]').length,0);await w.portalTest.page('fairness');assert.equal(w.document.getElementById('title').textContent,'참가 선발 규칙','legacy fairness entry remains supported without a duplicate menu');
});

test('settings conflicts keep edited inputs and require an explicit refresh before replacement',async t=>{
  const calls=[],fixture=communityFixture(),w=await portal(t,(url,options)=>{calls.push({url,options});if(options.method==='POST')return Promise.resolve({ok:false,status:409,json:async()=>({error:'다른 창에서 변경되었습니다.'})});return response(url.endsWith('/api/community')?fixture:defaults(url));},'?server='+A+'&page=recruitment-rules');
  const f=w.document.querySelector('form');f.elements.enabled.checked=true;f.elements.maxConsecutive.value='3';f.elements.maxConsecutive.dispatchEvent(new w.Event('input',{bubbles:true}));await submit(w,f);
  assert.equal(w.document.querySelector('form'),f);assert.equal(f.elements.maxConsecutive.value,'3');assert.equal(f.elements.enabled.checked,true);assert.equal(f.querySelector('button').disabled,false);assert.match(f.querySelector('.settings-feedback').textContent,/입력 내용은 유지/);
  const refresh=[...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='새 설정 불러오기');w.confirm=()=>false;await refresh.onclick();assert.equal(w.document.querySelector('form'),f);w.confirm=()=>true;await refresh.onclick();assert.equal(w.document.querySelector('form').elements.maxConsecutive.value,'0');
  assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
});

test('late recruitment settings cannot replace the new server and detached forms cannot save to it',async t=>{
  let resolveOld;const calls=[],fixture=communityFixture(),w=await portal(t,(url,options)=>{calls.push({url,options});return response(url.endsWith('/api/community')?fixture:defaults(url));},'?server='+A+'&page=recruitment-rules');
  const oldForm=w.document.querySelector('form');w.document.getElementById('servers').value=B;await w.portalTest.selectServer();await submit(w,oldForm);assert.ok(calls.every(c=>c.options.method==='GET'));
  w.fetch=(url,options)=>url==='/w/'+B+'/api/community'?new Promise(resolve=>{resolveOld=resolve;}):response(defaults(url));const delayed=w.portalTest.page('recruitment-rules');w.document.getElementById('servers').value=A;await w.portalTest.selectServer();resolveOld({ok:true,json:async()=>fixture});await assert.rejects(delayed,error=>error.stale===true);assert.equal(w.document.getElementById('title').textContent,'운영 홈');assert.equal(w.document.querySelector('.settings-form'),null);
});

test('call time validates integer bounds and saves only timeout and loaded revision for future calls',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(url.endsWith('/call-settings')?{settings:{timeoutSeconds:90},revision:17}:defaults(url));},'?server='+A+'&page=call-settings');
  assert.match(w.document.getElementById('panel').textContent,/이미 호출한 참가자의 응답 마감 시간은 유지/);const f=w.document.querySelector('form'),input=f.elements.timeoutSeconds;assert.equal(input.min,'15');assert.equal(input.max,'300');
  for(const invalid of ['14','301','15.5','']){input.value=invalid;await submit(w,f);assert.ok(!calls.some(c=>c.options.method==='POST'));assert.match(w.document.getElementById('notice').textContent,/15~300초/);}
  input.value='120';await submit(w,f);const saved=calls.find(c=>c.options.method==='POST');assert.equal(saved.url,'/w/'+A+'/call-settings');assert.deepEqual(JSON.parse(saved.options.body),{timeoutSeconds:120,revision:17});assert.ok(!calls.some(c=>/\/call$|\/call-next$/.test(c.url)));
});

test('call conflicts retain the proposed timeout without changing a current participant deadline',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});if(options.method==='POST')return Promise.resolve({ok:false,status:409,json:async()=>({error:'설정이 변경되었습니다.'})});return response(url.endsWith('/call-settings')?{settings:{timeoutSeconds:90},revision:17}:defaults(url));},'?server='+A+'&page=call-settings');
  const f=w.document.querySelector('form');f.elements.timeoutSeconds.value='180';await submit(w,f);assert.equal(f.elements.timeoutSeconds.value,'180');assert.match(f.querySelector('.settings-feedback').textContent,/입력 내용은 유지/);assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
});

test('portal practice runs one local step at a time through completion without any API calls',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(defaults(url));},'?server='+A+'&page=practice');const before=calls.length;
  assert.match(w.document.getElementById('panel').textContent,/실제 운영에 반영되지 않습니다/);assert.equal(w.document.querySelectorAll('.practice-progress li').length,6);assert.equal(w.document.querySelectorAll('.practice-progress button').length,0);
  for(const action of ['register','call','ready','draw','teams','end']){const buttons=w.document.querySelectorAll('[data-practice-action]');assert.equal(buttons.length,1);assert.equal(buttons[0].dataset.practiceAction,action);buttons[0].click();buttons[0].click();}
  assert.equal(w.document.querySelectorAll('[data-practice-action]').length,0);assert.match(w.document.querySelector('.practice-stage').textContent,/연습 완료/);assert.match(w.document.querySelector('.practice-stage').textContent,/선발 6명/);assert.match(w.document.querySelector('.practice-stage').textContent,/팀 A.*연습 참가자/);assert.equal(calls.length,before,'practice must not fetch or mutate operational APIs');
  assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);w.document.querySelector('.practice-stage').innerHTML='<p>changed local DOM</p>';await w.portalTest.page('practice');assert.equal(w.document.querySelector('[data-practice-action]').dataset.practiceAction,'register');assert.equal(calls.length,before);
});

test('practice reset and page or server changes discard local state and stale controls',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(defaults(url));},'?server='+A+'&page=practice');w.document.querySelector('[data-practice-action]').click();const stale=w.document.querySelector('[data-practice-action]');assert.equal(stale.dataset.practiceAction,'call');
  [...w.document.querySelectorAll('#panel button')].find(b=>b.textContent==='연습 초기화').click();assert.equal(w.document.querySelector('[data-practice-action]').dataset.practiceAction,'register');assert.doesNotMatch(w.document.querySelector('.practice-stage').textContent,/가상 접수 10명/);
  w.document.querySelector('[data-practice-action]').click();await w.portalTest.page('home');await w.portalTest.page('practice');assert.equal(w.document.querySelector('[data-practice-action]').dataset.practiceAction,'register');
  w.document.querySelector('[data-practice-action]').click();w.document.getElementById('servers').value=B;await w.portalTest.selectServer();await w.portalTest.page('practice');stale.click();assert.equal(w.document.querySelector('[data-practice-action]').dataset.practiceAction,'register');assert.equal(w.location.search,'?server='+B);assert.ok(calls.every(c=>c.options.method==='GET'));
});

test('participants cannot open rules, call settings or operator practice pages',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(url==='/portal/api/servers/'+A?{guildId:A,name:'방송 A',role:'participant'}:defaults(url));},'?server='+A+'&page=practice');
  const before=calls.length;for(const page of ['recruitment-rules','call-settings','practice'])await w.portalTest.page(page);assert.equal(calls.length,before);assert.equal(w.document.getElementById('title').textContent,'내 참가 상태');assert.equal(w.document.querySelectorAll('form,[data-practice-action]').length,0);
});

test('missing or invalid saved settings fail closed instead of exposing defaults that could overwrite state',async t=>{
  const calls=[],w=await portal(t,(url,options)=>{calls.push({url,options});return response(defaults(url));},'?server='+A);
  for(const [page,fixture]of [['call-settings',{revision:0,settings:{}}],['call-settings',{revision:'0',settings:{timeoutSeconds:60}}],['recruitment-rules',{revision:0,settings:{fairness:{enabled:false,unplayedFirst:true,waitFirst:true,maxConsecutive:0,newcomerSlots:0}}}]]){
    w.fetch=(url,options)=>{calls.push({url,options});return response(fixture);};await assert.rejects(w.portalTest.page(page),/저장된 설정을 확인/);assert.equal(w.document.querySelector('form'),null);assert.match(w.document.getElementById('panel').textContent,/설정 다시 불러오기/);
  }
  assert.ok(calls.every(c=>c.options.method==='GET'));
});
