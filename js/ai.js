/* ============================================================
   ai.js — AI 问答面板
   两种模式：
   1) 本地分析模式（默认，纯前端规则，离线可用）
   2) 模型模式：检测到本地代理 /api/chat 时启用，密钥只存在服务端
   ============================================================ */
(function (root) {
  'use strict';

  const STORE_KEY = 'race-ainote:ai';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 极简 BM25 风格检索：按关键词命中数排序 */
  /** 分词：英文按词，中文按二元组切开（中文没空格，二元组命中率更稳） */
  function tokenize(text) {
    const raw = String(text || '').toLowerCase();
    const parts = raw.split(/[^0-9a-z\u4e00-\u9fa5]+/i).filter(Boolean);
    const out = new Set();
    for (const p of parts) {
      out.add(p);
      if (p.length > 2 && /[\u4e00-\u9fa5]/.test(p)) {
        for (let i = 0; i < p.length - 1; i++) out.add(p.slice(i, i + 2));
      }
    }
    return [...out].filter(t => t.length > 1 || /[0-9a-z]/i.test(t));
  }

  /** 极简 BM25 风格检索：按关键词命中数排序，标题命中加权 */
  function retrieve(question, noteList, limit) {
    const terms = tokenize(question);
    if (!terms.length) return [];
    const scored = [];
    for (const note of noteList) {
      const title = String(note.title || '').toLowerCase();
      const hay = (title + ' ' + (note.path || '') + ' ' + (note.content || '') + ' ' + (note.tags || []).join(' ')).toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (!hay.includes(t)) continue;
        score += title.includes(t) ? 4 : 1;
      }
      if (score > 0) scored.push({ note, score });
    }
    return scored.sort((x, y) => y.score - x.score).slice(0, limit || 5).map(s => s.note);
  }

  function headingsOf(content) {
    return (String(content || '').match(/^#{1,6}\s+(.+)$/gm) || []).map(h => h.replace(/^#+\s+/, '').trim());
  }

  /* ── 本地规则分析 ─────────────────────────────────────────── */

  function answerLocal(question, ctx) {
    const q = String(question || '');
    const graph = ctx.graph;
    const note = ctx.currentNote;
    const notes = graph ? graph.notes : [];

    if (/孤立|没有被链接|没人链/.test(q)) {
      const orphans = graph.nodes.filter(n => n.type === 'note' && n.degree === 0);
      if (!orphans.length) return { text: '当前库里没有孤立笔记，所有笔记都至少有一条双链。', refs: [] };
      return {
        text: '当前库有 ' + orphans.length + ' 篇孤立笔记（没有任何双链指向它，也没有向外链接）：',
        refs: orphans.map(n => n.title)
      };
    }

    if (/薄弱|弱点|短板|复习计划|怎么补/.test(q)) {
      const weak = notes.filter(n => (n.tags || []).some(t => /薄弱|错题/.test(t)));
      const plan = notes.filter(n => /复习计划|复盘/.test(n.title));
      const lines = [];
      lines.push('根据标签与错题记录，当前有 ' + weak.length + ' 篇与薄弱环节相关的笔记。');
      if (weak.length) lines.push('建议优先处理：' + weak.slice(0, 5).map(n => n.title).join('、') + '。');
      if (plan.length) lines.push('排期可以套用现成模板：' + plan.map(n => n.title).join('、') + '。');
      lines.push('执行节奏建议：当天记错因 → 三天后重做 → 一周后清零。');
      return { text: lines.join('\n'), refs: [...weak.slice(0, 5), ...plan].map(n => n.title) };
    }

    if (/知识卡|整理|归纳|总结这张|提炼/.test(q)) {
      if (!note) return { text: '先在左侧选一篇笔记，我再来帮你整理成知识卡。', refs: [] };
      const hs = headingsOf(note.content);
      const lines = [
        '按知识卡模板整理「' + note.title + '」：',
        '## 定义\n' + (note.summary || '（原文没有摘要，建议补一句一句话定义）'),
        '## 结构\n' + (hs.length ? hs.map(h => '- ' + h).join('\n') : '- （原文没有小标题，建议先分 3 段）'),
        '## 已有双链\n' + ((note.links || []).length ? note.links.map(l => '- [[' + l.target + ']]').join('\n') : '- 暂无，建议至少挂 2 条'),
        '## 建议标签\n' + ((note.tags || []).length ? note.tags.map(t => '#' + t).join(' ') : '暂无')
      ];
      return { text: lines.join('\n\n'), refs: [note.title] };
    }

    if (note && /核心|考点|讲了什么|重点|一句话/.test(q)) {
      const hs = headingsOf(note.content).slice(0, 6);
      const links = (note.links || []).slice(0, 5).map(l => l.target);
      const lines = ['「' + note.title + '」的要点：', note.summary || '（无摘要）'];
      if (hs.length) lines.push('结构：' + hs.join(' / '));
      if (note.tags.length) lines.push('标签：' + note.tags.map(t => '#' + t).join(' '));
      if (links.length) lines.push('关联：' + links.map(t => '[[' + t + ']]').join(' '));
      return { text: lines.join('\n'), refs: [note.title, ...links] };
    }

    // 兜底：全文检索
    const hits = retrieve(q, notes, 5);
    if (!hits.length) {
      return { text: '没在库里找到直接相关的内容。换个关键词，或者问我「哪些笔记还没被链接」「我的薄弱环节」。', refs: [] };
    }
    const lines = ['在库里找到 ' + hits.length + ' 篇相关笔记：'];
    for (const n of hits) {
      lines.push('· ' + n.title + '：' + (n.summary || n.path));
    }
    return { text: lines.join('\n'), refs: hits.map(n => n.title) };
  }

  /* ── 配置（Key 只存本机 localStorage，不入库、不上传） ─────── */
  const CONFIG_KEY = 'race-ainote:ai-config';
  const DEFAULT_CONFIG = { mode: 'proxy', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: '' };

  function loadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      return Object.assign({}, DEFAULT_CONFIG, raw);
    } catch (_) {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  function clearConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch (_) {}
  }

  function hasKey(cfg) { return Boolean(cfg && cfg.key && cfg.key.trim().length > 8); }

  const RE_TRAILING_SLASH = /\/+$/;
  const RE_WIKILINK = /\[\[([^\[\]]+?)\]\]/g;

  /** 直连模式：浏览器直接请求 OpenAI 兼容接口（需要服务商允许 CORS） */
  async function callDirect(cfg, question, context) {
    const url = String(cfg.baseUrl || '').replace(RE_TRAILING_SLASH, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key.trim() },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: cfg.askMode === 'tutor'
            ? '你是一位耐心的学科老师。按「①考点定位 ②解题思路 ③分步推导 ④易错提醒 ⑤一句话拓展」作答；条件不足先追问；可以超出笔记范围，但要用 [[笔记标题]] 指出相关复习材料；不要编造标题。'
            : '你是学习笔记助手。只依据给出的笔记回答，用中文分点作答，引用笔记时用 [[标题]] 的形式，不要编造标题。' },
          { role: 'user', content: '【笔记内容】\n' + context + '\n\n【问题】\n' + question }
        ]
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
    const data = await res.json();
    const answer = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    const refs = [...new Set([...answer.matchAll(RE_WIKILINK)].map(function (m) { return m[1].split("|")[0].trim(); }))];
    return { answer: answer || '（模型没有返回内容）', refs: refs };
  }

  /** 代理模式：请求本机 scripts/serve.mjs 的 /api/chat，Key 在服务端 */
  async function callProxy(question, context, askMode, history) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context, mode: askMode || 'notes', history: history || [] })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error('代理 ' + res.status + ' ' + text.slice(0, 120));
    }
    return await res.json();
  }

  /** 老师模式（未接入模型时）：给出框架式引导，而不是假装会讲题 */
  function answerTutorLocal(question, ctx) {
    const notes = ctx.graph ? ctx.graph.notes : [];
    const hits = retrieve(question, notes, 3);
    const lines = [];
    lines.push('【未接入模型 · 框架引导】');
    if (/求|解|证明|算|多少|怎么|题|做|讲|思路|步骤|为什么/.test(question)) {
      lines.push('1. 把题目条件抄下来，标清已知量和待求量；缺条件的先补条件。');
      lines.push('2. 定位考点：这题想考哪个公式/定理，先把它写出来。');
      lines.push('3. 从待求量倒推：要得到它，需要先知道什么？' + '逐步逼近已知条件。');
      lines.push('4. 算完代回原式检查，特别是定义域、单位和符号。');
    } else {
      lines.push('1. 先用一句话复述你理解的概念，卡在哪一步说出来。');
      lines.push('2. 回忆这个概念的适用条件，很多错误来自条件不满足。');
      lines.push('3. 找一道最简单的例题对照着看，再回到原问题。');
    }
    if (hits.length) {
      lines.push('');
      lines.push('你笔记里可能有用的材料：' + hits.map(function (n) { return n.title; }).join('、'));
    }
    lines.push('');
    lines.push('接入模型后（设置窗口填 Key，或在 .env 里配 COMMAND_CODE_API_KEY）我会直接给完整分步讲解，并能追问。');
    return { text: lines.join(String.fromCharCode(10)), refs: hits.map(function (n) { return n.title; }) };
  }

  /* ── 面板控制器 ───────────────────────────────────────────── */

  function create(options) {
    const opts = options || {};
    const logEl = document.getElementById('ai-log');
    const inputEl = document.getElementById('ai-text');
    const modeEl = document.getElementById('ai-mode');
    const suggestEl = document.getElementById('ai-suggest');
    const useNoteEl = document.getElementById('ai-use-note');

    // 两个独立会话：答疑老师 / 笔记问答，互不共享历史
    const state = { threads: { tutor: [], notes: [] }, mode: 'local', askMode: 'tutor', busy: false, config: loadConfig() };

    function thread() { return state.threads[state.askMode]; }

    function addMessage(role, text, refs) {
      const msg = { role, text, refs: refs || [] };
      thread().push(msg);
      render();
      return msg;
    }

    function renderMarkdownSafe(text) {
      if (root.RG && root.RG.markdown) {
        // 让 [[双链]] 在回答里也能点击
        return root.RG.markdown.render(text);
      }
      return '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>';
    }

    function render() {
      if (!logEl) return;
      logEl.innerHTML = '';
      for (const msg of thread()) {
        const wrap = document.createElement('div');
        wrap.className = 'ai-msg ai-msg-' + msg.role;
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

    async function send(text) {
      const question = String(text || '').trim();
      if (!question || state.busy) return;
      const history = thread().slice(-8).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.text }));
      addMessage('user', question);
      state.busy = true;
      const loading = addMessage('assistant', '思考中…');

      try {
        if (state.mode === 'direct' || state.mode === 'proxy') {
          const context = contextPayload(question);
          const result = state.mode === 'direct'
            ? await callDirect(Object.assign({}, state.config, { askMode: state.askMode }), question, context)
            : await callProxy(question, context, state.askMode, history);
          loading.text = result.answer || '（模型没有返回内容）';
          loading.refs = result.refs || [];        } else {
          const result = state.askMode === 'tutor'
            ? answerTutorLocal(question, { graph: opts.getGraph(), currentNote: opts.getCurrentNote() })
            : answerLocal(question, { graph: opts.getGraph(), currentNote: opts.getCurrentNote() });
          loading.text = result.text;
          loading.refs = result.refs;
        }
      } catch (err) {
        loading.text = '模型调用失败（' + (err && err.message ? err.message : err) + '），已切回本地分析。';
        const result = answerLocal(question, { graph: opts.getGraph(), currentNote: opts.getCurrentNote() });
        loading.text += '\n\n' + result.text;
        loading.refs = result.refs;
        setMode('local');
      } finally {
        state.busy = false;
        render();
      }
    }

    function clear() {
      state.threads[state.askMode] = [];
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

    // 事件绑定
    const sendBtn = document.getElementById('ai-send');
    if (sendBtn) sendBtn.addEventListener('click', () => { const v = inputEl.value; inputEl.value = ''; send(v); });
    if (inputEl) {
      inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = inputEl.value; inputEl.value = ''; send(v); }
      });
    }
    const clearBtn = document.getElementById('btn-ai-clear');
    if (clearBtn) clearBtn.addEventListener('click', clear);
    if (suggestEl) {
      suggestEl.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (chip && chip.dataset.q) send(chip.dataset.q);
      });
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
      saveConfig(state.config);
      await detectTransport();
      return state.mode;
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

    /** 切换问答人设：notes=只依据笔记；tutor=老师答疑 */
    function setAskMode(mode) {
      state.askMode = mode === 'notes' ? 'notes' : 'tutor';
      if (modeEl) modeEl.dataset.askMode = state.askMode;
      render();
      greet();
      return state.askMode;
    }

    function reset() {
      state.threads = { tutor: [], notes: [] };
      render();
      greet();
    }

    return { send, clear, reset, setMode, setAskMode, threads: () => state.threads, applyConfig, testConnection, fetchModels, state, render, loadConfig, saveConfig, clearConfig, hasKey };
  }

  root.RG = root.RG || {};
  root.RG.ai = { create, answerLocal, answerTutorLocal, retrieve, tokenize, headingsOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
