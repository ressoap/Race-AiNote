#!/usr/bin/env node
/* ============================================================
   build-exe.js — 用 Node 官方 SEA 把应用打成单文件 Windows exe
   产物：dist/Race-AiNote.exe（内置 Node 运行时 + 单文件页面）
   不需要目标机器装 Node，也不需要 Electron。
   用法：node scripts/build-exe.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const WORK = path.join(ROOT, '_tmp', 'sea');
const HTML = fs.readFileSync(path.join(OUT_DIR, 'Race-AiNote.html'), 'utf8');

fs.mkdirSync(WORK, { recursive: true });

/* 1) 把 ESM 版 serve.mjs 改写成 SEA 可用的一段 CJS 代码 */
let server = fs.readFileSync(path.join(ROOT, 'scripts', 'serve.mjs'), 'utf8');
server = server
  .replace(/^#!.*\n/, '')
  .replace(/^import .*$/gm, '')
  .replace(
    'const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), \'..\');',
    'const ROOT = APP_DIR;'
  );
server = server
  .replace("const DATA_DIR = path.join(ROOT, 'data');", "const DATA_DIR = path.join(EXE_DIR, 'data');");

/* 去掉 serve.mjs 自带的 server.listen，改由 exe 入口按端口重试启动 */
const listenIdx = server.indexOf('server.listen(PORT, () => {');
if (listenIdx >= 0) {
  const endIdx = server.indexOf('});', listenIdx);
  server = server.slice(0, listenIdx) + server.slice(endIdx + 3);
}

const entry = [
  '/* 由 scripts/build-exe.js 自动生成，请勿手改 */',
  "const http = require('node:http');",
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const os = require('node:os');",
  "const crypto = require('node:crypto');",
  "const { spawn } = require('node:child_process');",
  '',
  '/* 应用运行时目录：exe 同级 data 放记录，页面本身写进临时目录 */',
  'const EXE_DIR = path.dirname(process.execPath);',
  "const APP_DIR = path.join(os.tmpdir(), 'Race-AiNote-app');",
  'fs.mkdirSync(APP_DIR, { recursive: true });',
  'fs.mkdirSync(path.join(EXE_DIR, \'data\'), { recursive: true });',
  '',
  '/* 页面本体：单文件 HTML 内嵌在 exe 里 */',
  "const PAGE_HTML = Buffer.from('" + Buffer.from(HTML, 'utf8').toString('base64') + "', 'base64').toString('utf8');",
  "fs.writeFileSync(path.join(APP_DIR, 'index.html'), PAGE_HTML, 'utf8');",
  '',
  '/* 启动浏览器应用窗口 */',
  'function launchWindow(port) {',
  '  const candidates = [',
  '    process.env.RACE_BROWSER,',
  "    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',",
  "    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',",
  "    'C:/Program Files/Google/Chrome/Application/chrome.exe',",
  "    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'",
  '  ].filter(Boolean);',
  '  const browser = candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });',
  '  if (!browser) {',
  "    console.log('未找到 Edge/Chrome，请手动打开 http://127.0.0.1:' + port);",
  '    return null;',
  '  }',
  '  const profile = path.join(EXE_DIR, \'profile\');',
  '  fs.mkdirSync(profile, { recursive: true });',
  '  return spawn(browser, [',
  "    '--app=http://127.0.0.1:' + port + '/',",
  "    '--user-data-dir=' + profile,",
  "    '--window-size=1480,920',",
  "    '--no-first-run',",
  "    '--no-default-browser-check',",
  "    '--disable-features=Translate,MediaRouter'",
  '  ], { stdio: \'ignore\' });',
  '}',
  '',
  '/* ===== 以下为 serve.mjs 的服务器实现（构建时内联） ===== */',
  server,
  '',
  '/* ===== 启动：先用默认端口，占用则自动换端口 ===== */',
  'function boot(port, attempt) {',
  '  const handler = server.listeners ? null : null;',
  '  try {',
  '    server.listen(port, () => {',
  "      console.log('Race-AiNote 已启动: http://127.0.0.1:' + port);",
  "      console.log(API_KEY ? '模型模式：' + MODEL : 'AI 本地分析模式（未配置 COMMAND_CODE_API_KEY）');",
  "      const win = (process.argv.includes('--no-window') || process.env.RACE_NO_WINDOW) ? null : launchWindow(port);",
  '      if (win) win.on(\'exit\', () => { try { server.close(); } catch (_) {} process.exit(0); });',
  '    });',
  '    server.on(\'error\', err => {',
  "      if (err && err.code === 'EADDRINUSE' && attempt < 20) boot(port + 1, attempt + 1);",
  '      else { console.error(err); process.exit(1); }',
  '    });',
  '  } catch (err) {',
  '    console.error(err);',
  '    process.exit(1);',
  '  }',
  '}',
  '',
  'boot(Number(argOf(\'port\', process.env.PORT || 4399)), 0);',
  ''
].join('\n');

fs.writeFileSync(path.join(WORK, 'entry.js'), entry, 'utf8');
console.log('1/4 生成入口脚本 entry.js');

/* 2) 生成 SEA 配置并打包 */
const seaConfig = {
  main: path.join(WORK, 'entry.js'),
  output: path.join(WORK, 'app.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false
};
fs.writeFileSync(path.join(WORK, 'sea-config.json'), JSON.stringify(seaConfig, null, 2), 'utf8');
execFileSync(process.execPath, ['--experimental-sea-config', path.join(WORK, 'sea-config.json')], { stdio: 'inherit' });
console.log('2/4 生成 SEA blob');

/* 3) 复制 node 可执行文件作为宿主 */
const exePath = path.join(OUT_DIR, 'Race-AiNote.exe');
fs.copyFileSync(process.execPath, exePath);
console.log('3/4 复制 Node 运行时 → dist/Race-AiNote.exe');

/* 4) 注入 blob */
const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
execFileSync(process.execPath, [
  postject,
  exePath,
  'NODE_SEA_BLOB',
  path.join(WORK, 'app.blob'),
  '--sentinel-fuse', fuse
], { stdio: 'inherit' });
console.log('4/4 注入完成');

const size = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log('✅ 构建完成: dist/Race-AiNote.exe（' + size + ' MB，内置 Node 运行时）');
console.log('   双击即可启动；记录存在 exe 同级的 data/ 目录');
