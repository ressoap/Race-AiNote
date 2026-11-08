#!/usr/bin/env node
/* 把 vault-example/ 里的真实 Markdown 打包成 js/demo-vault.js
   这样「示例库」和「可打开的示例文件夹」永远同一份内容，不会漂移。 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'vault-example');
const outFile = path.join(root, 'js', 'demo-vault.js');

const MD = /\.(md|markdown)$/i;
const ATTACH = /\.(png|jpe?g|gif|webp|svg|bmp|pdf|canvas|excalidraw)$/i;

function walk(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, rel, out);
    else if (MD.test(rel)) out.push({ path: rel, content: fs.readFileSync(full, 'utf8') });
    else if (ATTACH.test(rel)) out.push({ path: rel });
  }
  return out;
}

const files = walk(srcDir, '', []);
const noteCount = files.filter(f => MD.test(f.path)).length;
const attachmentCount = files.length - noteCount;

const header = [
  '/* ============================================================',
  '   demo-vault.js — 由 scripts/gen-demo.js 自动生成，请勿手工编辑。',
  '   数据源：vault-example/（真实 Markdown 文件）',
  '   生成时间：' + new Date().toISOString(),
  '   内容：' + noteCount + ' 篇笔记 + ' + attachmentCount + ' 个附件',
  '   ============================================================ */'
].join('\n');

const body = [
  '(function (root) {',
  "  'use strict';",
  '  const files = ' + JSON.stringify(files, null, 0) + ';',
  '  root.RG = root.RG || {};',
  "  root.RG.demoVault = { files: files, label: '示例库（内置 " + noteCount + ' 篇 + ' + attachmentCount + ' 附件）\' };',
  '})(typeof globalThis !== \'undefined\' ? globalThis : this);',
  ''
].join('\n');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, header + '\n' + body, 'utf8');
console.log('示例库已生成: js/demo-vault.js（' + noteCount + ' 篇笔记，' + attachmentCount + ' 个附件，' + (fs.statSync(outFile).size / 1024).toFixed(1) + ' KB）');
