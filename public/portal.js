import {newPractice,practiceAction} from './practice-model.js';
const $=id=>document.getElementById(id);
let session,workspace=null,selected='',generation=0,selectionGeneration=0,busy=false;
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const notice=text=>{$('notice').textContent=text||'';};
function closeMenu(){$('sidebar').classList.remove('nav-open');$('menu-toggle').setAttribute('aria-expanded','false');}
$('menu-toggle').onclick=()=>{const open=$('sidebar').classList.toggle('nav-open');$('menu-toggle').setAttribute('aria-expanded',String(open));};
const base=()=>'/w/'+selected;
const entryQuery=new URLSearchParams(location.search),entryServer=entryQuery.get('server'),entrySession=entryQuery.get('session');
const validEntry=/^\d{17,20}$/.test(entryServer||'')&&/^[a-zA-Z0-9_-]{1,100}$/.test(entrySession||'');
const viewerUrl=()=>base()+'/viewer/'+(validEntry&&selected===entryServer?'?session='+encodeURIComponent(entrySession):'');
const entryParams=new URLSearchParams();if(/^\d{17,20}$/.test(entryServer||'')){entryParams.set('server',entryServer);if(validEntry)entryParams.set('session',entrySession);}
const loginLink=document.querySelector('a[href="/portal/auth/login"]');if(loginLink&&entryParams.size)loginLink.href='/portal/auth/login?'+entryParams;
const uncertainRequests=new Map();
async function api(url,body){
  for(const [key,value]of uncertainRequests)if(value.expires<=Date.now())uncertainRequests.delete(key);
  const mutation=body!==undefined,signature=mutation?url+'\n'+JSON.stringify({...body,requestId:undefined}):'';
  const retained=uncertainRequests.get(signature),request=retained||{key:crypto.randomUUID(),body:mutation?JSON.stringify(body):undefined,expires:Date.now()+120000};
  let response,data;
  try{
    response=await fetch(url,{cache:'no-store',method:mutation?'POST':'GET',headers:mutation?{'Content-Type':'application/json','X-CSRF-Token':session.csrf,'Idempotency-Key':request.key}:{},body:request.body});
    data=await response.json();
  }catch{
    if(mutation){if(uncertainRequests.size>=100)uncertainRequests.delete(uncertainRequests.keys().next().value);uncertainRequests.set(signature,request);}
    throw Error(mutation?'처리 결과를 확인하지 못했습니다. 같은 작업을 다시 누르면 중복 실행을 방지하며 확인합니다.':'응답을 확인하지 못했습니다. 다시 시도해 주세요.');
  }
  uncertainRequests.delete(signature);
  if(!response.ok)throw Object.assign(Error(data.error||'작업을 완료하지 못했습니다.'),{status:response.status});return data;
}
async function run(action){if(busy)return;busy=true;notice('처리 중…');const picker=$('servers');picker.disabled=true;try{await action();notice('처리했습니다.');}catch(e){notice(e.message);}finally{busy=false;picker.disabled=false;}}
function button(label,action,cls){const b=el('button',label,cls);b.type='button';b.onclick=()=>run(action);return b;}
function link(label,url){const a=el('a',label,'button secondary');a.href=url;return a;}
function field(host,key,label,value='',type='text',options){const wrap=el('label',label),input=el(options?'select':type==='textarea'?'textarea':'input');input.name=key;if(!options&&type!=='textarea')input.type=type;if(options)for(const [v,l]of options){const o=new Option(l,v);input.append(o);}input.value=value;wrap.append(input);host.append(wrap);return input;}
function form(fields,submit,label='저장',confirmation=''){
  const f=el('form',undefined,'form');const inputs={};
  for(const [key,title,value,type,options]of fields)inputs[key]=field(f,key,title,value,type,options);
  const b=el('button',label);b.type='submit';f.append(b);
  f.onsubmit=e=>{e.preventDefault();if(confirmation&&!confirm(confirmation))return;run(async()=>{b.disabled=true;try{await submit(Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,i.type==='number'?Number(i.value):i.value])));}finally{b.disabled=false;}});};return f;
}
function table(rows,columns){const t=el('table'),head=el('tr');for(const [,label]of columns)head.append(el('th',label));t.append(head);for(const row of rows||[]){const tr=el('tr');for(const [key]of columns)tr.append(el('td',String(row[key]??'—')));t.append(tr);}return t;}
const menu=[
  ['통합 운영',[['방송',['home','queue','open','round','ready','undo']],['운영 준비',['onboarding','handoff']],['참가 설정',['intake-capacity','intake-duplicates','intake-close','recruitment-rules','call-settings']],['방송 도구',['presets','schedule','poll','studio','roulette','donation-roulette','obs','practice']],['방송 기록',['archive','timeline','stats','notifications']],['커뮤니티',['subscriptions','recruitment','my-panel','recap','publication','guide','tickets']]]],
  ['네이버 카페',[['계정·게시판',['naver','cafe']],['카페 운영',['search','write','memo','monitor']]]],
  ['Discord',[['서버 운영',['discord','members']]]],
  ['CHZZK',[['방송 계정',['chzzk','live']],['팔로워 인증',['panel']]]]
];
const titles={home:'운영 홈',queue:'통합 Queue',open:'참가 모집 시작',round:'경기 진행',ready:'경기 준비 확인',undo:'직전 순서 되돌리기',schedule:'방송 일정',poll:'방송 투표',community:'커뮤니티 운영',studio:'추첨·레이스',obs:'OBS 화면',archive:'방송 기록',practice:'운영 연습',naver:'네이버 계정 연결',cafe:'카페·게시판 설정',search:'카페 글 검색',write:'게시글 작성',memo:'칼바람 시참 접수',monitor:'새 글 알림',discord:'서버 채널 준비',members:'참가자 정보',chzzk:'방송 계정 연결',panel:'인증 안내 게시'};
Object.assign(titles,{subscriptions:'알림 구독',fairness:'공정 선발',recruitment:'모집·공지 초안', 'my-panel':'내 시참 패널',recap:'방송 후기',publication:'게시 미리보기',guide:'규칙·FAQ',tickets:'참가자 문의',live:'방송 시작·종료 알림'});
Object.assign(titles,{presets:'모집 프리셋',timeline:'방송 타임라인',stats:'방송 통계',notifications:'알림 설정'});
Object.assign(titles,{onboarding:'운영 시작 안내',handoff:'운영 인수인계'});
Object.assign(titles,{'recruitment-rules':'참가 선발 규칙','call-settings':'호출 응답 시간'});
Object.assign(titles,{'intake-capacity':'접수 인원 제한','intake-duplicates':'중복 접수 처리','intake-close':'정원 도달 마감'});
Object.assign(titles,{roulette:'룰렛','donation-roulette':'치즈 후원 룰렛'});
const knownPage=id=>id==='fairness'||typeof id==='string'&&menu.some(([,middle])=>middle.some(([,leaves])=>leaves.includes(id)));
const safeText=(value,limit=600)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,limit):'';
const readinessStatuses={configured:'설정 완료',attention:'확인 필요',pending:'검증 대기',optional:'선택 사항'};
function navigation(){
  $('menu').replaceChildren();if(workspace?.role==='participant'){const a=link('내 참가 상태',viewerUrl());$('menu').append(a);return;}
  for(const [group,middle]of menu){const d=el('details');d.append(el('summary',group));for(const [title,leaves]of middle){const m=el('details');m.append(el('summary',title));for(const id of leaves){const b=el('button',titles[id]);b.dataset.page=id;b.onclick=()=>{if(!busy)void page(id).catch(e=>{if(!e.stale)notice(e.message);});};m.append(b);}m.ontoggle=()=>{if(m.open)for(const sibling of d.children)if(sibling!==m&&sibling.tagName==='DETAILS')sibling.open=false;};d.append(m);}d.ontoggle=()=>{if(d.open)for(const sibling of $('menu').children)if(sibling!==d)sibling.open=false;};$('menu').append(d);}
}
async function page(id){
  if(!workspace||workspace.role!=='operator')return;
  if(id==='fairness')id='recruitment-rules';
  closeMenu();
  const myGeneration=++generation,scope=base(),guildId=selected;let snapshot=null;
  const current=()=>myGeneration===generation&&selected===guildId;
  const assertCurrent=()=>{if(!current())throw Object.assign(Error('서버 또는 화면이 변경되었습니다. 다시 선택해 주세요.'),{stale:true});};
  notice('');$('title').textContent=titles[id]||'내 참가 상태';$('intro').textContent=workspace.name+' · 운영자';
  const group=menu.find(([,mid])=>mid.some(([,leaves])=>leaves.includes(id))),mid=group?.[1].find(([,leaves])=>leaves.includes(id));$('breadcrumb').textContent=[group?.[0],mid?.[0],titles[id]].filter(Boolean).join(' / ');
  for(const b of document.querySelectorAll('[data-page]')){b.classList.toggle('active',b.dataset.page===id);if(b.dataset.page===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');if(b.dataset.page===id){b.parentElement.open=true;b.parentElement.parentElement.open=true;}}
  const p=el('div');$('panel').replaceChildren(el('p','불러오는 중…','muted'));
  const request=async(endpoint,body)=>{assertCurrent();try{const result=await api(scope+endpoint,body);assertCurrent();return result;}catch(error){assertCurrent();throw error;}};
  const snap=async()=>snapshot=await request('/api/snapshot');
  const op=async(action,body={})=>{const state=snapshot||await snap();snapshot=await request('/api/operations/'+action,{requestId:crypto.randomUUID(),sessionId:state.state?.session?.id||null,...body});};
  const actions=(...buttons)=>{const a=el('div',undefined,'actions');a.append(...buttons);p.append(a);};
  if(id==='home'){
    const data=await snap(),stats=el('div',undefined,'stats');for(const [label,value]of [['대기 참가자',data.participationQueue?.activeCount||0],['현재 회차',data.state?.session?.round||'—'],['방송 운영',data.paused?'일시 중지':'사용 가능']]){const c=el('div',label,'stat');c.append(el('strong',String(value)));stats.append(c);}p.append(stats,el('p','왼쪽 메뉴에서 사용할 기능 하나를 선택하세요.'));actions(button('Queue 보기',()=>page('queue')),button('경기 진행',()=>page('round'),'secondary'),button('운영 시작 안내',()=>page('onboarding'),'secondary'));
  }else if(id==='onboarding'||id==='handoff'){
    const data=await request('/readiness'),checked=new Date(data.checkedAt),hasTime=typeof data.checkedAt==='number'&&Number.isFinite(checked.getTime());
    const evidence=el('div',undefined,'readiness-evidence');evidence.append(el('span','저장된 설정 기준','badge readiness-configured'),el('span','실제 연결 검증 대기','badge readiness-pending'));p.append(evidence,el('p',hasTime?'확인 시각 · '+checked.toLocaleString('ko-KR'):'확인 시각을 가져오지 못했습니다.','muted readiness-time'));
    if(data.paused===true)p.append(el('p','현재 방송 운영이 일시 중지되어 있습니다. 운영 재개 상태를 확인해 주세요.','readiness-paused'));
    if(id==='onboarding'){
      p.append(el('p','아래 순서대로 운영 설정을 확인하세요. 설정 완료 표시만으로 실제 로그인·메시지 전송·팔로워 인증이 검증된 것은 아닙니다.','muted'));
      const list=el('ol',undefined,'readiness-list');
      for(const check of Array.isArray(data.checks)?data.checks.slice(0,30):[]){
        if(!check||typeof check!=='object'||!Object.hasOwn(readinessStatuses,check.status))continue;
        const item=el('li'),content=el('div',undefined,'readiness-check'),heading=el('div',undefined,'readiness-heading');heading.append(el('h2',safeText(check.title,120)||'운영 설정'),el('span',readinessStatuses[check.status],'badge readiness-'+check.status));content.append(heading,el('p',safeText(check.detail),'muted'));
        if(knownPage(check.action?.page)){const target=check.action.page;content.append(button(safeText(check.action.label,60)||titles[target],async()=>{assertCurrent();await page(target);},'secondary'));}
        item.append(content);list.append(item);
      }
      if(!list.children.length)p.append(el('p','운영 준비 항목을 가져오지 못했습니다. 새로고침해 주세요.','muted'));else p.append(list);
      actions(button('설정 상태 새로고침',()=>page('onboarding'),'secondary'),button('운영 인수인계 보기',()=>page('handoff'),'secondary'));
    }else{
      p.append(el('p','다음 운영자에게 전달할 현재 설정 요약입니다. 실제 연결 검증이 끝난 항목과 남은 작업을 함께 확인하세요.','muted'));
      const text=safeText(data.handoff?.text,24000),wrap=el('label','인수인계 요약'),summary=el('textarea',undefined,'handoff-text');summary.readOnly=true;summary.value=text;summary.setAttribute('aria-label','인수인계 요약');wrap.append(summary);p.append(wrap);
      const copy=button('요약 복사',async()=>{assertCurrent();if(!navigator.clipboard?.writeText)throw Error('자동 복사를 사용할 수 없습니다. 요약을 선택해 직접 복사해 주세요.');try{await navigator.clipboard.writeText(text);}catch{throw Error('요약을 복사하지 못했습니다. 요약을 선택해 직접 복사해 주세요.');}assertCurrent();});
      const download=button('요약 TXT 저장',async()=>{assertCurrent();const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=el('a');a.href=url;a.download='daengdaeng-handoff.txt';document.body.append(a);try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}},'secondary');copy.disabled=download.disabled=!text;actions(copy,download,button('요약 새로고침',()=>page('handoff'),'secondary'));
    }
  }else if(['intake-capacity','intake-duplicates','intake-close'].includes(id)){
    const data=await request('/intake-settings'),settings=data?.settings;
    const valid=Number.isSafeInteger(data?.revision)&&data.revision>=0&&settings&&typeof settings==='object'&&!Array.isArray(settings)&&Number.isInteger(settings.maxApplicants)&&settings.maxApplicants>=0&&settings.maxApplicants<=1000&&['keep_existing','reject'].includes(settings.duplicatePolicy)&&typeof settings.closeOnCapacity==='boolean'&&(!settings.closeOnCapacity||settings.maxApplicants>0);
    if(!valid){const message='저장된 접수 조건을 확인하지 못했습니다. 다시 불러온 뒤 저장해 주세요.';$('panel').replaceChildren(el('p',message),button('설정 다시 불러오기',()=>page(id),'secondary'));throw Error(message);}
    p.append(el('p','저장하면 각 서비스의 다음 모집부터 공통 조건이 적용됩니다. 현재 Queue와 진행 중인 회차는 바뀌지 않습니다.','settings-guidance'));
    const f=el('form',undefined,'form settings-form intake-form'),card=el('div',undefined,'intake-setting-card'),message=el('p','', 'settings-feedback');message.setAttribute('role','status');let dirty=false,input;
    card.append(el('h2',titles[id]));
    if(id==='intake-capacity'){
      card.append(el('p','Discord 모집과 네이버 카페 모집에 각각 적용하는 정원입니다. 두 서비스의 접수 인원을 합산한 제한은 아닙니다.','muted'));
      input=field(card,'maxApplicants','최대 접수 인원',settings.maxApplicants,'number');input.min='0';input.max='1000';input.step='1';input.required=true;input.parentElement.append(el('span','0은 무제한 · 1~1000명 사이의 정수로 입력하세요.','field-help'));
      card.append(el('p','Discord 모집은 추첨 선정 인원 이상으로 설정하세요. 0은 제한 없음입니다.','field-help'));
      card.append(el('p','운영자가 통합 Queue에 직접 추가하는 참가자는 이 정원의 대상이 아닙니다.','field-help'));
      if(settings.closeOnCapacity)card.append(el('p','정원 도달 마감이 켜져 있습니다. 무제한으로 바꾸려면 정원 도달 마감을 먼저 해제하세요.','field-help'));
    }else if(id==='intake-duplicates'){
      card.append(el('p','이미 접수한 참가자가 다시 신청했을 때의 처리 방식입니다. 두 방식 모두 참가자를 중복으로 추가하지 않습니다.','muted'));
      input=field(card,'duplicatePolicy','다시 신청한 참가자 처리',settings.duplicatePolicy,'select',[['keep_existing','기존 접수·순서 유지'],['reject','이미 접수했음을 안내']]);
      card.append(el('p','각 서비스 안에서 참가자 식별 정보로 확인합니다. 닉네임이 같다는 이유만으로 Discord와 네이버 계정을 합치지 않습니다.','field-help'));
      if(data.revision===0)card.append(el('p','아직 조건을 저장하지 않았다면 기존 서비스별 중복 처리 방식을 유지합니다.','field-help'));
    }else{
      card.append(el('p','설정한 접수 정원이 찼을 때 해당 서비스의 모집을 마감합니다. Discord와 네이버 카페의 정원을 각각 확인합니다.','muted'));
      const wrap=el('label',undefined,'setting-toggle');input=el('input');input.type='checkbox';input.name='closeOnCapacity';input.checked=settings.closeOnCapacity;const text=el('span');text.append(el('strong','정원 도달 시 모집 마감'),el('span','사용하려면 접수 인원 제한을 1명 이상으로 설정하세요.','field-help'));wrap.append(input,text);card.append(wrap);
      card.append(el('p','끄면 수동 마감 또는 기존 자동 마감 시간을 사용합니다. 이미 예약된 시간 마감은 유지됩니다.','field-help'));
      card.append(el('p','마감 후 참가 취소·미루기도 제한됩니다. Discord에서 처리하려면 모집을 다시 열어 주세요.','field-help'));
    }
    const save=el('button','설정 저장');save.type='submit';f.append(card,save,message);f.oninput=()=>{dirty=true;};
    f.onsubmit=event=>{event.preventDefault();if(busy)return;void run(async()=>{assertCurrent();const body={revision:data.revision,maxApplicants:settings.maxApplicants,duplicatePolicy:settings.duplicatePolicy,closeOnCapacity:settings.closeOnCapacity};
      if(id==='intake-capacity'){if(input.value.trim()===''||!Number.isInteger(Number(input.value))||Number(input.value)<0||Number(input.value)>1000)throw Error('접수 인원은 0~1000명 사이의 정수로 입력해 주세요.');body.maxApplicants=Number(input.value);}
      else if(id==='intake-duplicates'){if(!['keep_existing','reject'].includes(input.value))throw Error('중복 접수 처리 방식을 선택해 주세요.');body.duplicatePolicy=input.value;}
      else body.closeOnCapacity=input.checked;
      if(body.closeOnCapacity&&body.maxApplicants===0)throw Error('정원 도달 마감을 사용하려면 접수 인원을 1명 이상으로 설정하세요. 무제한으로 바꾸려면 정원 도달 마감을 먼저 해제해 주세요.');
      save.disabled=true;message.textContent='저장 중…';try{await request('/intake-settings',body);await page(id);}catch(error){if(!error.stale)message.textContent=error.status===409?'다른 창에서 접수 조건이 변경되었습니다. 입력 내용은 유지했습니다. 새 설정을 불러와 확인한 뒤 다시 저장해 주세요.':error.message;throw error;}finally{save.disabled=false;}
    });};p.append(f);actions(button('새 설정 불러오기',async()=>{assertCurrent();if(dirty&&!confirm('입력한 내용을 최신 저장 설정으로 바꿀까요?'))return;await page(id);},'secondary'));
  }else if(id==='recruitment-rules'||id==='fairness'||id==='call-settings'){
    const isFairness=id!=='call-settings',data=await request(isFairness?'/api/community':'/call-settings'),settings=data.settings||{},values=isFairness?settings.fairness||{}:settings;
    const validRevision=Number.isSafeInteger(data.revision)&&data.revision>=0,validSettings=isFairness?typeof settings.channelId==='string'&&settings.roles&&typeof settings.roles==='object'&&!Array.isArray(settings.roles)&&['enabled','unplayedFirst','waitFirst'].every(key=>typeof values[key]==='boolean')&&Number.isInteger(values.maxConsecutive)&&values.maxConsecutive>=0&&values.maxConsecutive<=20&&Number.isInteger(values.newcomerSlots)&&values.newcomerSlots>=0&&values.newcomerSlots<=50:Number.isInteger(values.timeoutSeconds)&&values.timeoutSeconds>=15&&values.timeoutSeconds<=300;
    if(!validRevision||!validSettings){const message='저장된 설정을 확인하지 못했습니다. 다시 불러온 뒤 저장해 주세요.';$('panel').replaceChildren(el('p',message),button('설정 다시 불러오기',()=>page(id),'secondary'));throw Error(message);}
    p.append(el('p',isFairness?'다음에 여는 모집부터 적용됩니다. 현재 열린 회차의 선발 기준은 바뀌지 않습니다.':'다음 참가자 호출부터 적용됩니다. 이미 호출한 참가자의 응답 마감 시간은 유지됩니다.','settings-guidance'));
    if(isFairness)p.append(el('p','공정 선발을 사용하면 추첨 시 우선순위를 적용합니다. 신규 참가자는 보관된 최근 최대 50회 참가 기록으로 판단합니다.','muted'));
    const f=el('form',undefined,'form settings-form'),inputs={},message=el('p','', 'settings-feedback');message.setAttribute('role','status');let dirty=false;
    const numeric=(key,label,value,min,max,help)=>{const input=field(f,key,label,value,'number');input.min=String(min);input.max=String(max);input.step='1';input.required=true;input.parentElement.append(el('span',help,'field-help'));inputs[key]=input;};
    const checkbox=(key,label,value,help)=>{const wrap=el('label',undefined,'setting-toggle'),input=el('input');input.type='checkbox';input.name=key;input.checked=value===true;const text=el('span');text.append(el('strong',label),el('span',help,'field-help'));wrap.append(input,text);f.append(wrap);inputs[key]=input;};
    if(isFairness){
      checkbox('enabled','공정 선발 사용',values.enabled,'사용하지 않으면 기존 무작위 추첨을 유지합니다.');
      checkbox('unplayedFirst','오늘 미참가자 우선',values.unplayedFirst,'한국 시간 기준으로 오늘 참여하지 않은 참가자를 우선합니다.');
      checkbox('waitFirst','같은 우선순위에서는 접수 순서 우선',values.waitFirst,'먼저 접수한 참가자를 앞 순서로 선발합니다.');
      numeric('maxConsecutive','연속 참가 제한',values.maxConsecutive??0,0,20,'0은 제한 없음 · 1~20회');
      numeric('newcomerSlots','신규 참가자 우선 자리',values.newcomerSlots??0,0,50,'0은 별도 우선 자리 없음 · 최대 50자리');
    }else numeric('timeoutSeconds','호출 응답 대기 시간 (초)',values.timeoutSeconds,15,300,'15~300초 사이의 정수로 입력하세요.');
    const save=el('button','설정 저장');save.type='submit';f.append(save,message);f.oninput=()=>{dirty=true;};
    f.onsubmit=event=>{event.preventDefault();if(busy)return;void run(async()=>{assertCurrent();const body=isFairness?{revision:data.revision,channelId:settings.channelId||'',roles:{...(settings.roles||{})},fairness:Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.type==='checkbox'?input.checked:Number(input.value)]))}:{revision:data.revision,timeoutSeconds:Number(inputs.timeoutSeconds.value)};
      const limits=isFairness?[['maxConsecutive',0,20],['newcomerSlots',0,50]]:[['timeoutSeconds',15,300]],numbers=isFairness?body.fairness:body;
      if(limits.some(([key,min,max])=>!Number.isInteger(numbers[key])||numbers[key]<min||numbers[key]>max))throw Error(isFairness?'참가 제한과 우선 자리의 입력 범위를 확인해 주세요.':'호출 응답 시간은 15~300초 사이의 정수로 입력해 주세요.');
      save.disabled=true;message.textContent='저장 중…';try{await request(isFairness?'/api/community/settings':'/call-settings',body);await page(isFairness?'recruitment-rules':'call-settings');}catch(error){if(!error.stale)message.textContent=error.status===409?'다른 창에서 설정이 변경되었습니다. 입력 내용은 유지했습니다. 새 설정을 불러와 확인한 뒤 다시 저장해 주세요.':error.message;throw error;}finally{save.disabled=false;}
    });};p.append(f);actions(button('새 설정 불러오기',async()=>{assertCurrent();if(dirty&&!confirm('입력한 내용을 최신 저장 설정으로 바꿀까요?'))return;await page(isFairness?'recruitment-rules':'call-settings');},'secondary'));
  }else if(id==='practice'){
    let practice=newPractice(),acting=false;
    const steps=[['register','가상 접수','Discord 5명과 네이버 5명의 가상 참가자를 접수합니다.'],['call','호출','첫 참가자를 부르는 흐름을 연습합니다.'],['ready','준비','가상 참가자의 응답과 준비 완료를 확인합니다.'],['draw','추첨','10명 중 6명을 연습용 무작위 추첨으로 선발합니다.'],['teams','팀 배정','선발된 가상 참가자를 A/B 팀으로 나눕니다.'],['end','방송 종료','연습 회차를 종료합니다. 실제 방송은 종료하지 않습니다.']];
    const phases=['접수 전','접수 완료','호출 완료','준비 완료','추첨 완료','팀 배정 완료','방송 종료'];
    p.append(el('p','연습 전용 · 실제 운영에 반영되지 않습니다.','practice-banner'),el('p','이 화면의 가상 참가자만 사용합니다. Discord·네이버·CHZZK에 요청을 보내거나 실제 Queue를 변경하지 않습니다. 화면이나 서버를 바꾸면 연습 내용이 초기화됩니다.','muted'));
    const progress=el('ol',undefined,'practice-progress'),content=el('div',undefined,'practice-stage'),feedback=el('p','', 'settings-feedback');feedback.setAttribute('role','status');
    const render=()=>{const index=phases.indexOf(practice.phase);progress.replaceChildren();for(const [position,[,label]]of steps.entries()){const item=el('li',`${position+1}. ${label}`,position<index?'complete':position===index?'current':'');if(position===index)item.setAttribute('aria-current','step');progress.append(item);}content.replaceChildren();
      if(index>=steps.length){content.append(el('h2','연습 완료'),el('p','접수부터 방송 종료까지 6단계를 완료했습니다. 초기화하면 처음부터 다시 연습할 수 있습니다.'));}
      else{const [action,label,help]=steps[index];content.append(el('span',`${index+1} / ${steps.length} 단계`,'badge readiness-pending'),el('h2',label),el('p',help));const next=el('button',label+' 연습');next.type='button';next.dataset.practiceAction=action;next.onclick=()=>{if(acting||busy||!current()||phases.indexOf(practice.phase)!==index)return;acting=true;next.disabled=true;try{practice=practiceAction(practice,action);feedback.textContent=label+' 연습을 완료했습니다.';render();}catch(error){feedback.textContent=error.message;}finally{acting=false;}};content.append(next);}
      if(practice.participants.length){const result=el('div',undefined,'practice-result');result.append(el('p',`가상 접수 ${practice.participants.length}명 · 준비 완료 ${practice.participants.filter(participant=>participant.ready).length}명 · 선발 ${practice.selection.length}명`));if(practice.teams.length)for(const [i,team]of practice.teams.entries())result.append(el('p',`팀 ${i?'B':'A'} · ${team.map(participant=>participant.name).join(', ')}`));content.append(result);}
    };p.append(progress,content,feedback);const reset=el('button','연습 초기화','secondary');reset.type='button';reset.onclick=()=>{if(acting||busy||!current())return;practice=newPractice();feedback.textContent='연습을 처음부터 시작합니다.';render();};const resetActions=el('div',undefined,'actions');resetActions.append(reset);p.append(resetActions);render();
  }else if(id==='queue'){
    const data=await request('/api/participation-queue'),split=el('div',undefined,'split'),list=el('div',undefined,'list'),detail=el('div');
    detail.append(el('h2','참가자를 선택하세요'),el('p','목록을 선택하면 해당 참가자의 작업만 표시됩니다.','muted'));
    const statusNames={waiting:'대기',called:'호출 중',joined:'참가 확인',postponed_next:'다음판',postponed_next2:'다다음판',no_show:'노쇼',cancelled:'취소',completed:'완료'};
    for(const entry of data.queue?.entries||[]){const b=el('button',`${entry.position}. ${entry.displayName} · ${{discord:'Discord',naver:'네이버',dashboard:'수동 접수'}[entry.source]||entry.source} · ${statusNames[entry.status]||entry.status}`,'person');b.onclick=()=>{if(busy||!current())return;for(const row of list.children)row.classList.toggle('selected',row===b);detail.replaceChildren(el('h2',entry.displayName));const a=el('div',undefined,'actions');a.append(button('호출',async()=>{await request('/api/participation-queue/'+entry.id+'/call',{});await page('queue');}));for(const [status,label]of [['joined','참가 확인'],['postponed_next','다음판'],['postponed_next2','다다음판'],['no_show','노쇼'],['cancelled','취소']])a.append(button(label,async()=>{if(!confirm(entry.displayName+' · '+label+' 처리할까요?'))return;await request('/api/participation-queue/'+entry.id+'/status',{status});await page('queue');},'secondary'));detail.append(a,form([['position','변경할 순번',entry.position,'number']],async body=>{await request('/api/participation-queue/'+entry.id+'/reorder',body);await page('queue');},'순서 변경'));};list.append(b);}
    if(!list.children.length)list.append(el('p','접수된 참가자가 없습니다.'));split.append(list,detail);p.append(split);actions(button('다음 참가자 호출',async()=>{await request('/api/participation-queue/call-next',{});await page('queue');}),button('새로고침',()=>page('queue'),'secondary'));
    p.append(form([['displayName','수동 참가자 이름','','text']],async body=>{await request('/api/participation-queue/register',body);await page('queue');},'참가자 추가'));
  }else if(id==='open'){
    await snap();p.append(form([['game','게임','lol','select',[['lol','리그 오브 레전드'],['er','이터널 리턴']]],['mode','모드','aram','select',[['aram','칼바람'],['rift','소환사의 협곡']]],['count','모집 인원',10,'number'],['title','모집 제목','시청자 참여']],async body=>{await op('open',body);await page('round');},'모집 시작','선택한 서버에서 참가 모집을 시작할까요?'));
  }else if(id==='round'){
    const data=await snap(),s=data.state?.session;p.append(el('h2',s?.title||'진행 중인 모집이 없습니다.'),el('p',s?`${s.round}회차 · ${s.phase} · 신청 ${s.applicants?.length||0}명`:'참가 모집 시작 메뉴에서 모집을 열어 주세요.'));
    const a=el('div',undefined,'actions');for(const [action,label]of [['close','모집 마감'],['reopen','다시 모집'],['draw','랜덤 추첨'],['attendance','참석 확인 시작'],['replace','미응답자 교체'],['teams','팀 배정'],['reshuffle','팀 다시 배정'],['publish','Discord에 게시'],['end','방송 종료']])a.append(button(label,async()=>{if(!confirm(label+' 작업을 실행할까요?'))return;await op(action);await page('round');},action==='end'?'secondary':''));p.append(a);
  }else if(['ready','undo','community','studio','roulette','subscriptions','recruitment','my-panel','recap','publication','guide','tickets'].includes(id)){
    const files={ready:'operation-tools.html?feature=ready',undo:'operation-tools.html?feature=undo',studio:'game-studio.html',roulette:'roulette.html'};p.append(el('p','현재 선택한 서버의 전용 화면에서 작업합니다.'),link(titles[id]+' 열기',scope+'/'+(files[id]||'community.html?feature='+encodeURIComponent(id))));
  }else if(id==='discord'){
    p.append(el('p','이 서버에 모집·참가 안내 채널과 패널을 준비합니다. 봇에 필요한 채널·메시지 권한이 있어야 합니다.'));actions(button('서버 채널 준비',async()=>{if(confirm('현재 서버에 운영 채널과 안내 패널을 생성·갱신할까요?'))await op('setup');}));
  }else if(id==='members'){
    const data=await snap();p.append(table(data.records,[['chzzkName','참가자'],['lolRiotId','롤 계정'],['erNickname','이터널 리턴']]));
  }else if(id==='cafe'){
    const data=await request('/settings');p.append(form([['naverCafeId','카페 ID',data.settings.naverCafeId],['naverMenuId','일반 게시판 ID',data.settings.naverMenuId],['naverMemoMenuId','메모 게시판 ID',data.settings.naverMemoMenuId]],body=>request('/settings',body)));
  }else if(id==='naver'){
    const data=await request('/api/naver/status');p.append(el('p',data.connected?'이 방송 공간에 네이버 계정이 연결되어 있습니다.':'사용할 네이버 계정을 연결하세요.'));actions(button('네이버 계정 연결',async()=>{const result=await request('/api/naver/oauth/start',{});location.assign(result.url);}),button('연결 해제',async()=>{if(confirm('이 방송 공간의 네이버 연결을 해제할까요?')){await request('/api/naver/disconnect',{});await page('naver');}},'secondary'));
  }else if(id==='search'){
    const results=el('ul',undefined,'data-list');p.append(form([['q','검색어','']],async body=>{const data=await request('/api/naver/search?q='+encodeURIComponent(body.q));results.replaceChildren();for(const item of data.items||[])results.append(el('li',String(item.title||'').replace(/<[^>]*>/g,'')));},'검색'),results);
  }else if(id==='write'){
    p.append(form([['subject','게시글 제목',''],['content','게시글 내용','','textarea']],body=>request('/api/naver/articles',body),'카페에 게시','설정한 카페·게시판에 실제 글을 게시할까요?'));
  }else if(id==='memo'){
    const data=await request('/api/naver/participation');p.append(el('p',data.registrationOpen?'칼바람 시참 접수 중입니다.':'접수를 시작하면 카페 메모 게시판에 모집글을 게시합니다.'),table(data.entries,[['order','순번'],['displayName','참가자'],['status','상태']]));actions(button('접수 시작·모집글 게시',async()=>{if(confirm('카페에 칼바람 모집글을 게시하고 접수를 시작할까요?')){await request('/api/naver/participation/session',{});await page('memo');}}),button('접수 마감',async()=>{await request('/api/naver/participation/close',{});await page('memo');},'secondary'));p.append(form([['displayName','카페 참가자 이름','']],async body=>{await request('/api/naver/participation/register',body);await page('memo');},'참가자 접수'));
  }else if(id==='monitor'){
    const data=await request('/api/naver/monitor'),s=data.settings;p.append(form([['query','감시할 검색어',s.query],['cafeUrl','카페 주소',s.cafeUrl],['intervalMinutes','확인 간격(분)',s.intervalMinutes,'number'],['enabled','새 글 확인',String(s.enabled),'select',[['true','사용'],['false','중지']]]],body=>request('/api/naver/monitor/settings',{...body,enabled:body.enabled==='true',discordAlerts:true})));actions(button('지금 확인',()=>request('/api/naver/monitor/run',{}),'secondary'));
  }else if(id==='chzzk'){
    const data=await request('/api/chzzk/verification');p.append(el('h2',data.channelName||'연결할 방송 채널'),el('p',data.ownerConnected?'이 서버의 팔로워 인증 대상이 연결되어 있습니다.':'방송 계정으로 로그인해 이 서버의 인증 대상을 연결하세요.'));actions(button('방송 계정 연결',async()=>{const result=await request('/api/chzzk/verification/owner/start',{});location.assign(result.url);}));
  }else if(id==='live'){
    const data=await request('/live-settings'),s=data.settings;
    p.append(el('p','연결한 방송 계정의 시작·종료를 확인하고 이 서버에 알림을 보냅니다.'),el('p',s.channelId?'방송 계정 연결됨 · 확인 대상은 연결한 채널로 고정됩니다.':'방송 계정 연결 메뉴에서 채널을 먼저 연결해 주세요.','muted'),form([['enabled','방송 상태 확인',String(s.enabled),'select',[['true','사용'],['false','중지']]],['intervalMinutes','확인 간격',String(s.intervalMinutes||2),'select',[['1','1분'],['2','2분'],['5','5분'],['10','10분'],['15','15분']]],['discordAlerts','Discord 알림',String(s.discordAlerts!==false),'select',[['true','알림 전송'],['false','전송하지 않음']]]],body=>request('/live-settings',{enabled:body.enabled==='true',intervalMinutes:Number(body.intervalMinutes),discordAlerts:body.discordAlerts==='true'})));
  }else if(id==='panel'){
    const options=await request('/api/community-options');p.append(form([['channelId','인증 안내를 게시할 채널','','select',(options.channels||[]).map(c=>[c.id,c.name])]],body=>request('/api/chzzk/verification/panel',body),'인증 안내 게시','선택한 Discord 채널에 인증 안내를 게시할까요?'));
  }else if(id==='donation-roulette'){
    const data=await request('/api/donation-roulette'),s=data.settings,st=data.status||{};
    const validTiers=s&&typeof s.enabled==='boolean'&&Array.isArray(s.tiers)&&s.tiers.length<=5&&s.tiers.every(t=>t&&Number.isSafeInteger(t.minAmount)&&t.minAmount>0&&Array.isArray(t.items)&&t.items.every(i=>typeof i==='string'));
    if(!Number.isSafeInteger(data.revision)||data.revision<0||!validTiers){const message='저장된 후원 룰렛 설정을 확인하지 못했습니다. 다시 불러와 주세요.';$('panel').replaceChildren(el('p',message),button('설정 다시 불러오기',()=>page(id),'secondary'));throw Error(message);}
    const states={unavailable:['준비 안 됨','readiness-optional'],not_connected:['방송 계정 연결 필요','readiness-attention'],disabled:['사용 안 함','readiness-optional'],stopped:['중지','readiness-optional'],connecting:['연결 중','readiness-pending'],subscribing:['구독 요청 중','readiness-pending'],subscribed:['후원 구독 요청 완료','readiness-configured'],reconnecting:['재연결 대기','readiness-attention'],auth_required:['후원 조회 권한 동의 필요','readiness-attention']};
    const [label,cls]=states[st.state]||['상태 확인 필요','readiness-attention'],evidence=el('div',undefined,'readiness-evidence');
    evidence.append(el('span',label,'badge '+cls),el('span','실제 후원 수신 검증 대기','badge readiness-pending'));
    p.append(el('p','치지직에서 정한 금액 이상 치즈 후원이 들어오면, 후원 금액이 해당하는 가장 높은 구간의 목록으로 룰렛을 1회 돌립니다. 결과는 룰렛 기록과 OBS 후원 룰렛 화면에 후원자 닉네임과 함께 표시됩니다. Queue는 바뀌지 않습니다.','settings-guidance'),evidence);
    if(st.detail)p.append(el('p',safeText(st.detail,200),'muted'));
    if(st.state==='not_connected')p.append(el('p','CHZZK → 방송 계정 연결에서 이 서버의 방송 계정을 먼저 연결해 주세요. 후원 조회 권한(후원 조회 Scope)에 동의해야 합니다.','muted'));
    const f=el('form',undefined,'form settings-form donation-form'),message=el('p','','settings-feedback');message.setAttribute('role','status');
    const toggle=el('label',undefined,'setting-toggle'),enabled=el('input'),toggleText=el('span');enabled.type='checkbox';enabled.name='enabled';enabled.checked=s.enabled;toggleText.append(el('strong','치즈 후원 룰렛 사용'),el('span','방송 계정이 연결되어 있을 때만 후원을 받습니다.','field-help'));toggle.append(enabled,toggleText);f.append(toggle);
    const list=el('div',undefined,'donation-tiers'),add=el('button','금액 구간 추가','secondary');add.type='button';
    const tierRow=(tier={minAmount:1000,items:[]})=>{const row=el('fieldset',undefined,'intake-setting-card donation-tier'),legend=el('legend','금액 구간');row.append(legend);
      const amount=field(row,'minAmount','최소 후원 금액 (치즈)',tier.minAmount,'number');amount.min='1';amount.max='100000000';amount.step='1';amount.required=true;
      const items=field(row,'items','룰렛 항목 (한 줄에 하나, 2~100개)',tier.items.join('\n'),'textarea');items.required=true;
      const remove=el('button','이 구간 삭제','secondary');remove.type='button';remove.onclick=()=>{if(list.children.length>1){row.remove();add.disabled=false;}else message.textContent='금액 구간은 1개 이상 필요합니다.';};row.append(remove);list.append(row);add.disabled=list.children.length>=5;};
    for(const tier of s.tiers.length?s.tiers:[{minAmount:1000,items:[]}])tierRow(tier);
    add.onclick=()=>{if(list.children.length<5)tierRow({minAmount:(Math.max(0,...[...list.querySelectorAll('input[name=minAmount]')].map(i=>Number(i.value)||0))+1000),items:[]});};
    f.append(list,add,el('p','금액이 여러 구간에 해당하면 최소 금액이 가장 높은 구간 하나만 돌립니다. 저장한 뒤 들어오는 후원부터 적용됩니다.','field-help'));
    const save=el('button','설정 저장');save.type='submit';f.append(save,message);
    f.onsubmit=event=>{event.preventDefault();if(busy)return;void run(async()=>{assertCurrent();
      const tiers=[...list.querySelectorAll('.donation-tier')].map(row=>({minAmount:Number(row.querySelector('[name=minAmount]').value),items:row.querySelector('[name=items]').value.split('\n').map(v=>v.trim()).filter(Boolean)}));
      if(tiers.some(t=>!Number.isSafeInteger(t.minAmount)||t.minAmount<1||t.minAmount>100000000))throw Error('최소 후원 금액은 1~100,000,000치즈 사이의 정수로 입력해 주세요.');
      if(tiers.some(t=>t.items.length<2||t.items.length>100))throw Error('각 구간의 룰렛 항목은 2~100개로 입력해 주세요.');
      await request('/api/donation-roulette',{enabled:enabled.checked,tiers,revision:data.revision});await page(id);});};
    p.append(f);
    actions(button('OBS 후원 룰렛 주소 복사',async()=>{const obs=await request('/obs');if(!obs.donationRouletteUrl)throw Error('OBS 주소를 확인하지 못했습니다.');await navigator.clipboard.writeText(obs.donationRouletteUrl);}),button('룰렛 기록 보기',()=>page('roulette'),'secondary'));
    p.append(el('h2','최근 후원 룰렛'));
    const events=Array.isArray(data.events)?data.events:[];
    if(events.length)p.append(table(events.slice(0,30).map(e=>({time:new Date(e.at).toLocaleString('ko-KR'),nickname:safeText(e.nickname,20),amount:Number(e.amount).toLocaleString('ko-KR')+'치즈',result:e.status==='spun'?safeText(e.winner,80):'돌리지 않음 · '+safeText(e.reason,200)})),[['time','일시'],['nickname','후원자'],['amount','후원'],['result','결과']]));
    else p.append(el('p','아직 기록된 후원 룰렛이 없습니다.','muted'));
  }else if(id==='obs'){
    p.append(el('p','OBS 브라우저 소스에 사용할 주소를 복사합니다. 참가자에게 공유하지 마세요.'));actions(button('OBS 주소 복사',async()=>{const data=await request('/obs');await navigator.clipboard.writeText(data.url);}));
  }else if(id==='presets'){
    const data=await request('/api/broadcast-ops');
    p.append(form([['id','사용할 프리셋','','select',data.gamePresets.map(preset=>[preset.id,preset.name])]],async body=>{await request('/api/broadcast-ops/preset/open',body);await page('round');},'이 프리셋으로 모집 시작','선택한 서버에서 실제 참가 모집을 시작할까요?'));
    const details=el('details');details.append(el('summary','새 프리셋 저장'),form([['name','프리셋 이름',''],['game','게임','lol','select',[['lol','리그 오브 레전드'],['er','이터널 리턴']]],['mode','모드','aram','select',[['aram','칼바람'],['rift','소환사의 협곡']]],['count','모집 인원',10,'number'],['title','모집 제목','시청자 참여'],['description','참가 안내','','textarea'],['closeMinutes','자동 마감까지 (분, 0은 수동)',0,'number']],async body=>{await request('/api/broadcast-ops/preset',body);await page('presets');},'프리셋 저장'));p.append(details);
  }else if(['timeline','stats','notifications'].includes(id)){
    const data=await request('/api/broadcast-ops');
    if(id==='timeline')p.append(table((data.timeline||[]).map(item=>({...item,time:new Date(item.at).toLocaleString('ko-KR')})),[['time','일시'],['message','활동']]));
    if(id==='stats')p.append(table(Object.entries({sessions:'전체 회차',completedSessions:'종료 회차',totalApplicants:'누적 신청',totalWinners:'누적 선정',noShows:'노쇼',averageApplicants:'평균 신청',liveStarts:'방송 시작',queueActive:'현재 대기',queueJoined:'참가 확인'}).map(([key,label])=>({label,value:data.stats?.[key]??0})),[['label','항목'],['value','수치']]));
    if(id==='notifications')p.append(form(Object.entries({broadcast:'방송',participation:'참가',naver:'카페',schedule:'일정'}).map(([key,label])=>[key,label,String(data.notifications[key]!==false),'select',[['true','알림 사용'],['false','알림 중지']]]),body=>request('/api/broadcast-ops/notifications',{...data.notifications,...Object.fromEntries(Object.entries(body).map(([key,value])=>[key,value==='true']))})));
  }else if(id==='schedule'){
    const data=await request('/api/broadcast-ops');p.append(table(data.schedules.map(s=>({...s,startLabel:new Date(s.startAt).toLocaleString('ko-KR'),status:({scheduled:'예정',completed:'완료',cancelled:'취소'})[s.status]||s.status})),[['title','일정'],['startLabel','시작 일시'],['status','상태']]));p.append(form([['title','방송 제목',''],['startAt','시작 일시 (이 기기의 현지 시간)','','datetime-local'],['note','안내','']],async body=>{const startAt=new Date(body.startAt).getTime();if(!Number.isFinite(startAt))throw Error('방송 시작 일시를 입력해 주세요.');await request('/api/broadcast-ops/schedule',{...body,startAt});await page('schedule');},'일정 등록'));
  }else if(id==='poll'){
    const data=await request('/api/broadcast-ops');if(data.activePoll){p.append(el('h2',data.activePoll.question));actions(button('투표 종료',async()=>{await request('/api/broadcast-ops/poll',{action:'close',id:data.activePoll.id});await page('poll');}));}else p.append(form([['question','투표 질문',''],['options','선택지 (한 줄에 하나)','','textarea']],body=>request('/api/broadcast-ops/poll',{question:body.question,options:body.options.split('\n').map(s=>s.trim()).filter(Boolean)}),'투표 시작','현재 서버에 방송 투표 시작을 안내할까요?'));
  }else if(id==='archive'){
    const data=await request('/api/broadcast-archive');p.append(table(data.reports.map(r=>({...r,endedLabel:r.endedAt?new Date(r.endedAt).toLocaleString('ko-KR'):'—'})),[['title','방송'],['endedLabel','종료 일시']]));if(!data.reports.length)p.append(el('p','마감한 방송 기록이 없습니다.','muted'));
  }
  if(myGeneration===generation)$('panel').replaceChildren(p);
}
async function selectServer(initialPage='home'){
  closeMenu();
  generation++;const mySelection=++selectionGeneration,guildId=$('servers').value;selected=guildId;workspace=null;$('menu').replaceChildren();$('breadcrumb').textContent='내 방송 공간';$('intro').textContent='';$('title').textContent='서버 선택';$('panel').replaceChildren(el('p',guildId?'접근 권한을 확인하는 중…':'운영하거나 참여할 서버를 선택하세요.'));if(!guildId)return;
  const current=()=>mySelection===selectionGeneration&&selected===guildId;
  notice('');try{const result=await api('/portal/api/servers/'+guildId);if(!current())return;workspace=result;}catch(e){
    if(!current())return;$('title').textContent='서버 연결';$('panel').replaceChildren(el('p',e.message));if(e.status===409)$('panel').append(button('이 서버의 운영 공간 만들기',async()=>{if(!current())return;await api('/portal/api/servers/'+guildId,{});if(current())await selectServer();}));return;
  }
  history.replaceState(null,'','/portal/?server='+selected+(validEntry&&selected===entryServer?'&session='+encodeURIComponent(entrySession):''));navigation();
  if(workspace.role==='participant'){$('title').textContent='내 참가 상태';$('intro').textContent=workspace.name+' · 참가자';$('panel').replaceChildren(el('p','내 순번·호출 응답·예약·준비 상태를 확인하세요.'),link('내 참가 화면 열기',viewerUrl()));}
  else await page(knownPage(initialPage)?initialPage:'home');
}
$('servers').onchange=()=>selectServer().catch(e=>notice(e.message));
$('logout').onclick=()=>run(async()=>{await api('/portal/auth/logout',{});location.assign('/portal/');});
try{
  session=await api('/portal/auth/session');
  if(session.authenticated){$('account').textContent=session.user.name;$('logout').hidden=false;const data=await api('/portal/api/servers');$('servers').replaceChildren(new Option('서버 선택',''));for(const server of data.servers)if(server.botPresent)$('servers').append(new Option(server.name,server.id));
    $('panel').replaceChildren(el('h2','운영하거나 참여할 서버를 선택하세요.'),link('다른 서버에 봇 초대',data.installUrl));const target=entryServer;if(data.servers.some(s=>s.id===target&&s.botPresent)){$('servers').value=target;await selectServer(entryQuery.get('page')||'home');}
  }else if(!session.configured)notice('사용자 로그인을 준비 중입니다.');
}catch(e){notice(e.message);}
