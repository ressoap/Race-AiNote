const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** ai.js 是浏览器脚本（依赖 document），这里只测纯函数部分 */
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai.js'), 'utf8');
const sandbox = { console, globalThis: null };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const ai = sandbox.RG.ai;

const notes = [
  { id: 'a', title: '导数及其应用', path: '20-数学/导数及其应用.md', content: '导数 切线 单调性', tags: ['导数'], summary: '导数摘要' },
  { id: 'b', title: '磁场', path: '30-物理/磁场.md', content: '洛伦兹力 圆周运动', tags: ['物理'], summary: '磁场摘要' },
  { id: 'c', title: '薄弱环节清单', path: '40-复习/薄弱环节清单.md', content: '导数恒成立', tags: ['薄弱环节'], summary: '' }
];
const graph = { notes, nodes: notes.map(n => Object.assign({ type: 'note', degree: 1 }, n)) };

test('老师模式：解题类问题给出分步框架，并引用相关笔记', () => {
  const r = ai.answerTutorLocal('这道导数题我不会做，帮我讲一下思路', { graph, currentNote: notes[0] });
  assert.match(r.text, /框架引导/);
  assert.match(r.text, /考点/);
  assert.match(r.text, /导数及其应用/, '应引用库里相关笔记');
  assert.ok(r.refs.includes('导数及其应用'));
});

test('老师模式：概念类问题走概念分支', () => {
  const r = ai.answerTutorLocal('这个概念我一直没搞懂', { graph, currentNote: null });
  assert.match(r.text, /复述|适用条件/);
});

test('笔记模式：能识别孤立笔记', () => {
  const g = { notes, nodes: notes.map(n => Object.assign({ type: 'note', degree: 0 }, n)) };
  const r = ai.answerLocal('哪些笔记还没有被链接', { graph: g, currentNote: null });
  assert.match(r.text, /孤立/);
  assert.equal(r.refs.length, 3);
});

test('笔记模式：知识卡整理包含结构与小标题', () => {
  const note = { title: '导数及其应用', content: '# 导数\n\n## 定义\n## 应用\n', tags: ['导数'], summary: '摘要', links: [{ target: '切线方程' }] };
  const r = ai.answerLocal('帮我整理成知识卡', { graph: { notes: [note], nodes: [note] }, currentNote: note });
  assert.match(r.text, /## 定义/);
  assert.match(r.text, /切线方程/);
});

test('检索按关键词排序，命中标题权重更高', () => {
  const hits = ai.retrieve('导数', notes, 2);
  assert.equal(hits[0].title, '导数及其应用');
});

test('格式整理绝不改动正文：标记去掉后逐字一致', () => {
  const cases = [
    '· 第一点\n1、第二点\n一、小标题\n普通段落',
    '今天复习导数。求 f(x)=x^2 的导数，答案是 2x。\n\n\n结论：幂函数求导。',
    '## 已有标题\n\n- 列表一\n- 列表二\n\n> 引用一句'
  ];
  for (const src of cases) {
    const out = ai.formatLocally(src);
    assert.equal(ai.plainTextOf(out), ai.plainTextOf(src), '格式整理改变了正文：\n' + src + '\n→\n' + out);
  }
});

test('模型结果校验：改动一个字就判定为不可用', () => {
  const src = ['定义', '', '导数定义是极限。'].join(String.fromCharCode(10));
  const faithful = '## 定义\n\n导数定义是极限。';
  const changed = '## 定义\n\n导数的定义是极限。'; // 多了个「的」
  assert.equal(ai.plainTextOf(faithful), ai.plainTextOf(src));
  assert.notEqual(ai.plainTextOf(changed), ai.plainTextOf(src));
});

test('示例库 50 篇全部走一遍格式整理，正文一个字都不能变', () => {
  const vm = require('node:vm');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'demo-vault.js'), 'utf8'), sandbox);
  const vault = require('../js/vault.js');
  const graph = vault.buildVault(sandbox.RG.demoVault.files);
  let checked = 0;
  for (const note of graph.notes) {
    const out = ai.formatLocally(note.content);
    assert.equal(ai.plainTextOf(out), ai.plainTextOf(note.content), '笔记被改动：' + note.title);
    checked += 1;
  }
  assert.ok(checked >= 40);
});

test('英语题识别为英语，不能落回数学', () => {
  const cases = [
    'The report ______ by the end of next week. 选项：will have been finished / will be finished',
    'If I ______ (be) you, I would apologize to her.',
    'The passage is mainly about ______. 这道阅读题怎么选？'
  ];
  for (const q of cases) {
    assert.equal(ai.guessSubject(q).subject, '英语', q);
    assert.equal(ai.classifyLocally(q, '').subject, '英语', q);
  }
  const c = ai.classifyLocally('If I ______ (be) you, I would apologize to her.', '虚拟语气用 were');
  assert.equal(c.subject, '英语');
  assert.ok(c.knowledgePoints.some(x => /虚拟语气/.test(x)), JSON.stringify(c.knowledgePoints));
});

test('数据结构与信号系统不会串到数学/英语', () => {
  assert.equal(ai.guessSubject('哈希表容量 11，H(k)=k mod 11，用线性探测，查找 2 要几次？').subject, '数据结构');
  assert.equal(ai.guessSubject('已知 x(t)=e^{-2t}u(t)，求拉普拉斯变换及收敛域。').subject, '信号与系统');
  const ds = ai.classifyLocally('数组归并排序的递归过程和复杂度', '');
  assert.equal(ds.subject, '数据结构');
  assert.ok(ds.knowledgePoints.some(x => /归并排序|复杂度/.test(x)));
  const sig = ai.classifyLocally('系统 y(t)=x(t-1)+2x(t+1)，判断线性、时不变、因果、稳定。', '');
  assert.equal(sig.subject, '信号与系统');
});

test('错题片段标题包含知识点与日期', () => {
  const record = { question: 'If I were you.', answer: '虚拟语气', at: Date.now() };
  const snippet = ai.mistakeSnippet(record, { subject: '英语', knowledgePoints: ['虚拟语气', '条件句'] });
  assert.match(snippet, /^## 虚拟语气 · \d{4}-\d{2}-\d{2}$/m);
  assert.match(snippet, /\*\*学科\*\*：英语/);
  assert.match(snippet, /\*\*知识点\*\*：#虚拟语气 #条件句/);
});

test('错题片段完整保留原题目：不截断、不压平换行', () => {
  const longLine = '长题干'.repeat(300);
  const question = '第一问：求导并写出单调区间。\n第二问：若 f(x)≥0 恒成立，求 a 的取值范围。\n' + longLine;
  const snippet = ai.mistakeSnippet({ question, answer: '解析正文', at: Date.now() }, { subject: '数学', knowledgePoints: ['导数与函数单调性'] });
  assert.match(snippet, /### 原题目/);
  assert.ok(snippet.includes('> 第一问：求导并写出单调区间。'));
  assert.ok(snippet.includes('> 第二问：若 f(x)≥0 恒成立，求 a 的取值范围。'));
  assert.ok(snippet.includes('> ' + longLine));
  assert.equal(ai.mistakeContentHasQuestion(snippet, question), true);
});

test('旧版压平成一行的原题也能被识别为已记录', () => {
  const question = '已知函数 f(x)=x²。\n求 f(2)。';
  const old = '**问**：' + question.replace(/\n+/g, ' ');
  assert.equal(ai.mistakeContentHasQuestion(old, question), true);
  assert.equal(ai.mistakeContentHasQuestion(old, '另一道完全不同的题'), false);
});

test('老师性格：自填讲课方式和四维滑杆都进入系统提示词', () => {
  const prompt = ai.buildTeacherPrompt({
    teacherProfile: '讲题前先反问我卡在哪一步，不要直接给答案。',
    teacherTraits: { lively: 10, detail: 90, guidance: 20, correction: 80 }
  });
  assert.match(prompt, /讲题前先反问我卡在哪一步/);
  assert.ok(prompt.includes('语气（活泼 ↔ 严厉）：10/100'));
  assert.ok(prompt.includes('讲解（简洁 ↔ 详细）：90/100'));
  assert.ok(prompt.includes('引导（启发 ↔ 直接）：20/100'));
  assert.ok(prompt.includes('纠错（鼓励 ↔ 严格）：80/100'));
  assert.match(prompt, /多提问引导/);
  assert.match(prompt, /严格指出错误/);
  const normalized = ai.normalizeTeacherTraits({ lively: 999, detail: -5 });
  assert.equal(normalized.lively, 100);
  assert.equal(normalized.detail, 0);
  assert.equal(normalized.guidance, ai.DEFAULT_TEACHER_TRAITS.guidance);
  assert.equal(normalized.correction, ai.DEFAULT_TEACHER_TRAITS.correction);
});

test('泛问靠答案文本也能识别数学，而不是落入其他', () => {
  const c = ai.classifyLocally('这题怎么做', '求导得 f(x)=2x，属于导数与函数单调性问题。');
  assert.equal(c.subject, '数学');
  assert.ok(c.knowledgePoints.some(x => /导数|函数/.test(x)));
});

test('知识点可直接当标签：清洗、去重、最多 5 个', () => {
  assert.deepEqual(ai.sanitizeKnowledgePoints(['导数', '#导数', '数列 递推', '', '点、线', 'a/b'], 5), ['导数', '数列-递推', '点线', 'a/b']);
  assert.equal(ai.sanitizeKnowledgePoints(['a1', 'b2', 'c3', 'd4', 'e5', 'f6']).length, 5, '最多保留 5 个');
  assert.deepEqual(ai.sanitizeKnowledgePoints([]), []);
  assert.equal(ai.MAX_KNOWLEDGE_POINTS, 5);
});

test('一道题多个知识点全部写进错题标签', () => {
  const snippet = ai.mistakeSnippet(
    { question: '求导后讨论数列单调性', answer: '解析', at: Date.now() },
    { subject: '数学', knowledgePoints: ['导数与函数单调性', '数列递推', '三角函数'] }
  );
  assert.match(snippet, /^\*\*知识点\*\*：#导数与函数单调性 #数列递推 #三角函数$/m);
  assert.match(snippet, /^## 导数与函数单调性 · \d{4}-\d{2}-\d{2}$/m);
});

test('本地兜底也能给出多个知识点', () => {
  const c = ai.classifyLocally('求导数并讨论数列的单调性与极值', '');
  assert.equal(c.subject, '数学');
  assert.ok(c.knowledgePoints.length >= 2, JSON.stringify(c.knowledgePoints));
  assert.ok(c.knowledgePoints.every(x => !/[\s#、，]/.test(x)), JSON.stringify(c.knowledgePoints));
});

test('错题类型归一：固定选项 + 关键词兜底', () => {
  assert.equal(ai.normalizeMistakeType('方法不会'), '方法不会');
  assert.equal(ai.normalizeMistakeType('思路不清，无从下手'), '方法不会');
  assert.equal(ai.normalizeMistakeType('算错了，粗心'), '计算失误');
  assert.equal(ai.normalizeMistakeType('看错题了'), '审题偏差');
  assert.equal(ai.normalizeMistakeType('公式记混'), '公式记错');
  assert.equal(ai.normalizeMistakeType('步骤不全'), '步骤遗漏');
  assert.equal(ai.normalizeMistakeType('定义理解错'), '概念不清');
  assert.equal(ai.normalizeMistakeType('莫名其妙'), '其他');
  assert.ok(ai.MISTAKE_TYPES.includes('方法不会'));
});

test('本地兜底也会给出错题类型', () => {
  const c = ai.classifyLocally('这题我算错了好几遍，总是粗心', '');
  assert.ok(ai.MISTAKE_TYPES.includes(c.mistakeType), JSON.stringify(c));
  assert.equal(ai.guessMistakeTypeLocally('看错条件了', ''), '审题偏差');
});

test('错题片段带上错题类型', () => {
  const snippet = ai.mistakeSnippet(
    { question: '求 f(x) 的单调区间', answer: '解析', at: Date.now() },
    { subject: '数学', knowledgePoints: ['导数与函数单调性'], mistakeType: '方法不会' }
  );
  assert.match(snippet, /^\*\*错题类型\*\*：方法不会$/m);
  assert.match(snippet, /^\*\*知识点\*\*：#导数与函数单调性$/m);
});
