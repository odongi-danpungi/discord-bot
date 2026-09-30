import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMobileControlModel } from '../public/mobile-control-model.js';

test('mobile page is linked from admin dashboard and uses dedicated assets',()=>{
  const html=fs.readFileSync(new URL('../public/mobile-control.html',import.meta.url),'utf8');
  const dashboard=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/MOBILE LIVE CONTROL/);
  assert.match(html,/mobile-control\.css/);
  assert.match(html,/mobile-control\.js/);
  assert.match(html,/다음 참가자 호출/);
  assert.match(html,/현재 회차 종료/);
  assert.match(dashboard,/\/mobile-control\.html/);
});

test('mobile model prioritizes a current participant call',()=>{
  const now=1_000_000;
  const model=buildMobileControlModel({
    version:'4.14.0',
    state:{session:{id:'s1',round:2,game:'lol',mode:'aram',phase:'open',count:10,applicants:['a'],postponed:[],winners:[],confirmed:[]}},
    participationQueue:{entries:[{id:'q1',displayName:'테스터',source:'discord',status:'called',position:1}],currentCall:null},
    participationCalls:{timeoutSeconds:60,current:{id:'q1',displayName:'테스터',source:'discord',status:'called',callDeadline:now+42_000}},
    chzzkLive:{state:{lastKnownLive:true}}
  },now);
  assert.equal(model.primary.action,'joined');
  assert.equal(model.callSeconds,42);
  assert.equal(model.actions.joined,true);
  assert.equal(model.live,true);
  assert.equal(model.gameLabel,'칼바람 나락');
});

test('mobile model offers next waiting participant when no call is active',()=>{
  const model=buildMobileControlModel({
    state:{session:{id:'s1',round:1,game:'lol',mode:'rift',phase:'open',count:10,applicants:[],postponed:[],winners:[],confirmed:[]}},
    participationQueue:{entries:[{id:'q2',displayName:'둘째',source:'naver',status:'waiting',position:2},{id:'q1',displayName:'첫째',source:'dashboard',status:'waiting',position:1}]},
    participationCalls:{current:null}
  });
  assert.equal(model.primary.action,'callNext');
  assert.equal(model.waiting[0].displayName,'첫째');
  assert.equal(model.waitingCount,2);
});


test('mobile client keeps protected mutation and real-time synchronization contracts',()=>{
  const js=fs.readFileSync(new URL('../public/mobile-control.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(js,/X-CSRF-Token/);
  assert.match(js,/Idempotency-Key/);
  assert.match(js,/new EventSource\('\/api\/events'\)/);
  assert.match(js,/\/api\/operations\//);
  assert.match(js,/\/api\/participation-queue/);
  const authIndex=server.indexOf('WWW-Authenticate');
  const staticIndex=server.indexOf("app.use(express.static");
  assert.ok(authIndex>=0&&staticIndex>authIndex,'admin auth must run before public dashboard static assets');
});

test('mobile model applies delegated operator capabilities to one-tap controls',()=>{
  const model=buildMobileControlModel({
    access:{role:'operator',user:'producer',capabilities:['queue']},
    state:{session:{id:'s1',round:4,game:'lol',mode:'aram',phase:'open',count:10,applicantCount:3,postponedCount:0,winnerCount:0,confirmedCount:0,teamCount:0}},
    participationQueue:{entries:[{id:'q1',displayName:'첫째',source:'discord',status:'waiting',position:1}]},
    participationCalls:{current:null}
  });
  assert.equal(model.actions.callNext,true);assert.equal(model.actions.close,false);assert.equal(model.actions.publish,false);assert.equal(model.primary.action,'callNext');
  assert.equal(model.readyCount,3);assert.equal(model.access.role,'operator');
});

test('mobile delegated UI exposes role status while hiding full-dashboard links for operators',()=>{
  const html=fs.readFileSync(new URL('../public/mobile-control.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/mobile-control.js',import.meta.url),'utf8');
  assert.match(html,/id="mobileAccess"/);assert.match(html,/id="mobileFullLink"/);assert.match(js,/model\.access\?\.role==='operator'/);assert.match(js,/mobileFullLink/);assert.match(js,/action==='none'/);
});
