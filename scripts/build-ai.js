#!/usr/bin/env node
/* ============================================================
   build-ai.js — 把 js/ai/*.js 片段拼成 js/ai.js
   与 build-app.js 同样的策略：先按功能拆源码，运行时仍是同一个 IIFE，
   不改变闭包语义，测试和单文件构建无需改动。
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'js', 'ai');
const OUT_FILE = path.join(ROOT, 'js', 'ai.js');
const HEADER = [
  '/* 自动生成：源文件在 js/ai/*.js，由 scripts/build-ai.js 按文件名顺序拼接。 */',
  '/* 不要直接改本文件；改完片段后运行 npm run build:ai。 */',
  '(function (root) {',
  "  'use strict';",
  '',
  ''
].join('\n');
const FOOTER = "\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n";

function fragments() {
  return fs.readdirSync(SRC_DIR).filter(name => name.endsWith('.js')).sort();
}

function buildAi() {
  const files = fragments();
  if (!files.length) throw new Error('js/ai/ 下没有可拼接的片段');
  const body = files
    .map(name => fs.readFileSync(path.join(SRC_DIR, name), 'utf8').replace(/\s+$/, ''))
    .join('\n\n');
  return HEADER + body + FOOTER;
}

function writeAi() {
  const next = buildAi();
  fs.writeFileSync(OUT_FILE, next, 'utf8');
  return next;
}

function main() {
  const check = process.argv.includes('--check');
  const next = buildAi();
  if (check) {
    const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
    if (next !== current) {
      console.error('js/ai.js 与 js/ai/*.js 不同步，请运行 npm run build:ai');
      process.exit(1);
    }
    console.log('js/ai.js 已与片段同步');
    return;
  }
  writeAi();
  console.log('已生成 js/ai.js（' + next.split('\n').length + ' 行，片段 ' + fragments().length + ' 个）');
}

if (require.main === module) main();
module.exports = { buildAi, writeAi };
