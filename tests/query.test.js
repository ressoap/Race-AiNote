const test = require('node:test');
const assert = require('node:assert');
const q = require('../js/query.js');

const node = {
  title: '导数及其应用',
  path: '20-知识卡/导数及其应用.md',
  content: '切线问题与函数单调性，注意定义域。',
  tags: ['导数', '数学']
};

const other = {
  title: '极限与连续',
  path: '20-知识卡/极限与连续.md',
  content: '等价无穷小替换的条件。',
  tags: ['极限', '数学']
};

test('空查询与空白查询命中所有节点', () => {
  assert.equal(q.matches(node, ''), true);
  assert.equal(q.matches(node, '   '), true);
  assert.equal(q.matches(node, null), true);
});

test('普通文本命中标题、路径、正文、标签', () => {
  assert.ok(q.matches(node, '导数'));
  assert.ok(q.matches(node, '知识卡'));
  assert.ok(q.matches(node, '切线'));
  assert.ok(q.matches(node, '#数学'));
});

test('操作符：path / file / tag / content 各自限定范围', () => {
  assert.ok(q.matches(node, 'path:知识卡'));
  assert.ok(!q.matches(node, 'path:极限'));
  assert.ok(q.matches(node, 'file:导数'));
  assert.ok(!q.matches(node, 'file:极限'));
  assert.ok(q.matches(node, 'tag:数学'));
  assert.ok(q.matches(node, 'tag:#数学'));
  assert.ok(!q.matches(node, 'tag:极限'));
  assert.ok(q.matches(node, 'content:单调性'));
  assert.ok(!q.matches(node, 'content:知识卡'));
});

test('排除语法 - 与前缀组合', () => {
  assert.ok(q.matches(node, '-tag:极限'));
  assert.ok(!q.matches(node, '-tag:数学'));
  assert.ok(q.matches(node, 'tag:数学 -content:极限'));
  assert.ok(!q.matches(node, 'tag:数学 -content:切线'));
});

test('OR 分组：任一组全中即命中', () => {
  assert.ok(q.matches(other, '导数 OR 极限'));
  assert.ok(q.matches(node, '导数 OR 极限'));
  assert.ok(!q.matches(node, 'file:极限 OR tag:化学'));
  assert.ok(q.matches(other, 'file:极限 OR tag:化学'));
});

test('引号内含空格作为整体', () => {
  assert.ok(q.matches(node, '"切线问题与函数"'));
  assert.ok(!q.matches(other, '"切线问题与函数"'));
});

test('正则搜索', () => {
  assert.ok(q.matches(node, '/^导数/'));
  assert.ok(q.matches(node, 'file:/导数.*应用/'));
  assert.ok(!q.matches(node, '/^极限/'));
  assert.ok(q.matches(node, 'tag:/^数/'));
  assert.ok(q.matches(node, 'content:/切.问题/'));
});

test('非法正则不抛出，安全降级', () => {
  assert.doesNotThrow(() => q.matches(node, '/[unclosed/'));
});

test('describe 输出结构化摘要', () => {
  const d = q.describe('path:知识卡 -tag:数学 OR 导数');
  assert.equal(d.length, 2);
  assert.equal(d[0][0].operator, 'path');
  assert.equal(d[0][1].negated, true);
  assert.equal(d[1][0].value, '导数');
});
