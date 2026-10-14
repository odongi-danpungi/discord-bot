import { mountViewerCommunity } from './community-viewer.js';
import {DEFAULT_AVATAR} from './avatar.js';
const $=id=>document.getElementById(id);
let me,avatar={...DEFAULT_AVATAR},participation=null,participationClockOffset=0,participationBusy=false,participationLoadVersion=0;
const inFlight=new Map(),uncertainKeys=new Map();
function retainUncertain(signature,key){const expiresAt=Date.now()+120000;uncertainKeys.set(signature,{key,expiresAt});setTimeout(()=>{if(uncertainKeys.get(signature)?.key===key)uncertainKeys.delete(signature)},120000);}
async function api(path,body){
 const url='/viewer/api/'+path;
 if(body===undefined){const res=await fetch(url,{cache:'no-store'}),data=await res.json().catch(()=>({error:'요청에 실패했습니다.'}));if(!res.ok)throw Object.assign(Error(data.error),{status:res.status});return data}
 const signature=`${url}\n${JSON.stringify(body)}`,active=inFlight.get(signature);if(active)return active;const retained=uncertainKeys.get(signature),key=retained?.expiresAt>Date.now()?retained.key:crypto.randomUUID();let task;
 task=(async()=>{let res;try{res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me?.csrf||'','Idempotency-Key':key},body:JSON.stringify(body)});}catch(error){retainUncertain(signature,key);throw error;}let data;try{data=await res.json();}catch{retainUncertain(signature,key);throw Error('요청에 실패했습니다.');}uncertainKeys.delete(signature);if(!res.ok)throw Object.assign(Error(data.error),{status:res.status});return data;})().finally(()=>{if(inFlight.get(signature)===task)inFlight.delete(signature)});inFlight.set(signature,task);return task;
}
function fields(){const host=$('fields');host.replaceChildren();for(const [key,label] of [['color','레이스 기본 색상'],['outfitColor','레이스 보조 색상']]){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='color';input.value=avatar[key];input.oninput=()=>{avatar[key]=input.value};row.append(input);host.append(row)}}
async function loadPoll(){try{const data=await api('poll'),host=$('viewerPoll'),options=$('viewerPollOptions');if(!data.poll){host.hidden=true;return;}host.hidden=false;$('viewerPollQuestion').textContent=data.poll.question;options.replaceChildren(...data.poll.options.map(option=>{const b=document.createElement('button');b.className=data.choice===option.id?'selected':'';b.textContent=`${option.label} · ${option.votes}표`;b.onclick=async()=>{try{await api('poll/vote',{pollId:data.poll.id,optionId:option.id});$('viewerPollStatus').textContent='투표를 반영했습니다.';await loadPoll();}catch(e){$('viewerPollStatus').textContent=e.message}};return b;}));}catch{if($('viewerPoll'))$('viewerPoll').hidden=true;}}
function participationNow(){return Date.now()+participationClockOffset;}
function recruitmentState(data,session){
 const r=data?.recruitment,integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
 if(!r||typeof r!=='object'||Array.isArray(r)||!integer(data.serverTime)||!integer(r.activeApplicants)||!integer(r.closeAt)||!integer(r.drawCount)||typeof r.unlimited!=='boolean')return null;
 if(!session)return r.status==='inactive'&&r.reason==='no_session'&&r.maxApplicants===null&&r.activeApplicants===0&&r.remainingSlots===null&&!r.unlimited&&r.closeAt===0&&r.drawCount===0&&r.duplicatePolicy===null?r:null;
 if(!['open','closed','drawn','checking','ended'].includes(session.phase)||!['keep_existing','reject'].includes(r.duplicatePolicy)||!integer(r.maxApplicants)||r.maxApplicants>1000||r.drawCount<1||r.drawCount>50||r.drawCount!==session.count||r.closeAt!==session.closeAt)return null;
 if(r.unlimited?(r.maxApplicants!==0||r.remainingSlots!==null):(r.maxApplicants<1||!integer(r.remainingSlots)||r.remainingSlots!==Math.max(0,r.maxApplicants-r.activeApplicants)))return null;
 if(r.status==='open'&&(r.reason!==null||session.phase!=='open'||(!r.unlimited&&r.remainingSlots===0)))return null;
 if(r.status==='full'&&(r.reason!=='capacity'||session.phase!=='open'||r.unlimited||r.remainingSlots!==0))return null;
 if(r.status==='closed'&&(!['capacity','deadline','manual','progress'].includes(r.reason)||(r.reason==='progress'?!['drawn','checking','ended'].includes(session.phase):session.phase!=='closed'&&!(r.reason==='deadline'&&session.phase==='open'))))return null;
 if(!['open','full','closed'].includes(r.status))return null;
 if(session.phase==='open'&&r.closeAt&&r.closeAt<=participationNow())return {...r,status:'closed',reason:'deadline'};
 return r;
}
function participationView(){
 const data=participation||{},session=data.session||null,requested=new URLSearchParams(location.search).get('session'),stale=Boolean(requested&&requested!==session?.id),recruitment=stale?null:recruitmentState(data,session),actions={};
 for(const key of ['join','confirm','postponeNext','postponeNext2','leave','callJoin','callPass','cancelReservation'])actions[key]=Boolean(!stale&&data.actions?.[key]===true);
 actions.join=Boolean(actions.join&&session&&recruitment?.status==='open');
 if(session?.phase!=='open'||!Number.isSafeInteger(session.closeAt)||(session.closeAt&&session.closeAt<=participationNow()))for(const key of ['leave','postponeNext','postponeNext2'])actions[key]=false;
 const callDeadline=data.queue?.entry?.callDeadline;
 if(!Number.isFinite(callDeadline)||callDeadline<=participationNow())actions.callJoin=actions.callPass=false;
 if(session&&data.queue?.entry?.sessionId===session.id&&(session.phase!=='open'||(session.closeAt&&session.closeAt<=participationNow())))actions.callPass=false;
 if(!Number.isFinite(session?.deadline)||session.deadline<=participationNow())actions.confirm=false;
 return {data,session,stale,recruitment,actions};
}
function renderRecruitment({session,stale,recruitment:r}){
 let state=stale?'stale':r?.status||'unknown',status='확인 필요',remaining='모집 상태를 확인할 수 없습니다.',detail='',deadline='';
 if(stale){status='지난 모집';remaining='최신 모집 링크를 이용해 주세요.';}
 else if(r?.status==='inactive'){status='모집 전';remaining='진행 중인 모집이 없습니다.';}
 else if(r){
  status={open:'접수 중',full:'정원 도달',closed:'접수 마감'}[r.status];
  remaining=r.status==='open'?(r.unlimited?'인원 제한 없음':`남은 자리 ${r.remainingSlots}명`):r.reason==='capacity'?'정원이 가득 찼습니다.':r.reason==='deadline'?'접수 시간이 종료되었습니다.':r.reason==='progress'?(session.phase==='ended'?'모집이 종료되었습니다.':'추첨·참석 확인이 진행 중입니다.'):'운영자가 접수를 마감했습니다.';
  detail=`현재 접수 ${r.activeApplicants}명 · ${r.unlimited?'정원 제한 없음':`최대 ${r.maxApplicants}명`} · 추첨 인원 ${r.drawCount}명`;
  if(r.status!=='closed'){if(r.closeAt){const seconds=Math.max(0,Math.ceil((r.closeAt-participationNow())/1000));deadline=seconds>0?`접수 마감까지 ${Math.floor(seconds/60)}분 ${seconds%60}초`:'접수 마감 시간 경과';}else deadline='접수 마감 시간 제한 없음';}else if(r.reason==='deadline')deadline='접수 마감 시간 경과';
 }
 $('recruitmentSummary').dataset.state=state;$('recruitmentStatus').textContent=status;$('recruitmentRemaining').textContent=remaining;$('recruitmentDetail').textContent=detail;$('recruitmentDeadline').textContent=deadline;
}
function actionButton(action,label,secondary=false){const button=document.createElement('button');button.dataset.participationAction=action;button.textContent=label;if(secondary)button.className='secondary';button.disabled=participationBusy;button.onclick=()=>runParticipationAction(action);return button;}
function renderParticipation(){
 const view=participationView(),{data,session,stale,actions}=view,queue=data.queue||{},entry=queue.entry||null;renderRecruitment(view);
 $('participationTitle').textContent=stale?'이 모집은 종료되었습니다. 최신 모집 링크를 이용해 주세요.':session?.title||'진행 중인 시참 없음';
 $('participationRound').textContent=session&&!stale?`${session.round||1}판`:'—';
 $('participationGame').textContent=session&&!stale?[session.gameLabel,session.modeLabel].filter(Boolean).join(' · '):'—';
 $('participationState').textContent=entry?.statusLabel||(session?.confirmed?'참석 완료':session?.winner?'당첨':session?.postponed?'예약됨':session?.applicant?'신청됨':'미신청');
 $('participationPosition').textContent=entry?.position?`${entry.position}번`:'—';
 const callActive=Boolean(actions.callJoin||actions.callPass);$('participationCall').hidden=!callActive;
 const deadline=Number(entry?.callDeadline)||0;if(callActive&&deadline){const seconds=Math.max(0,Math.ceil((deadline-participationNow())/1000));$('participationCallTimer').textContent=`${seconds}초 안에 응답해 주세요.`;}else $('participationCallTimer').textContent='응답 시간을 확인 중입니다.';
 document.querySelectorAll('[data-participation-action="call_join"],[data-participation-action="call_pass"]').forEach(button=>{const key=button.dataset.participationAction==='call_join'?'callJoin':'callPass';button.disabled=participationBusy||!actions[key];});
 const host=$('participationActions'),buttons=[];
 if(actions.join)buttons.push(actionButton('join',session?.postponed?'↩ 현재판으로 복귀':'⚔️ 현재판 참가'));
 if(actions.confirm)buttons.push(actionButton('confirm','✓ 준비 완료'));
 if(actions.postponeNext)buttons.push(actionButton('postpone_next','⏭ 다음판으로 미루기',true));
 if(actions.postponeNext2)buttons.push(actionButton('postpone_next2','⏩ 다다음판으로 미루기',true));
 if(actions.leave)buttons.push(actionButton('leave','신청 취소',true));
 host.replaceChildren(...buttons);
 const reservations=$('participationReservations'),rows=(data.reservations||[]).map(item=>{const row=document.createElement('div');row.className='reservation-row';const text=document.createElement('span');text.textContent=`${item.game==='er'?'이터널 리턴':'리그 오브 레전드'} ${item.round}판 예약`;const button=document.createElement('button');button.className='secondary compact';button.textContent='예약 취소';button.disabled=participationBusy||!actions.cancelReservation;button.onclick=()=>runParticipationAction('cancel_reservation',item.game);row.append(text,button);return row;});reservations.replaceChildren(...rows);
 let hint='진행 중인 모집이 없습니다.';
 if(callActive)hint=actions.callJoin&&!actions.callPass&&entry?.sessionId===session?.id?'모집 마감 후 패스 예약 변경은 진행자에게 요청해 주세요. 참가 응답은 아래 버튼으로 보낼 수 있습니다.':'Discord 호출 메시지와 이 화면 중 한 곳에서만 응답하면 됩니다.';
 else if(session?.confirmed)hint='참석 확인까지 완료되었습니다. 진행자의 다음 안내를 기다려 주세요.';
 else if(session?.winner&&session?.phase==='checking')hint='당첨되었습니다. 참석 확인 시간이 끝나기 전에 준비 완료를 눌러 주세요.';
 else if(session?.postponed)hint=actions.join?'다음 회차 예약 상태입니다. 현재판으로 다시 복귀할 수 있습니다.':'다음 회차 예약 상태입니다. 현재판에 참가 가능한 자리가 생기고 접수 중일 때 복귀할 수 있습니다.';
 else if(session?.applicant)hint=`현재 시참에 신청되어 있습니다.${entry?.position?` 통합 Queue ${entry.position}번입니다.`:''}`;
 else if(stale)hint='이 모집은 종료되었습니다. 진행자가 공유한 최신 모집 링크로 다시 접속해 주세요.';
 else if(!view.recruitment)hint='접수 상태를 확인할 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.';
 else if(view.recruitment.status==='full')hint='현재 모집 정원이 가득 찼습니다. 자리가 생기거나 다음 모집이 열릴 때 다시 확인해 주세요.';
 else if(view.recruitment.status==='closed')hint=view.recruitment.reason==='capacity'?'정원이 가득 차 접수가 마감되었습니다. 진행자의 다음 모집 안내를 기다려 주세요.':view.recruitment.reason==='deadline'?'접수 시간이 종료되었습니다. 진행자의 다음 모집 안내를 기다려 주세요.':view.recruitment.reason==='manual'?'운영자가 접수를 마감했습니다. 진행자의 다음 안내를 기다려 주세요.':session?.phase==='ended'?'이번 모집이 종료되었습니다. 다음 모집을 기다려 주세요.':'추첨·참석 확인이 진행 중입니다. 다음 모집을 기다려 주세요.';
 else if(view.recruitment.status==='open')hint=actions.join?'현재판 참가 버튼으로 신청할 수 있습니다.':'현재 계정에서 참가 가능한 상태인지 게임 계정 연동과 진행자의 안내를 확인해 주세요.';
 $('participationHint').textContent=hint;
}
let readyCheck=null;
function clearReadyCheck(){readyCheck=null;$("participantReady").hidden=true;$("participantReadyAnswer").disabled=true;$("participantReadyStatus").textContent='';}
async function loadReadyCheck(version=participationLoadVersion,viewer=me){try{const data=await api("ready-check");if(viewer!==me||version!==participationLoadVersion)return;const c=data.check;if(participationView().stale||!c||!Array.isArray(c.participants)||!c.participants.length){clearReadyCheck();return;}readyCheck=c;$("participantReady").hidden=false;$("participantReadyStatus").textContent=c.stale?"참가자 구성이 변경됐습니다.":c.expired?"준비 확인이 만료됐습니다.":c.closed?"준비 확인이 종료됐습니다.":c.participants[0]?.readyAt?"준비 완료를 반영했습니다.":"준비가 되면 아래 버튼을 눌러 주세요.";$("participantReadyAnswer").disabled=c.stale||c.expired||c.closed||Boolean(c.participants[0]?.readyAt);}catch{if(viewer===me&&version===participationLoadVersion)clearReadyCheck();}}
$("participantReadyAnswer").onclick=async()=>{if(!me||!readyCheck||$("participantReadyAnswer").disabled||participationView().stale)return;$("participantReadyAnswer").disabled=true;try{await api("ready-check",{checkId:readyCheck.id});await loadReadyCheck();}catch(e){$("participantReadyStatus").textContent=e.message;}};
function setParticipationClock(data){participationClockOffset=Number.isSafeInteger(data?.serverTime)?data.serverTime-Date.now():0;}
async function loadParticipation(force=false){if(!me||(participationBusy&&!force))return;const viewer=me,version=++participationLoadVersion;try{const data=await api('participation');if(viewer!==me||version!==participationLoadVersion)return;participation=data;setParticipationClock(data);renderParticipation();await loadReadyCheck(version,viewer);}catch(e){if(viewer!==me||version!==participationLoadVersion)return;participation=null;participationClockOffset=0;clearReadyCheck();renderParticipation();$('participationStatus').textContent='시참 상태를 불러오지 못했습니다. 새로고침해 주세요.';if(e.status===401||e.status===403){me=null;$('name').textContent='';$('editor').hidden=true;$('login').hidden=false;$('status').textContent='로그인 상태를 다시 확인해 주세요.';}}}
async function runParticipationAction(action,game){
 if(!me||participationBusy)return;
 const keys={join:'join',leave:'leave',postpone_next:'postponeNext',postpone_next2:'postponeNext2',call_join:'callJoin',call_pass:'callPass',confirm:'confirm',cancel_reservation:'cancelReservation'},view=participationView();
 if(!view.actions[keys[action]]){renderParticipation();$('participationStatus').textContent='현재 상태에서는 이 작업을 할 수 없습니다. 새로고침해 주세요.';return;}
 const viewer=me,expectedSessionId=new URLSearchParams(location.search).get('session')||view.session?.id||undefined;
 participationBusy=true;++participationLoadVersion;clearReadyCheck();renderParticipation();$('participationStatus').textContent='처리 중…';
 try{const data=await api('participation/action',{action,...(game?{game}:{}),expectedSessionId});if(viewer!==me)return;participation=data.state||null;setParticipationClock(participation);const messages={join:'현재판 시참 신청을 반영했습니다.',leave:'시참 신청을 취소했습니다.',postpone_next:'다음판 예약으로 변경했습니다.',postpone_next2:'다다음판 예약으로 변경했습니다.',call_join:'참가 응답을 전송했습니다.',call_pass:'이번판 패스를 반영했습니다.',confirm:'준비 완료를 반영했습니다.',cancel_reservation:'다음판 예약을 취소했습니다.'};$('participationStatus').textContent=data.result?.advanceError?`${messages[action]||'처리했습니다.'} 다음 참가자 자동 호출은 실패해 진행자가 확인해야 합니다.`:(messages[action]||'처리했습니다.');await loadParticipation(true);}catch(e){if(viewer!==me)return;$('participationStatus').textContent=e.message;await loadParticipation(true);}finally{participationBusy=false;renderParticipation();}
}
async function load(){++participationLoadVersion;me=null;participation=null;participationClockOffset=0;clearReadyCheck();renderParticipation();$('editor').hidden=true;$('login').hidden=false;me=await api('me');avatar={...DEFAULT_AVATAR,...me.avatar};$('name').textContent=me.name+'의 시청자 대시보드';$('login').hidden=true;$('editor').hidden=false;fields();await Promise.all([loadPoll(),loadParticipation()]);if(me)mountViewerCommunity({api,host:$('editor')})}
$('loginButton').onclick=async()=>{try{await api('login',{code:$('code').value.trim()});$('code').value='';await load();$('status').textContent='로그인 완료'}catch(e){$('status').textContent=e.message}};
$('save').onclick=async()=>{const button=$('save');button.disabled=true;try{const saved=await api('avatar',{...avatar,revision:me.revision});me.revision=saved.revision;$('status').textContent='레이스 프로필 색상을 저장했습니다. 다음 레이스부터 반영됩니다.'}catch(e){$('status').textContent=e.message}finally{button.disabled=false}};
$('reset').onclick=()=>{avatar={...DEFAULT_AVATAR};fields();$('status').textContent='기본 색상 미리보기입니다. 저장하면 적용됩니다.'};$('logout').onclick=async()=>{try{await api('logout',{});location.reload()}catch(e){$('status').textContent=e.message}};$('participationRefresh').onclick=()=>loadParticipation();
const ctx=$('preview').getContext('2d');function roundedRect(x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill()}
function frame(){ctx.fillStyle='#e8eee0';ctx.fillRect(0,0,450,300);ctx.fillStyle='#d5e5db';ctx.fillRect(0,220,450,80);ctx.strokeStyle='#ffffff';ctx.lineWidth=4;ctx.setLineDash([22,18]);ctx.beginPath();ctx.moveTo(0,260);ctx.lineTo(450,260);ctx.stroke();ctx.setLineDash([]);ctx.save();ctx.translate(225,172);roundedRect(-92,-34,184,54,18,avatar.color);roundedRect(-54,-66,106,42,16,avatar.outfitColor);ctx.fillStyle='#172b46';ctx.beginPath();ctx.arc(-58,24,20,0,Math.PI*2);ctx.arc(58,24,20,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f8f3df';ctx.beginPath();ctx.arc(-58,24,8,0,Math.PI*2);ctx.arc(58,24,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffffaa';roundedRect(-35,-57,54,20,8,'#ffffffaa');ctx.restore();ctx.fillStyle='#315e51';ctx.font='600 13px sans-serif';ctx.textAlign='center';ctx.fillText('레이스 연출에서 참가자 색상으로 사용됩니다.',225,284);requestAnimationFrame(frame)}requestAnimationFrame(frame);load().catch(e=>{$('status').textContent=e.message});
api('mode').then(mode=>{$('demoLogin').hidden=!mode.demo}).catch(()=>{});$('demoLogin').onclick=async()=>{try{await api('demo-login',{});await load();$('status').textContent='가상 시청자 연습 모드입니다.'}catch(e){$('status').textContent=e.message}};
setInterval(()=>{if(me&&document.visibilityState==='visible'){loadPoll().catch(()=>{});loadParticipation().catch(()=>{})}},10000);setInterval(()=>{if(me)renderParticipation()},1000);addEventListener('visibilitychange',()=>{if(me&&document.visibilityState==='visible')loadParticipation().catch(()=>{})});
