#!/usr/bin/env node
/* ============================================================
   build-exe.js — 用 Node 官方 SEA 把应用打成单文件 Windows exe
   产物：dist/Wenmo-Notes.exe（内置 Node 运行时 + 单文件页面）
   不需要目标机器装 Node，也不需要 Electron。
   用法：node scripts/build-exe.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { patchExeIcon } = require('./patch-exe-icon.js');
const { setGuiSubsystem } = require('./patch-exe-subsystem.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const WORK = path.join(ROOT, '_tmp', 'sea');
const HTML = fs.readFileSync(path.join(OUT_DIR, 'Wenmo-Notes.html'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'scripts', 'server-core.cjs'), 'utf8');
const ICON = path.join(ROOT, 'assets', 'wenmo-icon.ico');

fs.mkdirSync(WORK, { recursive: true });

/* argOf 必须在 boot 之前可用：把启动器包裹进函数，避免变量提前求值 */
const wrapped = [
  '/* 由 scripts/build-exe.js 自动生成：server-core.cjs + SEA 启动器，请勿手改 */',
  CORE,
  '',
  '/* ===== 以下为 SEA 启动器 ===== */',
  "const os = require('node:os');",
  "const { spawn } = require('node:child_process');",
  "const startCore = module.exports.createAppServer;",
  "const loadEnv = module.exports.loadDotEnv;",
  'function argOf(name, def) {',
  '  const argv = process.argv.slice(2);',
  "  const i = argv.indexOf('--' + name);",
  '  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;',
  '}',
  'const EXE_DIR = path.dirname(process.execPath);',
  "const APP_DIR = path.join(os.tmpdir(), 'Wenmo-Notes-app');",
  'fs.mkdirSync(APP_DIR, { recursive: true });',
  "fs.mkdirSync(path.join(EXE_DIR, 'data'), { recursive: true });",
  'const PAGE_HTML = Buffer.from(' + JSON.stringify(Buffer.from(HTML, 'utf8').toString('base64')) + ", 'base64').toString('utf8');",
  "fs.writeFileSync(path.join(APP_DIR, 'index.html'), PAGE_HTML, 'utf8');",
  'loadEnv(EXE_DIR);',
  '',
  "const LOG_FILE = path.join(EXE_DIR, 'data', 'startup.log');",
  'function logLine(text) {',
  '  try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + " " + text + "\\n"); } catch (_) {}',
  '}',
  '',
  'function launchWindow(port) {',
  '  const candidates = [',
  '    process.env.WENMO_BROWSER || process.env.RACE_BROWSER,',
  "    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',",
  "    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',",
  "    'C:/Program Files/Google/Chrome/Application/chrome.exe',",
  "    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'",
  '  ].filter(Boolean);',
  '  const browser = candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });',
  '  if (!browser) {',
  "    console.log('未找到 Edge/Chrome，尝试用系统默认浏览器打开 http://127.0.0.1:' + port);",
  "    logLine('未找到 Edge/Chrome，尝试默认浏览器: http://127.0.0.1:' + port);",
  '    try {',
  "      const fallback = spawn('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:' + port + '/'], { stdio: 'ignore', windowsHide: true, detached: true });",
  '      fallback.unref();',
  '    } catch (_) {}',
  '    return null;',
  '  }',
  "  const profile = process.env.WENMO_PROFILE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'Wenmo-Notes', 'browser-profile');",
  '  fs.mkdirSync(profile, { recursive: true });',
  '  return spawn(browser, [',
  "    '--app=http://127.0.0.1:' + port + '/',",
  "    '--user-data-dir=' + profile,",
  "    '--window-size=1480,920',",
  "    '--no-first-run',",
  "    '--no-default-browser-check',",
  "    '--disable-features=Translate,MediaRouter'",
  "  ], { stdio: 'ignore', windowsHide: true });",
  '}',
  '',
  '/* 检查某个端口是不是已经运行的问墨笔记，避免重复启动第二个服务。 */',
  'async function isOurApp(port) {',
  '  try {',
  "    const res = await fetch('http://127.0.0.1:' + port + '/', {",
  "      headers: { 'Cache-Control': 'no-store' },",
  '      signal: AbortSignal.timeout(900)',
  '    });',
  '    if (!res.ok) return false;',
  '    const html = await res.text();',
  "    return html.indexOf('<title>问墨笔记 · AI 笔记</title>') >= 0;",
  '  } catch (_) { return false; }',
  '}',
  '',
  '/* 默认从 4399 起找已运行实例；旧版可能因端口占用落到 4400 等端口。 */',
  'async function findExistingApp(startPort) {',
  '  const probes = [];',
  '  for (let i = 0; i < 8; i++) probes.push(isOurApp(startPort + i));',
  '  const found = await Promise.all(probes);',
  '  for (let i = 0; i < found.length; i++) if (found[i]) return startPort + i;',
  '  return 0;',
  '}',
  '',
  'function boot(port, attempt) {',
  "  const app = startCore({ root: APP_DIR, dataDir: path.join(EXE_DIR, 'data') });",
  "  app.server.on('error', err => {",
  "    if (err && err.code === 'EADDRINUSE' && attempt < 20) boot(port + 1, attempt + 1);",
  "    else { console.error(err); logLine('服务启动失败: ' + (err && err.stack ? err.stack : err)); process.exit(1); }",
  '  });',
  "  app.server.listen(port, '127.0.0.1', () => {",
  "    const modeText = app.config.apiKey ? ('模型模式：' + app.config.model) : 'AI 本地分析模式（未配置 COMMAND_CODE_API_KEY）';",
  "    const appUrl = 'http://127.0.0.1:' + port + '/';",
  "    try { fs.writeFileSync(path.join(EXE_DIR, 'data', 'app-url.txt'), appUrl + '\\n', 'utf8'); } catch (_) {}",
  "    console.log('问墨笔记 已启动: ' + appUrl);",
  '    console.log(modeText);',
  "    logLine('问墨笔记 已启动: ' + appUrl + ' | ' + modeText);",
  "    const noWindow = process.argv.includes('--no-window') || process.env.WENMO_NO_WINDOW || process.env.RACE_NO_WINDOW;",
  '    if (noWindow) return;',
  '    const win = launchWindow(port);',
  '    if (win) {',
  '      const launchedAt = Date.now();',
  "      win.on('exit', () => {",
  '        /* Edge 已运行时，子进程可能只是把 URL 转交给现有实例后立刻退出；',
  '           此时不能关掉服务，否则新窗口会立刻 ERR_CONNECTION_REFUSED。 */',
  '        if (Date.now() - launchedAt < 3000) {',
  "          logLine('浏览器已转交现有 Edge 实例，服务继续运行: ' + appUrl);",
  '          return;',
  '        }',
  '        try { app.server.close(); } catch (_) {}',
  '        process.exit(0);',
  '      });',
  '    }',
  '  });',
  '}',
  '',
  'async function main() {',
  "  const port = Number(argOf('port', process.env.PORT || 4399));",
  "  const noWindow = process.argv.includes('--no-window') || process.env.WENMO_NO_WINDOW || process.env.RACE_NO_WINDOW;",
  '  if (!noWindow) {',
  '    const existing = await findExistingApp(port);',
  '    if (existing) {',
  "      const appUrl = 'http://127.0.0.1:' + existing + '/';",
  "      console.log('检测到已运行的问墨笔记，直接复用: ' + appUrl);",
  "      logLine('检测到已运行实例，复用: ' + appUrl);",
  '      try { launchWindow(existing); } catch (_) {}',
  '      setTimeout(() => process.exit(0), 1200);',
  '      return;',
  '    }',
  '  }',
  '  boot(port, 0);',
  '}',
  '',
  'main().catch(err => {',
  "  logLine('启动器异常，改为直接启动: ' + (err && err.stack ? err.stack : err));",
  "  boot(Number(argOf('port', process.env.PORT || 4399)), 0);",
  '});',
  ''
].join('\n');

fs.writeFileSync(path.join(WORK, 'entry.js'), wrapped, 'utf8');
console.log('1/4 生成入口脚本 entry.js');

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

const outIndex = process.argv.indexOf('--out');
let exePath = outIndex >= 0 && process.argv[outIndex + 1]
  ? path.resolve(process.argv[outIndex + 1])
  : path.join(OUT_DIR, 'Wenmo-Notes.exe');
fs.mkdirSync(path.dirname(exePath), { recursive: true });
try {
  fs.copyFileSync(process.execPath, exePath);
} catch (err) {
  const locked = err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES');
  if (outIndex >= 0 || !locked) throw err;
  const fallback = path.join(OUT_DIR, 'Wenmo-Notes-NoConsole.exe');
  console.warn('旧版 Wenmo-Notes.exe 正在运行，改为生成无控制台版本：' + fallback);
  exePath = fallback;
  fs.copyFileSync(process.execPath, exePath);
}
console.log('3/4 复制 Node 运行时 → ' + exePath);

const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
if (!fs.existsSync(postject)) {
  console.error('缺少 postject。请先运行 npm install（它已在 devDependencies 中）。');
  process.exit(1);
}
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
execFileSync(process.execPath, [
  postject,
  exePath,
  'NODE_SEA_BLOB',
  path.join(WORK, 'app.blob'),
  '--sentinel-fuse', fuse
], { stdio: 'inherit' });
console.log('4/4 注入完成');
try {
  if (patchExeIcon(exePath, ICON)) console.log('   已写入应用图标: assets/wenmo-icon.ico');
} catch (err) {
  console.warn('   图标写入失败（不影响程序运行）: ' + (err && err.message ? err.message : err));
}
try {
  const subsystem = setGuiSubsystem(exePath);
  console.log(subsystem.changed
    ? '   已切换为 GUI 子系统：双击不再弹黑色控制台窗口'
    : '   已是 GUI 子系统：双击不弹控制台');
} catch (err) {
  console.warn('   控制台窗口隐藏失败（不影响程序运行）: ' + (err && err.message ? err.message : err));
}

const size = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log('✅ 构建完成: ' + path.relative(ROOT, exePath) + '（' + size + ' MB，内置 Node 运行时）');
console.log('   双击即可启动；记录存在 exe 同级的 data/ 目录');
