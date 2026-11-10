#!/usr/bin/env node
/* ============================================================
   desktop.js — 把应用当作桌面程序启动
   1) 起本地服务（serve.mjs）
   2) 用 Edge/Chrome 的 --app 模式打开一个无地址栏、无标签页的独立窗口
      （独立 profile 目录，和日常浏览器互不干扰）
   右键交给应用自己处理，不再出现浏览器菜单。
   用法：node scripts/desktop.js [--port 4399]
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const PORT = Number(argOf('port', 4399));
const URL_APP = 'http://127.0.0.1:' + PORT + '/';

const BROWSER_CANDIDATES = [
  process.env.RACE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (_) {}
  }
  return null;
}

function profileDir() {
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || os.tmpdir())
    : path.join(os.homedir(), '.local', 'share');
  const dir = path.join(base, 'Race-AiNote', 'profile');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function waitForServer(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) return resolve(true);
      } catch (_) {}
      if (Date.now() - started > timeoutMs) return reject(new Error('本地服务启动超时'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

(async () => {
  const browser = findBrowser();
  if (!browser) {
    console.error('没找到 Edge 或 Chrome。可以用环境变量 RACE_BROWSER 指定浏览器可执行文件路径。');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', d => process.stdout.write('[server] ' + d));
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));

  const cleanup = () => {
    try { server.kill(); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });

  try {
    await waitForServer(URL_APP, 15000);
  } catch (err) {
    console.error(err.message);
    cleanup();
    process.exit(1);
  }

  const args = [
    '--app=' + URL_APP,
    '--user-data-dir=' + profileDir(),
    '--window-size=1480,920',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required'
  ];
  console.log('启动桌面窗口：' + browser);
  const app = spawn(browser, args, { stdio: 'ignore', detached: false });
  app.on('exit', () => {
    cleanup();
    process.exit(0);
  });
})();
