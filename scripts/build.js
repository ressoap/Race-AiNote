#!/usr/bin/env node
/* 把 index.html + styles.css + js/*.js 内联成单个 HTML，产出 dist/ */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

// 内联样式
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => {
  const css = read(href).replace(/<\/style>/gi, '<\/style>');
  return '<style>\n' + css + '\n</style>';
});

// 内联脚本（保持原顺序）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const js = read(src).replace(/<\/script>/gi, '<\/script>');
  return '<script>\n' + js + '\n</script>';
});

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'Race-AiNote.html');
fs.writeFileSync(outFile, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
const leftover = /(<link rel="stylesheet"|<script src=)/.test(html);
console.log('构建完成: dist/Race-AiNote.html  ' + kb + ' KB' + (leftover ? '  ⚠ 仍有外部引用' : ''));
process.exit(leftover ? 1 : 0);
