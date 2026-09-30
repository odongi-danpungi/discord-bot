import { confirmHighRiskAction, markDirtyGroupClean, registerDirtyGroup } from './dashboard-navigation-safety-v415.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let csrf='',status=null,monitor=null,participation=null,busy=false;

function notice(message,error=false){const el=$('notice');if(!el)return;el.textContent=message;el.classList.toggle('error',error);}
async function json(response){let data;try{data=await response.json();}catch{throw Error('서버 응답을 읽지 못했습니다.');}if(!response.ok)throw Object.assign(Error(data.error||'요청에 실패했습니다.'),{status:response.status,data});return data;}
async function get(path){return json(await fetch(path,{method:'GET'}));}
async function post(path,body={}){if(!csrf){const snap=await get('/api/snapshot');csrf=snap.csrf||'';}return json(await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)}));}
function cap(value){return value?'가능':'미지원';}
function fmtTime(value){return value?new Date(value).toLocaleString('ko-KR'):'—';}
function monitorStatusLabel(value){return ({idle:'대기',pass:'정상',warn:'주의',fail:'오류'})[value]||'대기';}
function renderMonitor(){
 if(!$('naverMonitorBadge'))return;
 const m=monitor||{settings:{enabled:false,query:'',cafeUrl:'',intervalMinutes:5,discordAlerts:true},state:{lastStatus:'idle'},events:[],seenCount:0},settings=m.settings||{},state=m.state||{};
 $('naverMonitorBadge').textContent=settings.enabled?monitorStatusLabel(state.lastStatus):'꺼짐';
 $('naverMonitorState').textContent=settings.enabled?'ON':'OFF';
 $('naverMonitorNext').textContent=settings.enabled&&state.nextRunAt?`다음 ${fmtTime(state.nextRunAt)}`:'자동 점검 중지';
 $('naverMonitorLastRun').textContent=state.lastRunAt?fmtTime(state.lastRunAt):'미실행';
 $('naverMonitorLastResult').textContent=state.lastError?state.lastError:`검색 ${Number(state.lastFound)||0}건 · 알림 ${Number(state.lastNotified)||0}건`;
 $('naverMonitorSeen').textContent=String(Number(m.seenCount)||0);
 $('naverMonitorDiscord').textContent=settings.discordAlerts?'ON':'OFF';
 if(document.activeElement!==$('naverMonitorQuery'))$('naverMonitorQuery').value=settings.query||'';
 if(document.activeElement!==$('naverMonitorCafeUrl'))$('naverMonitorCafeUrl').value=settings.cafeUrl||'';
 $('naverMonitorInterval').value=String(settings.intervalMinutes||5);$('naverMonitorEnabled').checked=Boolean(settings.enabled);$('naverMonitorDiscordAlerts').checked=settings.discordAlerts!==false;
 $('naverMonitorSave').disabled=busy;$('naverMonitorRun').disabled=busy||!status?.capabilities?.publicCafeSearch;
 const events=m.events||[];$('naverMonitorEvents').innerHTML=events.length?events.slice(0,30).map(event=>{const retry=['failed','uncertain'].includes(event.status);return `<div class="audit-row"><div><strong>${esc(event.title||'새 네이버 카페글')}</strong><small>${esc(event.cafeName||'네이버 카페')} · ${fmtTime(event.detectedAt)} · ${esc(event.status)}</small>${event.error?`<p>${esc(event.error)}</p>`:''}<div class="button-row">${event.link?`<a class="button secondary" href="${esc(event.link)}" target="_blank" rel="noopener">원문 열기 ↗</a>`:''}${retry?`<button class="secondary" data-naver-monitor-retry="${esc(event.id)}">Discord 재전송</button>`:''}</div></div></div>`;}).join(''):'<p class="empty">감지된 새 공개글이 없습니다.</p>';
}
function renderParticipation(){
 if(!$('naverParticipationBadge'))return;
 const p=participation||{publication:null,session:null,entries:[],counts:{queued:0,cancelled:0},nextOrder:1,registrationOpen:false,commentManualText:'칼바람 시참'},pub=p.publication,session=p.session,entries=p.entries||[],isOpen=session?.status==='open';
 const badge=pub?.status==='pending'?'게시 중':pub?.status==='uncertain'?'게시 결과 미확정':pub?.status==='failed'?'게시 실패':isOpen?'접수 중':session?.status==='closed'?'마감됨':'대기';
 $('naverParticipationBadge').textContent=badge;
 $('naverParticipationState').textContent=session?(isOpen?'OPEN':'CLOSED'):pub?.status?.toUpperCase?.()||'READY';
 $('naverParticipationCount').textContent=String(Number(p.counts?.queued)||0);
 $('naverParticipationNext').textContent=String(Number(p.nextOrder)||1);
 if(document.activeElement!==$('naverMemoMenuId')&&!$('naverMemoMenuId').value){$('naverMemoMenuId').value=status?.memoMenuId||status?.menuId||'';}
 $('naverParticipationOpen').disabled=busy||!status?.connected||Boolean(session)||Boolean(pub&&['pending','uncertain'].includes(pub.status));
 $('naverParticipationRegister').disabled=busy||!isOpen;
 $('naverParticipationManualComment').disabled=busy||!session?.articleUrl;
 $('naverParticipationClose').disabled=busy||!isOpen;
 $('naverParticipationReset').disabled=busy||(!session&&!pub);
 const active=entries.filter(entry=>entry.status==='queued').sort((a,b)=>a.order-b.order),select=$('naverParticipationCancelSelect'),previous=select?.value||'';
 if(select){select.innerHTML=active.length?active.map(entry=>`<option value="${esc(entry.id)}">${entry.order}번 · ${esc(entry.displayName)}</option>`).join(''):'<option value="">등록된 참가자 없음</option>';if(active.some(entry=>entry.id===previous))select.value=previous;select.disabled=busy||!isOpen||!active.length;}
 $('naverParticipationCancel').disabled=busy||!isOpen||!active.length;
 $('naverParticipationArticle').innerHTML=session?.articleUrl?`<a href="${esc(session.articleUrl)}" target="_blank" rel="noopener">메모글 #${esc(session.articleId||'')} 열기 ↗</a>`:'메모글 없음';
 $('naverParticipationPublication').textContent=pub?.error?`${badge} · ${pub.error}`:isOpen?`서버 봇이 ${fmtTime(session.openedAt)}에 ‘칼바람 시참’을 입력했습니다. 참가 등록 버튼 도착 순서대로 번호를 저장합니다.`:session?.status==='closed'?`접수 마감 ${fmtTime(session.closedAt)} · 대기 ${Number(p.counts?.queued)||0}명 · 초기화 전까지 목록을 보존합니다.`:'‘칼바람 시참 열기’를 누르면 서버 봇이 메모 게시판에 글을 입력하고 접수를 시작합니다.';
 const sorted=[...entries].sort((a,b)=>a.order-b.order);
 $('naverParticipationList').innerHTML=sorted.length?sorted.map(entry=>`<div class="audit-row"><div><strong>${entry.order}번 · ${esc(entry.displayName)}</strong><small>${fmtTime(entry.registeredAt)} · ${entry.status==='queued'?(isOpen?'대기':'마감 확정'):'취소'}</small>${entry.status==='queued'&&isOpen?`<div class="button-row"><button class="secondary" data-naver-participation-cancel="${esc(entry.id)}">참가 취소</button></div>`:''}</div></div>`).join(''):'<p class="empty">현재 등록된 순번이 없습니다.</p>';
}
async function refreshMonitor(){try{monitor=await get('/api/naver/monitor');renderMonitor();}catch(error){notice(error.message,true);}}
function render(){
 if(!$('naverStatusBadge'))return;
 const s=status||{configured:false,oauthConfigured:false,connected:false,capabilities:{},limitations:[]};
 $('naverStatusBadge').textContent=s.connected?'연동됨':s.configured?'설정됨 · 미연동':'설정 필요';
 $('naverConfigured').textContent=s.configured?'완료':'미설정';$('naverConnected').textContent=s.connected?'연결됨':'미연결';
 $('naverTokenExpiry').textContent=s.connected&&s.expiresAt?`Access Token ${new Date(s.expiresAt).toLocaleString('ko-KR')} 만료`:'계정 연동 상태';
 $('naverCafeIdView').textContent=s.cafeId||'미설정';$('naverMenuIdView').textContent=s.menuId||'미설정';
 if(!$('naverCafeId').value&&s.cafeId)$('naverCafeId').value=s.cafeId;if(!$('naverMenuId').value&&s.menuId)$('naverMenuId').value=s.menuId;
 $('naverConnect').disabled=busy||!s.oauthConfigured;$('naverDisconnect').disabled=busy||!s.connected;$('naverProfile').disabled=busy||!s.connected;$('naverJoinCafe').disabled=busy||!s.capabilities?.cafeJoin;$('naverWriteArticle').disabled=busy||!s.capabilities?.articleWrite;$('naverSearch').disabled=busy||!s.capabilities?.publicCafeSearch;
 $('naverWriteBadge').textContent=s.capabilities?.articleWrite?'글쓰기 가능':s.connected?'카페/게시판 설정 필요':'연동 필요';
 const limits=s.officialLimits||{};const items=[`공개 카페글 검색: ${cap(s.capabilities?.publicCafeSearch)}${limits.searchPerDay?` · ${limits.searchPerDay.toLocaleString()}회/일`:''}`,`카페 가입: ${cap(s.capabilities?.cafeJoin)}${limits.joinPerAccountPerDay?` · 계정당 ${limits.joinPerAccountPerDay}회/일`:''}`,`게시글 작성: ${cap(s.capabilities?.articleWrite)}${limits.writePerAccountPerDay?` · 계정당 ${limits.writePerAccountPerDay}회/일`:''}`,...(s.limitations||[])];
 $('naverLimitations').innerHTML=items.map(x=>`<p>${esc(x)}</p>`).join('');
 renderMonitor();renderParticipation();
}
async function refresh(){try{[status,monitor,participation]=await Promise.all([get('/api/naver/status'),get('/api/naver/monitor'),get('/api/naver/participation')]);render();renderMonitor();renderParticipation();}catch(error){notice(error.message,true);}}
async function withBusy(fn){if(busy)return;busy=true;render();try{await fn();}catch(error){notice(error.message,true);}finally{busy=false;render();}}

registerDirtyGroup({id:'naver-monitor',label:'네이버 공개글 모니터 설정',tab:'navermonitor',inputs:['naverMonitorQuery','naverMonitorInterval','naverMonitorCafeUrl','naverMonitorEnabled','naverMonitorDiscordAlerts']});
registerDirtyGroup({id:'naver-article-draft',label:'네이버 카페 게시글 초안',tab:'naverwrite',inputs:['naverCafeId','naverMenuId','naverArticleSubject','naverArticleContent']});

$('naverRefresh')?.addEventListener('click',refresh);
$('naverConnect')?.addEventListener('click',()=>withBusy(async()=>{
 const popup=window.open('about:blank','naverOAuth','width=560,height=720');const data=await post('/api/naver/oauth/start');
 if(popup)popup.location.href=data.url;else{const a=document.createElement('a');a.href=data.url;a.target='_blank';a.rel='noopener';a.textContent='네이버 로그인 열기';$('naverLimitations').prepend(a);}
 notice('네이버 로그인 창에서 연동을 완료한 뒤 상태 새로고침을 눌러 주세요.');
}));
$('naverDisconnect')?.addEventListener('click',()=>withBusy(async()=>{if(!confirmHighRiskAction('네이버 연동 토큰을 폐기하고 연결을 해제할까요?'))return;status=await post('/api/naver/disconnect');$('naverProfileText').textContent='연동 해제됨';notice('네이버 계정 연동을 해제했습니다.');}));
$('naverProfile')?.addEventListener('click',()=>withBusy(async()=>{const p=await get('/api/naver/profile');$('naverProfileText').textContent=`${p.nickname||p.name||'네이버 사용자'} · ID ${p.id||'비공개'}`;notice('네이버 연동 계정을 확인했습니다.');}));
$('naverSearch')?.addEventListener('click',()=>withBusy(async()=>{const q=$('naverSearchQuery').value.trim();if(!q)throw Error('검색어를 입력해 주세요.');const data=await get(`/api/naver/search?q=${encodeURIComponent(q)}&display=10&sort=date`);$('naverSearchResults').innerHTML=data.items?.length?data.items.map(item=>`<div class="audit-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.cafeName||'네이버 카페')}</small><p>${esc(item.description||'')}</p>${item.link?`<a class="button secondary" href="${esc(item.link)}" target="_blank" rel="noopener">원문 열기 ↗</a>`:''}</div></div>`).join(''):'<p class="empty">검색 결과가 없습니다.</p>';notice(`카페글 검색 결과 ${data.items?.length||0}건을 불러왔습니다.`);}));
$('naverJoinCafe')?.addEventListener('click',()=>withBusy(async()=>{const cafeId=$('naverCafeId').value.trim(),nickname=$('naverNickname').value.trim();if(!confirm(`카페 ${cafeId||status?.cafeId||''} 가입 요청을 보낼까요?`))return;await post('/api/naver/join',{cafeId,nickname});notice('네이버 카페 가입 요청이 완료되었습니다.');}));
$('naverWriteArticle')?.addEventListener('click',()=>withBusy(async()=>{const cafeId=$('naverCafeId').value.trim(),menuId=$('naverMenuId').value.trim(),subject=$('naverArticleSubject').value.trim(),content=$('naverArticleContent').value.trim();if(!subject||!content)throw Error('제목과 내용을 입력해 주세요.');if(!confirmHighRiskAction('입력한 내용을 실제 네이버 카페에 게시할까요?'))return;const result=await post('/api/naver/articles',{cafeId,menuId,subject,content});$('naverWriteResult').innerHTML=result.articleUrl?`게시 완료 · <a href="${esc(result.articleUrl)}" target="_blank" rel="noopener">작성 글 열기 ↗</a>`:'게시가 완료되었습니다.';markDirtyGroupClean('naver-article-draft');notice('네이버 카페 게시글을 작성했습니다.');}));
$('naverParticipationOpen')?.addEventListener('click',()=>withBusy(async()=>{const cafeId=$('naverCafeId').value.trim()||status?.cafeId||'',menuId=$('naverMemoMenuId').value.trim()||status?.memoMenuId||status?.menuId||'';if(!/^\d+$/.test(cafeId)||!/^\d+$/.test(menuId))throw Error('카페 ID와 메모 게시판 ID를 입력해 주세요.');if(!confirm(`메모 게시판 ${menuId}에 서버 봇이 ‘칼바람 시참’을 입력하고 접수를 열까요?`))return;participation=await post('/api/naver/participation/session',{cafeId,menuId});notice('서버 봇이 ‘칼바람 시참’을 게시하고 접수를 열었습니다.');}));
$('naverParticipationRegister')?.addEventListener('click',()=>withBusy(async()=>{const displayName=$('naverParticipationName').value.trim();if(!displayName)throw Error('신청자 이름을 입력해 주세요.');const result=await post('/api/naver/participation/register',{displayName});participation=result.summary;$('naverParticipationName').value='';notice(`서버 봇이 ${result.entry.order}번 · ${result.entry.displayName}으로 입력했습니다.`);}));
$('naverParticipationName')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('naverParticipationRegister')?.click();}});
async function cancelParticipation(entryId){if(!entryId)throw Error('취소할 참가자를 선택해 주세요.');participation=await post('/api/naver/participation/cancel',{entryId});notice('서버 봇이 해당 참가자를 취소 처리했습니다.');}
$('naverParticipationCancel')?.addEventListener('click',()=>withBusy(async()=>cancelParticipation($('naverParticipationCancelSelect').value)));
$('naverParticipationList')?.addEventListener('click',event=>{const button=event.target.closest?.('[data-naver-participation-cancel]');if(!button)return;withBusy(async()=>cancelParticipation(button.dataset.naverParticipationCancel));});
$('naverParticipationClose')?.addEventListener('click',()=>withBusy(async()=>{if(!confirm('현재 칼바람 시참 접수를 마감할까요? 마감 후에는 등록·취소가 잠깁니다.'))return;participation=await post('/api/naver/participation/close');notice('칼바람 시참 접수를 마감했습니다.');}));
$('naverParticipationManualComment')?.addEventListener('click',async()=>{const url=participation?.session?.articleUrl;if(!url)return notice('먼저 칼바람 시참 메모글을 만들어 주세요.',true);let copied=false;try{await navigator.clipboard.writeText(participation?.commentManualText||'칼바람 시참');copied=true;}catch{}window.open(url,'_blank','noopener');notice(copied?'메모글을 열고 댓글 문구 ‘칼바람 시참’을 복사했습니다. 댓글은 네이버에서 직접 등록해 주세요.':'메모글을 열었습니다. 댓글은 네이버에서 직접 등록해 주세요.');});
$('naverParticipationReset')?.addEventListener('click',()=>withBusy(async()=>{if(!confirm('현재 칼바람 시참 세션과 순번을 초기화할까요? 현재 목록은 최근 이력에 보존됩니다.'))return;participation=await post('/api/naver/participation/reset');notice('칼바람 시참 세션을 초기화했습니다.');}));
$('naverMonitorSave')?.addEventListener('click',()=>withBusy(async()=>{const payload={enabled:$('naverMonitorEnabled').checked,query:$('naverMonitorQuery').value.trim(),cafeUrl:$('naverMonitorCafeUrl').value.trim(),intervalMinutes:Number($('naverMonitorInterval').value)||5,discordAlerts:$('naverMonitorDiscordAlerts').checked};monitor=await post('/api/naver/monitor/settings',payload);renderMonitor();markDirtyGroupClean('naver-monitor');notice('네이버 공개글 모니터 설정을 저장했습니다.');}));
$('naverMonitorRun')?.addEventListener('click',()=>withBusy(async()=>{const result=await post('/api/naver/monitor/run');monitor=result.summary||await get('/api/naver/monitor');renderMonitor();notice(result.bootstrapped?'현재 공개글을 기준선으로 저장했습니다. 다음 새 글부터 알립니다.':`점검 완료 · 신규 ${result.newCount||0}건 · Discord 알림 ${result.notified||0}건`);}));
$('naverMonitorEvents')?.addEventListener('click',event=>{const button=event.target.closest?.('[data-naver-monitor-retry]');if(!button)return;withBusy(async()=>{await post('/api/naver/monitor/retry',{eventId:button.dataset.naverMonitorRetry});await refreshMonitor();notice('Discord 알림 재전송을 완료했습니다.');});});

(async()=>{try{const snapshot=await get('/api/snapshot');csrf=snapshot.csrf||'';}catch{}await refresh();markDirtyGroupClean('naver-monitor');markDirtyGroupClean('naver-article-draft');})();
