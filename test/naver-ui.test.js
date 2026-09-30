import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('settings dashboard contains Naver official API controls and unsupported-feature notice',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),js=await readFile(new URL('../public/naver.js',import.meta.url),'utf8'),app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 for(const id of ['naverConnect','naverSearch','naverJoinCafe','naverWriteArticle','naverDisconnect','naverMonitorEnabled','naverMonitorQuery','naverMonitorCafeUrl','naverMonitorSave','naverMonitorRun','naverMonitorEvents','naverParticipationOpen','naverParticipationRegister','naverParticipationCancelSelect','naverParticipationCancel','naverParticipationClose','naverParticipationManualComment','naverParticipationReset','naverParticipationList'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/공식 카페 Open API/);assert.match(html,/새 공개글 감시·Discord 알림/);assert.match(html,/댓글 작성\/삭제/);assert.match(html,/칼바람 시참 순번/);assert.match(html,/칼바람 시참 열기/);assert.match(html,/참가 등록/);assert.match(html,/참가 취소/);assert.match(html,/마감/);assert.match(html,/초기화/);assert.match(html,/비공식 로그인·스크래핑/);assert.match(js,/\/api\/naver\/status/);assert.match(js,/\/api\/naver\/monitor/);assert.match(js,/\/api\/naver\/participation/);assert.match(js,/\/api\/naver\/participation\/close/);assert.match(app,/app\.post\('\/api\/naver\/participation\/close'/);
});
