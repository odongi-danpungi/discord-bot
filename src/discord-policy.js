import { createHash, randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';

const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
};
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const sorted=value=>[...new Set((value||[]).map(String))].sort();
const channelKeys=['registration','teams','log'];
const commandNames=['연동','setting'];
export const DISCORD_POLICY_MONITOR_INTERVALS=Object.freeze([1,5,15,30,60]);
export const DEFAULT_DISCORD_POLICY_MONITOR=Object.freeze({enabled:true,intervalMinutes:5,alertMode:'off',recoveryAlerts:true});
export const DISCORD_POLICY_ALERT_MODES=Object.freeze(['off','manual','all']);
export const DISCORD_POLICY_MAINTENANCE_DURATIONS=Object.freeze([15,30,60,120]);

export function normalizeDiscordPolicyMonitor(value={}){
  const interval=Number(value?.intervalMinutes);
  const legacyAlerts=Boolean(value?.discordAlerts);
  const alertMode=DISCORD_POLICY_ALERT_MODES.includes(value?.alertMode)?value.alertMode:(legacyAlerts?'all':'off');
  return {
    enabled:value?.enabled!==false,
    intervalMinutes:DISCORD_POLICY_MONITOR_INTERVALS.includes(interval)?interval:DEFAULT_DISCORD_POLICY_MONITOR.intervalMinutes,
    alertMode,
    recoveryAlerts:value?.recoveryAlerts!==false,
    // Kept in the API summary for v4.8 dashboard/backward compatibility.
    discordAlerts:alertMode!=='off'
  };
}
function normalizeMonitorState(value={}){
  return {
    lastRunAt:Number(value?.lastRunAt)||0,
    nextRunAt:Number(value?.nextRunAt)||0,
    lastStatus:['idle','pass','warn','fail'].includes(value?.lastStatus)?value.lastStatus:'idle',
    lastError:String(value?.lastError||'').slice(0,240),
    lastComparisonStatus:['none','pass','drift'].includes(value?.lastComparisonStatus)?value.lastComparisonStatus:'none',
    lastComparisonDigest:String(value?.lastComparisonDigest||''),
    lastAlertStatus:['none','pass','drift'].includes(value?.lastAlertStatus)?value.lastAlertStatus:'none',
    lastAlertDigest:String(value?.lastAlertDigest||''),
    lastAlertAt:Number(value?.lastAlertAt)||0,
    lastAlertError:String(value?.lastAlertError||'').slice(0,240),
    lastSuppressedReason:String(value?.lastSuppressedReason||'').slice(0,80),
    lastSuppressedAt:Number(value?.lastSuppressedAt)||0,
    suppressedCount:Math.max(0,Number(value?.suppressedCount)||0),
    consecutiveFailures:Math.max(0,Number(value?.consecutiveFailures)||0)
  };
}
export function normalizeDiscordPolicyMaintenance(value,now=Date.now()){
  if(!value||typeof value!=='object')return null;
  const startedAt=Number(value.startedAt)||0,endsAt=Number(value.endsAt)||0;
  if(!startedAt||!endsAt||endsAt<=now)return null;
  return {active:true,startedAt,endsAt,reason:String(value.reason||'계획된 작업').slice(0,120),actor:String(value.actor||'admin').slice(0,80)};
}
export function normalizeDiscordPolicyAcknowledgement(value){
  if(!value||typeof value!=='object'||!String(value.digest||''))return null;
  return {digest:String(value.digest),at:Number(value.at)||0,actor:String(value.actor||'admin').slice(0,80),note:String(value.note||'').slice(0,120)};
}
export function decideDiscordPolicyAlert({monitor={},monitorState={},comparison=null,maintenance=null,acknowledgement=null}={}){
  const settings=normalizeDiscordPolicyMonitor(monitor),state=normalizeMonitorState(monitorState);
  if(!comparison||!['drift','pass'].includes(comparison.status))return {send:false,reason:'no-comparison'};
  if(maintenance?.active)return {send:false,reason:'maintenance',status:comparison.status,digest:comparison.digest||''};
  if(comparison.status==='drift'){
    if(acknowledgement?.digest&&acknowledgement.digest===comparison.digest)return {send:false,reason:'acknowledged',status:'drift',digest:comparison.digest};
    if(settings.alertMode==='off')return {send:false,reason:'route-off',status:'drift',digest:comparison.digest};
    if(settings.alertMode==='manual'&&!(Number(comparison.counts?.manual)||0))return {send:false,reason:'safe-only',status:'drift',digest:comparison.digest};
    if(state.lastAlertStatus==='drift'&&state.lastAlertDigest===comparison.digest)return {send:false,reason:'duplicate',status:'drift',digest:comparison.digest};
    return {send:true,status:'drift',digest:comparison.digest};
  }
  if(settings.alertMode==='off'||!settings.recoveryAlerts)return {send:false,reason:'recovery-off',status:'pass',digest:comparison.digest||''};
  if(state.lastAlertStatus==='drift')return {send:true,status:'pass',digest:comparison.digest||''};
  return {send:false,reason:'no-prior-alert',status:'pass',digest:comparison.digest||''};
}

function normalizeChannel(channel={}){
  return {
    exists:Boolean(channel.exists),
    id:channel.id||null,
    name:channel.name||null,
    parentId:channel.parentId||null,
    topic:channel.topic??null,
    parentSynced:channel.parentSynced??null,
    permissions:sorted(channel.permissions),
    required:sorted(channel.required),
    expectedName:channel.expectedName||null
  };
}
function normalizeCommand(command={}){
  return {id:command.id||null,name:String(command.name||''),description:String(command.description||''),defaultMemberPermissions:command.defaultMemberPermissions==null?null:String(command.defaultMemberPermissions)};
}

export function normalizeDiscordPolicySnapshot(snapshot={}){
  const channels={};for(const key of channelKeys)channels[key]=normalizeChannel(snapshot.channels?.[key]);
  const commands=(snapshot.commands||[]).filter(command=>commandNames.includes(command.name)).map(normalizeCommand).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  return {
    guild:{id:String(snapshot.guild?.id||''),name:String(snapshot.guild?.name||'')},
    category:{exists:Boolean(snapshot.category?.exists),id:snapshot.category?.id||null,name:snapshot.category?.name||null,expectedName:snapshot.category?.expectedName||'🎮 시참'},
    channels,
    commands,
    bot:{basePermissions:sorted(snapshot.bot?.basePermissions),highestRoleId:snapshot.bot?.highestRoleId||null,highestRoleName:snapshot.bot?.highestRoleName||null},
    intents:sorted(snapshot.intents),
    applicationFlags:sorted(snapshot.applicationFlags),
    install:{scopes:sorted(snapshot.install?.scopes),permissions:sorted(snapshot.install?.permissions),guildInstallConfigured:snapshot.install?.guildInstallConfigured!==false},
    adminRole:{id:snapshot.adminRole?.id||'',exists:snapshot.adminRole?.exists!==false,name:snapshot.adminRole?.name||''}
  };
}

export function createDiscordPolicyBaseline(snapshot,{actor='admin',capturedAt=Date.now()}={}){
  const normalized=normalizeDiscordPolicySnapshot(snapshot);
  return {version:1,id:randomUUID(),capturedAt,actor:String(actor||'admin'),snapshot:normalized,digest:digest(normalized)};
}

function recentActor(recentChanges=[],targetId){
  if(!targetId)return null;
  const match=(recentChanges||[]).find(change=>String(change.targetId||'')===String(targetId));
  return match?{name:match.actorName||'알 수 없음',action:match.actionLabel||String(match.action||''),at:match.at||null,reason:match.reason||''}:null;
}
function addDiff(items,{id,kind='manual',title,detail,targetId=null,safeAction=null,actor=null}){
  items.push({id,kind,title,detail,targetId,safeAction,actor});
}
function sameArray(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
function commandMap(commands=[]){return new Map(commands.map(command=>[command.name,command]));}

export function compareDiscordPolicy(baseline,current,recentChanges=[]){
  if(!baseline?.snapshot)return {status:'none',digest:digest({baseline:null}),counts:{safe:0,manual:0,total:0},items:[],safeActions:[],baseline:null,currentDigest:digest(normalizeDiscordPolicySnapshot(current)),checkedAt:Date.now()};
  const base=normalizeDiscordPolicySnapshot(baseline.snapshot),now=normalizeDiscordPolicySnapshot(current),items=[];
  if(base.guild.id!==now.guild.id)addDiff(items,{id:'guild-id',kind:'manual',title:'서버 ID 변경',detail:`기준 ${base.guild.id||'—'} → 현재 ${now.guild.id||'—'}`});
  if(base.category.exists&&!now.category.exists)addDiff(items,{id:'category-missing',kind:'manual',title:'시참 카테고리 누락',detail:'기준선의 시참 카테고리를 현재 Discord에서 찾지 못했습니다.',targetId:base.category.id,actor:recentActor(recentChanges,base.category.id)});
  else if(!base.category.exists&&now.category.exists)addDiff(items,{id:'category-added',kind:'manual',title:'시참 카테고리 새로 감지',detail:'기준선에는 없던 시참 카테고리가 현재 Discord에 존재합니다.',targetId:now.category.id,actor:recentActor(recentChanges,now.category.id)});
  else if(base.category.exists&&now.category.exists&&base.category.id&&base.category.id!==now.category.id)addDiff(items,{id:'category-identity',kind:'manual',title:'시참 카테고리 식별자 변경',detail:'기준선의 카테고리와 현재 감지된 카테고리 ID가 다릅니다.',targetId:base.category.id,actor:recentActor(recentChanges,base.category.id)});
  else if(base.category.exists&&now.category.exists&&base.category.name!==now.category.name)addDiff(items,{id:'category-name',kind:'manual',title:'시참 카테고리 이름 변경',detail:`${base.category.name||'—'} → ${now.category.name||'—'}`,targetId:base.category.id||now.category.id,actor:recentActor(recentChanges,base.category.id||now.category.id)});

  for(const key of channelKeys){
    const before=base.channels[key],after=now.channels[key],label={registration:'시참',teams:'내전',log:'로그'}[key]||key;
    if(!before.exists&&!after.exists)continue;
    if(before.exists&&!after.exists){
      addDiff(items,{id:`channel-missing-${key}`,kind:'safe',title:`${label} 채널 누락`,detail:'기준선에 있던 프로젝트 핵심 채널을 현재 찾지 못했습니다. Safe Fix가 중복 위험을 다시 검사한 뒤 새 핵심 채널을 만들 수 있습니다.',targetId:before.id,safeAction:'ensure-core-channels',actor:recentActor(recentChanges,before.id)});continue;
    }
    if(!before.exists&&after.exists){
      addDiff(items,{id:`channel-added-${key}`,kind:'manual',title:`${label} 채널 새로 감지`,detail:'기준선에는 없던 프로젝트 핵심 채널이 현재 Discord에 존재합니다. 의도된 생성인지 확인하세요.',targetId:after.id,actor:recentActor(recentChanges,after.id)});continue;
    }
    if(before.id&&after.id&&before.id!==after.id)addDiff(items,{id:`channel-id-${key}`,kind:'manual',title:`${label} 채널 교체`,detail:'기준 채널과 현재 감지된 채널 ID가 다릅니다. 자동으로 합치거나 이동하지 않습니다.',targetId:before.id,actor:recentActor(recentChanges,before.id)});
    const targetId=after.id||before.id;
    if(before.name!==after.name)addDiff(items,{id:`channel-name-${key}`,title:`${label} 채널 이름 변경`,detail:`${before.name||'—'} → ${after.name||'—'}`,targetId,actor:recentActor(recentChanges,targetId)});
    if(before.parentId!==after.parentId)addDiff(items,{id:`channel-parent-${key}`,title:`${label} 채널 위치 변경`,detail:'채널의 상위 카테고리가 기준선과 다릅니다. 기존 overwrite에 영향을 줄 수 있어 자동 이동하지 않습니다.',targetId,actor:recentActor(recentChanges,targetId)});
    if(before.topic!==after.topic)addDiff(items,{id:`channel-topic-${key}`,title:`${label} 채널 주제 변경`,detail:'채널 topic이 기준선과 다릅니다. 의도된 편집일 수 있어 자동 복원하지 않습니다.',targetId,actor:recentActor(recentChanges,targetId)});
    if(before.parentSynced!==after.parentSynced)addDiff(items,{id:`channel-sync-${key}`,title:`${label} 권한 동기화 상태 변경`,detail:'상위 카테고리와의 permission overwrite 동기화 상태가 기준선과 달라졌습니다.',targetId,actor:recentActor(recentChanges,targetId)});
    if(!sameArray(before.permissions,after.permissions))addDiff(items,{id:`channel-permission-${key}`,title:`${label} 최종 권한 변경`,detail:'봇이 이 채널에서 받는 최종 권한이 기준선과 다릅니다. 권한 overwrite는 자동 수정하지 않습니다.',targetId,actor:recentActor(recentChanges,targetId)});
  }

  const baseCommands=commandMap(base.commands),currentCommands=commandMap(now.commands);
  for(const name of commandNames){
    const before=baseCommands.get(name),after=currentCommands.get(name);
    if(!before&&!after)continue;
    if(before&&!after){addDiff(items,{id:`command-${name}-missing`,kind:'safe',title:`/${name} 명령 누락`,detail:'기준선에 있던 프로젝트 Guild Command가 누락됐습니다. 프로젝트가 소유한 명령만 다시 동기화할 수 있습니다.',targetId:before.id,safeAction:'sync-guild-commands',actor:recentActor(recentChanges,before.id)});continue;}
    if(!before&&after){addDiff(items,{id:`command-${name}-added`,kind:'manual',title:`/${name} 명령 새로 감지`,detail:'기준선에는 없던 프로젝트 명령이 현재 서버에 존재합니다. 의도된 변경인지 확인하세요.',targetId:after.id,actor:recentActor(recentChanges,after.id)});continue;}
    if(before.description!==after.description||before.defaultMemberPermissions!==after.defaultMemberPermissions)addDiff(items,{id:`command-${name}-config`,kind:'safe',title:`/${name} 명령 설정 변경`,detail:'설명 또는 기본 실행 권한이 기준선과 다릅니다. 프로젝트가 소유한 명령만 다시 동기화할 수 있습니다.',targetId:after.id||before.id,safeAction:'sync-guild-commands',actor:recentActor(recentChanges,after.id||before.id)});
  }

  if(!sameArray(base.bot.basePermissions,now.bot.basePermissions))addDiff(items,{id:'bot-permissions',title:'봇 역할 권한 변경',detail:'Guild 기준 봇 역할 권한이 기준선과 다릅니다. 서버 역할 권한은 자동 변경하지 않습니다.',targetId:base.bot.highestRoleId,actor:recentActor(recentChanges,base.bot.highestRoleId)});
  if(!sameArray(base.intents,now.intents))addDiff(items,{id:'gateway-intents',title:'Gateway Intent 변경',detail:'실행 중인 Gateway Intent가 기준선과 다릅니다. 코드/환경 설정 영역이라 자동 복원하지 않습니다.'});
  if(!sameArray(base.applicationFlags,now.applicationFlags))addDiff(items,{id:'application-flags',title:'Developer Portal Intent 설정 변경',detail:'애플리케이션 플래그가 기준선과 다릅니다. Developer Portal 설정은 자동 변경하지 않습니다.'});
  if(!sameArray(base.install.scopes,now.install.scopes)||!sameArray(base.install.permissions,now.install.permissions)||base.install.guildInstallConfigured!==now.install.guildInstallConfigured)addDiff(items,{id:'install-policy',title:'Discord 설치 정책 변경',detail:'Guild Install scope 또는 기본 permission이 기준선과 다릅니다. Developer Portal 설치 정책은 자동 변경하지 않습니다.'});
  if(base.adminRole.id!==now.adminRole.id||base.adminRole.exists!==now.adminRole.exists)addDiff(items,{id:'admin-role',title:'관리자 역할 기준 변경',detail:'ADMIN_ROLE_ID 또는 해당 역할 존재 상태가 기준선과 다릅니다. 로컬 설정/서버 역할은 자동 변경하지 않습니다.',targetId:base.adminRole.id,actor:recentActor(recentChanges,base.adminRole.id)});

  const safeActions=[...new Set(items.filter(item=>item.kind==='safe'&&item.safeAction).map(item=>item.safeAction))].sort();
  const counts={safe:items.filter(item=>item.kind==='safe').length,manual:items.filter(item=>item.kind!=='safe').length,total:items.length};
  const comparisonPayload=items.map(({id,kind,title,detail,targetId,safeAction})=>({id,kind,title,detail,targetId,safeAction}));
  return {status:items.length?'drift':'pass',digest:digest({baseline:baseline.digest,items:comparisonPayload}),counts,items,safeActions,baseline:{id:baseline.id,digest:baseline.digest,capturedAt:baseline.capturedAt,actor:baseline.actor},currentDigest:digest(now),checkedAt:Date.now()};
}

const validBaseline=value=>value===null||(value&&typeof value==='object'&&value.version===1&&typeof value.id==='string'&&Number.isFinite(value.capturedAt)&&value.snapshot&&typeof value.digest==='string');
const validJournal=entry=>entry&&typeof entry==='object'&&typeof entry.id==='string'&&Number.isFinite(entry.at)&&typeof entry.type==='string'&&typeof entry.summary==='string';
const validMonitor=value=>value===undefined||(value&&typeof value==='object'&&typeof value.enabled==='boolean'&&DISCORD_POLICY_MONITOR_INTERVALS.includes(Number(value.intervalMinutes))&&(typeof value.discordAlerts==='boolean'||DISCORD_POLICY_ALERT_MODES.includes(value.alertMode)));
const validMonitorState=value=>value===undefined||(value&&typeof value==='object');
const validMaintenance=value=>value===undefined||value===null||(value&&typeof value==='object'&&Number.isFinite(Number(value.startedAt))&&Number.isFinite(Number(value.endsAt)));
const validAcknowledgement=value=>value===undefined||value===null||(value&&typeof value==='object'&&typeof value.digest==='string');
const validState=value=>value&&typeof value==='object'&&value.version===1&&validBaseline(value.baseline)&&Array.isArray(value.journal)&&value.journal.every(validJournal)&&typeof value.lastDigest==='string'&&Number.isFinite(value.lastCheckedAt)&&validMonitor(value.monitor)&&validMonitorState(value.monitorState)&&validMaintenance(value.maintenance)&&validAcknowledgement(value.acknowledgement);

export class DiscordPolicyStore extends JsonStore{
  constructor(file){super(file,{version:1,baseline:null,journal:[],lastDigest:'',lastCheckedAt:0,lastStatus:'none',monitor:normalizeDiscordPolicyMonitor(),monitorState:normalizeMonitorState(),maintenance:null,acknowledgement:null},validState);}
  async setBaseline(snapshot,{actor='admin'}={}){
    const baseline=createDiscordPolicyBaseline(snapshot,{actor});
    const cleanDigest=digest({baseline:baseline.digest,items:[]});
    await this.update(state=>{state.baseline=baseline;state.lastDigest=cleanDigest;state.lastStatus='pass';state.lastCheckedAt=Date.now();state.monitor=normalizeDiscordPolicyMonitor(state.monitor);state.acknowledgement=null;state.monitorState={...normalizeMonitorState(state.monitorState),lastComparisonStatus:'pass',lastComparisonDigest:cleanDigest,lastStatus:'pass',lastError:'',consecutiveFailures:0,lastAlertStatus:'none',lastAlertDigest:'',lastAlertAt:0,lastAlertError:'',lastSuppressedReason:'',lastSuppressedAt:0};state.journal.unshift({id:randomUUID(),at:Date.now(),type:'baseline-captured',summary:`Discord 정상 기준선 저장 · ${baseline.digest.slice(0,12)}`,status:'info',items:[]});state.journal=state.journal.slice(0,300);});
    return baseline;
  }
  async observe(comparison){
    const current=this.read();
    if(!current.baseline||comparison.digest===current.lastDigest)return false;
    let recorded=false;
    await this.update(state=>{
      if(!state.baseline||comparison.digest===state.lastDigest)return;
      state.monitor=normalizeDiscordPolicyMonitor(state.monitor);state.monitorState=normalizeMonitorState(state.monitorState);
      const previousStatus=state.lastStatus||'none';
      state.lastCheckedAt=Date.now();state.lastStatus=comparison.status;state.lastDigest=comparison.digest;
      const cleared=comparison.status==='pass';
      const summary=cleared&&previousStatus==='drift'?'Discord drift 해소':comparison.status==='drift'&&previousStatus!=='drift'?`Discord drift 감지 · ${comparison.counts.total}개`:`Discord drift 변경 · ${comparison.counts.total}개`;
      state.journal.unshift({id:randomUUID(),at:Date.now(),type:cleared?'drift-cleared':'drift-change',summary,status:cleared?'pass':'warn',items:(comparison.items||[]).slice(0,20).map(item=>({id:item.id,title:item.title,kind:item.kind,actor:item.actor||null}))});
      state.journal=state.journal.slice(0,300);recorded=true;
    });
    return recorded;
  }
  async setMonitorSettings(settings){
    const monitor=normalizeDiscordPolicyMonitor(settings),now=Date.now();
    await this.update(state=>{
      state.monitor=monitor;const current=normalizeMonitorState(state.monitorState);
      state.monitorState={...current,nextRunAt:monitor.enabled?now:0,lastStatus:monitor.enabled?current.lastStatus:'idle',lastError:monitor.enabled?current.lastError:'',lastAlertError:monitor.alertMode==='off'?'':current.lastAlertError};
    });
    return this.summary();
  }
  async startMaintenance({durationMinutes=30,reason='계획된 작업',actor='admin',now=Date.now()}={}){
    const duration=Number(durationMinutes);if(!DISCORD_POLICY_MAINTENANCE_DURATIONS.includes(duration))throw Error('점검 모드는 15, 30, 60, 120분 중에서 선택해 주세요.');
    const cleanReason=String(reason||'계획된 작업').trim().slice(0,120)||'계획된 작업';
    await this.update(state=>{state.maintenance={startedAt:now,endsAt:now+duration*60*1000,reason:cleanReason,actor:String(actor||'admin').slice(0,80)};state.journal.unshift({id:randomUUID(),at:now,type:'maintenance-started',summary:`Discord 정책 점검 모드 시작 · ${duration}분 · ${cleanReason}`,status:'info',items:[]});state.journal=state.journal.slice(0,300);});
    return this.summary();
  }
  async endMaintenance({actor='admin',now=Date.now(),automatic=false}={}){
    const current=normalizeDiscordPolicyMaintenance(this.read().maintenance,now);if(!current&&!this.read().maintenance)return this.summary();
    await this.update(state=>{state.maintenance=null;state.journal.unshift({id:randomUUID(),at:now,type:'maintenance-ended',summary:`Discord 정책 점검 모드 ${automatic?'자동 종료':'종료'} · ${String(actor||'admin').slice(0,80)}`,status:'info',items:[]});state.journal=state.journal.slice(0,300);});
    return this.summary();
  }
  async expireMaintenance(now=Date.now()){
    const raw=this.read().maintenance;if(!raw||Number(raw.endsAt)>now)return false;
    await this.endMaintenance({actor:'system',now,automatic:true});return true;
  }
  async acknowledge({digest:comparisonDigest,note='',actor='admin',now=Date.now()}={}){
    const cleanDigest=String(comparisonDigest||'');if(!cleanDigest)throw Error('확인할 Discord drift digest가 없습니다.');
    const cleanNote=String(note||'').trim().slice(0,120);
    await this.update(state=>{state.acknowledgement={digest:cleanDigest,at:now,actor:String(actor||'admin').slice(0,80),note:cleanNote};state.journal.unshift({id:randomUUID(),at:now,type:'drift-acknowledged',summary:`Discord drift 확인 처리${cleanNote?` · ${cleanNote}`:''}`,status:'info',items:[]});state.journal=state.journal.slice(0,300);});
    return this.summary();
  }
  async clearAcknowledgement({actor='admin',now=Date.now(),reason='수동 해제'}={}){
    if(!this.read().acknowledgement)return this.summary();
    await this.update(state=>{state.acknowledgement=null;state.journal.unshift({id:randomUUID(),at:now,type:'drift-ack-cleared',summary:`Discord drift 확인 해제 · ${reason} · ${String(actor||'admin').slice(0,80)}`,status:'info',items:[]});state.journal=state.journal.slice(0,300);});
    return this.summary();
  }
  async noteMonitorRun({comparison=null,error=null,alerted=null,alertError=null,suppressed=null,now=Date.now()}={}){
    await this.update(state=>{
      const monitor=normalizeDiscordPolicyMonitor(state.monitor),current=normalizeMonitorState(state.monitorState),minutes=monitor.intervalMinutes;
      const next={...current,lastRunAt:now,nextRunAt:monitor.enabled?now+minutes*60*1000:0};
      if(error){next.lastStatus='fail';next.lastError=String(error?.message||error||'Discord 정책 모니터 오류').slice(0,240);next.consecutiveFailures=current.consecutiveFailures+1;}
      else if(comparison){
        next.lastStatus=comparison.status==='drift'?'warn':'pass';next.lastError='';next.consecutiveFailures=0;next.lastComparisonStatus=comparison.status;next.lastComparisonDigest=comparison.digest;
        if(comparison.status==='pass'||state.acknowledgement?.digest!==comparison.digest)state.acknowledgement=null;
      }
      if(alerted){next.lastAlertStatus=alerted.status;next.lastAlertDigest=alerted.digest||'';next.lastAlertAt=now;next.lastAlertError='';next.lastSuppressedReason='';}
      else if(alertError)next.lastAlertError=String(alertError?.message||alertError||'Discord 알림 전송 실패').slice(0,240);
      if(suppressed&&suppressed.reason&&!['duplicate','no-prior-alert'].includes(suppressed.reason)){next.lastSuppressedReason=String(suppressed.reason).slice(0,80);next.lastSuppressedAt=now;next.suppressedCount=current.suppressedCount+1;}
      state.monitor=monitor;state.monitorState=next;
    });
    return this.summary();
  }
  summary(){
    const state=this.read(),now=Date.now();
    return {baseline:state.baseline?{id:state.baseline.id,capturedAt:state.baseline.capturedAt,actor:state.baseline.actor,digest:state.baseline.digest}:null,journal:state.journal.slice(0,100),lastCheckedAt:state.lastCheckedAt,lastDigest:state.lastDigest,lastStatus:state.lastStatus||'none',monitor:normalizeDiscordPolicyMonitor(state.monitor),monitorState:normalizeMonitorState(state.monitorState),maintenance:normalizeDiscordPolicyMaintenance(state.maintenance,now),acknowledgement:normalizeDiscordPolicyAcknowledgement(state.acknowledgement)};
  }
}
