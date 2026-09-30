export const DASHBOARD_CONTENT_STATE = Object.freeze({
  idle:{icon:'',title:'',detail:'',retry:false},
  loading:{icon:'…',title:'대시보드 정보를 불러오는 중',detail:'최신 방송·참가자·시스템 상태를 동기화하고 있습니다.',retry:false},
  empty:{icon:'○',title:'표시할 정보가 없습니다',detail:'조건을 바꾸거나 새로고침해 다시 확인해 주세요.',retry:false},
  error:{icon:'!',title:'대시보드 정보를 불러오지 못했습니다',detail:'네트워크 연결과 봇 서버 상태를 확인한 뒤 다시 시도해 주세요.',retry:true}
});

export function normalizeContentState(value){
  const key=String(value||'').trim().toLowerCase();
  return Object.hasOwn(DASHBOARD_CONTENT_STATE,key)?key:'idle';
}

export function dashboardContentState(value,overrides={}){
  const kind=normalizeContentState(value),base=DASHBOARD_CONTENT_STATE[kind];
  return {
    kind,
    icon:String(overrides.icon??base.icon),
    title:String(overrides.title??base.title),
    detail:String(overrides.detail??base.detail),
    retry:Boolean(overrides.retry??base.retry)
  };
}

export const MEMBER_TABLE_LABELS=Object.freeze(['선택','Discord / 치지직','이터널 리턴','리그 오브 레전드','수정 시간']);
