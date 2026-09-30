import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLiveModeModel,quickStartPreset} from '../public/live-control.js';

test('live quick-start presets expose broadcast defaults',()=>{
 const aram=quickStartPreset('aram'),rift=quickStartPreset('rift'),er=quickStartPreset('er');
 assert.deepEqual({game:aram.game,mode:aram.mode,count:aram.count},{game:'lol',mode:'aram',count:10});
 assert.deepEqual({game:rift.game,mode:rift.mode,count:rift.count},{game:'lol',mode:'rift',count:10});
 assert.deepEqual({game:er.game,count:er.count},{game:'er',count:3});
 assert.match(aram.title,/칼바람/);assert.equal(quickStartPreset('unknown'),null);
});

test('live mode locks and recommends actions from session phase',()=>{
 const base={applicants:['a','b'],postponed:[],winners:[],confirmed:[],teams:[],count:2,round:7,game:'lol',mode:'aram',title:'칼바람 시참'};
 let model=buildLiveModeModel({derived:{s:{...base,phase:'open'},active:true,ready:['a','b'],pending:[],postponed:[]},liveState:'live'});
 assert.equal(model.next.action,'close');assert.equal(model.allowed.close,true);assert.equal(model.allowed.draw,false);assert.match(model.title,/7판/);
 model=buildLiveModeModel({derived:{s:{...base,phase:'closed'},active:true,ready:['a','b'],pending:[],postponed:[]}});
 assert.equal(model.next.action,'draw');assert.equal(model.allowed.draw,true);
 model=buildLiveModeModel({derived:{s:{...base,phase:'drawn',winners:['a','b']},active:true,ready:['a','b'],pending:['a','b'],postponed:[]}});
 assert.equal(model.next.action,'attendance');assert.equal(model.allowed.attendance,true);
});

test('live mode requires attendance deadline before replacement and teams after full confirmation',()=>{
 const now=1_000_000,base={id:'s1',applicants:['a','b'],postponed:[],winners:['a','b'],confirmed:['a'],teams:[],count:2,round:1,game:'lol',mode:'rift',title:'내전',phase:'checking',deadline:now-1};
 let model=buildLiveModeModel({derived:{s:base,active:true,ready:['a','b'],pending:['b'],postponed:[]},now});
 assert.equal(model.allowed.replace,true);assert.equal(model.next.action,'replace');
 const confirmed={...base,confirmed:['a','b']};
 model=buildLiveModeModel({derived:{s:confirmed,active:true,ready:['a','b'],pending:[],postponed:[]},now});
 assert.equal(model.allowed.teams,true);assert.equal(model.allowed.reshuffle,false);assert.equal(model.next.action,'teams');
});
