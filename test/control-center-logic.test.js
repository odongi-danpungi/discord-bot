import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendedAction } from '../public/control-center.js';

test('all confirmed winners can form teams before the attendance deadline',()=>{
 const now=1_000;
 const s={phase:'checking',deadline:now+60_000,count:2,teams:[]};
 const action=recommendedAction({s,ready:['u1','u2'],pending:[],active:true},now);
 assert.equal(action.action,'teams');
 assert.equal(action.disabled,false);
});

test('pending confirmations wait before the deadline and replace after it',()=>{
 const s={phase:'checking',deadline:5_000,count:2,teams:[]};
 const before=recommendedAction({s,ready:['u1','u2'],pending:['u2'],active:true},4_000);
 assert.equal(before.action,null);
 assert.equal(before.disabled,true);
 const after=recommendedAction({s,ready:['u1','u2'],pending:['u2'],active:true},6_000);
 assert.equal(after.action,'replace');
 assert.equal(after.disabled,false);
});
