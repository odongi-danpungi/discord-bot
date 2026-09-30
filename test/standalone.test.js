import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { RegistrationStore } from '../src/store.js';
import { OperationsStore } from '../src/operations.js';
import { DemoDiscordService } from '../src/discord-service.js';
test('standalone draw works without a recruitment session and does not publish to Discord',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'standalone-'));let server;
 try{const store=new RegistrationStore(path.join(dir,'r.json')),operations=new OperationsStore(path.join(dir,'o.json')),discord=new DemoDiscordService();await store.init();await operations.init();for(let i=0;i<3;i++)await store.upsert({guildId:'g',discordId:'u'+i,chzzkName:'이름'+i});
 const {app}=createApp({config:{host:'127.0.0.1',demo:true,guildId:'g'},store,operations,discord});server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const base='http://127.0.0.1:'+server.address().port,{csrf}=await(await fetch(base+'/api/snapshot')).json();
 const r=await fetch(base+'/api/operations/draw',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({requestId:randomUUID(),sessionId:null,scope:'all',count:2,drawMode:'race'})});const data=await r.json();assert.equal(r.status,200);assert.equal(data.draw.winners.length,2);assert.equal(data.state.session,null);assert.equal(discord.messages.length,0);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}await rm(dir,{recursive:true,force:true})}
});
