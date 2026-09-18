import { stat } from 'node:fs/promises';
import path from 'node:path';

const MB=1024*1024;
const HOUR=60*60*1000;
const DEFAULT_SAMPLE_MS=15_000;
const MAX_SAMPLES=240;
const MAX_REQUESTS=600;
const SLOW_API_MS=500;

const finite=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const rounded=(value,digits=1)=>Number(finite(value).toFixed(digits));
const pct=(used,limit)=>limit>0?rounded((used/limit)*100,1):0;
const statusForPercent=value=>value>=100?'fail':value>=75?'warn':'pass';
const sanitizePath=value=>String(value||'/')
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id')
  .replace(/\/\d{15,22}(?=\/|$)/g,'/:id')
  .replace(/\/\d{6,}(?=\/|$)/g,'/:id')
  .slice(0,140);
const percentile=(values,p)=>{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b),index=Math.min(sorted.length-1,Math.max(0,Math.ceil((p/100)*sorted.length)-1));
  return sorted[index];
};
const maxStatus=(...values)=>values.includes('fail')?'fail':values.includes('warn')?'warn':'pass';

export async function measureDataFootprint(files=[]){
  const details=[];
  for(const file of files){
    if(!file)continue;
    try{const info=await stat(file);details.push({file:path.basename(String(file)),bytes:info.isFile()?info.size:0});}
    catch(error){if(error?.code==='ENOENT')details.push({file:path.basename(String(file)),bytes:0});else details.push({file:path.basename(String(file)),bytes:0,error:'unavailable'});}
  }
  return {totalBytes:details.reduce((sum,item)=>sum+item.bytes,0),files:details};
}

export class PerformanceCapacity {
  constructor({startedAt=Date.now(),sampleIntervalMs=DEFAULT_SAMPLE_MS,maxSamples=MAX_SAMPLES,maxRequests=MAX_REQUESTS,slowApiMs=SLOW_API_MS}={}){
    this.startedAt=startedAt;
    this.sampleIntervalMs=Math.max(1000,finite(sampleIntervalMs,DEFAULT_SAMPLE_MS));
    this.maxSamples=Math.max(12,finite(maxSamples,MAX_SAMPLES));
    this.maxRequests=Math.max(50,finite(maxRequests,MAX_REQUESTS));
    this.slowApiMs=Math.max(100,finite(slowApiMs,SLOW_API_MS));
    this.samples=[];this.requests=[];this.lastSampleAt=0;
  }
  recordApi({method='GET',path='/',status=200,durationMs=0,at=Date.now()}={}){
    const request={at:finite(at,Date.now()),method:String(method||'GET').slice(0,12),path:sanitizePath(path),status:finite(status,0),durationMs:Math.max(0,finite(durationMs))};
    this.requests.push(request);
    if(this.requests.length>this.maxRequests)this.requests.splice(0,this.requests.length-this.maxRequests);
  }
  sample(runtimeSnapshot={},extra={},now=Date.now()){
    now=finite(now,Date.now());
    if(this.lastSampleAt&&now-this.lastSampleAt<this.sampleIntervalMs)return false;
    const api=runtimeSnapshot.api||{},memory=runtimeSnapshot.memory||{},loop=runtimeSnapshot.eventLoop||{},sse=runtimeSnapshot.sse||{};
    this.samples.push({at:now,rss:finite(memory.rss),heapUsed:finite(memory.heapUsed),loopP95Ms:finite(loop.p95Ms),apiRequests:finite(api.requests),apiErrors:finite(api.errors),apiAvgMs:finite(api.avgMs),dashboardClients:finite(extra.dashboardClients,sse.liveClients),broadcastClients:finite(extra.broadcastClients),dataBytes:finite(extra.dataBytes),recordCount:finite(extra.recordCount),revision:finite(extra.revision,runtimeSnapshot.revision)});
    if(this.samples.length>this.maxSamples)this.samples.splice(0,this.samples.length-this.maxSamples);
    this.lastSampleAt=now;return true;
  }
  requestWindow(now=Date.now(),windowMs=15*60*1000){const cutoff=now-windowMs;return this.requests.filter(item=>item.at>=cutoff);}
  slowApis(now=Date.now()){
    const recent=this.requestWindow(now),buckets=new Map();
    for(const item of recent){if(item.durationMs<this.slowApiMs)continue;const key=`${item.method} ${item.path}`,bucket=buckets.get(key)||{method:item.method,path:item.path,count:0,totalMs:0,maxMs:0,values:[],lastAt:0};bucket.count++;bucket.totalMs+=item.durationMs;bucket.maxMs=Math.max(bucket.maxMs,item.durationMs);bucket.values.push(item.durationMs);bucket.lastAt=Math.max(bucket.lastAt,item.at);buckets.set(key,bucket);}
    return [...buckets.values()].map(bucket=>({method:bucket.method,path:bucket.path,count:bucket.count,avgMs:rounded(bucket.totalMs/bucket.count,1),p95Ms:rounded(percentile(bucket.values,95),1),maxMs:rounded(bucket.maxMs,1),lastAt:bucket.lastAt})).sort((a,b)=>b.p95Ms-a.p95Ms||b.count-a.count).slice(0,10);
  }
  trend(now=Date.now()){
    const cutoff=now-HOUR,points=this.samples.filter(point=>point.at>=cutoff);
    const recentRequests=this.requestWindow(now),apiP95=percentile(recentRequests.map(item=>item.durationMs),95),apiP99=percentile(recentRequests.map(item=>item.durationMs),99);
    let memory={status:'collecting',windowMs:0,deltaBytes:0,growthPerHourBytes:0,startBytes:0,endBytes:0};
    if(points.length>=2){
      const first=points[0],last=points.at(-1),windowMs=Math.max(1,last.at-first.at),deltaBytes=last.rss-first.rss,growthPerHourBytes=(deltaBytes/windowMs)*HOUR;
      const sufficient=windowMs>=5*60*1000;
      const status=!sufficient?'collecting':growthPerHourBytes>=256*MB?'fail':growthPerHourBytes>=64*MB?'warn':'pass';
      memory={status,windowMs,deltaBytes:Math.round(deltaBytes),growthPerHourBytes:Math.round(growthPerHourBytes),startBytes:first.rss,endBytes:last.rss};
    }
    let requestRatePerMin=0,errorRate=0;
    if(points.length>=2){const first=points[0],last=points.at(-1),minutes=Math.max((last.at-first.at)/60000,1/60),requests=Math.max(0,last.apiRequests-first.apiRequests),errors=Math.max(0,last.apiErrors-first.apiErrors);requestRatePerMin=rounded(requests/minutes,2);errorRate=requests?rounded(errors/requests*100,2):0;}
    return {points:points.map(point=>({...point})),memory,api:{windowMinutes:15,count:recentRequests.length,p95Ms:rounded(apiP95,1),p99Ms:rounded(apiP99,1),requestRatePerMin,errorRate}};
  }
  snapshot({runtimeSnapshot={},dashboardClients=0,dashboardLimit=12,broadcastClients=0,broadcastLimit=8,dataFootprint={totalBytes:0,files:[]},recordCount=0,revision=0,now=Date.now()}={}){
    this.sample(runtimeSnapshot,{dashboardClients,broadcastClients,dataBytes:dataFootprint.totalBytes,recordCount,revision},now);
    const trend=this.trend(now),slowApis=this.slowApis(now);
    const dashboardPercent=pct(dashboardClients,dashboardLimit),broadcastPercent=pct(broadcastClients,broadcastLimit),dataBytes=finite(dataFootprint.totalBytes);
    const dataStatus=dataBytes>=100*MB?'fail':dataBytes>=25*MB?'warn':'pass';
    const apiStatus=trend.api.p95Ms>=1500?'fail':trend.api.p95Ms>=750?'warn':'pass';
    const memoryStatus=trend.memory.status==='collecting'?'pass':trend.memory.status;
    const sseStatus=maxStatus(statusForPercent(dashboardPercent),statusForPercent(broadcastPercent));
    const status=maxStatus(apiStatus,memoryStatus,sseStatus,dataStatus);
    const recommendations=[];
    if(apiStatus!=='pass')recommendations.push({level:apiStatus,title:'느린 API 확인',detail:`최근 15분 API P95가 ${rounded(trend.api.p95Ms)}ms입니다. Slow API 목록에서 반복 지연 경로를 확인하세요.`});
    if(trend.memory.status==='warn'||trend.memory.status==='fail')recommendations.push({level:trend.memory.status,title:'메모리 증가 추적',detail:`관측 구간 기준 RSS 증가 속도가 시간당 ${rounded(trend.memory.growthPerHourBytes/MB,1)}MB입니다. 장시간 실행에서 계속 증가하는지 확인하세요.`});
    if(dashboardPercent>=75)recommendations.push({level:dashboardPercent>=100?'fail':'warn',title:'관리자 SSE 연결 정리',detail:`관리자 실시간 연결을 ${dashboardClients}/${dashboardLimit}개 사용 중입니다. 사용하지 않는 대시보드 탭을 닫으세요.`});
    if(broadcastPercent>=75)recommendations.push({level:broadcastPercent>=100?'fail':'warn',title:'방송 SSE 연결 정리',detail:`방송 화면 연결을 ${broadcastClients}/${broadcastLimit}개 사용 중입니다. OBS Browser Source 중복을 확인하세요.`});
    if(dataStatus!=='pass')recommendations.push({level:dataStatus,title:'JSON 데이터 크기 점검',detail:`운영 JSON 파일 합계가 ${rounded(dataBytes/MB,1)}MB입니다. 이 프로젝트는 파일 전체를 다시 쓰므로 오래된 기록 보관 정책을 점검하세요.`});
    if(!recommendations.length)recommendations.push({level:'pass',title:'현재 용량 여유 있음',detail:'최근 성능 추세와 SSE 연결 수, 데이터 파일 크기에서 즉시 조치가 필요한 항목이 없습니다.'});
    return {status,checkedAt:now,startedAt:this.startedAt,thresholds:{slowApiMs:this.slowApiMs,dashboardLimit,broadcastLimit,dataWarnBytes:25*MB,dataFailBytes:100*MB},trend,slowApis,capacity:{dashboardSse:{used:dashboardClients,limit:dashboardLimit,percent:dashboardPercent,status:statusForPercent(dashboardPercent)},broadcastSse:{used:broadcastClients,limit:broadcastLimit,percent:broadcastPercent,status:statusForPercent(broadcastPercent)},data:{...dataFootprint,recordCount,status:dataStatus}},signals:{api:apiStatus,memory:trend.memory.status,sse:sseStatus,data:dataStatus},recommendations};
  }
}
