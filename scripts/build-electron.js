#!/usr/bin/env node
/* ============================================================
   build-electron.js — 打包成 Electron 桌面应用
   Electron 就是 Obsidian 用的同款技术栈（Chromium + Node），
   这里是「同款架构」，不是 Obsidian 的闭源内核。

   产物：dist/Wenmo-Notes-Electron/Wenmo-Notes.exe
   用法：node scripts/build-electron.js
   （需要本机已有 Electron 运行时，见 README 说明）
   只更新 resources/app、不碰运行时和用户数据：加 --app-only
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { patchExeIcon } = require('./patch-exe-icon.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'Wenmo-Notes-Electron');
const APP = path.join(OUT, 'resources', 'app');
const ELECTRON_SRC = process.env.ELECTRON_DIR || path.join(ROOT, '_tmp', 'electron');
const HTML = fs.readFileSync(path.join(ROOT, 'dist', 'Wenmo-Notes.html'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'scripts', 'server-core.cjs'), 'utf8');
const ICON = path.join(ROOT, 'assets', 'wenmo-icon.ico');
const APP_ONLY = process.argv.includes('--app-only') || process.env.ELECTRON_APP_ONLY === '1';

if (!APP_ONLY && !fs.existsSync(path.join(ELECTRON_SRC, 'electron.exe'))) {
  console.error('没找到 Electron 运行时。请把 Electron 解压到 _tmp/electron，或用 ELECTRON_DIR 指定目录。');
  process.exit(1);
}

/* 1) 目录：完整构建会重建整包；--app-only 只替换页面代码，保留 app-data */
if (APP_ONLY) {
  fs.mkdirSync(APP, { recursive: true });
  for (const name of fs.readdirSync(APP)) {
    if (name === 'app-data') continue;
    fs.rmSync(path.join(APP, name), { recursive: true, force: true });
  }
} else {
  if (fs.existsSync(path.join(APP, 'app-data')) && !process.argv.includes('--force')) {
    console.error('检测到 resources/app/app-data 可能含本地记录；请先备份，或确认后加 --force。');
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });
}

/* 2) 服务端：复制唯一一份 core，再写一个薄启动器 */
fs.writeFileSync(path.join(APP, 'server-core.cjs'), CORE, 'utf8');
fs.writeFileSync(path.join(APP, 'server.js'), [
  '/* 由 scripts/build-electron.js 生成：薄启动器，业务逻辑在 server-core.cjs */',
  "const path = require('node:path');",
  "const os = require('node:os');",
  "const { createAppServer, loadDotEnv } = require('./server-core.cjs');",
  "loadDotEnv(path.dirname(process.execPath));",
  'module.exports = {',
  '  start(port, host) {',
  "    const dataDir = process.env.WENMO_DATA_DIR || process.env.RACE_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'Wenmo-Notes', 'data');",
  "    const app = createAppServer({ root: __dirname, dataDir: dataDir });",
  '    return new Promise(function (resolve, reject) {',
  '      const onError = function (err) {',
  "        if (err && err.code === 'EADDRINUSE') {",
  "          app.server.removeListener('error', onError);",
  '          try { app.server.close(); } catch (_) {}',
  '          resolve(module.exports.start(port + 1, host));',
  '        } else {',
  '          reject(err);',
  '        }',
  '      };',
  "      app.server.once('error', onError);",
  "      app.server.listen(port, host || '127.0.0.1', function () {",
  "        app.server.removeListener('error', onError);",
  '        resolve(app.server.address().port);',
  '      });',
  '    });',
  '  }',
  '};',
  ''
].join('\n'), 'utf8');

/* 3) 页面本体与图标 */
fs.writeFileSync(path.join(APP, 'index.html'), HTML, 'utf8');
if (fs.existsSync(ICON)) fs.copyFileSync(ICON, path.join(APP, 'icon.ico'));

/* 4) Electron 主进程 */
const main = [
  "const { app, BrowserWindow, Menu, shell } = require('electron');",
  "const path = require('node:path');",
  "const fs = require('node:fs');",
  "const os = require('node:os');",
  "const server = require('./server.js');",
  "app.setAppUserModelId('com.ressoap.wenmo-notes');",
  '',
  '/* 兼容旧版：记录可能在资源目录或旧 AppData 路径，先迁到新目录 */',
  'try {',
  "  const appData = process.env.APPDATA || os.homedir();",
  "  const dataRoot = process.env.WENMO_DATA_DIR || process.env.RACE_DATA_DIR || path.join(appData, 'Wenmo-Notes', 'data');",
  "  const legacyDirs = [",
  "    path.join(appData, 'Race-AiNote', 'data'),",
  "    path.join(__dirname, 'app-data'),",
  "    path.join(__dirname, '..', '..', '..', 'Race-AiNote-Electron', 'resources', 'app', 'app-data')",
  '  ];',
  "  const targetRecords = path.join(dataRoot, 'records.json');",
  '  if (!fs.existsSync(targetRecords)) {',
  '    for (const legacy of legacyDirs) {',
  "      const flat = path.join(legacy, 'records.json');",
  "      const nested = path.join(legacy, 'records', 'records.json');",
  '      const source = fs.existsSync(flat) ? flat : (fs.existsSync(nested) ? nested : null);',
  '      if (source) {',
  '        fs.mkdirSync(dataRoot, { recursive: true });',
  '        fs.copyFileSync(source, targetRecords);',
  '        break;',
  '      }',
  '    }',
  '  }',
  '} catch (_) {}',
  '',
  '/* 显式保留旧 userData 路径：Electron 的 localStorage 里有笔记/设置，不能因改名丢失 */',
  'try {',
  "  const oldUserData = path.join(process.env.APPDATA || os.homedir(), 'Race-AiNote');",
  '  fs.mkdirSync(oldUserData, { recursive: true });',
  "  app.setName('问墨笔记');",
  "  app.setPath('userData', oldUserData);",
  '} catch (_) {}',
  '',
  'let win = null;',
  '',
  'function createWindow(port) {',
  '  win = new BrowserWindow({',
  '    width: 1480,',
  '    height: 920,',
  '    minWidth: 900,',
  '    minHeight: 600,',
  "    backgroundColor: '#fbfbfd',",
  '    autoHideMenuBar: true,',
  "    title: '问墨笔记',",
  "    icon: path.join(__dirname, 'icon.ico'),",
  '    webPreferences: {',
  '      contextIsolation: true,',
  '      nodeIntegration: false,',
  '      spellcheck: false',
  '    }',
  '  });',
  "  win.loadURL('http://127.0.0.1:' + port + '/');",
  '  win.on(\'closed\', function () { win = null; });',
  '  win.webContents.setWindowOpenHandler(function (details) {',
  '    shell.openExternal(details.url);',
  "    return { action: 'deny' };",
  '  });',
  '}',
  '',
  'app.whenReady().then(async function () {',
  "  const port = await server.start(4399, '127.0.0.1');",
  '  createWindow(port);',
  '  app.on(\'activate\', function () { if (!win) createWindow(port); });',
  '});',
  '',
  "app.on('window-all-closed', function () { app.quit(); });",
  ''
].join('\n');
fs.writeFileSync(path.join(APP, 'main.js'), main, 'utf8');

fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({
  name: 'wenmo-notes',
  productName: '问墨笔记',
  version: '1.0.0',
  main: 'main.js',
  description: '问墨笔记 · 会回答的本地 AI 笔记本（Electron 桌面版）'
}, null, 2), 'utf8');

if (APP_ONLY) {
  const appOnlyExe = path.join(OUT, 'Wenmo-Notes.exe');
  try {
    if (fs.existsSync(appOnlyExe) && patchExeIcon(appOnlyExe, ICON)) {
      console.log('   已更新主程序图标: Wenmo-Notes.exe');
    }
  } catch (_) {
    console.log('   主程序正在运行，图标将在关闭后下次更新');
  }
  console.log('✅ Electron 应用代码已更新（仅 resources/app，未动运行时和用户数据）');
  console.log('   下次启动 Wenmo-Notes.exe 生效；数据在 %APPDATA%/Wenmo-Notes/data');
  process.exit(0);
}

/* 5) 复制 Electron 运行时（排除默认 app） */
const files = fs.readdirSync(ELECTRON_SRC);
for (const name of files) {
  if (name === 'resources') continue;
  const from = path.join(ELECTRON_SRC, name);
  const to = path.join(OUT, name);
  const stat = fs.statSync(from);
  if (stat.isDirectory()) fs.cpSync(from, to, { recursive: true });
  else fs.copyFileSync(from, to);
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
const exeTo = path.join(OUT, 'Wenmo-Notes.exe');
if (fs.existsSync(exeFrom)) fs.renameSync(exeFrom, exeTo);
try {
  if (fs.existsSync(exeTo) && patchExeIcon(exeTo, ICON)) console.log('   已写入应用图标: assets/wenmo-icon.ico');
} catch (err) {
  console.warn('   图标写入失败（不影响程序运行）: ' + (err && err.message ? err.message : err));
}

const size = (fs.statSync(exeTo).size / 1024 / 1024).toFixed(1);
const total = execFileSync('powershell', ['-NoProfile', '-Command',
  "(Get-ChildItem -Recurse '" + OUT.replace(/'/g, "''") + "' | Measure-Object -Property Length -Sum).Sum"
]).toString().trim();
console.log('✅ Electron 版本就绪: dist/Wenmo-Notes-Electron/');
console.log('   主程序: Wenmo-Notes.exe（' + size + ' MB）');
console.log('   整包大小: ' + (Number(total) / 1024 / 1024).toFixed(0) + ' MB');
console.log('   双击 Wenmo-Notes.exe 即可启动；数据在 %APPDATA%/Wenmo-Notes/data');
