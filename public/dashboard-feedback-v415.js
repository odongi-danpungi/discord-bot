const TONES=new Set(['info','success','warning','error']);
const DEFAULT_TITLES=Object.freeze({info:'안내',success:'작업 완료',warning:'확인 필요',error:'작업 실패'});
const DEFAULT_TIMEOUTS=Object.freeze({info:5500,success:4500,warning:8000,error:10000});

export function sanitizeFeedbackMessage(value){
  let text=String(value??'').replace(/\s+/g,' ').trim();
  text=text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]');
  text=text.replace(/\b(authorization|token|password|secret|csrf|api[_-]?key|client[_-]?secret)\s*[:=]\s*([^\s,;]+)/gi,'$1=[REDACTED]');
  return text.slice(0,600);
}

export function createDashboardFeedback(input={},now=Date.now()){
  const tone=TONES.has(input.tone)?input.tone:'info';
  const message=sanitizeFeedbackMessage(input.message);
  if(!message)return null;
  const timeoutMs=Number.isFinite(Number(input.timeoutMs))?Math.max(1200,Math.min(30000,Number(input.timeoutMs))):DEFAULT_TIMEOUTS[tone];
  return Object.freeze({
    id:String(input.id||`feedback-${now}`),
    tone,
    title:sanitizeFeedbackMessage(input.title)||DEFAULT_TITLES[tone],
    message,
    createdAt:Number(now)||Date.now(),
    timeoutMs,
    sticky:input.sticky===true,
    count:Math.max(1,Number(input.count)||1),
    dedupeKey:String(input.dedupeKey||`${tone}:${message}`)
  });
}

export function upsertDashboardFeedback(queue,entry,{limit=4,dedupeWindowMs=5000}={}){
  if(!entry)return Array.isArray(queue)?[...queue]:[];
  const items=Array.isArray(queue)?[...queue]:[];
  const index=items.findIndex(item=>item?.dedupeKey===entry.dedupeKey&&entry.createdAt-Number(item.createdAt||0)<=dedupeWindowMs);
  if(index>=0){
    const previous=items.splice(index,1)[0];
    items.unshift(Object.freeze({...entry,id:previous.id,count:Number(previous.count||1)+1}));
  }else items.unshift(entry);
  return items.slice(0,Math.max(1,Number(limit)||4));
}

export function feedbackAriaRole(tone){return tone==='error'||tone==='warning'?'alert':'status';}
