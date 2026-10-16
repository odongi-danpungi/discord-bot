import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { discordId } from './workspace-policy.js';

const root=new URL('../public/',import.meta.url),cache=new Map();
const viewer=new Set(['viewer.html','viewer.js','viewer.css','avatar.js','art.js','community-viewer.js']);
const raceAssets=['live-director.js','avatar.js','avatar-legacy.js','art.js','maps.js','draw-engine.js','race-engine.js','race-renderer.js','race-renderer-legacy.js','replay.js'];
const product=new Set(['community.html','community-panel.js','community.css','operation-tools.html','operation-tools.js','practice.html','practice.js','practice-model.js','game-studio.html','game-studio.js','studio-core.js','studio.css','login.css',...raceAssets]);
const broadcast=new Set(['broadcast.html','broadcast.js','broadcast.css','overlay.html','overlay.js','overlay.css',...raceAssets]);
const productTheme='\n:root{background:#e8ede8;color:#253e3b}body{background:#e8ede8;color:#253e3b}section,article,.card{background:#f6f6f0;border-color:#cbd7cf}p,small{color:#5c706a}button{background:#326b60}a{color:#326b60}header{background:#326b60}header a{color:#fff}input:not([type=checkbox]),select,textarea{background:#fafbf6;color:#253e3b;border-color:#bccfc2}[hidden]{display:none!important}\n';
export async function workspaceAsset(req,res,guildId){
  if(req.method!=='GET'||!discordId(guildId))return false;
  const p=req.path;let file,kind;
  if(p==='/broadcast'){
    const query=new URLSearchParams(req.query).toString();res.redirect(303,`/w/${guildId}/broadcast/${query?'?'+query:''}`);return true;
  }
  if(p==='/viewer'||p==='/viewer/'){file='viewer.html';kind='viewer';}
  else if(p.startsWith('/viewer/')){file=p.slice(8);kind='viewer';}
  else if(p==='/broadcast'||p==='/broadcast/'){file='broadcast.html';kind='broadcast';}
  else if(['/broadcast/overlay','/broadcast/overlay/'].includes(p)){file='overlay.html';kind='broadcast';}
  else if(p.startsWith('/broadcast/assets/')){file=p.slice(18);kind='broadcast';}
  else if(p.startsWith('/broadcast/')){file=p.slice(11);kind='broadcast';}
  else{file=p.slice(1);kind='product';}
  if(file?.startsWith('assets/')&&/^assets\/[a-z-]+\.png$/.test(file)){
    const images=new Set(['race-gameplay','maps-atlas','front-character-sheet','design-direction','battle-gameplay']);
    if(!images.has(file.slice(7,-4)))return false;
    res.sendFile(fileURLToPath(new URL(file,root)));return true;
  }
  if(!(kind==='viewer'?viewer:kind==='broadcast'?broadcast:product).has(file))return false;
  if(!cache.has(file))cache.set(file,await readFile(new URL(file,root),'utf8'));
  let text=cache.get(file);const prefix='/w/'+guildId;
  // Product pages share a small public style asset, never the creator login UI.
  text=text.replaceAll('href="/auth/login.css"','href="/login.css"');
  // Rewrite only rooted URLs in these explicitly selected, first-party assets.
  text=text.replace(/(["'`(])\/(?!\/)(api\/|viewer\/|broadcast\/|assets\/|[a-z][a-z0-9.-]+\.(?:js|css|html))/g,(_,quote,url)=>quote+prefix+'/'+url);
  text=text.replaceAll('href="/"',`href="/portal/?server=${guildId}"`);
  text=text.replace(/<script type="module" src="[^\"]*navigation-tree.js"><\/script>/g,'').replace(/<link rel="stylesheet" href="[^\"]*navigation-tree.css">/g,'');
  if(file==='viewer.js')text=text.replace("await api('logout',{});location.reload()",`location.assign('/portal/?server=${guildId}')`);
  if(file==='viewer.html')text=text.replace('<section id="login"','<section id="login" hidden').replace('id="logout" class="secondary compact">로그아웃','id="logout" class="secondary compact">사용자 홈');
  if(file==='game-studio.js')text=text.replace("if(!('EventSource' in window))return;","return; // workspace requests recheck current membership\n");
  if(file==='game-studio.html')text=text.replace(`href="${prefix}/broadcast/"`,`href="/portal/?server=${guildId}&page=obs"`).replace('v4.11 · DATA RELIABILITY','내 방송 공간').replace('v4.11 · Race Director · 저장된 결과 재생','저장된 경기 결과 재생');
  if(file==='operation-tools.js')text=text.replace("location.replace('/auth/login')","location.replace('/portal/auth/login')").replace("$('logout').onclick=async()=>{", `$('logout').onclick=async()=>{location.assign('/portal/?server=${guildId}');return;`);
  if(file==='operation-tools.html'){
    text=text.replace('id="logout">로그아웃','id="logout">사용자 홈').replace('Discord에서 받은 일회용 코드로 접속하면','Discord 계정으로 로그인하면');
    if(['ready','undo'].includes(req.query?.feature)){
      const feature=req.query.feature;
      text=text.replace(/<section(?: id="([^"]+)")?>/g,(match,id)=>id===feature?match:match.slice(0,-1)+' hidden>');
      text=text.replace('<h1>참가자 운영 도구</h1>',`<h1>${feature==='ready'?'경기 준비 확인':'직전 순서 변경 되돌리기'}</h1>`);
    }
  }
  if(file==='community.html'){
    text=text.replace(/<link rel="stylesheet" href="[^\"]*(?:studio-theme|business-theme)\.css">/g,'');
    const features={subscriptions:'알림 구독',fairness:'공정 선발',recruitment:'모집·공지 초안','my-panel':'내 시참 패널',recap:'방송 후기',publication:'게시 미리보기',guide:'규칙·FAQ',tickets:'참가자 문의'},feature=req.query?.feature;
    if(Object.hasOwn(features,feature||'')){
      text=text.replace(/<section id="([^"]+)">/g,(match,id)=>id===feature?match:match.slice(0,-1)+' hidden>');
      text=text.replace('<h1>커뮤니티 운영</h1>',`<h1>${features[feature]}</h1>`);
      text=text.replace(/<nav aria-label="커뮤니티 메뉴">[\s\S]*?<\/nav>/,'');
      // Channel/subscription settings share a single save handler with fairness.
      // Keep that handler's button available on the subscription-only screen.
      if(feature==='subscriptions')text=text.replace('<button id="save-settings">채널·구독·공정성 설정 저장</button>','').replace('</section>','<button id="save-settings">알림 채널·구독 설정 저장</button></section>');
      if(feature==='fairness')text=text.replace('채널·구독·공정성 설정 저장','공정 선발 설정 저장');
      if(['recruitment','recap'].includes(feature))text=text.replace('</main>',`<p><a href="${prefix}/community.html?feature=publication">만든 초안 미리보기·게시 →</a></p></main>`);
    }
  }
  if(['community.css','login.css'].includes(file))text+=productTheme;
  res.type(file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'html').send(text);return true;
}
