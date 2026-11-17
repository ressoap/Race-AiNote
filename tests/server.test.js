const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createAppServer, resolveStatic, isLocalHost } = require('../scripts/server-core.cjs');

const ROOT = path.resolve(__dirname, '..');

async function listen(app) {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  return app.server.address().port;
}

test('本地服务：只绑 127.0.0.1，静态资源白名单挡住 .env / .git / data', async (t) => {
  const app = createAppServer({ root: ROOT, apiKey: '' });
  const port = await listen(app);
  t.after(() => app.server.close());
  assert.equal(app.server.address().address, '127.0.0.1');

  const base = 'http://127.0.0.1:' + port;
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/styles.css')).status, 200);
  assert.equal((await fetch(base + '/js/app.js')).status, 200);

  for (const p of ['/.env', '/.env.local', '/.git/config', '/data/records.json', '/_tmp/x', '/node_modules/jsdom/package.json']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p + ' 必须被白名单挡住');
  }

  assert.equal(resolveStatic(ROOT, '/js/../data/records.json'), null);
  assert.equal(resolveStatic(ROOT, '/js/%2e%2e/data/records.json'), null);
  assert.equal(isLocalHost({ headers: { host: '127.0.0.1:4399' } }), true);
  assert.equal(isLocalHost({ headers: { host: 'evil.test:4399' } }), false);
});

test('API：跨站 Origin 被拒绝，非 JSON POST 被拒绝', async (t) => {
  const app = createAppServer({ root: ROOT, apiKey: '' });
  const port = await listen(app);
  t.after(() => app.server.close());
  const base = 'http://127.0.0.1:' + port;

  const evil = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
    body: JSON.stringify({ question: 'x' })
  });
  assert.equal(evil.status, 403);

  const notJson = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: base },
    body: JSON.stringify({ question: 'x' })
  });
  assert.equal(notJson.status, 415);

  const local = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ question: 'x' })
  });
  assert.equal(local.status, 503, '本机来源应放行到业务层，只是未配置 Key');
});

test('云备份：百度网盘上传不再因 crypto.createHash 缺失而报错', async (t) => {
  const app = createAppServer({ root: ROOT, apiKey: '' });
  const port = await listen(app);
  t.after(() => app.server.close());
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, opts) => {
    seen.push(String(url));
    const payload = String(url).includes('method=precreate')
      ? { errno: 0, uploadid: 'mock-upload', block_list: [0] }
      : { errno: 0 };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { global.fetch = realFetch; });
  const res = await realFetch('http://127.0.0.1:' + port + '/api/cloud/baidu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:' + port },
    body: JSON.stringify({ action: 'upload', accessToken: 'fake', path: '/apps/wenmo-notes/backup.json', content: 'hello' })
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.ok(seen.some(url => url.includes('method=precreate')));
  assert.ok(seen.some(url => url.includes('method=create')));
});
