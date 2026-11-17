'use strict';
/* ============================================================
   server-core.cjs — 本地服务核心（静态资源 + AI / 网盘代理 + 记录存储）
   设计目标：
   1) 只有这一份服务端实现，serve.mjs / SEA exe / Electron 都复用它；
   2) 默认只监听 127.0.0.1，静态资源走白名单，绝不把 .env / .git / data 暴露出去；
   3) 浏览器发来的 API 请求必须来自本机同源页面，挡住 CSRF / DNS rebinding；
   4) 密钥只从环境变量或 .env 读取，只在内存中使用。
   ============================================================ */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

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
    '4. 不要编造不存在的笔记标题。',
    '5. 公式用纯文本 / Unicode（如 √、²、≤），不要输出 LaTeX 标记；列表用 -，不要用 • 或单独 *。'
  ].join('\n'),
  format: [
    '你是排版助手，负责把用户随手写的笔记整理成干净的 Markdown。',
    '规则：',
    '1. 你只能插入 Markdown 标记（## 小标题、- 列表、**加粗**、空行）。',
    '2. 严禁增加、删除、替换、改写任何一个字；不能总结，不能补全，不能改动标点。',
    '3. 原文有编号的保留原编号顺序，只把「1、」「·」这类写法规范化。',
    '4. 原样保留 [[双链]]、#标签、代码块内容。',
    '5. 直接输出整理后的正文，不要解释，不要加代码围栏。若无法在「不改字」的前提下整理，就原样输出输入内容。'
  ].join('\n'),
  analyze: [
    '你是错题归档助手。根据用户的问题和答案，判断学科和知识点。',
    '只输出 JSON，不要 Markdown，不要解释。格式：',
    '{"subject":"数学","knowledgePoints":["知识点1","知识点2"]}',
    '学科只能从这些里选一个：数学、物理、化学、生物、英语、语文、数据结构、信号与系统、其他。',
    'knowledgePoints 给 1-3 个，每个 2-12 个字，按重要性排序。',
    '如果题目涉及英语句子、语法、完形、阅读、写作，学科必须是英语，不要归到数学。'
  ].join('\n'),
  tutor: [
    '你是一位耐心、严谨的学科老师，职责是给学生答疑解惑。',
    '规则：',
    '1. 先判断学生问的是概念问题还是具体题目；若题目缺少条件，先追问关键条件，不要凭空假设。',
    '2. 讲题按这个结构输出：① 考点定位 ② 解题思路 ③ 分步推导 ④ 易错提醒 ⑤ 一句话拓展。',
    '3. 可以超出学生笔记的范围作答（这是讲课，不是检索），但若笔记里有相关材料，用 [[笔记标题]] 指出该复习哪篇。',
    '4. 用中文，讲清推理过程而不是只给答案；不确定的地方要直说不确定，不要编造。',
    '5. 篇幅 300 字以内，能讲完就收，不要凑字数。',
    '6. 公式用纯文本 / Unicode（如 √、²、≤），不要输出 LaTeX 标记；列表用 -，不要用 • 或单独 *。'
  ].join('\n')
};

/* ---------- 基础工具 ---------- */

/** 直接读本机 .env（已在 .gitignore 里，不会被提交），避免每次手敲环境变量 */
function loadDotEnv(root) {
  const file = path.join(root, '.env');
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

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > limit) {
        const err = new Error('payload too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw || '{}');
  } catch (_) {
    const err = new Error('bad json');
    err.statusCode = 400;
    throw err;
  }
}

/* ---------- 本机来源校验 ---------- */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function hostnameOf(value) {
  const host = String(value || '').trim();
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(0, end + 1).toLowerCase() : host.toLowerCase();
  }
  return host.split(':')[0].toLowerCase();
}

function isLocalHost(req) {
  const host = hostnameOf(req.headers.host);
  return !host || LOCAL_HOSTS.has(host);
}

function isLocalOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 本机脚本 / curl 不带 Origin；浏览器跨站请求一定带
  if (origin === 'null') return false;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

function isJsonRequest(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

/* ---------- 静态资源白名单 ---------- */

const STATIC_FIXED = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css']
]);
const STATIC_JS_RE = /^\/js\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.js$/;

function resolveStatic(root, pathname) {
  let rel = STATIC_FIXED.get(pathname);
  if (!rel && STATIC_JS_RE.test(pathname)) rel = pathname.slice(1);
  if (!rel) return null;
  const parts = rel.split(/[\/]+/);
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  const full = path.resolve(root, rel);
  const prefix = path.resolve(root) + path.sep;
  if (!full.startsWith(prefix)) return null;
  return full;
}

function serveStatic(req, res, root, pathname) {
  const full = resolveStatic(root, pathname);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return sendText(res, 404, '404 Not Found');
  }
  const ext = path.extname(full).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
  if (ext === '.html') {
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; media-src 'self' blob: data: https: http:; connect-src 'self' https: http:; frame-ancestors 'none'; base-uri 'none'";
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}

/* ---------- AI ---------- */

function normalizeSubjectLabel(value) {
  const s = String(value || '').trim();
  if (!s) return '其他';
  if (/数据结构|计算机|算法/.test(s)) return '数据结构';
  if (/信号|通信/.test(s)) return '信号与系统';
  if (/英文|英语/.test(s)) return '英语';
  const hit = /(数学|物理|化学|生物|语文)/.exec(s);
  return hit ? hit[1] : s.slice(0, 12);
}

function parseLooseJson(text) {
  const src = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(src.slice(start, end + 1)); } catch (_) { return null; }
}

function normalizeKnowledgePoints(value) {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[、,，;；]/) : []);
  return raw.map(item => String(item || '').trim()).filter(Boolean).slice(0, 3);
}


function createAiHandlers(config) {
  async function handleFormat(req, res) {
    const payload = await readJson(req, 200000);
    const text = String(payload.text || '').slice(0, 12000);
    if (!text.trim()) return sendJson(res, 400, { error: 'text required' });
    if (!config.apiKey) return sendJson(res, 503, { error: '服务端未配置 COMMAND_CODE_API_KEY' });
    try {
      const upstream = await fetch(config.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
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
      sendJson(res, 200, { markdown });
    } catch (err) {
      sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
    }
  }

  async function handleModels(res) {
    if (!config.apiKey) return sendJson(res, 503, { error: '服务端未配置 COMMAND_CODE_API_KEY' });
    try {
      const upstream = await fetch(config.baseUrl + '/models', {
        headers: { Authorization: 'Bearer ' + config.apiKey }
      });
      if (!upstream.ok) {
        const text = (await upstream.text()).slice(0, 200);
        return sendJson(res, 502, { error: 'upstream ' + upstream.status + ': ' + text });
      }
      const data = await upstream.json();
      const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
      const models = list.map(m => m.id || m.name || m.model || String(m)).filter(Boolean);
      sendJson(res, 200, { models, current: config.model });
    } catch (err) {
      sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
    }
  }

  async function handleChat(req, res) {
    const payload = await readJson(req, 8000000);
    const question = String(payload.question || '').slice(0, 2000);
    const mode = payload.mode === 'tutor' ? 'tutor' : 'notes';
    const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
    const context = String(payload.context || '').slice(0, 20000);
    const images = Array.isArray(payload.images)
      ? payload.images.map(x => String(x || '')).filter(x => /^data:image\//i.test(x)).slice(0, 3)
      : [];
    const requestedVision = String(payload.visionModel || '').trim().slice(0, 120);
    const requestModel = images.length ? (requestedVision || config.visionModel || config.model) : config.model;
    const nl = String.fromCharCode(10);
    const imageHint = images.length
      ? '【图片】用户附带了 ' + images.length + ' 张图片，请先识别图片中的内容，再结合笔记和问题回答；不要忽略图片。' + nl + nl
      : '';
    const userText = imageHint + (context ? '【笔记内容】' + nl + context + nl + nl : '') + '【问题】' + nl + question;
    const teacherPrompt = mode === 'tutor' ? String(payload.teacherPrompt || '').trim().slice(0, 8000) : '';
    const systemPrompt = PROMPTS[mode]
      + (teacherPrompt ? nl + nl + teacherPrompt : '')
      + (images.length ? nl + '用户消息包含图片，必须优先识别图片内容；笔记只作为辅助。' : '');
    const userContent = images.length
      ? [{ type: 'text', text: userText }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))]
      : userText;
    if (!question) return sendJson(res, 400, { error: 'question required' });
    if (!config.apiKey) return sendJson(res, 503, { error: '服务端未配置 COMMAND_CODE_API_KEY' });

    try {
      const upstream = await fetch(config.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
        body: JSON.stringify({
          model: requestModel,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history
              .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
              .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 1500) })),
            { role: 'user', content: userContent }
          ]
        })
      });
      if (!upstream.ok) {
        const text = (await upstream.text()).slice(0, 300);
        return sendJson(res, 502, { error: 'upstream ' + upstream.status + ': ' + text });
      }
      const data = await upstream.json();
      const answer = data?.choices?.[0]?.message?.content?.trim() || '（模型没有返回内容）';
      const refs = [...new Set([...answer.matchAll(/\[\[([^\[\]]+?)\]\]/g)].map(m => m[1].split('|')[0].trim()))];
      sendJson(res, 200, { answer, refs, model: requestModel });
    } catch (err) {
      sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
    }
  }

  async function handleAnalyze(req, res) {
    const payload = await readJson(req, 200000);
    const question = String(payload.question || '').slice(0, 4000);
    const answer = String(payload.answer || '').slice(0, 12000);
    if (!question.trim()) return sendJson(res, 400, { error: 'question required' });
    if (!config.apiKey) return sendJson(res, 503, { error: '服务端未配置 COMMAND_CODE_API_KEY' });
    try {
      const upstream = await fetch(config.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          messages: [
            { role: 'system', content: PROMPTS.analyze },
            { role: 'user', content: '【问题】\n' + question + '\n\n【回答】\n' + answer }
          ]
        })
      });
      if (!upstream.ok) {
        const text = (await upstream.text()).slice(0, 300);
        return sendJson(res, 502, { error: 'upstream ' + upstream.status + ': ' + text });
      }
      const data = await upstream.json();
      const raw = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      const parsed = parseLooseJson(raw);
      if (!parsed || !parsed.subject) {
        return sendJson(res, 502, { error: '模型没有返回可解析的学科标签', raw: String(raw).slice(0, 300) });
      }
      sendJson(res, 200, {
        subject: normalizeSubjectLabel(parsed.subject),
        knowledgePoints: normalizeKnowledgePoints(parsed.knowledgePoints),
        source: 'api'
      });
    } catch (err) {
      sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
    }
  }

  return { handleFormat, handleModels, handleChat, handleAnalyze };
}


/* ---------- 百度网盘代理 ---------- */

const BAIDU = {
  fileApi: 'https://pan.baidu.com/rest/2.0/xpan/file',
  uploadApi: 'https://d.pcs.baidu.com/rest/2.0/pcs/superfile2',
  mediaApi: 'https://pan.baidu.com/rest/2.0/xpan/multimedia'
};

async function baiduListDir(accessToken, dir) {
  const url = BAIDU.fileApi + '?method=list&access_token=' + encodeURIComponent(accessToken)
    + '&dir=' + encodeURIComponent(dir) + '&limit=100';
  const res = await fetch(url);
  const data = await res.json();
  if (data.errno && data.errno !== 0) throw new Error('百度网盘 list 失败：errno ' + data.errno);
  return data.list || [];
}

async function baiduFindFile(accessToken, filePath) {
  const dir = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const list = await baiduListDir(accessToken, dir);
  return list.find(f => f.server_filename === name) || null;
}

async function baiduUpload(accessToken, filePath, content) {
  const buffer = Buffer.from(content, 'utf8');
  const md5 = createHash('md5').update(buffer).digest('hex');
  const size = buffer.length;
  const blockList = JSON.stringify([md5]);

  const preUrl = BAIDU.fileApi + '?method=precreate&access_token=' + encodeURIComponent(accessToken);
  const preBody = new URLSearchParams({
    path: filePath, size: String(size), isdir: '0', autoinit: '1', rtype: '3', block_list: blockList
  });
  const preRes = await fetch(preUrl, { method: 'POST', body: preBody });
  const pre = await preRes.json();
  if (pre.errno !== 0) throw new Error('百度网盘 precreate 失败：errno ' + pre.errno);
  const uploadId = pre.uploadid;
  const blockList2 = pre.block_list || [];

  if (!blockList2.includes(0)) {
    const form = new FormData();
    form.append('file', new Blob([buffer]), 'backup.json');
    const upUrl = BAIDU.uploadApi + '?method=upload&access_token=' + encodeURIComponent(accessToken)
      + '&type=tmpfile&path=' + encodeURIComponent(filePath)
      + '&uploadid=' + encodeURIComponent(uploadId) + '&partseq=0';
    const upRes = await fetch(upUrl, { method: 'POST', body: form });
    const up = await upRes.json().catch(() => ({}));
    if (up.errno && up.errno !== 0) throw new Error('百度网盘上传失败：errno ' + up.errno);
  }

  const createUrl = BAIDU.fileApi + '?method=create&access_token=' + encodeURIComponent(accessToken);
  const createBody = new URLSearchParams({
    path: filePath, size: String(size), isdir: '0', rtype: '3',
    uploadid: uploadId, block_list: JSON.stringify([0])
  });
  const createRes = await fetch(createUrl, { method: 'POST', body: createBody });
  const created = await createRes.json();
  if (created.errno !== 0) throw new Error('百度网盘 create 失败：errno ' + created.errno);
  return created;
}

async function baiduDownload(accessToken, filePath) {
  const file = await baiduFindFile(accessToken, filePath);
  if (!file) throw new Error('云端还没有备份文件：' + filePath);
  const metaUrl = BAIDU.mediaApi + '?method=filemetas&access_token=' + encodeURIComponent(accessToken)
    + '&dlink=1&fsids=[' + file.fs_id + ']';
  const metaRes = await fetch(metaUrl);
  const meta = await metaRes.json();
  if (meta.errno !== 0 || !meta.list || !meta.list.length) throw new Error('百度网盘 filemetas 失败：errno ' + meta.errno);
  const dlink = meta.list[0].dlink + '&access_token=' + encodeURIComponent(accessToken);
  const fileRes = await fetch(dlink, { headers: { 'User-Agent': 'pan.baidu.com' } });
  if (!fileRes.ok) throw new Error('百度网盘下载失败：HTTP ' + fileRes.status);
  return await fileRes.text();
}

async function handleBaidu(req, res) {
  const payload = await readJson(req, 8000000);
  const accessToken = String(payload.accessToken || '');
  if (!accessToken) return sendJson(res, 400, { error: '缺少百度网盘 access_token' });
  const filePath = String(payload.path || '/apps/wenmo-notes/backup.json');

  try {
    if (payload.action === 'test') {
      const dir = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
      await baiduListDir(accessToken, dir);
      return sendJson(res, 200, { ok: true, message: '已连接百度网盘，目录可访问：' + dir });
    }
    if (payload.action === 'upload') {
      await baiduUpload(accessToken, filePath, String(payload.content || ''));
      return sendJson(res, 200, { ok: true });
    }
    if (payload.action === 'download') {
      const content = await baiduDownload(accessToken, filePath);
      return sendJson(res, 200, { content });
    }
    sendJson(res, 400, { error: '未知 action' });
  } catch (err) {
    sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
  }
}

/* ---------- 问题记录 ---------- */

function createRecordHandlers(dataDir) {
  const recordsFile = path.join(dataDir, 'records.json');

  async function handleRecords(req, res) {
    if (req.method === 'GET') {
      try {
        const raw = fs.existsSync(recordsFile) ? fs.readFileSync(recordsFile, 'utf8') : '[]';
        sendJson(res, 200, { records: JSON.parse(raw || '[]') });
      } catch (err) {
        sendJson(res, 200, { records: [], error: String(err && err.message ? err.message : err) });
      }
      return;
    }
    const payload = await readJson(req, 4000000);
    const records = Array.isArray(payload.records) ? payload.records.slice(0, 500) : [];
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(recordsFile, JSON.stringify(records, null, 2), 'utf8');
      sendJson(res, 200, { ok: true, count: records.length });
    } catch (err) {
      sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
    }
  }

  return { handleRecords, recordsFile };
}

/* ---------- 服务器工厂 ---------- */

function createAppServer(options) {
  const opts = options || {};
  const root = path.resolve(opts.root || process.cwd());
  const dataDir = path.resolve(opts.dataDir || path.join(root, 'data'));
  const config = {
    root,
    dataDir,
    apiKey: opts.apiKey !== undefined ? String(opts.apiKey || '') : (process.env.COMMAND_CODE_API_KEY || process.env.AI_API_KEY || ''),
    baseUrl: String(opts.baseUrl || process.env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: String(opts.model || process.env.AI_MODEL || 'deepseek-chat'),
    visionModel: String(opts.visionModel || process.env.AI_VISION_MODEL || '')
  };
  const ai = createAiHandlers(config);
  const records = createRecordHandlers(dataDir);

  async function handle(req, res) {
    if (!isLocalHost(req)) {
      return sendJson(res, 403, { error: 'forbidden host' });
    }

    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch (_) {
      return sendText(res, 400, '400 Bad Request');
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (_) {
      return sendText(res, 400, '400 Bad Request');
    }

    if (pathname.startsWith('/api/')) {
      if (!isLocalOrigin(req)) return sendJson(res, 403, { error: 'forbidden origin' });

      if (pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        if (!config.apiKey) return sendJson(res, 503, { ok: false, reason: 'no key' });
        return sendJson(res, 200, { ok: true, model: config.model, visionModel: config.visionModel || null });
      }
      if (pathname === '/api/store/records' && (req.method === 'GET' || req.method === 'POST')) {
        if (req.method === 'POST' && !isJsonRequest(req)) return sendJson(res, 415, { error: 'json required' });
        return records.handleRecords(req, res);
      }
      if (req.method === 'POST' && !isJsonRequest(req)) return sendJson(res, 415, { error: 'json required' });
      if (pathname === '/api/chat' && req.method === 'POST') return ai.handleChat(req, res);
      if (pathname === '/api/analyze' && req.method === 'POST') return ai.handleAnalyze(req, res);
      if (pathname === '/api/format' && req.method === 'POST') return ai.handleFormat(req, res);
      if (pathname === '/api/cloud/baidu' && req.method === 'POST') return handleBaidu(req, res);
      if (pathname === '/api/models' && req.method === 'GET') return ai.handleModels(res);
      return sendJson(res, 404, { error: 'not found' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, '405 Method Not Allowed');
    }
    serveStatic(req, res, root, pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      if (res.headersSent) {
        try { res.end(); } catch (_) {}
        return;
      }
      const code = err && err.statusCode ? err.statusCode : 500;
      sendJson(res, code, { error: String(err && err.message ? err.message : err) });
    });
  });

  return { server, config, recordsFile: records.recordsFile };
}

function startServer(options) {
  const app = createAppServer(options);
  const rawPort = options && options.port;
  const port = rawPort === undefined || rawPort === null || rawPort === '' ? 4321 : Number(rawPort);
  const host = (options && options.host) || '127.0.0.1';
  return new Promise((resolve, reject) => {
    const onError = err => reject(err);
    app.server.once('error', onError);
    app.server.listen(port, host, () => {
      app.server.removeListener('error', onError);
      resolve(app);
    });
  });
}

module.exports = {
  loadDotEnv,
  createAppServer,
  startServer,
  resolveStatic,
  isLocalOrigin,
  isLocalHost,
  PROMPTS
};
