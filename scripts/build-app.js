#!/usr/bin/env node
/* ============================================================
   build-app.js — 把 js/app/*.js 片段拼成 js/app.js
   为什么这样做：
   app.js 原先是一个 2600+ 行的 IIFE，所有 UI 功能共享同一闭包。
   纯搬运到多个片段可以先把文件变小，同时保持原有闭包语义不变；
   片段按文件名排序，运行时仍是同一份 app.js，测试与单文件构建无需改。
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'js', 'app');
const OUT_FILE = path.join(ROOT, 'js', 'app.js');
const HEADER = [
  '/* 自动生成：源文件在 js/app/*.js，由 scripts/build-app.js 按文件名顺序拼接。 */',
  '/* 不要直接改本文件；改完片段后运行 npm run build:app。 */',
  '(function () {',
  "  'use strict';",
  '',
  ''
].join('\n');
const FOOTER = '\n})();\n';

function fragments() {
  return fs.readdirSync(SRC_DIR).filter(name => name.endsWith('.js')).sort();
}

function buildApp() {
  const files = fragments();
  if (!files.length) throw new Error('js/app/ 下没有可拼接的片段');
  const body = files
    .map(name => fs.readFileSync(path.join(SRC_DIR, name), 'utf8').replace(/\s+$/, ''))
    .join('\n\n');
  return HEADER + body + FOOTER;
}

function writeApp() {
  const next = buildApp();
  fs.writeFileSync(OUT_FILE, next, 'utf8');
  return next;
}

function main() {
  const check = process.argv.includes('--check');
  const next = buildApp();
  if (check) {
    const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
    if (next !== current) {
      console.error('js/app.js 与 js/app/*.js 不同步，请运行 npm run build:app');
      process.exit(1);
    }
    console.log('js/app.js 已与片段同步');
    return;
  }
  writeApp();
  console.log('已生成 js/app.js（' + next.split('\n').length + ' 行，片段 ' + fragments().length + ' 个）');
}

if (require.main === module) main();
module.exports = { buildApp, writeApp };
