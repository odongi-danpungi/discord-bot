import test from 'node:test';
import assert from 'node:assert/strict';
import { ChzzkService } from '../src/chzzk-service.js';

const CHANNEL='0123456789abcdef0123456789abcdef';
const other='fedcba9876543210fedcba9876543210';
const live=(channelId=CHANNEL,id='100')=>({liveId:id,liveTitle:'테스트 방송',liveThumbnailImageUrl:'https://example.com/thumb.jpg',concurrentUserCount:42,openDate:'2026-09-25 01:00:00',adult:false,tags:['게임'],categoryType:'GAME',liveCategory:'lol',liveCategoryValue:'리그 오브 레전드',channelId,channelName:'테스트 채널',channelImageUrl:'https://example.com/channel.jpg'});
const response=content=>new Response(JSON.stringify({code:200,message:null,content}),{status:200,headers:{'content-type':'application/json'}});

test('CHZZK client auth headers are sent and channel lookup uses the official channel endpoint',async()=>{
  let captured;
  const service=new ChzzkService({clientId:'client-id',clientSecret:'client-secret',fetchImpl:async(url,options)=>{captured={url:String(url),options};return response({data:[{channelId:CHANNEL,channelName:'테스트 채널'}]});}});
  const result=await service.getChannel(CHANNEL);
  assert.equal(result.channel.channelId,CHANNEL);
  assert.match(captured.url,/\/open\/v1\/channels\?/);
  assert.equal(new URL(captured.url).searchParams.get('channelIds'),CHANNEL);
  assert.equal(captured.options.headers['Client-Id'],'client-id');
  assert.equal(captured.options.headers['Client-Secret'],'client-secret');
  assert.equal(captured.options.headers['Content-Type'],'application/json');
});

test('live scanner follows page.next until it finds the configured channel',async()=>{
  const calls=[];
  const service=new ChzzkService({clientId:'id',clientSecret:'secret',fetchImpl:async url=>{
    const u=new URL(url);calls.push(u);
    if(calls.length===1)return response({data:[live(other,'1')],page:{next:'cursor-2'}});
    return response({data:[live(CHANNEL,'2')],page:{next:'cursor-3'}});
  }});
  const result=await service.scanLiveChannel(CHANNEL,{maxPages:5});
  assert.equal(result.live,true);assert.equal(result.complete,true);assert.equal(result.pagesScanned,2);assert.equal(result.item.channelId,CHANNEL);
  assert.equal(calls[0].searchParams.get('size'),'20');assert.equal(calls[0].searchParams.get('next'),null);assert.equal(calls[1].searchParams.get('next'),'cursor-2');
});

test('complete end of official live list is treated as offline',async()=>{
  const service=new ChzzkService({clientId:'id',clientSecret:'secret',fetchImpl:async()=>response({data:[live(other)],page:{next:null}})});
  const result=await service.scanLiveChannel(CHANNEL,{maxPages:5});
  assert.equal(result.live,false);assert.equal(result.complete,true);assert.equal(result.truncated,false);
});

test('scan cap produces unknown rather than a false offline result',async()=>{
  let n=0;
  const service=new ChzzkService({clientId:'id',clientSecret:'secret',fetchImpl:async()=>response({data:[live(other,String(++n))],page:{next:`cursor-${n}`}})});
  const result=await service.scanLiveChannel(CHANNEL,{maxPages:2});
  assert.equal(result.live,null);assert.equal(result.complete,false);assert.equal(result.truncated,true);assert.equal(result.pagesScanned,2);
});

test('429 responses stop immediately and preserve Retry-After for scheduling',async()=>{
  let calls=0;
  const service=new ChzzkService({clientId:'id',clientSecret:'secret',sleepImpl:async()=>{},fetchImpl:async()=>{calls++;if(calls<3)return new Response(JSON.stringify({code:429,message:'TOO_MANY_REQUESTS'}),{status:429,headers:{'retry-after':'120'}});return response({data:[],page:{next:null}});}});
  await assert.rejects(service.scanLiveChannel(CHANNEL,{maxPages:1}),e=>e.status===429&&e.retryAfterMs===120000);
  assert.equal(calls,1);
});
