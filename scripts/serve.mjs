#!/usr/bin/env node
/* ============================================================
   serve.mjs — 本地开发服务器 + AI 代理（零依赖）
   为什么需要它：
   1) 纯前端无法安全保存 API Key（打包后明文可见），密钥只能留在服务端；
   2) 浏览器直接跨域调模型接口会被 CORS 拦，代理顺带解决。
   用法：
     COMMAND_CODE_API_KEY=xxx node scripts/serve.mjs --port 4321
   然后浏览器打开 http://localhost:4321
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const PORT = Number(argOf('port', process.env.PORT || 4321));
const API_KEY = process.env.COMMAND_CODE_API_KEY || process.env.AI_API_KEY || '';
const BASE_URL = (process.env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
const MODEL = process.env.AI_MODEL || 'deepseek-chat';

const SLASH = String.fromCharCode(47);
const DOT = String.fromCharCode(46);
const DOTS = DOT + DOT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const SYSTEM_PROMPT = [
  '你是用户的私人学习笔记助手，基于用户提供的笔记内容回答问题。',
  '规则：',
  '1. 只依据给出的笔记作答，笔记里没有的信息要明确说「笔记里没有」。',
  '2. 回答用中文，简洁分点，不超过 300 字。',
  '3. 引用到某篇笔记时，用 [[笔记标题]] 的形式标注，方便用户点击跳转。',
  '4. 不要编造不存在的笔记标题。'
].join('\n');

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const cleaned = rel.split(SLASH).filter(seg => seg && seg !== DOTS && seg !== DOT).join(SLASH);
  const full = path.join(ROOT, cleaned);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

async function handleChat(req, res) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) { sendJson(res, 413, { error: 'payload too large' }); return; }
  }
  let payload;
  try { payload = JSON.parse(raw || '{}'); } catch { sendJson(res, 400, { error: 'bad json' }); return; }

  const question = String(payload.question || '').slice(0, 2000);
  const context = String(payload.context || '').slice(0, 20000);
  if (!question) { sendJson(res, 400, { error: 'question required' }); return; }
  if (!API_KEY) { sendJson(res, 503, { error: '服务端未配置 COMMAND_CODE_API_KEY' }); return; }

  try {
    const upstream = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '【笔记内容】\n' + context + '\n\n【问题】\n' + question }
        ]
      })
    });
    if (!upstream.ok) {
      const text = (await upstream.text()).slice(0, 300);
      sendJson(res, 502, { error: 'upstream ' + upstream.status + ': ' + text });
      return;
    }
    const data = await upstream.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || '（模型没有返回内容）';
    const refs = [...new Set([...answer.matchAll(/\[\[([^\[\]]+?)\]\]/g)].map(m => m[1].split('|')[0].trim()))];
    sendJson(res, 200, { answer, refs, model: MODEL });
  } catch (err) {
    sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/health') {
    if (!API_KEY) return sendJson(res, 503, { ok: false, reason: 'no key' });
    return sendJson(res, 200, { ok: true, model: MODEL });
  }
  if (pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('Race-AiNote 已启动: http://localhost:' + PORT);
  console.log(API_KEY
    ? 'AI 模式: 模型模式（' + MODEL + '）'
    : 'AI 模式: 本地分析（未检测到 COMMAND_CODE_API_KEY，问答面板会走离线规则分析）');
  console.log('提示：密钥只从环境变量读取，不会写进任何文件。');
});
