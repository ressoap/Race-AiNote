  function applyAskMode(mode) {
    ai.setAskMode(mode);
    $('#ask-tutor').classList.toggle('is-active', mode === 'tutor');
    $('#ask-notes').classList.toggle('is-active', mode === 'notes');
    $('#ai-text').placeholder = mode === 'tutor'
      ? '直接把题目或疑问发给我…（Enter 发送，Shift+Enter 换行）'
      : '问关于你笔记库的问题…（Enter 发送，Shift+Enter 换行）';
    const box = $('#ai-suggest');
    box.innerHTML = '';
    for (const item of SUGGEST[mode]) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.q = item.q;
      b.textContent = item.label;
      box.appendChild(b);
    }
  }

  $('#ask-tutor').addEventListener('click', () => { closeRecordDetail(); applyAskMode('tutor'); });
  $('#ask-notes').addEventListener('click', () => { closeRecordDetail(); applyAskMode('notes'); });

  /* ── 问题记录：内嵌详情子选项卡 / 右键菜单 / 搜索 ─────── */
  const recordMenu = $('#record-menu');
  const recordInline = $('#record-inline');
  const recordInlineScroll = recordInline ? recordInline.querySelector('.record-inline-scroll') : null;
  const recordSubtab = $('#record-subtab');
  const aiChatcol = $('.ai-chatcol');
  let recordMenuTarget = null;
  let recordOpenId = null;

  function findRecordById(id) {
    return (ai.records() || []).find(r => r.id === id) || null;
  }

  /** 打开记录对应的错题笔记，并滚动到这条问答的具体位置 */
  function locateRecordInNote(record) {
    if (!record) return;
    const targetPath = String(record.targetPath || '');
    const targetTitle = String(record.targetTitle || '');
    let node = null;
    if (state.graph && targetPath) {
      node = state.graph.notes.find(n => n.path === targetPath || n.path.endsWith('/' + targetPath)) || null;
    }
    if (!node && targetTitle) node = findNodeByTitle(targetTitle);
    if (!node) return toast('找不到错题笔记：' + (targetTitle || targetPath || '尚未记入'));

    showView('note');
    openNote(node.id);

    const question = String(record.question || '').replace(/\s+/g, ' ').trim();
    const needle = question.slice(0, Math.min(40, question.length));
    const when = new Date(record.at || Date.now());
    const pad = n => String(n).padStart(2, '0');
    const stamp = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate())
      + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());

    setTimeout(() => {
      const body = $('#note-body');
      if (!body) return;
      const normalize = s => String(s || '').replace(/\s+/g, ' ').trim();
      const blocks = [...body.querySelectorAll('h2,h3,h4,h5,h6,p,li,blockquote')];
      let found = needle
        ? blocks.find(el => normalize(el.textContent).includes(needle))
        : null;
      if (!found) {
        const heading = blocks.find(el => /^H[2-6]$/.test(el.tagName) && normalize(el.textContent).includes('AI 答疑记录 ' + stamp));
        if (heading) found = heading.nextElementSibling || heading;
      }
      if (!found) return toast('已打开《' + node.title + '》，但没有找到这条记录');
      if (typeof found.scrollIntoView === 'function') found.scrollIntoView({ behavior: 'smooth', block: 'center' });
      found.classList.add('record-locate-flash');
      setTimeout(() => found.classList.remove('record-locate-flash'), 2400);
      toast('已定位到《' + node.title + '》中的这条记录');
    }, 40);
  }

  /** 把旧版平铺的 10-错题本/*.md 迁进 10-错题本/<学科>/，并同步记录目标路径 */
  function migrateMistakeFolders() {
    const mapping = new Map();
    const keep = currentNote();
    const keepTitle = keep ? keep.title : '';
    const bs = String.fromCharCode(92);
    const nl = String.fromCharCode(10);
    for (const file of state.files.slice()) {
      const m = String(file.path || '').match(new RegExp('^10-错题本/([^/]+' + bs + '.md)$'));
      if (!m) continue;
      const name = m[1];
      if (/使用指南|使用说明|模板|README/i.test(name)) continue;
      const raw = name.replace(new RegExp(bs + '.md$', 'i'), '');
      const subject = RG.ai.guessSubject(raw + nl + String(file.content || '').slice(0, 2000)).subject;
      if (!subject || subject === '其他') continue;
      const safe = subject.replace(/[\/:*?"<>|]/g, '-');
      const target = '10-错题本/' + safe + '/' + name;
      if (state.files.some(f => f.path === target)) continue;
      const oldPath = file.path;
      file.path = target;
      mapping.set(oldPath, target);
    }
    if (!mapping.size) return 0;
    state.graph = vault.buildVault(state.files);
    state.positions = new Map();
    renderTree();
    rebuild({ fresh: true });
    saveLocalVault();
    if (ai && ai.remapRecordPaths) ai.remapRecordPaths(mapping);
    if (keepTitle) {
      const node = state.graph.notes.find(n => n.title === keepTitle);
      if (node) openNote(node.id);
    }
    return mapping.size;
  }

  function openRecordDetail(record) {
    if (!record) return;
    recordOpenId = record.id;
    $('#record-inline-mode').textContent = record.mode === 'notes' ? '笔记问答' : '答疑老师';
    $('#record-inline-time').textContent = new Date(record.at).toLocaleString('zh-CN');
    const status = $('#record-inline-status');
    status.className = 'record-status ' + (record.status === 'resolved' ? 'is-resolved' : '');
    status.textContent = record.status === 'resolved'
      ? '已解决' + (record.targetTitle ? ' · 已记入《' + record.targetTitle + '》' : ' · 未记入错题本')
      : '待解决';
    $('#record-inline-question').textContent = record.question || '（无）';
    const answerEl = $('#record-inline-answer');
    answerEl.innerHTML = record.answer
      ? (markdown.renderAi ? markdown.renderAi(record.answer) : markdown.render(record.answer))
      : '（无）';
    $('#record-inline-toggle').textContent = record.targetTitle ? '取消记入错题本' : '记入错题本';
    const locateBtn = $('#record-inline-locate');
    if (locateBtn) locateBtn.hidden = !(record.targetPath || record.targetTitle);

    if (aiChatcol) aiChatcol.classList.add('is-record-view');
    if (recordInline) recordInline.hidden = false;
    if (recordInlineScroll) recordInlineScroll.scrollTop = 0;

    if (recordSubtab) {
      recordSubtab.hidden = false;
      $('#record-subtab-title').textContent = String(record.question || '问题记录').slice(0, 16);
      recordSubtab.classList.remove('is-in');
      void recordSubtab.offsetWidth;
      recordSubtab.classList.add('is-in');
    }
  }

  function closeRecordDetail() {
    recordOpenId = null;
    if (aiChatcol) aiChatcol.classList.remove('is-record-view');
    if (recordInline) recordInline.hidden = true;
    if (recordSubtab) recordSubtab.hidden = true;
  }

  $('#record-inline-locate').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    if (record) locateRecordInNote(record);
  });

  $('#record-inline-close').addEventListener('click', closeRecordDetail);
  $('#record-subtab-close').addEventListener('click', e => {
    e.stopPropagation();
    closeRecordDetail();
  });

  $('#record-inline-ask').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    closeRecordDetail();
    if (record) continueAsking(record);
  });

  $('#record-inline-copy').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    if (!record || !navigator.clipboard) return;
    const text = '问：' + (record.question || '') + String.fromCharCode(10, 10) + '答：' + String.fromCharCode(10) + (record.answer || '');
    navigator.clipboard.writeText(text).then(() => toast('已复制问答'));
  });

  $('#record-inline-toggle').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    if (record) toggleRecordMistake(record);
  });

  /** 自动归档：按 API/本地分析出的学科建错题本，并写入知识点+日期标题 */
  function autoFileRecord(record, analysis, force) {
    if (!record) return null;
    const questionText = String(record.question || '');
    const isMeta = /哪些笔记.*链接|薄弱环节|复习计划|核心考点|知识卡|整体结构|分析.*笔记|整理.*笔记|这个库.*怎么样|怎么用|介绍一下|你是谁/.test(questionText);
    const subject = RG.ai.normalizeSubject((analysis && analysis.subject) || record.subject || '其他');
    if (!force && isMeta) return null;
    const points = RG.ai.sanitizeKnowledgePoints(
      (analysis && analysis.knowledgePoints && analysis.knowledgePoints.length)
        ? analysis.knowledgePoints
        : (record.knowledgePoints || [])
    );
    const safeSubject = subject.replace(/[\/:*?"<>|]/g, '-').trim() || '其他';
    const bookTitle = safeSubject + '-错题索引';
    const bookPath = '10-错题本/' + safeSubject + '/' + bookTitle + '.md';
    if (record.targetPath === bookPath) return null;

    let file = state.files.find(f => f.path === bookPath);
    if (!file) {
      file = {
        path: bookPath,
        content: [
          '---',
          'title: ' + bookTitle,
          'tags: [错题, ' + subject + ']',
          '---',
          '',
          '# ' + subject + '错题索引',
          '',
          '按知识点归档：',
          ''
        ].join('\n')
      };
      state.files.push(file);
    }

    const alreadyFiled = file && typeof RG.ai.mistakeContentHasQuestion === 'function'
      && RG.ai.mistakeContentHasQuestion(file.content, record.question);
    if (alreadyFiled) {
      const node = state.graph && state.graph.notes.find(n => n.path === bookPath);
      return { targetId: node ? node.id : null, targetTitle: bookTitle, targetPath: bookPath };
    }

    const snippet = RG.ai.mistakeSnippet(Object.assign({}, record, { subject, knowledgePoints: points }), analysis);
    file.content = String(file.content || '').replace(/\s*$/, '') + snippet;
    state.graph = vault.buildVault(state.files);
    renderTree();
    rebuild({});
    saveLocalVault();
    if (currentNoteId) renderNote();
    const node = state.graph.notes.find(n => n.path === bookPath);
    return { targetId: node ? node.id : null, targetTitle: bookTitle, targetPath: bookPath };
  }

  /** 记入 / 取消记入错题本 */
  function toggleRecordMistake(record) {
    if (record.targetTitle) {
      ai.updateRecord(record.id, { targetId: null, targetTitle: null, targetPath: null, status: 'open' });
      toast('已取消记入《' + record.targetTitle + '》，状态回到待解决');
      const fresh = findRecordById(record.id);
      if (recordOpenId === record.id && fresh) openRecordDetail(fresh);
      return;
    }
    const local = RG.ai.classifyLocally(record.question || '', record.answer || '');
    const analysis = {
      subject: record.subject || local.subject,
      knowledgePoints: (Array.isArray(record.knowledgePoints) && record.knowledgePoints.length)
        ? record.knowledgePoints
        : local.knowledgePoints
    };
    const filed = autoFileRecord(record, analysis, true);
    if (!filed || !filed.targetPath) return toast('自动归档失败，请检查错题本目录');
    const fresh = ai.updateRecord(record.id, {
      targetId: filed.targetId || null,
      targetTitle: filed.targetTitle,
      targetPath: filed.targetPath,
      status: 'resolved',
      resolvedAt: Date.now(),
      subject: analysis.subject,
      knowledgePoints: analysis.knowledgePoints,
      knowledgePoint: (analysis.knowledgePoints && analysis.knowledgePoints[0]) || ''
    });
    toast('已记入《' + filed.targetTitle + '》并标记为已解决');
    if (recordOpenId === record.id && fresh) openRecordDetail(fresh);
  }

  /** 继续追问：把这个问题带回答疑老师继续聊 */
  function continueAsking(record) {
    closeRecordDetail();
    applyAskMode('tutor');
    setAiPanel(true);
    const box = $('#ai-text');
    box.value = '接着上面这个问题继续：' + String(record.question || '').slice(0, 200);
    box.focus();
    toast('已把问题带回答疑老师，按 Enter 发送');
  }

  /* 右键菜单 */
  function openRecordMenu(event, record) {
    recordMenuTarget = record;
    recordMenu.hidden = false;
    recordMenu.style.left = Math.min(event.clientX, window.innerWidth - 170) + 'px';
    recordMenu.style.top = Math.min(event.clientY, window.innerHeight - 130) + 'px';
    const toggle = recordMenu.querySelector('[data-act="toggle-mistake"]');
    if (toggle) toggle.textContent = record.targetTitle ? '取消记入错题本' : '记入错题本';
  }

  function closeRecordMenu() {
    recordMenu.hidden = true;
    recordMenuTarget = null;
  }

  document.addEventListener('mousedown', e => {
    if (!recordMenu.hidden && !e.target.closest('#record-menu')) closeRecordMenu();
  });

  recordMenu.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn || !recordMenuTarget) return;
    const record = recordMenuTarget;
    closeRecordMenu();
    if (btn.dataset.act === 'toggle-mistake') toggleRecordMistake(record);
    else if (btn.dataset.act === 'ask-again') continueAsking(record);
    else if (btn.dataset.act === 'delete') {
      const okDel = await askConfirm({ title: '删除记录', message: '只删除这条问题记录，不会删除错题本里的内容。', okText: '删除', danger: true });
      if (!okDel) return;
      ai.deleteRecord(record.id);
      if (recordOpenId === record.id) closeRecordDetail();
      toast('已删除该条记录');
    }
  });

  /* 搜索 */
  const recordSearch = $('#record-search');
  if (recordSearch) {
    recordSearch.addEventListener('input', () => ai.setRecordSearch(recordSearch.value));
    recordSearch.addEventListener('keydown', e => {
      if (e.key === 'Escape') { recordSearch.value = ''; ai.setRecordSearch(''); recordSearch.blur(); }
    });
  }

  const recordDate = $('#record-date-filter');
  if (recordDate) recordDate.addEventListener('change', () => ai.setRecordDate(recordDate.value));

  /* ── AI 输入框：拖动上边缘扩大（类 QQ / 微信） ─────────── */
  const aiTextArea = $('#ai-text');
  const aiInputResizer = $('#ai-input-resizer');
  if (aiTextArea && aiInputResizer) {
    const MIN_INPUT_H = 104;
    const maxInputH = () => Math.max(MIN_INPUT_H, Math.min(Math.round(window.innerHeight * 0.55), 520));
    const clampInputH = h => Math.max(MIN_INPUT_H, Math.min(maxInputH(), Math.round(Number(h) || MIN_INPUT_H)));
    let inputStartY = 0;
    let inputStartH = 0;
    let inputDragging = false;
    const applyInputHeight = (h, persist) => {
      const next = clampInputH(h);
      aiTextArea.style.height = next + 'px';
      if (persist) store.set('aiInputHeight', next);
      return next;
    };
    applyInputHeight(store.get('aiInputHeight') || MIN_INPUT_H, false);

    aiInputResizer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      inputDragging = true;
      inputStartY = e.clientY;
      inputStartH = aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H;
      try { aiInputResizer.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.classList.add('is-resizing-ai-input');
      e.preventDefault();
    });
    aiInputResizer.addEventListener('pointermove', e => {
      if (!inputDragging) return;
      applyInputHeight(inputStartH + (inputStartY - e.clientY), false);
    });
    const stopInputDrag = () => {
      if (!inputDragging) return;
      inputDragging = false;
      document.body.classList.remove('is-resizing-ai-input');
      store.set('aiInputHeight', Math.round(aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H));
    };
    aiInputResizer.addEventListener('pointerup', stopInputDrag);
    aiInputResizer.addEventListener('pointercancel', stopInputDrag);
    aiInputResizer.addEventListener('lostpointercapture', stopInputDrag);
    aiInputResizer.addEventListener('dblclick', () => applyInputHeight(MIN_INPUT_H, true));
    aiInputResizer.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? 16 : -16;
      const current = aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H;
      applyInputHeight(current + delta, true);
    });
    window.addEventListener('resize', () => {
      const current = aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H;
      if (current > maxInputH()) applyInputHeight(maxInputH(), true);
    });
  }

  /* ── AI 面板：拖入图片只做聊天附件，不触发全库载入 ─────── */
  const aiPanel = $('#ai-panel');
  const aiInputBox = $('.ai-input');
  if (aiPanel && aiInputBox) {
    const hasFileDrag = e => Boolean(e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
    ['dragenter', 'dragover'].forEach(type => {
      aiPanel.addEventListener(type, e => {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        aiInputBox.classList.add('is-drag-over');
      });
    });
    aiPanel.addEventListener('dragleave', e => {
      if (!e.relatedTarget || !aiPanel.contains(e.relatedTarget)) aiInputBox.classList.remove('is-drag-over');
    });
    aiPanel.addEventListener('drop', async e => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      aiInputBox.classList.remove('is-drag-over');
      const files = [...(e.dataTransfer.files || [])];
      if (!files.some(f => /^image\//i.test(f.type || '') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || ''))) {
        toast('AI 助手只支持拖入图片');
        return;
      }
      try {
        const added = await ai.addImageFiles(files);
        toast(added ? '已添加 ' + added + ' 张图片' : '最多添加 3 张图片');
      } catch (err) {
        toast('图片读取失败：' + (err && err.message ? err.message : err));
      }
    });
  }

  /* ── AI 面板：左右拖动分割线调整宽度 ───────────────────── */
  const aiPanelEl = $('#ai-panel');
  const aiPanelResizer = $('#ai-resizer');
  if (aiPanelEl && aiPanelResizer) {
    const DEFAULT_AI_W = 560;
    const MIN_AI_W = 360;
    const maxAiW = () => Math.max(MIN_AI_W, Math.min(920, window.innerWidth - 40));
    const clampAiW = w => Math.max(MIN_AI_W, Math.min(maxAiW(), Math.round(Number(w) || DEFAULT_AI_W)));
    const applyAiWidth = (w, persist) => {
      const next = clampAiW(w);
      document.documentElement.style.setProperty('--ai-panel-w', next + 'px');
      if (persist) store.set('aiPanelWidth', next);
      return next;
    };
    applyAiWidth(store.get('aiPanelWidth') || DEFAULT_AI_W, false);

    let aiDragX = 0;
    let aiDragW = 0;
    let aiDragging = false;
    aiPanelResizer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      aiDragging = true;
      aiDragX = e.clientX;
      aiDragW = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      try { aiPanelResizer.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.classList.add('is-resizing-ai-panel');
      e.preventDefault();
    });
    aiPanelResizer.addEventListener('pointermove', e => {
      if (!aiDragging) return;
      applyAiWidth(aiDragW + (aiDragX - e.clientX), false);
    });
    const stopAiDrag = () => {
      if (!aiDragging) return;
      aiDragging = false;
      document.body.classList.remove('is-resizing-ai-panel');
      const current = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      store.set('aiPanelWidth', clampAiW(current));
    };
    aiPanelResizer.addEventListener('pointerup', stopAiDrag);
    aiPanelResizer.addEventListener('pointercancel', stopAiDrag);
    aiPanelResizer.addEventListener('lostpointercapture', stopAiDrag);
    aiPanelResizer.addEventListener('dblclick', () => applyAiWidth(DEFAULT_AI_W, true));
    aiPanelResizer.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const current = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      applyAiWidth(current + (e.key === 'ArrowLeft' ? 24 : -24), true);
    });
    window.addEventListener('resize', () => {
      const current = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      if (current > maxAiW()) applyAiWidth(maxAiW(), true);
    });
  }

  const ai = RG.ai.create({
    getGraph: () => state.graph,
    getVaultId: () => state.vaultId,
    getCurrentNote: () => currentNote(),
    onOpenNote: title => { if (!openNoteByTitle(title)) toast('尚未创建：' + title); },
    onToast: message => toast(message),
    onRecordOpen: record => openRecordDetail(record),
    onRecordAnalyzed: (record, analysis) => autoFileRecord(record, analysis),
    onRecordLocate: record => locateRecordInNote(record),
    onRecordMenu: (event, record) => openRecordMenu(event, record),
    onRecordMistake: record => {
      const local = RG.ai.classifyLocally(record.question || '', record.answer || '');
      const subject = record.subject || local.subject;
      const points = (Array.isArray(record.knowledgePoints) && record.knowledgePoints.length)
        ? record.knowledgePoints
        : local.knowledgePoints;
      const chosenTitle = record.targetTitle || '';
      if (subject && subject !== '其他' && chosenTitle && !chosenTitle.includes(subject)) {
        const filed = autoFileRecord(record, { subject, knowledgePoints: points }, true);
        if (filed && filed.targetPath) {
          ai.updateRecord(record.id, {
            targetId: filed.targetId || null,
            targetTitle: filed.targetTitle,
            targetPath: filed.targetPath,
            status: 'resolved',
            resolvedAt: Date.now(),
            subject,
            knowledgePoints: points,
            knowledgePoint: points[0] || ''
          });
          toast('已按学科自动改到《' + filed.targetTitle + '》');
          return;
        }
      }
      const snippet = RG.ai.mistakeSnippet(Object.assign({}, record, { subject, knowledgePoints: points }), { subject, knowledgePoints: points });
      let file = state.files.find(f => f.path === record.targetPath);
      const alreadyFiled = file && typeof RG.ai.mistakeContentHasQuestion === 'function'
        && RG.ai.mistakeContentHasQuestion(file.content, record.question);
      if (alreadyFiled) {
        toast('这条已经在《' + record.targetTitle + '》里，未重复写入');
        return;
      }
      if (file) file.content = String(file.content || '') + snippet;
      else state.files.push({ path: record.targetPath, content: snippet });
      state.graph = vault.buildVault(state.files);
      rebuild({});
      if (currentNoteId) renderNote();
      toast(record.duplicate ? '这条之前记过，《' + record.targetTitle + '》未重复写入' : '已记入《' + record.targetTitle + '》并标记为已解决');
    }  });

  /* ── 插件宿主 ───────────────────────────────────────────── */
  const pluginHost = RG.plugins.createHost({
    onToast: message => toast(message),
    getNotes: () => (state.graph ? state.graph.notes : []),
    getCurrentNote: () => currentNote(),
    openNote: id => { openNote(id); showView('note'); },
    askAi: text => { setAiPanel(true); ai.send(text); },
    onError: (id, message) => toast('插件 ' + id + '：' + message),
    onRegistryChange: () => renderPluginUI()
  });

