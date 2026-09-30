import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { simulateDraw } from '../public/draw-engine.js';
import { recruitmentCard,attendanceCard } from '../src/messages.js';
import { validateProfile,hasGame } from '../src/profiles.js';
import { OperationsStore,applyAction } from '../src/operations.js';
import { balanceTeams,tierScore,normalizeLane,teamCost } from '../src/teams.js';
import { supportedNode } from '../scripts/dependencies.js';

test('all game modes return unique winners from their actual simulated paths/events',()=>{
 for(const mode of ['race','ladder','instant'])for(const n of [1,2,10,50,100])for(const count of [...new Set([1,Math.min(2,n),Math.min(50,n)])]){
  const ids=Array.from({length:n},(_,i)=>String(i)),trace=simulateDraw(ids,count,mode);
  assert.equal(trace.winners.length,count);assert.equal(new Set(trace.winners).size,count);assert.ok(trace.winners.every(id=>ids.includes(id)));
  if(mode==='race')assert.ok(trace.winners.every(id=>trace.events.at(-1)[trace.players.indexOf(id)]===(trace.finishDistance||1000)));
  if(mode==='ladder'){assert.equal(new Set(trace.paths.map(p=>p.at(-1))).size,n);assert.deepEqual(trace.winners,trace.players.filter((id,i)=>trace.slots.includes(trace.paths[i].at(-1))));}
 }
 for(const count of [0,1.5,-1,51])assert.throws(()=>simulateDraw(['a','b'],count,'race'));
 assert.throws(()=>simulateDraw(['a','b'],1,'battle'));
 assert.throws(()=>simulateDraw(['a','a'],1,'race'));
});
test('one-game profiles accepted, identity fields whitelisted and invalid nicknames rejected',()=>{
 const er=validateProfile({chzzkName:'별',erNickname:'테스트',guildId:'other'});assert.equal(hasGame(er,'er'),true);assert.equal(hasGame(er,'lol'),false);assert.equal(er.guildId,undefined);
 assert.equal(validateProfile({chzzkName:'별',lolRiotId:'별#KR1'}).lolRiotId,'별#KR1');
 assert.throws(()=>validateProfile({chzzkName:'a'.repeat(33),erNickname:'x'}));
 assert.throws(()=>validateProfile({chzzkName:'별',lolRiotId:'no-tag'}));assert.throws(()=>validateProfile({chzzkName:'별'}));
 assert.throws(()=>validateProfile({chzzkName:'별\n',erNickname:'x\n\tbad'}));
});
test('rank aliases, missing tiers, equal team sizes and position duplicates are handled',()=>{
 assert.equal(normalizeLane(' Jungle '),1);assert.equal(normalizeLane('서포터'),4);assert.equal(normalizeLane('아무거나'),-1);
 assert.ok(tierScore({lolCurrentTier:'그랜드마스터'},'lol')>tierScore({lolCurrentTier:'마스터'},'lol'));assert.ok(tierScore({lolCurrentTier:'골드1'},'lol')>tierScore({lolCurrentTier:'골드4'},'lol'));assert.equal(tierScore({},'er'),null);
 const records=Array.from({length:10},(_,i)=>({discordId:String(i),lolCurrentTier:['실버','골드'][i%2],lolMainLane:['탑','정글','미드','원딜','서폿'][i%5]}));
 const teams=balanceTeams(records,'lol');assert.deepEqual(teams.map(t=>t.length),[5,5]);assert.equal(new Set(teams.flat()).size,10);assert.ok(teamCost(teams,records,'lol')<=teamCost([records.slice(0,5).map(r=>r.discordId),records.slice(5).map(r=>r.discordId)],records,'lol'));
 assert.throws(()=>balanceTeams(records.slice(0,9),'lol'));assert.equal(balanceTeams(records.slice(0,9),'er').length,3);
});
test('closed Discord cards disable controls and old attendance rounds cannot confirm',()=>{
 const state={session:null,history:[]};applyAction(state,'open',{game:'lol',count:1});let s=state.session;applyAction(state,'join',{sessionId:s.id,userId:'a'});
 assert.equal(recruitmentCard(s).components[0].components.length,4);applyAction(state,'close');assert.ok(recruitmentCard(s).components[0].components.every(b=>b.disabled));
 applyAction(state,'draw');applyAction(state,'attendance',{minutes:1},0);assert.equal(attendanceCard(s,60000).components[0].components[0].disabled,true);
 applyAction(state,'attendance',{minutes:1},60001);assert.throws(()=>applyAction(state,'confirm',{sessionId:s.id,userId:'a',attendanceVersion:1},60002));applyAction(state,'confirm',{sessionId:s.id,userId:'a',attendanceVersion:2},60002);
});
test('corrupt saved state recovers previous backup without deleting the damaged original',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'backup-'));try{
  const file=path.join(dir,'ops.json'),store=new OperationsStore(file);await store.init();await store.update(s=>applyAction(s,'open',{game:'lol',count:2}));await store.update(s=>applyAction(s,'join',{sessionId:s.session.id,userId:'a'}));await writeFile(file,'{corrupt');
  const recovered=new OperationsStore(file);await recovered.init();assert.equal(recovered.recovered,true);assert.equal(recovered.read().session.count,2);assert.deepEqual(recovered.read().session.applicants,[]);
  await recovered.update(s=>applyAction(s,'join',{sessionId:s.session.id,userId:'b'}));assert.ok(recovered.read().session.applicants.includes('b'));
  await writeFile(file,'{broken');await writeFile(file+'.bak','{also broken');await assert.rejects(new OperationsStore(file).init());assert.equal(await readFile(file,'utf8'),'{broken');
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Node runtime floor matches project dependency requirements',()=>{assert.equal(supportedNode('20.19.0'),false);assert.equal(supportedNode('22.22.1'),false);assert.equal(supportedNode('22.22.2'),true);assert.equal(supportedNode('24.0.0'),true)});
