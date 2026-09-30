import { createHash } from 'node:crypto';
import { JsonStore } from './json-store.js';

const STATES=new Set(['pending','completed','uncertain']);
const validEntry=entry=>entry&&typeof entry==='object'&&typeof entry.token==='string'&&/^[a-f0-9]{64}$/.test(entry.token)&&typeof entry.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(entry.fingerprint)&&STATES.has(entry.status)&&typeof entry.ownerBootId==='string'&&Number.isFinite(entry.createdAt)&&Number.isFinite(entry.updatedAt)&&Number.isFinite(entry.expiresAt)&&(entry.responseStatus===null||entry.responseStatus===undefined||Number.isInteger(entry.responseStatus));
const validState=value=>value&&typeof value==='object'&&value.version===1&&Array.isArray(value.entries)&&value.entries.every(validEntry);
const tokenFor=(scope,key)=>createHash('sha256').update(`${scope}\u0000${key}`).digest('hex');

export class PersistentIdempotencyStore extends JsonStore {
  constructor(file,{maxEntries=2048,persistentTtlMs=24*60*60*1000}={}){
    super(file,{version:1,entries:[]},validState);this.maxEntries=Math.max(128,Math.min(10000,Number(maxEntries)||2048));this.persistentTtlMs=Math.max(5*60*1000,Math.min(7*24*60*60*1000,Number(persistentTtlMs)||24*60*60*1000));
  }
  pruneState(state,now=Date.now()){
    state.entries=state.entries.filter(entry=>entry.expiresAt>now).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,this.maxEntries);
  }
  async claim({scope,key,fingerprint,bootId,now=Date.now()}={}){
    const token=tokenFor(String(scope||'default'),String(key||''));let result;
    await this.update(state=>{
      this.pruneState(state,now);
      const existing=state.entries.find(entry=>entry.token===token);
      if(existing){
        if(existing.fingerprint!==fingerprint){result={status:'conflict',ownerBootId:existing.ownerBootId,entryStatus:existing.status};return;}
        result={status:'existing',ownerBootId:existing.ownerBootId,entryStatus:existing.status,responseStatus:existing.responseStatus??null,createdAt:existing.createdAt,updatedAt:existing.updatedAt};return;
      }
      state.entries.unshift({token,fingerprint,status:'pending',ownerBootId:String(bootId||'unknown'),createdAt:now,updatedAt:now,expiresAt:now+this.persistentTtlMs,responseStatus:null});
      this.pruneState(state,now);result={status:'new',ownerBootId:String(bootId||'unknown'),entryStatus:'pending'};
    });
    return result;
  }
  async complete({scope,key,fingerprint,bootId,statusCode,now=Date.now()}={}){
    const token=tokenFor(String(scope||'default'),String(key||''));let completed=false;
    await this.update(state=>{
      this.pruneState(state,now);
      const entry=state.entries.find(item=>item.token===token);
      if(!entry||entry.fingerprint!==fingerprint)return;
      entry.status='completed';entry.ownerBootId=String(bootId||entry.ownerBootId||'unknown');entry.updatedAt=now;entry.expiresAt=now+this.persistentTtlMs;entry.responseStatus=Number.isInteger(statusCode)?statusCode:null;completed=true;
    });
    return completed;
  }
  async recoverPreviousBoot({bootId,now=Date.now()}={}){
    let changed=0;
    await this.update(state=>{
      this.pruneState(state,now);
      for(const entry of state.entries){if(entry.status==='pending'&&entry.ownerBootId!==bootId){entry.status='uncertain';entry.updatedAt=now;changed++;}}
    });
    return {uncertain:changed,total:this.read().entries.length};
  }
  stats(now=Date.now()){
    const entries=this.read().entries.filter(entry=>entry.expiresAt>now);return {total:entries.length,pending:entries.filter(entry=>entry.status==='pending').length,completed:entries.filter(entry=>entry.status==='completed').length,uncertain:entries.filter(entry=>entry.status==='uncertain').length};
  }
}

export const idempotencyTokenFor=tokenFor;
