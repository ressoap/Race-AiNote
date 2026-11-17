const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('store：旧键迁移到新键，带 schema 版本，凭据不重复保留', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/' });
  global.window = dom.window;
  global.localStorage = dom.window.localStorage;
  const cache = require.resolve(path.join(__dirname, '..', 'js', 'store.js'));
  delete require.cache[cache];

  localStorage.setItem('race-ainote:v1', JSON.stringify({ themeMode: 'dark' }));
  localStorage.setItem('race-ainote:v1:theme', 'dark');
  localStorage.setItem('race-ainote:mistakes', '[{"id":"r1"}]');
  localStorage.setItem('race-ainote:plugin:demo', JSON.stringify({ k: 1 }));

  require(cache);
  const store = dom.window.RG.store;
  assert.equal(store.VERSION, 2);
  assert.equal(localStorage.getItem(store.KEYS.schema), '2');
  assert.equal(store.getJSON('settings').themeMode, 'dark');
  assert.equal(store.get('theme'), 'dark');
  assert.deepEqual(store.getJSON('records'), [{ id: 'r1' }]);
  assert.equal(store.get('pluginData:demo'), JSON.stringify({ k: 1 }));

  assert.equal(localStorage.getItem('race-ainote:v1'), null);
  assert.equal(localStorage.getItem('race-ainote:mistakes'), null);
  assert.equal(localStorage.getItem('race-ainote:plugin:demo'), null);

  store.resetAll();
  assert.equal(localStorage.length, 0);
});
