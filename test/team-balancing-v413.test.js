import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeams, teamCost, teamMetrics, TEAM_STRATEGIES } from '../src/teams.js';
import { applyAction } from '../src/operations.js';

const records=Array.from({length:10},(_,i)=>({
  discordId:String(i),
  lolMainLane:['top','jungle','mid','adc','support'][i%5],
  lolCurrentTier:['silver','gold','platinum','emerald','diamond'][i%5]
}));
const zeroRandom=()=>0;

test('team strategies always preserve unique full teams',()=>{
  for(const strategy of TEAM_STRATEGIES){
    const result=createTeams(records,'lol','rift',{strategy,randomInt:zeroRandom});
    assert.deepEqual(result.teams.map(team=>team.length),[5,5]);
    assert.equal(new Set(result.teams.flat()).size,10);
    assert.equal(result.meta.strategy,strategy);
  }
});

test('balanced mode improves or matches the naive team cost',()=>{
  const naive=[records.slice(0,5).map(r=>r.discordId),records.slice(5).map(r=>r.discordId)];
  const result=createTeams(records,'lol','rift',{strategy:'balanced',randomInt:zeroRandom});
  assert.ok(teamCost(result.teams,records,'lol','rift',{strategy:'balanced'})<=teamCost(naive,records,'lol','rift',{strategy:'balanced'}));
});

test('recent team history reduces repeated teammate pairs when alternatives exist',()=>{
  const same=Array.from({length:10},(_,i)=>({discordId:String(i),lolMainLane:'top',lolCurrentTier:'gold'}));
  const first=createTeams(same,'lol','rift',{strategy:'balanced',randomInt:zeroRandom});
  const repeatedWithoutChange=teamMetrics(first.teams,same,'lol','rift',{previousTeams:[first.teams]});
  const next=createTeams(same,'lol','rift',{strategy:'balanced',previousTeams:[first.teams],randomInt:zeroRandom});
  assert.ok(next.meta.repeatedPairs<repeatedWithoutChange.repeatedPairs);
});

test('operations records team strategy metadata and supports reshuffle',()=>{
  const state={session:null,history:[],sessionArchive:[]};
  applyAction(state,'open',{game:'lol',mode:'rift',count:10},0);
  const sessionId=state.session.id;
  for(const record of records)applyAction(state,'join',{sessionId,userId:record.discordId},1);
  applyAction(state,'close',{},2);
  applyAction(state,'draw',{ids:records.map(r=>r.discordId)},3);
  applyAction(state,'attendance',{minutes:1},4);
  for(const record of records)applyAction(state,'confirm',{sessionId,userId:record.discordId},5);
  applyAction(state,'teams',{records,strategy:'tier',historyDepth:5},6);
  assert.equal(state.session.teamMeta.strategy,'tier');
  assert.equal(state.session.teamMeta.reshuffleCount,0);
  const first=structuredClone(state.session.teams);
  applyAction(state,'reshuffle',{records,strategy:'balanced',historyDepth:5},7);
  assert.equal(state.session.teamMeta.strategy,'balanced');
  assert.equal(state.session.teamMeta.reshuffleCount,1);
  assert.equal(new Set(state.session.teams.flat()).size,10);
  assert.notDeepEqual(state.session.teams,first);
  applyAction(state,'end',{},8);
  assert.equal(state.sessionArchive[0].teamMeta.strategy,'balanced');
});
