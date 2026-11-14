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

/* ── 高级语法：任务 / 属性 / 小节 / 行 / 块 / 正则 flags ── */

const taskNote = {
  title: '复习计划',
  path: '40-复习/复习计划.md',
  content: '# 复习计划\n\n## 本周\n- [ ] 导数二轮\n- [x] 磁场错题\n\n本周重点：导数。\n',
  tags: ['复习'],
  frontmatter: { priority: 3, due: '2026-11-18', status: '' }
};

const plainNote = {
  title: '导数',
  path: '20-数学/导数.md',
  content: '导数定义就是切线斜率。\n没有任务。^welcome\n',
  tags: [],
  frontmatter: {}
};

test('任务查询：task: / task-todo: / task-done:', () => {
  assert.ok(q.matches(taskNote, 'task:'));
  assert.ok(q.matches(taskNote, 'task-todo:'));
  assert.ok(q.matches(taskNote, 'task-done:'));
  assert.ok(!q.matches(plainNote, 'task:'));
  assert.ok(!q.matches(plainNote, 'task-todo:'));
  assert.ok(!q.matches(taskNote, 'task-todo: -section:本周'), '排除当前小节后应无结果');
});

test('属性查询：存在 / 等于 / null / 比较', () => {
  assert.ok(q.matches(taskNote, '[priority]'));
  assert.ok(q.matches(taskNote, '[priority:3]'));
  assert.ok(q.matches(taskNote, '[priority:>2]'));
  assert.ok(!q.matches(taskNote, '[priority:<2]'));
  assert.ok(q.matches(taskNote, '[due:>=2026-11-01]'));
  assert.ok(q.matches(taskNote, '[status:null]'), '空字符串视为空值');
  assert.ok(!q.matches(plainNote, '[priority]'));
});

test('小节查询：标题或该小节正文', () => {
  assert.ok(q.matches(taskNote, 'section:本周'), '标题命中');
  assert.ok(q.matches(taskNote, 'section:磁场'), '小节正文命中');
  assert.ok(!q.matches(plainNote, 'section:本周'));
});

test('按行查询：同一行内出现所有词', () => {
  assert.ok(q.matches(taskNote, 'line:导数 二轮'));
  assert.ok(!q.matches(taskNote, 'line:导数 不存在'));
});

test('块引用查询：^blockid', () => {
  assert.ok(q.matches(plainNote, 'block:welcome'));
  assert.ok(!q.matches(plainNote, 'block:nope'));
});

test('正则支持 flags，且默认忽略大小写', () => {
  assert.ok(q.matches(plainNote, '/切线斜率/i'));
  assert.ok(q.matches(plainNote, '/切线斜./'));
  assert.ok(!q.matches(plainNote, '/^切线/'), '带 ^ 的正则不应命中中间位置');
  assert.ok(!q.matches(plainNote, '/[unclosed/'), '非法正则安全降级');
});
