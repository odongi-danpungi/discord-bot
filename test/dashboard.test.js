import { createMonitoringPanel } from '../public/production-monitoring-panel.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { recommendedAction } from '../public/control-center.js';

async function dashboard(t){
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:3001',runScripts:'outside-only',pretendToBeVisual:true}),{window:w}=dom;w.confirm=()=>true;w.crypto.randomUUID=randomUUID;w.recommendedAction=recommendedAction;w.playReplay=async()=>{};w.createLiveDirector=()=>({preview(){},play(){},current(){return null},updateContext(){}});w.simulateDraw=()=>({});w.TRACKS=[{id:'coast',name:'코랄 코스트',difficulty:'보통',defaultLaps:3,boostZones:[.2,.5,.8]}];
 t.after(()=>dom.window.close());
 const calls=[],state={session:null,history:[],reservations:[]},records=[{discordId:'u1',discordUsername:'Alpha',chzzkName:'<img src=x onerror=alert(1)>',erNickname:'ER',lolRiotId:'Alpha#KR1',updatedAt:new Date().toISOString()},{discordId:'u2',discordUsername:'Beta',chzzkName:'베타',lolRiotId:'Beta#KR1',updatedAt:new Date().toISOString()}];
 const data=()=>({state:structuredClone(state),records,csrf:'test-csrf',demo:true});
 w.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body,headers:options.headers});
  if(url==='/api/health')return {ok:true,json:async()=>({demo:true,message:'연습 모드',checks:[]})};
  if(url==='/api/operations/open')state.session={id:'session',round:1,game:body.game,mode:body.mode,count:body.count,title:body.title,description:body.description,phase:'open',applicants:[],postponed:[],winners:[],confirmed:[],excluded:[],teams:[]};
  if(url==='/api/operations/close')state.session.phase='closed';
  if(url==='/api/nicknames')return {ok:true,json:async()=>({results:[{discordId:'u1',ok:false,error:'역할 순서 확인'}]})};
  return {ok:true,json:async()=>data()};
 };
 w.createMonitoringPanel=options=>createMonitoringPanel({...options,document:w.document});
 const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 for(const match of appSource.matchAll(/^import \{([^}]+)\} from '([^']+)';/gm)){
   const names=match[1].split(',').map(n=>n.trim());if(names.every(n=>n in w))continue;
   let moduleSource=await readFile(new URL(match[2],new URL('../public/app.js',import.meta.url)),'utf8');
   if(moduleSource.includes("import { DASHBOARD_TABS }")){
     const shell=await readFile(new URL('../public/dashboard-shell.js',import.meta.url),'utf8');
     w.DASHBOARD_TABS=w.eval('(function(){'+shell.replace(/export /g,'')+';return DASHBOARD_TABS;})()');
   }
   moduleSource=moduleSource.replace(/^import .*;$/gm,'').replace(/export /g,'');
   const values=w.eval('(function(){'+moduleSource+';return {'+names.join(',')+'};})()');
   for(const name of names)w[name]=values[name];
 }
 w.eval(source);await new Promise(r=>setImmediate(r));t.after(()=>dom.window.close());
 return {w,calls,state,records,click:async(selector)=>{w.document.querySelector(selector).click();await new Promise(r=>setImmediate(r));}};
}
test('dashboard submits template settings with CSRF, switches tabs and escapes profile text',async t=>{
 const {w,calls,click}=await dashboard(t);
 await click('[data-preset="aram"]');assert.equal(w.document.getElementById('rosterMode').value,'aram');
 w.document.getElementById('closeMinutes').value='10';await click('[data-op="open"]');
 const open=calls.find(c=>c.url==='/api/operations/open');assert.equal(open.body.mode,'aram');assert.equal(open.body.closeMinutes,10);assert.equal(open.headers['X-CSRF-Token'],'test-csrf');assert.equal(open.body.ids,undefined);
 assert.equal(w.document.querySelector('[data-op="open"]').disabled,true);assert.equal(w.document.querySelector('[data-op="close"]').disabled,false);
 await click('[data-op="close"]');assert.equal(w.document.querySelector('[data-op="reopen"]').disabled,false);
 await click('[data-tab="members"]');assert.equal(w.document.querySelector('[data-page="members"]').hidden,false);assert.equal(w.document.querySelector('#rows img'),null);assert.ok(w.document.querySelector('#rows').textContent.includes('<img'));
});
test('search and nickname error feedback preserve explicit selection',async t=>{
 const {w,calls,click}=await dashboard(t);await click('[data-tab="members"]');await click('#rows input[value="u1"]');
 const search=w.document.getElementById('search');search.value='Beta';search.dispatchEvent(new w.Event('input'));assert.equal(w.document.querySelectorAll('#rows tr').length,1);
 await click('#rename');const rename=calls.find(c=>c.url==='/api/nicknames');assert.deepEqual(rename.body.discordIds,['u1']);assert.match(w.document.getElementById('renameResults').textContent,/역할 순서 확인/);
});


test('monitor panel expires successful evidence, displays failures safely and GET remains passive',async t=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const dom=new JSDOM(html);t.after(()=>dom.window.close());let now=1000;const calls=[];
 const panel=createMonitoringPanel({document:dom.window.document,clock:()=>now,notice:()=>{},request:async(url,body)=>{calls.push({url,body});return {ready:true,expiresAt:2000,lastProbedAt:1000,summary:'<img src=x onerror=alert(1)>',checks:[],history:[]};}});
 await panel.refresh();assert.equal(calls[0].body,undefined);assert.equal(dom.window.document.getElementById('productionMonitoringBadge').textContent,'운영 상태 정상');
 assert.equal(dom.window.document.getElementById('productionMonitoringSummary').querySelector('img'),null);
 now=2000;panel.render();assert.equal(dom.window.document.getElementById('productionMonitoringBadge').textContent,'운영 승인 차단');
});
