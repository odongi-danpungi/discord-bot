import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('broadcast page contains automatic OBS panels and no admin controls',async()=>{
 const html=await readFile(new URL('../public/broadcast.html',import.meta.url),'utf8');
 for(const panel of ['standby','recruit','draw-ready','game','winners','attendance','teams','ended'])assert.match(html,new RegExp(`data-panel="${panel}"`));
 assert.match(html,/directorCanvas/);
 assert.match(html,/LIVE BROADCAST DIRECTOR/);
 assert.doesNotMatch(html,/<button\b|data-op=/);
});

test('broadcast client uses sanitized API, SSE, stale reconnect and transparent mode',async()=>{
 const js=await readFile(new URL('../public/broadcast.js',import.meta.url),'utf8');
 assert.match(js,/api\/events/);
 assert.match(js,/api\/draw/);
 assert.match(js,/45000/);
 assert.match(js,/transparent/);
 assert.match(js,/createLiveDirector/);
});


test('dashboard contains broadcast scene customizer and same-origin live preview',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const server=await readFile(new URL('../src/broadcast.js',import.meta.url),'utf8');
 for(const id of ['broadcastTheme','broadcastTransition','broadcastSoundCue','broadcastPreviewFrame','saveBroadcastSettings'])assert.match(html,new RegExp(`id=\"${id}\"`));
 assert.match(server,/frame-ancestors 'self'/);
});


test('dashboard exposes preset automation, forced scene and import export controls',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 for(const id of ['broadcastPresetSelect','saveBroadcastPreset','broadcastAutomationEnabled','presetMapLolRift','presetMapLolAram','presetMapEr','broadcastForcedScene','applyForcedScene','importBroadcastFile'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/\/api\/broadcast-export/);
 assert.match(js,/\/api\/broadcast-preset/);assert.match(js,/\/api\/broadcast-automation/);assert.match(js,/\/api\/broadcast-scene/);assert.match(js,/\/api\/broadcast-import/);
});

test('broadcast client supports server scene overrides and ended auto return',async()=>{
 const js=await readFile(new URL('../public/broadcast.js',import.meta.url),'utf8');
 assert.match(js,/sceneOverride/);assert.match(js,/endedHoldSeconds/);assert.match(js,/renderForced/);
});
