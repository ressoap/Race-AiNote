#!/usr/bin/env node
/* ============================================================
   serve.mjs — 本地开发服务器入口
   真正的实现在 server-core.cjs；这里只负责读 .env、解析参数、启动。
   默认只监听 127.0.0.1，静态资源白名单，不把仓库里的凭据文件暴露出去。
   ============================================================ */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadDotEnv, startServer } = require('./server-core.cjs');
const { writeApp } = require('./build-app.js');
const { writeAi } = require('./build-ai.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

loadDotEnv(ROOT);
try { writeApp(); writeAi(); } catch (err) {
  console.error('生成 app/ai 源码失败：' + (err && err.message ? err.message : err));
  process.exit(1);
}

const PORT = Number(argOf('port', process.env.PORT || 4321));
const HOST = argOf('host', process.env.HOST || '127.0.0.1');

startServer({ root: ROOT, port: PORT, host: HOST }).then(app => {
  console.log('问墨笔记 已启动: http://' + HOST + ':' + PORT);
  console.log(app.config.apiKey
    ? 'AI 模式: 模型模式（' + app.config.model + '）'
    : 'AI 模式: 本地分析（未检测到 COMMAND_CODE_API_KEY，问答面板会走离线规则分析）');
  console.log('安全边界: 仅本机访问；静态资源只开放 index.html / styles.css / js/*.js。');
  console.log('提示：密钥只从环境变量或 .env 读取，不会写进任何文件，也不会被静态服务暴露。');
}).catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
