const groups=new Map();
let onChange=()=>{};

function readControl(el){
  if(!el)return null;
  if(el.type==='checkbox'||el.type==='radio')return Boolean(el.checked);
  return String(el.value??'');
}
function snapshot(ids){return JSON.stringify(ids.map(id=>[id,readControl(document.getElementById(id))]));}
function update(group){
  if(!group)return false;
  group.dirty=snapshot(group.inputs)!==group.baseline;
  onChange(getDirtyState());
  return group.dirty;
}
export function registerDirtyGroup({id,label,tab,inputs=[]}={}){
  if(!id||groups.has(id))return groups.get(id)||null;
  const valid=inputs.filter(inputId=>document.getElementById(inputId));
  const group={id,label:label||id,tab:tab||'',inputs:valid,baseline:snapshot(valid),dirty:false};
  const handler=()=>update(group);
  for(const inputId of valid){const el=document.getElementById(inputId);el?.addEventListener('input',handler);el?.addEventListener('change',handler);}
  groups.set(id,group);onChange(getDirtyState());return group;
}
export function markDirtyGroupClean(id){const group=groups.get(id);if(!group)return;group.baseline=snapshot(group.inputs);group.dirty=false;onChange(getDirtyState());}
export function refreshDirtyGroupBaseline(id){markDirtyGroupClean(id);}
export function dirtyGroups(tab=''){return [...groups.values()].filter(group=>group.dirty&&(!tab||group.tab===tab));}
export function getDirtyState(){const items=dirtyGroups();return {dirty:items.length>0,count:items.length,groups:items.map(({id,label,tab})=>({id,label,tab}))};}
export function setDirtyStateListener(listener){onChange=typeof listener==='function'?listener:()=>{};onChange(getDirtyState());}
export function confirmDashboardNavigation({fromTab='',toTab='',confirmFn=window.confirm}={}){
  if(!toTab||fromTab===toTab)return true;
  const items=dirtyGroups(fromTab);if(!items.length)return true;
  const names=items.map(item=>`• ${item.label}`).join('\n');
  return confirmFn(`저장하지 않은 변경사항이 있습니다.\n\n${names}\n\n다른 화면으로 이동할까요? 변경 내용은 저장되지 않은 상태로 유지되며, 새로고침하거나 창을 닫으면 사라집니다.`);
}
export function confirmHighRiskAction(message,{confirmFn=window.confirm}={}){
  return confirmFn(`주의가 필요한 작업입니다.\n\n${String(message||'이 작업을 실행할까요?')}\n\n현재 상태와 대상이 맞는지 확인한 뒤 진행하세요.`);
}
export function installBeforeUnloadGuard(){
  window.addEventListener('beforeunload',event=>{if(!dirtyGroups().length)return;event.preventDefault();event.returnValue='';});
}
