import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OperationsStore,applyAction } from '../src/operations.js';
import {CommunityService,communityState,communityView,fairSelect} from '../src/community.js';
const user='111111111111111111',other='222222222222222222';
test('overlapping personal panel requests cannot publish twice and lock releases after failure',async t=>{
  const {service,discord}=await fixture(t);let finish,calls=0;
  discord.communityPanel=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const first=service.panel();
  await assert.rejects(service.panel(),error=>error.statusCode===409);
  assert.equal(calls,1);finish({id:'existing-panel'});await first;
  discord.communityPanel=async({ref})=>{assert.equal(ref.id,'existing-panel');throw Error('offline');};
  await assert.rejects(service.panel(),/offline/);
  discord.communityPanel=async({ref})=>ref;
  await service.panel();
});
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'community-'));t.after(()=>rm(dir,{recursive:true,force:true}));const operations=await new OperationsStore(path.join(dir,'ops.json')).init();let sends=0;const discord={communityNotice:async()=>{sends++;return {id:'message'};},communitySubscription:async()=>{},communityPanel:async()=>({id:'panel'})};const service=new CommunityService({operations,config:{guildId:'999999999999999999',publicBaseUrl:'https://bot.example.com'},discord,naver:{writeArticle:async()=>{sends++;return {articleId:'article'};}}});await service.settings({revision:0,channelId:'333333333333333333',roles:{aram:'444444444444444444'},fairness:{enabled:false,unplayedFirst:true,waitFirst:true,maxConsecutive:0,newcomerSlots:0}});return {service,operations,discord,sends:()=>sends};}
test('new community settings do not mutate existing round selection policy',async t=>{const {service,operations}=await fixture(t);await operations.update(s=>applyAction(s,'open',{game:'lol',mode:'aram',count:2}));await service.settings({revision:1,...communityState(operations.read()).settings,fairness:{enabled:true,unplayedFirst:true,waitFirst:true,maxConsecutive:2,newcomerSlots:1}});assert.equal(operations.read().session.communityFairness.enabled,false);});
test('settings reject stale edits, privileged everyone ID and duplicate topics',async t=>{const {service,operations}=await fixture(t),settings=communityState(operations.read()).settings;await assert.rejects(service.settings({...settings,revision:0}),/다른 창/);await assert.rejects(service.settings({...settings,revision:1,roles:{aram:'999999999999999999'}}),/@everyone/);await assert.rejects(service.settings({...settings,revision:1,roles:{aram:'444444444444444444',rift:'444444444444444444'}}),/서로 다른/);});
test('recruitment links use verified viewer and bind to round; posting closed round is denied',async t=>{const {service,operations}=await fixture(t);await operations.update(s=>applyAction(s,'open',{game:'lol',mode:'aram',count:2}));const d=await service.draft({kind:'recruitment',topic:'aram'});assert.match(d.content,/https:\/\/bot.example.com\/viewer\/\?session=/);assert.match(d.content,/카페 댓글은 자동 접수되지 않습니다/);await operations.update(s=>applyAction(s,'close'));await assert.rejects(service.publish({id:d.id,targets:['discord'],confirm:'게시'}),/모집 상태/);});
test('unconfirmed publish never writes; sent delivery is not resent',async t=>{const {service,sends}=await fixture(t),d=await service.draft({kind:'notice',content:'안내'});await assert.rejects(service.publish({id:d.id,targets:['discord']}),/미리보기/);assert.equal(sends(),0);await service.publish({id:d.id,targets:['discord','naver'],confirm:'게시'});assert.equal(sends(),2);await service.publish({id:d.id,targets:['discord','naver'],confirm:'게시'});assert.equal(sends(),2);});
test('overlapping publishes cannot send duplicates',async t=>{const {service,discord,sends}=await fixture(t);let done;discord.communityNotice=()=>new Promise(r=>{done=r;});const d=await service.draft({kind:'notice',content:'안내'}),p=service.publish({id:d.id,targets:['discord'],confirm:'게시'});while(!done)await new Promise(r=>setTimeout(r,2));await assert.rejects(service.publish({id:d.id,targets:['discord'],confirm:'게시'}),/불확실/);await assert.rejects(service.resolve({id:d.id,target:'discord',status:'draft',reason:'테스트'}),/전송 중/);done({id:'m'});await p;assert.equal(sends(),0);});
test('ambiguous external error is redacted, persisted and blocks retry until manual resolution',async t=>{const {service,operations,discord}=await fixture(t);discord.communityNotice=async()=>{throw Error('SECRET-BEARER hidden');};const d=await service.draft({kind:'notice',content:'안내'});await service.publish({id:d.id,targets:['discord'],confirm:'게시'});const view=communityView(operations);assert.equal(view.drafts[0].delivery.discord.status,'uncertain');assert.ok(!JSON.stringify(view).includes('SECRET'));await assert.rejects(service.publish({id:d.id,targets:['discord'],confirm:'게시'}),/불확실/);await service.resolve({id:d.id,target:'discord',status:'sent',reason:'게시물 확인',revision:view.revision});assert.equal(communityView(operations).drafts[0].delivery.discord.status,'sent');});
test('a fresh service retains uncertain states after restart',async t=>{const {service,operations,discord}=await fixture(t);const d=await service.draft({kind:'notice',content:'안내'});await service.mutate(c=>{c.drafts[0].delivery.discord.status='sending';});const restarted=new CommunityService({operations,discord,config:{}});await assert.rejects(restarted.publish({id:d.id,targets:['discord'],confirm:'게시'}),/불확실/);});
test('per-topic cooldown prevents repeated announcements',async t=>{const {service}=await fixture(t);const a=await service.draft({kind:'notice',content:'one'}),b=await service.draft({kind:'notice',content:'two'});await service.publish({id:a.id,targets:['discord'],confirm:'게시'});await assert.rejects(service.publish({id:b.id,targets:['discord'],confirm:'게시'}),/1분/);});
test('Naver publication escapes HTML and never embeds script',async t=>{const {service}=await fixture(t);let content;service.naver={writeArticle:async body=>{content=body.content;return {articleId:'1'};}};const d=await service.draft({kind:'notice',content:'<script>alert(1)</script>\n&'});await service.publish({id:d.id,targets:['naver'],confirm:'게시'});assert.match(content,/&lt;script&gt;/);assert.ok(!content.includes('<script>'));});
test('own tickets and subscriptions never expose another user',async t=>{const {service,operations}=await fixture(t);await service.ticket(user,{message:'first'});await service.ticket(other,{message:'private-other'});await service.subscribe(other,{topic:'aram',enabled:true});const own=communityView(operations,user);assert.equal(own.tickets.length,1);assert.equal(own.subscriptions.length,0);assert.ok(!JSON.stringify(own).includes('private-other'));await assert.rejects(service.ticket(user,{message:'again'}),/1분/);});
test('role failure keeps retryable intent and blocks role reassignment',async t=>{const {service,operations,discord}=await fixture(t);discord.communitySubscription=async()=>{throw Error('secret');};await assert.rejects(service.subscribe(user,{topic:'aram',enabled:false}),/역할을 적용/);assert.equal(communityView(operations,user).subscriptions[0].status,'needs_retry');const c=communityState(operations.read());await assert.rejects(service.settings({...c.settings,roles:{},revision:c.revision}),/확인 중/);});
test('recap exposes aggregate counts without no-show identities',async t=>{const {service,operations}=await fixture(t);await operations.update(s=>{s.sessionArchive=[{id:'ended',title:'방송',round:1,applicants:[user,other],confirmed:[user],noShows:[other],game:'lol',endedAt:Date.now()}];});const d=await service.draft({kind:'recap',archiveId:'ended',content:'다음 주 만나요'});assert.match(d.content,/신청 2명/);assert.ok(!d.content.includes(other));});
test('emergency/drain guard denies publication, settings and participant mutations',async t=>{const {service,sends}=await fixture(t);service.guard=()=>{throw Error('locked');};await assert.rejects(service.draft({kind:'notice'}),/locked/);await assert.rejects(service.ticket(user,{message:'hello'}),/locked/);await assert.rejects(service.subscribe(user,{topic:'aram',enabled:true}),/locked/);assert.equal(sends(),0);});
test('fair selection honors unplayed priority, newcomer quota and consecutive cap',()=>{const now=Date.now(),state={session:{game:'lol',mode:'aram',communityFairness:{enabled:true,unplayedFirst:true,waitFirst:true,maxConsecutive:2,newcomerSlots:1}},sessionArchive:[{game:'lol',mode:'aram',endedAt:now,confirmed:['a','b']},{game:'lol',mode:'aram',endedAt:now-1000,confirmed:['a']}]};assert.deepEqual(fairSelect(state,['a','b','c','d'],2,now,()=>1),['c','d']);assert.throws(()=>fairSelect(state,['a','b'],2,now,()=>1),/부족/);});
test('fairness disabled preserves legacy selection',()=>assert.equal(fairSelect({session:{}},['a'],1),null));

test('settings preserve missing legacy round policy through save and restart, then apply only to a new round',async t=>{
  const {service,operations}=await fixture(t);
  await operations.update(s=>{applyAction(s,'open',{game:'lol',mode:'aram',count:2});delete s.session.communityFairness;});
  const previous=communityState(operations.read()).settings.fairness;
  await service.settings({revision:1,...communityState(operations.read()).settings,fairness:{enabled:true,unplayedFirst:true,waitFirst:true,maxConsecutive:2,newcomerSlots:1}});
  assert.deepEqual(operations.read().session.communityFairness,previous);
  assert.equal(fairSelect(operations.read(),[user,other],2),null);
  assert.equal(communityView(operations).session.fairness,'무작위 추첨');
  const reopened=await new OperationsStore(operations.file).init();
  assert.deepEqual(reopened.read().session.communityFairness,previous);
  await reopened.update(s=>{applyAction(s,'end');applyAction(s,'open',{game:'lol',mode:'aram',count:2});});
  assert.equal(reopened.read().session.communityFairness.enabled,true);
  assert.equal(reopened.read().session.communityFairness.maxConsecutive,2);
});

test('legacy active fair policy is snapshotted before default is disabled; invalid and stale settings do not write',async t=>{
  const {service,operations}=await fixture(t);
  await service.settings({revision:1,...communityState(operations.read()).settings,fairness:{enabled:true,unplayedFirst:false,waitFirst:true,maxConsecutive:1,newcomerSlots:0}});
  await operations.update(s=>{applyAction(s,'open',{game:'lol',mode:'aram',count:1});delete s.session.communityFairness;});
  const before=operations.read(),bytes=await readFile(operations.file,'utf8'),settings=communityState(before).settings;
  await assert.rejects(service.settings({revision:1,...settings}),/다른 창/);
  await assert.rejects(service.settings({revision:2,...settings,fairness:{...settings.fairness,maxConsecutive:21}}),/숫자 범위/);
  assert.deepEqual(operations.read(),before);assert.equal(await readFile(operations.file,'utf8'),bytes);
  await service.settings({revision:2,...settings,fairness:{...settings.fairness,enabled:false}});
  assert.deepEqual(operations.read().session.communityFairness,settings.fairness);
  assert.deepEqual(fairSelect(operations.read(),[user,other],1,Date.now(),()=>1),[user]);
});

test('settings queued before an emergency lock recheck the guard before committing',async t=>{
  const {service,operations}=await fixture(t),before=operations.read(),bytes=await readFile(operations.file,'utf8');
  let locked=false,release,entered;
  service.guard=()=>{if(locked)throw Error('locked during queue wait');};
  const ready=new Promise(resolve=>{entered=resolve;});
  const blocker=operations.enqueue(async()=>{entered();await new Promise(resolve=>{release=resolve;});});
  await ready;
  const save=service.settings({revision:1,...communityState(before).settings});
  locked=true;release();await blocker;
  await assert.rejects(save,/locked during queue wait/);
  assert.deepEqual(operations.read(),before);assert.equal(await readFile(operations.file,'utf8'),bytes);
});

test('missing legacy round policy with malformed prior defaults fails closed instead of guessing selection rules',async t=>{
  const {service,operations}=await fixture(t);
  await operations.update(s=>{applyAction(s,'open',{game:'lol',mode:'aram',count:1});delete s.session.communityFairness;s.community.settings.fairness.maxConsecutive='invalid';});
  const before=operations.read(),bytes=await readFile(operations.file,'utf8'),settings=communityState(before).settings;
  await assert.rejects(service.settings({revision:1,...settings,fairness:{enabled:false,unplayedFirst:true,waitFirst:true,maxConsecutive:0,newcomerSlots:0}}),error=>error.statusCode===409&&/기존 공정성/.test(error.message));
  assert.deepEqual(operations.read(),before);assert.equal(await readFile(operations.file,'utf8'),bytes);
});
