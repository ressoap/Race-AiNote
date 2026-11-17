  /* ── 面板控制器 ───────────────────────────────────────────── */

  function create(options) {
    const opts = options || {};
    const logEl = document.getElementById('ai-log');
    const inputEl = document.getElementById('ai-text');
    const modeEl = document.getElementById('ai-mode');
    const suggestEl = document.getElementById('ai-suggest');
    const useNoteEl = document.getElementById('ai-use-note');

    const attachEl = document.getElementById('ai-attachments');
    const pendingImages = [];
    let attachmentSeq = 0;

    function renderAttachments() {
      if (!attachEl) return;
      attachEl.innerHTML = '';
      attachEl.hidden = pendingImages.length === 0;
      for (const item of pendingImages) {
        const box = document.createElement('div');
        box.className = 'ai-attachment';
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = item.name || '图片';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ai-attachment-remove';
        remove.textContent = '×';
        remove.title = '移除图片';
        remove.addEventListener('click', () => {
          const idx = pendingImages.findIndex(x => x.id === item.id);
          if (idx >= 0) pendingImages.splice(idx, 1);
          renderAttachments();
        });
        box.append(img, remove);
        attachEl.appendChild(box);
      }
    }

    function readImageDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.onload = () => {
          const src = String(reader.result || '');
          const img = new Image();
          img.onload = () => {
            try {
              const maxSide = 1280;
              const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
              if (scale >= 1) return resolve(src);
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(img.width * scale));
              canvas.height = Math.max(1, Math.round(img.height * scale));
              const ctx2 = canvas.getContext('2d');
              ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/jpeg', 0.82));
            } catch (_) {
              resolve(src);
            }
          };
          img.onerror = () => resolve(src);
          img.src = src;
        };
        reader.readAsDataURL(file);
      });
    }

    async function addImageFiles(files) {
      const list = [...(files || [])].filter(f => /^image\//i.test(f.type || '') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || ''));
      if (!list.length) return 0;
      const room = Math.max(0, 3 - pendingImages.length);
      if (!room) return 0;
      let added = 0;
      for (const file of list.slice(0, room)) {
        if (file.size > 8 * 1024 * 1024) continue;
        try {
          const dataUrl = await readImageDataUrl(file);
          pendingImages.push({ id: 'img-' + (++attachmentSeq), name: file.name || '图片', dataUrl });
          added += 1;
        } catch (_) {}
      }
      renderAttachments();
      return added;
    }

    function takeImages() {
      const images = pendingImages.map(x => x.dataUrl);
      pendingImages.length = 0;
      renderAttachments();
      return images;
    }

    /** 拍题入库：只识别题目，不回答；返回图片中的题目纯文本。 */
    async function recognizeImage(file) {
      if (state.mode === 'local') {
        return { ok: false, error: '拍题入库需要接入支持视觉的模型，请先在设置里配置视觉模型' };
      }
      let dataUrl = '';
      try {
        dataUrl = await readImageDataUrl(file);
      } catch (err) {
        return { ok: false, error: '图片读取失败：' + (err && err.message ? err.message : err) };
      }
      const prompt = '请识别这张图片中的题目，只原样输出题干、选项、公式和已知条件，不要解答，不要总结，不要改写。若图片里有多道题，用单独一行 --- 分隔。';
      try {
        const result = state.mode === 'direct'
          ? await callDirect(Object.assign({}, state.config, { askMode: 'notes' }), prompt, '', [dataUrl], undefined, '')
          : await callProxy(prompt, '', 'notes', [], [dataUrl], state.config.visionModel, undefined, '');
        const text = String((result && result.answer) || '').trim();
        if (!text) return { ok: false, error: '模型没有识别到题目文字' };
        return { ok: true, text: text };
      } catch (err) {
        return { ok: false, error: '识别失败：' + (err && err.message ? err.message : err) };
      }
    }

    // 两个独立会话：答疑老师 / 笔记问答，互不共享历史
    const state = { threads: { tutor: [], notes: [] }, mode: 'local', askMode: 'tutor', busy: false, config: loadConfig() };

    function thread() { return state.threads[state.askMode]; }

    function addMessage(role, text, refs, images) {
      const msg = { role, text, refs: refs || [], images: images || [] };
      thread().push(msg);
      render();
      return msg;
    }

    function renderMarkdownSafe(text) {
      if (root.RG && root.RG.markdown) {
        // 让 [[双链]] 在回答里也能点击
        return root.RG.markdown.renderAi ? root.RG.markdown.renderAi(text) : root.RG.markdown.render(text);
      }
      return '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>';
    }

    function render() {
      if (!logEl) return;
      logEl.innerHTML = '';
      for (const msg of thread()) {
        const wrap = document.createElement('div');
        wrap.className = 'ai-msg ai-msg-' + msg.role;
        if (msg.images && msg.images.length) {
          const box = document.createElement('div');
          box.className = 'ai-msg-images';
          for (const src of msg.images) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '消息图片';
            box.appendChild(img);
          }
          wrap.appendChild(box);
        }
        const bubble = document.createElement('div');
        bubble.className = 'ai-bubble';
        if (msg.role === 'assistant') bubble.innerHTML = renderMarkdownSafe(msg.text);
        else bubble.textContent = msg.text;
        wrap.appendChild(bubble);

        if (msg.refs && msg.refs.length) {
          const refs = document.createElement('div');
          refs.className = 'ai-refs';
          for (const title of msg.refs.slice(0, 8)) {
            const chip = document.createElement('button');
            chip.className = 'chip';
            chip.textContent = title;
            chip.addEventListener('click', () => {
              const el = bubble.querySelector('[data-wikilink="' + title.replace(/"/g, '') + '"]');
              if (opts.onOpenNote) opts.onOpenNote(title);
              else if (el) el.click();
            });
            refs.appendChild(chip);
          }
          wrap.appendChild(refs);
        }
        if (msg.role === 'assistant' && msg.kind === 'answer' && state.askMode === 'tutor') {
          wrap.appendChild(buildMistakeBar(msg));
        }
        logEl.appendChild(wrap);
      }
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setMode(mode, label) {
      state.mode = mode;
      if (modeEl) modeEl.textContent = label || (mode === 'remote' ? '模型模式' : '本地分析模式');
      if (modeEl) modeEl.classList.toggle('is-remote', mode === 'remote');
    }

    async function detectTransport() {
      const cfg = state.config;
      if (cfg.mode === 'local') { setMode('local', '本地分析模式（已关闭 AI）'); return; }
      if (cfg.mode === 'direct' && hasKey(cfg)) {
        setMode('direct', '直连模式 · ' + (cfg.model || 'AI'));
        return;
      }
      if (location.protocol === 'file:') { setMode('local', '本地分析模式（直连需用 http 打开）'); return; }
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) throw new Error('no key on server');
        const info = await res.json();
        setMode('proxy', '模型模式 · ' + (info.model || 'AI'));
      } catch (_) {
        setMode('local', hasKey(cfg) ? '本地分析模式（把连接方式切到「浏览器直连」即可用 Key）' : '本地分析模式（未填 API Key）');
      }
    }

    function contextPayload(question) {
      const graph = opts.getGraph();
      const note = opts.getCurrentNote();
      const notes = graph ? graph.notes : [];
      const related = retrieve(question, notes, 6);
      const parts = [];
      if (useNoteEl && useNoteEl.checked && note) {
        parts.push('【当前笔记】' + note.title + '\n' + String(note.content || '').slice(0, 2500));
      }
      for (const n of related) {
        if (note && n.id === note.id) continue;
        parts.push('【相关笔记】' + n.title + '\n' + String(n.content || '').slice(0, 800));
      }
      return parts.join('\n\n---\n\n');
    }

    let currentRun = null;
    let runSeq = 0;

    function isAbortError(err) {
      return Boolean(err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));
    }

    function setBusyState(busy) {
      state.busy = busy;
      const stopEl = document.getElementById('ai-stop');
      if (stopEl) stopEl.hidden = !busy;
      const sendEl = document.getElementById('ai-send');
      if (sendEl) {
        sendEl.disabled = busy;
        sendEl.setAttribute('aria-disabled', busy ? 'true' : 'false');
      }
      if (inputEl) inputEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    /** 中断当前这一轮问答：取消网络请求，保留已显示内容，不再自动归档。 */
    function stop() {
      const run = currentRun;
      if (!run || run.cancelled) return false;
      run.cancelled = true;
      if (run.controller) {
        try { run.controller.abort(); } catch (_) {}
      }
      if (run.loading) {
        if (!run.loading.text || run.loading.text === '思考中…') run.loading.text = '（已停止生成）';
        else if (!run.loading.stopped) run.loading.text += '\n\n（已停止后续处理，本轮不会记入问题记录）';
        run.loading.stopped = true;
      }
      if (currentRun === run) {
        currentRun = null;
        setBusyState(false);
      }
      render();
      if (opts.onToast) opts.onToast('已停止当前回答');
      return true;
    }

    async function send(text) {
      if (state.busy) return false;
      const images = takeImages();
      const question = String(text || '').trim() || (images.length ? '请分析这张图片' : '');
      if (!question) return false;
      const askModeAtSend = state.askMode;
      const threadAtSend = state.threads[askModeAtSend];
      const history = threadAtSend.filter(m => !m.archived && (m.role === 'user' || m.role === 'assistant')).slice(-8).map(m => ({ role: m.role, content: m.text }));
      const teacherPrompt = askModeAtSend === 'tutor' ? buildTeacherPrompt(state.config) : '';
      addMessage('user', question, [], images);
      if (images.length && state.mode !== 'local' && !state.config.visionModel && opts.onToast) {
        opts.onToast('未配置视觉模型，图片可能无法识别；请在设置里填写视觉模型');
      }
      const loading = addMessage('assistant', '思考中…');
      loading.kind = 'answer';
      loading.question = question;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const run = { id: ++runSeq, askMode: askModeAtSend, controller, loading, cancelled: false };
      currentRun = run;
      setBusyState(true);
      const signal = controller ? controller.signal : undefined;

      try {
        try {
          if (state.mode === 'direct' || state.mode === 'proxy') {
            const context = contextPayload(question);
            const result = state.mode === 'direct'
              ? await callDirect(Object.assign({}, state.config, { askMode: askModeAtSend }), question, context, images, signal, teacherPrompt)
              : await callProxy(question, context, askModeAtSend, history, images, state.config.visionModel, signal, teacherPrompt);
            if (run.cancelled) return false;
            loading.text = result.answer || '（模型没有返回内容）';
            loading.refs = result.refs || [];
          } else {
            const result = askModeAtSend === 'tutor'
              ? answerTutorLocal(question, { graph: opts.getGraph(), currentNote: opts.getCurrentNote() })
              : answerLocal(question, { graph: opts.getGraph(), currentNote: opts.getCurrentNote() });
            loading.text = result.text;
            loading.refs = result.refs;
          }
        } catch (err) {
          if (run.cancelled || isAbortError(err)) {
            if (!loading.text || loading.text === '思考中…') loading.text = '（已停止生成）';
            loading.stopped = true;
            return false;
          }
          loading.text = '模型调用失败（' + (err && err.message ? err.message : err) + '），已切回本地分析。';
          const result = answerLocal(question, { graph: opts.getGraph(), currentNote: opts.getCurrentNote() });
          loading.text += '\n\n' + result.text;
          loading.refs = result.refs;
          setMode('local');
        }
        if (run.cancelled) return false;
        if (images.length && state.mode === 'local') {
          loading.text += String.fromCharCode(10, 10) + '（当前是本地分析模式，图片已保留在消息里；接入支持视觉的模型后可以直接识图。）';
        }

        if (askModeAtSend === 'tutor' && loading.text && loading.text !== '思考中…' && !loading.stopped) {
          const existing = findRecord(question);
          const alreadyResolved = Boolean(existing && existing.status === 'resolved');
          let analysis;
          try {
            analysis = await analyzeQuestion(question, loading.text, signal);
          } catch (_) {
            analysis = classifyLocally(question, loading.text);
          }
          if (run.cancelled) return false;
          const subject = normalizeSubject(analysis.subject || '其他');
          const knowledgePoints = sanitizeKnowledgePoints(analysis.knowledgePoints);
          upsertRecord({
            question: question,
            answer: loading.text,
            status: alreadyResolved ? 'resolved' : 'open',
            at: existing ? existing.at : Date.now(),
            targetId: existing ? existing.targetId : null,
            targetTitle: existing ? existing.targetTitle : null,
            targetPath: existing ? existing.targetPath : null,
            mode: askModeAtSend,
            subject: subject,
            knowledgePoints: knowledgePoints,
            knowledgePoint: knowledgePoints[0] || '',
            analysisSource: analysis.source || 'local'
          });
          if (run.cancelled) return false;
          const saved = findRecord(question);
          if (saved && !saved.targetPath && opts.onRecordAnalyzed) {
            try {
              const filed = await opts.onRecordAnalyzed(saved, analysis);
              if (run.cancelled) return false;
              if (filed && filed.targetPath) {
                upsertRecord(Object.assign({}, saved, {
                  targetId: filed.targetId || saved.targetId || null,
                  targetTitle: filed.targetTitle || saved.targetTitle || '',
                  targetPath: filed.targetPath,
                  status: saved.status || 'open',
                  subject: subject,
                  knowledgePoints: knowledgePoints,
                  knowledgePoint: knowledgePoints[0] || ''
                }));
                loading.mistake = filed.targetTitle || null;
                if (opts.onToast) opts.onToast('已自动归档到《' + filed.targetTitle + '》');
              }
            } catch (err) {
              if (!run.cancelled && opts.onToast) opts.onToast('自动归档失败：' + (err && err.message ? err.message : err));
            }
          }
          if (alreadyResolved && !run.cancelled) { loading.resolved = true; loading.mistake = existing.targetTitle || null; loading.archived = true; }
        }
        return true;
      } finally {
        if (currentRun === run) {
          currentRun = null;
          setBusyState(false);
          render();
        }
      }
    }

    function clear() {
      if (state.busy) stop();
      state.threads[state.askMode] = [];
      takeImages();
      render();
      greet();
    }

    function greet() {
      const graph = opts.getGraph();
      const count = graph ? graph.notes.length : 0;
      if (thread().length) return;
      addMessage('assistant',
        count
          ? '已载入 ' + count + ' 篇笔记。可以这样问我：\n· 这篇笔记的核心考点是什么\n· 帮我找出薄弱环节并给出复习计划\n· 这个库里哪些笔记还没有被链接'
          : '还没有载入笔记。点左上角文件夹图标选一个 Markdown 目录，或先用内置示例库试试。');
    }
