import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteBroadcastPreset,exportBroadcastBundle,importBroadcastBundle,normalizeBroadcastAutomation,normalizeBroadcastPresets,resolveBroadcastPresentation,saveBroadcastPreset,setForcedBroadcastScene,validateBroadcastAutomation} from '../src/broadcast-presets.js';

const settings={theme:'aurora',layout:'compact',transition:'slide',soundCue:'soft',winnerRevealSeconds:7,brandTitle:'TEST',footerTitle:'LIVE',standbyTitle:'대기',standbyMessage:'대기 중',showHeader:true,showFooter:true,showTelemetry:true,showRecentApplicants:true,showCountdown:true,scenes:{recruit:true,drawReady:true,winners:true,attendance:true,teams:true,ended:true}};

test('broadcast presets save, update, delete and clear mapped ids',()=>{
 const first=saveBroadcastPreset([],{name:'협곡',settings},1000);
 assert.equal(first.presets.length,1);assert.match(first.preset.id,/^bp_/);
 const updated=saveBroadcastPreset(first.presets,{id:first.preset.id,name:'협곡 수정',settings:{...settings,theme:'warm'}},2000);
 assert.equal(updated.preset.name,'협곡 수정');assert.equal(updated.preset.settings.theme,'warm');
 const automation=normalizeBroadcastAutomation({enabled:true,mapping:{default:first.preset.id,lolRift:first.preset.id}},updated.presets);
 const deleted=deleteBroadcastPreset(updated.presets,automation,first.preset.id);
 assert.equal(deleted.presets.length,0);assert.equal(deleted.automation.mapping.default,'');assert.equal(deleted.automation.mapping.lolRift,'');
});

test('game context automation resolves effective preset without mutating base settings',()=>{
 const a=saveBroadcastPreset([],{name:'ER',settings:{...settings,theme:'warm'}},1),id=a.preset.id;
 const state={broadcastSettings:{...settings,theme:'midnight'},broadcastPresets:a.presets,broadcastAutomation:{enabled:true,mapping:{default:'',lolRift:'',lolAram:'',er:id}},session:{game:'er',mode:'rift'}};
 const resolved=resolveBroadcastPresentation(state,5000);
 assert.equal(resolved.activePresetId,id);assert.equal(resolved.settings.theme,'warm');assert.equal(state.broadcastSettings.theme,'midnight');
});

test('forced scene preserves preset mappings and expires safely',()=>{
 const saved=saveBroadcastPreset([],{name:'협곡',settings},1),id=saved.preset.id;
 const automation=validateBroadcastAutomation({enabled:true,mapping:{default:id,lolRift:id,lolAram:'',er:''},endedHoldSeconds:12},saved.presets);
 const forced=setForcedBroadcastScene(automation,{scene:'winners',seconds:30},1000,saved.presets);
 assert.equal(forced.mapping.lolRift,id);assert.equal(forced.forcedScene,'winners');assert.equal(forced.forcedSceneUntil,31000);
 const state={broadcastSettings:settings,broadcastPresets:saved.presets,broadcastAutomation:forced,session:{game:'lol',mode:'rift'}};
 assert.equal(resolveBroadcastPresentation(state,30000).forcedScene,'winners');
 assert.equal(resolveBroadcastPresentation(state,32000).forcedScene,'auto');
});

test('broadcast bundle import/export excludes unrelated secrets and rejects unsupported format',()=>{
 const saved=saveBroadcastPreset([],{name:'기본',settings},1);
 const state={broadcastSettings:settings,broadcastPresets:saved.presets,broadcastAutomation:{enabled:true,mapping:{default:saved.preset.id}},discordToken:'SECRET',dashboardPassword:'SECRET2'};
 const bundle=exportBroadcastBundle(state),json=JSON.stringify(bundle);
 assert.equal(json.includes('SECRET'),false);assert.equal(json.includes('SECRET2'),false);
 const imported=importBroadcastBundle(bundle);assert.equal(imported.presets.length,1);assert.equal(imported.automation.mapping.default,saved.preset.id);
 assert.throws(()=>importBroadcastBundle({format:'other',version:1}),/지원하는 방송 설정 파일/);
});

test('invalid preset and automation input is rejected',()=>{
 assert.throws(()=>saveBroadcastPreset([],{name:'',settings}),/프리셋 이름/);
 assert.throws(()=>validateBroadcastAutomation({enabled:'yes'},[]),/사용 여부/);
 assert.throws(()=>setForcedBroadcastScene({}, {scene:'unknown',seconds:0}),/장면/);
 assert.deepEqual(normalizeBroadcastPresets([{id:'bad id',name:'x',settings}]),[]);
});
