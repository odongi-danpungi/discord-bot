import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBroadcastRunbookModel, inferRunbookPhase, normalizeRunbookForUi } from '../public/broadcast-runbook-model-v416.js';
import { dashboardCapabilityForRequest, operatorStaticAllowed, sanitizeOperatorBroadcastOps } from '../src/dashboard-access.js';

const runbook={title:'방송 운영 Runbook',steps:[
  {id:'a',phase:'pre',title:'사전 점검',status:'done',updatedAt:10,updatedBy:'admin'},
  {id:'b',phase:'live',title:'Queue 확인',status:'pending'},
  {id:'c',phase:'post',title:'종료 확인',status:'skipped'}
],handoffs:[{id:'h1',from:'admin',to:'helper',note:'3판 대기',at:20}]};

test('v4.16 runbook model computes progress and phase from live session state',()=>{
  const model=buildBroadcastRunbookModel({runbook,session:{id:'s1',phase:'open'},chzzkLive:{state:{lastKnownLive:false}},access:{role:'operator',capabilities:['broadcast']}});
  assert.equal(model.activePhase,'live');assert.equal(model.progress.done,1);assert.equal(model.progress.skipped,1);assert.equal(model.progress.pending,1);assert.equal(model.percent,67);assert.equal(model.canManage,true);
  assert.equal(inferRunbookPhase({runbook,session:null,chzzkLive:{state:{lastKnownLive:false}}}),'post');
});

test('runbook UI normalization drops unknown fields and clamps strings',()=>{
  const normalized=normalizeRunbookForUi({...runbook,secret:'do-not-copy',handoffs:[{...runbook.handoffs[0],oauthToken:'secret'}]});
  assert.equal(Object.hasOwn(normalized,'secret'),false);assert.equal(Object.hasOwn(normalized.handoffs[0],'oauthToken'),false);
});

test('operator runbook access is scoped to broadcast capability and mobile static module is allowed',()=>{
  assert.equal(dashboardCapabilityForRequest('GET','/api/broadcast-runbook'),'broadcast');
  assert.equal(dashboardCapabilityForRequest('POST','/api/broadcast-runbook/step'),'broadcast');
  assert.equal(operatorStaticAllowed('/broadcast-runbook-model-v416.js'),true);
  assert.equal(operatorStaticAllowed('/app.js'),false);
});

test('operator broadcast sanitizer exposes safe runbook fields only',()=>{
  const safe=sanitizeOperatorBroadcastOps({runbook:{...runbook,csrf:'x',password:'y',token:'z',handoffs:[{...runbook.handoffs[0],discordUserId:'123',callToken:'secret'}]}}).runbook;
  const text=JSON.stringify(safe);
  assert.doesNotMatch(text,/csrf|password|callToken|discordUserId|oauthToken/i);
  assert.match(text,/3판 대기/);
});

test('desktop and mobile surfaces expose runbook workflow without inline handlers',async()=>{
  const [html,app,mobileHtml,mobileJs,server]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/app.js',import.meta.url),'utf8'),readFile(new URL('../public/mobile-control.html',import.meta.url),'utf8'),readFile(new URL('../public/mobile-control.js',import.meta.url),'utf8'),readFile(new URL('../src/app.js',import.meta.url),'utf8')
  ]);
  assert.match(html,/data-tab="runbook"/);assert.match(html,/data-page="runbook"/);assert.match(html,/id="runbookHandoffNote"/);
  assert.match(app,/\/api\/broadcast-runbook\/step/);assert.match(app,/\/api\/broadcast-runbook\/handoff/);assert.match(app,/markDirtyGroupClean\('runbook-handoff'\)/);
  assert.match(mobileHtml,/id="mobileTabRunbook"/);assert.match(mobileHtml,/id="mobileRunbookSteps"/);
  assert.match(mobileJs,/\/api\/broadcast-runbook\/step/);assert.match(mobileJs,/liveGuard:false,syncGuard:false/);
  assert.match(server,/path\.startsWith\('\/api\/broadcast-runbook\/'\)/);assert.match(server,/app\.post\('\/api\/broadcast-runbook\/handoff'/);
  assert.doesNotMatch(html,/on(click|change|submit)=/i);assert.doesNotMatch(mobileHtml,/on(click|change|submit)=/i);
});

test('runbook handoff note redacts common credential assignments before persistence',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const {BroadcastOpsStore}=await import('../src/broadcast-ops-store.js');
  const dir=await mkdtemp(path.default.join(os.default.tmpdir(),'dd-runbook-secret-'));
  try{const store=new BroadcastOpsStore(path.default.join(dir,'ops.json'));await store.init();const result=await store.saveRunbookHandoff({to:'helper',note:'DISCORD_TOKEN=abc123 Authorization: Bearer qwerty api-key=sekret customPassword=hunter2'},'admin',100);const note=result.handoff.note;assert.match(note,/DISCORD_TOKEN=\[REDACTED\]/i);assert.match(note,/Bearer \[REDACTED\]/i);assert.doesNotMatch(note,/abc123|qwerty|sekret|hunter2/);assert.match(note,/api-key=\[REDACTED\]/i);assert.match(note,/customPassword=\[REDACTED\]/i);}finally{await rm(dir,{recursive:true,force:true});}
});
