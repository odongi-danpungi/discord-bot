const initialPages={
 start:{title:'처음 참여하는 분을 위한 안내',body:'1. 이용 규칙을 읽고 확인해 주세요.\n2. 사용자 연동에서 치지직 이름과 참여할 게임 정보를 등록하세요.\n3. 시참 또는 내전 모집글에서 참가하기를 누르세요.\n4. 선정되면 준비 완료로 참석을 확인하세요.\n\n다음 판·다다음 판 예약은 같은 게임의 모집 회차를 기준으로 합니다.'},
 rules:{title:'시참 이용 규칙',body:'서로 존중하고 운영자의 진행 안내를 따라 주세요.\n참가할 수 없으면 빠지기 또는 다음 판 예약을 이용해 주세요.\n다른 사람의 계정 정보를 등록하지 마세요.\n\n연동한 치지직 이름과 게임 정보는 운영자가 확인할 수 있습니다. 계정 소유 인증과 자동 전적 조회는 제공하지 않습니다.'},
 faq:{title:'자주 묻는 질문',items:[
  {question:'다음 판과 다다음 판은 어떻게 다른가요?',answer:'같은 게임에서 다음 모집 또는 두 번째 다음 모집에 자동 신청됩니다. 모집 중 참가하기를 누르면 현재 판으로 복귀하고 예약은 취소됩니다.'},
  {question:'두 게임을 모두 등록해야 하나요?',answer:'아니요. 롤 또는 이터널 리턴 중 참여할 게임만 등록하면 됩니다.'},
  {question:'추첨 결과는 어떻게 정하나요?',answer:'배틀은 실제 이동·공격·체력 계산 후 남은 생존자를, 레이스는 결승선 통과 순서를, 사다리는 연결된 당첨 칸을 사용합니다.'},
  {question:'연동 정보를 바꾸고 싶어요.',answer:'/연동 또는 사용자 연동 / 수정 버튼으로 다시 입력해 주세요.'}
 ]}
};
export const GUIDE_KEYS=Object.keys(initialPages);
export function guideState(state){
 return state.guide||{revision:0,pages:Object.fromEntries(GUIDE_KEYS.map(key=>[key,{version:1,published:structuredClone(initialPages[key]),draft:null}])),acknowledgements:[],history:[]};
}
function cleanText(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error(`안내문은 1~${max}자의 텍스트여야 합니다.`);return value.trim()}
export function validateGuide(key,input){
 if(!GUIDE_KEYS.includes(key)||!input||typeof input!=='object'||Array.isArray(input))throw Error('안내 페이지를 확인해 주세요.');
 const title=cleanText(input.title,100);
 if(key!=='faq')return {title,body:cleanText(input.body,3000)};
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>20)throw Error('FAQ는 1~20개까지 등록할 수 있습니다.');
 return {title,items:input.items.map(item=>({question:cleanText(item?.question,120),answer:cleanText(item?.answer,1200)}))};
}
export function editGuide(state,action,{key,content,expectedRevision},now=Date.now()){
 const guide=structuredClone(guideState(state));
 if(!Number.isInteger(expectedRevision)||expectedRevision!==guide.revision){const error=Error('안내문이 변경됐습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.');error.statusCode=409;throw error}
 if(!GUIDE_KEYS.includes(key)||!['draft','publish','discard'].includes(action))throw Error('지원하지 않는 안내문 작업입니다.');
 const page=guide.pages[key];
 if(action==='draft')page.draft=validateGuide(key,content);
 if(action==='publish'){if(!page.draft)throw Error('게시할 초안이 없습니다.');page.published=validateGuide(key,page.draft);page.draft=null;page.version++;page.publishedAt=now;}
 if(action==='discard'){if(!page.draft)throw Error('취소할 초안이 없습니다.');page.draft=null;}
 guide.revision++;guide.history.unshift({action,key,at:now,revision:guide.revision,pageVersion:page.version});guide.history=guide.history.slice(0,100);state.guide=guide;
 return guide;
}
export function acknowledgeRules(state,userId,version,now=Date.now()){
 const guide=structuredClone(guideState(state));
 if(version!==guide.pages.rules.version)throw Error('규칙이 변경됐습니다. 최신 규칙을 읽고 다시 확인해 주세요.');
 if(typeof userId!=='string'||!userId.length)throw Error('사용자 확인이 필요합니다.');
 const previous=guide.acknowledgements.find(a=>a.userId===userId);
 if(previous?.version===version)return;
 guide.acknowledgements=guide.acknowledgements.filter(a=>a.userId!==userId);
 guide.acknowledgements.push({userId,version,at:now});state.guide=guide;
}
export function guideProgress(state,profile,userId){
 const g=guideState(state),s=state.session;
 return {rulesConfirmed:g.acknowledgements.some(a=>a.userId===userId&&a.version===g.pages.rules.version),profileLinked:Boolean(profile?.erNickname||profile?.lolRiotId),joined:Boolean(s&&s.phase!=='ended'&&s.applicants.includes(userId)&&!s.postponed?.includes(userId)),selected:Boolean(s&&s.phase!=='ended'&&s.winners.includes(userId)),attendanceConfirmed:Boolean(s&&s.phase!=='ended'&&s.confirmed.includes(userId)),reservations:(state.reservations||[]).filter(r=>r.userId===userId)};
}
const button=(custom_id,label,style=2)=>({type:2,custom_id,label,style});
export function guideCard(state,profile,userId,key='start',index=0){
 if(!GUIDE_KEYS.includes(key))throw Error('안내 페이지가 없습니다.');
 const guide=guideState(state),page=guide.pages[key],p=page.published,progress=guideProgress(state,profile,userId);
 let description=p.body,footer=`안내 버전 ${page.version}`;
 if(key==='faq'){if(!Number.isInteger(index)||index<0||index>=p.items.length)index=0;const item=p.items[index];description=`**${item.question}**\n\n${item.answer}`;footer+=` · ${index+1}/${p.items.length}`}
 const navigation=[button('guide:start','참여 안내'),button('guide:rules','이용 규칙'),button('guide:faq:0','FAQ')];
 const actions=key==='rules'?[button(`guide:ack:${page.version}`,'규칙을 읽고 확인했습니다',3)]:key==='faq'?[button(`guide:faq:${(index+p.items.length-1)%p.items.length}`,'이전 질문'),button(`guide:faq:${(index+1)%p.items.length}`,'다음 질문')]:[button('register_start','사용자 연동 / 수정',1),button('reservation_view','내 예약 확인')];
 return {content:'',embeds:[{title:p.title,description,footer:{text:footer},fields:[{name:'내 참여 준비',value:`규칙 ${progress.rulesConfirmed?'✅':'⬜'} · 연동 ${progress.profileLinked?'✅':'⬜'} · 현재 판 신청 ${progress.joined?'✅':'⬜'} · 참석 확인 ${progress.attendanceConfirmed?'✅':'⬜'}`}]}],components:[{type:1,components:navigation},{type:1,components:actions}],allowedMentions:{parse:[]}};
}
export function searchGuide(state,query=''){
 if(typeof query!=='string'||query.length>100)throw Error('검색어는 100자 이내로 입력해 주세요.');
 const pages=guideState(state).pages,q=query.trim().toLocaleLowerCase();
 return GUIDE_KEYS.flatMap(key=>key==='faq'?pages.faq.published.items.map((item,index)=>({key,index,title:item.question,body:item.answer})):[{key,title:pages[key].published.title,body:pages[key].published.body}]).filter(item=>`${item.title}\n${item.body}`.toLocaleLowerCase().includes(q));
}
