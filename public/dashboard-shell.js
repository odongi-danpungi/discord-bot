export const DASHBOARD_TABS = Object.freeze({
  naversearch:{title:'네이버 카페 검색',section:'네이버',shortcut:''},
  navermonitor:{title:'네이버 새 글 감시·알림',section:'네이버',shortcut:''},
  naverqueue:{title:'네이버 시참 접수',section:'네이버',shortcut:''},
  naverwrite:{title:'네이버 카페 게시글 작성',section:'네이버',shortcut:''},
  naver:{title:'네이버 카페 운영',section:'네이버',shortcut:''},
  discord:{title:'Discord 서버 운영',section:'디스코드',shortcut:''},
  home:{title:'방송 운영 대시보드',section:'방송 운영',shortcut:'Alt+0'},
  preflight:{title:'방송 시작 전 점검',section:'방송 운영',shortcut:''},
  runbook:{title:'방송 Runbook · 운영자 인수인계',section:'방송 운영',shortcut:''},
  broadcastarchive:{title:'방송 아카이브 · Post-Show Report',section:'방송 운영',shortcut:''},
  live:{title:'방송 라이브 모드',section:'방송 운영',shortcut:'Alt+1'},
  operate:{title:'시참 컨트롤 센터',section:'방송 운영',shortcut:'Alt+2'},
  broadcast:{title:'방송 장면 설정',section:'방송 운영',shortcut:'Alt+3'},
  members:{title:'참가자 정보',section:'참여자',shortcut:''},
  history:{title:'회차·운영 기록',section:'참여자',shortcut:''},
  recovery:{title:'복구·감사 센터',section:'시스템 상태',shortcut:''},
  runtime:{title:'런타임·장애 센터',section:'시스템 상태',shortcut:''},
  incidents:{title:'장애 워크플로 센터',section:'시스템 상태',shortcut:''},
  capacity:{title:'성능·용량 센터',section:'시스템 상태',shortcut:''},
  deployment:{title:'배포 준비 센터',section:'배포·보안',shortcut:''},
  release:{title:'릴리스·업데이트 센터',section:'배포·보안',shortcut:''},
  supply:{title:'의존성·공급망 센터',section:'배포·보안',shortcut:''},
  discordaudit:{title:'Discord 권한·설치 감사',section:'배포·보안',shortcut:''},
  settings:{title:'연결·백업',section:'배포·보안',shortcut:''}
});

export const DEFAULT_DASHBOARD_TAB='home';

export function normalizeDashboardTab(value,fallback=DEFAULT_DASHBOARD_TAB){
  const key=String(value||'').trim().replace(/^#/,'').toLowerCase();
  return Object.hasOwn(DASHBOARD_TABS,key)?key:fallback;
}

export function dashboardTabFromHash(hash,fallback=DEFAULT_DASHBOARD_TAB){
  return normalizeDashboardTab(hash,fallback);
}

export function dashboardMeta(tab){
  const key=normalizeDashboardTab(tab);
  return {key,...DASHBOARD_TABS[key]};
}

export function dashboardShortcut(event){
  if(!event?.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return null;
  return ({'0':'home','1':'live','2':'operate','3':'broadcast'})[String(event.key||'')]||null;
}
