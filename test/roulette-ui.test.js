import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
const guild='111111111111111111';
const entries=[{id:'a',label:'달콩'},{id:'b',label:'봄이'},{id:'c',label:'구름'}];
const snapshot=()=>({csrf:'fixture-csrf',revision:0,queueRevision:2,queueEntries:structuredClone(entries),history:[]});
const result=(requestId='fixture-request')=>({id:'result-1',requestId,at:1780000000000,source:'custom',entries:structuredClone(entries),winnerIndex:1,winner:{...entries[1]}});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
async function settle(){await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));}
async function page(t,fetcher,url='https://example.invalid/w/'+guild+'/roulette.html'){
 const html=await readFile(new URL('../public/roulette.html',import.meta.url),'utf8'),source=await readFile(new URL('../public/roulette.js',import.meta.url),'utf8');
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url,runScripts:'outside-only',virtualConsole});
 t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();assert.deepEqual(errors,[]);});
 const w=dom.window;w.fetch=fetcher;w.matchMedia=()=>({matches:true});
 w.eval(source+'\nglobalThis.rouletteTest={load,submit,preview,pending:()=>pending};');await settle();return w;
}
function input(w,text='달콩\n봄이\n구름'){const el=w.document.getElementById('items');el.value=text;el.dispatchEvent(new w.Event('input',{bubbles:true}));}
test('scoped page uses relative APIs and animates only the persisted winner index',async t=>{
 const calls=[],w=await page(t,async(url,options)=>{calls.push({url,options});return response(url==='api/roulette'?snapshot():{revision:1,result:result(JSON.parse(options.body).requestId)});});
 assert.equal(w.document.getElementById('back').getAttribute('href'),'/portal/?server='+guild+'&page=roulette');
 input(w);await w.rouletteTest.submit();const saved=calls.find(c=>c.url==='api/roulette/spin'),body=JSON.parse(saved.options.body);
 assert.equal(new URL(saved.url,w.location.href).pathname,'/w/'+guild+'/api/roulette/spin');
 assert.equal(saved.options.headers['X-CSRF-Token'],'fixture-csrf');assert.equal(saved.options.headers['Idempotency-Key'],body.requestId);
 assert.equal(body.expectedRevision,0);assert.equal(body.source,'custom');assert.deepEqual(body.items,['달콩','봄이','구름']);
 assert.equal(w.document.getElementById('winner').textContent,'봄이');assert.equal(w.document.getElementById('wheel').dataset.winnerIndex,'1');
 const angle=Number(/rotate\(([-.\d]+)deg\)/.exec(w.document.getElementById('wheel').style.transform)[1]);
 assert.equal((angle+(1+.5)*120)%360,0,'server winner sector center meets the fixed top pointer');
 assert.equal(w.document.querySelectorAll('#history>li').length,1);assert.match(w.document.body.textContent,/Queue.*변경하지 않았습니다/);
});
test('uncertain POST never spins again automatically and explicit retry keeps the exact body and key',async t=>{
 const calls=[];let attempts=0;const w=await page(t,async(url,options)=>{calls.push({url,options});if(url==='api/roulette')return response(snapshot());if(++attempts===1)throw Error('response lost');return response({revision:1,result:result(JSON.parse(options.body).requestId),replayed:true});});
 input(w);await w.rouletteTest.submit();assert.equal(attempts,1);assert.equal(w.document.getElementById('retry').hidden,false);assert.equal(w.document.getElementById('spin').disabled,true);
 await w.rouletteTest.submit();assert.equal(attempts,1,'fresh request is blocked while the previous outcome is uncertain');
 await w.rouletteTest.submit(true);const posts=calls.filter(c=>c.url==='api/roulette/spin');assert.equal(posts[0].options.body,posts[1].options.body);assert.deepEqual(posts[0].options.headers,posts[1].options.headers);
 assert.equal(w.document.getElementById('winner').textContent,'봄이');assert.equal(w.document.getElementById('retry').hidden,true);assert.equal(w.document.getElementById('spin').disabled,false);
});
test('invalid success JSON preserves the same request and GET history can resolve it without POST',async t=>{
 const calls=[];let requestId;const w=await page(t,async(url,options)=>{calls.push({url,options});if(url==='api/roulette'){const s=snapshot();if(requestId){s.revision=1;s.history=[result(requestId)];}return response(s);}requestId=JSON.parse(options.body).requestId;return {ok:true,status:200,json:async()=>{throw Error('truncated JSON');}};});
 input(w);await w.rouletteTest.submit();assert.equal(w.rouletteTest.pending().key,requestId);await w.rouletteTest.load();
 assert.equal(calls.filter(c=>c.url==='api/roulette/spin').length,1);assert.equal(w.rouletteTest.pending(),null);assert.equal(w.document.getElementById('winner').textContent,'봄이');
});
test('GET without matching history keeps the uncertain request locked and retryable',async t=>{
 const calls=[];const w=await page(t,async(url,options)=>{calls.push({url,options});if(url==='api/roulette')return response(snapshot());throw Error('network unavailable');});
 input(w);await w.rouletteTest.submit();const before=w.rouletteTest.pending();await w.rouletteTest.load();assert.equal(w.rouletteTest.pending(),before);assert.equal(w.document.getElementById('spin').disabled,true);assert.equal(w.document.getElementById('retry').hidden,false);assert.equal(calls.filter(c=>c.url==='api/roulette/spin').length,1);
});
test('server errors and inconsistent winner payloads preserve the pending request',async t=>{
 for(const mode of ['server','winner']){
  let submitted;const w=await page(t,async(url,options)=>{if(url==='api/roulette')return response(snapshot());submitted=JSON.parse(options.body);if(mode==='server')return response({error:'temporary failure'},503);const r=result(submitted.requestId);r.winnerIndex=0;return response({revision:1,result:r});});
  input(w);await w.rouletteTest.submit();assert.equal(w.rouletteTest.pending().key,submitted.requestId);assert.equal(w.document.getElementById('spin').disabled,true);assert.equal(w.document.getElementById('retry').hidden,false);assert.equal(w.document.getElementById('winner').textContent,'아직 추첨하지 않았습니다.');
 }
});
test('Queue source sends only its revision and server-selected labels remain inert text',async t=>{
 const malicious='<img src=x onerror=alert(1)>',s=snapshot();s.queueEntries[1].label=malicious;const calls=[];
 const w=await page(t,async(url,options)=>{calls.push({url,options});if(url==='api/roulette')return response(s);const r=result(JSON.parse(options.body).requestId);r.source='queue';r.entries=s.queueEntries;r.winner={...s.queueEntries[1]};return response({revision:1,result:r});});
 const queue=w.document.querySelector('[name=source][value=queue]');queue.checked=true;queue.dispatchEvent(new w.Event('change'));await w.rouletteTest.submit();
 const body=JSON.parse(calls.find(c=>c.url==='api/roulette/spin').options.body);assert.equal(body.queueRevision,2);assert.equal(body.source,'queue');assert.equal(Object.hasOwn(body,'items'),false);
 assert.equal(w.document.querySelector('img'),null);assert.equal(w.document.getElementById('winner').textContent,malicious);assert.match(w.document.getElementById('entries').textContent,/<img/);
});
test('duplicate, overlong, control-character and oversized pools cannot submit',async t=>{
 let posts=0;const w=await page(t,async(url)=>{if(url!=='api/roulette')posts++;return response(snapshot());});
 for(const value of ['동동\n동동','Apple\napple','가'.repeat(81)+'\n봄이','달콩\t님\n봄이','달콩\u200b님\n봄이','달콩\ud800\n봄이',Array.from({length:101},(_,i)=>'항목'+i).join('\n'),'달콩']){input(w,value);assert.equal(w.document.getElementById('spin').disabled,true,value);await w.rouletteTest.submit();}
 input(w,'동동\n동동');assert.equal(w.document.getElementById('spin').disabled,true,'canonically equivalent labels are duplicates');assert.equal(posts,0);
});
test('Queue with fewer than two entries and malformed state fail closed',async t=>{
 const w=await page(t,async()=>response({...snapshot(),queueEntries:entries.slice(0,1)}));const queue=w.document.querySelector('[value=queue]');queue.checked=true;queue.dispatchEvent(new w.Event('change'));assert.equal(w.document.getElementById('spin').disabled,true);assert.match(w.document.getElementById('validation').textContent,/2명 이상/);
 const invalid=await page(t,async()=>response({...snapshot(),revision:'0'}));input(invalid);assert.equal(invalid.document.getElementById('spin').disabled,true);
});
test('custom roulette remains usable without Queue access and Queue restrictions explain the blocker',async t=>{
 for(const queueRevision of [null,0]){
  const w=await page(t,async()=>response({...snapshot(),queueRevision,queueEntries:[],queueMessage:queueRevision===null?'Queue 조회 권한이 없습니다.':'참가자가 100명을 초과했습니다. 대상을 줄여 주세요.'}));input(w);assert.equal(w.document.getElementById('spin').disabled,false);
  const queue=w.document.querySelector('[value=queue]');queue.checked=true;queue.dispatchEvent(new w.Event('change'));assert.equal(w.document.getElementById('spin').disabled,true);assert.match(w.document.getElementById('validation').textContent,queueRevision===null?/조회 권한/:/100명을 초과/);
 }
});
test('navigation aborts requests and late responses cannot change the visible result',async t=>{
 let finish,signal;const w=await page(t,async(url,options)=>{if(url==='api/roulette')return response(snapshot());signal=options.signal;return new Promise(resolve=>{finish=resolve;});});input(w);const spin=w.rouletteTest.submit();await settle();w.dispatchEvent(new w.Event('pagehide'));assert.equal(signal.aborted,true);finish(response({revision:1,result:result()}));await spin;assert.equal(w.document.getElementById('winner').textContent,'아직 추첨하지 않았습니다.');assert.equal(w.document.querySelectorAll('#history>li').length,0);
});
test('a response for a different request cannot be announced or unlock a fresh spin',async t=>{
 let key;const w=await page(t,async(url,options)=>{if(url==='api/roulette')return response(snapshot());key=JSON.parse(options.body).requestId;return response({revision:1,result:result('different-request')});});
 input(w);await w.rouletteTest.submit();assert.equal(w.rouletteTest.pending().key,key);assert.equal(w.document.getElementById('winner').textContent,'아직 추첨하지 않았습니다.');assert.equal(w.document.getElementById('spin').disabled,true);assert.equal(w.document.querySelectorAll('#history>li').length,0);
});
test('BFCache restoration preserves an uncertain request and resolves it with a GET only',async t=>{
 const calls=[];let key;const w=await page(t,async(url,options)=>{calls.push({url,options});if(url==='api/roulette'){const s=snapshot();if(key){s.revision=1;s.history=[result(key)];}return response(s);}key=JSON.parse(options.body).requestId;throw Error('connection lost');});
 input(w);await w.rouletteTest.submit();const retained=w.rouletteTest.pending();w.dispatchEvent(new w.Event('pagehide'));w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
 assert.equal(w.rouletteTest.pending(),retained);await settle();assert.equal(calls.filter(c=>c.url==='api/roulette/spin').length,1);assert.equal(calls.filter(c=>c.url==='api/roulette').length,2);assert.equal(w.document.getElementById('winner').textContent,'봄이');assert.equal(w.rouletteTest.pending(),null);assert.equal(w.document.getElementById('spin').disabled,false);
});
test('late POST from the hidden page cannot unlock or overwrite the restored page while GET is pending',async t=>{
 let finishPost,finishGet,key,gets=0,posts=0;const w=await page(t,async(url,options)=>{if(url==='api/roulette'){if(++gets===1)return response(snapshot());return new Promise(resolve=>{finishGet=resolve;});}posts++;key=JSON.parse(options.body).requestId;return new Promise(resolve=>{finishPost=resolve;});});
 input(w);const old=w.rouletteTest.submit();await settle();w.dispatchEvent(new w.Event('pagehide'));w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));await settle();
 finishPost(response({revision:1,result:result(key)}));await old;assert.equal(w.document.getElementById('refresh').disabled,true,'new GET remains in flight');assert.equal(w.document.getElementById('spin').disabled,true);assert.equal(w.document.getElementById('winner').textContent,'아직 추첨하지 않았습니다.');
 finishGet(response(snapshot()));await settle();assert.equal(w.rouletteTest.pending().key,key);assert.equal(w.document.getElementById('retry').disabled,false);assert.equal(posts,1);
});
test('BFCache restoration reloads fresh state before allowing another draw',async t=>{
 let gets=0;const w=await page(t,async()=>{gets++;return response(snapshot());});input(w);assert.equal(w.document.getElementById('spin').disabled,false);
 w.dispatchEvent(new w.Event('pagehide'));w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(w.document.getElementById('spin').disabled,true);await settle();assert.equal(gets,2);assert.equal(w.document.getElementById('spin').disabled,false);assert.equal(w.document.getElementById('items').value,'달콩\n봄이\n구름');
});
test('legacy page keeps its relative endpoint',async t=>{
 const paths=[],w=await page(t,async(url)=>{paths.push(new URL(url,'https://example.invalid/roulette.html').pathname);return response(snapshot());},'https://example.invalid/roulette.html');assert.deepEqual(paths,['/api/roulette']);assert.equal(w.document.getElementById('back').getAttribute('href'),'./');
});
test('operator portal offers roulette under the 방송 category and links only to the selected workspace',async t=>{
 const html=await readFile(new URL('../public/portal.html',import.meta.url),'utf8'),source=await readFile(new URL('../public/portal.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/portal/?server='+guild+'&page=roulette',runScripts:'outside-only'});t.after(()=>{for(const d of dom.window.document.querySelectorAll('details'))d.ontoggle=null;dom.window.close();});
 dom.window.fetch=async url=>response(url==='/portal/auth/session'?{authenticated:true,user:{name:'가상 운영자'},csrf:'fixture'}:url==='/portal/api/servers'?{servers:[{id:guild,name:'방송 공간',botPresent:true}],installUrl:'https://discord.com/oauth2/authorize'}:url==='/portal/api/servers/'+guild?{guildId:guild,name:'방송 공간',role:'operator'}:{});
 await dom.window.eval('(async()=>{'+source.replace(/^import .*\r?\n/,'')+'})()');
 const doc=dom.window.document,leaf=doc.querySelector('[data-page=roulette]');assert.equal(leaf.textContent,'직접 입력 룰렛');assert.equal(leaf.parentElement.querySelector('summary').textContent,'룰렛');assert.equal(leaf.parentElement.parentElement.querySelector('summary').textContent,'방송');assert.equal(doc.getElementById('breadcrumb').textContent,'방송 / 룰렛 / 직접 입력 룰렛');assert.equal(doc.querySelector('#panel a').getAttribute('href'),'/w/'+guild+'/roulette.html');
});
