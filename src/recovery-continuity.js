const HOUR=60*60*1000;
const DAY=24*HOUR;
const statusRank={pass:0,warn:1,fail:2};
const worst=(...values)=>values.reduce((current,value)=>statusRank[value]>statusRank[current]?value:current,'pass');
const finite=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const clamp=(value,min,max,fallback)=>Math.max(min,Math.min(max,finite(value,fallback)));

export function recoveryPolicy(config={}){
  return {
    rpoHours:clamp(config.recoveryRpoHours,1,168,24),
    drillIntervalDays:clamp(config.recoveryDrillIntervalDays,1,90,7),
    retryHours:clamp(config.recoveryDrillRetryHours,1,24,6),
    autoDrill:config.recoveryDrillAuto!==false
  };
}

export function assessRecoveryContinuity({backup=null,drills=[],config={},now=Date.now()}={}){
  const policy=recoveryPolicy(config),latestValid=backup?.latestValid||((backup?.latest&&backup.latest.integrity!=='invalid')?backup.latest:null);
  const backupAgeMs=latestValid?Math.max(0,finite(backup?.latestValidAgeMs,now-finite(latestValid.createdAt,now))):null,rpoMs=policy.rpoHours*HOUR,graceMs=Math.min(2*HOUR,Math.max(30*60*1000,rpoMs*.1));
  const backupStatus=!latestValid?'fail':backupAgeMs<=rpoMs?'pass':backupAgeMs<=rpoMs+graceMs?'warn':'fail';
  const history=Array.isArray(drills)?drills.filter(item=>item&&Number.isFinite(Number(item.finishedAt))).sort((a,b)=>Number(b.finishedAt)-Number(a.finishedAt)):[],latest=history[0]||null,latestSuccess=history.find(item=>item.status==='pass'||item.status==='warn')||null;
  const intervalMs=policy.drillIntervalDays*DAY,retryMs=policy.retryHours*HOUR,drillAgeMs=latest?Math.max(0,now-Number(latest.finishedAt)):null;
  let drillStatus='warn',due=true,dueReason='missing',nextRunAt=now;
  if(latest){
    if(latest.status==='fail'){
      drillStatus='fail';due=drillAgeMs>=retryMs;dueReason=due?'retry-after-failure':'failure-backoff';nextRunAt=Number(latest.finishedAt)+retryMs;
    }else{
      drillStatus=latest.status==='pass'&&drillAgeMs<=intervalMs?'pass':'warn';due=drillAgeMs>=intervalMs;dueReason=due?'interval-expired':'scheduled';nextRunAt=Number(latest.finishedAt)+intervalMs;
    }
  }
  const autoDue=policy.autoDrill&&due;
  return {
    status:worst(backupStatus,drillStatus),checkedAt:now,policy,
    backup:{status:backupStatus,file:latestValid?.file||null,integrity:latestValid?.integrity||null,ageMs:backupAgeMs,rpoMs,graceMs,withinRpo:Boolean(latestValid&&backupAgeMs<=rpoMs)},
    drill:{status:drillStatus,latest,latestSuccess,ageMs:drillAgeMs,due,dueReason,nextRunAt,autoDue,intervalMs,retryMs,testedDurationMs:latestSuccess?Number(latestSuccess.durationMs)||0:null}
  };
}
