
  /* ── 文件树：多级目录 + 增删改查 ───────────────────────── */
  const VAULT_KEY = 'vault';
  let treeMenuTarget = null;

  const USAGE_KEY = 'usage';
  const ORDER_KEY = 'order';
  const SORT_KEY = 'sort';

  function loadMeta() {
    try { state.usage = store.getJSON(USAGE_KEY, {}) || {}; } catch (_) { state.usage = {}; }
    try { state.manualOrder = store.getJSON(ORDER_KEY, {}) || {}; } catch (_) { state.manualOrder = {}; }
    try { state.sortMode = store.get(SORT_KEY, 'usage') || 'usage'; } catch (_) { state.sortMode = 'usage'; }
  }

  function saveUsage() {
    try { store.setJSON(USAGE_KEY, state.usage); } catch (_) {}
  }

  function saveOrder() {
    try { store.setJSON(ORDER_KEY, state.manualOrder); } catch (_) {}
  }

  /** 记录一次使用：打开/编辑都会累加，用于「使用频率」和「更新日期」排序 */
  function touchUsage(path, kind) {
    if (!path) return;
    const rec = state.usage[path] || { count: 0, openedAt: 0, updatedAt: 0 };
    if (kind === 'open') rec.count += 1;
    rec.openedAt = Date.now();
    if (kind !== 'open') rec.updatedAt = Date.now();
    state.usage[path] = rec;
    saveUsage();
  }

  function usageOf(path) {
    const rec = state.usage[path];
    return rec ? rec.count : 0;
  }

  function updatedAtOf(path) {
    const rec = state.usage[path];
    if (rec && rec.updatedAt) return rec.updatedAt;
    if (rec && rec.openedAt) return rec.openedAt;
    const file = state.files.find(f => f.path === path);
    return (file && file.mtime) || 0;
  }

  /** 文件夹聚合使用频率：其下所有笔记之和 */
  function folderUsage(folderPath) {
    const prefix = folderPath + '/';
    let total = 0;
    for (const key in state.usage) {
      if (key.startsWith(prefix)) total += state.usage[key].count || 0;
    }
    return total;
  }

  function folderUpdatedAt(folderPath) {
    const prefix = folderPath + '/';
    let latest = 0;
    for (const key in state.usage) {
      if (key.startsWith(prefix)) latest = Math.max(latest, updatedAtOf(key));
    }
    return latest;
  }

  /** 手动顺序：没记录过的按名称排在后面 */
  function manualRank(parentPath, name) {
    const list = state.manualOrder[parentPath || ''] || [];
    const i = list.indexOf(name);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }

  function setManualOrder(parentPath, names) {
    state.manualOrder[parentPath || ''] = names;
    saveOrder();
  }

  function saveLocalVault() {
    try {
      store.setJSON(VAULT_KEY, {
        label: state.vaultLabel,
        savedAt: Date.now(),
        files: state.files
      });
    } catch (_) {}
    if (typeof scheduleDiskSync === 'function') scheduleDiskSync();
  }

  function loadLocalVault() {
    try {
      const raw = store.getJSON(VAULT_KEY, null);
      if (!raw || !Array.isArray(raw.files) || !raw.files.length) return null;
      return raw;
    } catch (_) {
      return null;
    }
  }

  /** 由文件路径构建多级树 */
  function buildTree(notes) {
    const root = { name: '', path: '', folders: new Map(), notes: [] };
    for (const note of notes) {
      const parts = String(note.path || '').split('/');
      const fileName = parts.pop();
      let cursor = root;
      let acc = '';
      for (const part of parts) {
        acc = acc ? acc + '/' + part : part;
        if (!cursor.folders.has(part)) {
          cursor.folders.set(part, { name: part, path: acc, folders: new Map(), notes: [] });
        }
        cursor = cursor.folders.get(part);
      }
      cursor.notes.push(Object.assign({ fileName: fileName }, note));
    }
    return root;
  }

  function allFolderPaths() {
    const paths = [];
    const root = buildTree(state.graph ? state.graph.notes : []);
    const walk = node => {
      for (const folder of node.folders.values()) {
        paths.push(folder.path);
        walk(folder);
      }
    };
    walk(root);
    return paths;
  }

  function collapseAllFolders() {
    const paths = allFolderPaths();
    if (!paths.length) return toast('当前没有可收起的文件夹');
    const scrollTop = fileTree.scrollTop;
    state.collapsedFolders.clear();
    for (const path of paths) state.collapsedFolders.add(path);
    renderTree();
    fileTree.scrollTop = scrollTop;
    toast('已收起全部文件夹');
  }

  function expandAllFolders() {
    if (!state.collapsedFolders.size) {
      renderTree();
      return toast('文件夹已经全部展开');
    }
    const scrollTop = fileTree.scrollTop;
    state.collapsedFolders.clear();
    renderTree();
    fileTree.scrollTop = scrollTop;
    toast('已展开全部文件夹');
  }

  function renderTree() {
    fileTree.innerHTML = '';
    const notes = state.graph ? state.graph.notes : [];
    if (!notes.length) {
      const empty = document.createElement('p');
      empty.className = 'sidebar-foot';
      empty.textContent = '（空库，点上面的 ＋ 新建笔记）';
      fileTree.appendChild(empty);
      return;
    }
    fileTree.appendChild(renderFolderNode(buildTree(notes), 0));
  }

  /** 按当前排序模式排序文件夹 */
  function sortFolders(list, parentPath) {
    if (state.sortMode === 'manual') {
      return list.slice().sort((a, b) => {
        const ra = manualRank(parentPath, a.name);
        const rb = manualRank(parentPath, b.name);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
    }
    if (state.sortMode === 'updated') {
      return list.slice().sort((a, b) => folderUpdatedAt(b.path) - folderUpdatedAt(a.path) || a.name.localeCompare(b.name, 'zh-CN'));
    }
    if (state.sortMode === 'name') {
      return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    // 默认：使用频率优先
    return list.slice().sort((a, b) => folderUsage(b.path) - folderUsage(a.path) || a.name.localeCompare(b.name, 'zh-CN'));
  }

  /** 按当前排序模式排序笔记 */
  function sortNotes(list, parentPath) {
    if (state.sortMode === 'manual') {
      return list.slice().sort((a, b) => {
        const ra = manualRank(parentPath, a.fileName);
        const rb = manualRank(parentPath, b.fileName);
        if (ra !== rb) return ra - rb;
        return a.title.localeCompare(b.title, 'zh-CN');
      });
    }
    if (state.sortMode === 'updated') {
      return list.slice().sort((a, b) => updatedAtOf(b.path) - updatedAtOf(a.path) || a.title.localeCompare(b.title, 'zh-CN'));
    }
    if (state.sortMode === 'name') {
      return list.slice().sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    }
    return list.slice().sort((a, b) => usageOf(b.path) - usageOf(a.path) || a.title.localeCompare(b.title, 'zh-CN'));
  }

  function renderFolderNode(node, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-group';
    const collapsed = state.collapsedFolders;

    for (const folder of sortFolders([...node.folders.values()], node.path)) {
      const row = document.createElement('div');
      row.className = 'tree-folder';
      row.style.paddingLeft = (9 + depth * 12) + 'px';
      row.dataset.folder = folder.path;
      row.dataset.depth = String(depth);
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '▾';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = folder.name;
      row.append(chevron, name);

      const children = document.createElement('div');
      children.className = 'tree-children';
      children.appendChild(renderFolderNode(folder, depth + 1));
      const isCollapsed = collapsed.has(folder.path);
      children.hidden = isCollapsed;
      row.classList.toggle('is-collapsed', isCollapsed);

      row.addEventListener('click', () => {
        if (collapsed.has(folder.path)) collapsed.delete(folder.path);
        else collapsed.add(folder.path);
        children.hidden = collapsed.has(folder.path);
        row.classList.toggle('is-collapsed', children.hidden);
      });
      row.addEventListener('contextmenu', e => openTreeMenu(e, 'folder', folder.path));
      row.draggable = true;
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', 'folder:' + folder.path);
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', e => {
        e.preventDefault();
        row.classList.add('is-drop');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('is-drop');
        handleDrop(e.dataTransfer.getData('text/plain'), { kind: 'folder', path: folder.path });
      });

      wrap.appendChild(row);
      wrap.appendChild(children);
    }

    for (const note of sortNotes(node.notes, node.path)) {
      const row = document.createElement('div');
      row.className = 'tree-file';
      row.style.paddingLeft = (28 + depth * 12) + 'px';
      row.dataset.id = note.id;
      row.draggable = true;
      row.title = note.path;
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '▤';
      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = note.title;
      row.append(icon, label);
      if (state.favorites && state.favorites.has(note.path)) {
        const star = document.createElement('span');
        star.className = 'file-fav';
        star.textContent = '★';
        star.title = '已收藏';
        row.appendChild(star);
      }
      row.addEventListener('click', () => { openNote(note.id); showView('note'); });
      row.addEventListener('contextmenu', e => openTreeMenu(e, 'note', note.path));
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', 'note:' + note.path);
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', e => {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        row.classList.toggle('is-drop-before', !after);
        row.classList.toggle('is-drop-after', after);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('is-drop-before', 'is-drop-after');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('is-drop-before', 'is-drop-after');
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        handleDrop(e.dataTransfer.getData('text/plain'), { kind: 'note', path: note.path, after: after, parent: node.path });
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* ── 右键菜单 ───────────────────────────────────────────── */
  const treeMenu = $('#tree-menu');

  function openTreeMenu(event, kind, path) {
    event.preventDefault();
    event.stopPropagation();
    treeMenuTarget = { kind: kind, path: path };
    treeMenu.hidden = false;
    treeMenu.style.left = Math.min(event.clientX, window.innerWidth - 160) + 'px';
    treeMenu.style.top = Math.min(event.clientY, window.innerHeight - 150) + 'px';
  }

  function closeTreeMenu() {
    treeMenu.hidden = true;
    treeMenuTarget = null;
  }

  document.addEventListener('mousedown', e => {
    if (!treeMenu.hidden && !e.target.closest('#tree-menu')) closeTreeMenu();
  });

  treeMenu.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || !treeMenuTarget) return;
    const target = treeMenuTarget;
    closeTreeMenu();
    const dir = target.kind === 'folder' ? target.path : target.path.split('/').slice(0, -1).join('/');
    if (btn.dataset.act === 'new-note') createNote(dir);
    else if (btn.dataset.act === 'new-folder') createFolder(dir);
    else if (btn.dataset.act === 'rename') renameEntry(target);
    else if (btn.dataset.act === 'delete') deleteEntry(target);
  });

  $('#btn-new-note').addEventListener('click', () => {
    const dir = state.selectedId && state.graph
      ? (state.graph.nodes.find(n => n.id === state.selectedId) || { path: '' }).path.split('/').slice(0, -1).join('/')
      : '';
    createNote(dir);
  });
  $('#btn-new-folder').addEventListener('click', () => createFolder(''));
  $('#btn-collapse-all').addEventListener('click', collapseAllFolders);
  $('#btn-expand-all').addEventListener('click', expandAllFolders);

  /* ── 增删改查 ───────────────────────────────────────────── */
  function uniquePath(dir, base) {
    let candidate = (dir ? dir + '/' : '') + base + '.md';
    let i = 2;
    while (state.files.some(f => f.path === candidate)) {
      candidate = (dir ? dir + '/' : '') + base + '-' + i + '.md';
      i += 1;
    }
    return candidate;
  }

  async function createNote(dir) {
    const input = await askText({ title: '新建笔记', desc: '输入标题，会在当前文件夹下创建 .md 文件', value: '未命名笔记', placeholder: '例如：导数错题整理' });
    if (input == null) return;
    const title = input.trim();
    if (!title) return;
    const path = uniquePath(dir || '', title.replace(/[\/:*?"<>|]/g, '-'));
    state.files.push({ path: path, content: '# ' + title + '\n\n' });
    refreshVault('已新建笔记：' + title);
    openNoteByTitle(title);
    showView('note');
  }

  async function createFolder(dir) {
    const input = await askText({ title: '新建文件夹', desc: '文件夹可以无限嵌套', value: '新文件夹', placeholder: '例如：40-竞赛' });
    if (input == null) return;
    const folder = input.trim().replace(/[\/:*?"<>|]/g, '-');
    if (!folder) return;
    const path = (dir ? dir + '/' : '') + folder + '/.folder.md';
    if (state.files.some(f => f.path === path)) return toast('这个文件夹已存在');
    state.files.push({ path: path, content: '# ' + folder + '\n\n' });
    refreshVault('已新建文件夹：' + folder);
  }

  async function renameEntry(target) {
    const isFolder = target.kind === 'folder';
    const base = target.path.split('/').pop().replace(/\.md$/, '');
    const input = await askText({ title: isFolder ? '重命名文件夹' : '重命名笔记', desc: '改名后双链会自动重新解析', value: base });
    if (input == null) return;
    const clean = input.trim().replace(/[\/:*?"<>|]/g, '-');
    if (!clean || clean === base) return;
    const parentDir = target.path.split('/').slice(0, -1).join('/');
    if (isFolder) {
      const prefix = target.path + '/';
      for (const file of state.files) {
        if (file.path.startsWith(prefix)) {
          file.path = (parentDir ? parentDir + '/' : '') + clean + '/' + file.path.slice(prefix.length);
        }
      }
    } else {
      const file = state.files.find(f => f.path === target.path);
      if (!file) return;
      file.path = uniquePath(parentDir, clean);
    }
    refreshVault('已重命名');
  }

  async function deleteEntry(target) {
    const isFolder = target.kind === 'folder';
    const label = isFolder ? '文件夹 ' + target.path + ' 及其中所有内容' : target.path;
    const ok = await askConfirm({ title: '确认删除', message: '将删除 ' + label + '，此操作不可撤销。', okText: '删除', danger: true });
    if (!ok) return;
    if (isFolder) {
      const prefix = target.path + '/';
      state.files = state.files.filter(f => !f.path.startsWith(prefix));
    } else {
      state.files = state.files.filter(f => f.path !== target.path);
    }
    refreshVault('已删除');
  }

  function moveNote(fromPath, toDir) {
    const file = state.files.find(f => f.path === fromPath);
    if (!file) return;
    const currentDir = fromPath.split('/').slice(0, -1).join('/');
    if (currentDir === toDir) return;
    const name = fromPath.split('/').pop().replace(/\.md$/, '');
    file.path = uniquePath(toDir, name);
    refreshVault('已移动到 ' + (toDir || '根目录'));
  }

  /** 处理拖放：笔记进文件夹=移动；同级之间=手动排序 */
  function handleDrop(payload, target) {
    if (!payload) return;
    const sep = payload.indexOf(':');
    const kind = payload.slice(0, sep);
    const fromPath = payload.slice(sep + 1);
    if (!fromPath) return;

    if (kind === 'note') {
      if (target.kind === 'folder') { moveNote(fromPath, target.path); return; }
      const fromDir = fromPath.split('/').slice(0, -1).join('/');
      const toDir = target.parent || '';
      if (fromDir !== toDir) moveNote(fromPath, toDir);
      reorderWithin(toDir, fromPath, target.path, target.after);
      return;
    }

    if (kind === 'folder') {
      if (target.kind !== 'folder') return;
      const parent = fromPath.split('/').slice(0, -1).join('/');
      const targetParent = target.path.split('/').slice(0, -1).join('/');
      if (parent !== targetParent) return;
      reorderFolders(targetParent, fromPath, target.path);
    }
  }

  /** 笔记同级重排：把 fromPath 放到 targetPath 前/后，写入手动顺序 */
  function reorderWithin(dir, fromPath, targetPath, after) {
    const notes = sortNotes(
      (state.graph ? state.graph.notes : []).filter(n => n.path.startsWith(dir ? dir + '/' : '')
        && !n.path.slice(dir ? dir.length + 1 : 0).includes('/')),
      dir
    );
    const names = notes.map(n => n.path.split('/').pop());
    const fromName = fromPath.split('/').pop();
    const targetName = targetPath.split('/').pop();
    if (fromName === targetName) return;
    const without = names.filter(n => n !== fromName);
    let idx = without.indexOf(targetName);
    if (idx < 0) idx = without.length;
    else if (after) idx += 1;
    without.splice(idx, 0, fromName);
    setManualOrder(dir, without);
    switchToManual();
  }

  /** 文件夹同级重排 */
  function reorderFolders(parentPath, fromPath, targetPath) {
    const prefix = parentPath ? parentPath + '/' : '';
    const folders = sortFolders(
      [...new Set((state.graph ? state.graph.notes : []).
        map(n => n.path).filter(p => p.startsWith(prefix)).
        map(p => p.slice(prefix.length).split('/')[0]).filter(Boolean))]
        .map(name => ({ name: name, path: prefix + name })),
      parentPath
    );
    const names = folders.map(f => f.name);
    const fromName = fromPath.split('/').pop();
    const targetName = targetPath.split('/').pop();
    if (fromName === targetName) return;
    const without = names.filter(n => n !== fromName);
    let idx = without.indexOf(targetName);
    if (idx < 0) idx = without.length;
    without.splice(idx, 0, fromName);
    const existing = state.manualOrder[parentPath || ''] || [];
    const merged = without.concat(existing.filter(n => !without.includes(n)));
    setManualOrder(parentPath, merged);
    switchToManual();
  }

  /** 拖过一次就切到手动排序，避免下次刷新又被打回按频率排 */
  function switchToManual() {
    if (state.sortMode !== 'manual') {
      state.sortMode = 'manual';
      try { store.set(SORT_KEY, 'manual'); } catch (_) {}
      const sel = $('#sort-mode');
      if (sel) sel.value = 'manual';
    }
    refreshVault();
  }

  /** 结构改动后统一刷新：重解析 → 重画树 → 落本地 */
  function refreshVault(message) {
    const keep = currentNoteId;
    state.graph = vault.buildVault(state.files);
    state.positions = new Map();
    rebuild({ fresh: true });
    renderTree();
    if (keep && state.graph.nodes.some(n => n.id === keep)) openNote(keep);
    else if (state.graph.notes[0]) openNote(state.graph.notes[0].id);
    saveLocalVault();
    if (message) toast(message);
  }

  function updateTreeSelection() {
    $$('#file-tree .tree-file').forEach(row => {
      row.classList.toggle('is-active', row.dataset.id === state.selectedId);
    });
  }

