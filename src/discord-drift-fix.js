import { createHash } from 'node:crypto';

const EXPECTED_COMMANDS=Object.freeze([
  {name:'연동',description:'내 치지직·게임 정보를 등록하거나 수정합니다'},
  {name:'setting',description:'카테고리·채널과 연동 패널을 자동 설정합니다'}
]);
const CORE_CHANNEL_KEYS=Object.freeze(['registration','teams','log']);

const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
};
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const checkBy=(audit,id)=>audit?.checks?.find(item=>item.id===id);
const commandBy=(audit,name)=>audit?.commands?.find(item=>item.name===name);

function addManual(items,{id,title,detail,severity='warn'}){
  if(items.some(item=>item.id===id))return;
  items.push({id,kind:'manual',safe:false,severity,title,detail});
}
function addSafe(items,{id,action,title,detail,changes=[],blocked=false,blockedReason=''}){
  items.push({id,kind:blocked?'blocked':'safe',safe:!blocked,severity:blocked?'fail':'warn',action,title,detail,changes,blockedReason});
}

export function buildDiscordDriftPlan(audit={}){
  const items=[];
  if(audit.demo)return {status:'pass',digest:digest({demo:true}),counts:{safe:0,manual:0,blocked:0},items,canApply:false,connected:false,demo:true};
  if(!audit.connected){
    addManual(items,{id:'discord-offline',title:'Discord 연결 복구',detail:'Discord 연결이 준비되지 않아 수정 계획을 계산할 수 없습니다.',severity:'fail'});
    return {status:'fail',digest:digest({connected:false,items}),counts:{safe:0,manual:1,blocked:0},items,canApply:false,connected:false,demo:false};
  }

  const base=new Set(audit.bot?.basePermissions||[]),administrator=base.has('Administrator');
  const manageChannels=administrator||base.has('ManageChannels');
  if(audit.category?.exists&&audit.category?.expectedName&&audit.category.name!==audit.category.expectedName)addManual(items,{id:'manual-category-name',title:'시참 카테고리 이름 drift',detail:`${audit.category.name||'—'} → 기준 ${audit.category.expectedName}. 기존 서버 구조를 덮어쓰지 않도록 자동 변경하지 않습니다.`});
  const missingChannels=CORE_CHANNEL_KEYS.filter(key=>!audit.channels?.[key]?.exists),outside=audit.outsideCoreChannels||{};
  const conflicted=missingChannels.filter(key=>outside[key]);
  for(const key of conflicted){
    const channel=outside[key];addManual(items,{id:`manual-channel-location-${key}`,title:`${channel.name||key} 위치 drift`,detail:'핵심 채널 이름이 예상 시참 카테고리 밖에 있습니다. 중복 생성을 막기 위해 자동 이동하지 않습니다.'});
  }
  const safeMissing=missingChannels.filter(key=>!outside[key]);
  if(safeMissing.length){
    addSafe(items,{id:'ensure-core-channels',action:'ensure-core-channels',title:'핵심 시참 채널 생성',detail:`누락된 핵심 채널 ${safeMissing.length}개만 생성합니다. 기존 채널과 다른 카테고리는 수정하지 않습니다.`,changes:safeMissing,blocked:!manageChannels,blockedReason:manageChannels?'':'봇에 ManageChannels 권한이 없어 자동 생성할 수 없습니다.'});
  }

  const desiredSettingPermission=audit.adminRole?.id?null:String(audit.manageGuildPermissionValue||'');
  const commandDrift=[];
  for(const expected of EXPECTED_COMMANDS){
    const current=commandBy(audit,expected.name);
    if(!current){commandDrift.push(`/${expected.name} 생성`);continue;}
    if(String(current.description||'')!==expected.description)commandDrift.push(`/${expected.name} 설명 동기화`);
    const actual=current.defaultMemberPermissions==null?null:String(current.defaultMemberPermissions);
    if(expected.name==='setting'){
      if(actual!==desiredSettingPermission)commandDrift.push(`/setting 기본 권한 ${actual??'없음'} → ${desiredSettingPermission??'런타임 역할 검사'}`);
    }else if(actual!==null)commandDrift.push(`/${expected.name} 기본 권한 제한 해제`);
  }
  if(commandDrift.length)addSafe(items,{id:'sync-guild-commands',action:'sync-guild-commands',title:'Guild Slash Command 동기화',detail:'프로젝트가 소유한 /연동, /setting 명령만 생성·수정합니다. 다른 명령은 삭제하지 않습니다.',changes:commandDrift});

  if(checkBy(audit,'administrator')?.status==='warn')addManual(items,{id:'manual-administrator',title:'Administrator 제거 검토',detail:'고위험 서버 권한은 자동으로 제거하지 않습니다. 봇 역할에서 필요한 최소 권한만 남기세요.'});
  if(checkBy(audit,'privileged-intents')?.status==='warn'||checkBy(audit,'portal-intents')?.status==='warn')addManual(items,{id:'manual-intents',title:'Privileged Intent 정리',detail:'Gateway Intent와 Developer Portal 토글은 실행 설정에 영향을 주므로 자동 변경하지 않습니다. 현재 기능은 Guilds Intent만 사용합니다.'});
  for(const permission of ['ManageChannels','ManageNicknames'])if(checkBy(audit,`base-${permission}`)?.status==='fail')addManual(items,{id:`manual-base-${permission}`,title:`봇 역할 권한 · ${permission}`,detail:'서버 역할 권한 변경은 범위가 넓어 자동 수행하지 않습니다. Discord 역할 설정에서 필요한 권한만 추가하세요.',severity:'fail'});

  for(const key of CORE_CHANNEL_KEYS){
    const channel=audit.channels?.[key];
    if(!channel?.exists)continue;
    if(channel.expectedName&&channel.name!==channel.expectedName)addManual(items,{id:`manual-channel-name-${key}`,title:`${channel.name||key} 이름 drift`,detail:`기준 이름 ${channel.expectedName}과 다릅니다. 기준선으로 식별된 기존 채널을 보호하기 위해 새 채널을 만들거나 자동 이름 변경하지 않습니다.`});
    if(audit.category?.exists&&channel.parentId&&channel.parentId!==audit.category.id)addManual(items,{id:`manual-channel-location-${key}`,title:`${channel.name||key} 위치 drift`,detail:'기준선으로 식별된 핵심 채널이 시참 카테고리 밖에 있습니다. 기존 overwrite를 보호하기 위해 자동 이동하지 않습니다.'});
    const required=channel.required||[],actual=new Set(channel.permissions||[]),missing=administrator?[]:required.filter(name=>!actual.has(name));
    if(missing.length)addManual(items,{id:`manual-channel-${key}`,title:`${channel.name||key} 최종 권한`,detail:`누락: ${missing.join(', ')}. 채널 permission overwrite 수정에는 ManageRoles가 필요하므로 최소 권한 정책상 자동 수정하지 않습니다.`,severity:'fail'});
    if(channel.parentSynced===false)addManual(items,{id:`manual-sync-${key}`,title:`${channel.name||key} 카테고리 권한 비동기`,detail:'권한 동기화는 기존 overwrite를 바꿀 수 있어 자동으로 수행하지 않습니다. 의도된 예외인지 확인하세요.'});
  }

  for(const id of ['install-bot','install-commands','install-permissions','guild-install'])if(['warn','fail'].includes(checkBy(audit,id)?.status))addManual(items,{id:`manual-${id}`,title:'Developer Portal 설치 설정',detail:'설치 scope/기본 permission은 Developer Portal의 앱 설치 정책이므로 대시보드가 자동 변경하지 않습니다.'});
  if(checkBy(audit,'admin-role')?.status==='fail')addManual(items,{id:'manual-admin-role',title:'ADMIN_ROLE_ID 수정',detail:'존재하지 않는 역할 ID는 로컬 설정 값이므로 SETTINGS.cmd 또는 config.local.json에서 올바른 역할 ID로 수정하세요.',severity:'fail'});
  if(checkBy(audit,'role-hierarchy')?.status==='warn')addManual(items,{id:'manual-role-hierarchy',title:'역할 hierarchy 확인',detail:'닉네임 변경 대상보다 봇 최고 역할이 위에 있어야 합니다. 역할 순서는 자동 이동하지 않습니다.'});

  const counts={safe:items.filter(i=>i.kind==='safe').length,manual:items.filter(i=>i.kind==='manual').length,blocked:items.filter(i=>i.kind==='blocked').length};
  const status=counts.blocked||items.some(i=>i.severity==='fail')?'fail':counts.safe||counts.manual?'warn':'pass';
  const payload={guildId:audit.guild?.id||'',adminRoleId:audit.adminRole?.id||'',manageGuildPermissionValue:audit.manageGuildPermissionValue||'',items:items.map(({id,kind,action,changes,blockedReason})=>({id,kind,action,changes,blockedReason}))};
  return {status,digest:digest(payload),counts,items,canApply:counts.safe>0,connected:true,demo:false,generatedAt:Date.now()};
}

export function validateSafeFixSelection(plan,actionIds=[]){
  const ids=[...new Set((actionIds||[]).map(String))].sort();
  if(!ids.length)throw Error('적용할 안전 수정 항목을 선택해 주세요.');
  const allowed=new Map((plan.items||[]).filter(item=>item.kind==='safe'&&item.safe&&item.action).map(item=>[item.action,item]));
  const invalid=ids.filter(id=>!allowed.has(id));
  if(invalid.length)throw Error(`현재 계획에서 자동 적용할 수 없는 항목입니다: ${invalid.join(', ')}`);
  return ids;
}

export function discordFixTargetKey(plan,actionIds=[]){
  const ids=validateSafeFixSelection(plan,actionIds);
  return `discord-fix:${plan.digest}:${ids.join(',')}`;
}

export const DISCORD_EXPECTED_COMMANDS=EXPECTED_COMMANDS;
