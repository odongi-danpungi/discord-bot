import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decideDiscordPolicyAlert, DiscordPolicyStore, normalizeDiscordPolicyMonitor } from '../src/discord-policy.js';

const drift=(safe=0,manual=1,digest='drift-a')=>({status:'drift',digest,counts:{safe,manual,total:safe+manual},items:[]});
const pass=(digest='pass-a')=>({status:'pass',digest,counts:{safe:0,manual:0,total:0},items:[]});

test('legacy discordAlerts settings migrate to the all/off alert routes',()=>{
  assert.equal(normalizeDiscordPolicyMonitor({enabled:true,intervalMinutes:5,discordAlerts:true}).alertMode,'all');
  assert.equal(normalizeDiscordPolicyMonitor({enabled:true,intervalMinutes:5,discordAlerts:false}).alertMode,'off');
});

test('manual-only routing suppresses SAFE-only drift but sends MANUAL drift',()=>{
  const monitor={enabled:true,intervalMinutes:5,alertMode:'manual',recoveryAlerts:true};
  assert.equal(decideDiscordPolicyAlert({monitor,comparison:drift(2,0)}).reason,'safe-only');
  assert.equal(decideDiscordPolicyAlert({monitor,comparison:drift(0,1)}).send,true);
});

test('maintenance and acknowledgement suppress only the matching current drift',()=>{
  const monitor={enabled:true,intervalMinutes:5,alertMode:'all',recoveryAlerts:true},comparison=drift(0,1,'d1');
  assert.equal(decideDiscordPolicyAlert({monitor,comparison,maintenance:{active:true}}).reason,'maintenance');
  assert.equal(decideDiscordPolicyAlert({monitor,comparison,acknowledgement:{digest:'d1'}}).reason,'acknowledged');
  assert.equal(decideDiscordPolicyAlert({monitor,comparison,acknowledgement:{digest:'older'}}).send,true);
});

test('recovery alert is sent only when a drift alert was actually routed before it',()=>{
  const monitor={enabled:true,intervalMinutes:5,alertMode:'all',recoveryAlerts:true};
  assert.equal(decideDiscordPolicyAlert({monitor,monitorState:{lastAlertStatus:'drift',lastAlertDigest:'d1'},comparison:pass()}).send,true);
  assert.equal(decideDiscordPolicyAlert({monitor:{...monitor,recoveryAlerts:false},monitorState:{lastAlertStatus:'drift'},comparison:pass()}).send,false);
});

test('maintenance expires and acknowledgement clears when the drift digest changes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-policy-alerts-'));
  try{
    const store=await new DiscordPolicyStore(path.join(dir,'discord-policy.json')).init();
    const baseNow=Date.now();await store.startMaintenance({durationMinutes:15,reason:'planned channel work',actor:'tester',now:baseNow});
    assert.equal(store.summary().maintenance?.reason,'planned channel work');
    await store.expireMaintenance(baseNow+15*60*1000+1);
    assert.equal(store.summary().maintenance,null);
    await store.acknowledge({digest:'d1',note:'known change',actor:'tester',now:2000});
    assert.equal(store.summary().acknowledgement?.digest,'d1');
    await store.noteMonitorRun({comparison:drift(0,1,'d2'),suppressed:{reason:'route-off'},now:3000});
    assert.equal(store.summary().acknowledgement,null);
    assert.equal(store.summary().monitorState.suppressedCount,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('turning Discord alert routing off clears stale alert delivery errors',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dd-policy-alert-error-'));
  try{
    const store=await new DiscordPolicyStore(path.join(dir,'discord-policy.json')).init();
    await store.noteMonitorRun({comparison:drift(),alertError:new Error('temporary send error'),now:1000});
    assert.match(store.summary().monitorState.lastAlertError,/temporary/);
    await store.setMonitorSettings({enabled:true,intervalMinutes:5,alertMode:'off',recoveryAlerts:true});
    assert.equal(store.summary().monitorState.lastAlertError,'');
  }finally{await rm(dir,{recursive:true,force:true});}
});
