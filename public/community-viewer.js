export function mountViewerCommunity({api,host}){
  let section=host.querySelector('#viewer-community');if(section)return;section=document.createElement('section');section.id='viewer-community';host.append(section);
  const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  let busy=false;
  async function load(){try{const state=await api('community');section.replaceChildren();section.append(node('h2','내 알림 · 문의 · 규칙'),node('p',state.fairness));
    const status=node('p');status.setAttribute('role','status');section.append(status);
    const button=(label,fn)=>{const b=node('button',label);b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;try{await fn();await load();}catch(e){status.textContent=e.message;}finally{busy=false;b.disabled=false;}};return b;};
    for(const [topic,label] of Object.entries(state.topics)){const s=state.subscriptions.find(s=>s.topic===topic),enabled=s?.enabled&&s.status==='active';section.append(button(`${label} ${s?.status&&s.status!=='active'?(s.enabled?'구독 재시도':'해제 재시도'):enabled?'구독 해제':'구독'}`,()=>api('community/subscribe',{topic,enabled:s?.status&&s.status!=='active'?s.enabled:!enabled})));}
    section.append(node('h3','규칙'),node('p',state.guide.rules.published.body),node('h3','자주 묻는 질문'));
    for(const q of state.guide.faq.published.items){const d=node('details');d.append(node('summary',q.question),node('p',q.answer));section.append(d);}
    section.append(node('h3','운영자 문의'));const message=node('textarea');message.maxLength=1000;message.setAttribute('aria-label','문의 내용 (토큰·비밀번호 입력 금지)');section.append(message,button('문의 접수',()=>api('community/ticket',{message:message.value})),button('답변 새로고침',async()=>{}));
    for(const t of state.tickets)section.append(node('p',`${t.status==='closed'?'처리 완료':'접수'} · ${t.message}\n답변: ${t.answer||'답변 대기'}`));
    section.append(node('h3','내 최근 참가 기록'));for(const s of state.history)section.append(node('p',`${s.title} · ${s.attended?'참가 확인':'신청 기록'}`));
  }catch(e){section.textContent=e.message;}}
  load();
}
