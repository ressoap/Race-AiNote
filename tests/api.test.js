const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const UPSTREAM_PORT = 4471;
const SERVE_PORT = 4472;

function startMockUpstream() {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-small' }, { id: 'mock-large' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        const hasAuth = Boolean(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
        res.writeHead(hasAuth ? 200 : 401, { 'Content-Type': 'application/json' });
        const sys = (payload.messages || []).find(m => m.role === 'system') || { content: '' };
        const history = (payload.messages || []).filter(m => m.role !== 'system');
        const persona = sys.content.includes('学科老师') ? 'tutor' : 'notes';
        res.end(JSON.stringify({
          choices: [{ message: { content: '依据笔记回答：见 [[导数及其应用]]。模型=' + payload.model + '｜人设=' + persona + '｜消息数=' + history.length } }]
        }));
      });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise(resolve => server.listen(UPSTREAM_PORT, () => resolve(server)));
}

function startServe() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), '--port', String(SERVE_PORT)], {
    env: Object.assign({}, process.env, {
      COMMAND_CODE_API_KEY: 'test-key-123',
      AI_BASE_URL: 'http://127.0.0.1:' + UPSTREAM_PORT + '/v1',
      AI_MODEL: 'mock-small'
    }),
    stdio: 'ignore'
  });
  return child;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('代理服务：健康检查 / 模型列表 / 对话转发', async (t) => {
  const upstream = await startMockUpstream();
  const serve = startServe();
  t.after(() => { serve.kill(); upstream.close(); });
  await sleep(700);

  const health = await fetch('http://127.0.0.1:' + SERVE_PORT + '/api/health').then(r => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.model, 'mock-small');

  const models = await fetch('http://127.0.0.1:' + SERVE_PORT + '/api/models').then(r => r.json());
  assert.deepEqual(models.models, ['mock-small', 'mock-large']);

  const chat = await fetch('http://127.0.0.1:' + SERVE_PORT + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '这篇笔记讲什么', context: '【当前笔记】导数及其应用\n内容…' })
  }).then(r => r.json());
  assert.match(chat.answer, /导数及其应用/);
  assert.match(chat.answer, /mock-small/);
  assert.deepEqual(chat.refs, ['导数及其应用']);

  // 老师人设 + 多轮历史
  const tutor = await fetch('http://127.0.0.1:' + SERVE_PORT + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: '这道导数题怎么下手',
      context: '',
      mode: 'tutor',
      history: [{ role: 'user', content: '上一问' }, { role: 'assistant', content: '上一答' }]
    })
  }).then(r => r.json());
  assert.match(tutor.answer, /人设=tutor/);
  assert.match(tutor.answer, /消息数=3/);
});

test('代理服务：未配置密钥时健康检查返回 503（前端据此降级）', async (t) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), '--port', String(SERVE_PORT + 10)], {
    env: Object.assign({}, process.env, { COMMAND_CODE_API_KEY: '', AI_API_KEY: '' }),
    stdio: 'ignore'
  });
  t.after(() => child.kill());
  await sleep(700);
  const res = await fetch('http://127.0.0.1:' + (SERVE_PORT + 10) + '/api/health');
  assert.equal(res.status, 503);
});
