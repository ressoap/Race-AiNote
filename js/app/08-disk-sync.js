  /* ── 本地文件夹读写同步（File System Access API） ───────── */
  let diskSyncTimer = 0;
  let diskSyncBusy = false;
  let diskSyncPending = false;

  function resetDiskBinding() {
    state.rootHandle = null;
    state.diskContents = new Map();
    state.diskReadOnly = false;
    clearTimeout(diskSyncTimer);
    diskSyncTimer = 0;
  }

  function bindDiskRoot(handle, files) {
    state.rootHandle = handle || null;
    state.diskReadOnly = false;
    state.diskContents = new Map();
    for (const file of files || []) {
      if (vault.MD_EXT.test(String(file.path || ''))) {
        state.diskContents.set(file.path, String(file.content || ''));
      }
    }
    return Boolean(handle);
  }

  async function diskDirForPath(root, path, create) {
    const parts = String(path || '').split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error('空文件路径');
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: Boolean(create) });
    }
    return { dir, name };
  }

  async function writeDiskFile(root, path, content) {
    const target = await diskDirForPath(root, path, true);
    const fileHandle = await target.dir.getFileHandle(target.name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(String(content == null ? '' : content));
    } finally {
      await writable.close();
    }
  }

  async function removeDiskFile(root, path) {
    const target = await diskDirForPath(root, path, false);
    await target.dir.removeEntry(target.name);
  }

  async function syncDiskNow() {
    if (!state.rootHandle || state.diskReadOnly) return { wrote: 0, removed: 0, skipped: true };
    if (diskSyncBusy) {
      diskSyncPending = true;
      return { wrote: 0, removed: 0, pending: true };
    }
    diskSyncBusy = true;
    diskSyncPending = false;
    const root = state.rootHandle;
    const next = new Map();
    for (const file of state.files) {
      if (vault.MD_EXT.test(String(file.path || ''))) next.set(file.path, String(file.content || ''));
    }
    let wrote = 0;
    let removed = 0;
    let failed = false;
    try {
      for (const [path, content] of next) {
        if (state.diskContents.get(path) === content) continue;
        try {
          await writeDiskFile(root, path, content);
          wrote += 1;
        } catch (err) {
          failed = true;
        }
      }
      for (const path of [...state.diskContents.keys()]) {
        if (next.has(path)) continue;
        try {
          await removeDiskFile(root, path);
          removed += 1;
        } catch (err) {
          failed = true;
        }
      }
      if (!failed) state.diskContents = next;
      if (wrote || removed) toast('已写回磁盘：' + wrote + ' 个修改，' + removed + ' 个删除');
      return { wrote, removed, failed };
    } finally {
      diskSyncBusy = false;
      if (diskSyncPending) {
        diskSyncPending = false;
        setTimeout(() => { syncDiskNow(); }, 0);
      }
    }
  }

  function scheduleDiskSync() {
    if (!state.rootHandle || state.diskReadOnly) return;
    clearTimeout(diskSyncTimer);
    diskSyncTimer = setTimeout(() => { diskSyncNow(); }, 350);
  }
