import { safeProbeError } from './connector-verification.js';

const labels={discord:'Discord',naver:'Naver OAuth',chzzk:'CHZZK',public:'Public HTTPS'};
const reasons={OK:'연결 확인 완료',NOT_CONFIGURED:'필수 연결 설정 누락',NOT_PROBED:'실제 연결 검사 전',STALE:'최근 결과 만료 또는 시각 불일치',CONNECTION_FAILED:'연결 실패',ETIMEDOUT:'응답 시간 초과',INVALID_PUBLIC_URL:'공개 HTTPS 주소 또는 DNS 확인 필요',INVALID_RESPONSE:'응답 형식 오류',VERSION_MISMATCH:'공개 주소의 배포 버전 불일치',NOT_READY:'외부 서비스 수신 불가 또는 긴급 잠금',NOT_CONNECTED:'Discord 연결 미확인',PERMISSION_DENIED:'Discord 필수 권한 확인 실패',OAUTH_RECONNECT_REQUIRED:'Naver 계정 재연결 필요',CHANNEL_NOT_FOUND:'CHZZK 대상 채널 없음',PROBE_BUSY:'이전 요청 종료 대기'};
const stableReleases=new Set(['idle','smoke-passed','staged','verify-failed','crash-recovered']);
const check=(id,label,ok,detail)=>({id,label,status:ok?'pass':'fail',required:true,detail});

export class ProductionMonitor {
  constructor({config={},probe,clock=Date.now,ttlMs=120000,cooldownMs=30000}={}) {
    this.config=config;this.probe=probe;this.clock=clock;this.ttlMs=ttlMs;this.cooldownMs=cooldownMs;
    this.latest=null;this.history=[];this.pending=null;this.nextProbeAt=0;
  }
  async run() {
    if(this.pending)return this.pending;
    const now=this.clock();
    if(now<this.nextProbeAt)throw Object.assign(Error('연결 검사를 너무 자주 요청했습니다. 잠시 후 다시 실행하세요.'),{status:429,code:'MONITOR_COOLDOWN',retryAfterMs:this.nextProbeAt-now});
    this.nextProbeAt=now+this.cooldownMs;
    // Invalidate previous evidence while a new probe is in progress.
    this.pending=(async()=>{
      let probes;try{probes=await this.probe();}catch{probes={};}
      const completed=this.clock();
      const safe={};
      for(const key of Object.keys(labels)){
        const value=probes?.[key];if(!value)continue;
        safe[key]={ok:value.ok===true,channelFound:value.channelFound===true,status:Number.isInteger(value.status)?value.status:0,durationMs:Number.isFinite(value.durationMs)?Math.max(0,value.durationMs):0,...(value.ok===true?{}:{error:safeProbeError(value.error)})};
      }
      this.latest={checkedAt:completed,probes:safe};
      const limited=Object.values(safe).filter(value=>value.error?.status===429);
      const retry=Math.max(0,...limited.map(value=>value.error.retryAfterMs||60000));
      this.nextProbeAt=Math.max(this.nextProbeAt,completed+this.cooldownMs,completed+retry);
      this.history.unshift({checkedAt:completed,results:Object.entries(safe).map(([id,value])=>({id,status:value.ok?'pass':'fail',code:value.ok?'OK':value.error.code,httpStatus:value.error?.status||0,durationMs:value.durationMs}))});
      this.history.length=Math.min(20,this.history.length);
      return structuredClone(safe);
    })();
    try{return await this.pending;}finally{this.pending=null;}
  }
  snapshot({runtime=null,incidents=null,releaseState=null,emergency=null,draining,environment=null,recovering=false}={}) {
    const now=this.clock(),latest=this.latest,age=latest?now-latest.checkedAt:null,fresh=latest&&age>=0&&age<this.ttlMs&&!this.pending;
    const c=this.config;
    const configured={discord:Boolean(c.token&&c.clientId&&c.guildId),naver:Boolean(c.naverClientId&&c.naverClientSecret&&c.naverRedirectUri),chzzk:Boolean(c.chzzkClientId&&c.chzzkClientSecret&&c.chzzkChannelId),public:Boolean(c.publicBaseUrl)};
    const checks=Object.entries(labels).map(([id,label])=>{
      const p=latest?.probes[id];
      const code=!configured[id]?'NOT_CONFIGURED':!p?'NOT_PROBED':!fresh?'STALE':p.ok?'OK':safeProbeError(p.error).code;
      const httpStatus=p?.error?.status||0;
      return {...check(id,label,code==='OK',`${reasons[code]||reasons.CONNECTION_FAILED}${httpStatus?` · HTTP ${httpStatus}`:''}`),code,httpStatus,durationMs:p?.durationMs||0};
    });
    checks.push(check('runtime','Runtime Health',runtime?.status==='pass','현재 런타임 정상 상태 필요'));
    const counts=incidents?.counts,known=counts&&['critical','warning','totalActive'].every(key=>Number.isInteger(counts[key])&&counts[key]>=0);
    checks.push(check('incidents','Critical Incident',Boolean(known)&&counts.critical===0,'장애 상태 확인 및 CRITICAL 0건 필요'));
    checks.push(check('release','Restart / Rollback / Recovery',stableReleases.has(releaseState?.status)&&recovering===false,'미확인·재시작·롤백·복구 대기 상태는 차단'));
    checks.push(check('service','Draining / Emergency Lock',draining===false&&emergency?.locked===false,'수신 가능 상태이며 긴급 잠금이 해제되어야 함'));
    checks.push(check('environment','Production Environment',environment?.status==='pass'&&c.demo!==true,'실제 운영 환경 변수 검증 통과 필요'));
    const blockers=checks.filter(item=>item.status==='fail'),ready=blockers.length===0;
    return {schema:'daengdaeng-production-monitoring-v1',checkedAt:now,lastProbedAt:latest?.checkedAt??null,expiresAt:latest?latest.checkedAt+this.ttlMs:null,ttlMs:this.ttlMs,inFlight:Boolean(this.pending),nextProbeAt:this.nextProbeAt,status:ready?'pass':'fail',ready,checks,counts:{pass:checks.length-blockers.length,fail:blockers.length,warn:0,blocking:blockers.length,total:checks.length},summary:ready?'최근 연결 및 현재 운영 상태 검증 통과':'운영 승인 차단: 실패·미확인·만료 항목을 확인하세요.',history:structuredClone(this.history),policy:{readOnly:true,persistent:false,historyLimit:20,cooldownMs:this.cooldownMs,allConnectorsRequired:true}};
  }
}
