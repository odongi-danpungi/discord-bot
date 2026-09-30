import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BackupRetention, SoakTestRunner, buildDeploymentReadiness, versionAtLeast } from '../src/production-readiness.js';

test('semantic node minimum comparison handles supported versions',()=>{
  assert.equal(versionAtLeast('v22.22.2','22.22.2'),true);
  assert.equal(versionAtLeast('22.21.9','22.22.2'),false);
  assert.equal(versionAtLeast('24.0.0','22.22.2'),true);
});

test('backup retention creates secret-free version 2 bundles and prunes count',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bot-backup-'));
  try{
    const manager=new BackupRetention({dir,keepCount:2,maxAgeDays:30,minimumIntervalHours:24});
    for(let i=0;i<3;i++)await manager.create({guildId:'demo',records:[{guildId:'demo',discordId:String(i)}],operations:{history:[],revision:i},type:'manual',now:Date.now()+i*1000});
    const summary=await manager.summary();assert.equal(summary.count,2);
    const files=summary.items.map(item=>item.file);assert.equal(files.length,2);assert.ok(files.every(file=>file.startsWith('daengdaeng-manual-')));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('ensureRecent avoids duplicate automatic backup inside interval',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bot-backup-'));
  try{const manager=new BackupRetention({dir,minimumIntervalHours:24});const payload={guildId:'demo',records:[],operations:{history:[]}};const now=Date.now();assert.equal((await manager.ensureRecent(payload,now)).created,true);assert.equal((await manager.ensureRecent(payload,now+1000)).created,false);}finally{await rm(dir,{recursive:true,force:true});}
});

test('soak test marks server or persistence errors as fail',async()=>{
  let serverErrors=0;const runner=new SoakTestRunner({intervalMs:1000,sampleProvider:async()=>({memory:{rss:10},eventLoop:{p95Ms:5},api:{errors:0,serverErrors},persistence:{failures:0}})});runner.start(1);await runner.collect();serverErrors=1;await runner.collect();const result=runner.stop();assert.equal(result.result.status,'fail');runner.close();
});

test('deployment readiness requires recent backup and completed soak',()=>{
  const base={config:{profile:'production'},preflight:{checks:[{id:'node',label:'Node',status:'pass',detail:'ok'}]},selfCheck:{counts:{pass:1,warn:0,fail:0}},runtime:{status:'pass'},capacity:{status:'pass'},backup:{latest:{file:'x.json'},latestAgeMs:1000},soak:{status:'pass',samples:10}};
  assert.equal(buildDeploymentReadiness(base).status,'pass');
  assert.equal(buildDeploymentReadiness({...base,backup:{latest:null,latestAgeMs:null}}).status,'fail');
});

test('ensureRecent prunes expired retention entries even when newest backup is still fresh',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dd-retention-expired-'));
 try{
  const manager=new BackupRetention({dir,keepCount:14,maxAgeDays:1,minimumIntervalHours:24});
  const now=Date.now();
  const old=await manager.create({guildId:'1',records:[],operations:{},type:'manual',now:now-3*24*60*60*1000});
  await manager.create({guildId:'1',records:[],operations:{},type:'manual',now:now-60*60*1000});
  const oldStamp=new Date(now-3*24*60*60*1000);await utimes(path.join(dir,old.file),oldStamp,oldStamp);
  const result=await manager.ensureRecent({guildId:'1',records:[],operations:{}},now);
  assert.equal(result.created,false);
  const items=await manager.list();
  assert.equal(items.length,1);
  assert.ok(now-items[0].createdAt<24*60*60*1000);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a manually stopped soak test still blocks readiness when it observed server failures',()=>{
 const result=buildDeploymentReadiness({
  config:{profile:'production'},preflight:{checks:[]},selfCheck:{counts:{warn:0,fail:0}},runtime:{status:'pass'},capacity:{status:'pass'},
  backup:{latest:{file:'ok.json'},latestAgeMs:1000},soak:{status:'stopped',result:{status:'fail'}}
 });
 assert.equal(result.checks.find(check=>check.id==='soak').status,'fail');
 assert.equal(result.status,'fail');
});


test('deployment readiness blocks unresolved critical incidents and warns on noncritical active incidents',()=>{
  const base={config:{profile:'production'},preflight:{checks:[]},selfCheck:{counts:{warn:0,fail:0}},runtime:{status:'pass'},capacity:{status:'pass'},backup:{latest:{file:'ok.json'},latestAgeMs:1000},soak:{status:'pass',samples:3}};
  const critical=buildDeploymentReadiness({...base,incidents:{counts:{critical:1,open:1,totalActive:1}}});
  assert.equal(critical.checks.find(check=>check.id==='incidents').status,'fail');assert.equal(critical.status,'fail');
  const warning=buildDeploymentReadiness({...base,incidents:{counts:{critical:0,open:1,totalActive:1}}});
  assert.equal(warning.checks.find(check=>check.id==='incidents').status,'warn');assert.equal(warning.status,'warn');
});
