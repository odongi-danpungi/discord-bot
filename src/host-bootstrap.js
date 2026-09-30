const LOOPBACK=new Set(['127.0.0.1','localhost','::1']);
const WILDCARD=new Set(['0.0.0.0','::']);
const rank={pass:0,warn:1,fail:2};
const worst=(checks=[])=>checks.reduce((s,c)=>rank[c.status]>rank[s]?c.status:s,'pass');
const clean=(value,max=220)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function platformFromEnv(env={}){
  if(env.RAILWAY_ENVIRONMENT||env.RAILWAY_PROJECT_ID||env.RAILWAY_PUBLIC_DOMAIN)return 'railway';
  if(env.RENDER||env.RENDER_SERVICE_ID||env.RENDER_EXTERNAL_HOSTNAME)return 'render';
  if(env.FLY_APP_NAME||env.FLY_ALLOC_ID)return 'fly';
  if(env.K_SERVICE||env.K_REVISION)return 'cloud-run';
  if(env.DOCKER_CONTAINER||env.CONTAINER)return 'container';
  return 'generic';
}
function publicOrigin(config={},env={}){
  const explicit=clean(config.publicBaseUrl,500);
  if(explicit)return explicit;
  const railway=clean(env.RAILWAY_PUBLIC_DOMAIN,300);
  if(railway)return `https://${railway.replace(/^https?:\/\//,'').replace(/\/+$/,'')}/`;
  const render=clean(env.RENDER_EXTERNAL_HOSTNAME,300);
  if(render)return `https://${render.replace(/^https?:\/\//,'').replace(/\/+$/,'')}/`;
  return '';
}
function check(id,label,status,detail,action='',required=true){return {id,label,status,detail:clean(detail),action:clean(action),required:Boolean(required)};}

export function buildHostBootstrap({config={},env=process.env,nodeVersion=process.versions.node}={}){
  const host=clean(config.host)||'127.0.0.1',port=Number(config.port)||3000,trustProxyHops=Math.max(0,Number(config.trustProxyHops)||0);
  const loopback=LOOPBACK.has(host),wildcard=WILDCARD.has(host),platform=platformFromEnv(env),baseUrl=publicOrigin(config,env);
  const externalBinding=!loopback;
  const publicHttps=baseUrl.startsWith('https://');
  const checks=[];
  checks.push(check('profile','Production 실행 프로필',config.profile==='production'?'pass':'fail',config.profile==='production'?'production 프로필':'현재 프로필: '+clean(config.profile),'APP_PROFILE=production으로 실행하세요.'));
  checks.push(check('bind','서비스 바인딩',externalBinding?'pass':'warn',loopback?`${host}:${port} · localhost 전용`:`${host}:${port} · 외부/컨테이너 바인딩`,loopback?'컨테이너/원격 호스트에서는 HOST=0.0.0.0을 사용하고 외부 노출은 HTTPS 프록시 뒤에서 처리하세요.':'바인딩 주소는 준비되었습니다.',false));
  checks.push(check('public-url','HTTPS Public Base URL',!externalBinding?'pass':publicHttps?'pass':'fail',baseUrl?baseUrl:'PUBLIC_BASE_URL 미설정',externalBinding&&!publicHttps?'외부 호스트에서는 PUBLIC_BASE_URL=https://... 를 설정하세요.':'공개 주소가 있으면 OAuth/Viewer URL과 동일한 HTTPS origin인지 확인하세요.',externalBinding));
  checks.push(check('proxy','Reverse Proxy 신뢰 범위',!externalBinding?'pass':trustProxyHops>0?'pass':'warn',trustProxyHops>0?`신뢰 프록시 hop ${trustProxyHops}`:'TRUST_PROXY_HOPS=0',externalBinding&&trustProxyHops===0?'HTTPS 프록시 뒤에서 운영하면 실제 client IP/secure scheme 처리를 위해 정확한 hop 수만 설정하세요.':'프록시 hop 범위를 과도하게 넓히지 마세요.',false));
  const authReady=Boolean(config.dashboardPassword&&String(config.dashboardPassword).length>=12);
  checks.push(check('auth','관리 대시보드 인증',authReady?'pass':'fail',authReady?'관리자 비밀번호 설정됨':'관리자 비밀번호 미설정/부족','DASHBOARD_PASSWORD를 충분히 긴 고유 값으로 설정하세요.'));
  checks.push(check('health','Health Check 계약','pass',`GET /healthz · 종료 중 503 · 정상 200`,'호스팅 플랫폼의 health check 경로를 /healthz로 설정하세요.'));
  checks.push(check('shutdown','Graceful Shutdown 계약','pass','SIGTERM/SIGINT 수신 → HTTP drain → persistent store flush → Discord client 종료','재시작 정책은 SIGTERM을 보내고 최소 12초 종료 유예를 제공하세요.'));
  checks.push(check('storage','Persistent data 경로','pass','./data 및 ./data/backups 영속 저장 필요','컨테이너/호스트 재배포에도 data 디렉터리가 유지되도록 볼륨을 연결하세요.'));
  const status=worst(checks.filter(c=>c.required));
  const launchable=!checks.some(c=>c.required&&c.status==='fail');
  const localHealth=`http://127.0.0.1:${port}/healthz`;
  const publicHealth=baseUrl?new URL('/healthz',baseUrl).toString():'';
  return {
    schema:'daengdaeng-host-bootstrap-v1',checkedAt:Date.now(),status,launchable,platform,
    binding:{host,port,loopback,wildcard,external:externalBinding},
    proxy:{trustProxyHops,enabled:trustProxyHops>0},
    public:{baseUrl,https:publicHttps,healthUrl:publicHealth,viewerUrl:clean(config.viewerUrl,500)},
    health:{path:'/healthz',localUrl:localHealth,expectedReadyStatus:200,expectedDrainingStatus:503},
    runtime:{nodeVersion:clean(nodeVersion,40),startCommand:'npm start',stopSignals:['SIGTERM','SIGINT'],gracefulTimeoutSeconds:10,recommendedStopGraceSeconds:12},
    persistence:{paths:['./data','./data/backups'],required:true},
    checks,
    actions:checks.filter(c=>c.status!=='pass').map(c=>({id:c.id,status:c.status,title:c.label,detail:c.action||c.detail,required:c.required}))
  };
}
