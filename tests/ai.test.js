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
