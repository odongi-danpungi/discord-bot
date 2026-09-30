import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mobileActionConfirmation, mobileControlSyncState } from '../public/mobile-control-model.js';

test('mobile safety locks mutations when offline, disconnected or stale',()=>{
  const now=100_000;
  assert.equal(mobileControlSyncState({online:true,connected:true,lastEventAt:now-1_000,now}).safe,true);
  assert.equal(mobileControlSyncState({online:false,connected:true,lastEventAt:now-1_000,now}).safe,false);
  assert.equal(mobileControlSyncState({online:true,connected:false,lastEventAt:now-1_000,now}).safe,false);
  const stale=mobileControlSyncState({online:true,connected:true,lastEventAt:now-40_000,now,maxAgeMs:35_000});
  assert.equal(stale.safe,false);assert.equal(stale.stale,true);assert.equal(stale.label,'동기화 지연');
});

test('mobile high-impact actions require explicit confirmation text',()=>{
  for(const action of ['draw','replace','reshuffle','end'])assert.ok(mobileActionConfirmation(action).length>0,action);
  assert.match(mobileActionConfirmation('noShow','방울이'),/방울이/);
  assert.equal(mobileActionConfirmation('close'),'');
});

test('mobile client sends optimistic concurrency revisions and never auto-retries stale mutations',()=>{
  const js=fs.readFileSync(new URL('../public/mobile-control.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../public/mobile-control.html',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(js,/X-Live-Operations-Revision/);assert.match(js,/X-Live-Queue-Revision/);
  assert.match(js,/STALE_LIVE_STATE/);assert.match(js,/assertSafeToMutate/);
  assert.match(js,/addEventListener\('heartbeat'/);assert.match(js,/addEventListener\('offline'/);
  assert.match(html,/id="mobileSafety"/);assert.match(html,/id="mobileReload"/);
  assert.match(server,/readExpectedLiveRevisions/);assert.match(server,/assertLiveControlFresh/);assert.match(server,/controlRevisions/);
});
