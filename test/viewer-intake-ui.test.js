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
  assert.match(ui.get('recruitmentDeadline').textContent,/1분 0초/);assert.match(card.textContent,/네이버 카페·수동 Queue의 인원은 합산하지 않습니다/);
  assert.equal(ui.get('recruitmentStatus').getAttribute('role'),'status');assert.equal(ui.w.document.querySelectorAll('[data-participation-action="join"]').length,1);
  assert.deepEqual(ui.calls.map(call=>call.url).sort(),['/viewer/api/me','/viewer/api/mode','/viewer/api/participation','/viewer/api/poll','/viewer/api/ready-check'].sort());
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
  const state=fixture();Object.assign(state.recruitment,{status:'full',reason:'capacity',activeApplicants:10,remainingSlots:0});state.queue.entry={status:'called',statusLabel:'호출됨',position:2,callDeadline:NOW+10000};state.reservations=[{game:'lol',round:4}];state.actions={join:true,callJoin:true,callPass:true,cancelReservation:false};
  const ui=await viewer(t,{state});assert.equal(ui.get('participationCall').hidden,false);assert.equal(ui.get('participationPosition').textContent,'2번');assert.match(ui.get('participationReservations').textContent,/4판 예약/);assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,false);assert.equal(ui.w.document.querySelector('[data-participation-action="join"]'),null);
  ui.advance(11000);assert.equal(ui.get('participationCall').hidden,true);await ui.w.viewerTest.runParticipationAction('call_join');assert.ok(ui.calls.every(call=>!call.options.body));
});

test('own call remains answerable after intake expiry while same-session pass is blocked with operator guidance',async t=>{
  const state=fixture();state.session.closeAt=NOW+1000;state.recruitment.closeAt=NOW+1000;state.queue.entry={status:'called',statusLabel:'호출됨',sessionId:'round-a',callDeadline:NOW+10000};state.actions={callJoin:true,callPass:true};
  const ui=await viewer(t,{state});assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,false);ui.advance(2000);
  assert.equal(ui.get('participationCall').hidden,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);assert.match(ui.get('participationHint').textContent,/모집 마감 후 패스 예약 변경은 진행자에게 요청/);
  await ui.w.viewerTest.runParticipationAction('call_pass');assert.ok(ui.calls.every(call=>!call.options.body));
  state.serverTime=NOW+2000;state.session.phase='closed';state.recruitment.status='closed';state.recruitment.reason='deadline';state.actions.callPass=false;ui.setState(state);await ui.w.viewerTest.loadParticipation();assert.equal(ui.w.document.querySelector('[data-participation-action="call_join"]').disabled,false);assert.equal(ui.w.document.querySelector('[data-participation-action="call_pass"]').disabled,true);assert.match(ui.get('participationHint').textContent,/진행자에게 요청/);
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
