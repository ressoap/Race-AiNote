const test = require('node:test');
const assert = require('node:assert');
const vault = require('../js/vault.js');

test('frontmatter: 标量、行内数组、块数组', () => {
  const fm = vault.parseFrontmatter(`---
title: 导数笔记
tags: [数学, 导数]
aliases:
  - 求导
  - derivative
---
正文 [[极限]]
`);
  assert.equal(fm.data.title, '导数笔记');
  assert.deepEqual(fm.data.tags, ['数学', '导数']);
  assert.deepEqual(fm.data.aliases, ['求导', 'derivative']);
  assert.ok(fm.body.trim().startsWith('正文'));
});

test('frontmatter: 缺失时原样返回', () => {
  const fm = vault.parseFrontmatter('# 没有 frontmatter');
  assert.deepEqual(fm.data, {});
  assert.equal(fm.body, '# 没有 frontmatter');
});

test('extractLinks: 别名、标题锚点、嵌入、外链跳过', () => {
  const links = vault.extractLinks(`
见 [[极限与连续|极限]]
见 [[函数单调性#定义]]
嵌入 ![[示意图.png]]
外链 [[https://example.com]] 不算
`);
  assert.equal(links.length, 3);
  assert.deepEqual(links[0], { target: '极限与连续', alias: '极限', heading: null, embed: false });
  assert.equal(links[1].heading, '定义');
  assert.equal(links[2].embed, true);
});

test('extractLinks: 代码块与行内代码中的双链不算', () => {
  const links = vault.extractLinks([
    '```js',
    'const x = "[[不该出现]]";',
    '```',
    '行内 `[[也不算]]` 结束',
    '真链接 [[有效]]'
  ].join('\n'));
  assert.equal(links.length, 1);
  assert.equal(links[0].target, '有效');
});

test('extractTags: 行内标签、嵌套标签，排除标题与 URL 锚点', () => {
  const tags = vault.extractTags([
    '# 一级标题不算标签',
    '正文 #数学 #数学/导数 记录',
    '链接 https://a.com/page#section 不算',
    '```',
    '#代码块里不算',
    '```'
  ].join('\n'));
  assert.deepEqual(tags.sort(), ['数学', '数学/导数'].sort());
});

test('summarize: 去掉标题与链接语法后截断', () => {
  const s = vault.summarize('# 标题\n\n这是 [[目标|别名]] 与 [文本](http://a.b) 的摘要。', 12);
  assert.ok(!s.includes('[['));
  assert.ok(!s.startsWith('#'));
  assert.ok(s.endsWith('…'));
});

test('buildVault: 双链解析、标签节点、未创建链接、附件', () => {
  const graph = vault.buildVault([
    { path: '00-导航/驾驶舱.md', content: '---\ntitle: 驾驶舱\n---\n去 [[错题本]] 和 [[不存在]]' },
    { path: '10-错题本/错题本.md', content: '回到 [[驾驶舱]] 并 #复习' },
    { path: 'attachments/示意图.png' }
  ]);
  assert.equal(graph.stats.notes, 2);
  assert.equal(graph.stats.attachments, 1);
  assert.equal(graph.stats.unresolved, 1);
  assert.equal(graph.stats.tags, 1);
  const ids = graph.nodes.map(n => n.id);
  assert.ok(ids.includes('00-导航/驾驶舱'));
  assert.ok(ids.includes('tag:复习'));
  assert.ok(ids.includes('unresolved:不存在'));
  assert.equal(graph.stats.orphans, 1, '附件没有被引用，应为孤立节点');
});

test('buildVault: 别名与多级路径可解析', () => {
  const graph = vault.buildVault([
    { path: 'a/导数.md', content: '---\naliases: [求导]\n---\n正文' },
    { path: 'b/引用.md', content: '见 [[求导]] 与 [[a/导数]] 与 [[导数]]' }
  ]);
  const targets = graph.links.filter(l => l.source === 'b/引用').map(l => l.target);
  assert.deepEqual([...new Set(targets)], ['a/导数']);
});

test('buildVault: 自链接与重复链接被去重', () => {
  const graph = vault.buildVault([
    { path: 'a.md', content: '自链 [[a]] 重复 [[b]] [[b]]' },
    { path: 'b.md', content: '回 [[a]]' }
  ]);
  assert.equal(graph.links.filter(l => l.kind === 'link').length, 2);
});

test('buildVault: 关闭标签/附件/未创建链接的选项生效', () => {
  const files = [
    { path: 'a.md', content: '见 [[不存在]] #标签' },
    { path: 'x.png' }
  ];
  const graph = vault.buildVault(files, { includeTags: false, includeAttachments: false, includeUnresolved: false });
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.links.length, 0);
  assert.equal(graph.stats.orphans, 1);
});

test('buildVault: 度数与 mtime 正确', () => {
  const graph = vault.buildVault([
    { path: 'a.md', content: '[[b]]', mtime: 111 },
    { path: 'b.md', content: '[[a]]', mtime: 222 }
  ], { includeTags: false });
  const a = graph.nodes.find(n => n.id === 'a');
  assert.equal(a.degree, 2, "双向各计一次，度数应为 2");
  assert.equal(a.mtime, 111);
  assert.equal(graph.notes.find(n => n.id === 'b').mtime, 222);
});
