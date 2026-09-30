import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBroadcastOverlaySnapshot} from '../src/broadcast-state.js';

const records=[
  {guildId:'g',discordId:'111111111111111111',discordUsername:'alpha',chzzkName:'방울'},
  {guildId:'g',discordId:'222222222222222222',discordUsername:'beta',chzzkName:'세모'}
];

function state(){return {revision:9,session:{id:'s1',round:4,game:'lol',mode:'aram',title:'칼바람 시참',description:'',phase:'drawn',count:2,createdAt:1000,closeAt:null,deadline:null,applicants:['111111111111111111','222222222222222222'],postponed:[],winners:['111111111111111111','222222222222222222'],confirmed:[],excluded:[],teams:[['111111111111111111'],['222222222222222222']],teamMeta:{generatedAt:3000}},lastDraw:{id:'d1',sessionId:'s1',at:2000,mode:'instant',players:['111111111111111111','222222222222222222'],winners:['111111111111111111','222222222222222222']}};}

test('OBS overlay snapshot exposes safe current/next queue data, teams and event feed',()=>{
  const queue={activeCount:3,counts:{waiting:1,called:1,joined:1},entries:[
    {id:'q1',position:1,sequence:1,source:'discord',status:'called',displayName:'방울',discordUserId:'111111111111111111',calledAt:3500,callDeadline:65000,updatedAt:3500},
    {id:'q2',position:2,sequence:2,source:'naver',status:'waiting',displayName:'세모',naverKey:'a'.repeat(64),updatedAt:3400},
    {id:'q3',position:3,sequence:3,source:'dashboard',status:'joined',displayName:'네모',updatedAt:3300}
  ],history:[{id:'h1',at:3600,action:'call',displayName:'방울',source:'discord',status:'called',details:{}}]};
  const overlay=buildBroadcastOverlaySnapshot(state(),records,queue,'4.13.4',5000),json=JSON.stringify(overlay);
  assert.equal(overlay.current.displayName,'방울');
  assert.equal(overlay.current.status,'called');
  assert.equal(overlay.next.displayName,'세모');
  assert.deepEqual(overlay.teams,[['방울'],['세모']]);
  assert.deepEqual(overlay.winners,['방울','세모']);
  assert.match(overlay.eventFeed[0].message,/방울.*참가 호출/);
  assert.equal(json.includes('111111111111111111'),false);
  assert.equal(json.includes('discordUserId'),false);
  assert.equal(json.includes('naverKey'),false);
});

test('OBS overlay files provide transparent Browser Source UI and live SSE reconnect',async()=>{
  const [html,css,js,server,dashboard]=await Promise.all([
    readFile(new URL('../public/overlay.html',import.meta.url),'utf8'),
    readFile(new URL('../public/overlay.css',import.meta.url),'utf8'),
    readFile(new URL('../public/overlay.js',import.meta.url),'utf8'),
    readFile(new URL('../src/broadcast.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  for(const id of ['currentName','nextName','overlayWinners','overlayTeams','overlayEvents','callCountdown'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(css,/background:transparent!important/);
  assert.match(js,/\/broadcast\/api\/events/);
  assert.match(js,/45000/);
  assert.match(js,/layout/);
  assert.match(js,/hide-/);
  assert.match(server,/participationQueue\?\.subscribe/);
  assert.match(server,/\/overlay\.css/);
  assert.match(server,/overlay\.html/);
  assert.match(dashboard,/OBS BROWSER SOURCE/);
  assert.match(dashboard,/obsOverlayPreviewFrame/);
  assert.match(dashboard,/BROADCAST_TOKEN/);
});
