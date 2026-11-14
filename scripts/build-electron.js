#!/usr/bin/env node
/* ============================================================
   build-electron.js — 打包成 Electron 桌面应用
   Electron 就是 Obsidian 用的同款技术栈（Chromium + Node），
   这里是「同款架构」，不是 Obsidian 的闭源内核。

   产物：dist/Race-AiNote-Electron/Race-AiNote.exe
   用法：node scripts/build-electron.js
   （需要本机已有 Electron 运行时，见 README 说明）
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'Race-AiNote-Electron');
const APP = path.join(OUT, 'resources', 'app');
const ELECTRON_SRC = process.env.ELECTRON_DIR || path.join(ROOT, '_tmp', 'electron');
const HTML = fs.readFileSync(path.join(ROOT, 'dist', 'Race-AiNote.html'), 'utf8');

if (!fs.existsSync(path.join(ELECTRON_SRC, 'electron.exe'))) {
  console.error('没找到 Electron 运行时。请把 Electron 解压到 _tmp/electron，或用 ELECTRON_DIR 指定目录。');
  process.exit(1);
}

/* 1) 目录 */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

/* 2) 复用 serve.mjs：转成 CJS 并暴露 start() */
let server = fs.readFileSync(path.join(ROOT, 'scripts', 'serve.mjs'), 'utf8');
server = server
  .replace(/^#!.*\n/, '')
  .replace(/^import .*$/gm, '')
  .replace(
    "const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');",
    "const ROOT = __dirname;"
  )
  .replace("const DATA_DIR = path.join(ROOT, 'data');", "const DATA_DIR = path.join(__dirname, 'app-data', 'records');");

const listenIdx = server.indexOf('server.listen(PORT, () => {');
if (listenIdx >= 0) {
  const endIdx = server.indexOf('});', listenIdx);
  server = server.slice(0, listenIdx) + server.slice(endIdx + 3);
}

const serverFile = [
  '/* 由 scripts/build-electron.js 生成 */',
  "const http = require('node:http');",
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const crypto = require('node:crypto');",
  "const __APPDIR = path.join(__dirname, 'app-data');",
  "fs.mkdirSync(path.join(__APPDIR, 'records'), { recursive: true });",
  '',
  server,
  '',
  'module.exports = {',
  '  start(port) {',
  '    return new Promise(function (resolve, reject) {',
  '      const onError = function (err) {',
  '        if (err && err.code === \'EADDRINUSE\') {',
  '          server.removeListener(\'error\', onError);',
  '          server.close();',
  '          resolve(module.exports.start(port + 1));',
  '        } else {',
  '          reject(err);',
  '        }',
  '      };',
  '      server.once(\'error\', onError);',
  '      server.listen(port, function () { resolve(server.address().port); });',
  '    });',
  '  },',
  '  PORT',
  '};',
  ''
].join('\n');
fs.writeFileSync(path.join(APP, 'server.js'), serverFile, 'utf8');

/* 3) 页面本体 */
fs.writeFileSync(path.join(APP, 'index.html'), HTML, 'utf8');

/* 4) Electron 主进程 */
const main = [
  'const { app, BrowserWindow, Menu, shell } = require(\'electron\');',
  'const path = require(\'node:path\');',
  'const fs = require(\'node:fs\');',
  'const server = require(\'./server.js\');',
  '',
  'let win = null;',
  '',
  'function createWindow(port) {',
  '  win = new BrowserWindow({',
  '    width: 1480,',
  '    height: 920,',
  '    minWidth: 900,',
  '    minHeight: 600,',
  '    backgroundColor: \'#fbfbfd\',',
  '    autoHideMenuBar: true,',
  '    title: \'Race-AiNote\',',
  '    webPreferences: {',
  '      contextIsolation: true,',
  '      nodeIntegration: false,',
  '      spellcheck: false',
  '    }',
  '  });',
  '  win.loadURL(\'http://127.0.0.1:\' + port + \'/\');',
  '  win.on(\'closed\', function () { win = null; });',
  '  // 外链交给系统浏览器，不在应用内开',
  '  win.webContents.setWindowOpenHandler(function (details) {',
  '    shell.openExternal(details.url);',
  '    return { action: \'deny\' };',
  '  });',
  '}',
  '',
  'app.whenReady().then(async function () {',
  '  const port = await server.start(4399);',
  '  createWindow(port);',
  '  app.on(\'activate\', function () { if (!win) createWindow(port); });',
  '});',
  '',
  'app.on(\'window-all-closed\', function () { app.quit(); });',
  ''
].join('\n');
fs.writeFileSync(path.join(APP, 'main.js'), main, 'utf8');

fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({
  name: 'race-ainote',
  productName: 'Race-AiNote',
  version: '1.0.0',
  main: 'main.js',
  description: 'AI 笔记工作台（Electron 桌面版）'
}, null, 2), 'utf8');

/* 5) 复制 Electron 运行时（排除默认 app） */
const files = fs.readdirSync(ELECTRON_SRC);
for (const name of files) {
  if (name === 'resources') continue;
  const from = path.join(ELECTRON_SRC, name);
  const to = path.join(OUT, name);
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
  } else {
    fs.copyFileSync(from, to);
  }
}

/* 6) 保留 Electron 自带的资源（避免缺 dll/pak），但去掉默认的 resources/app */
const resSrc = path.join(ELECTRON_SRC, 'resources');
if (fs.existsSync(resSrc)) {
  for (const name of fs.readdirSync(resSrc)) {
    if (name === 'app') continue;
    const from = path.join(resSrc, name);
    const to = path.join(OUT, 'resources', name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
}

/* 7) 把 electron.exe 改成应用名 */
const exeFrom = path.join(OUT, 'electron.exe');
const exeTo = path.join(OUT, 'Race-AiNote.exe');
if (fs.existsSync(exeFrom)) fs.renameSync(exeFrom, exeTo);

const size = (fs.statSync(exeTo).size / 1024 / 1024).toFixed(1);
const total = execFileSync('powershell', ['-NoProfile', '-Command',
  "(Get-ChildItem -Recurse '" + OUT.replace(/'/g, "''") + "' | Measure-Object -Property Length -Sum).Sum"
]).toString().trim();
console.log('✅ Electron 版本就绪: dist/Race-AiNote-Electron/');
console.log('   主程序: Race-AiNote.exe（' + size + ' MB）');
console.log('   整包大小: ' + (Number(total) / 1024 / 1024).toFixed(0) + ' MB');
console.log('   双击 Race-AiNote.exe 即可启动；数据在 resources/app/app-data/');
