import { timingSafeEqual } from 'node:crypto';

export const DASHBOARD_OPERATOR_CAPABILITIES=Object.freeze(['live','queue','broadcast','discord']);
export const DEFAULT_DASHBOARD_OPERATOR_CAPABILITIES=Object.freeze(['live','queue','broadcast','discord']);

const equal=(a,b)=>{const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length===y.length&&timingSafeEqual(x,y);};
const unique=value=>[...new Set(value)];

export function parseDashboardOperatorCapabilities(value){
  const raw=String(value??'').trim();
  if(!raw)return [...DEFAULT_DASHBOARD_OPERATOR_CAPABILITIES];
  const items=unique(raw.split(',').map(item=>item.trim().toLowerCase()).filter(Boolean));
  if(items.includes('all'))return [...DEFAULT_DASHBOARD_OPERATOR_CAPABILITIES];
  const unknown=items.filter(item=>!DASHBOARD_OPERATOR_CAPABILITIES.includes(item));
  if(unknown.length)throw Error(`DASHBOARD_OPERATOR_CAPABILITIES에 지원하지 않는 권한이 있습니다: ${unknown.join(', ')}`);
  if(!items.length)throw Error('DASHBOARD_OPERATOR_CAPABILITIES에는 하나 이상의 권한이 필요합니다.');
  return items;
}

export function authenticateDashboardBasic(authorization,config={}){
  const auth=String(authorization||'');
  if(!auth.startsWith('Basic '))return null;
  let decoded='';
  try{decoded=Buffer.from(auth.slice(6),'base64').toString('utf8');}catch{return null;}
  const colon=decoded.indexOf(':');if(colon<0)return null;
  const user=decoded.slice(0,colon),password=decoded.slice(colon+1);
  if(equal(user,config.dashboardUser)&&equal(password,config.dashboardPassword))return {role:'admin',user:String(config.dashboardUser||'admin'),capabilities:['*']};
  if(config.dashboardOperatorUser&&config.dashboardOperatorPassword&&equal(user,config.dashboardOperatorUser)&&equal(password,config.dashboardOperatorPassword)){
    return {role:'operator',user:String(config.dashboardOperatorUser),capabilities:parseDashboardOperatorCapabilities(config.dashboardOperatorCapabilities)};
  }
  return null;
}

export function canDashboard(identity,capability){
  if(identity?.role==='admin')return true;
  if(identity?.role!=='operator')return false;
  return Array.isArray(identity.capabilities)&&identity.capabilities.includes(capability);
}

export function publicDashboardAccess(identity){
  const role=identity?.role==='operator'?'operator':'admin';
  return {role,user:String(identity?.user||'admin'),capabilities:role==='admin'?[...DASHBOARD_OPERATOR_CAPABILITIES]:[...(identity?.capabilities||[])]};
}

export function dashboardCapabilityForRequest(method,path){
  const verb=String(method||'GET').toUpperCase(),pathname=String(path||'').split('?')[0];
  if(['/api/snapshot','/api/events','/api/access','/api/mobile-health'].includes(pathname)&&verb==='GET')return 'authenticated';
  if(pathname==='/api/participation-queue'&&verb==='GET')return 'queue';
  if(pathname.startsWith('/api/participation-queue/')&&verb==='POST')return 'queue';
  if(pathname==='/api/naver/participation'&&verb==='GET')return 'queue';
  if(/^\/api\/naver\/participation\/(register|cancel|close)$/.test(pathname)&&verb==='POST')return 'queue';
  if(pathname==='/api/broadcast-ops'&&verb==='GET')return 'broadcast';
  if(pathname==='/api/broadcast-runbook'&&verb==='GET')return 'broadcast';
  if(pathname==='/api/broadcast-archive'&&verb==='GET')return 'broadcast';
  if(pathname.startsWith('/api/broadcast-runbook/')&&verb==='POST')return 'broadcast';
  if(pathname.startsWith('/api/broadcast-ops/')&&verb==='POST')return 'broadcast';
  if(pathname==='/api/broadcast-control'&&verb==='GET')return 'broadcast';
  if(pathname==='/api/broadcast-scene'&&verb==='POST')return 'broadcast';
  if(pathname==='/api/chzzk/live'&&verb==='GET')return 'broadcast';
  if(pathname==='/api/chzzk/live/run'&&verb==='POST')return 'broadcast';
  if(pathname.startsWith('/api/operations/')&&verb==='POST'){
    const action=pathname.slice('/api/operations/'.length);
    if(action==='publish')return 'discord';
    if(['open','close','reopen','draw','attendance','replace','teams','reshuffle','end'].includes(action))return 'live';
  }
  return null;
}

export function operatorStaticAllowed(path){
  return ['/mobile-control.html','/mobile-control.js','/mobile-control.css','/mobile-control-model.js','/mobile-broadcast-model.js','/mobile-health-model.js','/mobile-recovery-model.js','/broadcast-runbook-model-v416.js'].includes(String(path||''));
}

export function sanitizeOperatorQueueEntry(entry){
  if(!entry)return null;
  return {
    id:String(entry.id||''),
    position:Number(entry.position)||0,
    source:String(entry.source||'dashboard'),
    status:String(entry.status||''),
    displayName:String(entry.displayName||''),
    sessionId:entry.sessionId?String(entry.sessionId):null,
    game:entry.game||null,
    mode:entry.mode||null,
    round:Number.isInteger(entry.round)?entry.round:null,
    calledAt:Number(entry.calledAt)||0,
    callDeadline:Number(entry.callDeadline||entry.deadline)||0,
    callAttempt:Number(entry.callAttempt||entry.attempt)||0,
    createdAt:Number(entry.createdAt)||0,
    updatedAt:Number(entry.updatedAt)||0
  };
}

export function sanitizeOperatorCall(call){
  if(!call)return null;
  return {
    id:String(call.id||''),displayName:String(call.displayName||''),source:String(call.source||'dashboard'),position:Number(call.position)||0,
    calledAt:Number(call.calledAt)||0,deadline:Number(call.deadline||call.callDeadline)||0,attempt:Number(call.attempt||call.callAttempt)||0
  };
}

function sanitizeSession(session){
  if(!session)return null;
  const list=name=>Array.isArray(session[name])?session[name]:[];
  return {
    id:String(session.id||''),round:Number(session.round)||1,game:session.game||null,mode:session.mode||null,phase:session.phase||'idle',count:Number(session.count)||0,
    title:String(session.title||''),description:String(session.description||''),closeAt:Number(session.closeAt)||null,deadline:Number(session.deadline)||null,attendanceVersion:Number(session.attendanceVersion)||0,
    applicantCount:list('applicants').length,postponedCount:list('postponed').length,winnerCount:list('winners').length,confirmedCount:list('confirmed').length,
    unconfirmedWinnerCount:list('winners').filter(id=>!list('confirmed').includes(id)).length,teamCount:Array.isArray(session.teams)?session.teams.length:0
  };
}



function sanitizePoll(poll){
  if(!poll)return null;
  return {
    id:String(poll.id||''),question:String(poll.question||''),status:poll.status==='closed'?'closed':'open',createdAt:Number(poll.createdAt)||0,closedAt:Number(poll.closedAt)||null,
    options:(Array.isArray(poll.options)?poll.options:[]).map(option=>({id:String(option.id||''),label:String(option.label||''),voteCount:Array.isArray(option.votes)?option.votes.length:Number(option.voteCount)||0}))
  };
}

function sanitizeRunbook(value={}){
  const phases=new Set(['pre','live','post']),statuses=new Set(['pending','done','skipped']),alertStatuses=new Set(['pending','sent','failed','suppressed']);
  const phaseState=value.phaseState&&typeof value.phaseState==='object'?{phase:phases.has(value.phaseState.phase)?value.phaseState.phase:'pre',source:String(value.phaseState.source||'system').slice(0,40),reason:String(value.phaseState.reason||'').slice(0,220),detectedAt:Number(value.phaseState.detectedAt)||0}:{phase:'pre',source:'system',reason:'',detectedAt:0};
  return {
    id:String(value.id||'').slice(0,100),title:String(value.title||'방송 운영 Runbook').slice(0,120),status:value.status==='closed'?'closed':'active',createdAt:Number(value.createdAt)||0,createdBy:String(value.createdBy||'').slice(0,80),updatedAt:Number(value.updatedAt)||0,currentOwner:String(value.currentOwner||'').slice(0,80),closedAt:Number(value.closedAt)||0,closedBy:String(value.closedBy||'').slice(0,80),archiveCount:Number(value.archiveCount)||0,phaseState,
    closeout:value.closeout&&typeof value.closeout==='object'?{summary:String(value.closeout.summary||'').slice(0,320),nextOwner:String(value.closeout.nextOwner||'').slice(0,80),nextNote:String(value.closeout.nextNote||'').slice(0,1200),generatedAt:Number(value.closeout.generatedAt)||0,schedule:value.closeout.schedule&&typeof value.closeout.schedule==='object'?{id:String(value.closeout.schedule.id||'').slice(0,80),title:String(value.closeout.schedule.title||'').slice(0,120),startAt:Number(value.closeout.schedule.startAt)||0}:null,completedCount:Number(value.closeout.completedCount)||0,skippedCount:Number(value.closeout.skippedCount)||0,handoffCount:Number(value.closeout.handoffCount)||0}:null,
    phaseHistory:(Array.isArray(value.phaseHistory)?value.phaseHistory:[]).slice(0,20).map(item=>({phase:phases.has(item.phase)?item.phase:'pre',source:String(item.source||'system').slice(0,40),reason:String(item.reason||'').slice(0,220),at:Number(item.at)||0})),
    progress:{done:Number(value.progress?.done)||0,skipped:Number(value.progress?.skipped)||0,pending:Number(value.progress?.pending)||0,total:Number(value.progress?.total)||0},
    steps:(Array.isArray(value.steps)?value.steps:[]).slice(0,30).map(item=>({id:String(item.id||'').slice(0,80),phase:phases.has(item.phase)?item.phase:'live',title:String(item.title||'').slice(0,120),detail:String(item.detail||'').slice(0,220),status:statuses.has(item.status)?item.status:'pending',updatedAt:Number(item.updatedAt)||0,updatedBy:String(item.updatedBy||'').slice(0,80)})),
    handoffs:(Array.isArray(value.handoffs)?value.handoffs:[]).slice(0,30).map(item=>({id:String(item.id||'').slice(0,100),from:String(item.from||'').slice(0,80),to:String(item.to||'').slice(0,80),note:String(item.note||'').slice(0,1200),at:Number(item.at)||0,alertStatus:alertStatuses.has(item.alertStatus)?item.alertStatus:'suppressed',alertedAt:Number(item.alertedAt)||0})),
    activity:(Array.isArray(value.activity)?value.activity:[]).slice(0,20).map(item=>({id:String(item.id||'').slice(0,100),at:Number(item.at)||0,type:String(item.type||'info').slice(0,40),source:String(item.source||'broadcast').slice(0,40),message:String(item.message||'').slice(0,300)}))
  };
}

export function sanitizeOperatorBroadcastOps(value={}){
  return {
    gamePresets:Array.isArray(value.gamePresets)?value.gamePresets.map(item=>({...item})):[],
    schedules:Array.isArray(value.schedules)?value.schedules.map(item=>({...item})):[],
    activePoll:sanitizePoll(value.activePoll),
    pollHistory:Array.isArray(value.pollHistory)?value.pollHistory.map(sanitizePoll).filter(Boolean):[],
    notifications:{...(value.notifications||{})},
    timeline:Array.isArray(value.timeline)?value.timeline.map(item=>({...item})):[],
    stats:{...(value.stats||{})},
    nextSchedule:value.nextSchedule?{...value.nextSchedule}:null,
    runbook:sanitizeRunbook(value.runbook||{})
  };
}

export function sanitizeOperatorNaverParticipation(value={}){
  const publication=value.publication&&typeof value.publication==='object'?{status:String(value.publication.status||''),articleUrl:String(value.publication.articleUrl||''),subject:String(value.publication.subject||'')}:null;
  const session=value.session&&typeof value.session==='object'?{id:String(value.session.id||''),status:String(value.session.status||''),openedAt:Number(value.session.openedAt||value.session.startedAt)||0,closedAt:Number(value.session.closedAt)||null,closeReason:String(value.session.closeReason||'')}:null;
  const entries=(Array.isArray(value.entries)?value.entries:[]).map(entry=>({id:String(entry.id||''),order:Number(entry.order)||0,displayName:String(entry.displayName||''),status:String(entry.status||''),registeredAt:Number(entry.registeredAt)||0,cancelledAt:Number(entry.cancelledAt)||null}));
  return {publication,session,entries,history:[],counts:{...(value.counts||{})},nextOrder:Number(value.nextOrder)||1,registrationOpen:Boolean(value.registrationOpen),commentAutomationSupported:Boolean(value.commentAutomationSupported),commentManualText:String(value.commentManualText||'')};
}


export function sanitizeBroadcastPreflight(value={}){
  const allowedTargets=new Set(['home','live','operate','broadcast','members','history','runtime','incidents','recovery','capacity','deployment','release','supply','discordaudit','settings','preflight']);
  const cleanTarget=value=>allowedTargets.has(String(value||''))?String(value):'preflight';
  return {
    version:Number(value.version)||1,checkedAt:Number(value.checkedAt)||0,status:['pass','warn','fail'].includes(value.status)?value.status:'warn',ready:Boolean(value.ready),mode:String(value.mode||'prelive').slice(0,30),
    counts:{pass:Number(value.counts?.pass)||0,warn:Number(value.counts?.warn)||0,fail:Number(value.counts?.fail)||0,total:Number(value.counts?.total)||0},
    checks:(Array.isArray(value.checks)?value.checks:[]).slice(0,30).map(item=>({id:String(item.id||'').slice(0,60),label:String(item.label||'').slice(0,120),status:['pass','warn','fail'].includes(item.status)?item.status:'warn',detail:String(item.detail||'').slice(0,220),target:cleanTarget(item.target)})),
    recommendation:value.recommendation?{title:String(value.recommendation.title||'').slice(0,120),text:String(value.recommendation.text||'').slice(0,220),target:cleanTarget(value.recommendation.target),label:String(value.recommendation.label||'확인').slice(0,80),tone:['primary','warn','danger'].includes(value.recommendation.tone)?value.recommendation.tone:'primary'}:null,
    summary:String(value.summary||'').slice(0,220)
  };
}

export function sanitizeOperatorSnapshot(snapshot,identity){
  const queue=snapshot.participationQueue||{},calls=snapshot.participationCalls||{};
  const entries=(queue.entries||[]).map(sanitizeOperatorQueueEntry),currentCall=sanitizeOperatorQueueEntry(queue.currentCall);
  const safe={
    state:{session:sanitizeSession(snapshot.state?.session),revision:Number(snapshot.state?.revision)||0},
    records:[],
    demo:Boolean(snapshot.demo),profile:snapshot.profile,version:snapshot.version,revision:Number(snapshot.revision)||0,serverTime:Number(snapshot.serverTime)||Date.now(),
    participationQueue:{revision:Number(queue.revision)||0,entries,counts:{...(queue.counts||{})},activeCount:Number(queue.activeCount)||0,currentCall},
    participationCalls:{timeoutSeconds:Number(calls.timeoutSeconds)||60,current:sanitizeOperatorCall(calls.current),calledCount:Number(calls.calledCount)||0},
    chzzkLive:{state:{lastKnownLive:snapshot.chzzkLive?.state?.lastKnownLive??null,lastStatus:snapshot.chzzkLive?.state?.lastStatus||'idle'},currentLive:snapshot.chzzkLive?.currentLive?{title:String(snapshot.chzzkLive.currentLive.title||''),categoryType:snapshot.chzzkLive.currentLive.categoryType||'',concurrentUserCount:Number(snapshot.chzzkLive.currentLive.concurrentUserCount)||0}:null},
    broadcastOps:canDashboard(identity,'broadcast')?sanitizeOperatorBroadcastOps(snapshot.broadcastOps):{},
    broadcastPreflight:sanitizeBroadcastPreflight(snapshot.broadcastPreflight||{}),
    emergency:snapshot.emergency?{locked:Boolean(snapshot.emergency.locked),lockedAt:Number(snapshot.emergency.lockedAt)||0,reason:String(snapshot.emergency.reason||'').slice(0,160)}:{locked:false,lockedAt:0,reason:''},
    recovered:Boolean(snapshot.recovered),
    access:publicDashboardAccess(identity)
  };
  if(Object.hasOwn(snapshot,'csrf'))safe.csrf=snapshot.csrf;
  return safe;
}
