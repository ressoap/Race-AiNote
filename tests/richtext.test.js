const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

const root = path.resolve(__dirname, '..');
const markdown = require(path.join(root, 'js', 'markdown.js'));
require(path.join(root, 'js', 'richtext.js'));
const richtext = global.RG.richtext;

const toMd = html => richtext.htmlToMarkdown(html);

test('内联格式：加粗 / 斜体 / 下划线 / 高亮', () => {
  assert.equal(toMd('<p>这是 <b>加粗</b> 和 <i>斜体</i></p>'), '这是 **加粗** 和 *斜体*');
  assert.equal(toMd('<p>有 <u>下划线</u> 与 <mark>高亮</mark></p>'), '有 <u>下划线</u> 与 <mark>高亮</mark>');
});

test('标题、列表、有序列表、引用、代码块', () => {
  assert.equal(toMd('<h2>小标题</h2>'), '## 小标题');
  assert.equal(toMd('<ul><li>一</li><li>二</li></ul>'), '- 一\n- 二');
  assert.equal(toMd('<ol><li>甲</li><li>乙</li></ol>'), '1. 甲\n2. 乙');
  assert.equal(toMd('<blockquote><p>引用</p></blockquote>'), '> 引用');
  assert.match(toMd('<pre>const a = 1;</pre>'), /^```\nconst a = 1;\n```$/);
});

test('任务列表往返', () => {
  const html = '<ul><li class="md-task"><span class="md-check"></span>待办</li><li class="md-task"><span class="md-check is-done">✓</span>已完成</li></ul>';
  const md = toMd(html);
  assert.match(md, /- \[ \] 待办/);
  assert.match(md, /- \[x\] 已完成/);
});

test('双链与标签从编辑器还原成 Markdown 语法', () => {
  assert.equal(toMd('<p>见 <span class="md-link" data-wikilink="导数及其应用">导数</span></p>'), '见 [[导数及其应用]]');
  assert.equal(toMd('<p>标签 <span class="md-tag">#数学</span></p>'), '标签 #数学');
});

test('Markdown → HTML → Markdown 往返基本稳定', () => {
  const source = '## 标题\n\n正文有 **重点** 和 [[双链]]。\n\n- 一\n- 二';
  const back = richtext.htmlToMarkdown(markdown.render(source));
  assert.match(back, /## 标题/);
  assert.match(back, /\*\*重点\*\*/);
  assert.match(back, /\[\[双链\]\]/);
  assert.match(back, /- 一/);
});

test('HTML 中的脚本标签不会被还原成可执行内容', () => {
  const md = toMd('<p>文本</p><script>alert(1)</script>');
  assert.ok(!md.includes('<script'));
});
