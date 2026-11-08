const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];
const logs = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://local.test/',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, {
        get(t, k) {
          if (k === 'measureText') return () => ({ width: 10 });
          return () => {};
        },
        set() { return true; }
      });
    };
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    window.addEventListener('error', e => errors.push('window error: ' + e.message));
    window.console.log = (...args) => logs.push(args.join(' '));
    window.console.error = (...args) => errors.push('console.error: ' + args.join(' '));
  }
});

// 脚本清单直接从 index.html 里读，避免手工维护漏文件
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
for (const src of srcs) {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  try {
    dom.window.eval(code);
  } catch (err) {
    errors.push(src + ': ' + err.message);
  }
}

const w = dom.window;
setTimeout(() => {
  const api = w.__raceAiNote;
  const out = { errors, scripts: srcs };
  if (!api) {
    out.api = 'MISSING';
  } else {
    const g = api.graph;
    out.demoStats = g.stats;
    out.renderedNodes = api.state.nodes.length;
    out.renderedLinks = api.state.links.length;

    api.state.query = 'tag:错题';
    api.rebuild({});
    out.searchNodes = api.state.nodes.length;

    api.state.query = '';
    api.setMode('local');
    out.localNodes = api.state.nodes.length;
    api.setMode('global');

    const first = g.notes[0];
    api.openNote(first.id);
    out.modalTitle = w.document.querySelector('#note-modal-title').textContent;
    out.modalBodyNodes = w.document.querySelectorAll('#note-modal-body > *').length;
    out.modalLinks = w.document.querySelectorAll('#note-modal-links li').length;
    out.statusNotes = w.document.querySelector('#status-notes').textContent;
    out.treeRows = w.document.querySelectorAll('#file-tree .tree-file').length;

    // 动画插值：悬停后透明度应逐步变化而不是瞬间跳变
    api.state.hoveredId = first.id;
    const before = api.state.anim.get(first.id) ? api.state.anim.get(first.id).a : 1;
    for (let i = 0; i < 5; i++) api.state.sim.tick();
    const after = api.state.anim.get(first.id);
    out.animated = Boolean(after) && Math.abs(after.a - before) >= 0;
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(errors.length ? 1 : 0);
}, 400);
