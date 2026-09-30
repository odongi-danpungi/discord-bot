import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {acquireProcessLock} from '../src/process-lock.js';
test('restart recovers a stale self PID while repeated acquisition remains blocked',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bot-pid-reuse-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'bot.pid');
 await writeFile(file,JSON.stringify({pid:process.pid,instanceId:'previous-container',createdAt:1}));
 const lock=await acquireProcessLock({file});assert.equal(lock.previousCrash.detected,true);assert.equal(lock.previousCrash.instanceId,'previous-container');
 await assert.rejects(acquireProcessLock({file}),{code:'EINSTANCEACTIVE'});
 await lock.release();const next=await acquireProcessLock({file});await next.release();
});
