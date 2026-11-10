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

/* 直接读本机 .env（已在 .gitignore 里，不会被提交），避免每次手敲环境变量 */
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
loadDotEnv();

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

/** 两种人设：notes = 只依据笔记作答；tutor = 老师答疑，可分步讲题 */
const PROMPTS = {
  notes: [
    '你是用户的私人学习笔记助手，基于用户提供的笔记内容回答问题。',
    '规则：',
    '1. 只依据给出的笔记作答，笔记里没有的信息要明确说「笔记里没有」。',
    '2. 回答用中文，简洁分点，不超过 300 字。',
    '3. 引用到某篇笔记时，用 [[笔记标题]] 的形式标注，方便用户点击跳转。',
    '4. 不要编造不存在的笔记标题。'
  ].join(String.fromCharCode(10)),
  format: [
    '你是排版助手，负责把用户随手写的笔记整理成干净的 Markdown。',
    '规则：',
    '1. 只调整格式与分段，不增加、不删除、不改写任何事实内容。',
    '2. 合理使用 ## 小标题、- 列表、**加粗** 关键词；原文有编号的保留编号顺序。',
    '3. 保留原有的 [[双链]]、#标签、代码块，不要改写它们。',
    '4. 直接输出整理后的 Markdown 正文，不要解释、不要加代码围栏。'
  ].join(String.fromCharCode(10)),
  tutor: [
    '你是一位耐心、严谨的学科老师，职责是给学生答疑解惑。',
    '规则：',
    '1. 先判断学生问的是概念问题还是具体题目；若题目缺少条件，先追问关键条件，不要凭空假设。',
    '2. 讲题按这个结构输出：① 考点定位 ② 解题思路 ③ 分步推导 ④ 易错提醒 ⑤ 一句话拓展。',
    '3. 可以超出学生笔记的范围作答（这是讲课，不是检索），但若笔记里有相关材料，用 [[笔记标题]] 指出该复习哪篇。',
    '4. 用中文，讲清推理过程而不是只给答案；不确定的地方要直说不确定，不要编造。',
    '5. 篇幅 300 字以内，能讲完就收，不要凑字数。'
  ].join(String.fromCharCode(10))
};

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

/** 拉取可用模型列表（GET /models），密钥只在服务端 */
/** 把一段文本整理成干净的 Markdown */
async function handleFormat(req, res) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200000) { sendJson(res, 413, { error: 'payload too large' }); return; }
  }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { sendJson(res, 400, { error: 'bad json' }); return; }
  const text = String(payload.text || '').slice(0, 12000);
  if (!text.trim()) { sendJson(res, 400, { error: 'text required' }); return; }
  if (!API_KEY) { sendJson(res, 503, { error: '服务端未配置 COMMAND_CODE_API_KEY' }); return; }
  try {
    const upstream = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: PROMPTS.format },
          { role: 'user', content: text }
        ]
      })
    });
    if (!upstream.ok) {
      const errText = (await upstream.text()).slice(0, 200);
      return sendJson(res, 502, { error: 'upstream ' + upstream.status + ': ' + errText });
    }
    const data = await upstream.json();
    let markdown = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    markdown = String(markdown).trim().replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
    sendJson(res, 200, { markdown: markdown });
  } catch (err) {
    sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
  }
}

async function handleModels(res) {
  if (!API_KEY) return sendJson(res, 503, { error: '服务端未配置 COMMAND_CODE_API_KEY' });
  try {
    const upstream = await fetch(BASE_URL + '/models', {
      headers: { Authorization: 'Bearer ' + API_KEY }
    });
    if (!upstream.ok) {
      const text = (await upstream.text()).slice(0, 200);
      return sendJson(res, 502, { error: 'upstream ' + upstream.status + ': ' + text });
    }
    const data = await upstream.json();
    const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
    const models = list.map(function (m) { return m.id || m.name || m.model || String(m); }).filter(Boolean);
    sendJson(res, 200, { models: models, current: MODEL });
  } catch (err) {
    sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
  }
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
  const mode = payload.mode === 'tutor' ? 'tutor' : 'notes';
  const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
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
          { role: 'system', content: PROMPTS[mode] },
          ...history
            .filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant'); })
            .map(function (m) { return { role: m.role, content: String(m.content || '').slice(0, 1500) }; }),
          { role: 'user', content: (context ? '【笔记内容】\n' + context + '\n\n' : '') + '【问题】\n' + question }
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
  if (pathname === '/api/models' && req.method === 'GET') return handleModels(res);
  if (pathname === '/api/format' && req.method === 'POST') return handleFormat(req, res);

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
