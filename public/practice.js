import {newPractice,practiceAction} from './practice-model.js';
let state=newPractice();const $=id=>document.getElementById(id);
function render(){$('phase').textContent=state.phase;$('participants').textContent=state.participants.map(p=>`${p.name} (${p.source}) ${p.ready?'준비 완료':''}`).join(' · ');$('teams').textContent=state.teams.map((t,i)=>`팀 ${i?'B':'A'}: ${t.map(p=>p.name).join(', ')}`).join(' / ');$('log').replaceChildren(...state.log.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{try{state=practiceAction(state,b.dataset.action);$('status').textContent='연습 작업을 반영했습니다.';render();}catch(e){$('status').textContent=e.message;}});render();
