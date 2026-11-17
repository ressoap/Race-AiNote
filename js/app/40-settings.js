  /* ── 设置面板 ───────────────────────────────────────────── */
  function formatSetting(key, value) {
    if (key === 'nodeSize') return Number(value).toFixed(1) + '×';
    if (key === 'linkWidth') return Number(value).toFixed(1);
    if (key === 'linkDistance') return Math.round(value) + 'px';
    return String(Math.round(value * 10) / 10);
  }

  function syncSettingsUI() {
    $$('[data-toggle]').forEach(el => {
      el.checked = Boolean(settings[el.dataset.toggle]);
    });
    $$('[data-setting]').forEach(el => {
      el.value = settings[el.dataset.setting];
      const out = $('#out-' + el.dataset.setting);
      if (out) out.textContent = formatSetting(el.dataset.setting, el.value);
    });
    $('#depth-input').value = settings.depth;
    $('#depth-output').textContent = String(settings.depth);
    $$('#mode-global, #mode-local').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.mode === settings.mode);
    });
    renderGroups();
  }

  function renderGroups() {
    const list = $('#group-list');
    list.innerHTML = '';
    settings.groups.forEach((group, index) => {
      const row = document.createElement('div');
      row.className = 'group-row';

      const color = document.createElement('input');
      color.type = 'color';
      color.value = group.color;
      color.addEventListener('input', () => { settings.groups[index].color = color.value; saveSettings(); state.dirty = true; });

      const text = document.createElement('input');
      text.type = 'text';
      text.value = group.query;
      text.placeholder = '搜索表达式，如 tag:错题';
      text.addEventListener('input', () => { settings.groups[index].query = text.value; saveSettings(); state.dirty = true; });

      const remove = document.createElement('button');
      remove.className = 'icon-btn small';
      remove.title = '删除分组';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        settings.groups.splice(index, 1);
        saveSettings();
        renderGroups();
        state.dirty = true;
      });

      row.append(color, text, remove);
      list.appendChild(row);
    });
  }

  $('#add-group').addEventListener('click', () => {
    settings.groups.push({ query: '', color: '#7a9eff' });
    saveSettings();
    renderGroups();
  });

  $('#reset-settings').addEventListener('click', () => {
    Object.assign(settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
    saveSettings();
    syncSettingsUI();
    rebuild({ fit: true });
    toast('已恢复默认设置');
  });

  $$('[data-toggle]').forEach(el => {
    el.addEventListener('change', () => {
      settings[el.dataset.toggle] = el.checked;
      saveSettings();
      rebuild({});
      state.dirty = true;
    });
  });

  $$('[data-setting]').forEach(el => {
    el.addEventListener('input', () => {
      const key = el.dataset.setting;
      settings[key] = Number(el.value);
      const out = $('#out-' + key);
      if (out) out.textContent = formatSetting(key, settings[key]);
      if (key === 'textFade') state.dirty = true;
      else {
        if (state.sim) state.sim.setSettings(physicsSettings());
        if (state.sim && key !== 'linkWidth') state.sim.reheat(0.25);
        state.dirty = true;
      }
      saveSettings();
    });
  });

  function setPanel(open) {
    settingsPanel.hidden = !open;
  }

  /* ── 搜索 ───────────────────────────────────────────────── */
  function setSearch(value) {
    state.query = value;
    searchInput.value = value;
    rebuild({});
    state.dirty = true;
    const n = state.nodes.length;
    if (value.trim()) toast('搜索命中 ' + n + ' 个节点');
  }

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    rebuild({});
    state.dirty = true;
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!prefsModal.hidden) { closePrefs(); return; } searchInput.value = ''; setSearch(''); searchInput.blur(); }
  });
  $('#search-clear').addEventListener('click', () => { setSearch(''); searchInput.focus(); });

  $('#file-search').addEventListener('input', e => {
    const keyword = e.target.value.trim().toLowerCase();
    $$('#file-tree .tree-file').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.classList.toggle('is-muted', Boolean(keyword) && !text.includes(keyword));
    });
  });

  /* ── 模式 / 视图按钮 ─────────────────────────────────────── */
  function setMode(mode) {
    if (settings.mode === mode) return;
    settings.mode = mode;
    saveSettings();
    syncSettingsUI();
    rebuild({ fit: true });
    toast(mode === 'local' ? '局部图谱 · 深度 ' + settings.depth : '全局图谱');
  }

  $$('#mode-global, #mode-local').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('#depth-input').addEventListener('input', e => {
    settings.depth = Number(e.target.value);
    $('#depth-output').textContent = String(settings.depth);
    saveSettings();
    if (settings.mode === 'local') rebuild({});
  });
  $('#btn-zoom-in').addEventListener('click', () => zoomAt(1.22));
  $('#btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.22));
  $('#btn-fit').addEventListener('click', () => fitView(true));
  $('#btn-relayout').addEventListener('click', () => {
    state.positions.clear();
    for (const node of state.nodes) { delete node.x; delete node.y; node.vx = 0; node.vy = 0; }
    rebuild({ fresh: true, fit: true });
    toast('已重新计算布局');
  });
  $('#btn-theme').addEventListener('click', cycleTheme);
  $('#btn-settings').addEventListener('click', () => setPanel(settingsPanel.hidden));
  $('#btn-settings-close').addEventListener('click', () => setPanel(false));

  $('#btn-open-folder').addEventListener('click', openViaPicker);
  $('#btn-demo').addEventListener('click', loadDemo);
  $('#btn-empty-demo').addEventListener('click', loadDemo);
  $('#btn-clear').addEventListener('click', () => {
    state.graph = null;
    state.files = [];
    state.nodes = [];
    state.links = [];
    state.index = new Map();
    state.sim = null;
    state.selectedId = null;
    state.positions.clear();
    state.vaultLabel = '（空）';
    $('#vault-name').textContent = '（空）';
    $('#vault-stats').textContent = '0 篇笔记';
    $('#graph-empty').hidden = false;
    renderTree();
    updateStats(new Map());
    state.dirty = true;
    toast('已清空');
  });

  $('#folder-input').addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const rootName = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : '本地库';
    const parsed = await readFileList(files);
    if (!parsed.length) return toast('这个文件夹里没有 Markdown 笔记');
    loadFiles(parsed, rootName);
    toast('已读取 ' + rootName + '：' + parsed.length + ' 个文件');
    e.target.value = '';
  });

  /* ── 拖放 ───────────────────────────────────────────────── */
  let dragDepth = 0;
  ['dragenter', 'dragover'].forEach(type => {
    window.addEventListener(type, e => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      if (e.target && e.target.closest && e.target.closest('#ai-panel')) return;
      e.preventDefault();
      if (type === 'dragenter') dragDepth += 1;
      $('#drop-hint').hidden = false;
    });
  });
  window.addEventListener('dragleave', e => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#drop-hint').hidden = true;
  });
  window.addEventListener('drop', async e => {
    if (!e.dataTransfer) return;
    if (e.target && e.target.closest && e.target.closest('#ai-panel')) return;
    e.preventDefault();
    dragDepth = 0;
    $('#drop-hint').hidden = true;
    try {
      const parsed = await readDataTransfer(e.dataTransfer);
      if (!parsed.length) return toast('没有找到 Markdown 笔记');
      loadFiles(parsed, '拖入的库');
      toast('已读取 ' + parsed.length + ' 个文件');
    } catch (err) {
      toast('读取失败：' + (err && err.message ? err.message : err));
    }
  });

  /* ── 右键：接管浏览器默认菜单 ───────────────────────────── */
  document.addEventListener('contextmenu', e => {
    // 输入框和富文本编辑区保留原生菜单（复制 / 粘贴 / 拼写检查要用）
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
  });

  /* ── 键盘 ───────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    const isSaveCombo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
    if (isSaveCombo) {
      e.preventDefault();
      if (e.shiftKey) downloadNote();
      else quickSave();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (e.key === 'Escape') {
      if (!settingsPanel.hidden) { setPanel(false); return; }
      if (document.activeElement === searchInput) { setSearch(''); searchInput.blur(); return; }
      state.selectedId = null;
      state.dirty = true;
      return;
    }
    if (inField) return;
    if (e.key === '/') { e.preventDefault(); searchInput.focus(); return; }
    const k = e.key.toLowerCase();
    if (k === 'p') { openPrefs(); return; }
    if (k === 'a') { setAiPanel($('#ai-panel').classList.contains('is-collapsed')); return; }
    if (k === 'f') fitView(true);
    else if (k === 'r') $('#btn-relayout').click();
    else if (k === 'g') setMode('global');
    else if (k === 'l') setMode('local');
    else if (k === 's') setPanel(settingsPanel.hidden);
    else if (e.key === '+' || e.key === '=') zoomAt(1.22);
    else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.22);
  });

  /* ── 图例 ───────────────────────────────────────────────── */
  function renderLegend() {
    const legend = $('#legend');
    legend.innerHTML = '';
    const colors = render.palette(state.theme);
    const items = [
      { label: '笔记', color: colors.node },
      { label: '标签', color: colors.tag },
      { label: '附件', color: colors.attachment },
      { label: '未创建', color: colors.unresolved }
    ];
    for (const group of settings.groups) {
      if (group.query && group.query.trim()) items.push({ label: group.query, color: group.color });
    }
    for (const item of items) {
      const wrap = document.createElement('span');
      wrap.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-swatch';
      dot.style.background = item.color;
      const label = document.createElement('span');
      label.textContent = item.label;
      wrap.append(dot, label);
      legend.appendChild(wrap);
    }
  }

