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
  ['통합 운영',[['방송',['home','queue','open','round','ready','undo']],['방송 도구',['presets','schedule','poll','studio','obs','practice']],['방송 기록',['archive','timeline','stats','notifications']],['커뮤니티',['subscriptions','fairness','recruitment','my-panel','recap','publication','guide','tickets']]]],
  ['네이버 카페',[['계정·게시판',['naver','cafe']],['카페 운영',['search','write','memo','monitor']]]],
  ['Discord',[['서버 운영',['discord','members']]]],
  ['CHZZK',[['방송 계정',['chzzk','live']],['팔로워 인증',['panel']]]]
];
const titles={home:'운영 홈',queue:'통합 Queue',open:'참가 모집 시작',round:'경기 진행',ready:'경기 준비 확인',undo:'직전 순서 되돌리기',schedule:'방송 일정',poll:'방송 투표',community:'커뮤니티 운영',studio:'추첨·레이스',obs:'OBS 화면',archive:'방송 기록',practice:'운영 연습',naver:'네이버 계정 연결',cafe:'카페·게시판 설정',search:'카페 글 검색',write:'게시글 작성',memo:'칼바람 시참 접수',monitor:'새 글 알림',discord:'서버 채널 준비',members:'참가자 정보',chzzk:'방송 계정 연결',panel:'인증 안내 게시'};
Object.assign(titles,{subscriptions:'알림 구독',fairness:'공정 선발',recruitment:'모집·공지 초안', 'my-panel':'내 시참 패널',recap:'방송 후기',publication:'게시 미리보기',guide:'규칙·FAQ',tickets:'참가자 문의',live:'방송 시작·종료 알림'});
Object.assign(titles,{presets:'모집 프리셋',timeline:'방송 타임라인',stats:'방송 통계',notifications:'알림 설정'});
function navigation(){
  $('menu').replaceChildren();if(workspace?.role==='participant'){const a=link('내 참가 상태',viewerUrl());$('menu').append(a);return;}
  for(const [group,middle]of menu){const d=el('details');d.append(el('summary',group));for(const [title,leaves]of middle){const m=el('details');m.append(el('summary',title));for(const id of leaves){const b=el('button',titles[id]);b.dataset.page=id;b.onclick=()=>{if(!busy)void page(id).catch(e=>{if(!e.stale)notice(e.message);});};m.append(b);}m.ontoggle=()=>{if(m.open)for(const sibling of d.children)if(sibling!==m&&sibling.tagName==='DETAILS')sibling.open=false;};d.append(m);}d.ontoggle=()=>{if(d.open)for(const sibling of $('menu').children)if(sibling!==d)sibling.open=false;};$('menu').append(d);}
}
async function page(id){
  if(!workspace||workspace.role!=='operator')return;
  closeMenu();
  const myGeneration=++generation,scope=base(),guildId=selected;let snapshot=null;
  const current=()=>myGeneration===generation&&selected===guildId;
  const assertCurrent=()=>{if(!current())throw Object.assign(Error('서버 또는 화면이 변경되었습니다. 다시 선택해 주세요.'),{stale:true});};
  notice('');$('title').textContent=titles[id]||'내 참가 상태';$('intro').textContent=workspace.name+' · 운영자';
  const group=menu.find(([,mid])=>mid.some(([,leaves])=>leaves.includes(id))),mid=group?.[1].find(([,leaves])=>leaves.includes(id));$('breadcrumb').textContent=[group?.[0],mid?.[0],titles[id]].filter(Boolean).join(' / ');
  for(const b of document.querySelectorAll('[data-page]')){b.classList.toggle('active',b.dataset.page===id);if(b.dataset.page===id){b.parentElement.open=true;b.parentElement.parentElement.open=true;}}
  const p=el('div');$('panel').replaceChildren(el('p','불러오는 중…','muted'));
  const request=async(endpoint,body)=>{assertCurrent();try{const result=await api(scope+endpoint,body);assertCurrent();return result;}catch(error){assertCurrent();throw error;}};
  const snap=async()=>snapshot=await request('/api/snapshot');
  const op=async(action,body={})=>{const state=snapshot||await snap();snapshot=await request('/api/operations/'+action,{requestId:crypto.randomUUID(),sessionId:state.state?.session?.id||null,...body});};
  const actions=(...buttons)=>{const a=el('div',undefined,'actions');a.append(...buttons);p.append(a);};
  if(id==='home'){
    const data=await snap(),stats=el('div',undefined,'stats');for(const [label,value]of [['대기 참가자',data.participationQueue?.activeCount||0],['현재 회차',data.state?.session?.round||'—'],['방송 운영',data.paused?'일시 중지':'사용 가능']]){const c=el('div',label,'stat');c.append(el('strong',String(value)));stats.append(c);}p.append(stats,el('p','왼쪽 메뉴에서 사용할 기능 하나를 선택하세요.'));actions(button('Queue 보기',()=>page('queue')),button('경기 진행',()=>page('round'),'secondary'));
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
  }else if(['ready','undo','community','studio','practice','subscriptions','fairness','recruitment','my-panel','recap','publication','guide','tickets'].includes(id)){
    const files={ready:'operation-tools.html?feature=ready',undo:'operation-tools.html?feature=undo',studio:'game-studio.html',practice:'practice.html'};p.append(el('p',id==='practice'?'가상 참가자로 연습하며 실제 방송 데이터에 반영하지 않습니다.':'현재 선택한 서버의 전용 화면에서 작업합니다.'),link(titles[id]+' 열기',scope+'/'+(files[id]||'community.html?feature='+encodeURIComponent(id))));
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
  else await page(menu.some(([,middle])=>middle.some(([,leaves])=>leaves.includes(initialPage)))?initialPage:'home');
}
$('servers').onchange=()=>selectServer().catch(e=>notice(e.message));
$('logout').onclick=()=>run(async()=>{await api('/portal/auth/logout',{});location.assign('/portal/');});
try{
  session=await api('/portal/auth/session');
  if(session.authenticated){$('account').textContent=session.user.name;$('logout').hidden=false;const data=await api('/portal/api/servers');$('servers').replaceChildren(new Option('서버 선택',''));for(const server of data.servers)if(server.botPresent)$('servers').append(new Option(server.name,server.id));
    $('panel').replaceChildren(el('h2','운영하거나 참여할 서버를 선택하세요.'),link('다른 서버에 봇 초대',data.installUrl));const target=entryServer;if(data.servers.some(s=>s.id===target&&s.botPresent)){$('servers').value=target;await selectServer(entryQuery.get('page')||'home');}
  }else if(!session.configured)notice('사용자 로그인을 준비 중입니다.');
}catch(e){notice(e.message);}
