import { createHash } from 'node:crypto';
import { canDashboard } from './dashboard-access.js';
import { ROULETTE_LIMITS, normalizeRouletteItems, readRoulette, replayRoulette, spinRoulette } from './roulette.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const mayReadQueue=identity=>identity?.role!=='operator'||canDashboard(identity,'queue');

function submitted(body,key){
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail('룰렛 요청 형식을 확인해 주세요.');
  const keys=body.source==='custom'?['requestId','expectedRevision','source','items']:['requestId','expectedRevision','source','queueRevision'];
  if(Object.keys(body).length!==keys.length||!keys.every(name=>Object.hasOwn(body,name))||!['custom','queue'].includes(body.source)||!revision(body.expectedRevision)||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)||key!==body.requestId)throw fail('룰렛 요청과 중복 실행 방지 정보를 확인해 주세요.');
  const input={requestId:body.requestId,expectedRevision:body.expectedRevision,source:body.source};
  if(body.source==='custom')input.items=normalizeRouletteItems(body.items).map(entry=>entry.label);
  else if(!revision(body.queueRevision))throw fail('Queue의 최신 상태 버전을 확인해 주세요.');
  const payload=body.source==='custom'?{expectedRevision:input.expectedRevision,source:input.source,items:input.items}:{expectedRevision:input.expectedRevision,source:input.source,queueRevision:body.queueRevision};
  return {...input,fingerprint:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}

function pool(participationQueue){
  if(!participationQueue)throw fail('Queue가 준비되지 않았습니다. 직접 입력을 사용해 주세요.',503);
  const snapshot=participationQueue.read();
  if(!revision(snapshot.revision)||!Array.isArray(snapshot.entries))throw fail('Queue 상태를 확인할 수 없습니다.',503);
  const waiting=snapshot.entries.filter(entry=>entry.status==='waiting').sort((a,b)=>a.position-b.position||a.sequence-b.sequence);
  return {revision:snapshot.revision,count:waiting.length,entries:waiting.length>ROULETTE_LIMITS.maxItems?[]:waiting.map(entry=>({id:entry.id,label:entry.displayName}))};
}

/** Routes inherit dashboard/workspace authentication, CSRF and capability checks.
 * This endpoint owns durable idempotency in the same atomic file as its result;
 * the generic response cache must not intercept its restart-safe receipts. */
export function installRouletteRoutes({app,operations,participationQueue,guard,csrf}){
  app.get('/api/roulette',(req,res,next)=>{
    try{
      const state=readRoulette(operations.read()),allowed=mayReadQueue(req.dashboardIdentity);
      let queue={revision:null,count:0,entries:[]},queueMessage='Queue가 준비되지 않았습니다. 직접 입력을 사용해 주세요.';
      if(!allowed)queueMessage='Queue 참가자를 보려면 Queue 운영 권한이 필요합니다.';
      else if(participationQueue){queue=pool(participationQueue);queueMessage=queue.count>ROULETTE_LIMITS.maxItems?`Queue 대기 참가자가 ${ROULETTE_LIMITS.maxItems}명을 초과했습니다. 임의로 일부를 추첨하지 않습니다.`:queue.count<2?'Queue 대기 참가자가 2명 이상이어야 합니다.':'대기 중인 참가자만 포함하며 Queue 순서와 상태는 변경하지 않습니다.';}
      res.set('Cache-Control','no-store').json({csrf:req.dashboardIdentity?.role==='workspace'?req.dashboardIdentity.csrf:csrf,revision:state.revision,queueRevision:queue.revision,queueEntries:queue.entries,queueCount:queue.count,queueMessage,history:allowed?state.history:state.history.filter(result=>result.source!=='queue')});
    }catch(error){next(error);}
  });
  app.post('/api/roulette/spin',async(req,res,next)=>{
    try{
      guard();
      const input=submitted(req.body,req.get('Idempotency-Key'));
      if(input.source==='queue'&&!mayReadQueue(req.dashboardIdentity))throw fail('Queue 참가자 추첨에는 Queue 운영 권한도 필요합니다.',403);
      const result=await operations.update(state=>{
        // Check again after waiting for any earlier atomic save.
        guard();
        const replay=replayRoulette(state,{requestId:input.requestId,fingerprint:input.fingerprint});
        if(replay)return replay;
        if(input.source==='queue'){
          const queue=pool(participationQueue);
          if(queue.revision!==req.body.queueRevision)throw fail('Queue가 변경됐습니다. 최신 참가자를 확인한 뒤 다시 실행하세요.',409);
          if(queue.count<2||queue.count>ROULETTE_LIMITS.maxItems)throw fail(`Queue 대기 참가자는 2~${ROULETTE_LIMITS.maxItems}명이어야 합니다.`);
          input.entries=queue.entries;
        }
        // Pool capture and winner selection are synchronous. No Queue write or
        // external request occurs; the committed snapshot defines this draw.
        return spinRoulette(state,input);
      });
      res.set('Cache-Control','no-store').json(result);
    }catch(error){next(error);}
  });
}
