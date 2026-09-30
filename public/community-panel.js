const $=id=>document.getElementById(id),topics={aram:'칼바람 모집',rift:'협곡 모집',er:'이터널 리턴 모집',live:'방송 시작'};
let state,csrf='',busy=false;
const uncertain=new Map();
async function api(path,body){
  const signature=path+JSON.stringify(body),key=uncertain.get(signature)||crypto.randomUUID();let response;
  try{response=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},body:JSON.stringify(body)})});}catch(e){uncertain.set(signature,key);throw e;}
  const data=await response.json();uncertain.delete(signature);if(!response.ok)throw Error(data.error||'요청 실패');return data;
}
function element(tag,content){const e=document.createElement(tag);if(content!==undefined)e.textContent=content;return e;}
function btn(label,fn){const e=element('button',label);e.addEventListener('click',()=>run(fn));return e;}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();$('notice').textContent='처리했습니다.';await refresh();}catch(e){$('notice').textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
const action=(name,body={})=>api('/api/community/'+name,{revision:state.revision,...body});
function keepOption(select,value){if(value&&!Array.from(select.options).some(o=>o.value===value))select.add(new Option(value,value));select.value=value||'';}
function faqRow(question='',answer=''){const row=element('div');row.className='faq-row';const q=element('input'),a=element('textarea');q.value=question;q.maxLength=120;q.setAttribute('aria-label','질문');a.value=answer;a.maxLength=1200;a.setAttribute('aria-label','답변');const remove=element('button','질문 삭제');remove.onclick=()=>row.remove();row.append(q,a,remove);$('faq').append(row);}
function render(){
  keepOption($('channel'),state.settings.channelId);for(const t of Object.keys(topics))keepOption($('role-'+t),state.settings.roles[t]);
  const f=state.settings.fairness;$('fair-enabled').checked=f.enabled;$('fair-unplayed').checked=f.unplayedFirst;$('fair-wait').checked=f.waitFirst;$('fair-max').value=f.maxConsecutive;$('fair-new').value=f.newcomerSlots;
  $('current-session').textContent=state.session?`현재 회차: ${state.session.title} · ${state.session.phase} · ${state.session.fairness}`:'현재 열린 모집이 없습니다.';
  const archive=$('archive'),selected=archive.value;archive.replaceChildren(new Option('종료 회차 선택',''),...state.archives.map(s=>new Option(`${s.title} · ${new Date(s.endedAt).toLocaleDateString('ko-KR')}`,s.id)));archive.value=selected;
  const rules=state.guide.pages.rules.published;$('rules-title').value=rules.title;$('rules-body').value=rules.body;$('faq').replaceChildren();for(const x of state.guide.pages.faq.published.items)faqRow(x.question,x.answer);
  $('drafts').replaceChildren();for(const d of state.drafts){const card=element('article');card.append(element('h3',d.title),element('pre',d.content));
    for(const target of ['discord','naver']){const delivery=d.delivery[target],label=target==='discord'?'디스코드':'네이버 카페';card.append(element('small',`${label}: ${{draft:'게시 전',sending:'전송 중 또는 확인 필요',sent:'게시 완료',uncertain:'결과 확인 필요'}[delivery.status]||delivery.status}`));
      if(delivery.status==='draft')card.append(btn(`${label}에 게시`,async()=>{if(confirm(`${label}에 이 내용을 게시할까요?`))await action('publish',{id:d.id,targets:[target],confirm:'게시'});}));
      if(['sending','uncertain'].includes(delivery.status))for(const [status,label2] of [['sent','게시됨 확인'],['draft','게시 안 됨 확인 · 재시도 허용']])card.append(btn(`${label} ${label2}`,async()=>{const reason=prompt('실제 게시물을 확인한 결과와 사유를 입력하세요.');if(reason)await action('resolve',{id:d.id,target,status,reason});}));
    }
    card.append(btn('두 곳에 게시',async()=>{if(confirm('디스코드와 카페에 게시할까요? 이미 게시된 대상은 건너뜁니다.'))await action('publish',{id:d.id,targets:['discord','naver'],confirm:'게시'});}),btn('초안·이력 목록에서 제거',async()=>{if(confirm('외부 게시물은 유지하고 이 목록에서 제거할까요?'))await action('delete-draft',{id:d.id});}));$('drafts').append(card);
  }
  if(!state.drafts.length)$('drafts').textContent='아직 만든 초안이 없습니다.';
  $('ticket-list').replaceChildren();for(const t of state.tickets){const card=element('article'),answer=element('textarea');answer.value=t.answer;answer.maxLength=1500;answer.setAttribute('aria-label','운영자 답변');card.append(element('h3',`${t.status==='closed'?'처리 완료':'접수'} · ${t.userId}`),element('p',t.message),answer,btn('답변 저장',()=>action('answer',{id:t.id,answer:answer.value,close:false})),btn('답변하고 처리 완료',()=>action('answer',{id:t.id,answer:answer.value,close:true})));$('ticket-list').append(card);}
  if(!state.tickets.length)$('ticket-list').textContent='접수된 문의가 없습니다.';
}
async function refresh(){state=await api('/api/community');render();}
for(const [t,label] of Object.entries(topics)){const l=element('label',label+' 알림 역할'),s=element('select');s.id='role-'+t;s.add(new Option('사용 안 함',''));l.append(s);$('roles').append(l);}
const bind=(id,fn)=>$(id).addEventListener('click',()=>run(fn));
bind('refresh',refresh);
bind('load-options',async()=>{const data=await api('/api/community-options');$('channel').replaceChildren(new Option('선택 안 함',''),...data.channels.map(x=>new Option(x.name,x.id)));for(const t of Object.keys(topics))$('role-'+t).replaceChildren(new Option('사용 안 함',''),...data.roles.map(x=>new Option(x.name,x.id)));});
bind('save-settings',()=>action('settings',{channelId:$('channel').value,roles:Object.fromEntries(Object.keys(topics).map(t=>[t,$('role-'+t).value])),fairness:{enabled:$('fair-enabled').checked,unplayedFirst:$('fair-unplayed').checked,waitFirst:$('fair-wait').checked,maxConsecutive:Number($('fair-max').value),newcomerSlots:Number($('fair-new').value)}}));
$('apply-template').onclick=()=>{const t=$('template').value;$('title').value=t;$('content').value={ '일반 안내':'안내 내용을 입력해 주세요.','방송 일정':'방송 일시: \n게임: \n참가 방법: ','일정 변경':'기존 일정: \n변경 일정: \n안내: ','휴방 안내':'휴방 일자: \n다음 방송 일정: ','결과 발표':'진행한 게임: \n결과: \n다음 일정: '}[t];};
for(const [id,kind] of [['notice-draft','notice'],['recruit-draft','recruitment']])bind(id,()=>action('draft',{kind,title:$('title').value,content:$('content').value,topic:$('topic').value}));
bind('recap-draft',()=>action('draft',{kind:'recap',archiveId:$('archive').value,content:$('recap-content').value,topic:'live'}));
bind('publish-panel',async()=>{if(confirm('선택한 공지 채널에 참가자 패널을 게시하거나 갱신할까요?'))await action('panel');});
bind('save-rules',()=>action('guide',{key:'rules',guideRevision:state.guide.revision,content:{title:$('rules-title').value,body:$('rules-body').value}}));
$('add-faq').onclick=()=>{if($('faq').children.length<20)faqRow();};
bind('save-faq',()=>action('guide',{key:'faq',guideRevision:state.guide.revision,content:{title:'자주 묻는 질문',items:Array.from($('faq').children).map(row=>({question:row.querySelector('input').value,answer:row.querySelector('textarea').value}))}}));
try{csrf=(await api('/api/snapshot')).csrf;await refresh();$('notice').textContent='설정과 초안을 확인하세요. 외부 게시는 게시 버튼을 눌렀을 때만 실행됩니다.';}catch(e){$('notice').textContent=e.message;}
