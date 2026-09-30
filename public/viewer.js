import { mountViewerCommunity } from './community-viewer.js';
import {DEFAULT_AVATAR} from './avatar.js';
const $=id=>document.getElementById(id);
let me,avatar={...DEFAULT_AVATAR},participation=null,participationClockOffset=0,participationBusy=false;
const inFlight=new Map(),uncertainKeys=new Map();
function retainUncertain(signature,key){const expiresAt=Date.now()+120000;uncertainKeys.set(signature,{key,expiresAt});setTimeout(()=>{if(uncertainKeys.get(signature)?.key===key)uncertainKeys.delete(signature)},120000);}
async function api(path,body){
 const url='/viewer/api/'+path;
 if(body===undefined){const res=await fetch(url,{cache:'no-store'}),data=await res.json().catch(()=>({error:'요청에 실패했습니다.'}));if(!res.ok)throw Error(data.error);return data}
 const signature=`${url}\n${JSON.stringify(body)}`,active=inFlight.get(signature);if(active)return active;const retained=uncertainKeys.get(signature),key=retained?.expiresAt>Date.now()?retained.key:crypto.randomUUID();let task;
 task=(async()=>{let res;try{res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me?.csrf||'','Idempotency-Key':key},body:JSON.stringify(path==='participation/action'?{...body,expectedSessionId:new URLSearchParams(location.search).get('session')||undefined}:body)});}catch(error){retainUncertain(signature,key);throw error;}let data;try{data=await res.json();}catch{retainUncertain(signature,key);throw Error('요청에 실패했습니다.');}uncertainKeys.delete(signature);if(!res.ok)throw Error(data.error);return data;})().finally(()=>{if(inFlight.get(signature)===task)inFlight.delete(signature)});inFlight.set(signature,task);return task;
}
function fields(){const host=$('fields');host.replaceChildren();for(const [key,label] of [['color','레이스 기본 색상'],['outfitColor','레이스 보조 색상']]){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='color';input.value=avatar[key];input.oninput=()=>{avatar[key]=input.value};row.append(input);host.append(row)}}
async function loadPoll(){try{const data=await api('poll'),host=$('viewerPoll'),options=$('viewerPollOptions');if(!data.poll){host.hidden=true;return;}host.hidden=false;$('viewerPollQuestion').textContent=data.poll.question;options.replaceChildren(...data.poll.options.map(option=>{const b=document.createElement('button');b.className=data.choice===option.id?'selected':'';b.textContent=`${option.label} · ${option.votes}표`;b.onclick=async()=>{try{await api('poll/vote',{pollId:data.poll.id,optionId:option.id});$('viewerPollStatus').textContent='투표를 반영했습니다.';await loadPoll();}catch(e){$('viewerPollStatus').textContent=e.message}};return b;}));}catch{if($('viewerPoll'))$('viewerPoll').hidden=true;}}
function participationNow(){return Date.now()+participationClockOffset;}
function actionButton(action,label,secondary=false){const button=document.createElement('button');button.dataset.participationAction=action;button.textContent=label;if(secondary)button.className='secondary';button.disabled=participationBusy;button.onclick=()=>runParticipationAction(action);return button;}
function renderParticipation(){
 const data=participation||{},session=data.session||null,queue=data.queue||{},entry=queue.entry||null,actions=data.actions||{};
 const requested=new URLSearchParams(location.search).get('session'),stale=requested&&requested!==session?.id;if(stale){for(const key of Object.keys(actions))actions[key]=false;}
 $('participationTitle').textContent=stale?'이 모집은 종료되었습니다. 최신 모집 링크를 이용해 주세요.':session?.title||'진행 중인 시참 없음';
 $('participationRound').textContent=session?`${session.round||1}판`:'—';
 $('participationGame').textContent=session?[session.gameLabel,session.modeLabel].filter(Boolean).join(' · '):'—';
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
 if(callActive)hint='Discord 호출 메시지와 이 화면 중 한 곳에서만 응답하면 됩니다.';
 else if(session?.confirmed)hint='참석 확인까지 완료되었습니다. 진행자의 다음 안내를 기다려 주세요.';
 else if(session?.winner&&session?.phase==='checking')hint='당첨되었습니다. 참석 확인 시간이 끝나기 전에 준비 완료를 눌러 주세요.';
 else if(session?.postponed)hint='다음 회차 예약 상태입니다. 모집 중에는 현재판으로 다시 복귀할 수 있습니다.';
 else if(session?.applicant)hint=`현재 시참에 신청되어 있습니다.${entry?.position?` 통합 Queue ${entry.position}번입니다.`:''}`;
 else if(session)hint='참가 가능한 게임 계정이 연동되어 있으면 이 화면에서 현재판에 신청할 수 있습니다.';
 $('participationHint').textContent=hint;
}
async function loadParticipation(){if(!me)return;try{const data=await api('participation');participation=data;participationClockOffset=Number(data.serverTime||Date.now())-Date.now();renderParticipation();}catch(e){$('participationStatus').textContent=e.message;}}
async function runParticipationAction(action,game){if(participationBusy)return;participationBusy=true;renderParticipation();$('participationStatus').textContent='처리 중…';try{const data=await api('participation/action',{action,...(game?{game}:{})});participation=data.state||participation;participationClockOffset=Number(participation?.serverTime||Date.now())-Date.now();const messages={join:'현재판 시참 신청을 반영했습니다.',leave:'시참 신청을 취소했습니다.',postpone_next:'다음판 예약으로 변경했습니다.',postpone_next2:'다다음판 예약으로 변경했습니다.',call_join:'참가 응답을 전송했습니다.',call_pass:'이번판 패스를 반영했습니다.',confirm:'준비 완료를 반영했습니다.',cancel_reservation:'다음판 예약을 취소했습니다.'};$('participationStatus').textContent=data.result?.advanceError?`${messages[action]||'처리했습니다.'} 다음 참가자 자동 호출은 실패해 진행자가 확인해야 합니다.`:(messages[action]||'처리했습니다.');await loadParticipation();}catch(e){$('participationStatus').textContent=e.message;await loadParticipation();}finally{participationBusy=false;renderParticipation();}}
async function load(){me=await api('me');avatar={...DEFAULT_AVATAR,...me.avatar};$('name').textContent=me.name+'의 시청자 대시보드';$('login').hidden=true;$('editor').hidden=false;fields();await Promise.all([loadPoll(),loadParticipation()]);mountViewerCommunity({api,host:$('editor')})}
$('loginButton').onclick=async()=>{try{await api('login',{code:$('code').value.trim()});$('code').value='';await load();$('status').textContent='로그인 완료'}catch(e){$('status').textContent=e.message}};
$('save').onclick=async()=>{const button=$('save');button.disabled=true;try{const saved=await api('avatar',{...avatar,revision:me.revision});me.revision=saved.revision;$('status').textContent='레이스 프로필 색상을 저장했습니다. 다음 레이스부터 반영됩니다.'}catch(e){$('status').textContent=e.message}finally{button.disabled=false}};
$('reset').onclick=()=>{avatar={...DEFAULT_AVATAR};fields();$('status').textContent='기본 색상 미리보기입니다. 저장하면 적용됩니다.'};$('logout').onclick=async()=>{try{await api('logout',{});location.reload()}catch(e){$('status').textContent=e.message}};$('participationRefresh').onclick=()=>loadParticipation();
const ctx=$('preview').getContext('2d');function roundedRect(x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill()}
function frame(){ctx.fillStyle='#e8eee0';ctx.fillRect(0,0,450,300);ctx.fillStyle='#d5e5db';ctx.fillRect(0,220,450,80);ctx.strokeStyle='#ffffff';ctx.lineWidth=4;ctx.setLineDash([22,18]);ctx.beginPath();ctx.moveTo(0,260);ctx.lineTo(450,260);ctx.stroke();ctx.setLineDash([]);ctx.save();ctx.translate(225,172);roundedRect(-92,-34,184,54,18,avatar.color);roundedRect(-54,-66,106,42,16,avatar.outfitColor);ctx.fillStyle='#172b46';ctx.beginPath();ctx.arc(-58,24,20,0,Math.PI*2);ctx.arc(58,24,20,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f8f3df';ctx.beginPath();ctx.arc(-58,24,8,0,Math.PI*2);ctx.arc(58,24,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffffaa';roundedRect(-35,-57,54,20,8,'#ffffffaa');ctx.restore();ctx.fillStyle='#315e51';ctx.font='600 13px sans-serif';ctx.textAlign='center';ctx.fillText('레이스 연출에서 참가자 색상으로 사용됩니다.',225,284);requestAnimationFrame(frame)}requestAnimationFrame(frame);load().catch(e=>{$('status').textContent=e.message});
api('mode').then(mode=>{$('demoLogin').hidden=!mode.demo}).catch(()=>{});$('demoLogin').onclick=async()=>{try{await api('demo-login',{});await load();$('status').textContent='가상 시청자 연습 모드입니다.'}catch(e){$('status').textContent=e.message}};
setInterval(()=>{if(me&&document.visibilityState==='visible'){loadPoll().catch(()=>{});loadParticipation().catch(()=>{})}},10000);setInterval(()=>{if(me)renderParticipation()},1000);addEventListener('visibilitychange',()=>{if(me&&document.visibilityState==='visible')loadParticipation().catch(()=>{})});
