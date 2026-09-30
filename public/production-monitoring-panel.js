export function createMonitoringPanel({request,notice,document:doc=globalThis.document,clock=Date.now}) {
  let data=null,loading=false;
  const el=id=>doc.getElementById(id);
  function render(){
    const badge=el('productionMonitoringBadge');if(!badge)return;
    const fresh=data?.expiresAt>clock(),ready=data?.ready===true&&fresh;
    badge.textContent=ready?'운영 상태 정상':'운영 승인 차단';
    badge.classList.remove('deploy-pass','deploy-fail');badge.classList.add(ready?'deploy-pass':'deploy-fail');
    el('productionMonitoringSummary').textContent=data?(fresh?data.summary:'검사 결과가 없거나 만료되었습니다. 연결 검사를 실행하세요.'):'진단 정보를 확인할 수 없습니다.';
    const wait=Math.max(0,Math.ceil(((data?.nextProbeAt||0)-clock())/1000));
    el('productionMonitoringTime').textContent=data?.lastProbedAt?`최근 검사 ${new Date(data.lastProbedAt).toLocaleString('ko-KR')} · ${fresh?'2분 유효':'만료'}${wait?` · 재검사 대기 ${wait}초`:''}`:'실제 검사 전';
    el('runProductionMonitoring').disabled=loading||Boolean(data?.inFlight)||wait>0;
    el('downloadProductionMonitoring').disabled=!data;
    const checks=el('productionMonitoringChecks');checks.replaceChildren();
    for(const item of data?.checks||[]){const row=doc.createElement('p');row.textContent=`${item.status.toUpperCase()} · ${item.label} — ${item.detail}`;checks.append(row);}
    const history=el('productionMonitoringHistory');history.replaceChildren();
    for(const item of data?.history||[]){const row=doc.createElement('p');row.textContent=`${new Date(item.checkedAt).toLocaleString('ko-KR')} · ${item.results.map(r=>`${r.id}: ${r.code}${r.httpStatus?` (${r.httpStatus})`:''}`).join(' · ')}`;history.append(row);}
  }
  async function refresh(probe=false){
    if(loading)return;loading=true;render();
    try{data=await request(probe?'/api/production-monitoring/probe':'/api/production-monitoring',probe?{}:undefined);}
    catch(error){data=null;notice(error.message,true);}
    finally{loading=false;render();}
  }
  el('runProductionMonitoring')?.addEventListener('click',()=>refresh(true));
  el('downloadProductionMonitoring')?.addEventListener('click',()=>{
    if(!data)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
    const a=doc.createElement('a');a.href=url;a.download='production-monitoring.json';doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  });
  return {refresh,render};
}
