const HEADER_OPERATIONS='x-live-operations-revision';
const HEADER_QUEUE='x-live-queue-revision';

function parseRevision(value,label){
  if(value===undefined||value===null||value==='')return null;
  const text=String(value).trim();
  if(!/^\d+$/.test(text))throw Object.assign(new Error(`${label} 버전 값이 올바르지 않습니다. 페이지를 새로고침해 주세요.`),{status:400,code:'INVALID_LIVE_REVISION'});
  const number=Number(text);
  if(!Number.isSafeInteger(number)||number<0)throw Object.assign(new Error(`${label} 버전 값이 올바르지 않습니다. 페이지를 새로고침해 주세요.`),{status:400,code:'INVALID_LIVE_REVISION'});
  return number;
}

export function readExpectedLiveRevisions(headers={}){
  const get=name=>typeof headers.get==='function'?headers.get(name):headers[name]??headers[name.toLowerCase()]??headers[name.toUpperCase()];
  return {
    operations:parseRevision(get(HEADER_OPERATIONS),'운영 상태'),
    queue:parseRevision(get(HEADER_QUEUE),'시참 Queue')
  };
}

export function assertLiveControlFresh(expected={},actual={}){
  const operations=Number(actual.operations)||0,queue=Number(actual.queue)||0;
  const staleOperations=expected.operations!==null&&expected.operations!==undefined&&expected.operations!==operations;
  const staleQueue=expected.queue!==null&&expected.queue!==undefined&&expected.queue!==queue;
  if(!staleOperations&&!staleQueue)return {ok:true,operations,queue};
  const error=Object.assign(new Error('다른 기기에서 방송 운영 상태가 변경됐습니다. 최신 상태를 확인한 뒤 다시 실행해 주세요.'),{
    status:409,
    code:'STALE_LIVE_STATE',
    expected:{operations:expected.operations??null,queue:expected.queue??null},
    actual:{operations,queue},
    stale:{operations:staleOperations,queue:staleQueue}
  });
  throw error;
}

export function liveControlRevisionHeaders({operations=0,queue=0}={}){
  return {
    'X-Live-Operations-Revision':String(Math.max(0,Number(operations)||0)),
    'X-Live-Queue-Revision':String(Math.max(0,Number(queue)||0))
  };
}


export function createLiveControlMutationGate(){
  let tail=Promise.resolve(),waiting=0;
  return {
    async enter(){
      const previous=tail;let releaseNext;
      tail=new Promise(resolve=>{releaseNext=resolve;});waiting++;
      await previous;
      let released=false;
      return ()=>{if(released)return;released=true;waiting=Math.max(0,waiting-1);releaseNext();};
    },
    size(){return waiting;}
  };
}

export const LIVE_CONTROL_REVISION_HEADERS=Object.freeze({operations:'X-Live-Operations-Revision',queue:'X-Live-Queue-Revision'});
