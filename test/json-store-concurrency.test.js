import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access, mkdir, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OperationsStore, applyAction } from '../src/operations.js';
import { JsonStore } from '../src/json-store.js';

const valid = value => value && typeof value === 'object' && Number.isInteger(value.value);
const create = file => new JsonStore(file, {value:0}, valid);

test('same-file store instances serialize concurrent JSON updates without lost writes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'json-concurrency-'));
  try {
    const file = path.join(dir, 'operations.json');
    const first = await new OperationsStore(file).init();
    await first.update(state => applyAction(state, 'open', {game:'lol', count:2}, 0));
    const sessionId = first.read().session.id;
    const second = await new OperationsStore(file).init();

    const users = Array.from({length:40}, (_, i) => `user-${i}`);
    await Promise.all(users.map((userId, i) => (i % 2 ? first : second).update(state =>
      applyAction(state, 'join', {sessionId, userId}, i + 1)
    )));

    const restarted = await new OperationsStore(file).init();
    assert.equal(restarted.read().session.applicants.length, users.length);
    assert.deepEqual(new Set(restarted.read().session.applicants), new Set(users));
    assert.doesNotReject(async () => JSON.parse(await readFile(file + '.bak', 'utf8')));
    await assert.rejects(access(file + '.tmp'));
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('a failed update does not poison the shared per-file request queue', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'json-queue-recovery-'));
  try {
    const file = path.join(dir, 'operations.json');
    const first = await new OperationsStore(file).init();
    await first.update(state => applyAction(state, 'open', {game:'er', count:1}, 0));
    const sessionId = first.read().session.id;
    const second = await new OperationsStore(file).init();

    const [bad, good] = await Promise.allSettled([
      first.update(state => applyAction(state, 'join', {sessionId:'stale-session', userId:'bad'}, 1)),
      second.update(state => applyAction(state, 'join', {sessionId, userId:'good'}, 2))
    ]);

    assert.equal(bad.status, 'rejected');
    assert.equal(good.status, 'fulfilled');
    assert.deepEqual(first.read().session.applicants, ['good']);
    assert.deepEqual(second.read().session.applicants, ['good']);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('flush waits for a rejected request without reporting uncommitted storage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'json-rejected-flush-'));
  try {
    const file = path.join(dir, 'state.json'), first = await create(file).init(), second = await create(file).init();
    const before = await readFile(file, 'utf8');
    let enter, release, flushed = false, changes = 0;
    const entered = new Promise(resolve => {enter = resolve;});
    const barrier = new Promise(resolve => {release = resolve;});
    const unsubscribe = first.subscribe(() => {changes++;});
    const rejection = Object.assign(Error('접수 정원에 도달했습니다.'), {status:409});
    const request = first.update(async state => {
      state.value = 999;
      enter();
      await barrier;
      throw rejection;
    });
    const requestCheck = assert.rejects(request, error => error === rejection);
    await entered;
    const flushing = second.flush().then(() => {flushed = true;});
    await Promise.resolve();
    assert.equal(flushed, false);
    release();
    await requestCheck;
    await flushing;
    await assert.doesNotReject(first.flush());
    assert.equal(first.read().value, 0);
    assert.equal(second.read().value, 0);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(changes, 0);
    unsubscribe();
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('data validation rejection leaves committed data flushable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'json-validation-flush-'));
  try {
    const file = path.join(dir, 'state.json'), store = await create(file).init();
    await store.update(state => {state.value = 1;});
    const primary = await readFile(file, 'utf8'), backup = await readFile(file + '.bak', 'utf8');
    await assert.rejects(store.update(state => {state.value = 'invalid';}), /데이터 형식/);
    await assert.doesNotReject(store.flush());
    await assert.rejects(store.write({value:'invalid'}), /데이터 형식/);
    await assert.doesNotReject(store.flush());
    assert.deepEqual(store.read(), {value:1});
    assert.equal(await readFile(file, 'utf8'), primary);
    assert.equal(await readFile(file + '.bak', 'utf8'), backup);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('real write failure stays visible to shared flush after rejected requests until a successful retry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'json-io-flush-'));
  try {
    const file = path.join(dir, 'state.json'), first = await create(file).init(), second = await create(file).init();
    const before = await readFile(file, 'utf8');
    // An occupied staging path fails actual file IO on both Windows and Unix.
    await mkdir(file + '.tmp');
    let storageError;
    await assert.rejects(first.update(state => {state.value = 1;}), error => {
      storageError = error;
      return Boolean(error.code);
    });
    await assert.rejects(first.flush(), error => error === storageError);
    await assert.rejects(second.flush(), error => error === storageError);
    await assert.rejects(second.update(() => {throw Object.assign(Error('stale revision'), {status:409});}), {status:409});
    await assert.rejects(first.flush(), error => error === storageError);
    await second.enqueue(() => second.read());
    await assert.rejects(first.flush(), error => error === storageError);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(first.read(), {value:0});
    assert.deepEqual(second.read(), {value:0});

    await rmdir(file + '.tmp');
    await second.update(state => {state.value = 2;});
    await assert.doesNotReject(first.flush());
    await assert.doesNotReject(second.flush());
    assert.equal(JSON.parse(await readFile(file, 'utf8')).value, 2);
    assert.deepEqual(first.read(), {value:2});
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('failed initialization still rejects flush for corrupt candidates and read IO failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'json-init-flush-'));
  try {
    const corruptFile = path.join(dir, 'corrupt.json'), corrupt = create(corruptFile);
    await writeFile(corruptFile, '{broken');
    let corruption;
    await assert.rejects(corrupt.init(), error => {
      corruption = error;
      return error.code === 'EDATA_CORRUPT';
    });
    await assert.rejects(corrupt.flush(), error => error === corruption);
    assert.equal(await readFile(corruptFile, 'utf8'), '{broken');

    const blockedFile = path.join(dir, 'directory.json'), blocked = create(blockedFile);
    await mkdir(blockedFile);
    let readError;
    await assert.rejects(blocked.init(), error => {
      readError = error;
      return Boolean(error.code);
    });
    await assert.rejects(blocked.flush(), error => error === readError);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});
