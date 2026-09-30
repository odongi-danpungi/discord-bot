import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OperationsStore, applyAction } from '../src/operations.js';

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
