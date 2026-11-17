  function currentNote() {
    if (!state.graph || !currentNoteId) return null;
    return state.graph.nodes.find(n => n.id === currentNoteId) || null;
  }

  function showView(view) {
    const isGraph = view === 'graph';
    $('#pane-note').hidden = isGraph;
    $('#pane-graph').hidden = !isGraph;
    $('#graph-tools').hidden = !isGraph;
    $('#view-note').classList.toggle('is-active', !isGraph);
    $('#view-graph').classList.toggle('is-active', isGraph);
    state.viewName = view;
    if (isGraph) {
      resize();
      state.dirty = true;
      if (currentNoteId) focusNode(currentNoteId);
    }
  }

  function tagChips(container, tags, onClick) {
    container.innerHTML = '';
    for (const tag of tags || []) {
      const chip = document.createElement('button');
      chip.className = 'tag-chip';
      chip.textContent = '#' + tag;
      chip.addEventListener('click', () => onClick(tag));
      container.appendChild(chip);
    }
  }

  function renderNote() {
    const node = currentNote();
    if (!node) {
      $('#note-empty').hidden = false;
      $('#note-view').hidden = true;
      return;
    }
    $('#note-empty').hidden = true;
    $('#note-view').hidden = false;
    $('#note-title').textContent = node.title;
    $('#note-path').textContent = node.path || '(无路径)';

    const body = $('#note-body');
    // 正文开头如果就是标题，去掉它，避免与页面标题重复
    let content = String(node.content || '');
    const headMatch = content.match(/^\s*#{1,3}\s+(.+)\n/);
    if (headMatch && headMatch[1].trim() === node.title.trim()) content = content.slice(headMatch[0].length);
    body.innerHTML = content.trim()
      ? markdown.render(content)
      : '<p class="md-empty">（这篇笔记还没有正文）</p>';

    tagChips($('#note-tags'), node.tags, tag => { showView('graph'); setSearch('tag:' + tag); });

    const words = String(node.content || '').replace(/\s+/g, '').length;
    const outlinks = (node.links || []).length;
    $('#note-meta').textContent = words + ' 字 · ' + outlinks + ' 条出链 · ' + (node.tags || []).length + ' 个标签';

    // 反向链接
    const backlinks = [];
    for (const link of state.graph.links) {
      if (link.target === node.id && link.kind !== 'tag') {
        const src = state.graph.nodes.find(n => n.id === link.source);
        if (src && src.type === 'note') backlinks.push(src);
      }
    }
    const ul = $('#backlinks');
    ul.innerHTML = '';
    $('#backlink-count').textContent = backlinks.length ? '(' + backlinks.length + ')' : '(0)';
    if (!backlinks.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '还没有笔记链接到这里';
      ul.appendChild(li);
    }
    for (const src of backlinks.slice(0, 30)) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'link-pill';
      btn.textContent = src.title;
      btn.addEventListener('click', () => openNote(src.id));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    updateTreeSelection();
  }

  function openNote(id) {
    const node = state.graph && state.graph.nodes.find(n => n.id === id);
    if (!node) return;
    if (node.type === 'note') touchUsage(node.path, 'open');
    if (typeof pluginHost !== 'undefined') pluginHost.emit('note:open', { note: node });
    if (typeof refreshNoteWidgets === 'function') refreshNoteWidgets();
    currentNoteId = id;
    state.selectedId = id;
    editing = false;
    $('#note-editor').hidden = true;
    $('#note-body').hidden = false;
    $('#btn-note-edit').textContent = '编辑';
    if (node.type === 'note') rememberNoteTab(id);
    else renderNoteTabs();
    renderNote();
  }

  function openNoteByTitle(title) {
    const node = findNodeByTitle(title);
    if (node && node.type === 'note') { openNote(node.id); return true; }
    return false;
  }

  function findNodeByTitle(title) {
    if (!state.graph) return null;
    const want = String(title).trim().toLowerCase();
    return state.graph.nodes.find(n => n.title.toLowerCase() === want)
      || state.graph.nodes.find(n => n.path.toLowerCase().replace(/\.md$/, '').endsWith(want));
  }

  /* 正文里的双链 / 标签 / 反链点击 */
  $('#note-body').addEventListener('click', e => {
    const linkEl = e.target.closest('[data-wikilink]');
    if (linkEl) {
      const title = linkEl.dataset.wikilink;
      if (!openNoteByTitle(title)) toast('尚未创建：' + title);
      return;
    }
    const tagEl = e.target.closest('.md-tag');
    if (tagEl) {
      showView('graph');
      setSearch('tag:' + tagEl.textContent.replace(/^#/, ''));
    }
  });

  /* 编辑：内存内修改 + 可下载，不直接写盘 */
  function toggleEdit() {
    const node = currentNote();
    if (!node) return;
    editing = !editing;
    const editor = $('#note-editor');
    if (editing) {
      // 进编辑：把 Markdown 渲染成富文本直接改，用户不用看语法
      editor.innerHTML = markdown.render(node.content || '') || '<p><br></p>';
      editor.hidden = false;
      $('#note-body').hidden = true;
      $('#btn-note-edit').textContent = '保存';
      editor.focus();
      placeCaretAtEnd(editor);
    } else {
      saveEditing(node, editor);
    }
  }

  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  /** 把编辑器内容写回笔记（不负责退出编辑态） */
  function commitEditor(node, editor) {
    const md = richtext.htmlToMarkdown(editor.innerHTML);
    touchUsage(node.path, 'edit');
    node.content = md;
    node.summary = vault.summarize(md);
    node.links = vault.extractLinks(md);
    node.tags = [...new Set(vault.extractTags(md))];
    // 写回数据源（保留原 frontmatter，只替换正文）
    const file = state.files.find(f => f.path === node.path);
    if (file) {
      const fm = String(file.content || '').match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      file.content = (fm ? fm[0] : '') + md;
    }
    state.graph = vault.buildVault(state.files);
    rebuild({});
    renderNote();
    saveLocalVault();
    if (typeof pluginHost !== 'undefined') pluginHost.emit('note:save', { note: node });
    return md;
  }

  /** 退出编辑态保存（按钮「保存」走这里） */
  function saveEditing(node, editor) {
    commitEditor(node, editor);
    editor.hidden = true;
    $('#note-body').hidden = false;
    $('#btn-note-edit').textContent = '编辑';
    toast('已保存');
  }

  /** Ctrl+S：只保存，不退出编辑、不打断光标位置 */
  function quickSave() {
    const node = currentNote();
    if (!node) return false;
    const editor = $('#note-editor');
    if (editing && !editor.hidden) {
      commitEditor(node, editor);
      toast('已保存（编辑继续，不影响光标）');
      return true;
    }
    // 没在编辑：把当前内容写进本机缓存，避免误以为没保存
    saveLocalVault();
    toast('已保存到本机缓存');
    return true;
  }

  function downloadNote() {
    const node = currentNote();
    if (!node) return;
    const blob = new Blob([node.content || ''], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (node.path || node.title + '.md').split('/').pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已下载 ' + a.download);
  }

  /* ── 应用内输入 / 确认框（替换原生 prompt / confirm） ──── */
  function askText(options) {
    const cfg = options || {};
    return new Promise(resolve => {
      const modal = $('#input-dialog');
      const field = $('#input-dialog-field');
      $('#input-dialog-title').textContent = cfg.title || '输入';
      $('#input-dialog-desc').textContent = cfg.desc || '';
      field.value = cfg.value || '';
      field.placeholder = cfg.placeholder || '';
      modal.hidden = false;
      setTimeout(() => { field.focus(); field.select(); }, 20);

      const done = value => {
        modal.hidden = true;
        field.onkeydown = null;
        $('#input-dialog-ok').onclick = null;
        $('#input-dialog-cancel').onclick = null;
        resolve(value);
      };
      $('#input-dialog-ok').onclick = () => done(field.value);
      $('#input-dialog-cancel').onclick = () => done(null);
      field.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); done(field.value); }
        else if (e.key === 'Escape') { e.preventDefault(); done(null); }
      };
    });
  }

  function askConfirm(options) {
    const cfg = options || {};
    return new Promise(resolve => {
      const modal = $('#confirm-dialog');
      const okBtn = $('#confirm-dialog-ok');
      $('#confirm-dialog-title').textContent = cfg.title || '确认';
      $('#confirm-dialog-text').textContent = cfg.message || '';
      okBtn.textContent = cfg.okText || '确定';
      okBtn.classList.toggle('is-danger', Boolean(cfg.danger));
      modal.hidden = false;

      const done = value => {
        modal.hidden = true;
        okBtn.onclick = null;
        $('#confirm-dialog-cancel').onclick = null;
        resolve(value);
      };
      okBtn.onclick = () => done(true);
      $('#confirm-dialog-cancel').onclick = () => done(false);
    });
  }
