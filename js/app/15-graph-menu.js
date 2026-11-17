  /* ── 关系图谱右键菜单 ───────────────────────────────────── */
  const graphMenu = $('#graph-menu');
  const graphMenuTitle = $('#graph-menu-title');
  const graphMenuFavLabel = $('#graph-menu-fav-label');
  const graphPicker = $('#graph-picker');
  const graphPickerTitle = $('#graph-picker-title');
  const graphPickerDesc = $('#graph-picker-desc');
  const graphPickerSearch = $('#graph-picker-search');
  const graphPickerList = $('#graph-picker-list');
  let graphMenuNode = null;
  let graphPickerMode = '';
  let graphPickerNode = null;

  function loadFavorites() {
    try {
      const saved = store.getJSON('favorites', []);
      state.favorites = new Set(Array.isArray(saved) ? saved.filter(x => typeof x === 'string' && x) : []);
    } catch (_) {
      state.favorites = new Set();
    }
  }
  loadFavorites();

  function saveFavorites() {
    try { store.setJSON('favorites', [...state.favorites].slice(0, 500)); } catch (_) {}
  }

  function closeGraphMenu() {
    if (graphMenu) graphMenu.hidden = true;
    if (graphMenu) {
      graphMenu.classList.remove('align-left');
      graphMenu.querySelectorAll('.graph-menu-subwrap.is-open').forEach(el => el.classList.remove('is-open'));
    }
    graphMenuNode = null;
  }

  function openGraphMenu(event, node) {
    if (!graphMenu || !node) return;
    graphMenuNode = node;
    if (graphMenuTitle) graphMenuTitle.textContent = node.title || node.path || '未命名节点';
    if (graphMenuFavLabel) {
      graphMenuFavLabel.textContent = state.favorites.has(node.path) ? '取消收藏' : '收藏';
    }
    graphMenu.hidden = false;
    graphMenu.classList.remove('align-left');
    graphMenu.querySelectorAll('.graph-menu-subwrap.is-open').forEach(el => el.classList.remove('is-open'));
    const rect = graphMenu.getBoundingClientRect();
    const width = rect.width || 270;
    const height = rect.height || 420;
    let left = Math.min(event.clientX, window.innerWidth - width - 10);
    let top = Math.min(event.clientY, window.innerHeight - height - 10);
    left = Math.max(8, left);
    top = Math.max(8, top);
    graphMenu.style.left = left + 'px';
    graphMenu.style.top = top + 'px';
    if (left + width + 196 > window.innerWidth) graphMenu.classList.add('align-left');
  }

  function copyText(text) {
    const value = String(text == null ? '' : text);
    const done = () => toast('已复制：' + value.slice(0, 46));
    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        done();
      } catch (_) {
        toast('复制失败，请手动复制');
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function noteFile(node) {
    return state.files.find(f => f.path === node.path) || null;
  }

  function downloadNoteFile(node) {
    const file = noteFile(node);
    const blob = new Blob([String((file && file.content) || node.content || '')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = String(node.path || node.title || 'note.md').split('/').pop() || 'note.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出 ' + a.download + '，可用系统默认应用打开');
  }

  function revealInTree(node) {
    const parts = String(node.path || '').split('/');
    parts.pop();
    let acc = '';
    for (const part of parts) {
      acc = acc ? acc + '/' + part : part;
      state.collapsedFolders.delete(acc);
    }
    state.selectedId = node.id;
    renderTree();
    updateTreeSelection();
    const row = [...document.querySelectorAll('#file-tree .tree-file')].find(el => el.dataset.id === node.id);
    if (row) {
      if (row.scrollIntoView) row.scrollIntoView({ block: 'center' });
      row.classList.add('is-active');
      toast('已在文件列表中定位');
    }
  }

  function focusGraphNode(node) {
    showView('graph');
    if (state.index.has(node.id)) focusNode(node.id);
  }

  function showBacklinks(node) {
    openNote(node.id);
    showView('note');
    setTimeout(() => {
      const links = document.querySelector('.note-links');
      if (!links) return;
      if (links.scrollIntoView) links.scrollIntoView({ behavior: 'smooth', block: 'center' });
      links.classList.add('record-locate-flash');
      setTimeout(() => links.classList.remove('record-locate-flash'), 2400);
    }, 60);
  }

  function openNoteInNewWindow(node) {
    try {
      const url = new URL(location.href);
      url.searchParams.set('note', node.title);
      url.searchParams.set('view', 'note');
      const win = window.open(url.href, '_blank', 'noopener');
      if (!win) toast('浏览器拦截了新窗口，请允许弹窗后重试');
    } catch (_) {
      toast('当前环境无法打开新窗口');
    }
  }

  function toggleFavorite(node) {
    if (state.favorites.has(node.path)) {
      state.favorites.delete(node.path);
      toast('已取消收藏：' + node.title);
    } else {
      state.favorites.add(node.path);
      toast('已收藏：' + node.title);
    }
    saveFavorites();
    renderTree();
    updateTreeSelection();
    state.dirty = true;
    if (graphMenuFavLabel) graphMenuFavLabel.textContent = state.favorites.has(node.path) ? '取消收藏' : '收藏';
  }

  async function deleteGraphNote(node) {
    const ok = await askConfirm({
      title: '确认删除',
      message: '将删除 ' + node.path + '，此操作不可撤销。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    state.files = state.files.filter(f => f.path !== node.path);
    if (state.favorites.delete(node.path)) saveFavorites();
    refreshVault('已删除');
  }

  /* ── 文件夹 / 目标笔记选择器 ─────────────────────────────── */
  function closeGraphPicker() {
    if (graphPicker) graphPicker.hidden = true;
    graphPickerMode = '';
    graphPickerNode = null;
  }

  function openGraphPicker(mode, node) {
    if (!graphPicker) return;
    graphPickerMode = mode;
    graphPickerNode = node;
    if (graphPickerTitle) graphPickerTitle.textContent = mode === 'move' ? '移动文件到…' : '合并到笔记…';
    if (graphPickerDesc) {
      graphPickerDesc.textContent = mode === 'move'
        ? '为《' + node.title + '》选择一个目标文件夹'
        : '选择要接收《' + node.title + '》内容的笔记';
    }
    if (graphPickerSearch) {
      graphPickerSearch.value = '';
      graphPickerSearch.placeholder = mode === 'move' ? '搜索文件夹…' : '搜索笔记标题…';
    }
    graphPicker.hidden = false;
    renderGraphPickerList('');
    if (graphPickerSearch) graphPickerSearch.focus();
  }

  function renderGraphPickerList(keyword) {
    if (!graphPickerList) return;
    graphPickerList.innerHTML = '';
    const kw = String(keyword || '').trim().toLowerCase();
    let items = [];
    if (graphPickerMode === 'move') {
      const currentDir = String(graphPickerNode.path || '').split('/').slice(0, -1).join('/');
      items = [{ value: '', title: '根目录', path: '库根目录' }];
      for (const path of allFolderPaths()) {
        if (path === currentDir) continue;
        items.push({ value: path, title: path.split('/').pop(), path: path });
      }
    } else {
      const notes = state.graph ? state.graph.notes.filter(n => n.id !== graphPickerNode.id) : [];
      items = notes.map(n => ({ value: n.path, title: n.title, path: n.path, node: n }));
    }
    items = items.filter(item => !kw || (item.title + ' ' + item.path).toLowerCase().includes(kw)).slice(0, 80);
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'link-picker-empty';
      p.textContent = graphPickerMode === 'move' ? '没有可用文件夹' : '没有可合并的笔记';
      graphPickerList.appendChild(p);
      return;
    }
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-picker-item';
      const title = document.createElement('span');
      title.textContent = item.title;
      const path = document.createElement('span');
      path.className = 'link-picker-path';
      path.textContent = item.path;
      btn.append(title, path);
      btn.addEventListener('click', () => {
        const source = graphPickerNode;
        const mode = graphPickerMode;
        closeGraphPicker();
        if (!source) return;
        if (mode === 'move') moveGraphNote(source, item.value);
        else mergeGraphNote(source, item.node);
      });
      graphPickerList.appendChild(btn);
    }
  }

  function moveGraphNote(node, targetDir) {
    moveNote(node.path, targetDir);
    const moved = state.graph && state.graph.notes.find(n => n.title === node.title);
    if (moved) openNote(moved.id);
    toast('已移动到 ' + (targetDir || '根目录'));
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function mergeGraphNote(source, target) {
    if (!source || !target || source.id === target.id) return;
    const ok = await askConfirm({
      title: '合并笔记',
      message: '将《' + source.title + '》的正文合并到《' + target.title + '》，然后删除源文件；指向源文件的 Wiki 链接会改指向目标。此操作不可撤销。',
      okText: '合并',
      danger: true
    });
    if (!ok) return;
    const sourceFile = state.files.find(f => f.path === source.path);
    const targetFile = state.files.find(f => f.path === target.path);
    if (!sourceFile || !targetFile) return;
    const parsed = vault.parseFrontmatter(sourceFile.content || '');
    const body = String(parsed.body || sourceFile.content || '').trim();
    targetFile.content = String(targetFile.content || '').replace(/\s*$/, '')
      + '\n\n---\n\n## 来自《' + source.title + '》\n\n' + body + '\n';
    state.files = state.files.filter(f => f.path !== source.path);
    if (state.favorites.delete(source.path)) saveFavorites();
    const names = [source.title, String(source.path || '').replace(/\.md$/i, ''), source.path];
    for (const file of state.files) {
      if (typeof file.content !== 'string') continue;
      let content = file.content;
      for (const name of names) {
        if (!name) continue;
        const re = new RegExp('\\[\\[(' + escapeRegExp(name) + ')(\\|[^\\]]*)?\\]\\]', 'g');
        content = content.replace(re, function (_, _name, alias) {
          return '[[' + target.title + (alias || '') + ']]';
        });
      }
      file.content = content;
    }
    refreshVault('已合并到《' + target.title + '》');
    const targetNode = state.graph && state.graph.notes.find(n => n.path === target.path);
    if (targetNode) openNote(targetNode.id);
  }

  /* ── 菜单动作 ───────────────────────────────────────────── */
  function runGraphAction(action, node) {
    if (!node) return;
    if (action === 'open-tab') { openNote(node.id); showView('note'); return; }
    if (action === 'open-window') { openNoteInNewWindow(node); return; }
    if (action === 'move') { openGraphPicker('move', node); return; }
    if (action === 'favorite') { toggleFavorite(node); return; }
    if (action === 'merge') { openGraphPicker('merge', node); return; }
    if (action === 'copy-relative') { copyText(node.path); return; }
    if (action === 'copy-wikilink') { copyText('[[' + node.title + ']]'); return; }
    if (action === 'copy-title') { copyText(node.title); return; }
    if (action === 'reveal-folder') { revealInTree(node); return; }
    if (action === 'show-backlinks') { showBacklinks(node); return; }
    if (action === 'focus-graph') { focusGraphNode(node); return; }
    if (action === 'default-app') { downloadNoteFile(node); return; }
    if (action === 'explorer') { copyText(node.path); toast('浏览器版已复制相对路径；可在系统资源管理器中定位'); return; }
    if (action === 'show-tree') { revealInTree(node); return; }
    if (action === 'delete') { deleteGraphNote(node); return; }
  }

  if (graphMenu) {
    graphMenu.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.submenu) {
        const wrap = btn.closest('.graph-menu-subwrap');
        const open = wrap.classList.contains('is-open');
        graphMenu.querySelectorAll('.graph-menu-subwrap.is-open').forEach(el => el.classList.remove('is-open'));
        if (!open) wrap.classList.add('is-open');
        return;
      }
      if (!btn.dataset.act) return;
      const node = graphMenuNode;
      closeGraphMenu();
      runGraphAction(btn.dataset.act, node);
    });
  }

  const graphCanvasEl = $('#graph-canvas');
  if (graphCanvasEl) {
    graphCanvasEl.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const point = localPoint(e);
      const hit = hitTest(point.x, point.y);
      if (!hit || hit.type !== 'note') {
        closeGraphMenu();
        return;
      }
      state.selectedId = hit.id;
      state.dirty = true;
      openGraphMenu(e, hit);
    });
  }

  document.addEventListener('mousedown', e => {
    if (graphMenu && !graphMenu.hidden && !e.target.closest('#graph-menu')) closeGraphMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeGraphMenu();
      closeGraphPicker();
    }
  });
  window.addEventListener('resize', closeGraphMenu);
  window.addEventListener('blur', closeGraphMenu);

  if (graphPicker) {
    const closeBtn = $('#graph-picker-close');
    if (closeBtn) closeBtn.addEventListener('click', closeGraphPicker);
    graphPicker.addEventListener('pointerdown', e => { if (e.target === graphPicker) closeGraphPicker(); });
    if (graphPickerSearch) {
      graphPickerSearch.addEventListener('input', e => renderGraphPickerList(e.target.value));
    }
  }
