import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const DIRECTORY_FSYNC_UNSUPPORTED = new Set(['EINVAL','ENOTSUP','EOPNOTSUPP','EISDIR','ENOSYS','EPERM']);

export async function syncFile(file, flags='r+') {
  const handle = await open(file, flags);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

export async function writeFileSynced(file, data, { mode = 0o600, flag = 'w' } = {}) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const handle = await open(file, flag, mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function syncDirectory(directory) {
  const absolute = path.resolve(directory);
  let handle;
  try {
    handle = await open(absolute, 'r');
    await handle.sync();
    return { supported: true, synced: true, code: null };
  } catch (error) {
    if (DIRECTORY_FSYNC_UNSUPPORTED.has(error?.code) || (process.platform === 'win32' && error?.code === 'EACCES')) {
      return { supported: false, synced: false, code: error.code };
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function renameDurable(source, target) {
  await rename(source, target);
  const sourceDir = path.dirname(path.resolve(source));
  const targetDir = path.dirname(path.resolve(target));
  try {
    const targetSync = await syncDirectory(targetDir);
    let sourceSync = targetSync;
    if (sourceDir !== targetDir) sourceSync = await syncDirectory(sourceDir);
    return { targetDirectory: targetSync, sourceDirectory: sourceSync };
  } catch (error) {
    error.commitPointReached = true;
    error.renamedFrom = path.resolve(source);
    error.renamedTo = path.resolve(target);
    throw error;
  }
}

export async function atomicWriteFile(file, data, {
  mode = 0o600,
  temporary = `${file}.tmp`
} = {}) {
  const absolute = path.resolve(file);
  const temp = path.resolve(temporary);
  if (path.dirname(temp) !== path.dirname(absolute)) throw new Error('atomicWriteFile temporary file must be in the same directory as target');
  await writeFileSynced(temp, data, { mode });
  const directory = await renameDurable(temp, absolute);
  return { file: absolute, temporary: temp, directory };
}

export async function atomicCopyFile(source, target, {
  temporary = `${target}.tmp`
} = {}) {
  const absoluteTarget = path.resolve(target);
  const temp = path.resolve(temporary);
  if (path.dirname(temp) !== path.dirname(absoluteTarget)) throw new Error('atomicCopyFile temporary file must be in the same directory as target');
  await mkdir(path.dirname(absoluteTarget), { recursive: true });
  await copyFile(source, temp);
  // FlushFileBuffers on Windows requires a writable handle.
  await syncFile(temp, 'r+');
  const directory = await renameDurable(temp, absoluteTarget);
  return { source: path.resolve(source), file: absoluteTarget, temporary: temp, directory };
}

export async function removeDurable(file, { force = true } = {}) {
  const absolute = path.resolve(file);
  await rm(absolute, { force });
  const directory = await syncDirectory(path.dirname(absolute));
  return { file: absolute, directory };
}

export const __test = { DIRECTORY_FSYNC_UNSUPPORTED };
