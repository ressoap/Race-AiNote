const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;

require(path.join(root, 'js', 'cloud.js'));
const cloud = global.RG.cloud;

/* 简易 GitHub / Gitee 兼容 mock：内存里存一个文件 */
function startMock() {
  const store = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const m = url.pathname.match(/\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
      if (!m) { res.writeHead(404); res.end('{}'); return; }
      const key = m[3];
      if (req.method === 'GET') {
        if (!store.has(key)) { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha: 'sha-' + key, content: store.get(key) }));
        return;
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const payload = JSON.parse(body || '{}');
        // 真实 GitHub：新建不需要 sha，更新必须带 sha
        if (req.method === 'PUT' && store.has(key) && !payload.sha) { res.writeHead(409); res.end('{"error":"sha required"}'); return; }
        store.set(key, payload.content);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: { sha: 'sha-' + key } }));
        return;
      }
      res.writeHead(405); res.end('{}');
    });
  });
  return new Promise(resolve => server.listen(0, () => resolve({ server, port: server.address().port, store })));
}

test('备份包：构建与解析往返，中文无损', () => {
  const files = [{ path: '20-数学/导数.md', content: '# 导数\n\n切线斜率。' }, { path: 'img.png' }];
  const snapshot = cloud.buildSnapshot(files, '示例库');
  const parsed = cloud.parseSnapshot(snapshot);
  assert.equal(parsed.files.length, 1, '只备份有正文的文件');
  assert.equal(parsed.vault, '示例库');
  assert.equal(parsed.files[0].content, '# 导数\n\n切线斜率。');
  assert.ok(snapshot.includes('Race-AiNote'));
});

test('备份包：非法内容给出明确报错', () => {
  assert.throws(() => cloud.parseSnapshot('{"foo":1}'), /格式不正确/);
  assert.throws(() => cloud.parseSnapshot('not json'), /JSON/);
});

test('base64 往返：中文与 emoji 都不丢', () => {
  const text = '导数 📘 f(x)=x²';
  assert.equal(cloud.fromBase64Utf8(cloud.toBase64Utf8(text)), text);
});

test('夸克网盘：官方无接口，直接拒绝而不是假装能用', async () => {
  const cfg = { provider: 'quark', quark: {} };
  await assert.rejects(() => cloud.testConnection(cfg), /没有官方开放接口/);
  await assert.rejects(() => cloud.backup(cfg, [], 'x'), /没有官方开放接口/);
  await assert.rejects(() => cloud.restore(cfg), /没有官方开放接口/);
});

test('GitHub 驱动：首次创建、再次更新带 sha、能读回内容', async (t) => {
  const mock = await startMock();
  t.after(() => mock.server.close());
  const cfg = {
    provider: 'github',
    github: { apiBase: 'http://127.0.0.1:' + mock.port, token: 't', owner: 'o', repo: 'r', branch: 'main', path: 'backup.json' }
  };
  const files = [{ path: 'a.md', content: '第一次备份' }];
  const first = await cloud.backup(cfg, files, '库');
  assert.ok(first.bytes > 0);
  const second = await cloud.backup(cfg, [{ path: 'a.md', content: '第二次备份' }], '库');
  assert.ok(second.bytes > 0);
  const restored = await cloud.restore(cfg);
  assert.equal(restored.files[0].content, '第二次备份');
});

test('Gitee 驱动：走 POST 新建、能读回内容', async (t) => {
  const mock = await startMock();
  t.after(() => mock.server.close());
  const cfg = {
    provider: 'gitee',
    gitee: { apiBase: 'http://127.0.0.1:' + mock.port, token: 't', owner: 'o', repo: 'r', branch: 'master', path: 'backup.json' }
  };
  await cloud.backup(cfg, [{ path: 'a.md', content: 'gitee 备份内容' }], '库');
  const restored = await cloud.restore(cfg);
  assert.equal(restored.files[0].content, 'gitee 备份内容');
});

test('云端还没有备份时给出可读提示', async (t) => {
  const mock = await startMock();
  t.after(() => mock.server.close());
  const cfg = {
    provider: 'github',
    github: { apiBase: 'http://127.0.0.1:' + mock.port, token: 't', owner: 'o', repo: 'r', branch: 'main', path: 'none.json' }
  };
  await assert.rejects(() => cloud.restore(cfg), /还没有备份文件/);
});
