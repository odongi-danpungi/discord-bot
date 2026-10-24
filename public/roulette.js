const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const colors=['#c5d9b7','#d7cce5','#f0d5ac','#bcdcd5','#e3c7c7','#d2d9b9','#c7d0e4','#e6cdb4'];
let state=null,pending=null,busy=false,animating=false,alive=true,epoch=0,rotation=0,animationTimer=null,animationResolve=null;
const controllers=new Set();
const source=()=>document.querySelector('input[name=source]:checked').value;
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const message=text=>{if(alive)$('status').textContent=text;};
const scoped=/^\/w\/(\d{17,20})\/roulette\.html$/.exec(location.pathname);
if(scoped){$('home').href=$('back').href='/portal/?server='+scoped[1]+'&page=roulette';}
function validEntries(entries){return Array.isArray(entries)&&entries.length<=100&&entries.every(e=>e&&typeof e.id==='string'&&e.id.length>0&&typeof e.label==='string'&&Array.from(e.label).length>0&&Array.from(e.label).length<=80)&&new Set(entries.map(e=>e.id)).size===entries.length;}
function validResult(result){return result&&typeof result.id==='string'&&['custom','queue'].includes(result.source)&&validEntries(result.entries)&&result.entries.length>=2&&Number.isInteger(result.winnerIndex)&&result.winnerIndex>=0&&result.winnerIndex<result.entries.length&&result.winner?.id===result.entries[result.winnerIndex].id&&result.winner?.label===result.entries[result.winnerIndex].label&&Number.isFinite(new Date(result.at).getTime());}
function customEntries(){
 const raw=$('items').value.split(/\r?\n/).filter(s=>s.trim());
 if(raw.some(s=>s.length>120||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(s)))throw Error('각 항목은 제어 문자 없이 1~30자로 입력해 주세요.');
 const labels=raw.map(s=>s.normalize('NFC').trim());
 if(labels.length<2||labels.length>99)throw Error(`서로 다른 항목을 2~99개 입력해 주세요. (현재 ${labels.length}개)`);
 if(labels.some(s=>Array.from(s).length>30))throw Error('각 항목은 제어 문자 없이 1~30자로 입력해 주세요.');
 if(new Set(labels.map(s=>s.toLowerCase())).size!==labels.length)throw Error('중복된 항목을 제거해 주세요. 같은 항목으로 확률을 늘릴 수 없습니다.');
 return labels.map((label,i)=>({id:'preview-'+i,label}));
}
function candidates(){if(source()==='custom')return customEntries();const list=state?.queueEntries||[];if(!list.length&&typeof state?.queueMessage==='string'&&state.queueMessage)throw Error(state.queueMessage);if(!Number.isSafeInteger(state?.queueRevision))throw Error('대기열 대기 참가자를 가져올 권한 또는 설정을 확인해 주세요.');if(list.length<2)throw Error('대기열 대기 참가자가 2명 이상이어야 합니다.');return list;}
function controls(){
 const frozen=busy||animating||!!pending;
 for(const input of document.querySelectorAll('input[name=source],#items'))input.disabled=frozen;
 let valid=false;try{candidates();valid=true;}catch{}
 $('spin').disabled=!alive||!state||frozen||!valid;
 $('refresh').disabled=!alive||busy||animating;
 $('retry').hidden=!pending;$('retry').disabled=busy||animating||!alive;
 $('uncertain-help').hidden=!pending;
 for(const button of document.querySelectorAll('#history button'))button.disabled=busy||animating||!!pending;
}
function wheel(entries,winnerIndex){
 const svg=$('wheel');svg.replaceChildren();
 svg.dataset.count=String(entries.length);if(winnerIndex===undefined)delete svg.dataset.winnerIndex;else svg.dataset.winnerIndex=String(winnerIndex);
 if(!entries.length){svg.setAttribute('aria-label','룰렛 항목을 입력해 주세요');return;}
 svg.setAttribute('aria-label','룰렛 '+entries.length+'개 항목. 전체 항목 목록을 확인할 수 있습니다.');
 const size=360/entries.length,rad=degrees=>degrees*Math.PI/180;
 entries.forEach((entry,i)=>{const start=i*size-90,end=(i+1)*size-90,p=document.createElementNS(NS,'path');
  p.setAttribute('d',`M 200 200 L ${200+194*Math.cos(rad(start))} ${200+194*Math.sin(rad(start))} A 194 194 0 ${size>180?1:0} 1 ${200+194*Math.cos(rad(end))} ${200+194*Math.sin(rad(end))} Z`);p.setAttribute('fill',colors[i%colors.length]);svg.append(p);
  if(entries.length<=16){const mid=(start+end)/2,text=document.createElementNS(NS,'text');text.setAttribute('x','200');text.setAttribute('y','200');text.setAttribute('transform',`translate(${130*Math.cos(rad(mid))} ${130*Math.sin(rad(mid))}) rotate(${mid+90} 200 200)`);text.setAttribute('text-anchor','middle');text.setAttribute('dominant-baseline','middle');const chars=Array.from(entry.label);text.textContent=chars.length>9?chars.slice(0,8).join('')+'…':entry.label;svg.append(text);}
 });
}
function preview(){
 $('custom-fields').hidden=source()!=='custom';$('queue-help').hidden=source()!=='queue';let entries=[];
 try{entries=candidates();$('validation').textContent=entries.length+'/99개 항목 · 각 항목 '+(100/entries.length).toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';}catch(error){$('validation').textContent=error.message;}
 $('entries-summary').textContent='추첨 항목 '+entries.length+'개';$('entries').replaceChildren(...entries.map(e=>node('li',e.label)));
 $('wheel').style.transition='none';rotation=0;$('wheel').style.transform='rotate(0deg)';wheel(entries);$('wheel-note').textContent=entries.length>16?'항목이 많아 이름은 전체 항목 목록에 표시합니다.':'위쪽 화살표가 가리키는 항목이 당첨됩니다.';controls();
}
function dateText(at){const date=new Date(at);return Number.isFinite(date.getTime())?date.toLocaleString('ko-KR'):'시각 확인 불가';}
function announce(result,replayed=false){$('winner').textContent=result.winner.label;$('result-detail').textContent=dateText(result.at)+' · '+(result.source==='queue'?'대기열 대기 참가자':'직접 입력')+' · '+result.entries.length+'개 항목';message(replayed?'이미 저장된 같은 요청의 결과를 확인했습니다. 새 추첨을 실행하지 않았습니다.':'추첨 결과를 저장했습니다. 대기열 상태는 변경하지 않았습니다.');}
function history(){
 const results=state?.history||[];$('history').replaceChildren();$('history-empty').hidden=results.length>0;
 for(const result of results){const item=node('li'),info=node('div');info.append(node('strong',result.winner.label),node('small',dateText(result.at)+' · '+(result.source==='queue'?'대기열':'직접 입력')+' · '+result.entries.length+'개 항목'));const show=node('button','결과 보기');show.type='button';show.className='secondary';show.onclick=()=>{if(busy||animating||pending||!alive)return;wheel(result.entries,result.winnerIndex);rotation=(360-(result.winnerIndex+.5)*360/result.entries.length)%360;$('wheel').style.transition='none';$('wheel').style.transform=`rotate(${rotation}deg)`;announce(result,true);};item.append(info,show);$('history').append(item);}
 controls();
}
async function request(path,options={}){
 const controller=new AbortController();controllers.add(controller);const current=epoch;
 try{const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...options,signal:controller.signal});const data=await response.json();if(!alive||current!==epoch)throw Error('화면이 변경되었습니다.');return {response,data};}finally{controllers.delete(controller);}
}
async function load(){
 if(busy||animating||!alive)return;const myEpoch=epoch,current=()=>alive&&myEpoch===epoch;busy=true;controls();message('저장된 상태를 확인하는 중…');
 try{const {response,data}=await request('api/roulette');if(!response.ok)throw Error(response.status===401?'로그인이 필요합니다. 운영 화면에서 로그인해 주세요.':data.error||'저장된 상태를 가져오지 못했습니다.');
  if(typeof data.csrf!=='string'||!Number.isSafeInteger(data.revision)||data.revision<0||!(data.queueRevision===null||Number.isSafeInteger(data.queueRevision)&&data.queueRevision>=0)||!validEntries(data.queueEntries)||!Array.isArray(data.history)||data.history.length>20||!data.history.every(validResult))throw Error('저장된 상태 형식을 확인하지 못했습니다.');
  state=data;history();const recovered=pending&&state.history.find(result=>result.requestId===pending.key);
  if(recovered){pending=null;wheel(recovered.entries,recovered.winnerIndex);rotation=(360-(recovered.winnerIndex+.5)*360/recovered.entries.length)%360;$('wheel').style.transition='none';$('wheel').style.transform=`rotate(${rotation}deg)`;announce(recovered,true);}
  else{if(!pending)preview();message(pending?'최근 기록을 불러왔습니다. 확실한 결과 확인은 같은 요청 확인 버튼을 사용하세요.':'항목을 확인한 뒤 룰렛을 돌리세요.');}
 }catch(error){if(current())message(error.message);}finally{if(current()){busy=false;controls();}}
}
async function animate(result){
 const myEpoch=epoch;
 wheel(result.entries,result.winnerIndex);animating=true;controls();$('winner').textContent='룰렛을 돌리는 중…';$('result-detail').textContent='결과는 이미 서버에 저장되었습니다.';message('저장된 결과를 재생하는 중…');
 const target=(360-(result.winnerIndex+.5)*360/result.entries.length)%360;
 rotation+=1440+((target-rotation%360+360)%360);
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 $('wheel').style.transition=reduced?'none':'transform 3.6s cubic-bezier(.12,.66,.13,1)';
 $('wheel').style.transform=`rotate(${rotation}deg)`;
 if(!reduced)await new Promise(resolve=>{animationResolve=resolve;animationTimer=setTimeout(()=>{animationTimer=null;animationResolve=null;resolve();},3700);});
 if(alive&&myEpoch===epoch)animating=false;
}
async function submit(retry=false){
 if(busy||animating||!alive||!state||retry&&!pending||!retry&&pending)return;
 if(!retry){let entries;try{entries=candidates();}catch(error){message(error.message);return;}const requestId=crypto.randomUUID(),body={requestId,expectedRevision:state.revision,source:source()};if(body.source==='queue')body.queueRevision=state.queueRevision;else body.items=entries.map(e=>e.label);pending={key:requestId,body:JSON.stringify(body)};}
 busy=true;controls();message(retry?'같은 요청의 저장 결과를 확인하는 중…':'추첨 결과를 저장하는 중…');const retained=pending,myEpoch=epoch,current=()=>alive&&myEpoch===epoch;
 try{const {response,data}=await request('api/roulette/spin',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf,'Idempotency-Key':retained.key},body:retained.body});
  if(!response.ok){if(response.status>=500)throw Error('서버 처리 결과를 확인하지 못했습니다. 같은 요청으로 확인해 주세요.');pending=null;state=null;throw Error(response.status===409?'항목 또는 상태가 바뀌었습니다. 상태 다시 확인 후 새로 추첨해 주세요.':response.status===401?'로그인이 필요합니다. 운영 화면에서 다시 로그인해 주세요.':data.error||'추첨을 실행하지 못했습니다. 상태를 다시 확인해 주세요.');}
  if(!validResult(data.result)||data.result.requestId!==retained.key||!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('결과 응답을 확인하지 못했습니다. 같은 요청 확인을 눌러 주세요.');
  pending=null;state.revision=data.revision;state.history=[data.result,...state.history.filter(r=>r.id!==data.result.id)].slice(0,20);history();
  if(data.replayed||retry){wheel(data.result.entries,data.result.winnerIndex);rotation=(360-(data.result.winnerIndex+.5)*360/data.result.entries.length)%360;$('wheel').style.transition='none';$('wheel').style.transform=`rotate(${rotation}deg)`;}
  else await animate(data.result);
  if(current())announce(data.result,data.replayed||retry);
 }catch(error){if(current())message(pending?'처리 결과를 확인하지 못했습니다. 새 추첨 대신 같은 요청 확인을 눌러 주세요.':error.message);}
 finally{if(current()){busy=false;controls();}}
}
for(const input of document.querySelectorAll('input[name=source]'))input.addEventListener('change',()=>{if(!busy&&!animating&&!pending)preview();});
$('items').addEventListener('input',()=>{if(!busy&&!animating&&!pending)preview();});
$('spin').onclick=()=>submit();$('retry').onclick=()=>submit(true);$('refresh').onclick=()=>load();
addEventListener('pagehide',()=>{alive=false;epoch++;for(const controller of controllers)controller.abort();if(animationTimer!==null)clearTimeout(animationTimer);animationResolve?.();animationTimer=null;animationResolve=null;});
addEventListener('pageshow',event=>{if(!event.persisted)return;alive=true;epoch++;busy=false;animating=false;state=null;$('wheel').style.transition='none';controls();void load();});
void load();
