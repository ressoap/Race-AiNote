const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  url: 'https://local.test/',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, {
        get(t, k) {
          if (k === 'canvas') return this;
          if (k === 'measureText') return () => ({ width: 10 });
          return () => {};
        },
        set() { return true; }
      });
    };
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    window.addEventListener('error', e => errors.push('window error: ' + e.message));
  }
});

// 手动按顺序注入脚本，模拟浏览器
const files = ['js/vault.js','js/query.js','js/physics.js','js/render.js','js/demo-vault.js','js/app.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  try {
    dom.window.eval(code);
  } catch (err) {
    errors.push(f + ': ' + err.message);
  }
}

const w = dom.window;
setTimeout(() => {
  const api = w.__raceAiNote;
  const out = { errors };
  if (!api) {
    out.api = 'MISSING';
  } else {
    const g = api.graph;
    out.demoStats = g.stats;
    out.renderedNodes = api.state.nodes.length;
    out.renderedLinks = api.state.links.length;
    out.simPaused = api.state.sim ? api.state.sim.paused : null;
    // 搜索
    api.state.query = 'tag:错题';
    api.rebuild({});
    out.searchNodes = api.state.nodes.length;
    // 局部图谱
    api.state.query = '';
    api.setMode('local');
    out.localNodes = api.state.nodes.length;
    // 打开预览
    api.openNote(g.notes[0].id);
    out.modalTitle = w.document.querySelector('#note-modal-title').textContent;
    out.modalLinks = w.document.querySelectorAll('#note-modal-links li').length;
    out.statusNotes = w.document.querySelector('#status-notes').textContent;
    out.treeRows = w.document.querySelectorAll('#file-tree .tree-file').length;
    out.legend = w.document.querySelectorAll('#legend .legend-item').length;
    out.groups = w.document.querySelectorAll('#group-list .group-row').length;
    out.settingsPanelHidden = w.document.querySelector('#settings-panel').hidden;
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.errors.length ? 1 : 0);
}, 300);
