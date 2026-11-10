const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.fetch = global.fetch;

require(path.join(root, 'js', 'plugins.js'));
const { createHost } = global.RG.plugins;

function freshHost() {
  localStorage.clear();
  const toasts = [];
  const errors = [];
  const host = createHost({
    onToast: m => toasts.push(m),
    onError: (id, m) => errors.push(id + ':' + m),
    onRegistryChange: () => {}
  });
  return { host, toasts, errors };
}

const HELLO = [
  "api.registerCommand({ id: 'hello', title: '打招呼', run: function () { api.toast('hello'); } });",
  "api.addToolbarButton({ id: 'btn', label: '按钮', onClick: function () { api.toast('clicked'); } });",
  "api.addNoteFooterWidget({ id: 'w', render: function (el, note) { el.textContent = note ? note.title : '无'; } });"
].join('\n');

test('安装插件后命令/按钮/挂件全部注册', () => {
  const { host } = freshHost();
  host.install({ name: 'Hello', id: 'hello', code: HELLO });
  assert.equal(host.commands().length, 1);
  assert.equal(host.toolbarButtons().length, 1);
  assert.equal(host.footerWidgets().length, 1);
  assert.equal(host.list().length, 1);
  assert.equal(host.list()[0].enabled, true);
});

test('命令可以执行，并能拿到 api 能力', () => {
  const { host, toasts } = freshHost();
  host.install({ name: 'Hello', id: 'hello', code: HELLO });
  host.commands()[0].run();
  assert.deepEqual(toasts, ['hello']);
});

test('停用插件会摘掉它注册的所有东西，重新启用能恢复', () => {
  const { host } = freshHost();
  host.install({ name: 'Hello', id: 'hello', code: HELLO });
  host.setEnabled('hello', false);
  assert.equal(host.commands().length, 0);
  assert.equal(host.toolbarButtons().length, 0);
  assert.equal(host.footerWidgets().length, 0);
  assert.equal(host.list()[0].enabled, false);
  host.setEnabled('hello', true);
  assert.equal(host.commands().length, 1);
});

test('卸载后从列表和注册表里都消失', () => {
  const { host } = freshHost();
  host.install({ name: 'Hello', id: 'hello', code: HELLO });
  host.uninstall('hello');
  assert.equal(host.list().length, 0);
  assert.equal(host.commands().length, 0);
});

test('代码有语法错误时安装失败且不会留下启用状态', () => {
  const { host } = freshHost();
  assert.throws(() => host.install({ name: 'Bad', id: 'bad', code: 'this is not js(' }), /加载失败/);
  const record = host.list().find(p => p.id === 'bad');
  assert.ok(record, '记录应保留，方便用户排查');
  assert.equal(record.enabled, false, '失败后必须是停用状态');
});

test('运行时抛错不会影响宿主：命令异常被捕获', () => {
  const { host } = freshHost();
  host.install({ name: 'Boom', id: 'boom', code: "api.registerCommand({ id: 'x', title: 'x', run: function () { throw new Error('boom'); } });" });
  assert.equal(host.commands().length, 1);
  assert.throws(() => host.commands()[0].run(), /boom/);
});

test('事件订阅：note:open 能收到 payload，停用后不再触发', () => {
  const { host } = freshHost();
  const seen = [];
  host.install({ name: 'Listen', id: 'listen', code: "api.on('note:open', function (p) { globalThis.__seen = (globalThis.__seen || 0) + 1; });" });
  global.__seen = 0;
  host.emit('note:open', { note: { title: 't' } });
  assert.equal(global.__seen, 1);
  host.setEnabled('listen', false);
  host.emit('note:open', { note: { title: 't' } });
  assert.equal(global.__seen, 1, '停用后不应再收到事件');
});

test('插件存储按插件 id 隔离', () => {
  const { host } = freshHost();
  host.install({ name: 'A', id: 'a', code: "api.storage.set('k', 1);" });
  host.install({ name: 'B', id: 'b', code: "api.storage.set('k', 2);" });
  assert.equal(JSON.parse(localStorage.getItem('race-ainote:plugin:a')).k, 1);
  assert.equal(JSON.parse(localStorage.getItem('race-ainote:plugin:b')).k, 2);
});

test('boot 只加载启用的插件', () => {
  const { host } = freshHost();
  host.install({ name: 'A', id: 'a', code: HELLO });
  host.setEnabled('a', false);
  const results = host.boot();
  assert.equal(results.length, 0);
  assert.equal(host.commands().length, 0);
});
