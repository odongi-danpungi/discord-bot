import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDashboardFeedback, feedbackAriaRole, sanitizeFeedbackMessage, upsertDashboardFeedback } from '../public/dashboard-feedback-v415.js';

test('v4.15.3 feedback normalizes tone, timing, and aria semantics',()=>{
  const success=createDashboardFeedback({id:'ok',tone:'success',message:' 저장 완료 '},1000);
  const error=createDashboardFeedback({id:'bad',tone:'error',message:'실패'},2000);
  assert.equal(success.title,'작업 완료');assert.equal(success.message,'저장 완료');assert.equal(success.timeoutMs,4500);
  assert.equal(error.timeoutMs,10000);assert.equal(feedbackAriaRole('success'),'status');assert.equal(feedbackAriaRole('error'),'alert');
});

test('v4.15.3 feedback redacts common credential-like values before rendering',()=>{
  const text=sanitizeFeedbackMessage('Authorization: abc123 token=secret-value password=hunter2 Bearer eyJ.secret.value');
  assert.doesNotMatch(text,/abc123|secret-value|hunter2|eyJ\.secret\.value/);
  assert.match(text,/\[REDACTED\]/);
});

test('v4.15.3 feedback deduplicates repeated messages and caps visible queue',()=>{
  let queue=[];
  queue=upsertDashboardFeedback(queue,createDashboardFeedback({id:'a',tone:'error',message:'연결 실패'},1000));
  queue=upsertDashboardFeedback(queue,createDashboardFeedback({id:'b',tone:'error',message:'연결 실패'},2000));
  assert.equal(queue.length,1);assert.equal(queue[0].id,'a');assert.equal(queue[0].count,2);
  for(let i=0;i<8;i++)queue=upsertDashboardFeedback(queue,createDashboardFeedback({id:`x${i}`,message:`메시지 ${i}`},10_000+i),{limit:4});
  assert.equal(queue.length,4);assert.equal(queue[0].message,'메시지 7');
});

test('v4.15.3 dashboard exposes toast stack and global mutation progress without unsafe HTML feedback',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="toastStack"/);assert.match(html,/id="actionFeedback"/);assert.match(html,/aria-live="polite"/);
  assert.match(app,/createDashboardFeedback/);assert.match(app,/upsertDashboardFeedback/);assert.match(app,/data-feedback-dismiss/);
  assert.match(app,/\/api\/runtime\/client-metric/);assert.doesNotMatch(app,/toast\.innerHTML\s*=/);
});
