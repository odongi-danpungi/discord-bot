import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBroadcastSnapshot,sanitizeBroadcastDraw} from '../src/broadcast-state.js';

const records=[
 {guildId:'g',discordId:'111111111111111111',discordUsername:'alpha',chzzkName:'방울'},
 {guildId:'g',discordId:'222222222222222222',discordUsername:'beta',chzzkName:'방울'},
 {guildId:'g',discordId:'333333333333333333',discordUsername:'gamma',chzzkName:'세모'}
];

test('broadcast snapshot exposes display names but not Discord ids',()=>{
 const state={revision:7,session:{id:'session-1',round:3,game:'lol',mode:'rift',title:'협곡 내전',description:'설명',phase:'checking',count:2,createdAt:1,closeAt:null,deadline:9999,applicants:['111111111111111111','222222222222222222','333333333333333333'],postponed:[],winners:['111111111111111111','333333333333333333'],confirmed:['111111111111111111'],excluded:[],teams:[]},lastDraw:{id:'draw-1',sessionId:'session-1',at:2,mode:'race',winners:['111111111111111111','333333333333333333'],names:{'111111111111111111':'방울','333333333333333333':'세모'}}};
 const snapshot=buildBroadcastSnapshot(state,records,'3.4.0',10000),json=JSON.stringify(snapshot);
 assert.equal(snapshot.version,'3.4.0');
 assert.deepEqual(snapshot.session.applicants,['방울','방울 2','세모']);
 assert.deepEqual(snapshot.session.winners,['방울','세모']);
 assert.deepEqual(snapshot.draw.winners,['방울','세모']);
 for(const id of records.map(r=>r.discordId))assert.equal(json.includes(id),false);
});

test('broadcast draw aliases player ids and rekeys avatars',()=>{
 const draw={id:'draw-2',sessionId:'session-1',at:2,mode:'race',players:['111111111111111111','333333333333333333'],winners:['333333333333333333'],names:{'111111111111111111':'방울','333333333333333333':'세모'},avatars:{'111111111111111111':{color:'#fff'},'333333333333333333':{color:'#000'}},version:4,laps:3,finishDistance:3000,raceFrames:[{tick:0,positions:[0,0],rank:[0,1]}]};
 const safe=sanitizeBroadcastDraw(draw,records),json=JSON.stringify(safe);
 assert.deepEqual(safe.players,['p1','p2']);
 assert.deepEqual(safe.winners,['p2']);
 assert.equal(safe.names.p1,'방울');
 assert.equal(safe.avatars.p2.color,'#000');
 assert.equal(json.includes('111111111111111111'),false);
 assert.equal(json.includes('333333333333333333'),false);
 assert.equal('sessionId' in safe,false);
});

test('standalone or stale draw is not attached to active broadcast session',()=>{
 const state={revision:1,session:{id:'session-1',round:1,game:'er',mode:'rift',title:'ER',description:'',phase:'open',count:2,createdAt:1,applicants:[],postponed:[],winners:[],confirmed:[],excluded:[],teams:[]},lastDraw:{id:'standalone',sessionId:null,at:1,mode:'instant',winners:[]}};
 assert.equal(buildBroadcastSnapshot(state,records,'3.4.0').draw,null);
});


test('duplicate display names stay stable across winners and confirmations',()=>{
 const state={revision:2,session:{id:'session-dup',round:1,game:'lol',mode:'rift',title:'중복 이름',description:'',phase:'checking',count:2,createdAt:1,deadline:9999,applicants:['111111111111111111','222222222222222222'],postponed:[],winners:['111111111111111111','222222222222222222'],confirmed:['222222222222222222'],excluded:[],teams:[]}};
 const snapshot=buildBroadcastSnapshot(state,records,'3.4.0');
 assert.deepEqual(snapshot.session.winners,['방울','방울 2']);
 assert.deepEqual(snapshot.session.confirmed,['방울 2']);
});


test('broadcast snapshot applies mapped preset and exposes only safe automation state',()=>{
 const preset={id:'bp_abcdef',name:'ER 방송',settings:{theme:'warm',layout:'compact',transition:'cut',soundCue:'off',winnerRevealSeconds:4,brandTitle:'ER LIVE',footerTitle:'LIVE',standbyTitle:'대기',standbyMessage:'대기',showHeader:true,showFooter:true,showTelemetry:false,showRecentApplicants:true,showCountdown:true,scenes:{recruit:true,drawReady:true,winners:true,attendance:true,teams:true,ended:true}},createdAt:1,updatedAt:1};
 const state={revision:3,broadcastSettings:{theme:'midnight'},broadcastPresets:[preset],broadcastAutomation:{enabled:true,mapping:{er:preset.id},forcedScene:'teams',forcedSceneUntil:20000,endedHoldSeconds:9},session:{id:'s',round:1,game:'er',mode:'rift',title:'ER',description:'',phase:'open',count:1,createdAt:1,applicants:[],postponed:[],winners:[],confirmed:[],excluded:[],teams:[]}};
 const snapshot=buildBroadcastSnapshot(state,records,'3.5.0',10000);
 assert.equal(snapshot.settings.theme,'warm');assert.equal(snapshot.activePresetId,preset.id);assert.equal(snapshot.sceneOverride,'teams');assert.deepEqual(snapshot.automation,{enabled:true,endedHoldSeconds:9});
 assert.equal('mapping' in snapshot.automation,false);
});
