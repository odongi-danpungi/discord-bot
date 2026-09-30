import { JsonStore } from './json-store.js';
import { auditEntry, createRestorePoint, verifyRestorePoint } from './recovery-audit.js';

const validPoint=point=>point&&typeof point==='object'&&typeof point.id==='string'&&typeof point.guildId==='string'&&Number.isFinite(point.createdAt)&&Array.isArray(point.records)&&point.operations&&typeof point.digest==='string';
const validAudit=entry=>entry&&typeof entry==='object'&&typeof entry.id==='string'&&Number.isFinite(entry.at)&&typeof entry.category==='string'&&typeof entry.action==='string'&&typeof entry.summary==='string';
const validEmergency=value=>value===undefined||(value&&typeof value==='object'&&typeof value.locked==='boolean'&&Number.isFinite(Number(value.lockedAt||0))&&Number.isFinite(Number(value.unlockedAt||0))&&typeof (value.lockedBy||'')==='string'&&typeof (value.unlockedBy||'')==='string'&&typeof (value.reason||'')==='string'&&typeof (value.checkpointId||'')==='string');
const validState=value=>value&&typeof value==='object'&&value.version===1&&Array.isArray(value.restorePoints)&&value.restorePoints.every(validPoint)&&Array.isArray(value.auditLog)&&value.auditLog.every(validAudit)&&validEmergency(value.emergency);
const emptyEmergency=()=>({locked:false,lockedAt:0,lockedBy:'',reason:'',checkpointId:'',unlockedAt:0,unlockedBy:''});
const clean=value=>String(value??'').replace(/[\r\n\t]+/g,' ').trim();

export class RecoveryStore extends JsonStore {
  constructor(file){super(file,{version:1,restorePoints:[],auditLog:[],emergency:emptyEmergency()},validState);}
  async audit(event){return this.update(state=>{state.auditLog.unshift(auditEntry(event));state.auditLog=state.auditLog.slice(0,500);});}
  async checkpoint(payload){let point;await this.update(state=>{point=createRestorePoint(payload);state.restorePoints.unshift(point);state.restorePoints=state.restorePoints.slice(0,10);});return point;}
  emergencyState(){const value=this.read().emergency||emptyEmergency();return {...emptyEmergency(),...value,locked:Boolean(value.locked)};}
  async setEmergency({locked,actor='admin',reason='',checkpointId='',at=Date.now()}={}){let result;await this.update(state=>{const current={...emptyEmergency(),...(state.emergency||{})};if(locked){result={locked:true,lockedAt:Number(at)||Date.now(),lockedBy:clean(actor).slice(0,60)||'admin',reason:clean(reason).slice(0,160)||'긴급 운영 잠금',checkpointId:clean(checkpointId).slice(0,100),unlockedAt:0,unlockedBy:''};}else{result={...current,locked:false,unlockedAt:Number(at)||Date.now(),unlockedBy:clean(actor).slice(0,60)||'admin'};}state.emergency=result;});return structuredClone(result);}
  summary(guildId){const state=this.read();return {restorePoints:state.restorePoints.map(point=>({id:point.id,label:point.label,reason:point.reason,createdAt:point.createdAt,recordCount:point.recordCount,revision:point.revision,integrity:verifyRestorePoint(point,guildId).ok})),auditLog:state.auditLog.slice(0,200),emergency:{...emptyEmergency(),...(state.emergency||{})}};}
  getPoint(id){return this.read().restorePoints.find(point=>point.id===id)||null;}
  async removePoint(id){let removed=false;await this.update(state=>{const before=state.restorePoints.length;state.restorePoints=state.restorePoints.filter(point=>point.id!==id);removed=before!==state.restorePoints.length;});return removed;}
}
