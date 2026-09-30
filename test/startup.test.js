import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,access,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
const entry=fileURLToPath(new URL('../src/index.js',import.meta.url));
function launch(cwd,port){const child=spawn(process.execPath,[entry,'--demo'],{cwd,env:{...process.env,DEMO_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.output='';child.stdout.on('data',b=>child.output+=b);child.stderr.on('data',b=>child.output+=b);return child}
test('demo starts in isolation, rejects duplicates and restarts after platform termination', {timeout:30000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bot-start-'));const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));let child;
 async function ready(c){for(let i=0;i<300;i++){if(c.output.includes('Dashboard:')&&c.output.includes('연습 모드'))return;if(c.exitCode!==null)throw Error(c.output);await new Promise(r=>setTimeout(r,30))}throw Error('startup timeout')}
 try{
  child=launch(dir,port);await ready(child);const r=await fetch(`http://127.0.0.1:${port}/api/snapshot`);const data=await r.json();assert.equal(data.records.length,20);assert.equal(data.demo,true);
  const duplicate=launch(dir,port);await once(duplicate,'exit');assert.match(duplicate.output,/이미 봇이 실행 중/);
  const ended=once(child,'exit');child.kill('SIGTERM');await ended;
  if(process.platform==='win32'){await access(path.join(dir,'data/demo/operations.json.pid'));t.diagnostic('Windows SIGTERM force-terminates the process; validating crash recovery, not POSIX graceful termination.');}
  else await assert.rejects(access(path.join(dir,'data/demo/operations.json.pid')));
  await writeFile(path.join(dir,'data/demo/operations.json.pid'),String(child.pid));
  child=launch(dir,port);await ready(child);assert.ok(child.output.includes('연습 모드'));
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended}await rm(dir,{recursive:true,force:true})}
});
