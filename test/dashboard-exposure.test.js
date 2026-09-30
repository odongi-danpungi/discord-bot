import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { dashboardExposureWarning } from '../src/dashboard-exposure.js';
const config={host:'0.0.0.0',dashboardPassword:'test-only-password',demo:false};
test('public HTTPS with administrator authentication has no generic exposure warning',()=>{
 assert.equal(dashboardExposureWarning(config,true),'');
 assert.ok(dashboardExposureWarning(config,false));
 assert.ok(dashboardExposureWarning({...config,demo:true},true));
 assert.ok(dashboardExposureWarning({...config,dashboardPassword:''},true));
});
test('forwarded HTTPS is accepted only when proxy trust is explicitly configured',async()=>{
 for(const hops of [0,1]){
  const app=express();if(hops)app.set('trust proxy',hops);
  app.get('/',(req,res)=>res.json({warning:dashboardExposureWarning(config,req.secure)}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/`,{headers:{'X-Forwarded-Proto':'https'}});const result=await response.json();assert.equal(Boolean(result.warning),hops===0);}
  finally{await new Promise(resolve=>server.close(resolve));}
 }
});
