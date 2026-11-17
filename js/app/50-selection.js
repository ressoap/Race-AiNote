  /* ── 选区工具条（选中文字后弹出） ───────────────────────── */
  const selToolbar = $('#sel-toolbar');
  let selMode = null;

  function hideSelToolbar() {
    selToolbar.hidden = true;
    selMode = null;
  }

  function updateSelToolbar() {
    const editor = $('#note-editor');
    const body = $('#note-body');
    let range = null;
    let mode = null;
    if (!editor.hidden && richtext.selectionIn(editor)) { mode = 'edit'; }
    else if (!body.hidden && richtext.selectionIn(body)) { mode = 'read'; }
    if (!mode) { hideSelToolbar(); return; }

    const sel = window.getSelection();
    range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideSelToolbar(); return; }

    selMode = mode;
    selToolbar.hidden = false;
    const tbWidth = selToolbar.offsetWidth || 220;
    const left = Math.max(8, Math.min(window.innerWidth - tbWidth - 8, rect.left + rect.width / 2 - tbWidth / 2));
    const top = Math.max(8, rect.top - 42 + window.scrollY);
    selToolbar.style.left = left + 'px';
    selToolbar.style.top = top + 'px';

    // 只读视图下隐藏「只对编辑有意义」的按钮
    for (const btn of selToolbar.querySelectorAll('.sel-btn')) {
      const fmt = btn.dataset.fmt;
      const editOnly = ['bold', 'italic', 'underline', 'mark', 'link', 'clear'].includes(fmt);
      btn.hidden = mode === 'read' && editOnly;
    }
  }

  document.addEventListener('mouseup', () => setTimeout(updateSelToolbar, 10));
  document.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Escape') setTimeout(updateSelToolbar, 10); });
  document.addEventListener('mousedown', e => {
    if (selToolbar.hidden) return;
    if (e.target.closest('#sel-toolbar')) return;
    if (e.target.closest('#note-editor, #note-body')) return;
    hideSelToolbar();
  });

  selToolbar.addEventListener('mousedown', e => e.preventDefault());

  selToolbar.addEventListener('click', e => {
    const btn = e.target.closest('.sel-btn');
    if (!btn) return;
    const fmt = btn.dataset.fmt;
    const editor = $('#note-editor');

    if (fmt === 'copy') {
      const text = window.getSelection().toString();
      if (text && navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('已复制'));
      hideSelToolbar();
      return;
    }
    if (fmt === 'ask') {
      const text = window.getSelection().toString().trim();
      if (text) {
        setAiPanel(true);
        ai.send('帮我讲讲这段：' + text.slice(0, 400));
      }
      hideSelToolbar();
      return;
    }
    if (selMode !== 'edit') return;

    if (fmt === 'bold') richtext.bold();
    else if (fmt === 'italic') richtext.italic();
    else if (fmt === 'underline') richtext.underline();
    else if (fmt === 'mark') richtext.highlight();
    else if (fmt === 'clear') richtext.clearFormat();
    else if (fmt === 'link') { openLinkPicker(); return; }

    editor.focus();
    updateSelToolbar();
  });

  /* ── 链接到笔记的选择器 ─────────────────────────────────── */
  const linkPicker = $('#link-picker');

  function openLinkPicker() {
    linkPicker.hidden = false;
    $('#link-picker-search').value = '';
    renderLinkPickerList('');
    $('#link-picker-search').focus();
  }

  function closeLinkPicker() { linkPicker.hidden = true; }

  function renderLinkPickerList(keyword) {
    const list = $('#link-picker-list');
    list.innerHTML = '';
    const notes = state.graph ? state.graph.notes.filter(n => n.type === 'note') : [];
    const kw = keyword.trim().toLowerCase();
    const shown = notes
      .filter(n => !kw || n.title.toLowerCase().includes(kw) || n.path.toLowerCase().includes(kw))
      .slice(0, 40);
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'link-picker-empty';
      p.textContent = '没有匹配的笔记';
      list.appendChild(p);
      return;
    }
    for (const note of shown) {
      const item = document.createElement('button');
      item.className = 'link-picker-item';
      const title = document.createElement('span');
      title.textContent = note.title;
      const path = document.createElement('span');
      path.className = 'link-picker-path';
      path.textContent = note.path;
      item.append(title, path);
      item.addEventListener('click', () => {
        richtext.wrapWithWikiLink($('#note-editor'), note.title);
        closeLinkPicker();
      });
      list.appendChild(item);
    }
  }

  $('#link-picker-close').addEventListener('click', closeLinkPicker);
  linkPicker.addEventListener('pointerdown', e => { if (e.target === linkPicker) closeLinkPicker(); });
  $('#link-picker-search').addEventListener('input', e => renderLinkPickerList(e.target.value));

  /* ── AI 优化格式 ────────────────────────────────────────── */
  $('#btn-note-format').addEventListener('click', async () => {
    const node = currentNote();
    if (!node) return;
    const editor = $('#note-editor');
    const source = editing ? richtext.htmlToMarkdown(editor.innerHTML) : String(node.content || '');
    if (!source.trim()) return toast('这篇还没有正文，没什么可整理的');
    toast('正在整理格式…');
    try {
      const result = await ai.optimizeFormat(source);
      const output = typeof result === 'string' ? result : (result && result.text) || '';
      const note = (result && result.note) || (result && result.used === 'model' ? '已用模型整理排版（正文未改动）' : '已用本地规则整理排版');
      if (!output.trim()) return toast('没有产生可用的排版结果');
      if (editing) {
        editor.innerHTML = markdown.render(output);
        toast(note + '，确认后点「保存」');
      } else {
        node.content = output;
        node.summary = vault.summarize(output);
        state.graph = vault.buildVault(state.files.map(f => (f.path === node.path ? Object.assign({}, f, { content: output }) : f)));
        rebuild({});
        renderNote();
        toast(note);
      }
    } catch (err) {
      toast('优化失败：' + (err && err.message ? err.message : err));
    }
  });
