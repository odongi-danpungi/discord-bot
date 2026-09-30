import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMobileBroadcastModel, mobilePollVoteCount, parseMobilePollOptions, toLocalDateTimeInput } from '../public/mobile-broadcast-model.js';
import { operatorStaticAllowed } from '../src/dashboard-access.js';

test('mobile broadcast model respects delegated broadcast/live capabilities and active-session safety',()=>{
  const base={
    access:{role:'operator',user:'producer',capabilities:['broadcast']},
    state:{session:null},
    broadcastOps:{gamePresets:[{id:'builtin_1',name:'칼바람',builtin:true,game:'lol',mode:'aram',count:10}],schedules:[],notifications:{},timeline:[],stats:{}}
  };
  const broadcastOnly=buildMobileBroadcastModel(base,1000);
  assert.equal(broadcastOnly.allowed,true);assert.equal(broadcastOnly.access.live,false);assert.equal(broadcastOnly.presets[0].canStart,false);

  const withLive=buildMobileBroadcastModel({...base,access:{role:'operator',user:'producer',capabilities:['broadcast','live']}},1000);
  assert.equal(withLive.presets[0].canStart,true);

  const active=buildMobileBroadcastModel({...base,access:{role:'admin',user:'admin',capabilities:['*']},state:{session:{id:'s1',phase:'open'}}},1000);
  assert.equal(active.sessionActive,true);assert.equal(active.canSaveCurrent,true);assert.equal(active.presets[0].canStart,false);

  const denied=buildMobileBroadcastModel({...base,access:{role:'operator',user:'queue-helper',capabilities:['queue']}},1000);
  assert.equal(denied.allowed,false);
});

test('mobile poll model supports admin vote arrays and sanitized operator vote counts',()=>{
  assert.equal(mobilePollVoteCount({votes:['a','b','c']}),3);
  assert.equal(mobilePollVoteCount({voteCount:4}),4);
  const model=buildMobileBroadcastModel({broadcastOps:{activePoll:{id:'p1',question:'다음 게임?',options:[{id:'a',label:'칼바람',votes:['x','y']},{id:'b',label:'협곡',voteCount:3}]}}});
  assert.equal(model.activePoll.totalVotes,5);assert.deepEqual(model.activePoll.options.map(o=>o.voteCount),[2,3]);
});

test('mobile poll options normalize comma/newline input and remove case-insensitive duplicates',()=>{
  assert.deepEqual(parseMobilePollOptions('칼바람, 협곡\n이터널 리턴,협곡'),['칼바람','협곡','이터널 리턴']);
  assert.deepEqual(parseMobilePollOptions('ARAM,aram,RIFT'),['ARAM','RIFT']);
});

test('mobile local datetime helper produces datetime-local compatible value',()=>{
  assert.match(toLocalDateTimeInput(Date.now()+3600000),/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('mobile page exposes Broadcast Hub controls and reuses protected server APIs',()=>{
  const html=fs.readFileSync(new URL('../public/mobile-control.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/mobile-control.js',import.meta.url),'utf8');
  assert.match(html,/id="mobileTabHub"/);assert.match(html,/BROADCAST HUB/);assert.match(html,/게임 프리셋/);assert.match(html,/방송 일정/);assert.match(html,/시청자 투표/);assert.match(html,/통합 알림센터/);assert.match(html,/최근 방송 타임라인/);
  assert.match(js,/\/api\/broadcast-ops\/preset/);assert.match(js,/\/api\/broadcast-ops\/schedule/);assert.match(js,/\/api\/broadcast-ops\/poll/);assert.match(js,/\/api\/broadcast-ops\/notifications/);assert.match(js,/\/api\/chzzk\/live\/run/);
  assert.match(js,/liveGuard:false/);assert.match(js,/liveGuard:true/);
  assert.doesNotMatch(html,/on(click|change|submit)=/i);
});

test('delegated operator static allowlist includes only the new mobile hub module, not full dashboard assets',()=>{
  assert.equal(operatorStaticAllowed('/mobile-broadcast-model.js'),true);
  assert.equal(operatorStaticAllowed('/mobile-control.html'),true);
  assert.equal(operatorStaticAllowed('/app.js'),false);
  assert.equal(operatorStaticAllowed('/index.html'),false);
});
