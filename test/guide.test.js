import test from 'node:test';
import assert from 'node:assert/strict';
import {guideState,editGuide,acknowledgeRules,guideProgress,guideCard,searchGuide} from '../src/guide.js';
import {applyAction} from '../src/operations.js';
import {EmbedBuilder,ActionRowBuilder} from 'discord.js';
test('guide drafts stay private until publish, reject stale edits, and invalidate old rule confirmation',()=>{
 const s={};acknowledgeRules(s,'alice',1,1);assert.equal(guideProgress(s,null,'alice').rulesConfirmed,true);
 editGuide(s,'draft',{key:'rules',content:{title:'새 규칙',body:'새 본문'},expectedRevision:0});
 assert.notEqual(guideCard(s,null,'alice','rules').embeds[0].title,'새 규칙');assert.equal(guideProgress(s,null,'alice').rulesConfirmed,true);
 assert.throws(()=>editGuide(s,'publish',{key:'rules',expectedRevision:0}),e=>e.statusCode===409);
 editGuide(s,'publish',{key:'rules',expectedRevision:1});assert.equal(guideCard(s,null,'alice','rules').embeds[0].description,'새 본문');
 assert.equal(guideProgress(s,null,'alice').rulesConfirmed,false);assert.throws(()=>acknowledgeRules(s,'alice',1));acknowledgeRules(s,'alice',2,2);acknowledgeRules(s,'alice',2,3);assert.equal(s.guide.acknowledgements.length,1);assert.equal(s.guide.acknowledgements[0].at,2);
});
test('FAQ search sees published content only and all page payloads fit Discord limits',()=>{
 const s={};editGuide(s,'draft',{key:'faq',content:{title:'질문',items:[{question:'초안비밀',answer:'초안답변'}]},expectedRevision:0});
 assert.equal(searchGuide(s,'초안비밀').length,0);editGuide(s,'publish',{key:'faq',expectedRevision:1});assert.equal(searchGuide(s,'초안비밀').length,1);
 for(const key of ['start','rules','faq']){const payload=guideCard(s,null,'user',key,999);for(const embed of payload.embeds)new EmbedBuilder(embed).toJSON();for(const row of payload.components)ActionRowBuilder.from(row).toJSON();assert.deepEqual(payload.allowedMentions,{parse:[]});}
 assert.throws(()=>editGuide(s,'draft',{key:'start',content:{title:'t',body:'x'.repeat(3001)},expectedRevision:2}));assert.throws(()=>searchGuide(s,{}));
});
test('personal progress is derived from the current participant and current round',()=>{
 const s={};applyAction(s,'open',{game:'lol',count:1});applyAction(s,'join',{sessionId:s.session.id,userId:'alice'});
 let progress=guideProgress(s,{lolRiotId:'name#KR1'},'alice');assert.equal(progress.profileLinked,true);assert.equal(progress.joined,true);assert.equal(guideProgress(s,null,'bob').joined,false);
 applyAction(s,'postpone_next',{sessionId:s.session.id,userId:'alice'});progress=guideProgress(s,null,'alice');assert.equal(progress.joined,false);assert.equal(progress.reservations.length,1);
 const original=guideState(s);original.pages.start.published.title='local';assert.notEqual(guideState(s).pages.start.published.title,'local');
});
