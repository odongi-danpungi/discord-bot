import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { DEFAULT_AVATAR } from '../public/avatar.js';

const NOW=Date.UTC(2026,9,14,3);
const result=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
const fixture=()=>({
  serverTime:NOW,
  session:{id:'round-a',title:'칼바람 시참',game:'lol',gameLabel:'리그 오브 레전드',mode:'aram',modeLabel:'칼바람 나락',round:3,phase:'open',count:5,closeAt:NOW+60000,deadline:0,applicant:false,postponed:false,winner:false,confirmed:false},
  recruitment:{status:'open',reason:null,maxApplicants:10,activeApplicants:3,remainingSlots:7,unlimited:false,closeAt:NOW+60000,drawCount:5,duplicatePolicy:'keep_existing'},
  queue:{entry:null,waitingCount:0,activeCount:99},reservations:[],actions:{join:true}
});
function callFixture(){const state=fixture();state.session.applicant=true;state.queue.entry={id:'entry-a',status:'called',statusLabel:'호출됨',sessionId:'round-a',game:'lol',round:3,callAttempt:1,callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};return state;}
function passResponse(state='recorded'){return {action:'pass',state,sessionId:'round-a',game:'lol',round:3,targetRound:4,attempt:1,recordedAt:NOW-100,confirmedAt:state==='confirming'?null:NOW-50};}
async function viewer(t,{state=fixture(),query='',fetcher}={}){
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(await readFile(new URL('../public/viewer.html',import.meta.url),'utf8'),{url:'https://example.invalid/viewer/'+query,runScripts:'outside-only',virtualConsole});
  const w=dom.window,calls=[],intervals=[];let now=NOW,current=state;
  w.Date.now=()=>now;w.DEFAULT_AVATAR=DEFAULT_AVATAR;w.mountViewerCommunity=()=>{};w.requestAnimationFrame=()=>1;w.setInterval=(fn,delay)=>{intervals.push({fn,delay});return intervals.length;};w.HTMLCanvasElement.prototype.getContext=()=>({});
  w.fetch=async(url,options={})=>{calls.push({url,options});const override=fetcher?.(url,options);if(override!==undefined)return override;return result(url.endsWith('/me')?{name:'가상 참가자',avatar:DEFAULT_AVATAR,revision:1,csrf:'fixture-csrf'}:url.endsWith('/participation')?current:url.endsWith('/ready-check')?{check:null}:url.endsWith('/mode')?{demo:false}:{poll:null});};
  t.after(()=>{w.close();assert.deepEqual(errors,[],'viewer must not raise unhandled DOM errors');});
  const source=(await readFile(new URL('../public/viewer.js',import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,'');
  w.eval(source+'\nwindow.viewerTest={loadParticipation,runParticipationAction,renderParticipation};');
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};await settle();
  return {w,calls,settle,get:id=>w.document.getElementById(id),setState:value=>{current=value;},advance:ms=>{now+=ms;for(const item of intervals.filter(item=>item.delay===1000))item.fn();}};
}

test('viewer displays current Discord intake capacity separately from Queue and draw size without extra requests',async t=>{
  const ui=await viewer(t),card=ui.get('recruitmentSummary');
  assert.equal(card.dataset.state,'open');assert.equal(ui.get('recruitmentRemaining').textContent,'남은 자리 7명');
  assert.match(ui.get('recruitmentDetail').textContent,/현재 접수 3명 · 최대 10명 · 추첨 인원 5명/);assert.doesNotMatch(card.textContent,/99명/);
  assert.match(ui.get('recruitmentDeadline').textContent,/1분 0초/);assert.match(card.textContent,/네이버 카페·수동 대기열의 인원은 합산하지 않습니다/);
  assert.equal(ui.get('recruitmentStatus').getAttribute('role'),'status');assert.equal(ui.w.document.querySelectorAll('[data-participation-action="join"]').length,1);
  assert.deepEqual(ui.calls.map(call=>call.url).sort(),['/viewer/api/me','/viewer/api/mode','/viewer/api/participation','/viewer/api/poll','/viewer/api/ready-check','/viewer/api/account-link'].sort());
  assert.ok(ui.calls.every(call=>call.options.method===undefined&&call.options.body===undefined));
});

test('viewer distinguishes unlimited, full, timed, manual, progress, ended and inactive recruitment',async t=>{
  const ui=await viewer(t);
  const check=async(state,expected,label)=>{ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('recruitmentSummary').dataset.state,expected);assert.match(ui.get('recruitmentRemaining').textContent,label);return state;};
  let state=fixture();Object.assign(state.recruitment,{maxApplicants:0,unlimited:true,remainingSlots:null});await check(state,'open',/인원 제한 없음/);assert.match(ui.get('recruitmentDetail').textContent,/현재 접수 3명 · 정원 제한 없음/);
  state=fixture();Object.assign(state.recruitment,{status:'full',reason:'capacity',activeApplicants:10,remainingSlots:0});await check(state,'full',/정원이 가득/);assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);
  state=fixture();state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'capacity',activeApplicants:10,remainingSlots:0});await check(state,'closed',/정원이 가득/);
  state=fixture();state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});await check(state,'closed',/운영자가/);
  state=fixture();state.session.closeAt=NOW-1;Object.assign(state.recruitment,{status:'closed',reason:'deadline',closeAt:NOW-1});await check(state,'closed',/접수 시간이 종료/);
  state=fixture();state.session.phase='checking';Object.assign(state.recruitment,{status:'closed',reason:'progress'});await check(state,'closed',/추첨·참석 확인/);
  state.session.phase='ended';await check(state,'closed',/모집이 종료/);
  state={serverTime:NOW,session:null,recruitment:{status:'inactive',reason:'no_session',maxApplicants:null,activeApplicants:0,remainingSlots:null,unlimited:false,closeAt:0,drawCount:0,duplicatePolicy:null},queue:{},actions:{join:true},reservations:[]};await check(state,'inactive',/진행 중인 모집이 없습니다/);assert.equal(ui.get('recruitmentDetail').textContent,'');assert.equal(ui.get('recruitmentDeadline').textContent,'');assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);
});

test('new participant guidance matches full, closed, unavailable and stale recruitment without promising admission',async t=>{
  const ui=await viewer(t),check=async(state,expected)=>{ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.match(ui.get('participationHint').textContent,expected);assert.doesNotMatch(ui.get('participationHint').textContent,/현재판 참가 버튼으로 신청/);assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);};
  let state=fixture();Object.assign(state.recruitment,{status:'full',reason:'capacity',activeApplicants:10,remainingSlots:0});await check(state,/정원이 가득 찼습니다/);
  state=fixture();state.session.closeAt=NOW-1;Object.assign(state.recruitment,{status:'closed',reason:'deadline',closeAt:NOW-1});await check(state,/접수 시간이 종료되었습니다/);
  state=fixture();state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});await check(state,/운영자가 접수를 마감했습니다/);
  state=fixture();delete state.recruitment;await check(state,/접수 상태를 확인할 수 없습니다.*새로고침/);
  ui.w.history.replaceState({},'', '?session=old-round');await check(fixture(),/최신 모집 링크/);
});

test('missing or malformed aggregate fails closed without presenting unlimited admission or arbitrary payload',async t=>{
  const ui=await viewer(t),bad=[undefined,null,[],{...fixture().recruitment,maxApplicants:null},{...fixture().recruitment,remainingSlots:'7'},{...fixture().recruitment,activeApplicants:-1},{...fixture().recruitment,drawCount:10},{...fixture().recruitment,status:'<img src=x onerror=alert(1)>'},{...fixture().recruitment,unlimited:true}];
  for(const recruitment of bad){const state=fixture();state.recruitment=recruitment;state.rawSecret='fixture-secret-never-render';ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('recruitmentSummary').dataset.state,'unknown');assert.equal(ui.get('recruitmentDetail').textContent,'');assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);await ui.w.viewerTest.runParticipationAction('join');}
  assert.doesNotMatch(ui.get('recruitmentSummary').textContent,/제한 없음|fixture-secret|<img/);assert.equal(ui.get('recruitmentSummary').querySelector('img'),null);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('stale session links hide newer recruitment details and cannot submit through a detached button',async t=>{
  const ui=await viewer(t,{query:'?session=round-a'}),oldButton=ui.w.document.querySelector('[data-participation-action="join"]'),state=fixture();
  state.session.id='round-b';state.session.round=8;state.session.gameLabel='새 모집 게임';state.recruitment.activeApplicants=6;state.recruitment.remainingSlots=4;ui.setState(state);await ui.w.viewerTest.loadParticipation();
  assert.equal(ui.get('recruitmentSummary').dataset.state,'stale');assert.equal(ui.get('recruitmentDetail').textContent,'');assert.equal(ui.get('participationRound').textContent,'—');assert.equal(ui.get('participationGame').textContent,'—');assert.match(ui.get('participationTitle').textContent,/최신 모집 링크/);
  await oldButton.onclick();assert.ok(ui.calls.every(call=>!call.options.body));
});

test('server clock expiry closes admission and blocks detached intake actions while preserving own reservations',async t=>{
  const state=fixture();state.serverTime=NOW+3600000;state.session.closeAt=state.serverTime+1500;state.recruitment.closeAt=state.session.closeAt;Object.assign(state.actions,{leave:true,postponeNext:true,postponeNext2:true,cancelReservation:true});state.reservations=[{game:'lol',round:4}];
  const ui=await viewer(t,{state}),oldButton=ui.w.document.querySelector('[data-participation-action="join"]');assert.match(ui.get('recruitmentDeadline').textContent,/0분 2초/);
  ui.advance(2000);assert.equal(ui.get('recruitmentSummary').dataset.state,'closed');assert.match(ui.get('recruitmentRemaining').textContent,/접수 시간이 종료/);assert.equal(ui.w.document.querySelector('#participationActions button'),null);assert.equal(ui.get('participationReservations').querySelector('button').disabled,false);
  await oldButton.onclick();for(const action of ['leave','postpone_next','postpone_next2'])await ui.w.viewerTest.runParticipationAction(action);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('full recruitment keeps current call response and reservation information independent from admission',async t=>{
  const state=fixture();Object.assign(state.recruitment,{status:'full',reason:'capacity',activeApplicants:10,remainingSlots:0});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',position:2,callDeadline:NOW+10000};state.reservations=[{game:'lol',round:4}];state.actions={join:true,callJoin:true,callPass:true,cancelReservation:false};
  const ui=await viewer(t,{state});assert.equal(ui.get('participationCall').hidden,false);assert.equal(ui.get('participationPosition').textContent,'2번');assert.match(ui.get('participationReservations').textContent,/4판 예약/);assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,false);assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);
  ui.advance(11000);assert.equal(ui.get('participationCall').dataset.state,'expired');await ui.w.viewerTest.runParticipationAction('call_join');assert.ok(ui.calls.every(call=>!call.options.body));
});

test('same-session call can pass after intake expiry without reopening admission and posts the displayed session binding',async t=>{
  const state=fixture(),writes=[];state.session.applicant=true;state.session.closeAt=NOW+1000;state.recruitment.closeAt=NOW+1000;state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={join:true,leave:true,postponeNext:true,postponeNext2:true,callJoin:true,callPass:true};
  const ui=await viewer(t,{state,query:'?session=round-a',fetcher:(url,options)=>{if(url.endsWith('/participation/action')){writes.push({body:JSON.parse(options.body),headers:options.headers});return result({state,result:{}});}}});ui.advance(2000);
  assert.equal(ui.get('recruitmentSummary').dataset.state,'closed');assert.equal(ui.get('participationCall').hidden,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);assert.equal(ui.get('participationActions').children.length,0);
  assert.match(ui.get('participationHint').textContent,/이번판 패스 시 다음판으로 예약/);assert.match(ui.get('participationHint').textContent,/현재 모집에 다시 접수하지 않습니다/);
  state.serverTime=NOW+2000;state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'deadline'});state.session.applicant=false;state.session.postponed=true;state.queue.entry=null;state.actions={};state.reservations=[{game:'lol',round:4}];
  await ui.w.document.querySelector('[data-participation-action="call_pass"]').onclick();assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{action:'call_pass',expectedSessionId:'round-a',expectedCall:{entryId:'entry-a',attempt:1,sessionId:'round-a'}});assert.equal(writes[0].headers['X-CSRF-Token'],'fixture-csrf');assert.ok(writes[0].headers['Idempotency-Key']);assert.match(ui.get('participationStatus').textContent,/이번판 패스 응답을 반영/);assert.match(ui.get('participationReservations').textContent,/4판 예약/);
});

test('capacity, manual and deadline closure before drawing preserve an authorized current applicant call pass',async t=>{
  const state=fixture();state.session.applicant=true;state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state});
  for(const reason of ['capacity','manual','deadline']){state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason});if(reason==='capacity')Object.assign(state.recruitment,{activeApplicants:10,remainingSlots:0});ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false,reason);assert.match(ui.get('participationHint').textContent,/다음판으로 예약/);assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);}
  state.session.phase='open';Object.assign(state.recruitment,{status:'full',reason:'capacity',activeApplicants:10,remainingSlots:0});ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('after drawing, same-session pass stays blocked while the live call join response remains available',async t=>{
  const state=fixture();state.session.applicant=true;state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state});
  for(const phase of ['drawn','checking','ended']){state.session.phase=phase;Object.assign(state.recruitment,{status:'closed',reason:'progress'});ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,false,phase);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true,phase);assert.match(ui.get('participationHint').textContent,/추첨 후 패스 예약은 진행자에게 요청/);await ui.w.viewerTest.runParticipationAction('call_pass');}
  assert.ok(ui.calls.every(call=>!call.options.body));
});

test('an expired call deadline blocks join and pass even when intake is already closed',async t=>{
  const state=fixture();state.session.applicant=true;state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+1000};state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state});assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);ui.advance(1100);assert.equal(ui.get('participationCall').dataset.state,'expired');assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,true);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);
  await ui.w.viewerTest.runParticipationAction('call_join');await ui.w.viewerTest.runParticipationAction('call_pass');assert.ok(ui.calls.every(call=>!call.options.body));
});

test('invalid recruitment, missing applicant and failed refresh cannot authorize a same-session call pass',async t=>{
  const state=fixture();state.session.applicant=true;state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};
  let failRead=false;const ui=await viewer(t,{state,fetcher:url=>url.endsWith('/participation')&&failRead?Promise.reject(Error('private-read-path')):undefined});
  for(const modified of [{...state,recruitment:null},{...state,session:{...state.session,applicant:false}},{...state,session:{...state.session,postponed:true}}]){ui.setState(modified);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);await ui.w.viewerTest.runParticipationAction('call_pass');}
  ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);failRead=true;await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').hidden,true);await ui.w.viewerTest.runParticipationAction('call_pass');assert.ok(ui.calls.every(call=>!call.options.body));assert.doesNotMatch(ui.w.document.body.textContent,/private-read-path/);
});

test('unrelated or manual Queue calls retain their existing independent response actions',async t=>{
  const state=fixture();state.session.phase='ended';Object.assign(state.recruitment,{status:'closed',reason:'progress'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'other-round',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state});assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);assert.match(ui.get('participationHint').textContent,/한 곳에서만 응답/);
  delete state.queue.entry.sessionId;ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('a stale session link cannot pass the newer current call through its previously attached button',async t=>{
  const state=fixture();state.session.applicant=true;state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state,query:'?session=round-a'}),oldButton=ui.w.document.querySelector('[data-participation-action="call_pass"]');assert.equal(oldButton.disabled,false);
  state.session.id='round-b';state.queue.entry.sessionId='round-b';ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').hidden,true);assert.equal(oldButton.disabled,true);await oldButton.onclick();assert.ok(ui.calls.every(call=>!call.options.body));
});

test('a failed pass never reports a completed reservation and preserves the server returned current state',async t=>{
  const state=fixture();state.session.applicant=true;state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state,fetcher:url=>url.endsWith('/participation/action')?result({error:'예약을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503):undefined});await ui.w.viewerTest.runParticipationAction('call_pass');
  assert.match(ui.get('participationStatus').textContent,/예약을 저장하지 못했습니다/);assert.doesNotMatch(ui.get('participationStatus').textContent,/패스를 반영|처리했습니다/);assert.equal(ui.get('participationReservations').children.length,0);assert.equal(ui.get('participationCall').hidden,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);assert.equal(ui.calls.filter(call=>call.options.body).length,1);
});

test('the rendered call join button submits its own bound participant response after recruitment closure',async t=>{
  const state=fixture(),writes=[];state.session.applicant=true;state.session.phase='drawn';Object.assign(state.recruitment,{status:'closed',reason:'progress'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:false};
  const ui=await viewer(t,{state,fetcher:(url,options)=>{if(url.endsWith('/participation/action')){writes.push(JSON.parse(options.body));return result({state,result:{}});}}});const button=ui.w.document.querySelector('[data-participation-action="call_join"]');assert.equal(button.disabled,false);await button.onclick();assert.deepEqual(writes,[{action:'call_join',expectedSessionId:'round-a',expectedCall:{entryId:'entry-a',attempt:1,sessionId:'round-a'}}]);assert.match(ui.get('participationStatus').textContent,/참가 응답을 전송/);
});

test('a durable pending pass blocks both real call buttons until a fresh read clears the pending state',async t=>{
  const state=fixture();state.session.applicant=true;state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'패스 반영 확인 중',sessionId:'round-a',callDeadline:NOW+10000};state.queue.passPending=true;state.reservations=[{game:'lol',round:4}];state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state}),join=ui.w.document.querySelector('[data-participation-action="call_join"]'),pass=ui.w.document.querySelector('[data-participation-action="call_pass"]');
  assert.equal(ui.get('participationCall').dataset.state,'confirming');assert.equal(join.disabled,true);assert.equal(pass.disabled,true);assert.match(ui.get('participationHint').textContent,/패스 예약은 저장되었습니다.*처리 상태를 확인 중/);assert.match(ui.get('participationReservations').textContent,/4판 예약/);assert.equal(ui.get('participationState').textContent,'패스 반영 확인 중');await join.onclick();await pass.onclick();assert.ok(ui.calls.every(call=>!call.options.body));
  state.queue.passPending=false;state.queue.entry.statusLabel='호출됨';ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').hidden,false);assert.equal(join.disabled,false);assert.equal(pass.disabled,false);assert.doesNotMatch(ui.get('participationHint').textContent,/처리 상태를 확인 중/);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('a completed pass refresh removes pending guidance and keeps its next-round reservation without more writes',async t=>{
  const state=fixture();state.session.applicant=true;state.session.phase='closed';Object.assign(state.recruitment,{status:'closed',reason:'manual'});state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'called',statusLabel:'패스 반영 확인 중',sessionId:'round-a',callDeadline:NOW+10000};state.queue.passPending=true;state.reservations=[{game:'lol',round:4}];state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state});state.queue.passPending=false;state.queue.entry={id:'entry-a',game:'lol',round:3,callAttempt:1,status:'passed',statusLabel:'패스',sessionId:'round-a',callDeadline:0};state.session.postponed=true;state.actions={cancelReservation:true};ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').hidden,true);assert.match(ui.get('participationHint').textContent,/다음 회차 예약 상태/);assert.match(ui.get('participationReservations').textContent,/4판 예약/);assert.equal(ui.get('participationState').textContent,'패스');assert.doesNotMatch(ui.get('participationHint').textContent,/처리 상태를 확인 중/);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('fresh participation renders even when ready-check fails and failed refresh clears previous state',async t=>{
  let failure=false;const ui=await viewer(t,{fetcher:url=>url.endsWith('/ready-check')?Promise.reject(Error('private-ready-path')):url.endsWith('/participation')&&failure?Promise.reject(Error('private-data-path')):undefined});
  assert.equal(ui.get('recruitmentSummary').dataset.state,'open');assert.equal(ui.get('participantReady').hidden,true);failure=true;await ui.w.viewerTest.loadParticipation();
  assert.equal(ui.get('recruitmentSummary').dataset.state,'unknown');assert.equal(ui.get('recruitmentDetail').textContent,'');assert.equal(ui.get('participationPosition').textContent,'—');assert.equal(ui.get('participationReservations').children.length,0);assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);assert.doesNotMatch(ui.w.document.body.textContent,/private-data-path|private-ready-path/);
});

test('expired login clears participant content and older in-flight reads cannot restore it',async t=>{
  let requests=0,release;const ui=await viewer(t,{fetcher:url=>{if(!url.endsWith('/participation')||requests++===0)return;return requests===2?new Promise(resolve=>{release=resolve;}):result({error:'expired'},401);}});
  const older=ui.w.viewerTest.loadParticipation();await ui.w.viewerTest.loadParticipation();release(result(fixture()));await older;
  assert.equal(ui.get('editor').hidden,true);assert.equal(ui.get('login').hidden,false);assert.equal(ui.get('name').textContent,'');assert.equal(ui.get('recruitmentDetail').textContent,'');assert.match(ui.get('status').textContent,/로그인 상태/);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('newer refresh wins and action is bound to displayed session with no write during read-only refresh',async t=>{
  let requests=0,release;const writes=[];const ui=await viewer(t,{fetcher:(url,options)=>{if(url.endsWith('/participation/action')){writes.push(JSON.parse(options.body));return result({state:fixture()});}if(!url.endsWith('/participation')||requests++===0)return;return requests===2?new Promise(resolve=>{release=resolve;}):undefined;}});
  const older=ui.w.viewerTest.loadParticipation(),newer=fixture();newer.recruitment.activeApplicants=5;newer.recruitment.remainingSlots=5;ui.setState(newer);await ui.w.viewerTest.loadParticipation();release(result(fixture()));await older;assert.equal(ui.get('recruitmentRemaining').textContent,'남은 자리 5명');assert.equal(writes.length,0);
  await ui.w.viewerTest.runParticipationAction('join');assert.equal(writes.length,1);assert.equal(writes[0].expectedSessionId,'round-a');assert.equal(writes[0].action,'join');
});

test('refresh started before a mutation cannot restore pre-admission capacity after its result',async t=>{
  let delay=false,release;const full=fixture();Object.assign(full.recruitment,{status:'full',reason:'capacity',activeApplicants:10,remainingSlots:0});full.session.applicant=true;full.actions={leave:true};
  const ui=await viewer(t,{fetcher:(url,options)=>{if(url.endsWith('/participation/action'))return result({state:full});if(url.endsWith('/participation')&&delay){delay=false;return new Promise(resolve=>{release=resolve;});}}});
  delay=true;const older=ui.w.viewerTest.loadParticipation();ui.setState(full);await ui.w.viewerTest.runParticipationAction('join');release(result(fixture()));await older;
  assert.equal(ui.get('recruitmentSummary').dataset.state,'full');assert.match(ui.get('participationHint').textContent,/신청되어 있습니다/);assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);assert.equal(ui.calls.filter(call=>call.options.body).length,1);
});

test('session title and own reservation remain inert text rather than HTML',async t=>{
  const state=fixture();state.session.title='<img src=x onerror=alert(1)>';state.reservations=[{game:'lol',round:'<svg onload=alert(1)>'}];
  const ui=await viewer(t,{state});assert.equal(ui.get('participationTitle').textContent,state.session.title);assert.match(ui.get('participationReservations').textContent,/<svg/);assert.equal(ui.get('viewerParticipation').querySelector('img,svg'),null);
});

test('a retained pass acknowledgement displays historical processing separately from current reservations and Discord delivery',async t=>{
  const state=callFixture();state.queue.entry.status='postponed_next';state.queue.entry.statusLabel='다음판 예약';state.queue.callResponse=passResponse();state.actions={cancelReservation:false};
  const ui=await viewer(t,{state});assert.equal(ui.get('participationCall').dataset.state,'recorded');assert.match(ui.get('participationCallTitle').textContent,/패스 응답이 기록/);assert.match(ui.get('participationCallTimer').textContent,/응답 당시 4판 예약으로 처리/);assert.match(ui.get('participationCallTimer').textContent,/현재 예약은 아래 예약 목록/);assert.match(ui.get('participationCallTimer').textContent,/Discord 전송 완료를 뜻하지 않습니다/);assert.equal(ui.get('participationReservations').children.length,0);assert.equal(ui.get('participationCallActions').hidden,true);assert.equal(ui.get('participationCallRefresh').hidden,true);
  state.reservations=[{game:'lol',round:8}];ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.match(ui.get('participationReservations').textContent,/8판 예약/);assert.doesNotMatch(ui.get('participationReservations').textContent,/4판/);assert.equal(ui.get('participationCall').dataset.state,'recorded');assert.ok(ui.calls.every(call=>!call.options.body));
});

test('a persisted confirming result remains pending across reload and a later read shows only the recorded decision',async t=>{
  const state=callFixture();state.queue.callResponse=passResponse('confirming');state.queue.passPending=true;const ui=await viewer(t,{state});assert.equal(ui.get('participationCall').dataset.state,'confirming');assert.match(ui.get('participationCallTitle').textContent,/응답은 저장/);assert.equal(ui.get('participationCallRefresh').hidden,false);await ui.w.viewerTest.runParticipationAction('call_pass');assert.equal(ui.calls.filter(call=>call.options.body).length,0);
  state.queue.callResponse=passResponse();state.queue.passPending=false;state.queue.entry.status='postponed_next';state.actions={};ui.setState(state);await ui.get('participationCallRefresh').onclick();assert.equal(ui.get('participationCall').dataset.state,'recorded');assert.match(ui.get('participationHint').textContent,/기록과 현재 예약은 서로 다를 수/);assert.ok(ui.calls.every(call=>!call.options.body));
  state.queue.entry.status='called';state.actions={callJoin:true,callPass:true};for(const responseState of ['confirming','recorded']){state.queue.callResponse=passResponse(responseState);ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').dataset.state,responseState);assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,true);await ui.w.viewerTest.runParticipationAction('call_join');await ui.w.viewerTest.runParticipationAction('call_pass');}assert.ok(ui.calls.every(call=>!call.options.body));
});

test('missing retained history does not invent a pass result and joined is a neutral current Queue state',async t=>{
  const state=callFixture();state.queue.entry.status='postponed_next';state.queue.callResponse=null;state.actions={};const ui=await viewer(t,{state});assert.equal(ui.get('participationCall').hidden,true);assert.doesNotMatch(ui.get('participationCallTimer').textContent,/기록|예약으로 처리/);
  state.queue.entry.status='joined';delete state.queue.callResponse;ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').dataset.state,'joined');assert.equal(ui.get('participationCallTitle').textContent,'현재 대기열 상태: 참가 확인');assert.doesNotMatch(ui.get('participationCall').textContent,/전송했습니다|예약으로 처리|완료되었습니다/);assert.equal(ui.get('participationCallActions').hidden,true);assert.ok(ui.calls.every(call=>!call.options.body));
});

test('malformed or mismatched call results fail closed without rendering payload text or enabling a hidden write',async t=>{
  const state=callFixture(),ui=await viewer(t,{state}),valid=passResponse();
  const invalid=[[],{},'private-result-html', {...valid,action:'<img src=x onerror=alert(1)>'},{...valid,sessionId:'other-session'},{...valid,game:'er'},{...valid,round:2,targetRound:3},{...valid,attempt:2},{...valid,targetRound:8},{...valid,confirmedAt:null},{...valid,recordedAt:'private-result-date'},{...valid,confirmedAt:NOW-500},{...valid,state:'confirming',confirmedAt:NOW}];
  for(const response of invalid){state.queue.callResponse=response;ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').dataset.state,'unavailable');assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);await ui.w.viewerTest.runParticipationAction('call_pass');assert.doesNotMatch(ui.get('participationCall').textContent,/private-result|<img/);assert.equal(ui.get('participationCall').querySelector('img,svg'),null);}
  state.queue.callResponse=valid;state.session.id='new-session';ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').dataset.state,'unavailable');state.session.id='round-a';state.session.round=4;await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').dataset.state,'unavailable');state.session.round=3;state.session.game='er';await ui.w.viewerTest.loadParticipation();assert.equal(ui.get('participationCall').dataset.state,'unavailable');assert.ok(ui.calls.every(call=>!call.options.body));
});

test('a stale requested session hides even a valid retained result belonging to the current call',async t=>{
  const state=callFixture();state.queue.callResponse=passResponse();state.queue.entry.status='postponed_next';state.actions={};const ui=await viewer(t,{state,query:'?session=old-session'});assert.equal(ui.get('participationCall').hidden,true);assert.doesNotMatch(ui.get('participationCallTimer').textContent,/4판|기록/);assert.ok(ui.calls.every(call=>!call.options.body));
});

for(const failure of ['network','json'])test(`${failure} POST uncertainty blocks both buttons until an explicit read and never resubmits automatically`,async t=>{
  const state=callFixture();let posts=0;const ui=await viewer(t,{state,fetcher:(url,options)=>{if(url.endsWith('/participation/action')){posts++;return failure==='network'?Promise.reject(Error('private-network-path')):{ok:true,status:200,json:async()=>{throw Error('private-json-path');}};}}});const before=ui.calls.length;await ui.w.document.querySelector('[data-participation-action="call_pass"]').onclick();assert.equal(posts,1);assert.equal(ui.calls.length,before+1);assert.equal(ui.get('participationCall').dataset.state,'unknown');assert.equal(ui.get('participationCallRefresh').hidden,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,true);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);assert.doesNotMatch(ui.w.document.body.textContent,/private-network-path|private-json-path|패스 응답이 기록/);await ui.w.viewerTest.runParticipationAction('call_pass');assert.equal(posts,1);
  state.actions={callJoin:true,callPass:false};ui.setState(state);const start=ui.calls.length;await ui.get('participationCallRefresh').onclick();assert.equal(posts,1);assert.ok(ui.calls.slice(start).every(call=>!call.options.body&&call.options.method===undefined));assert.equal(ui.get('participationCall').dataset.state,'current');assert.match(ui.get('participationStatus').textContent,/현재 호출은 응답 대기.*이전 요청의 처리 완료는 확인되지/);assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);
});

test('failed or incomplete read leaves an uncertain response blocked without leaking the read failure',async t=>{
  const state=callFixture();let failRead=false;const ui=await viewer(t,{state,fetcher:url=>url.endsWith('/participation/action')?Promise.reject(Error('private-write-path')):url.endsWith('/participation')&&failRead?Promise.reject(Error('private-read-path')):undefined});await ui.w.viewerTest.runParticipationAction('call_pass');failRead=true;await ui.get('participationCallRefresh').onclick();assert.equal(ui.get('participationCall').dataset.state,'unknown');assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);assert.doesNotMatch(ui.w.document.body.textContent,/private-write-path|private-read-path/);
  failRead=false;ui.setState({serverTime:NOW,queue:{},actions:{}});await ui.get('participationCallRefresh').onclick();assert.equal(ui.get('participationCall').dataset.state,'unknown');assert.equal(ui.calls.filter(call=>call.options.body).length,1);
});

test('an uncertain pass resolves by GET into confirming then recorded without a second POST',async t=>{
  const state=callFixture(),ui=await viewer(t,{state,fetcher:url=>url.endsWith('/participation/action')?Promise.reject(Error('connection-lost')):undefined});await ui.w.viewerTest.runParticipationAction('call_pass');state.queue.callResponse=passResponse('confirming');state.queue.passPending=true;ui.setState(state);await ui.get('participationCallRefresh').onclick();assert.equal(ui.get('participationCall').dataset.state,'confirming');assert.doesNotMatch(ui.get('participationStatus').textContent,/확인하지 못했습니다/);
  state.queue.callResponse=passResponse();state.queue.passPending=false;state.queue.entry.status='postponed_next';state.actions={};await ui.get('participationCallRefresh').onclick();assert.equal(ui.get('participationCall').dataset.state,'recorded');assert.equal(ui.calls.filter(call=>call.options.body).length,1);
});

test('a detached old button cannot submit a recalled attempt and a fresh click includes the displayed call binding',async t=>{
  const state=callFixture(),writes=[],ui=await viewer(t,{state,fetcher:(url,options)=>{if(url.endsWith('/participation/action')){writes.push(JSON.parse(options.body));return result({state,result:{}});}}}),old=ui.w.document.querySelector('[data-participation-action="call_pass"]'),fresh=old.cloneNode(true);old.replaceWith(fresh);state.queue.entry.callAttempt=2;ui.setState(state);await ui.w.viewerTest.loadParticipation();await old.onclick();assert.equal(writes.length,0);assert.match(ui.get('participationStatus').textContent,/호출이 변경/);await fresh.onclick();assert.equal(writes.length,1);assert.deepEqual(writes[0].expectedCall,{entryId:'entry-a',attempt:2,sessionId:'round-a'});assert.equal(writes[0].action,'call_pass');
});

test('a new attempt clears an uncertain result and old acknowledgement instead of inheriting success',async t=>{
  const state=callFixture(),ui=await viewer(t,{state,fetcher:url=>url.endsWith('/participation/action')?Promise.reject(Error('connection-lost')):undefined});await ui.w.viewerTest.runParticipationAction('call_pass');state.queue.entry.callAttempt=2;state.queue.callResponse=null;ui.setState(state);await ui.get('participationCallRefresh').onclick();assert.equal(ui.get('participationCall').dataset.state,'current');assert.equal(ui.get('participationStatus').textContent,'');assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);assert.doesNotMatch(ui.get('participationCall').textContent,/記録|기록되었습니다|확인하지 못했습니다/);assert.equal(ui.calls.filter(call=>call.options.body).length,1);
});

test('a delayed successful POST cannot leave its success notice attached to a newer recalled call',async t=>{
  const state=callFixture(),next=callFixture();next.queue.entry.callAttempt=2;const ui=await viewer(t,{state,fetcher:(url,options)=>{if(url.endsWith('/participation/action')){ui.setState(next);const previous=structuredClone(state);previous.queue.entry.status='postponed_next';previous.queue.callResponse=passResponse();previous.actions={};return result({state:previous,result:{}});}}});await ui.w.document.querySelector('[data-participation-action="call_pass"]').onclick();assert.equal(ui.get('participationCall').dataset.state,'current');assert.equal(ui.get('participationStatus').textContent,'');assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);assert.equal(ui.calls.filter(call=>call.options.body).length,1);
});

test('missing or invalid public call attempts cannot authorize call writes',async t=>{
  const state=callFixture(),ui=await viewer(t,{state});for(const attempt of [0,-1,1.5,'1',null,undefined]){state.queue.entry.callAttempt=attempt;ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);await ui.w.viewerTest.runParticipationAction('call_pass');}assert.ok(ui.calls.every(call=>!call.options.body));
});
