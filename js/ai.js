/* 自动生成：源文件在 js/ai/*.js，由 scripts/build-ai.js 按文件名顺序拼接。 */
/* 不要直接改本文件；改完片段后运行 npm run build:ai。 */
(function (root) {
  'use strict';

  const store = root.RG && root.RG.store;

  function storageGet(name, legacyKey) {
    if (store) {
      const value = store.get(name);
      if (value != null) return value;
    }
    try { return localStorage.getItem(legacyKey); } catch (_) { return null; }
  }

  function storageSet(name, value, legacyKey) {
    if (store) return store.set(name, value);
    try { localStorage.setItem(legacyKey, value); return true; } catch (_) { return false; }
  }

  function storageRemove(name, legacyKey) {
    if (store) return store.remove(name);
    try { localStorage.removeItem(legacyKey); return true; } catch (_) { return false; }
  }

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
  const CONFIG_KEY = 'aiConfig';
  const LEGACY_CONFIG_KEY = 'race-ainote:ai-config';
  const DEFAULT_TEACHER_TRAITS = { lively: 50, detail: 60, guidance: 45, correction: 55 };
  const TEACHER_TRAIT_DEFS = [
    { key: 'lively', name: '语气', left: '活泼', right: '严厉' },
    { key: 'detail', name: '讲解', left: '简洁', right: '详细' },
    { key: 'guidance', name: '引导', left: '启发', right: '直接' },
    { key: 'correction', name: '纠错', left: '鼓励', right: '严格' }
  ];
  const DEFAULT_CONFIG = {
    mode: 'proxy',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    key: '',
    teacherProfile: '',
    teacherTraits: Object.assign({}, DEFAULT_TEACHER_TRAITS)
  };

  function normalizeTeacherTraits(raw) {
    const out = {};
    for (const def of TEACHER_TRAIT_DEFS) {
      const n = Number(raw && raw[def.key]);
      out[def.key] = Number.isFinite(n)
        ? Math.max(0, Math.min(100, Math.round(n)))
        : DEFAULT_TEACHER_TRAITS[def.key];
    }
    return out;
  }

  function traitEffect(key, value) {
    if (key === 'lively') {
      if (value <= 35) return '语气轻松活泼，可以适度幽默，但知识必须准确。';
      if (value >= 65) return '语气严肃、直接、有要求，先指出问题再讲题。';
      return '语气平稳自然，不过分玩笑，也不过度严厉。';
    }
    if (key === 'detail') {
      if (value <= 35) return '尽量简短，先给关键步骤，避免大段展开。';
      if (value >= 65) return '步骤写全，关键计算、条件和易错点都要交代清楚。';
      return '先讲主线，必要处补充关键细节。';
    }
    if (key === 'guidance') {
      if (value <= 35) return '多提问引导，让学生先尝试，不要直接报最终答案。';
      if (value >= 65) return '直接给答案和完整步骤，减少追问。';
      return '先提示思路，再给推导过程。';
    }
    if (value <= 35) return '以鼓励为主，指出错误时语气温和。';
    if (value >= 65) return '严格指出错误和扣分点，要求学生重做关键步骤。';
    return '直接指出错误，但保持尊重。';
  }

  /** 把用户自填的讲课方式和性格滑杆编译成系统提示词（AGENTS.md 风格约束）。 */
  function buildTeacherPrompt(config) {
    const profile = String((config && config.teacherProfile) || '').trim().slice(0, 6000);
    const traits = normalizeTeacherTraits(config && config.teacherTraits);
    const lines = [
      '【学生自定义老师性格与讲课方式】',
      '以下内容由学生自己填写。请在不违反事实准确性、题目条件、安全与隐私规则的前提下，尽量遵守；它与默认教学风格冲突时，以这里为准。'
    ];
    if (profile) {
      lines.push('【讲课方式约束】');
      lines.push(profile);
    }
    lines.push('【性格参数（0=左侧，100=右侧）】');
    for (const def of TEACHER_TRAIT_DEFS) {
      const value = traits[def.key];
      lines.push('- ' + def.name + '（' + def.left + ' ↔ ' + def.right + '）：' + value + '/100。' + traitEffect(def.key, value));
    }
    return lines.join('\n');
  }

  function loadConfig() {
    try {
      const raw = JSON.parse(storageGet(CONFIG_KEY, LEGACY_CONFIG_KEY) || '{}');
      const cfg = Object.assign({}, DEFAULT_CONFIG, raw);
      cfg.teacherProfile = String(cfg.teacherProfile || '').slice(0, 6000);
      cfg.teacherTraits = normalizeTeacherTraits(cfg.teacherTraits);
      return cfg;
    } catch (_) {
      return Object.assign({}, DEFAULT_CONFIG, {
        teacherTraits: Object.assign({}, DEFAULT_TEACHER_TRAITS)
      });
    }
  }

  function saveConfig(cfg) {
    try { storageSet(CONFIG_KEY, JSON.stringify(cfg), LEGACY_CONFIG_KEY); } catch (_) {}
  }

  function clearConfig() {
    try { storageRemove(CONFIG_KEY, LEGACY_CONFIG_KEY); } catch (_) {}
  }

  /** 从模型回复里抠出第一段 JSON（允许带代码围栏或解释文字） */
  function parseLooseJson(text) {
    const src = String(text || '').split('```').join('').trim();
    const start = src.indexOf('{');
    const end = src.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(src.slice(start, end + 1)); } catch (_) { return null; }
  }

  function hasKey(cfg) { return Boolean(cfg && cfg.key && cfg.key.trim().length > 8); }

  const RE_TRAILING_SLASH = /\/+$/;
  const RE_WIKILINK = /\[\[([^\[\]]+?)\]\]/g;

  /** 直连模式：浏览器直接请求 OpenAI 兼容接口（需要服务商允许 CORS） */
  async function callDirect(cfg, question, context, images, signal, teacherPrompt) {
    const url = String(cfg.baseUrl || '').replace(RE_TRAILING_SLASH, '') + '/chat/completions';
    const imageList = Array.isArray(images) ? images.filter(Boolean).slice(0, 3) : [];
    const nl = String.fromCharCode(10);
    const imageHint = imageList.length
      ? '【图片】用户附带了 ' + imageList.length + ' 张图片，请先识别图片中的内容，再结合笔记和问题回答；不要忽略图片。' + nl + nl
      : '';
    const userText = imageHint + '【笔记内容】' + nl + context + nl + nl + '【问题】' + nl + question;
    const analyzePrompt = '你是错题归档助手。只输出 JSON，不要 Markdown，不要解释。'
      + '格式：{"subject":"数学","knowledgePoints":["导数与函数单调性","数列递推"],"mistakeType":"方法不会"}。'
      + '学科只能从这些里选一个：数学、物理、化学、生物、英语、语文、数据结构、信号与系统、其他。'
      + 'knowledgePoints 给 1-4 个，每个 2-12 个字；一道题可以有多个知识点。'
      + 'mistakeType 只能从：概念不清、计算失误、审题偏差、方法不会、公式记错、步骤遗漏、其他 里选一个。';
    const baseSystem = cfg.askMode === 'format'
      ? '你是排版助手。只允许插入 Markdown 标记（##、-、**、空行）来整理格式，严禁增加、删除或改动任何文字内容；原样保留 [[双链]]、#标签、代码块。直接输出整理后的正文，不要解释，不要加代码围栏。'
      : cfg.askMode === 'analyze'
      ? analyzePrompt
      : cfg.askMode === 'tutor'
      ? '你是一位耐心的学科老师。按「①考点定位 ②解题思路 ③分步推导 ④易错提醒 ⑤一句话拓展」作答；条件不足先追问；可以超出笔记范围，但要用 [[笔记标题]] 指出相关复习材料；不要编造标题。'
      : '你是学习笔记助手。只依据给出的笔记回答，用中文分点作答，引用笔记时用 [[标题]] 的形式，不要编造标题。';
    const formatRule = '公式用纯文本 / Unicode（如 √、²、≤），不要输出 LaTeX 标记；列表用 -，不要用 • 或单独 *。';
    const systemPrompt = baseSystem
      + (cfg.askMode === 'format' || cfg.askMode === 'analyze' ? '' : nl + formatRule)
      + (cfg.askMode === 'tutor' && teacherPrompt ? nl + nl + teacherPrompt : '')
      + (imageList.length ? nl + '用户消息包含图片，必须优先识别图片内容；笔记只作为辅助。' : '');
    const requestModel = imageList.length && cfg.visionModel ? cfg.visionModel : cfg.model;
    const userContent = imageList.length
      ? [{ type: 'text', text: userText }, ...imageList.map(src => ({ type: 'image_url', image_url: { url: src } }))]
      : userText;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key.trim() },
      body: JSON.stringify({
        model: requestModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      }),
      signal: signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
    const data = await res.json();
    const answer = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    const refs = [...new Set([...answer.matchAll(RE_WIKILINK)].map(function (m) { return m[1].split("|")[0].trim(); }))];
    return { answer: answer || '（模型没有返回内容）', refs: refs };
  }

  /** 代理模式：请求本机 scripts/serve.mjs 的 /api/chat，Key 在服务端 */
  async function callProxy(question, context, askMode, history, images, visionModel, signal, teacherPrompt) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context, mode: askMode || 'notes', history: history || [], images: (images || []).slice(0, 3), visionModel: visionModel || '', teacherPrompt: teacherPrompt || '' }),
      signal: signal
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

  /* ── 错题本：学科识别、知识点与目标推荐 ─────────────────── */
  const SUBJECT_RULES = [
    { subject: '数学', words: ['导数', '函数', '三角', '正弦', '余弦', '数列', '极限', '收敛', '发散', '连续', '积分', '微分', '洛必达', '无穷小', '有界', '单调', '反例', '向量', '圆锥', '椭圆', '双曲线', '抛物线', '概率', '复数', '不等式', '方程', '几何', '集合', '对数', '指数', '极值', '最值', '级数', '矩阵', '行列式'] },
    { subject: '物理', words: ['力', '加速度', '速度', '电', '磁', '电路', '感应', '动量', '能量', '光学', '折射', '压强', '浮力', '万有引力', '洛伦兹', '自由落体', '并联', '串联'] },
    { subject: '化学', words: ['化学', '氧化', '还原', '摩尔', '溶液', '元素', '有机', '反应', '电解', '沉淀', '离子', '化学键'] },
    { subject: '生物', words: ['细胞', '遗传', '基因', '生态', '酶', '光合', '呼吸作用', '免疫', '蛋白质'] },
    { subject: '数据结构', words: ['数据结构', '数组', '链表', '栈', '队列', '哈希', '散列', '排序', '归并', '快速排序', '堆', '二叉树', '红黑树', '图论', '邻接表', '邻接矩阵', '并查集', '拓扑排序', '最短路径', '深度优先', '广度优先', '递归', '动态规划', '时间复杂度', '空间复杂度', '线性探测', '插入排序', '选择排序', '算法'] },
    { subject: '信号与系统', words: ['信号与系统', '拉普拉斯', '傅里叶', '收敛域', '卷积', '冲激', '阶跃', '时不变', '因果', '稳定', '采样', 'z变换', 'Z变换', '频谱', '系统函数', '零极点'] },
    { subject: '英语', words: ['英语', '语法', '时态', '从句', '完形', '阅读', '作文', '单词', '虚拟语气', '被动语态', '将来完成', '非谓语', '介词', '冠词', '主谓一致', '固定搭配'] },
    { subject: '语文', words: ['语文', '文言', '诗歌', '鉴赏', '病句', '成语'] }
  ];

  const KNOWLEDGE_RULES = {
    数学: [
      { label: '导数与函数单调性', words: ['导数', '切线', '单调', '极值', '最值'] },
      { label: '数列递推', words: ['数列', '递推', '通项', '等差', '等比'] },
      { label: '数列极限', words: ['极限', '收敛', '发散', '无穷小', '有界'] },
      { label: '三角函数', words: ['三角', '正弦', '余弦', '诱导公式'] },
      { label: '圆锥曲线', words: ['圆锥曲线', '椭圆', '双曲线', '抛物线'] },
      { label: '概率统计', words: ['概率', '分布列', '期望', '方差'] },
      { label: '平面向量', words: ['向量', '数量积'] }
    ],
    物理: [
      { label: '自由落体', words: ['自由落体', '下落', '重力加速度'] },
      { label: '牛顿运动定律', words: ['牛顿', '受力', '加速度'] },
      { label: '电路分析', words: ['电路', '并联', '串联', '电阻', '电流', '电压'] },
      { label: '电磁感应', words: ['电磁感应', '感应电流', '楞次', '法拉第'] },
      { label: '洛伦兹力', words: ['洛伦兹', '磁场', '圆周运动'] },
      { label: '动量与能量', words: ['动量', '能量守恒', '动能', '势能'] }
    ],
    化学: [
      { label: '氧化还原', words: ['氧化', '还原', '化合价'] },
      { label: '溶液与摩尔', words: ['摩尔', '溶液', '浓度'] },
      { label: '元素与周期律', words: ['元素', '周期', '族'] },
      { label: '有机化学', words: ['有机', '烃', '官能团'] }
    ],
    生物: [
      { label: '细胞结构', words: ['细胞', '细胞器', '膜'] },
      { label: '遗传与基因', words: ['遗传', '基因', 'DNA', '染色体'] },
      { label: '光合与呼吸', words: ['光合', '呼吸作用', '酶'] },
      { label: '生态系统', words: ['生态', '种群', '群落'] }
    ],
    数据结构: [
      { label: '归并排序', words: ['归并', 'merge'] },
      { label: '哈希表与线性探测', words: ['哈希', '散列', '线性探测', 'hash'] },
      { label: '二叉树', words: ['二叉树', '平衡树', '红黑树', '遍历'] },
      { label: '链表与栈队列', words: ['链表', '栈', '队列'] },
      { label: '图算法', words: ['图', '最短路径', '深度优先', '广度优先'] },
      { label: '复杂度分析', words: ['时间复杂度', '空间复杂度', '复杂度'] }
    ],
    信号与系统: [
      { label: '拉普拉斯变换', words: ['拉普拉斯', '收敛域', 's域'] },
      { label: '傅里叶变换', words: ['傅里叶', '频谱', '频域'] },
      { label: 'LTI系统性质', words: ['线性', '时不变', '因果', '稳定'] },
      { label: '卷积与冲激响应', words: ['卷积', '冲激', '阶跃'] },
      { label: '采样与z变换', words: ['采样', 'z变换', 'Z变换'] }
    ],
    英语: [
      { label: '虚拟语气', words: ['虚拟语气', 'If I were', 'would', 'wish'] },
      { label: '将来完成时与被动语态', words: ['将来完成', 'will have', 'by the end', '被动语态'] },
      { label: '非谓语动词', words: ['非谓语', '不定式', '分词', '动名词'] },
      { label: '定语从句', words: ['定语从句', 'which', 'that', 'who'] },
      { label: '完形与阅读', words: ['完形', '阅读', 'passage'] },
      { label: '书面表达', words: ['作文', '书面表达', 'writing'] },
      { label: '词汇与固定搭配', words: ['单词', '词汇', '固定搭配', '介词'] }
    ],
    语文: [
      { label: '文言文阅读', words: ['文言', '实词', '虚词'] },
      { label: '诗歌鉴赏', words: ['诗歌', '鉴赏', '意象'] },
      { label: '病句辨析', words: ['病句', '搭配不当', '成分残缺'] },
      { label: '成语运用', words: ['成语', '词语'] }
    ]
  };

  const ENGLISH_FUNCTION_WORDS = ['the', 'is', 'are', 'was', 'were', 'of', 'to', 'in', 'on', 'for', 'with', 'which', 'what', 'who', 'should', 'would', 'can', 'could', 'has', 'have', 'not', 'and', 'but', 'that', 'this', 'from', 'by', 'at', 'as'];

  function looksLikeEnglish(text) {
    const s = String(text || '');
    if (!s) return false;
    const words = s.match(/[A-Za-z]{2,}/g) || [];
    if (words.length < 4) return false;
    const lower = words.map(w => w.toLowerCase());
    return lower.some(w => ENGLISH_FUNCTION_WORDS.indexOf(w) >= 0);
  }

  /** 粗判题目学科（API 不可用时的本地兜底） */
  function guessSubject(text) {
    const q = String(text || '');
    let best = null;
    let bestScore = 0;
    for (const rule of SUBJECT_RULES) {
      let score = 0;
      for (const w of rule.words) {
        let from = 0;
        let hits = 0;
        while (hits < 3) {
          const idx = q.indexOf(w, from);
          if (idx < 0) break;
          hits += 1;
          from = idx + w.length;
        }
        score += hits;
      }
      if (score > bestScore) { bestScore = score; best = rule.subject; }
    }
    if (!best && looksLikeEnglish(q)) return { subject: '英语', score: 1 };
    return { subject: best, score: bestScore };
  }

  function normalizeSubject(subject) {
    const s = String(subject || '').trim();
    if (!s) return '其他';
    const exact = /^(数学|物理|化学|生物|英语|语文|数据结构|信号与系统|其他)$/.exec(s);
    if (exact) return exact[1];
    if (/数据结构|计算机|算法/.test(s)) return '数据结构';
    if (/信号|通信/.test(s)) return '信号与系统';
    if (/英文|英语/.test(s)) return '英语';
    if (/数学|物理|化学|生物|语文/.test(s)) return (/数学|物理|化学|生物|语文/.exec(s) || [s])[0];
    return s.slice(0, 12);
  }

  const MAX_KNOWLEDGE_POINTS = 5;

  /** 知识点要能直接当 Markdown 标签用：去 #、去标点、空格转 -，最长 16 字。 */
  function sanitizePoint(value) {
    return String(value == null ? '' : value)
      .replace(/^#+/, '')
      .replace(/[\s\u3000]+/g, '-')
      .replace(/[^\p{L}\p{N}_\/-]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^[-/]+|[-/]+$/g, '')
      .slice(0, 16);
  }

  /** 一道题可以有多个知识点：统一清洗、按原顺序去重、最多 5 个。 */
  function sanitizeKnowledgePoints(list, max) {
    const limit = Number(max) > 0 ? Math.min(Number(max), MAX_KNOWLEDGE_POINTS) : MAX_KNOWLEDGE_POINTS;
    const source = Array.isArray(list) ? list : (list == null ? [] : [list]);
    const out = [];
    const seen = new Set();
    for (const item of source) {
      const label = sanitizePoint(item);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length >= limit) break;
    }
    return out;
  }

  const MISTAKE_TYPES = ['概念不清', '计算失误', '审题偏差', '方法不会', '公式记错', '步骤遗漏', '其他'];

  /** 错题类型：固定几个选项，模型给的说法统一归一到这里 */
  function normalizeMistakeType(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return '';
    for (const type of MISTAKE_TYPES) {
      if (s === type || s.indexOf(type) >= 0) return type;
    }
    if (/(概念|定义|理解|混淆|本质)/.test(s)) return '概念不清';
    if (/(计算|算错|粗心|算术|口算)/.test(s)) return '计算失误';
    if (/(审题|看错|漏看|条件没看清|误解题意)/.test(s)) return '审题偏差';
    if (/(公式|定理|记错|记混|背错)/.test(s)) return '公式记错';
    if (/(步骤|漏步|跳步|没写全|过程不全)/.test(s)) return '步骤遗漏';
    if (/(方法|思路|无从下手|不会|没入手)/.test(s)) return '方法不会';
    return '其他';
  }

  /** 模型不可用时，用题目和解析里的关键词粗判错题类型 */
  function guessMistakeTypeLocally(question, answer) {
    const nl = String.fromCharCode(10);
    const text = String(question || '') + nl + String(answer || '').slice(0, 2000);
    if (/(审题|看错|漏看|没注意|条件看|误解题意)/.test(text)) return '审题偏差';
    if (/(计算|算错|粗心|口算|算术)/.test(text)) return '计算失误';
    if (/(公式|定理|记错|记混|背错)/.test(text)) return '公式记错';
    if (/(漏了|少算|步骤|跳步|没写全|过程不全)/.test(text)) return '步骤遗漏';
    if (/(不会|没思路|无从下手|方法|思路)/.test(text)) return '方法不会';
    if (/(概念|定义|理解|混淆|本质)/.test(text)) return '概念不清';
    return '其他';
  }

  function knowledgePointsOf(subject, text) {
    const q = String(text || '');
    const rules = KNOWLEDGE_RULES[subject] || [];
    const scored = rules.map(item => {
      let score = 0;
      for (const w of item.words) if (q.includes(w)) score += 1;
      return { label: item.label, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    const points = [];
    for (const item of scored) {
      if (!points.includes(item.label)) points.push(item.label);
      if (points.length >= 4) break;
    }
    return points;
  }

  /** 本地兜底分类：模型不可用时也能把题目分到正确科目 */
  function classifyLocally(question, answer) {
    const q = String(question || '');
    const a = String(answer || '').slice(0, 4000);
    const nl = String.fromCharCode(10);
    const byQuestion = guessSubject(q).subject;
    const byCombined = guessSubject(q + nl + a).subject;
    const subject = byQuestion || byCombined || (looksLikeEnglish(q) ? '英语' : '其他');
    const points = sanitizeKnowledgePoints(knowledgePointsOf(subject, q + nl + a));
    return {
      subject: subject,
      knowledgePoints: points.length ? points : [subject + '综合'],
      mistakeType: guessMistakeTypeLocally(q, a),
      source: 'local'
    };
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

  /** 把原文按 Markdown 引用块保存：保留换行、空行和公式原貌，标题/列表不会破坏结构。 */
  function quoteLines(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(function (line) { return line ? '> ' + line : '>'; })
      .join('\n');
  }

  /** 去引用符、统一空白，用于判断某道原题是否已经写进错题本。 */
  function normalizeQuestionText(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/^>\s?/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function questionBlocks(text) {
    const s = String(text || '').replace(/\r\n/g, '\n');
    const blocks = [];
    const head = /^#{2,4}\s*原题目[^\n]*$/gm;
    let m;
    while ((m = head.exec(s))) {
      const rest = s.slice(m.index + m[0].length);
      const next = rest.search(/^#{2,4}\s/m);
      blocks.push(next >= 0 ? rest.slice(0, next) : rest);
    }
    const old = /\*\*问\*\*：([\s\S]*?)(?=\n\s*\*\*答\*\*：|\n\s*>\s*由答疑老师自动记录|$)/g;
    while ((m = old.exec(s))) blocks.push(m[1]);
    return blocks;
  }

  function mistakeContentHasQuestion(content, question) {
    const q = normalizeQuestionText(question);
    if (!q) return false;
    return questionBlocks(content).some(function (block) {
      return normalizeQuestionText(block).includes(q);
    });
  }

  /** 生成写进错题本的 Markdown 片段：标题 = 知识点 + 日期；原题目全文原样保留。 */
  function mistakeSnippet(record, analysis) {
    const when = new Date(record.at || Date.now());
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const date = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate());
    const a = analysis || {};
    const subject = normalizeSubject(a.subject || record.subject || '其他');
    const points = Array.isArray(a.knowledgePoints) ? a.knowledgePoints
      : (Array.isArray(record.knowledgePoints) ? record.knowledgePoints : []);
    const cleanPoints = sanitizeKnowledgePoints(points);
    const primary = cleanPoints[0] || sanitizePoint(record.knowledgePoint) || subject + '综合';
    const pointLine = cleanPoints.length
      ? cleanPoints.map(x => '#' + x).join(' ')
      : '#' + primary;
    const title = primary + ' · ' + date;
    const question = String(record.question || '').replace(/\r\n/g, '\n').trim();
    const answer = String(record.answer || '').trim();
    return [
      '',
      '## ' + title,
      '',
      '**学科**：' + subject,
      '**知识点**：' + pointLine,
      '**错题类型**：' + (normalizeMistakeType(a.mistakeType) || guessMistakeTypeLocally(question, answer)),
      '',
      '### 原题目',
      '',
      question ? quoteLines(question) : '> （没有记录到原题目）',
      '',
      '### 解析',
      '',
      answer || '（无解析）',
      '',
      '> 由答疑老师自动记录，原题目与解析均已保留；建议手工补一行「我的错因」。',
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
    const state = { threads: { tutor: [], notes: [] }, mode: 'local', askMode: 'tutor', busy: false, serverVision: '', config: loadConfig() };

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

    /** 有没有能识图的模型：直连看配置，代理看服务端 /api/health 回报 */
    function hasVisionModel() {
      if (String((state.config && state.config.visionModel) || '').trim()) return true;
      if (state.mode === 'proxy' && state.serverVision) return true;
      return false;
    }

    function updateVisionHint() {
      const hint = document.getElementById('ai-vision-hint');
      if (!hint) return;
      hint.hidden = state.mode === 'local' || hasVisionModel();
    }

    function setMode(mode, label) {
      state.mode = mode;
      if (modeEl) modeEl.textContent = label || (mode === 'remote' ? '模型模式' : '本地分析模式');
      if (modeEl) modeEl.classList.toggle('is-remote', mode === 'remote');
      updateVisionHint();
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
        state.serverVision = String(info.visionModel || '');
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
      const visionReady = hasVisionModel();
      const sendImages = (state.mode === 'local' || visionReady) ? images : [];
      const imageSkipped = images.length > 0 && sendImages.length === 0;
      if (imageSkipped && opts.onToast) {
        opts.onToast('没有可识图的视觉模型，这次只发文字；可在「设置 → AI」里填写视觉模型');
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
              ? await callDirect(Object.assign({}, state.config, { askMode: askModeAtSend }), question, context, sendImages, signal, teacherPrompt)
              : await callProxy(question, context, askModeAtSend, history, sendImages, state.config.visionModel, signal, teacherPrompt);
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
        if (imageSkipped) {
          loading.text += String.fromCharCode(10, 10) + '（没有可识图的视觉模型，本次只发送了文字）';
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
            mistakeType: analysis.mistakeType || '',
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
                  knowledgePoint: knowledgePoints[0] || '',
                  mistakeType: analysis.mistakeType || saved.mistakeType || ''
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


    /* ── 问题记录（右侧时间轴）与错题本去重 ─────────────────── */
    const RECORDS_KEY = 'records';
    const LEGACY_RECORDS_KEY = 'race-ainote:mistakes';

    /** 记录归属的笔记库：每个库的错题互相独立 */
    function currentVaultId() {
      try {
        const id = opts && typeof opts.getVaultId === 'function' ? opts.getVaultId() : null;
        return id ? String(id) : 'demo';
      } catch (_) {
        return 'demo';
      }
    }

    function allRecords() {
      try {
        const parsed = JSON.parse(storageGet(RECORDS_KEY, LEGACY_RECORDS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }

    function loadRecords() {
      const id = currentVaultId();
      return allRecords().filter(function (r) { return r && r.vaultId === id; });
    }

    /**
     * 修分配：老记录迁移时只能归到「当时打开的库」，可能归错。
     * 这里用 targetPath 反查——哪本书里真有这篇错题本，就把它算给哪本书。
     */
    function repairRecordVaults(owners) {
      if (!owners) return 0;
      const all = allRecords();
      let changed = 0;
      const next = all.map(function (r) {
        if (!r || typeof r !== 'object') return r;
        const path = String(r.targetPath || '').trim();
        if (!path) return r;
        const owner = owners[path];
        if (!owner || owner === r.vaultId) return r;
        changed += 1;
        return Object.assign({}, r, { vaultId: owner });
      });
      if (changed) {
        try { storageSet(RECORDS_KEY, JSON.stringify(next), LEGACY_RECORDS_KEY); } catch (_) {}
        pushToServer(next);
        try { renderRecords(); } catch (_) {}
      }
      return changed;
    }

    /** 老版本的记录没有 vaultId：第一次启动时归到当时打开的库 */
    function migrateLegacyRecords() {
      const all = allRecords();
      const id = currentVaultId();
      let changed = 0;
      const next = all.map(function (r) {
        if (!r || typeof r !== 'object' || r.vaultId) return r;
        changed += 1;
        return Object.assign({}, r, { vaultId: id });
      });
      if (changed) {
        try { storageSet(RECORDS_KEY, JSON.stringify(next), LEGACY_RECORDS_KEY); } catch (_) {}
      }
      return changed;
    }

    let pushTimer = 0;

    /** 只写回当前库那一段，其它库的记录原样保留 */
    function saveRecords(list) {
      const id = currentVaultId();
      const mine = list.slice()
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, 300)
        .map(function (r) { return Object.assign({}, r, { vaultId: (r && r.vaultId) || id }); });
      const others = allRecords().filter(function (r) { return r && r.vaultId && r.vaultId !== id; });
      const merged = others.concat(mine)
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, 600);
      try { storageSet(RECORDS_KEY, JSON.stringify(merged), LEGACY_RECORDS_KEY); } catch (_) {}
      pushToServer(merged);
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
      migrateLegacyRecords();
      if (location.protocol === 'file:' || typeof fetch !== 'function') return loadRecords().length;
      const id = currentVaultId();
      const stamp = function (rec) {
        if (!rec || typeof rec !== 'object') return rec;
        return rec.vaultId ? rec : Object.assign({}, rec, { vaultId: id });
      };
      try {
        const res = await fetch('/api/store/records', { cache: 'no-store' });
        if (!res.ok) return loadRecords().length;
        const data = await res.json();
        const remote = Array.isArray(data.records) ? data.records : [];
        const byId = new Map();
        for (const rec of allRecords()) {
          if (rec && rec.id) byId.set(rec.id, stamp(rec));
        }
        for (const rec of remote) {
          if (!rec || !rec.id) continue;
          const next = stamp(rec);
          const other = byId.get(next.id);
          const newer = !other || (next.resolvedAt || next.at || 0) >= (other.resolvedAt || other.at || 0);
          if (newer) byId.set(next.id, next);
        }
        const merged = [...byId.values()].sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 600);
        try { storageSet(RECORDS_KEY, JSON.stringify(merged), LEGACY_RECORDS_KEY); } catch (_) {}
        if (merged.length) pushToServer(merged);
        renderRecords();
        return merged.filter(function (r) { return r.vaultId === id; }).length;
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
        list.push(Object.assign({ id: 'mis-' + Date.now(), at: Date.now(), status: 'open', vaultId: currentVaultId() }, patch, { sig: sig }));
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
    state2.recordDate = '';

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

    /** 日期下拉：列出所有有记录的日期，带数量，便于快速定位 */
    function renderDateOptions(all) {
      const select = document.getElementById('record-date-filter');
      if (!select) return;
      const counts = new Map();
      for (const rec of all) {
        const key = dateKey(rec.at);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      if (state2.recordDate && !counts.has(state2.recordDate)) state2.recordDate = '';
      select.innerHTML = '';
      const allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = '全部日期';
      select.appendChild(allOption);
      const keys = [...counts.keys()].sort((a, b) => b.localeCompare(a));
      for (const key of keys) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = dateLabel(key) + ' · ' + counts.get(key);
        select.appendChild(option);
      }
      select.value = state2.recordDate;
    }

    function filteredRecords() {
      const all = loadRecords().slice().sort((a, b) => (b.at || 0) - (a.at || 0));
      const byDate = state2.recordDate ? all.filter(r => dateKey(r.at) === state2.recordDate) : all;
      const kw = String(state2.recordSearch || '').trim().toLowerCase();
      if (!kw) return byDate;
      return byDate.filter(r =>
        String(r.question || '').toLowerCase().includes(kw) ||
        String(r.answer || '').toLowerCase().includes(kw) ||
        String(r.targetTitle || '').toLowerCase().includes(kw));
    }

    function renderRecords() {
      const listEl = document.getElementById('ai-record-list');
      const countEl = document.getElementById('ai-records-count');
      if (!listEl) return;

      const all = loadRecords();
      renderDateOptions(all);
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
          item.draggable = false;
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
          if (rec.mistakeType) {
            const typeChip = document.createElement('span');
            typeChip.className = 'ai-record-type';
            typeChip.textContent = rec.mistakeType;
            typeChip.title = 'AI 判定的错题类型';
            head2.appendChild(typeChip);
          }

          const title = document.createElement('span');
          title.className = 'ai-record-title';
          title.textContent = String(rec.question || '');
          const target = document.createElement('span');
          target.className = 'ai-record-target';
          target.textContent = rec.targetTitle || (rec.status === 'resolved' ? '未记入错题本' : '未处理');
          if (rec.targetTitle || rec.targetPath) {
            target.classList.add('is-link');
            target.title = '定位到错题笔记：' + (rec.targetPath || rec.targetTitle);
            target.addEventListener('click', e => {
              e.stopPropagation();
              if (opts.onRecordLocate) opts.onRecordLocate(rec);
            });
          }

          item.append(head2, title, target);

          item.addEventListener('click', () => {
            if (opts.onRecordOpen) opts.onRecordOpen(rec);
          });
          item.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            if (opts.onRecordMenu) opts.onRecordMenu(e, rec);
          });
          listEl.appendChild(item);
        }
      }
      listEl.scrollTop = 0;
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

    function setRecordDate(key) {
      state2.recordDate = String(key || '');
      renderRecords();
    }

    /** 错题本目录迁移后，同步记录里的 targetPath */
    function remapRecordPaths(pathMap) {
      if (!pathMap || typeof pathMap.forEach !== 'function') return 0;
      const list = loadRecords();
      let changed = 0;
      for (const rec of list) {
        if (rec.targetPath && pathMap.has(rec.targetPath)) {
          rec.targetPath = pathMap.get(rec.targetPath);
          changed += 1;
        }
      }
      if (changed) {
        saveRecords(list);
        renderRecords();
      }
      return changed;
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

      const recorded = Boolean(rec && rec.targetTitle);
      if (recorded) {
        const done = document.createElement('span');
        done.className = 'ai-mistake-done';
        done.textContent = '✓ 已自动记入《' + rec.targetTitle + '》· 仍待解决';
        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'ghost-btn tiny';
        resolveBtn.textContent = '标记已解决';
        resolveBtn.addEventListener('click', function () {
          const wasThere = findRecord(msg.question);
          const saved = wasThere || rec;
          upsertRecord({
            question: msg.question || '',
            answer: msg.text || '',
            targetId: saved.targetId || null,
            targetTitle: saved.targetTitle || rec.targetTitle,
            targetPath: saved.targetPath || rec.targetPath,
            status: 'resolved',
            resolvedAt: Date.now(),
            at: saved.at || Date.now(),
            mode: state.askMode,
            subject: saved.subject || '',
            knowledgePoints: saved.knowledgePoints || [],
            knowledgePoint: saved.knowledgePoint || ''
          });
          msg.resolved = true;
          msg.archived = true;
          msg.mistake = rec.targetTitle;
          if (opts.onToast) opts.onToast('已标记解决，本轮不再作为上下文');
          render();
          renderRecords();
        });
        bar.append(done, resolveBtn);
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
            mode: state.askMode,
            subject: wasThere ? (wasThere.subject || '') : '',
            knowledgePoints: wasThere ? (wasThere.knowledgePoints || []) : [],
            knowledgePoint: wasThere ? (wasThere.knowledgePoint || '') : ''
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
          mode: state.askMode,
          subject: wasThere ? (wasThere.subject || '') : '',
          knowledgePoints: wasThere ? (wasThere.knowledgePoints || []) : [],
          knowledgePoint: wasThere ? (wasThere.knowledgePoint || '') : ''
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
              subject: subject === '其他' ? local.subject : subject,
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
        if (!subject || subject === '其他') return local;
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
})(typeof globalThis !== 'undefined' ? globalThis : this);
