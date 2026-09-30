import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createViewerAuth } from '../src/viewer.js';
import { DEFAULT_AVATAR } from '../public/avatar.js';
import { RegistrationStore } from '../src/store.js';
import { OperationsStore,applyAction } from '../src/operations.js';
import { DemoDiscordService } from '../src/discord-service.js';
async function fixture(t,demo=true){
 const dir=await mkdtemp(path.join(tmpdir(),'roster-api-')),store=new RegistrationStore(path.join(dir,'registrations.json')),operations=new OperationsStore(path.join(dir,'operations.json'));await store.init();await operations.init();
 for(let i=0;i<20;i++)await store.upsert({guildId:'guild',discordId:'u'+i,chzzkName:'별'+i,lolRiotId:'별'+i+'#KR1',lolCurrentTier:'골드 2',lolMainLane:['탑','정글','미드','원딜','서폿'][i%5]});
 const viewerAuth=createViewerAuth();
 const config={host:'127.0.0.1',guildId:'guild',demo,dashboardUser:'admin',dashboardPassword:'test-password-1234'},discord=new DemoDiscordService(),runtime=createApp({config,store,operations,discord,viewerAuth});
 const server=await new Promise(resolve=>{const s=runtime.app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,auth=demo?{}:{Authorization:'Basic '+Buffer.from('admin:test-password-1234').toString('base64')};
 const request=async(url,body,headers={})=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{...auth,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};};
 const {data:{csrf}}=await request('/api/snapshot');
 const post=(url,body)=>request(url,{requestId:randomUUID(),sessionId:operations.read().session?.id||null,...body},{'X-CSRF-Token':csrf});
 return {config,operations,store,discord,runtime,request,post,csrf,base,viewerAuth};
}
test('API lifecycle saves the actual game, rejects supplied winners, retries once and swaps teams',async t=>{
 const f=await fixture(t);
 assert.equal((await f.post('/api/operations/open',{game:'lol',count:10})).status,200);
 assert.equal((await f.post('/api/demo/join_all',{})).status,200);
 assert.equal((await f.post('/api/operations/close',{})).status,200);
 assert.equal((await f.post('/api/operations/draw',{ids:['u1']})).status,400);
 const requestId=randomUUID(),result=await f.post('/api/operations/draw',{requestId,drawMode:'race',trackId:'coast',laps:2});
 assert.equal(result.status,200);assert.equal(result.data.draw.winners.length,10);assert.ok(result.data.draw.raceFrames.length>0);
 assert.deepEqual(result.data.state.session.winners,result.data.draw.winners);
 const repeat=await f.post('/api/operations/draw',{requestId,drawMode:'race',trackId:'coast',laps:2});assert.equal(repeat.status,200);assert.deepEqual(repeat.data.draw,result.data.draw);assert.equal(f.operations.read().draws.length,1);
 assert.equal((await f.post('/api/operations/reopen',{})).status,400);
 assert.equal((await f.post('/api/operations/attendance',{minutes:1})).status,200);
 assert.equal((await f.post('/api/demo/confirm_all',{})).status,200);
 assert.equal((await f.post('/api/operations/teams',{})).status,200);
 const teams=f.operations.read().session.teams,first=teams[0][0],second=teams[1][0];
 assert.equal((await f.post('/api/operations/swap',{first,second})).status,200);assert.ok(f.operations.read().session.teams[1].includes(first));
 assert.equal((await f.post('/api/operations/end',{sessionId:'old'})).status,409);
 const backup=await f.request('/api/backup');assert.equal(backup.status,200);assert.ok(!JSON.stringify(backup.data).includes('test-password'));
});

test('admin mutation idempotency replays completed side effects, coalesces in-flight duplicates, and rejects key reuse',async t=>{
 const f=await fixture(t);let calls=0;f.discord.rename=async selected=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return selected.map(r=>({discordId:r.discordId,ok:true}));};
 const body={discordIds:['u1']},key='admin-idempotency-0001',headers={'X-CSRF-Token':f.csrf,'Idempotency-Key':key};
 const first=await f.request('/api/nicknames',body,headers),repeat=await f.request('/api/nicknames',body,headers);
 assert.equal(first.status,200);assert.equal(repeat.status,200);assert.equal(calls,1);assert.equal(repeat.headers.get('x-idempotency-replayed'),'true');
 const conflict=await f.request('/api/nicknames',{discordIds:['u2']},headers);assert.equal(conflict.status,409);assert.match(conflict.data.error,/Idempotency-Key/);assert.equal(calls,1);
 const concurrentBody={discordIds:['u3']};
 const [a,b]=await Promise.all([
   f.request('/api/nicknames',concurrentBody,{'X-CSRF-Token':f.csrf,'Idempotency-Key':'admin-idempotency-0002'}),
   f.request('/api/nicknames',concurrentBody,{'X-CSRF-Token':f.csrf,'Idempotency-Key':'admin-idempotency-0003'})
 ]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls,2);assert.ok([a.headers.get('x-idempotency-status'),b.headers.get('x-idempotency-status')].includes('coalesced'));
});

test('viewer login idempotency replays the original session cookie after a retry',async t=>{
 const f=await fixture(t,false),code=f.viewerAuth.issue('u1'),key='viewer-login-0001',headers={'Content-Type':'application/json','Idempotency-Key':key},body=JSON.stringify({code});
 const first=await fetch(f.base+'/viewer/api/login',{method:'POST',headers,body}),second=await fetch(f.base+'/viewer/api/login',{method:'POST',headers,body});
 assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(second.headers.get('x-idempotency-replayed'),'true');assert.equal(second.headers.get('set-cookie'),first.headers.get('set-cookie'));
 const conflict=await fetch(f.base+'/viewer/api/login',{method:'POST',headers,body:JSON.stringify({code:'different-code'})});assert.equal(conflict.status,409);
});
test('auth, CSRF, host checks and malformed JSON protect production routes',async t=>{
 const f=await fixture(t,false);
 assert.equal((await fetch(f.base+'/api/snapshot')).status,401);
 assert.equal((await f.request('/api/operations/open',{game:'lol',count:10})).status,403);
 const hostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(f.base+'/api/snapshot',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();});assert.equal(hostStatus,403);
 assert.equal((await f.request('/api/operations/open',{game:'lol',count:10},{'X-CSRF-Token':f.csrf,'Sec-Fetch-Site':'cross-site'})).status,403);
 const r=await fetch(f.base+'/api/operations/open',{method:'POST',headers:{Authorization:'Basic '+Buffer.from('admin:test-password-1234').toString('base64'),'Content-Type':'application/json','X-CSRF-Token':f.csrf},body:'{broken'});assert.equal(r.status,400);assert.match(r.headers.get('content-type'),/json/);
 assert.equal((await f.post('/api/demo/join_all',{})).status,404);
});
test('deadline closes once, rejects late entry, and reopen clears its timer',async t=>{
 const f=await fixture(t);await f.post('/api/operations/open',{game:'lol',count:2,closeMinutes:1});
 const s=f.operations.read().session;
 assert.throws(()=>applyAction(f.operations.read(),'join',{sessionId:s.id,userId:'u1'},s.closeAt));
 await f.runtime.tick(s.closeAt+1);assert.equal(f.operations.read().session.phase,'closed');const rev=f.operations.read().revision;
 await f.runtime.tick(s.closeAt+2);assert.equal(f.operations.read().revision,rev);
 assert.equal((await f.post('/api/operations/reopen',{})).status,200);assert.equal(f.operations.read().session.closeAt,null);
});
test('Discord send failure preserves selected outcome for safe synchronization retry',async t=>{
 const f=await fixture(t);await f.post('/api/operations/open',{game:'lol',count:2});await f.post('/api/demo/join_all',{});await f.post('/api/operations/close',{});
 f.discord.sync=async()=>{throw Error('network');};
 const r=await f.post('/api/operations/draw',{drawMode:'ladder'});assert.equal(r.status,200);assert.match(r.data.message,/저장/);assert.equal(r.data.state.session.winners.length,2);
 const winners=[...r.data.state.session.winners];f.discord.sync=async()=>{};await f.post('/api/operations/publish',{});assert.deepEqual(f.operations.read().session.winners,winners);
});

test('guide APIs require admin authentication and CSRF, preserve drafts across restart, reject concurrent stale edits',async t=>{
 const f=await fixture(t,false);
 assert.equal((await fetch(f.base+'/api/guide')).status,401);
 assert.equal((await f.request('/api/guide/draft',{key:'start',expectedRevision:0,content:{title:'새 안내',body:'새 본문'}})).status,403);
 const body={key:'start',expectedRevision:0,content:{title:'새 안내',body:'새 본문'}};
 const results=await Promise.all([f.post('/api/guide/draft',body),f.post('/api/guide/draft',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await f.request('/api/guide/search?q=새%20본문')).data.results.length,0);
 assert.equal((await f.post('/api/guide/publish',{key:'start',expectedRevision:1})).status,200);
 assert.equal((await f.request('/api/guide/search?q=새%20본문')).data.results.length,1);
 const restored=new OperationsStore(f.operations.file);await restored.init();assert.equal(restored.read().guide.pages.start.published.body,'새 본문');
 assert.equal((await f.request('/api/guide/progress')).data.members.length,20);
 assert.equal((await f.request('/api/backup')).data.operations.guide.pages.start.version,2);
});

test('viewer login is single-use, edits own avatar only, and cannot access administrator routes',async t=>{
 const f=await fixture(t,false),code=f.viewerAuth.issue('u1');
 const login=await fetch(f.base+'/viewer/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await fetch(f.base+'/viewer/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})})).status,401);
 const me=await (await fetch(f.base+'/viewer/api/me',{headers:{Cookie:cookie}})).json();assert.equal(me.userId,'u1');
 const save=(body,csrf=me.csrf)=>fetch(f.base+'/viewer/api/avatar',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
 assert.equal((await save({...DEFAULT_AVATAR,revision:0},'wrong')).status,403);
 assert.equal((await save({...DEFAULT_AVATAR,color:'#bbffaa',userId:'u2',damage:999,revision:0})).status,200);
 assert.equal((await save({...DEFAULT_AVATAR,color:'#bbffaa',userId:'u2',damage:999,revision:0},'wrong')).status,403);
 const avatar=f.operations.read().avatars[0];assert.equal(avatar.userId,'u1');assert.equal(avatar.avatar.damage,undefined);assert.equal(avatar.avatar.color,'#bbffaa');
 assert.equal((await save({...DEFAULT_AVATAR,revision:0})).status,409);
 assert.equal((await fetch(f.base+'/api/avatars',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await fetch(f.base+'/viewer/api/admin',{headers:{Cookie:cookie}})).status,404);
 await fetch(f.base+'/viewer/api/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:'{}'});
 assert.equal((await fetch(f.base+'/viewer/api/me',{headers:{Cookie:cookie}})).status,401);
});
test('saved race colors are copied into the draw snapshot and remain immutable',async t=>{
 const f=await fixture(t);await f.operations.update(s=>{s.avatars=[{userId:'u1',revision:1,avatar:{...DEFAULT_AVATAR,color:'#bbffaa'}}]});
 const result=await f.post('/api/operations/draw',{scope:'all',count:2,drawMode:'race',trackId:'coast',laps:2});assert.equal(result.status,200);assert.equal(result.data.draw.avatars.u1.color,'#bbffaa');
 await f.operations.update(s=>{s.avatars[0].avatar.color='#112233'});assert.equal(f.operations.read().lastDraw.avatars.u1.color,'#bbffaa');
});

test('demo viewer entry exists only in demo mode and profile cosmetics are validated',async t=>{
 const prod=await fixture(t,false);assert.equal((await fetch(prod.base+'/viewer/api/mode')).status,200);assert.equal((await (await fetch(prod.base+'/viewer/api/mode')).json()).demo,false);
 assert.equal((await fetch(prod.base+'/viewer/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const demo=await fixture(t);const login=await fetch(demo.base+'/viewer/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0],me=await (await fetch(demo.base+'/viewer/api/me',{headers:{Cookie:cookie}})).json();
 const invalid=await fetch(demo.base+'/viewer/api/avatar',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({...DEFAULT_AVATAR,color:'url(javascript:bad)',revision:0})});assert.equal(invalid.status,400);
});

test('race studio choices reach the saved server simulation and unsupported modes are rejected',async t=>{
 const f=await fixture(t);
 const race=await f.post('/api/operations/draw',{scope:'all',count:2,drawMode:'race',trackId:'metro',laps:4});
 assert.equal(race.status,200);assert.equal(race.data.draw.version,4);assert.equal(race.data.draw.track.id,'metro');assert.equal(race.data.draw.laps,4);assert.equal(race.data.draw.finishDistance,4000);
 assert.equal((await f.post('/api/operations/draw',{scope:'all',count:2,drawMode:'battle'})).status,400);
 assert.equal((await f.post('/api/operations/draw',{scope:'all',count:2,drawMode:'race',trackId:'unknown'})).status,400);
});

test('vacancy replacement rechecks game registration and never saves a short winner list',async t=>{
 const f=await fixture(t);await f.store.upsert({guildId:'guild',discordId:'u1',chzzkName:'별1',lolRiotId:'',erNickname:'ER별1'});
 await f.operations.update(s=>{applyAction(s,'open',{game:'lol',count:1},0);const id=s.session.id;applyAction(s,'join',{sessionId:id,userId:'u0'},0);applyAction(s,'join',{sessionId:id,userId:'u1'},0);applyAction(s,'close',{},0);applyAction(s,'draw',{ids:['u0']},0);applyAction(s,'attendance',{minutes:1},0)});
 const failed=await f.post('/api/operations/replace',{});assert.equal(failed.status,400);assert.equal(f.operations.read().session.phase,'checking');assert.deepEqual(f.operations.read().session.winners,['u0']);
 await f.store.upsert({guildId:'guild',discordId:'u1',lolRiotId:'별1#KR1'});
 const replaced=await f.post('/api/operations/replace',{});assert.equal(replaced.status,200);assert.deepEqual(f.operations.read().session.winners,['u1']);
});

test('attendance deadline synchronization retries after a temporary Discord failure',async t=>{
 const f=await fixture(t);await f.operations.update(s=>{applyAction(s,'open',{game:'lol',count:1},0);const id=s.session.id;applyAction(s,'join',{sessionId:id,userId:'u0'},0);applyAction(s,'close',{},0);applyAction(s,'draw',{ids:['u0']},0);applyAction(s,'attendance',{minutes:1},0)});
 let attempts=0;f.discord.sync=async()=>{attempts++;throw Error('temporary')};await f.runtime.tick(60001);assert.equal(attempts,1);assert.equal(f.operations.read().session.deadlineSynced,false);
 f.discord.sync=async()=>{attempts++};await f.runtime.tick(60002);assert.equal(attempts,2);assert.equal(f.operations.read().session.deadlineSynced,true);
});


test('production monitoring GET is passive; POST requires admin CSRF and preserves idempotency',async t=>{
 const f=await fixture(t,false);let calls=0;
 f.discord.diagnostics=async()=>{calls++;return {connected:true};};
 const get=await f.request('/api/production-monitoring');assert.equal(get.status,200);assert.equal(get.data.ready,false);assert.equal(calls,0);
 assert.equal((await fetch(f.base+'/api/production-monitoring')).status,401);
 assert.equal((await f.request('/api/production-monitoring/probe',{})).status,403);
 f.config.dashboardOperatorUser='operator';f.config.dashboardOperatorPassword='operator-test-password';
 const operator={Authorization:'Basic '+Buffer.from('operator:operator-test-password').toString('base64'),'X-CSRF-Token':f.csrf};
 assert.equal((await f.request('/api/production-monitoring',undefined,operator)).status,403);
 assert.equal((await f.request('/api/production-monitoring/probe',{},operator)).status,403);
 const body={requestId:randomUUID()},first=await f.post('/api/production-monitoring/probe',body),repeat=await f.post('/api/production-monitoring/probe',body);
 assert.equal(first.status,200);assert.equal(first.data.ready,false);assert.deepEqual(repeat.data,first.data);assert.equal(calls,1);
 assert.equal((await f.post('/api/production-monitoring/probe',{})).status,429);
 f.runtime.beginShutdown();const drained=await f.request('/api/production-monitoring');assert.equal(drained.status,200);assert.equal(drained.data.checks.find(c=>c.id==='service').status,'fail');
 assert.equal((await f.post('/api/production-monitoring/probe',{})).status,503);f.runtime.close();
});
