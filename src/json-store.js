import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { atomicCopyFile, renameDurable, writeFileSynced } from './durable-file.js';

// A single process may create more than one store object for the same JSON file
// (tests, recovery flows, future modules). Serialize every read-modify-write by
// resolved file path so parallel callers cannot share a .tmp file or overwrite
// a newer in-memory state with a stale clone.
const coordinators = new Map();
function coordinatorFor(file) {
  let coordinator = coordinators.get(file);
  if (!coordinator) {
    coordinator = { queue: Promise.resolve(), state: undefined, listeners: new Set() };
    coordinators.set(file, coordinator);
  }
  return coordinator;
}

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

function corruptionError(file, candidates) {
  const failure = Error(`${path.basename(file)}을 안전하게 복구할 수 없습니다. 원본·백업·임시 파일을 보존했습니다.`);
  failure.code = 'EDATA_CORRUPT';
  failure.candidates = Object.fromEntries(Object.entries(candidates).map(([name, item]) => [name, { status:item.status, reason:item.reason || null }]));
  return failure;
}

export class JsonStore {
  constructor(file, initial, validate, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.file = path.resolve(file);
    this.initial = initial;
    this.validate = validate;
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : DEFAULT_MAX_BYTES;
    this.coordinator = coordinatorFor(this.file);
    this.state = undefined;
    this.recovered = false;
    this.recoverySource = null;
    this.integrityRecovery = [];
    this.observer = null;
  }
  setObserver(observer) { this.observer = typeof observer === 'function' ? observer : null; return this; }
  notify(event) { try { this.observer?.({ ...event, file: this.file, at: Date.now() }); } catch { /* Runtime diagnostics must never break storage. */ } }
  enqueue(task) {
    const run = this.coordinator.queue.catch(() => {}).then(task);
    this.coordinator.queue = run;
    return run;
  }
  setCommittedState(value) {
    const committed = structuredClone(value);
    this.coordinator.state = committed;
    this.state = committed;
  }
  async inspectCandidate(file, candidate) {
    let bytes;
    try { bytes = await readFile(file); }
    catch (error) {
      if (error?.code === 'ENOENT') return { candidate, file, status:'missing' };
      throw error;
    }
    if (bytes.length === 0) return { candidate, file, status:'invalid', reason:'empty', bytes:0 };
    if (bytes.length > this.maxBytes) return { candidate, file, status:'invalid', reason:'oversize', bytes:bytes.length };
    let text;
    try { text = decoder.decode(bytes); }
    catch { return { candidate, file, status:'invalid', reason:'utf8', bytes:bytes.length }; }
    if (!text.trim()) return { candidate, file, status:'invalid', reason:'empty', bytes:bytes.length };
    let value;
    try { value = JSON.parse(text); }
    catch (error) { return { candidate, file, status:'invalid', reason:'syntax', bytes:bytes.length, error }; }
    let valid = false;
    try { valid = Boolean(this.validate(value)); } catch { valid = false; }
    if (!valid) return { candidate, file, status:'invalid', reason:'validation', bytes:bytes.length };
    return { candidate, file, status:'valid', bytes:bytes.length, value };
  }
  async parse(file) {
    const inspected = await this.inspectCandidate(file, 'parse');
    if (inspected.status === 'missing') { const error=Error('file not found'); error.code='ENOENT'; throw error; }
    if (inspected.status !== 'valid') {
      const error = inspected.reason === 'syntax' ? (inspected.error || new SyntaxError('invalid JSON')) : Error('invalid data');
      error.reason = inspected.reason;
      throw error;
    }
    return inspected.value;
  }
  artifactPath(kind) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${this.file}.${kind}-${stamp}-${randomUUID().slice(0,8)}`;
  }
  reportDirectoryDurability(result, operation) {
    const seen = new Set();
    const checks = [
      result?.directory?.targetDirectory,
      result?.directory?.sourceDirectory,
      result?.targetDirectory,
      result?.sourceDirectory
    ].filter(Boolean);
    for (const check of checks) {
      if (check.supported !== false) continue;
      const key = `${operation}:${check.code || 'unsupported'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.notify({type:'directory_fsync_unsupported',operation,code:check.code||null});
    }
  }
  notifyDurabilityDegraded(operation, error) {
    this.notify({type:'durability_degraded',operation,error,committed:Boolean(error?.commitPointReached)});
  }
  async preserveCopy(source, kind) {
    const target = this.artifactPath(kind);
    const result = await atomicCopyFile(source, target, { temporary:`${target}.tmp` });
    this.reportDirectoryDurability(result, `preserve-${kind}`);
    return target;
  }
  async quarantineFile(source, kind) {
    const target = this.artifactPath(kind);
    try {
      const result = await renameDurable(source, target);
      this.reportDirectoryDurability(result, `quarantine-${kind}`);
    } catch (error) {
      // rename() is the logical move commit point. If only the directory fsync
      // failed afterwards, continuing is safer than pretending the source still
      // exists and attempting a second move over forensic evidence.
      if (!error?.commitPointReached) throw error;
      this.notifyDurabilityDegraded(`quarantine-${kind}`, error);
    }
    return target;
  }
  noteIntegrity(action, detail = {}) {
    const entry = { action, ...detail };
    this.integrityRecovery.push(entry);
    return entry;
  }
  async copyBackupFromPrimary({ strict = true } = {}) {
    try {
      const result = await atomicCopyFile(this.file, this.file + '.bak', { temporary:this.file + '.bak.tmp' });
      this.reportDirectoryDurability(result, 'backup-promote');
      return { ok:true, degraded:false };
    } catch (error) {
      if (!strict && error?.commitPointReached) {
        this.notifyDurabilityDegraded('backup-directory-sync', error);
        return { ok:true, degraded:true };
      }
      throw error;
    }
  }
  async writeUnlocked(value, backup = true) {
    const temporary = this.file + '.tmp';
    const payload = JSON.stringify(value, null, 2) + '\n';
    let primaryCommitted = false;
    try {
      // Durability protocol:
      // 1) write new primary candidate -> fsync(file)
      // 2) atomically replace .bak with the current committed primary -> fsync(dir)
      // 3) rename the already-fsynced candidate over primary (commit point)
      // 4) fsync(parent dir) where supported
      // A process crash before step 3 leaves the old primary authoritative.
      await writeFileSynced(temporary, payload, { mode:0o600 });
      if (backup) await this.copyBackupFromPrimary({ strict:true });
      try {
        const result = await renameDurable(temporary, this.file);
        primaryCommitted = true;
        this.reportDirectoryDurability(result, 'primary-commit');
      } catch (error) {
        if (!error?.commitPointReached) throw error;
        primaryCommitted = true;
        // The rename is already visible in the running OS, so returning an API
        // failure would invite a duplicate retry even though the logical commit
        // happened. Keep the commit and surface the durability degradation.
        this.notifyDurabilityDegraded('primary-directory-sync', error);
      }
      this.notify({type:'write-success',durability:primaryCommitted?'committed':'unknown'});
      return { committed:primaryCommitted };
    } catch (error) {
      this.notify({type:'write-failure',error,committed:primaryCommitted});
      throw error;
    }
  }
  init() {
    return this.enqueue(async () => {
      this.recovered = false;
      this.recoverySource = null;
      this.integrityRecovery = [];
      await mkdir(path.dirname(this.file), { recursive: true });

      const primary = await this.inspectCandidate(this.file, 'primary');
      const backup = await this.inspectCandidate(this.file + '.bak', 'backup');
      const backupTemporary = await this.inspectCandidate(this.file + '.bak.tmp', 'backupTemporary');
      const temporary = await this.inspectCandidate(this.file + '.tmp', 'temporary');
      const candidates = { primary, backup, backupTemporary, temporary };

      for (const item of Object.values(candidates)) {
        if (item.status === 'invalid') this.notify({type:'file_corruption_detected',candidate:item.candidate,reason:item.reason,bytes:item.bytes});
      }

      // A valid primary is always the commit point. Leftover staging files must
      // never be replayed over it, even if they happen to be newer.
      if (primary.status === 'valid') {
        if (temporary.status !== 'missing') {
          const kind = temporary.status === 'valid' ? 'orphaned-temp' : 'damaged-temp';
          await this.quarantineFile(this.file + '.tmp', kind);
          this.noteIntegrity('temporary_quarantined',{candidate:'temporary',reason:temporary.status === 'valid' ? 'uncommitted' : temporary.reason});
        }
        if (backupTemporary.status !== 'missing') {
          const kind = backupTemporary.status === 'valid' ? 'orphaned-backup-temp' : 'damaged-backup-temp';
          await this.quarantineFile(this.file + '.bak.tmp', kind);
          this.noteIntegrity('backup_temporary_quarantined',{candidate:'backupTemporary',reason:backupTemporary.status === 'valid' ? 'uncommitted' : backupTemporary.reason});
        }
        if (backup.status !== 'valid') {
          if (backup.status === 'invalid') await this.preserveCopy(this.file + '.bak', 'damaged-backup');
          await this.copyBackupFromPrimary({ strict:false });
          this.noteIntegrity('backup_repaired',{candidate:'backup',reason:backup.reason || backup.status});
          this.notify({type:'backup_repaired',candidate:'backup',reason:backup.reason || backup.status,detail:'정상 원본에서 .bak 파일을 다시 만들었습니다.'});
        }
        this.setCommittedState(primary.value);
        return this;
      }

      // A genuinely new store has no candidates at all. Only this exact state
      // is allowed to initialize defaults; a present-but-corrupt candidate is
      // never silently replaced with empty data.
      if (primary.status === 'missing' && backup.status === 'missing' && backupTemporary.status === 'missing' && temporary.status === 'missing') {
        const state = structuredClone(this.initial);
        await this.writeUnlocked(state, false);
        this.setCommittedState(state);
        return this;
      }

      if (backup.status === 'valid') {
        // Preserve every file that writeUnlocked() is about to overwrite.
        if (primary.status === 'invalid') await this.preserveCopy(this.file, 'damaged-primary');
        if (temporary.status !== 'missing') {
          const kind = temporary.status === 'valid' ? 'orphaned-temp' : 'damaged-temp';
          await this.quarantineFile(this.file + '.tmp', kind);
        }
        if (backupTemporary.status !== 'missing') {
          const kind = backupTemporary.status === 'valid' ? 'orphaned-backup-temp' : 'damaged-backup-temp';
          await this.quarantineFile(this.file + '.bak.tmp', kind);
        }
        await this.writeUnlocked(backup.value, false);
        this.recovered = true;
        this.recoverySource = 'backup';
        this.noteIntegrity('backup_recovery',{source:'backup',primaryReason:primary.reason || primary.status});
        this.notify({type:'recovery',source:'backup',detail:'손상되거나 누락된 원본 대신 검증된 .bak 파일을 사용했습니다.'});
        this.setCommittedState(backup.value);
        return this;
      }

      // .bak.tmp is a staged copy of the previously committed primary. It is a
      // stronger recovery source than the new-value .tmp, but only when both
      // primary and promoted .bak are unusable.
      if (backupTemporary.status === 'valid') {
        if (primary.status === 'invalid') await this.preserveCopy(this.file, 'damaged-primary');
        if (backup.status === 'invalid') await this.preserveCopy(this.file + '.bak', 'damaged-backup');
        if (temporary.status !== 'missing') {
          const kind = temporary.status === 'valid' ? 'orphaned-temp' : 'damaged-temp';
          await this.quarantineFile(this.file + '.tmp', kind);
        }
        await this.quarantineFile(this.file + '.bak.tmp', 'salvaged-backup-temp');
        await this.writeUnlocked(backupTemporary.value, false);
        await this.copyBackupFromPrimary({ strict:false });
        this.recovered = true;
        this.recoverySource = 'backup-temporary';
        this.noteIntegrity('backup_temporary_salvage',{source:'backupTemporary',primaryReason:primary.reason || primary.status,backupReason:backup.reason || backup.status});
        this.notify({type:'recovery',source:'backup-temporary',detail:'원본과 .bak을 사용할 수 없어 fsync 완료된 .bak.tmp에서 이전 커밋을 복구했습니다.'});
        this.setCommittedState(backupTemporary.value);
        return this;
      }

      if (temporary.status === 'valid') {
        // .tmp is not a commit point. It is only a last-resort salvage source
        // when neither the primary nor any backup candidate is trustworthy.
        if (primary.status === 'invalid') await this.preserveCopy(this.file, 'damaged-primary');
        if (backup.status === 'invalid') await this.preserveCopy(this.file + '.bak', 'damaged-backup');
        if (backupTemporary.status === 'invalid') await this.preserveCopy(this.file + '.bak.tmp', 'damaged-backup-temp');
        await this.quarantineFile(this.file + '.tmp', 'salvaged-temp');
        await this.writeUnlocked(temporary.value, false);
        await this.copyBackupFromPrimary({ strict:false });
        this.recovered = true;
        this.recoverySource = 'temporary';
        this.noteIntegrity('temporary_salvage',{source:'temporary',primaryReason:primary.reason || primary.status,backupReason:backup.reason || backup.status});
        this.notify({type:'temporary_salvage',source:'temporary',detail:'원본과 백업 후보를 사용할 수 없어 검증된 .tmp 파일을 최후 수단으로 복구했습니다.'});
        this.setCommittedState(temporary.value);
        return this;
      }

      // No trustworthy candidate exists. Do not rename/copy/rewrite anything;
      // forensic evidence and manual recovery options must remain intact.
      const failure = corruptionError(this.file, candidates);
      this.notify({type:'read-failure',error:failure});
      throw failure;
    });
  }
  read() {
    const state = this.coordinator.state ?? this.state;
    return structuredClone(state);
  }
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.coordinator.listeners.add(listener);
    return () => this.coordinator.listeners.delete(listener);
  }
  emitChange() {
    for (const listener of this.coordinator.listeners) {
      try { listener(); } catch { /* Dashboard listeners must not break persisted updates. */ }
    }
  }
  async flush() {
    await this.coordinator.queue;
  }
  write(value, backup = true) {
    if (!this.validate(value)) return Promise.reject(Error('저장할 데이터 형식이 올바르지 않습니다.'));
    return this.enqueue(async () => {
      await this.writeUnlocked(value, backup);
      this.setCommittedState(value);
      this.emitChange();
    });
  }
  update(fn) {
    return this.enqueue(async () => {
      const committed = this.coordinator.state ?? this.state;
      if (committed === undefined) throw Error('저장소가 초기화되지 않았습니다. init()을 먼저 실행해 주세요.');
      const next = structuredClone(committed);
      const result = await fn(next);
      if (!this.validate(next)) throw Error('저장할 데이터 형식이 올바르지 않습니다.');
      await this.writeUnlocked(next);
      this.setCommittedState(next);
      this.emitChange();
      return result;
    });
  }
}
