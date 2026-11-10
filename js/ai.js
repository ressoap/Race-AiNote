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
          { role: 'system', content: cfg.askMode === 'format'
            ? '你是排版助手。只允许插入 Markdown 标记（##、-、**、空行）来整理格式，严禁增加、删除或改动任何文字内容；原样保留 [[双链]]、#标签、代码块。直接输出整理后的正文，不要解释，不要加代码围栏。'
            : cfg.askMode === 'tutor'
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

  /** 本地格式整理：只做最小必要的规范化，绝不改变行序与语义 */
  function formatLocally(text) {
    const lines = String(text || '').replace(/@@r\n/g, '\n').split('\n');
    const out = [];
    for (const raw of lines) {
      let line = raw.replace(/[ \t]+$/g, '');
      if (!line.trim()) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        continue;
      }
      // 1) 圆点类符号 → 无序列表
      const dot = line.match(/^\s*[·•●※]\s*(.+)$/);
      if (dot) {
        line = '- ' + dot[1].trim();
      } else {
        // 2) 「1、」「（1）」「1）」→ 规范有序列表，编号保留
        const cn = line.match(/^\s*[（(]?(\d+)[)）、]\s*(.+)$/);
        if (cn) line = cn[1] + '. ' + cn[2].trim();
      }
      out.push(line);
    }
    let result = out.join('\n');
    // 折叠多余空行
    result = result.replace(/\n{3,}/g, '\n\n');
    // 按行重排：标题、列表、段落之间保证一个空行，但不打断列表
    const rows = result.split('\n');
    const listKind = function (s) {
      if (s == null) return null;
      if (/^[-*+] /.test(s)) return 'ul';
      if (/^\d+\. /.test(s)) return 'ol';
      return null;
    };
    const spaced = [];
    for (const row of rows) {
      const prev = spaced[spaced.length - 1];
      const isHeading = /^#{1,6} /.test(row);
      const kind = listKind(row);
      const prevKind = listKind(prev);
      const prevIsHeading = prev != null && /^#{1,6} /.test(prev);
      if ((isHeading || kind) && prev != null && prev !== '' && prevKind !== kind) spaced.push('');
      if (!isHeading && !kind && row !== '' && prevKind) spaced.push('');
      if (prevIsHeading && row !== '' && !isHeading) spaced.push('');
      spaced.push(row);
    }
    result = spaced.join('\n').replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  /** 去掉 Markdown 标记，得到纯文本指纹（用于校验「只改格式不改内容」） */
  function plainTextOf(text) {
    return String(text || '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*[·•●※]\s*/gm, '')
      .replace(/^\s*[（(]?\d+[)）.、]\s*/gm, '')
      .replace(/^\s*[一二三四五六七八九十]+、\s*/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/[*_~`]/g, '')
      .replace(/<\/?(u|mark)>/g, '')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/\s+/g, '')
      .trim();
  }

  /* ── 错题本：学科识别与目标推荐 ─────────────────────────── */
  const SUBJECT_RULES = [
    { subject: '数学', words: ['导数', '函数', '三角', '数列', '向量', '圆锥', '椭圆', '双曲线', '抛物线', '概率', '复数', '不等式', '方程', '几何', '集合', '对数', '指数'] },
    { subject: '物理', words: ['力', '加速度', '速度', '电', '磁', '电路', '感应', '动量', '能量', '光学', '折射', '压强', '浮力', '万有引力', '洛伦兹'] },
    { subject: '化学', words: ['化学', '氧化', '还原', '摩尔', '溶液', '元素', '有机', '反应', '电解', '沉淀'] },
    { subject: '生物', words: ['细胞', '遗传', '基因', '生态', '酶', '光合', '呼吸作用', '免疫'] },
    { subject: '英语', words: ['英语', '语法', '时态', '从句', '完形', '阅读', '作文', '单词'] },
    { subject: '语文', words: ['语文', '文言', '诗歌', '鉴赏', '病句', '成语'] }
  ];

  /** 粗判题目学科 */
  function guessSubject(text) {
    const q = String(text || '');
    let best = null;
    let bestScore = 0;
    for (const rule of SUBJECT_RULES) {
      let score = 0;
      for (const w of rule.words) if (q.includes(w)) score += 1;
      if (score > bestScore) { bestScore = score; best = rule.subject; }
    }
    return { subject: best, score: bestScore };
  }

  /** 在「错题」类笔记里挑一个最匹配的，返回候选与推荐 */
  function recommendMistakeBook(question, graph) {
    if (!graph || !graph.notes) return { candidates: [], recommended: null, subject: null };
    const notes = graph.notes.filter(function (n) { return n.type === 'note'; });
    // 优先「XX-错题索引」这类真正的错题本，再退到路径含「错题」的笔记
    const indexed = notes.filter(function (n) { return /错题索引/.test(n.title || ''); });
    const byPath = notes.filter(function (n) { return /错题/.test(n.path || '') || /错题/.test(n.title || ''); });
    const pool = indexed.length ? indexed : (byPath.length ? byPath : notes);
    const subject = guessSubject(question).subject;
    let recommended = null;
    if (subject) {
      recommended = pool.find(function (n) {
        return (n.title || '').includes(subject) || (n.path || '').includes(subject);
      }) || null;
    }
    if (!recommended && pool.length) {
      const hits = retrieve(String(question).slice(0, 60), pool, 1);
      recommended = hits[0] || pool[0];
    }
    return {
      candidates: pool.map(function (n) { return { id: n.id, title: n.title, path: n.path }; }),
      recommended: recommended ? { id: recommended.id, title: recommended.title, path: recommended.path } : null,
      subject: subject
    };
  }

  /** 生成写进错题本的 Markdown 片段 */
  function mistakeSnippet(record) {
    const when = new Date(record.at || Date.now());
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const stamp = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate())
      + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());
    const question = String(record.question || '').split(/\n+/).join(' ').slice(0, 500);
    return [
      '',
      '## AI 答疑记录 ' + stamp,
      '',
      '**问**：' + question,
      '',
      '**答**：',
      String(record.answer || '').trim(),
      '',
      '> 由答疑老师自动记录，建议手工补一行「我的错因」。',
      ''
    ].join('\n');
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

    async function send(text) {
      const question = String(text || '').trim();
      if (!question || state.busy) return;
      const history = thread().filter(m => !m.archived && (m.role === 'user' || m.role === 'assistant')).slice(-8).map(m => ({ role: m.role, content: m.text }));
      addMessage('user', question);
      state.busy = true;
      const loading = addMessage('assistant', '思考中…');
      loading.kind = 'answer';
      loading.question = question;

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
        if (state.askMode === 'tutor' && loading.text && loading.text !== '思考中…') {
          const existing = findRecord(question);
          const alreadyResolved = Boolean(existing && existing.status === 'resolved');
          upsertRecord({
            question: question,
            answer: loading.text,
            status: alreadyResolved ? 'resolved' : 'open',
            at: existing ? existing.at : Date.now(),
            targetId: existing && alreadyResolved ? existing.targetId : null,
            targetTitle: existing && alreadyResolved ? existing.targetTitle : null,
            targetPath: existing && alreadyResolved ? existing.targetPath : null,
            mode: state.askMode
          });
          if (alreadyResolved) { loading.resolved = true; loading.mistake = existing.targetTitle || null; loading.archived = true; }
        }
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

    /* ── 问题记录（右侧时间轴）与错题本去重 ─────────────────── */
    const RECORDS_KEY = 'race-ainote:mistakes';

    function loadRecords() {
      try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]'); } catch (_) { return []; }
    }

    let pushTimer = 0;

    function saveRecords(list) {
      const trimmed = list.slice(-300);
      try { localStorage.setItem(RECORDS_KEY, JSON.stringify(trimmed)); } catch (_) {}
      pushToServer(trimmed);
    }

    /** 写一份到本地服务（serve.mjs），换端口 / 换浏览器也能读回 */
    function pushToServer(records) {
      if (location.protocol === 'file:' || typeof fetch !== 'function') return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        try {
        fetch('/api/store/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: records })
        }).catch(() => {});
        } catch (_) {}
      }, 400);
    }

    /** 启动时把服务端的记录合并进来（按 id 去重，保留更新的那条） */
    async function initRecords() {
      if (location.protocol === 'file:' || typeof fetch !== 'function') return loadRecords().length;
      try {
        const res = await fetch('/api/store/records', { cache: 'no-store' });
        if (!res.ok) return loadRecords().length;
        const data = await res.json();
        const remote = Array.isArray(data.records) ? data.records : [];
        const local = loadRecords();
        const byId = new Map();
        for (const rec of remote) byId.set(rec.id, rec);
        for (const rec of local) {
          const other = byId.get(rec.id);
          const newer = !other || (rec.resolvedAt || rec.at || 0) >= (other.resolvedAt || other.at || 0);
          if (newer) byId.set(rec.id, rec);
        }
        const merged = [...byId.values()].sort((x, y) => (x.order || x.at) - (y.order || y.at));
        try { localStorage.setItem(RECORDS_KEY, JSON.stringify(merged.slice(-300))); } catch (_) {}
        if (merged.length) pushToServer(merged);
        renderRecords();
        return merged.length;
      } catch (_) {
        return loadRecords().length;
      }
    }

    /** 归一化提问，用于判重：去掉空白与标点，取前 80 字 */
    function signatureOf(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[，。？！、；：,.?!;:"'`~()（）\[\]【】]/g, '')
        .slice(0, 80);
    }

    function findRecord(question) {
      const sig = signatureOf(question);
      if (!sig) return null;
      return loadRecords().find(function (r) { return r.sig === sig; }) || null;
    }

    /** 新增或更新记录（同一个问题只保留一条） */
    function upsertRecord(patch) {
      const sig = signatureOf(patch.question);
      const list = loadRecords();
      const idx = list.findIndex(function (r) { return r.sig === sig; });
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], patch, { sig: sig });
      } else {
        list.push(Object.assign({ id: 'mis-' + Date.now(), at: Date.now(), status: 'open' }, patch, { sig: sig, order: Date.now() }));
      }
      saveRecords(list);
      renderRecords();
      return idx >= 0;
    }

    function formatTime(ts) {
      const d = new Date(ts);
      const pad = function (n) { return String(n).padStart(2, '0'); };
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    /* ── 问题记录：搜索 / 日期分块 / 拖拽排序 / 右键 ───────── */
    const state2 = state;
    state2.recordSearch = '';

    function dateKey(ts) {
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function dateLabel(key) {
      const today = dateKey(Date.now());
      const yesterday = dateKey(Date.now() - 86400000);
      if (key === today) return '今天';
      if (key === yesterday) return '昨天';
      return key;
    }

    function filteredRecords() {
      const all = loadRecords().slice().sort((a, b) => (a.order || a.at) - (b.order || b.at));
      const kw = String(state2.recordSearch || '').trim().toLowerCase();
      if (!kw) return all;
      return all.filter(r =>
        String(r.question || '').toLowerCase().includes(kw) ||
        String(r.answer || '').toLowerCase().includes(kw) ||
        String(r.targetTitle || '').toLowerCase().includes(kw));
    }

    function renderRecords() {
      const listEl = document.getElementById('ai-record-list');
      const countEl = document.getElementById('ai-records-count');
      if (!listEl) return;

      const all = loadRecords();
      const list = filteredRecords();
      if (countEl) {
        const open = all.filter(r => r.status !== 'resolved').length;
        countEl.textContent = open ? open + '待解决' : String(all.length);
        countEl.classList.toggle('is-open', open > 0);
      }

      listEl.innerHTML = '';
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'ai-record-empty';
        empty.textContent = all.length ? '没有匹配的记录' : '答疑结束可记入错题本';
        listEl.appendChild(empty);
        return;
      }

      // 按日期分块
      const groups = new Map();
      for (const rec of list) {
        const key = dateKey(rec.at);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rec);
      }
      for (const [key, items] of groups) {
        const head = document.createElement('div');
        head.className = 'record-date';
        head.textContent = dateLabel(key) + ' · ' + items.length;
        listEl.appendChild(head);

        for (const rec of items) {
          const item = document.createElement('button');
          item.className = 'ai-record' + (rec.status === 'resolved' ? ' is-resolved' : '');
          item.draggable = true;
          item.dataset.recordId = rec.id;
          item.title = rec.question;

          const head2 = document.createElement('span');
          head2.className = 'ai-record-head';
          const time = document.createElement('span');
          time.className = 'ai-record-time';
          time.textContent = new Date(rec.at).toTimeString().slice(0, 5);
          const badge = document.createElement('span');
          badge.className = 'ai-record-badge' + (rec.status === 'resolved' ? ' is-resolved' : '');
          badge.textContent = rec.status === 'resolved' ? '已解决' : '待解决';
          head2.append(time, badge);

          const title = document.createElement('span');
          title.className = 'ai-record-title';
          title.textContent = String(rec.question || '').slice(0, 18);
          const target = document.createElement('span');
          target.className = 'ai-record-target';
          target.textContent = rec.targetTitle || (rec.status === 'resolved' ? '未记入错题本' : '未处理');

          item.append(head2, title, target);

          item.addEventListener('click', () => {
            if (opts.onRecordOpen) opts.onRecordOpen(rec);
          });
          item.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            if (opts.onRecordMenu) opts.onRecordMenu(e, rec);
          });
          item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', 'record:' + rec.id);
            item.classList.add('is-dragging');
          });
          item.addEventListener('dragend', () => item.classList.remove('is-dragging'));
          item.addEventListener('dragover', e => {
            e.preventDefault();
            item.classList.add('is-drop-target');
          });
          item.addEventListener('dragleave', () => item.classList.remove('is-drop-target'));
          item.addEventListener('drop', e => {
            e.preventDefault();
            item.classList.remove('is-drop-target');
            const payload = e.dataTransfer.getData('text/plain') || '';
            if (!payload.startsWith('record:')) return;
            const fromId = payload.slice(7);
            if (!fromId || fromId === rec.id) return;
            reorderRecords(fromId, rec.id);
          });

          listEl.appendChild(item);
        }
      }
      listEl.scrollTop = listEl.scrollHeight;
    }

    /** 把 fromId 移动到 targetId 的位置（按当前显示顺序重排 order） */
    function reorderRecords(fromId, targetId) {
      const list = loadRecords().slice().sort((a, b) => (a.order || a.at) - (b.order || b.at));
      const fromIdx = list.findIndex(r => r.id === fromId);
      const toIdx = list.findIndex(r => r.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      const stamp = Date.now();
      list.forEach((r, i) => { r.order = stamp + i; });
      saveRecords(list);
      renderRecords();
    }

    function updateRecord(id, patch) {
      const list = loadRecords();
      const idx = list.findIndex(r => r.id === id);
      if (idx < 0) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      saveRecords(list);
      renderRecords();
      return list[idx];
    }

    function deleteRecord(id) {
      const list = loadRecords().filter(r => r.id !== id);
      saveRecords(list);
      renderRecords();
    }

    function setRecordSearch(keyword) {
      state2.recordSearch = String(keyword || '');
      renderRecords();
    }

    /** 答疑结束后，追加「是否记入错题本 / 标记已解决」的操作条 */
    function buildMistakeBar(msg) {
      const bar = document.createElement('div');
      bar.className = 'ai-mistake';
      const rec = findRecord(msg.question);
      const resolved = Boolean(msg.resolved || (rec && rec.status === 'resolved'));
      if (resolved && !msg.resolved) { msg.resolved = true; msg.archived = true; if (rec && rec.targetTitle) msg.mistake = rec.targetTitle; }

      if (resolved) {
        const done = document.createElement('span');
        done.className = 'ai-mistake-done';
        const target = msg.mistake || (rec && rec.targetTitle);
        done.textContent = target
          ? '✓ 已记入《' + target + '》· 已解决 · 本轮对话不再作为上下文'
          : '✓ 已标记解决 · 本轮对话不再作为上下文';
        bar.appendChild(done);
        return bar;
      }
      if (msg.mistakeSkipped) {
        const skip = document.createElement('span');
        skip.className = 'ai-mistake-skip';
        skip.textContent = '未记入错题本（仍在待解决列表）';
        bar.appendChild(skip);
        return bar;
      }

      const ask = document.createElement('span');
      ask.className = 'ai-mistake-ask';
      ask.textContent = '这道题解决了吗？';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'ghost-btn tiny';
      saveBtn.textContent = '记入错题本';

      const resolveBtn = document.createElement('button');
      resolveBtn.className = 'ghost-btn tiny';
      resolveBtn.textContent = '标记已解决';

      const skipBtn = document.createElement('button');
      skipBtn.className = 'ghost-btn tiny';
      skipBtn.textContent = '稍后再说';

      saveBtn.addEventListener('click', function () {
        bar.innerHTML = '';
        const info = recommendMistakeBook(msg.question || '', opts.getGraph());
        if (!info.candidates.length) {
          const tip = document.createElement('span');
          tip.className = 'ai-mistake-skip';
          tip.textContent = '当前库里没有错题本类笔记，先建一篇吧';
          bar.appendChild(tip);
          return;
        }
        const head = document.createElement('span');
        head.className = 'ai-mistake-ask';
        head.textContent = info.subject ? ('AI 判断是' + info.subject + '题，推荐：') : 'AI 推荐：';

        const select = document.createElement('select');
        select.className = 'ai-mistake-select';
        for (const c of info.candidates) {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.title;
          if (info.recommended && c.id === info.recommended.id) opt.selected = true;
          select.appendChild(opt);
        }
        const ok = document.createElement('button');
        ok.className = 'primary-btn tiny';
        ok.textContent = '确认';
        const cancel = document.createElement('button');
        cancel.className = 'ghost-btn tiny';
        cancel.textContent = '取消';

        ok.addEventListener('click', function () {
          const chosen = info.candidates.find(function (c) { return c.id === select.value; }) || info.recommended;
          if (!chosen) return;
          const wasThere = findRecord(msg.question);
          const createdAt = wasThere ? wasThere.at : Date.now();
          const record = {
            question: msg.question || '',
            answer: msg.text || '',
            targetId: chosen.id,
            targetTitle: chosen.title,
            targetPath: chosen.path,
            status: 'resolved',
            resolvedAt: Date.now(),
            at: createdAt,
            mode: state.askMode
          };
          const existed = upsertRecord(record);
          msg.mistake = chosen.title;
          msg.resolved = true;
          msg.archived = true;
          if (opts.onRecordMistake) opts.onRecordMistake(Object.assign({ at: createdAt }, record, { duplicate: existed }));
          render();
          renderRecords();
        });

        cancel.addEventListener('click', function () { render(); });
        bar.append(head, select, ok, cancel);
      });

      resolveBtn.addEventListener('click', function () {
        const wasThere = findRecord(msg.question);
        upsertRecord({
          question: msg.question || '',
          answer: msg.text || '',
          targetId: null,
          targetTitle: null,
          targetPath: null,
          status: 'resolved',
          resolvedAt: Date.now(),
          at: wasThere ? wasThere.at : Date.now(),
          mode: state.askMode
        });
        msg.resolved = true;
        msg.archived = true;
        if (opts.onToast) opts.onToast('已标记解决，本轮不再作为上下文');
        render();
        renderRecords();
      });

      bar.append(ask, saveBtn, resolveBtn, skipBtn);
      return bar;
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
    renderRecords();

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

    return { send, clear, reset, setMode, setAskMode, optimizeFormat, threads: () => state.threads, records: loadRecords, renderRecords, initRecords, findRecord, signatureOf, updateRecord, deleteRecord, reorderRecords, setRecordSearch, applyConfig, testConnection, fetchModels, state, render, loadConfig, saveConfig, clearConfig, hasKey };
  }

  root.RG = root.RG || {};
  root.RG.ai = { create, answerLocal, answerTutorLocal, retrieve, tokenize, headingsOf, guessSubject, recommendMistakeBook, mistakeSnippet, formatLocally, plainTextOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
