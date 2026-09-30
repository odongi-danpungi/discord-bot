import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PerformanceCapacity, measureDataFootprint } from '../src/performance-capacity.js';

const runtime=(rss,requests=0,errors=0,loop=10)=>({memory:{rss,heapUsed:rss/2},eventLoop:{p95Ms:loop},api:{requests,errors,avgMs:20},sse:{liveClients:0},revision:1});

test('performance capacity detects slow APIs without retaining raw ids or request bodies',()=>{
 const p=new PerformanceCapacity({sampleIntervalMs:1,slowApiMs:500});
 const now=Date.now();
 p.recordApi({method:'GET',path:'/api/member/123456789012345678',status:200,durationMs:900,at:now});
 p.recordApi({method:'POST',path:'/api/recovery/550e8400-e29b-41d4-a716-446655440000',status:200,durationMs:650,at:now});
 p.recordApi({method:'GET',path:'/api/fast',status:200,durationMs:20,at:now});
 const slow=p.slowApis(now+1);
 assert.equal(slow.length,2);
 const text=JSON.stringify(slow);
 assert.doesNotMatch(text,/123456789012345678|550e8400-e29b-41d4-a716-446655440000/);
 assert.match(text,/:id/);
});

test('memory growth waits for a useful observation window and then warns on sustained growth',()=>{
 const p=new PerformanceCapacity({sampleIntervalMs:1,maxSamples:20});
 const base=100*1024*1024,now=1_000_000;
 p.sample(runtime(base,10),{},now);
 p.sample(runtime(base+5*1024*1024,20),{},now+60_000);
 assert.equal(p.trend(now+60_000).memory.status,'collecting');
 p.sample(runtime(base+20*1024*1024,100),{},now+10*60_000);
 const trend=p.trend(now+10*60_000);
 assert.equal(trend.memory.status,'warn');
 assert.ok(trend.memory.growthPerHourBytes>64*1024*1024);
});

test('capacity snapshot warns when SSE usage or JSON footprint approaches project limits',()=>{
 const p=new PerformanceCapacity({sampleIntervalMs:1});
 const now=Date.now();
 const snap=p.snapshot({runtimeSnapshot:runtime(120*1024*1024,50),dashboardClients:9,dashboardLimit:12,broadcastClients:2,broadcastLimit:8,dataFootprint:{totalBytes:30*1024*1024,files:[{file:'operations.json',bytes:30*1024*1024}]},recordCount:20,revision:4,now});
 assert.equal(snap.status,'warn');
 assert.equal(snap.capacity.dashboardSse.status,'warn');
 assert.equal(snap.capacity.data.status,'warn');
 assert.ok(snap.recommendations.some(item=>item.title.includes('SSE')));
 assert.ok(snap.recommendations.some(item=>item.title.includes('JSON')));
});

test('data footprint exposes basenames and byte totals only',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'capacity-'));
 try{
  const a=path.join(dir,'registrations.json'),b=path.join(dir,'operations.json');
  await writeFile(a,'12345');await writeFile(b,'1234567');
  const result=await measureDataFootprint([a,b]);
  assert.equal(result.totalBytes,12);
  assert.deepEqual(result.files.map(item=>item.file),['registrations.json','operations.json']);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
