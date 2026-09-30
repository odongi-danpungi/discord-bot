import { randomUUID, randomInt } from 'node:crypto';
import { guideState } from './guide.js';

export const TOPICS = Object.freeze({aram:'칼바람 모집',rift:'협곡 모집',er:'이터널 리턴 모집',live:'방송 시작'});
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const text=(value,max,required=true)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||(required&&!value.trim()))throw fail(`내용을 확인해 주세요 (최대 ${max}자).`);return value.trim();};
const id=value=>{if(!/^\d{17,20}$/.test(value||''))throw fail('Discord ID를 확인해 주세요.');return value;};
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const communityState=state=>structuredClone(state.community||{revision:0,settings:{channelId:'',roles:{},fairness:{enabled:false,unplayedFirst:true,waitFirst:true,maxConsecutive:0,newcomerSlots:0}},drafts:[],tickets:[],subscriptions:[],audit:[],panel:null});
export function fairnessLabel(policy={}){return !policy.enabled?'무작위 추첨':`공정 선발 · ${policy.unplayedFirst?'오늘 미참가 우선 · ':''}${policy.waitFirst?'접수 순서 우선 · ':''}연속 ${policy.maxConsecutive||'제한 없음'} · 신규 ${policy.newcomerSlots||0}석`}
export function fairSelect(state,eligible,count,now=Date.now(),rng=randomInt){
  const p=state.session?.communityFairness||communityState(state).settings.fairness;
  if(!p.enabled)return null;
  const archive=(state.sessionArchive||[]).filter(s=>s.game===state.session?.game&&s.mode===state.session?.mode);
  const day=t=>new Date(t+9*3600000).toISOString().slice(0,10);
  const played=(s,u)=>(s.confirmed||[]).includes(u);
  const pool=[...new Set(eligible)].map((userId,order)=>{
    let streak=0;for(const s of archive){if(!played(s,userId))break;streak++;}
    return {userId,order,streak,today:archive.some(s=>day(s.endedAt)===day(now)&&played(s,userId)),fresh:!archive.some(s=>played(s,userId)),tie:rng(0x7fffffff)};
  }).filter(u=>!p.maxConsecutive||u.streak<p.maxConsecutive);
  if(pool.length<count)throw fail('공정성 규칙을 만족하는 인원이 부족합니다. 모집을 다시 열거나 인원을 줄여 주세요.');
  const sort=(a,b)=>(p.unplayedFirst?Number(a.today)-Number(b.today):0)||(p.waitFirst?a.order-b.order:0)||a.tie-b.tie;
  pool.sort(sort);const selected=pool.filter(u=>u.fresh).slice(0,Math.min(p.newcomerSlots,count));
  for(const u of pool){if(selected.length===count)break;if(!selected.includes(u))selected.push(u);}
  return selected.map(u=>u.userId);
}
export function publicOrigin(config){try{const u=new URL(config.publicBaseUrl||config.viewerUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error();return u.origin;}catch{throw fail('먼저 공개 HTTPS 주소를 설정해 주세요.');}}
export function communityView(operations,userId){
  const state=operations.read(),c=communityState(state),guide=guideState(state);
  if(!userId)return {...c,guide,session:state.session?{id:state.session.id,title:state.session.title,phase:state.session.phase,fairness:fairnessLabel(state.session.communityFairness||c.settings.fairness)}:null,archives:(state.sessionArchive||[]).map(s=>({id:s.id,title:s.title,endedAt:s.endedAt}))};
  return {topics:TOPICS,subscriptions:c.subscriptions.filter(s=>s.userId===userId),tickets:c.tickets.filter(t=>t.userId===userId),history:(state.sessionArchive||[]).filter(s=>s.applicants.includes(userId)).slice(0,10).map(s=>({title:s.title,endedAt:s.endedAt,attended:s.confirmed.includes(userId)})),guide:guide.pages,fairness:fairnessLabel(state.session?.communityFairness||c.settings.fairness)};
}
export class CommunityService {
  constructor({operations,config,discord,naver,guard=()=>{}}){Object.assign(this,{operations,config,discord,naver,guard});this.pending=new Set();}
  async mutate(fn,expected){await this.operations.update(state=>{const c=communityState(state);if(expected!==undefined&&expected!==c.revision)throw fail('다른 창에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.',409);fn(c,state);c.revision++;state.community=c;});}
  async settings(body){this.guard();await this.mutate(c=>{
    const f=body.fairness||{};for(const k of ['enabled','unplayedFirst','waitFirst'])if(typeof f[k]!=='boolean')throw fail('공정성 설정을 확인해 주세요.');
    for(const [k,max] of [['maxConsecutive',20],['newcomerSlots',50]])if(!Number.isInteger(f[k])||f[k]<0||f[k]>max)throw fail('공정성 숫자 범위를 확인해 주세요.');
    const roles={};for(const topic of Object.keys(TOPICS)){const value=body.roles?.[topic]||'';roles[topic]=value?id(value):'';if(roles[topic]===this.config.guildId)throw fail('@everyone 역할은 사용할 수 없습니다.');}
    const old=c.settings.roles||{};if(c.subscriptions.some(s=>(s.enabled||s.status!=='active')&&old[s.topic]!==roles[s.topic]))throw fail('구독 중이거나 적용 확인 중인 역할은 변경할 수 없습니다. 기존 구독을 해제한 후 변경하세요.');
    if(new Set(Object.values(roles).filter(Boolean)).size!==Object.values(roles).filter(Boolean).length)throw fail('주제별로 서로 다른 알림 전용 역할을 선택하세요.');
    c.settings={channelId:body.channelId?id(body.channelId):'',roles,fairness:{enabled:f.enabled,unplayedFirst:f.unplayedFirst,waitFirst:f.waitFirst,maxConsecutive:f.maxConsecutive,newcomerSlots:f.newcomerSlots}};
  },body.revision);}
  async draft(body){this.guard();let saved;await this.mutate((c,state)=>{
    if(c.drafts.length>=100)throw fail('초안은 최대 100개입니다. 사용하지 않는 초안을 삭제하세요.');
    const kind=body.kind;if(!['notice','recruitment','recap'].includes(kind))throw fail('공지 종류를 선택하세요.');
    const topic=Object.hasOwn(TOPICS,body.topic)?body.topic:'live';
    let title=text(body.title||'방송 안내',150),content=text(body.content||'',1200,false),sessionId=null;
    if(kind==='recruitment'){
      const s=state.session;if(!s||s.phase!=='open')throw fail('컨트롤 센터에서 모집을 먼저 열어 주세요.');
      sessionId=s.id;title=s.title.slice(0,150);const url=`${publicOrigin(this.config)}/viewer/?session=${encodeURIComponent(s.id)}`;
      content=`${content}\n${s.count}명 모집 · ${s.game==='er'?'이터널 리턴':s.mode==='aram'?'칼바람':'협곡'}\n${fairnessLabel(s.communityFairness||c.settings.fairness)}\n신청: ${url}\nDiscord에서 사용자 연동 후 일회용 코드로 로그인하세요. 카페 댓글은 자동 접수되지 않습니다.`.trim();
    }
    if(kind==='recap'){
      const s=(state.sessionArchive||[]).find(s=>s.id===body.archiveId);if(!s)throw fail('종료된 회차를 선택하세요.');
      title=`${s.title} · 방송 후기`.slice(0,150);content=`${s.round}회차 · 신청 ${s.applicants.length}명 · 참가 확인 ${s.confirmed.length}명\n${content}`.trim();
    }
    if(content.length>1600)throw fail('안내 내용이 너무 깁니다.');
    saved={id:randomUUID(),kind,topic,title,content,sessionId,createdAt:Date.now(),delivery:{discord:{status:'draft'},naver:{status:'draft'}}};c.drafts.unshift(saved);
  },body.revision);return saved;}
  async removeDraft(body){this.guard();await this.mutate(c=>{const d=c.drafts.find(d=>d.id===body.id);if(!d)throw fail('초안이 없습니다.');if(Object.values(d.delivery).some(x=>['sending','uncertain'].includes(x.status)))throw fail('전송 결과를 먼저 확인해 주세요.');c.drafts=c.drafts.filter(x=>x.id!==body.id);},body.revision);}
  async publish(body){
    this.guard();if(body.confirm!=='게시')throw fail('미리보기를 확인하고 게시 버튼을 눌러 주세요.');
    const targets=[...new Set(body.targets||[])];if(!targets.length||targets.some(x=>!['discord','naver'].includes(x)))throw fail('게시 대상을 선택하세요.');
    for(const target of targets){
      this.guard();let draft,settings;const key=`${body.id}:${target}`;
      await this.mutate((c,state)=>{
        draft=c.drafts.find(d=>d.id===body.id);if(!draft)throw fail('초안이 없습니다.');
        if(draft.kind==='recruitment'&&(state.session?.id!==draft.sessionId||state.session?.phase!=='open'))throw fail('모집 상태가 변경되었습니다. 새 초안을 만들어 주세요.');
        const previous=draft.delivery[target];if(previous.status==='sent')return;
        if(['sending','uncertain'].includes(previous.status))throw fail('전송 결과가 불확실합니다. 외부 게시물을 확인한 뒤 결과 확인 버튼을 사용하세요.',409);
        if(c.drafts.some(d=>d.topic===draft.topic&&Date.now()-(d.delivery[target]?.at||0)<60000&&['sent','sending','uncertain'].includes(d.delivery[target]?.status)))throw fail('같은 주제는 1분 후 다시 게시할 수 있습니다.',429);
        settings=c.settings;
        if(target==='discord'&&!settings.channelId)throw fail('Discord 공지 채널 ID를 먼저 설정하세요.');
        if(target==='naver'&&!this.naver)throw fail('네이버 연결을 먼저 설정하세요.');
        draft.delivery[target]={status:'sending',at:Date.now()};draft=structuredClone(draft);
      });
      if(!settings)continue;
      this.pending.add(key);
      let result,status='sent';
      try{
        this.guard();
        result=this.config.demo?{id:'demo-discord',articleId:'demo-naver'}:target==='discord'?await this.discord.communityNotice({channelId:settings.channelId,title:draft.title,content:draft.content,roleId:settings.roles[draft.topic]||''}):await this.naver.writeArticle({subject:draft.title,content:html(draft.content).replace(/\n/g,'<br>')});
      }catch{status='uncertain';result=null;}
      try{await this.mutate(c=>{const d=c.drafts.find(d=>d.id===body.id);d.delivery[target]={status,at:Date.now(),...(status==='sent'?{reference:target==='discord'?String(result?.id||''):String(result?.articleId||'')}:{reason:'전송 결과를 확인할 수 없습니다. 게시 대상에서 확인하세요.'})};});}
      finally{this.pending.delete(key);}
    }
    return communityView(this.operations);
  }
  async resolve(body){this.guard();if(this.pending.has(`${body.id}:${body.target}`))throw fail('아직 전송 중입니다.',409);await this.mutate(c=>{const d=c.drafts.find(d=>d.id===body.id),delivery=d?.delivery?.[body.target];if(!delivery||!['sending','uncertain'].includes(delivery.status))throw fail('확인할 전송이 없습니다.');if(!['sent','draft'].includes(body.status))throw fail('게시 결과를 선택하세요.');const reason=text(body.reason,200);delivery.status=body.status;delivery.at=Date.now();c.audit.unshift({at:Date.now(),action:'delivery-resolved',draftId:d.id,target:body.target,status:body.status,reason});c.audit=c.audit.slice(0,100);},body.revision);}
  async ticket(userId,body){this.guard();if(!(this.config.demo&&/^demo-\d+$/.test(userId)))id(userId);await this.mutate((c,state)=>{
    c.tickets=c.tickets.filter(t=>t.status!=='closed'||Date.now()-t.updatedAt<30*86400000);
    if(c.tickets.length>=500||c.tickets.filter(t=>t.userId===userId&&t.status==='open').length>=3)throw fail('열린 문의가 많습니다. 기존 답변을 먼저 확인하세요.');
    if(c.tickets.some(t=>t.userId===userId&&Date.now()-t.createdAt<60000))throw fail('문의는 1분 후 다시 등록할 수 있습니다.',429);
    c.tickets.unshift({id:randomUUID(),userId,sessionId:state.session?.id||null,message:text(body.message,1000),answer:'',status:'open',createdAt:Date.now(),updatedAt:Date.now()});
  });}
  async answer(body){this.guard();await this.mutate(c=>{const t=c.tickets.find(t=>t.id===body.id);if(!t)throw fail('문의를 찾지 못했습니다.');t.answer=text(body.answer,1500);t.status=body.close?'closed':'open';t.updatedAt=Date.now();},body.revision);}
  async subscribe(userId,body){
    this.guard();if(!(this.config.demo&&/^demo-\d+$/.test(userId)))id(userId);if(!Object.hasOwn(TOPICS,body.topic)||typeof body.enabled!=='boolean')throw fail('알림 설정을 확인하세요.');
    const key=`subscription:${userId}:${body.topic}`;if(this.pending.has(key))throw fail('알림 설정을 적용 중입니다.',409);this.pending.add(key);
    try{
      const settings=communityState(this.operations.read()).settings,roleId=settings.roles[body.topic];if(!roleId)throw fail('운영자가 알림 전용 역할을 먼저 설정해야 합니다.');
      await this.mutate(c=>{if(c.subscriptions.length>=20000&&!c.subscriptions.some(x=>x.userId===userId&&x.topic===body.topic))throw fail('구독 저장 한도에 도달했습니다.');const old=c.subscriptions.find(x=>x.userId===userId&&x.topic===body.topic);const next={userId,topic:body.topic,enabled:body.enabled,status:'pending',updatedAt:Date.now()};if(old)Object.assign(old,next);else c.subscriptions.push(next);});
      let status='active';try{await this.discord.communitySubscription({userId,roleId,enabled:body.enabled});}catch{status='needs_retry';}
      await this.mutate(c=>{const s=c.subscriptions.find(x=>x.userId===userId&&x.topic===body.topic);s.status=status;});
      if(status!=='active')throw fail('Discord 역할을 적용하지 못했습니다. 권한 확인 후 같은 버튼으로 다시 시도하세요.',503);
    }finally{this.pending.delete(key);}
  }
  async panel(){
    this.guard();
    if(this.pending.has('panel'))throw fail('개인 메뉴를 게시 중입니다. 잠시 후 확인하세요.',409);
    this.pending.add('panel');
    try{
      const c=communityState(this.operations.read());
      if(!c.settings.channelId)throw fail('공지 채널 ID를 먼저 설정하세요.');
      const ref=await this.discord.communityPanel({channelId:c.settings.channelId,ref:c.panel});
      await this.mutate(s=>{s.panel=ref;});
    }finally{this.pending.delete('panel');}
  }
}
const services=new WeakMap();
export function communityFor(options){let service=services.get(options.operations);if(!service){service=new CommunityService(options);services.set(options.operations,service);}else Object.assign(service,options);return service;}
