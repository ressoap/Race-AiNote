  /* ── 错题本：学科识别、知识点与目标推荐 ─────────────────── */
  const SUBJECT_RULES = [
    { subject: '数学', words: ['导数', '函数', '三角', '数列', '向量', '圆锥', '椭圆', '双曲线', '抛物线', '概率', '复数', '不等式', '方程', '几何', '集合', '对数', '指数', '极值', '最值'] },
    { subject: '物理', words: ['力', '加速度', '速度', '电', '磁', '电路', '感应', '动量', '能量', '光学', '折射', '压强', '浮力', '万有引力', '洛伦兹', '自由落体', '并联', '串联'] },
    { subject: '化学', words: ['化学', '氧化', '还原', '摩尔', '溶液', '元素', '有机', '反应', '电解', '沉淀', '离子', '化学键'] },
    { subject: '生物', words: ['细胞', '遗传', '基因', '生态', '酶', '光合', '呼吸作用', '免疫', '蛋白质'] },
    { subject: '数据结构', words: ['数据结构', '数组', '链表', '栈', '队列', '哈希', '散列', '排序', '归并', '快速排序', '堆', '二叉树', '红黑树', '图', '最短路径', '深度优先', '广度优先', '递归', '动态规划', '时间复杂度', '空间复杂度', '线性探测', '插入排序', '选择排序', '算法'] },
    { subject: '信号与系统', words: ['信号与系统', '拉普拉斯', '傅里叶', '收敛域', '卷积', '冲激', '阶跃', '时不变', '因果', '稳定', '采样', 'z变换', 'Z变换', '频谱', '系统函数', '零极点'] },
    { subject: '英语', words: ['英语', '语法', '时态', '从句', '完形', '阅读', '作文', '单词', '虚拟语气', '被动语态', '将来完成', '非谓语', '介词', '冠词', '主谓一致', '固定搭配'] },
    { subject: '语文', words: ['语文', '文言', '诗歌', '鉴赏', '病句', '成语'] }
  ];

  const KNOWLEDGE_RULES = {
    数学: [
      { label: '导数与函数单调性', words: ['导数', '切线', '单调', '极值', '最值'] },
      { label: '数列递推', words: ['数列', '递推', '通项', '等差', '等比'] },
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

  function looksLikeEnglish(text) {
    const s = String(text || '');
    if (!s) return false;
    const words = s.match(/\b[A-Za-z]{2,}\b/g) || [];
    if (words.length < 3) return false;
    return /\b[A-Za-z]{2,}\b[\s\S]{0,80}\b[A-Za-z]{2,}\b/.test(s);
  }

  /** 粗判题目学科（API 不可用时的本地兜底） */
  function guessSubject(text) {
    const q = String(text || '');
    let best = null;
    let bestScore = 0;
    for (const rule of SUBJECT_RULES) {
      let score = 0;
      for (const w of rule.words) if (q.includes(w)) score += 1;
      if (score > bestScore) { bestScore = score; best = rule.subject; }
    }
    if (looksLikeEnglish(q) && (!best || bestScore < 2)) return { subject: '英语', score: bestScore + 1 };
    return { subject: best, score: bestScore };
  }

  function normalizeSubject(subject) {
    const s = String(subject || '').trim();
    if (!s) return '其他';
    if (/数据结构|计算机|算法/.test(s)) return '数据结构';
    if (/信号|通信/.test(s)) return '信号与系统';
    if (/英文|英语/.test(s)) return '英语';
    if (/数学|物理|化学|生物|语文/.test(s)) return (/数学|物理|化学|生物|语文/.exec(s) || [s])[0];
    return s.slice(0, 12);
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
      if (points.length >= 3) break;
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
    const points = knowledgePointsOf(subject, q + nl + a);
    return { subject, knowledgePoints: points.length ? points : [subject + '综合'], source: 'local' };
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
    const cleanPoints = points.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3);
    const primary = cleanPoints[0] || record.knowledgePoint || subject + '综合';
    const title = primary + ' · ' + date;
    const question = String(record.question || '').replace(/\r\n/g, '\n').trim();
    const answer = String(record.answer || '').trim();
    return [
      '',
      '## ' + title,
      '',
      '**学科**：' + subject,
      '**知识点**：' + (cleanPoints.length ? cleanPoints.join('、') : primary),
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
