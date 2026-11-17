    // 事件绑定
    const sendBtn = document.getElementById('ai-send');
    const stopBtn = document.getElementById('ai-stop');
    const submitQuestion = () => {
      if (state.busy) return;
      const value = inputEl ? inputEl.value : '';
      if (inputEl) inputEl.value = '';
      send(value);
    };
    if (sendBtn) sendBtn.addEventListener('click', submitQuestion);
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        if (stop() && inputEl) inputEl.focus();
      });
    }
    if (inputEl) {
      inputEl.addEventListener('keydown', e => {
        if (e.key === 'Escape' && state.busy) {
          e.preventDefault();
          if (stop()) inputEl.focus();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuestion(); }
      });
    }
    const clearBtn = document.getElementById('btn-ai-clear');
    if (clearBtn) clearBtn.addEventListener('click', clear);
    if (suggestEl) {
      suggestEl.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (chip && chip.dataset.q && !state.busy) send(chip.dataset.q);
      });
    }

    /**
     * AI 优化格式。
     * 安全策略：默认只用确定性本地规则；开启模型整理时，结果必须通过
     * 「去掉 Markdown 标记后逐字一致」的校验，否则自动回退本地结果。
     */
    async function optimizeFormat(text) {
      const source = String(text || '');
      if (!source.trim()) return { text: source, used: 'local' };
      const local = formatLocally(source);
      const useModel = Boolean(state.config.aiFormatModel);
      if (!useModel || state.mode === 'local') return { text: local, used: 'local' };

      let raw = '';
      try {
        if (state.mode === 'direct') {
          const r = await callDirect(Object.assign({}, state.config, { askMode: 'format' }), '', source);
          raw = r.answer || '';
        } else {
          const res = await fetch('/api/format', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: source })
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          raw = data.markdown || '';
        }
      } catch (_) {
        return { text: local, used: 'local', note: '模型不可用，已用本地规则整理' };
      }

      const cleaned = cleanFormatAnswer(raw);
      if (!cleaned) return { text: local, used: 'local', note: '模型没有返回内容，已用本地规则整理' };
      if (plainTextOf(cleaned) !== plainTextOf(source)) {
        return { text: local, used: 'local', note: '模型改动了正文，已回退为本地规则（原文未变）' };
      }
      return { text: cleaned, used: 'model' };
    }

    /** 拉取可用模型列表：直连模式问服务商，代理模式问本地服务 */
    async function fetchModels(cfg) {
      const conf = Object.assign({}, state.config, cfg || {});
      if (conf.mode === 'direct') {
        if (!hasKey(conf)) return { ok: false, message: '先填 API Key 再拉取模型列表', models: [] };
        const url = String(conf.baseUrl || '').replace(RE_TRAILING_SLASH, '') + '/models';
        try {
          const res = await fetch(url, { headers: { Authorization: 'Bearer ' + conf.key.trim() } });
          if (!res.ok) return { ok: false, message: 'HTTP ' + res.status, models: [] };
          const data = await res.json();
          const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
          const models = list.map(function (m) { return m.id || m.name || m.model || String(m); }).filter(Boolean);
          return models.length
            ? { ok: true, message: '共 ' + models.length + ' 个模型', models: models }
            : { ok: false, message: '服务商没有返回模型列表', models: [] };
        } catch (err) {
          return { ok: false, message: '拉取失败：' + (err && err.message ? err.message : err) + '（可能是跨域限制，建议改用本地代理）', models: [] };
        }
      }
      if (location.protocol === 'file:') return { ok: false, message: '单文件模式下没有代理，请用 http://localhost:4321', models: [] };
      try {
        const res = await fetch('/api/models', { cache: 'no-store' });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) return { ok: false, message: data.error || ('HTTP ' + res.status), models: [] };
        return { ok: true, message: '共 ' + data.models.length + ' 个模型', models: data.models || [] };
      } catch (err) {
        return { ok: false, message: '拉取失败：' + (err && err.message ? err.message : err) + '（先运行 node scripts/serve.mjs）', models: [] };
      }
    }

    /** 应用新配置（设置窗口保存时调用） */
    async function applyConfig(patch) {
      state.config = Object.assign({}, state.config, patch || {});
      if (state.config.mode !== 'direct') state.config.key = '';
      saveConfig(state.config);
      await detectTransport();
      return state.mode;
    }

    /** 自动分析学科与知识点：服务端有模型时走 /api/analyze，否则本地兜底 */
    async function analyzeQuestion(question, answer, signal) {
      const local = classifyLocally(question, answer);
      if (state.mode === 'local' || location.protocol === 'file:' || typeof fetch !== 'function') return local;
      if (signal && signal.aborted) return local;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const onOuterAbort = () => { try { if (controller) controller.abort(); } catch (_) {} };
      if (signal) signal.addEventListener('abort', onOuterAbort, { once: true });
      const timer = controller ? setTimeout(() => controller.abort(), 6000) : 0;
      // 直连模式没有本地服务，直接用同一个 Key 再问一次模型做定位分析
      if (state.mode === 'direct' && hasKey(state.config)) {
        const nl = String.fromCharCode(10);
        try {
          const r = await callDirect(
            Object.assign({}, state.config, { askMode: 'analyze' }),
            '【问题】' + nl + String(question || '') + nl + nl + '【回答】' + nl + String(answer || '').slice(0, 4000),
            '',
            [],
            controller ? controller.signal : signal
          );
          const parsed = parseLooseJson(r && r.answer);
          if (parsed && parsed.subject) {
            const subject = normalizeSubject(parsed.subject);
            const points = sanitizeKnowledgePoints(parsed.knowledgePoints);
            return {
              subject: subject,
              knowledgePoints: points.length ? points : local.knowledgePoints,
              mistakeType: normalizeMistakeType(parsed.mistakeType) || local.mistakeType || '',
              source: 'api'
            };
          }
        } catch (_) {}
        return local;
      }

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: String(question || ''), answer: String(answer || '') }),
          signal: controller ? controller.signal : signal
        });
        if (!res.ok) return local;
        const data = await res.json();
        if (!data || !data.subject) return local;
        const points = sanitizeKnowledgePoints(data.knowledgePoints);
        const subject = normalizeSubject(data.subject);
        if (!subject) return local;
        return {
          subject: subject,
          knowledgePoints: points.length ? points : local.knowledgePoints,
          mistakeType: normalizeMistakeType(data.mistakeType) || local.mistakeType || '',
          source: 'api'
        };
      } catch (_) {
        return local;
      } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onOuterAbort);
      }
    }

    /** 测试连接：返回 { ok, message } */
    async function testConnection(cfg) {
      try {
        if (cfg.mode === 'direct') {
          if (!hasKey(cfg)) return { ok: false, message: '还没有填 API Key' };
          const r = await callDirect(cfg, '只回复两个字：连通', '');
          return { ok: true, message: '连接成功：' + String(r.answer).slice(0, 40) };
        }
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) return { ok: false, message: '本地代理未就绪：请先运行 node scripts/serve.mjs 并设置 COMMAND_CODE_API_KEY' };
        const info = await res.json();
        return { ok: true, message: '代理可用：' + (info.model || 'AI') };
      } catch (err) {
        return { ok: false, message: '连接失败：' + (err && err.message ? err.message : err) };
      }
    }

    detectTransport();
    greet();
    renderRecords();

    /** 切换问答人设：notes=只依据笔记；tutor=老师答疑 */
    function setAskMode(mode) {
      if (state.busy) stop();
      state.askMode = mode === 'notes' ? 'notes' : 'tutor';
      if (modeEl) modeEl.dataset.askMode = state.askMode;
      render();
      greet();
      return state.askMode;
    }

    function reset() {
      if (state.busy) stop();
      state.threads = { tutor: [], notes: [] };
      render();
      greet();
    }

    return { send, stop, clear, reset, setMode, setAskMode, optimizeFormat, recognizeImage, threads: () => state.threads, records: loadRecords, renderRecords, initRecords, repairRecordVaults, findRecord, signatureOf, updateRecord, deleteRecord, setRecordSearch, setRecordDate, remapRecordPaths, analyzeQuestion, addImageFiles, applyConfig, testConnection, fetchModels, state, render, loadConfig, saveConfig, clearConfig, hasKey };
  }

  root.RG = root.RG || {};
  root.RG.ai = { create, answerLocal, answerTutorLocal, retrieve, tokenize, headingsOf, guessSubject, normalizeSubject, looksLikeEnglish, knowledgePointsOf, classifyLocally, recommendMistakeBook, mistakeSnippet, mistakeContentHasQuestion, sanitizePoint, sanitizeKnowledgePoints, MAX_KNOWLEDGE_POINTS, MISTAKE_TYPES, normalizeMistakeType, guessMistakeTypeLocally, buildTeacherPrompt, normalizeTeacherTraits, DEFAULT_TEACHER_TRAITS, TEACHER_TRAIT_DEFS, formatLocally, plainTextOf };
