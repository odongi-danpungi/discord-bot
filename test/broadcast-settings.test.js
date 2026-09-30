import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BROADCAST_SETTINGS,normalizeBroadcastSettings,validateBroadcastSettings} from '../src/broadcast-settings.js';

test('broadcast settings default safely and clamp display values',()=>{
 const settings=normalizeBroadcastSettings({theme:'unknown',winnerRevealSeconds:99,brandTitle:'  Custom Brand  ',scenes:{winners:false}});
 assert.equal(settings.theme,DEFAULT_BROADCAST_SETTINGS.theme);
 assert.equal(settings.winnerRevealSeconds,15);
 assert.equal(settings.brandTitle,'Custom Brand');
 assert.equal(settings.scenes.winners,false);
 assert.equal(settings.scenes.recruit,true);
});

test('broadcast settings strict validator rejects unknown fields and bad enums',()=>{
 assert.throws(()=>validateBroadcastSettings({theme:'javascript:'}),/theme/);
 assert.throws(()=>validateBroadcastSettings({unknown:true}),/지원하지 않는 방송 설정/);
 assert.throws(()=>validateBroadcastSettings({scenes:{game:false}}),/지원하지 않는 장면/);
});

test('broadcast settings accept supported scene customizer payload',()=>{
 const settings=validateBroadcastSettings({theme:'aurora',layout:'compact',transition:'slide',soundCue:'soft',winnerRevealSeconds:7,showTelemetry:false,scenes:{recruit:false,teams:true}});
 assert.equal(settings.theme,'aurora');
 assert.equal(settings.layout,'compact');
 assert.equal(settings.showTelemetry,false);
 assert.equal(settings.scenes.recruit,false);
 assert.equal(settings.scenes.teams,true);
});
