import test from 'node:test';
import assert from 'node:assert/strict';
import { NaverService } from '../src/naver-service.js';

const config={naverClientId:'client',naverClientSecret:'secret',naverRedirectUri:'https://example.com/naver/callback',naverCafeId:'1234',naverMenuId:'5',naverMemoMenuId:'7'};
function fakeAuth({connected=false}={}){
 let token=connected?{accessToken:'access',refreshToken:'refresh',expiresAt:Date.now()+3600000,connectedAt:Date.now()}:null;
 return {summary:()=>({connected:Boolean(token),expiresAt:token?.expiresAt||0,hasRefreshToken:Boolean(token?.refreshToken)}),token:()=>token,saveToken:async input=>{token={accessToken:input.accessToken,refreshToken:input.refreshToken||'',expiresAt:Date.now()+(input.expiresIn||3600)*1000,connectedAt:Date.now()};},clear:async()=>{token=null;}};
}

test('NaverService exposes only officially supported Cafe capabilities',()=>{
 const service=new NaverService({config,authStore:fakeAuth({connected:true}),fetchImpl:async()=>{throw Error('unused')}}),status=service.status();
 assert.equal(status.capabilities.publicCafeSearch,true);assert.equal(status.capabilities.publicCafeMonitor,true);assert.equal(status.capabilities.cafeJoin,true);assert.equal(status.capabilities.articleWrite,true);assert.equal(status.capabilities.memoArticleWrite,true);assert.equal(status.memoMenuId,'7');assert.equal(status.capabilities.comments,false);assert.equal(status.capabilities.notices,false);
});

test('OAuth state is one-time and authorization URL is scoped to configured callback',()=>{
 const service=new NaverService({config,authStore:fakeAuth(),fetchImpl:async()=>{throw Error('unused')}}),result=service.beginOAuth(),url=new URL(result.url),state=url.searchParams.get('state');
 assert.equal(url.origin,'https://nid.naver.com');assert.equal(url.searchParams.get('client_id'),'client');assert.equal(url.searchParams.get('redirect_uri'),config.naverRedirectUri);assert.ok(state?.length>20);
 service.consumeState(state);assert.throws(()=>service.consumeState(state),/만료되었거나 state/);
});

test('Cafe article search uses NAVER client headers and sanitizes result text',async()=>{
 let request;
 const service=new NaverService({config,authStore:fakeAuth(),fetchImpl:async(url,options)=>{request={url:String(url),options};return new Response(JSON.stringify({total:1,start:1,display:1,items:[{title:'<b>Hello</b>',description:'<b>World</b>',link:'https://cafe.naver.com/test/1',cafename:'Cafe',cafeurl:'https://cafe.naver.com/test'}]}),{status:200,headers:{'content-type':'application/json'}});}});
 const result=await service.searchCafeArticles({query:'hello',display:1});
 assert.equal(request.options.headers['X-Naver-Client-Id'],'client');assert.equal(request.options.headers['X-Naver-Client-Secret'],'secret');assert.match(request.url,/cafearticle\.json/);assert.equal(result.items[0].title,'Hello');assert.equal(result.items[0].description,'World');
});

test('OAuth callback exchanges code without exposing tokens in returned status',async()=>{
 const auth=fakeAuth(),service=new NaverService({config,authStore:auth,fetchImpl:async()=>new Response(JSON.stringify({access_token:'TOP_SECRET',refresh_token:'REFRESH_SECRET',token_type:'bearer',expires_in:'3600'}),{status:200})});
 const {url}=service.beginOAuth(),state=new URL(url).searchParams.get('state'),result=await service.exchangeCode({code:'abc',state});
 assert.equal(result.connected,true);assert.equal(JSON.stringify(result).includes('TOP_SECRET'),false);assert.equal(auth.token().accessToken,'TOP_SECRET');
});

test('Cafe search stops on 429 and avoids a second request during cooldown without leaking secrets',async()=>{
 let calls=0;const reports=[];
 const service=new NaverService({config,authStore:fakeAuth(),sleepImpl:async()=>{},reporter:event=>reports.push(event),fetchImpl:async()=>{
   calls++;
   if(calls<3)return new Response(JSON.stringify({error:'rate limited'}),{status:429,headers:{'retry-after':'0'}});
   return new Response(JSON.stringify({total:0,start:1,display:10,items:[]}),{status:200});
 }});
 await assert.rejects(service.searchCafeArticles({query:'방송'}),e=>e.status===429);
 await assert.rejects(service.searchCafeArticles({query:'방송'}),e=>e.status===429);
 assert.equal(calls,1);assert.equal(reports.at(-1).ok,false);
 assert.equal(JSON.stringify(reports).includes('secret'),false);
});

test('unsafe POST is not automatically retried on upstream 503',async()=>{
 let calls=0;
 const service=new NaverService({config,authStore:fakeAuth({connected:true}),sleepImpl:async()=>{},fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:'temporary'}),{status:503});}});
 await assert.rejects(service.rawRequest('https://openapi.naver.com/v1/cafe/1234/members',{method:'POST',body:'nickname=tester',operation:'cafe-join',retries:0}),error=>error.upstreamStatus===503&&error.status===502);
 assert.equal(calls,1);
});

test('concurrent expiring-token callers share one refresh request',async()=>{
 let token={accessToken:'old',refreshToken:'refresh',expiresAt:Date.now()+1000,connectedAt:Date.now()},refreshCalls=0;
 const auth={summary:()=>({connected:true,expiresAt:token.expiresAt,hasRefreshToken:true}),token:()=>token,saveToken:async input=>{token={...token,accessToken:input.accessToken,refreshToken:input.refreshToken||token.refreshToken,expiresAt:Date.now()+3600000};},clear:async()=>{token=null;}};
 const service=new NaverService({config,authStore:auth,sleepImpl:async()=>{},fetchImpl:async url=>{refreshCalls++;await new Promise(resolve=>setTimeout(resolve,10));assert.match(String(url),/grant_type=refresh_token/);return new Response(JSON.stringify({access_token:'new',token_type:'bearer',expires_in:'3600'}),{status:200});}});
 const [a,b]=await Promise.all([service.accessToken(),service.accessToken()]);
 assert.equal(a,'new');assert.equal(b,'new');assert.equal(refreshCalls,1);
});

test('authorized request refreshes once after explicit upstream 401 and retries with the new token',async()=>{
 let token={accessToken:'old',refreshToken:'refresh',expiresAt:Date.now()+3600000,connectedAt:Date.now()},profileCalls=0,refreshCalls=0;
 const auth={summary:()=>({connected:true,expiresAt:token.expiresAt,hasRefreshToken:true}),token:()=>token,saveToken:async input=>{token={...token,accessToken:input.accessToken,refreshToken:input.refreshToken||token.refreshToken,expiresAt:Date.now()+3600000};},clear:async()=>{}};
 const service=new NaverService({config,authStore:auth,sleepImpl:async()=>{},fetchImpl:async(url,options)=>{
   if(String(url).includes('oauth2.0/token')){refreshCalls++;return new Response(JSON.stringify({access_token:'new',token_type:'bearer',expires_in:'3600'}),{status:200});}
   profileCalls++;if(options.headers.Authorization==='Bearer old')return new Response(JSON.stringify({error:'invalid_token'}),{status:401});
   return new Response(JSON.stringify({response:{id:'1',nickname:'tester'}}),{status:200});
 }});
 const profile=await service.profile();assert.equal(profile.nickname,'tester');assert.equal(profileCalls,2);assert.equal(refreshCalls,1);
});
