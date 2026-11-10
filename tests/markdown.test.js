const test = require('node:test');
const assert = require('node:assert');
const md = require('../js/markdown.js');

test('标题、段落、加粗、行内代码', () => {
  const html = md.render('# 一级\n\n正文 **加粗** 与 `code`');
  assert.match(html, /<h2>一级<\/h2>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
});

test('无序列表与有序列表', () => {
  const html = md.render('- 一\n- 二\n\n1. 甲\n2. 乙');
  assert.match(html, /<ul>[\s\S]*<li>一<\/li>[\s\S]*<\/ul>/);
  assert.match(html, /<ol>[\s\S]*<li>甲<\/li>[\s\S]*<\/ol>/);
});

test('代码块内容被转义且不解析内部语法', () => {
  const html = md.render('```js\nconst a = "[[不算链接]]";\n```');
  assert.match(html, /<pre><code>/);
  assert.ok(html.includes('[[不算链接]]'), '代码块里应原样保留，不应变成 md-link');
  assert.ok(!html.includes('data-wikilink'));
});

test('双链渲染成可点击引用，别名优先显示', () => {
  const html = md.render('见 [[导数及其应用|导数]] 与 [[极限#定义]]');
  assert.match(html, /data-wikilink="导数及其应用">导数</);
  assert.match(html, /data-wikilink="极限">极限</);
});

test('正文标签渲染成 chip', () => {
  const html = md.render('这是 #数学/导数 标签');
  assert.match(html, /<span class="md-tag">#数学\/导数<\/span>/);
});

test('引用块', () => {
  const html = md.render('> 一句话引用');
  assert.match(html, /<blockquote>[\s\S]*一句话引用[\s\S]*<\/blockquote>/);
});

test('HTML 注入被转义（XSS 防护）', () => {
  const html = md.render('<img src=x onerror=alert(1)><script>alert(2)</script>');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/);
});

test('javascript: 伪协议不会被渲染成链接', () => {
  const html = md.render('[点我](javascript:alert(1))');
  assert.ok(!html.includes('href="javascript:'));
});

test('链接带 noopener', () => {
  const html = md.render('[官网](https://example.com)');
  assert.match(html, /rel="noopener noreferrer"/);
});

test('toText 去掉标记用于摘要', () => {
  const text = md.toText('# 标题\n\n见 [[双链|别名]] 与 [文本](https://a.b)');
  assert.ok(!text.includes('[['));
  assert.ok(!text.includes('#'));
  assert.ok(text.includes('别名'));
});

test('松散列表（项之间有空行）仍合并为一个列表', () => {
  const html = md.render('1. 单调性\n\n1. 极值\n\n1. 最值');
  assert.equal((html.match(/<ol/g) || []).length, 1, '不应拆成多个有序列表');
  assert.equal((html.match(/<li>/g) || []).length, 3);
});

test('有序列表保留起始编号', () => {
  const html = md.render('3. 三\n4. 四');
  assert.match(html, /<ol start="3">/);
});

test('空的列表项不会生成空 bullet', () => {
  const html = md.render('- 一\n-\n- 二');
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.ok(!html.includes('<p>-</p>'));
});

test('标题层级比正文高一级，便于和页面标题区分', () => {
  assert.match(md.render('# 一级'), /<h2>一级<\/h2>/);
  assert.match(md.render('## 二级'), /<h3>二级<\/h3>/);
});
