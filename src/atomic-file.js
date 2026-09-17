import { open, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

async function syncDirectory(dir) {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch (error) {
    // Some platforms/filesystems do not support directory fsync. Atomic rename still protects contents.
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function atomicWriteFile(file, data, { mode = 0o600, tempFile = null } = {}) {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  const temporary = tempFile ? path.resolve(tempFile) : `${target}.tmp`;
  await mkdir(dir, { recursive: true });
  let handle;
  try {
    handle = await open(temporary, 'w', mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    await syncDirectory(dir);
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
  return target;
}

export async function removeAtomicTemp(file) {
  await rm(path.resolve(file) + '.tmp', { force: true }).catch(() => {});
}

export { syncDirectory };
