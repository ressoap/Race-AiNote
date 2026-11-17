  /* ── 进入页：笔记库书架（多库 + 书本平铺） ─────────────────
     设计要点：
     1) 离开一个库时才把它的文件快照写进书架；正在编辑的库仍走 VAULT_KEY 热路径，
        避免每敲一个字都重写整份书架 JSON；
     2) FileSystemDirectoryHandle 进不了 localStorage，另存 IndexedDB；重进书架时
        先尝试申请权限重连文件夹，连不上再回退到快照；
     3) 封面颜色由库 id 哈希得到，同一个库每次颜色一致。 */

  const VAULTS_KEY = 'vaults';
  const VAULT_LIMIT = 18;
  const VAULT_BUDGET = 3500000;
  const HANDLE_DB = 'wenmo-vault-handles';
  let pendingVaultEntry = null;
  let launcherBound = false;

  function vaultHue(id) {
    let h = 2166136261;
    const s = String(id || 'vault');
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 360;
  }

  function vaultNoteCount(files) {
    let total = 0;
    for (const file of files || []) {
      if (vault.MD_EXT.test(String((file && file.path) || ''))) total += 1;
    }
    return total;
  }

  function timeAgo(ts) {
    const t = Number(ts) || 0;
    if (!t) return '还没打开过';
    const diff = Date.now() - t;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 30) return Math.round(diff / 86400000) + ' 天前';
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function readVaultList() {
    try {
      const raw = store.getJSON(VAULTS_KEY, []);
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(v => v && typeof v.id === 'string' && v.id && v.id !== 'demo')
        .map(v => ({
          id: v.id,
          label: String(v.label || '未命名笔记库').slice(0, 60),
          savedAt: Number(v.savedAt) || 0,
          noteCount: Number(v.noteCount) || 0,
          hasHandle: Boolean(v.hasHandle),
          stale: Boolean(v.stale),
          files: Array.isArray(v.files) ? v.files : null
        }))
        .slice(0, VAULT_LIMIT);
    } catch (_) {
      return [];
    }
  }

  function writeVaultList(list) {
    const next = list.slice(0, VAULT_LIMIT);
    // localStorage 只有 5MB 量级：超预算时从最旧的库开始丢文件快照，书本本身保留
    for (let i = next.length - 1; i >= 1; i -= 1) {
      let size = 0;
      try { size = JSON.stringify(next).length; } catch (_) { size = 0; }
      if (size <= VAULT_BUDGET) break;
      if (next[i].files) {
        next[i].files = null;
        next[i].stale = true;
      }
    }
    try {
      store.setJSON(VAULTS_KEY, next);
      return true;
    } catch (_) {
      return false;
    }
  }

  function vaultEntryOf(id) {
    return readVaultList().find(v => v.id === id) || null;
  }

  function newVaultId() {
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** 只更新元信息，不动已有的文件快照 */
  function touchVaultMeta(patch) {
    if (!patch || !patch.id || patch.id === 'demo') return;
    const list = readVaultList();
    const hit = list.find(v => v.id === patch.id);
    if (hit) Object.assign(hit, patch, { files: hit.files || null });
    else list.unshift(Object.assign({ files: null, stale: false }, patch));
    writeVaultList(list);
  }

  /** 离开当前库前，把最新文件写进书架条目 */
  function commitActiveVault() {
    if (!state.vaultId || state.vaultId === 'demo') return false;
    if (!Array.isArray(state.files) || !state.files.length) return false;
    const prev = vaultEntryOf(state.vaultId) || {};
    const list = readVaultList().filter(v => v.id !== state.vaultId);
    list.unshift({
      id: state.vaultId,
      label: state.vaultLabel || prev.label || '本地库',
      savedAt: Date.now(),
      noteCount: vaultNoteCount(state.files),
      hasHandle: Boolean(prev.hasHandle || state.rootHandle),
      stale: false,
      files: state.files.map(f => ({ path: f.path, content: f.content, mtime: f.mtime }))
    });
    state.vaultSavedAt = Date.now();
    return writeVaultList(list);
  }

  /** loadFiles 收尾时认领身份：这次载入归到哪本书 */
  function adoptVault(label, files, prevLabel) {
    if (label === '示例库') {
      state.vaultId = 'demo';
      state.vaultSavedAt = Date.now();
      pendingVaultEntry = null;
      return state.vaultId;
    }
    let id = pendingVaultEntry && pendingVaultEntry.id && pendingVaultEntry.id !== 'demo' ? pendingVaultEntry.id : null;
    if (!id && state.vaultId && state.vaultId !== 'demo' && prevLabel && prevLabel === label) {
      id = state.vaultId; // 同一个库的刷新（重连、重新载入）
    }
    if (!id) {
      const hit = readVaultList().find(v => v.label === label);
      id = hit ? hit.id : newVaultId();
    }
    state.vaultId = id;
    state.vaultSavedAt = Date.now();
    pendingVaultEntry = null;
    touchVaultMeta({
      id: id,
      label: label,
      savedAt: Date.now(),
      noteCount: vaultNoteCount(files),
      hasHandle: Boolean(state.rootHandle)
    });
    return id;
  }

  /* ── 文件夹句柄：localStorage 存不了，放 IndexedDB ───────── */

  function withHandleStore(mode, worker) {
    return new Promise(resolve => {
      const factory = typeof indexedDB !== 'undefined' ? indexedDB : null;
      if (!factory) return resolve(null);
      let req = null;
      try {
        req = factory.open(HANDLE_DB, 1);
      } catch (_) {
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore('handles'); } catch (_) {}
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        let tx = null;
        let out = null;
        try {
          tx = db.transaction('handles', mode);
          out = worker(tx.objectStore('handles'));
        } catch (_) {
          try { db.close(); } catch (_) {}
          return resolve(null);
        }
        tx.oncomplete = () => {
          try { db.close(); } catch (_) {}
          resolve(out && typeof out.result !== 'undefined' ? out.result : null);
        };
        tx.onerror = () => {
          try { db.close(); } catch (_) {}
          resolve(null);
        };
      };
    });
  }

  function idbPutHandle(id, handle) {
    return withHandleStore('readwrite', box => box.put(handle, id));
  }

  function idbGetHandle(id) {
    return withHandleStore('readonly', box => box.get(id));
  }

  function idbDeleteHandle(id) {
    return withHandleStore('readwrite', box => box.delete(id));
  }

  /** 打开文件夹成功后调用：把句柄存起来，下次从书架重进可直接重连 */
  function attachVaultHandle(handle) {
    if (!handle || !state.vaultId || state.vaultId === 'demo') return Promise.resolve(false);
    touchVaultMeta({ id: state.vaultId, label: state.vaultLabel, savedAt: Date.now(), hasHandle: true });
    return Promise.resolve(idbPutHandle(state.vaultId, handle)).then(() => true).catch(() => false);
  }

  /* ── 进入页渲染 ─────────────────────────────────────────── */

  function bookCard(book) {
    const card = document.createElement('article');
    card.className = 'book';
    card.tabIndex = 0;
    card.dataset.id = book.id;
    card.setAttribute('role', 'listitem');
    card.title = book.label + '（点击进入）';
    card.style.setProperty('--book-hue', String(book.kind === 'demo' ? 224 : vaultHue(book.id)));
    if (state.vaultId === book.id) card.classList.add('is-current');

    const cover = document.createElement('div');
    cover.className = 'book-cover';

    const title = document.createElement('h3');
    title.className = 'book-title';
    title.textContent = book.label;
    cover.appendChild(title);

    const meta = document.createElement('p');
    meta.className = 'book-meta';
    meta.textContent = (book.noteCount || 0) + (book.kind === 'demo' ? ' 篇示例笔记' : ' 篇笔记');
    cover.appendChild(meta);

    if (state.vaultId === book.id) {
      const badge = document.createElement('span');
      badge.className = 'book-badge';
      badge.textContent = '当前';
      cover.appendChild(badge);
    } else if (book.stale) {
      const badge = document.createElement('span');
      badge.className = 'book-badge is-warn';
      badge.textContent = '需重连';
      cover.appendChild(badge);
    }

    card.appendChild(cover);

    const foot = document.createElement('div');
    foot.className = 'book-foot';
    foot.textContent = book.kind === 'demo'
      ? '开箱即用 · 无需配置'
      : (book.stale ? '快照已清理，请重新选择文件夹' : timeAgo(book.savedAt));
    card.appendChild(foot);

    if (book.kind !== 'demo') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'book-remove';
      del.title = '从列表移出（不会删除磁盘文件）';
      del.textContent = '×';
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        removeVaultBook(book.id);
      });
      card.appendChild(del);
    }

    const go = () => { Promise.resolve(enterVault(book.id)).catch(() => {}); };
    card.addEventListener('click', go);
    card.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      Promise.resolve(openVaultMenu(book.id, ev.clientX, ev.clientY)).catch(() => {});
    });
    card.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    });
    return card;
  }

  function addBookCard() {
    const card = document.createElement('article');
    card.className = 'book book-add';
    card.tabIndex = 0;
    card.dataset.action = 'open-folder';
    card.setAttribute('role', 'listitem');
    card.title = '打开本地文件夹作为新笔记库';

    const cover = document.createElement('div');
    cover.className = 'book-cover';
    const icon = document.createElement('span');
    icon.className = 'book-add-icon';
    icon.textContent = '+';
    const label = document.createElement('span');
    label.className = 'book-add-label';
    label.textContent = '打开本地文件夹';
    cover.appendChild(icon);
    cover.appendChild(label);
    card.appendChild(cover);

    const foot = document.createElement('div');
    foot.className = 'book-foot';
    foot.textContent = '读取 Markdown 笔记库';
    card.appendChild(foot);

    const go = () => {
      closeLauncher();
      openViaPicker();
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    });
    return card;
  }

  function renderLauncher() {
    const shelf = $('#launcher-shelf');
    if (!shelf) return;
    shelf.innerHTML = '';
    const list = readVaultList();
    const demoFiles = (RG.demoVault && RG.demoVault.files) || [];
    shelf.appendChild(bookCard({
      id: 'demo',
      kind: 'demo',
      label: '内置示例库',
      noteCount: demoFiles.length,
      savedAt: 0
    }));
    for (const item of list) {
      shelf.appendChild(bookCard(Object.assign({ kind: 'vault' }, item)));
    }
    shelf.appendChild(addBookCard());
    const count = $('#launcher-count');
    if (count) count.textContent = list.length ? '共 ' + (list.length + 1) + ' 个' : '只有示例库';
    if (typeof renderLauncherStats === 'function') renderLauncherStats();
  }

  function openLauncher() {
    const root = $('#launcher');
    if (!root) return false;
    if (state.files && state.files.length) commitActiveVault();
    renderLauncher();
    root.hidden = false;
    requestAnimationFrame(() => {
      const first = root.querySelector('.book');
      if (first && first.focus) first.focus({ preventScroll: true });
    });
    return true;
  }

  function closeLauncher() {
    const root = $('#launcher');
    if (!root || root.hidden) return false;
    root.hidden = true;
    return true;
  }

  /* ── 进入 / 移出一个库 ─────────────────────────────────── */

  async function enterVault(id) {
    if (id === 'demo') {
      closeLauncher();
      loadDemo();
      return true;
    }
    const entry = vaultEntryOf(id);
    if (!entry) {
      toast('这个笔记库已不在列表里');
      renderLauncher();
      return false;
    }
    commitActiveVault();
    closeLauncher();
    pendingVaultEntry = { id: entry.id, label: entry.label };

    // 1) 优先重连原文件夹，拿到磁盘上的最新内容
    if (entry.hasHandle) {
      const handle = await idbGetHandle(entry.id);
      if (handle) {
        try {
          let perm = 'granted';
          if (handle.queryPermission) perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted' && handle.requestPermission) {
            perm = await handle.requestPermission({ mode: 'readwrite' });
          }
          if (perm === 'granted') {
            const files = [];
            await walkDirectory(handle, '', files);
            if (files.length) {
              loadFiles(files, handle.name || entry.label);
              if (typeof bindDiskRoot === 'function') bindDiskRoot(handle, files);
              toast('已重新连接文件夹：' + (handle.name || entry.label));
              return true;
            }
          }
        } catch (_) {}
      }
    }

    // 2) 回退到快照
    if (Array.isArray(entry.files) && entry.files.length) {
      loadFiles(entry.files.map(f => Object.assign({}, f)), entry.label);
      toast('已打开笔记库：' + entry.label);
      return true;
    }

    pendingVaultEntry = null;
    toast('《' + entry.label + '》没有可用的文件快照，请重新选择文件夹');
    return false;
  }

  async function removeVaultBook(id) {
    const entry = vaultEntryOf(id);
    if (!entry) return false;
    const ok = await askConfirm({
      title: '移出笔记库列表',
      message: '只会把《' + entry.label + '》从进入页移出，不会删除磁盘上的任何笔记。',
      okText: '移出',
      danger: true
    });
    if (!ok) return false;
    writeVaultList(readVaultList().filter(v => v.id !== id));
    idbDeleteHandle(id);
    if (state.vaultId === id) state.vaultId = null; // 当前正在编辑的库被移出：解除身份，下次保存重新建书
    renderLauncher();
    toast('已移出列表，磁盘文件未改动');
    return true;
  }

  /* ── 初始化 ─────────────────────────────────────────────── */

  function initLauncher() {
    const root = $('#launcher');
    if (!root || launcherBound) return false;
    launcherBound = true;

    const openBtn = $('#launcher-open');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        closeLauncher();
        openViaPicker();
      });
    }
    const demoBtn = $('#launcher-demo');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        closeLauncher();
        loadDemo();
      });
    }
    const closeBtn = $('#launcher-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { closeLauncher(); });
    const vaultBtn = $('#btn-vaults');
    if (vaultBtn) vaultBtn.addEventListener('click', () => { openLauncher(); });
    const vaultTitle = $('.vault-title');
    if (vaultTitle) {
      vaultTitle.style.cursor = 'pointer';
      vaultTitle.title = '切换笔记库（打开进入页）';
      vaultTitle.addEventListener('click', () => { openLauncher(); });
    }

    const menuEl = $('#vault-menu');
    if (menuEl) {
      menuEl.addEventListener('click', ev => {
        const btn = ev.target.closest('button');
        if (!btn || !vaultMenuId) return;
        const act = btn.dataset.act;
        const id = vaultMenuId;
        closeVaultMenu();
        if (act === 'open') enterVault(id);
        else if (act === 'duplicate') duplicateVaultBook(id);
        else if (act === 'rename') renameVaultBook(id);
        else if (act === 'backup') backupVaultBook(id);
        else if (act === 'detail') showVaultDetail(id);
        else if (act === 'delete') removeVaultBook(id);
      });
    }
    document.addEventListener('mousedown', ev => {
      const menu = $('#vault-menu');
      if (menu && !menu.hidden && !ev.target.closest('#vault-menu')) closeVaultMenu();
    });
    const detailClose = $('#vault-detail-close');
    if (detailClose) detailClose.addEventListener('click', () => { $('#vault-detail').hidden = true; });
    const detailModal = $('#vault-detail');
    if (detailModal) {
      detailModal.addEventListener('click', ev => {
        if (ev.target === detailModal) detailModal.hidden = true;
      });
    }

    // 进入页打开时把键盘事件留在这一层，别触发工作区快捷键
    root.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (closeVaultMenu()) return;
        const detail = $('#vault-detail');
        if (detail && !detail.hidden) { detail.hidden = true; return; }
        if (state.files && state.files.length) closeLauncher();
        return;
      }
      ev.stopPropagation();
    });
    // 焦点落在进入页外面时（比如刚打开首页还没点书），把工作区快捷键挡掉
    document.addEventListener('keydown', ev => {
      const shell = $('#launcher');
      if (!shell || shell.hidden) return;
      if (shell.contains(ev.target)) return;
      ev.stopPropagation();
      if (closeVaultMenu()) return;
      const detail = $('#vault-detail');
      if (detail && !detail.hidden) { detail.hidden = true; return; }
      if (ev.key === 'Escape' && state.files && state.files.length) closeLauncher();
    }, true);

    window.addEventListener('beforeunload', () => {
      try { commitActiveVault(); } catch (_) {}
    });

    renderLauncher();
    let skip = false;
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('launch') === '0') skip = true;
      if (params.get('note') || params.get('vault') || params.get('view') === 'graph' || params.get('prefs') === '1') skip = true;
    } catch (_) {}
    if (!skip) openLauncher();
    return true;
  }

  /* ── 书本右键菜单：复制 / 改名 / 删除 / 备份 / 查看详情 ───── */

  let vaultMenuId = null;

  function openVaultMenu(id, x, y) {
    const menu = $('#vault-menu');
    if (!menu) return false;
    vaultMenuId = id;
    const limited = id === 'demo';
    for (const btn of menu.querySelectorAll('button')) {
      const act = btn.dataset.act;
      btn.hidden = limited && (act === 'rename' || act === 'duplicate' || act === 'delete');
    }
    menu.hidden = false;
    const width = menu.offsetWidth || 168;
    const height = menu.offsetHeight || 214;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + 'px';
    return true;
  }

  function closeVaultMenu() {
    const menu = $('#vault-menu');
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    vaultMenuId = null;
    return true;
  }

  /** 取某个库当前可用的文件：正在编辑的库以内存为准，其它用快照 */
  function vaultFilesOf(id) {
    if (id === 'demo') return ((RG.demoVault && RG.demoVault.files) || []).map(f => Object.assign({}, f));
    if (id === state.vaultId && Array.isArray(state.files) && state.files.length) return state.files;
    const entry = vaultEntryOf(id);
    return entry && Array.isArray(entry.files) ? entry.files : [];
  }

  function vaultStatsOf(files) {
    let notes = 0;
    let attachments = 0;
    let words = 0;
    for (const file of files || []) {
      const filePath = String((file && file.path) || '');
      if (vault.MD_EXT.test(filePath)) {
        notes += 1;
        words += String(file.content || '').replace(/\s+/g, '').length;
      } else if (vault.ATTACH_EXT.test(filePath)) {
        attachments += 1;
      }
    }
    return { notes: notes, attachments: attachments, words: words };
  }

  function downloadJson(filename, data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (err) {
      toast('导出失败：' + (err && err.message ? err.message : err));
      return false;
    }
  }

  async function renameVaultBook(id) {
    const entry = vaultEntryOf(id);
    if (!entry) return false;
    const next = await askText({
      title: '给笔记库改名',
      desc: '只改进入页里显示的名字，磁盘上的文件夹名不会变。',
      value: entry.label,
      placeholder: '例如：考研数学'
    });
    if (next == null) return false;
    const label = String(next).trim().slice(0, 40);
    if (!label) {
      toast('名字不能为空');
      return false;
    }
    const list = readVaultList();
    const hit = list.find(v => v.id === id);
    if (!hit) return false;
    hit.label = label;
    writeVaultList(list);
    if (state.vaultId === id) {
      state.vaultLabel = label;
      $('#vault-name').textContent = label;
      $('#vault-name').title = label;
      saveLocalVault();
    }
    renderLauncher();
    toast('已改名为《' + label + '》');
    return true;
  }

  function duplicateVaultBook(id) {
    const entry = vaultEntryOf(id);
    if (!entry) return false;
    const files = vaultFilesOf(id);
    const copy = {
      id: newVaultId(),
      label: (entry.label + ' 副本').slice(0, 40),
      savedAt: Date.now(),
      noteCount: vaultNoteCount(files),
      hasHandle: false,
      stale: files.length ? false : true,
      files: files.length ? files.map(f => Object.assign({}, f)) : null
    };
    const list = readVaultList();
    list.unshift(copy);
    writeVaultList(list);
    renderLauncher();
    toast('已复制为《' + copy.label + '》');
    return copy.id;
  }

  function backupVaultBook(id) {
    const entry = vaultEntryOf(id);
    const files = vaultFilesOf(id);
    if (!files.length) {
      toast('这个库还没有可备份的笔记');
      return false;
    }
    const label = id === 'demo' ? '示例库' : (entry ? entry.label : '笔记库');
    const paths = new Set(files.map(f => f.path));
    const records = launcherRecordList().filter(r => !r.targetPath || paths.has(r.targetPath));
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());
    const ok = downloadJson(label + '-备份-' + stamp + '.json', {
      app: '问墨笔记',
      kind: 'vault-backup',
      version: 1,
      label: label,
      exportedAt: now.toISOString(),
      noteCount: vaultNoteCount(files),
      files: files,
      records: records
    });
    if (ok) toast('已导出《' + label + '》：' + files.length + ' 个文件');
    return ok;
  }

  function showVaultDetail(id) {
    const modal = $('#vault-detail');
    if (!modal) return false;
    const isDemo = id === 'demo';
    const entry = isDemo ? null : vaultEntryOf(id);
    if (!isDemo && !entry) return false;
    const files = vaultFilesOf(id);
    const stats = vaultStatsOf(files);
    const label = isDemo ? '内置示例库' : entry.label;
    const kind = isDemo
      ? '内置示例库（随应用打包，不占磁盘）'
      : (entry.hasHandle ? '本地文件夹 · 已连接磁盘，改动会写回' : (entry.files ? '本地快照 · 未连接磁盘，改动只存本机缓存' : '本地文件夹 · 需要重新授权'));
    let bytes = 0;
    try { bytes = JSON.stringify(files).length; } catch (_) { bytes = 0; }
    const rows = [
      ['类型', kind],
      ['笔记', stats.notes + ' 篇'],
      ['附件', stats.attachments + ' 个'],
      ['正文规模', stats.words.toLocaleString('zh-CN') + ' 字'],
      ['缓存占用', bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'],
      ['最近打开', isDemo ? '随时可用' : timeAgo(entry.savedAt)],
      ['库 ID', isDemo ? 'demo' : entry.id]
    ];
    const titleEl = $('#vault-detail-title');
    if (titleEl) titleEl.textContent = label;
    const subEl = $('#vault-detail-sub');
    if (subEl) subEl.textContent = isDemo ? '开箱即用 · 无需配置' : ('保存于 ' + new Date(entry.savedAt || Date.now()).toLocaleString('zh-CN'));
    const box = $('#vault-detail-rows');
    if (box) {
      box.innerHTML = '';
      for (const row of rows) {
        const dt = document.createElement('dt');
        dt.textContent = row[0];
        const dd = document.createElement('dd');
        dd.textContent = row[1];
        box.appendChild(dt);
        box.appendChild(dd);
      }
    }
    modal.hidden = false;
    return true;
  }
