import { JsonStore } from './json-store.js';
import { auditEntry, createRestorePoint, verifyRestorePoint } from './recovery-audit.js';

const validPoint=point=>point&&typeof point==='object'&&typeof point.id==='string'&&typeof point.guildId==='string'&&Number.isFinite(point.createdAt)&&Array.isArray(point.records)&&point.operations&&typeof point.digest==='string';
const validAudit=entry=>entry&&typeof entry==='object'&&typeof entry.id==='string'&&Number.isFinite(entry.at)&&typeof entry.category==='string'&&typeof entry.action==='string'&&typeof entry.summary==='string';
const validDrill=entry=>entry&&typeof entry==='object'&&['pass','warn','fail'].includes(entry.status)&&Number.isFinite(entry.finishedAt)&&typeof entry.backup==='string'&&(!entry.trigger||['manual','automatic'].includes(entry.trigger));
const validState=value=>value&&typeof value==='object'&&value.version===1&&Array.isArray(value.restorePoints)&&value.restorePoints.every(validPoint)&&Array.isArray(value.auditLog)&&value.auditLog.every(validAudit)&&(!value.drills||(Array.isArray(value.drills)&&value.drills.every(validDrill)));

export class RecoveryStore extends JsonStore {
  constructor(file){super(file,{version:1,restorePoints:[],auditLog:[],drills:[]},validState);}
  async audit(event){return this.update(state=>{state.auditLog.unshift(auditEntry(event));state.auditLog=state.auditLog.slice(0,500);});}
  async checkpoint(payload){let point;await this.update(state=>{point=createRestorePoint(payload);state.restorePoints.unshift(point);state.restorePoints=state.restorePoints.slice(0,10);});return point;}
  async recordDrill(result){const entry={status:result.status,trigger:['manual','automatic'].includes(result.trigger)?result.trigger:'manual',startedAt:Number(result.startedAt)||Date.now(),finishedAt:Number(result.finishedAt)||Date.now(),durationMs:Number(result.durationMs)||0,backup:String(result.backup||'unknown'),backupIntegrity:String(result.backupIntegrity||''),targetDigest:String(result.targetDigest||''),records:Number(result.records)||0,revision:Number(result.revision)||0,migrationChanges:Number(result.migrationChanges)||0,consistencyChanges:Number(result.consistencyChanges)||0};await this.update(state=>{state.drills=[entry,...(state.drills||[])].slice(0,20);});return entry;}
  summary(guildId){const state=this.read();return {restorePoints:state.restorePoints.map(point=>({id:point.id,label:point.label,reason:point.reason,createdAt:point.createdAt,recordCount:point.recordCount,revision:point.revision,integrity:verifyRestorePoint(point,guildId).ok})),drills:(state.drills||[]).slice(0,20),auditLog:state.auditLog.slice(0,200)};}
  getPoint(id){return this.read().restorePoints.find(point=>point.id===id)||null;}
  async removePoint(id){let removed=false;await this.update(state=>{const before=state.restorePoints.length;state.restorePoints=state.restorePoints.filter(point=>point.id!==id);removed=before!==state.restorePoints.length;});return removed;}
}
