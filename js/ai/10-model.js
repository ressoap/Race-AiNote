
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
    const baseSystem = cfg.askMode === 'format'
      ? '你是排版助手。只允许插入 Markdown 标记（##、-、**、空行）来整理格式，严禁增加、删除或改动任何文字内容；原样保留 [[双链]]、#标签、代码块。直接输出整理后的正文，不要解释，不要加代码围栏。'
      : cfg.askMode === 'tutor'
      ? '你是一位耐心的学科老师。按「①考点定位 ②解题思路 ③分步推导 ④易错提醒 ⑤一句话拓展」作答；条件不足先追问；可以超出笔记范围，但要用 [[笔记标题]] 指出相关复习材料；不要编造标题。'
      : '你是学习笔记助手。只依据给出的笔记回答，用中文分点作答，引用笔记时用 [[标题]] 的形式，不要编造标题。';
    const formatRule = '公式用纯文本 / Unicode（如 √、²、≤），不要输出 LaTeX 标记；列表用 -，不要用 • 或单独 *。';
    const systemPrompt = baseSystem
      + (cfg.askMode === 'format' ? '' : nl + formatRule)
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

