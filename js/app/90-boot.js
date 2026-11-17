  /* ── 启动 ───────────────────────────────────────────────── */
  const ro = new ResizeObserver(() => resize());
  ro.observe(shell);

  settings.themeMode = settings.themeMode || loadTheme();
  applyTheme();
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener('change', () => { if ((settings.themeMode || 'system') === 'system') applyTheme(); });
  }
  loadMeta();
  const sortSelect = $('#sort-mode');
  if (sortSelect) {
    sortSelect.value = state.sortMode;
    sortSelect.addEventListener('change', () => {
      state.sortMode = sortSelect.value;
      try { store.set(SORT_KEY, state.sortMode); } catch (_) {}
      renderTree();
      toast('排序：' + sortSelect.options[sortSelect.selectedIndex].textContent);
    });
  }

  resize();
  syncSettingsUI();
  renderLegend();
  const localVault = loadLocalVault();
  if (localVault) {
    loadFiles(localVault.files, localVault.label || '本地库');
    toast('已恢复本地笔记库（' + localVault.files.length + ' 个文件）');
  } else {
    loadDemo();
  }
  showView('note');
  if (state.graph && state.graph.notes[0]) {
    const restoreTab = state.activeTab;
    if (restoreTab && state.graph.notes.some(n => n.id === restoreTab)) openNote(restoreTab);
    else openNote(state.graph.notes[0].id);
  } else {
    renderNoteTabs();
  }
  try {
    const params = new URLSearchParams(location.search);
    const themeParam = params.get('theme');
    if (themeParam === 'dark' || themeParam === 'light' || themeParam === 'system') { settings.themeMode = themeParam; }
    const bgParam = params.get('bg');
    if (bgParam) { settings.bgPreset = bgParam; }
    applyTheme();
    if (params.get('view') === 'graph') showView('graph');
    if (params.get('ai') === '0') setAiPanel(false);
    if (params.get('prefs') === '1') openPrefs();
    const openTitle = params.get('note');
    if (openTitle) openNoteByTitle(openTitle);
  } catch (_) {}
  applyAskMode('tutor');
  ai.initRecords().then(() => {
    if (typeof migrateMistakeFolders === 'function') migrateMistakeFolders();
  });
  pluginHost.boot();
  renderPluginUI();
  refreshNoteWidgets();
  pluginHost.emit('app:ready', { notes: state.graph ? state.graph.notes.length : 0 });
  if (typeof initLauncher === 'function') initLauncher();
  requestAnimationFrame(frame);

  window.__raceAiNote = {
    state, settings, rebuild, fitView, setMode, openNote, openNoteByTitle, sortNotes, sortFolders, handleDrop, touchUsage, showView, setAiPanel, openPrefs, applyAskMode, applyTheme, cycleTheme, quickSave, saveEditing, openRecordDetail, continueAsking, closeNoteTab, renderNoteTabs, openGraphMenu, closeGraphMenu, bindDiskRoot, syncDiskNow, resetDiskBinding, pluginHost, renderPluginUI, refreshNoteWidgets, loadFiles, loadDemo, ai,
    openLauncher, closeLauncher, enterVault, renderLauncher, removeVaultBook, vaultLibrary: readVaultList, commitActiveVault,
    openVaultMenu, closeVaultMenu, showVaultDetail, duplicateVaultBook, renameVaultBook, backupVaultBook, startLauncherPick, launcherPickDone, openViaPicker, createVaultBook, vaultTrash: readTrash, restoreVaultBook, purgeTrashBook, openTrashModal,
    get graph() { return state.graph; },
    query, vault, physics, render
  };
  window.__wenmoNotes = window.__raceAiNote; // 新名字别名；旧 API 名保留给测试与插件兼容
  console.log('[问墨笔记] ready');
