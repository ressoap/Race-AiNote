  /* ── 浏览器式笔记标签页 ─────────────────────────────────── */
  const NOTE_TABS_MAX = 24;
  const noteTabStrip = $('#note-tab-strip');
  const noteTabsEl = $('#note-tabs');
  let noteTabDragId = null;

  function noteTabNode(id) {
    if (!state.graph) return null;
    return state.graph.nodes.find(n => n.id === id && n.type === 'note') || null;
  }

  function persistNoteTabs() {
    const id = typeof vaultScopeId === 'function' ? vaultScopeId() : 'demo';
    try {
      store.setScopedJSON('noteTabs', id, {
        tabs: state.openTabs.slice(0, NOTE_TABS_MAX),
        active: state.activeTab || null
      });
    } catch (_) {}
  }

  function restoreNoteTabs() {
    const id = typeof vaultScopeId === 'function' ? vaultScopeId() : 'demo';
    store.adoptLegacy('noteTabs', id);
    try {
      const saved = store.getScopedJSON('noteTabs', id, null);
      if (!saved) return;
      const tabs = Array.isArray(saved.tabs) ? saved.tabs : [];
      state.openTabs = tabs
        .filter((id, i) => typeof id === 'string' && id && tabs.indexOf(id) === i)
        .slice(0, NOTE_TABS_MAX);
      if (typeof saved.active === 'string' && saved.active) state.activeTab = saved.active;
    } catch (_) {}
  }

  /** 库重建、切换库、删除笔记后，剔除已经不存在的标签。 */
  function pruneNoteTabs() {
    if (!state.graph) {
      state.openTabs = [];
      state.activeTab = null;
      return;
    }
    const valid = new Set(state.graph.notes.map(n => n.id));
    state.openTabs = state.openTabs.filter(id => valid.has(id));
    if (state.activeTab && !valid.has(state.activeTab)) {
      state.activeTab = valid.has(currentNoteId) ? currentNoteId : null;
    }
  }

  function clearNoteTabDropMarks() {
    $$('#note-tabs .note-tab').forEach(el => {
      el.classList.remove('is-drop-before', 'is-drop-after');
    });
  }

  function focusNoteTab(id) {
    requestAnimationFrame(() => {
      const tab = [...noteTabsEl.querySelectorAll('.note-tab')].find(el => el.dataset.id === id);
      if (tab) tab.focus();
    });
  }

  function moveNoteTab(fromId, targetId, after) {
    const from = state.openTabs.indexOf(fromId);
    const target = state.openTabs.indexOf(targetId);
    if (from < 0 || target < 0 || from === target) return;
    const moved = state.openTabs.splice(from, 1)[0];
    const at = state.openTabs.indexOf(targetId);
    state.openTabs.splice(after ? at + 1 : at, 0, moved);
    renderNoteTabs();
    persistNoteTabs();
  }

  function moveNoteTabToEnd(id) {
    const from = state.openTabs.indexOf(id);
    if (from < 0 || from === state.openTabs.length - 1) return;
    state.openTabs.push(state.openTabs.splice(from, 1)[0]);
    renderNoteTabs();
    persistNoteTabs();
  }

  function attachNoteTabDrag(tab, id) {
    tab.addEventListener('dragstart', e => {
      noteTabDragId = id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'note-tab:' + id); } catch (_) {}
      }
      tab.classList.add('is-dragging');
    });
    tab.addEventListener('dragend', () => {
      noteTabDragId = null;
      tab.classList.remove('is-dragging');
      clearNoteTabDropMarks();
    });
    tab.addEventListener('dragover', e => {
      if (!noteTabDragId || noteTabDragId === id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = tab.getBoundingClientRect();
      const after = (e.clientX - rect.left) > rect.width / 2;
      tab.classList.toggle('is-drop-before', !after);
      tab.classList.toggle('is-drop-after', after);
    });
    tab.addEventListener('dragleave', e => {
      if (e.relatedTarget && tab.contains(e.relatedTarget)) return;
      tab.classList.remove('is-drop-before', 'is-drop-after');
    });
    tab.addEventListener('drop', e => {
      if (!noteTabDragId) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = tab.getBoundingClientRect();
      const after = (e.clientX - rect.left) > rect.width / 2;
      const fromId = noteTabDragId;
      noteTabDragId = null;
      clearNoteTabDropMarks();
      moveNoteTab(fromId, id, after);
    });
  }

  function renderNoteTabs() {
    if (!noteTabStrip || !noteTabsEl) return;
    pruneNoteTabs();
    noteTabsEl.innerHTML = '';
    const items = state.openTabs.map(noteTabNode).filter(Boolean);
    noteTabStrip.hidden = items.length === 0;
    const activeId = currentNoteId && noteTabNode(currentNoteId) ? currentNoteId : null;
    if (activeId) state.activeTab = activeId;

    for (const note of items) {
      const tab = document.createElement('div');
      tab.className = 'note-tab' + (note.id === activeId ? ' is-active' : '');
      tab.dataset.id = note.id;
      tab.draggable = true;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', note.id === activeId ? 'true' : 'false');
      tab.tabIndex = note.id === activeId ? 0 : -1;
      tab.title = (note.title || '(无标题)') + '\n' + (note.path || '');

      const icon = document.createElement('span');
      icon.className = 'note-tab-icon';
      icon.textContent = '▤';
      icon.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'note-tab-title';
      label.textContent = note.title || '(无标题)';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'note-tab-close';
      close.title = '关闭标签页';
      close.setAttribute('aria-label', '关闭 ' + (note.title || '笔记'));
      close.textContent = '×';
      close.addEventListener('mousedown', e => e.stopPropagation());
      close.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeNoteTab(note.id);
      });

      tab.append(icon, label, close);
      tab.addEventListener('click', e => {
        if (e.target.closest('.note-tab-close')) return;
        openNote(note.id);
        showView('note');
      });
      tab.addEventListener('auxclick', e => {
        if (e.button === 1) {
          e.preventDefault();
          closeNoteTab(note.id);
        }
      });
      tab.addEventListener('keydown', e => {
        const index = state.openTabs.indexOf(note.id);
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNote(note.id);
          showView('note');
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          closeNoteTab(note.id);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const nextId = state.openTabs[index + (e.key === 'ArrowRight' ? 1 : -1)];
          if (!nextId) return;
          openNote(nextId);
          showView('note');
          focusNoteTab(nextId);
        }
      });
      attachNoteTabDrag(tab, note.id);
      noteTabsEl.appendChild(tab);
    }

    persistNoteTabs();
    requestAnimationFrame(() => {
      const active = [...noteTabsEl.querySelectorAll('.note-tab')].find(el => el.classList.contains('is-active'));
      if (!active) return;
      if (active.scrollIntoView) {
        try { active.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
      }
    });
  }

  /** 打开笔记时把它放进标签条；同一篇只保留一个标签。 */
  function rememberNoteTab(id) {
    if (!noteTabNode(id)) return false;
    if (!state.openTabs.includes(id)) {
      if (state.openTabs.length >= NOTE_TABS_MAX) {
        const victim = state.openTabs.find(tabId => tabId !== id);
        if (victim) state.openTabs.splice(state.openTabs.indexOf(victim), 1);
      }
      state.openTabs.push(id);
    }
    state.activeTab = id;
    renderNoteTabs();
    return true;
  }

  /** 没有可切换的标签时，回到「未选择笔记」的空状态。 */
  function clearCurrentNote() {
    currentNoteId = null;
    state.selectedId = null;
    state.activeTab = null;
    editing = false;
    const editor = $('#note-editor');
    const body = $('#note-body');
    if (editor) editor.hidden = true;
    if (body) body.hidden = false;
    const editBtn = $('#btn-note-edit');
    if (editBtn) editBtn.textContent = '编辑';
    renderNote();
    updateTreeSelection();
  }

  function closeNoteTab(id) {
    const index = state.openTabs.indexOf(id);
    if (index < 0) return;
    const wasActive = currentNoteId === id;
    state.openTabs.splice(index, 1);
    if (!wasActive) {
      if (state.activeTab === id) state.activeTab = currentNoteId;
      renderNoteTabs();
      persistNoteTabs();
      return;
    }
    const nextId = state.openTabs[index] || state.openTabs[index - 1] || null;
    showView('note');
    if (nextId) {
      openNote(nextId);
    } else {
      clearCurrentNote();
      renderNoteTabs();
    }
  }

  if (noteTabsEl) {
    noteTabsEl.addEventListener('dragover', e => {
      if (!noteTabDragId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    noteTabsEl.addEventListener('drop', e => {
      if (!noteTabDragId) return;
      if (e.target.closest && e.target.closest('.note-tab')) return;
      e.preventDefault();
      const fromId = noteTabDragId;
      noteTabDragId = null;
      clearNoteTabDropMarks();
      moveNoteTabToEnd(fromId);
    });
    noteTabsEl.addEventListener('wheel', e => {
      if (noteTabsEl.scrollWidth <= noteTabsEl.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      noteTabsEl.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  restoreNoteTabs();
