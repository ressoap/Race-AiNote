const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];

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
    window.console.error = (...args) => errors.push('console.error: ' + args.join(' '));
  }
});

for (const src of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) {
  try {
    dom.window.eval(fs.readFileSync(path.join(root, src), 'utf8'));
  } catch (err) {
    errors.push(src + ': ' + err.message);
  }
}

const w = dom.window;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await sleep(400);
  const api = w.__raceAiNote;
  const out = { errors };
  if (!api) {
    console.log(JSON.stringify({ errors, api: 'MISSING' }, null, 2));
    process.exit(1);
  }
  const g = api.graph;
  out.demoStats = g.stats;
  out.graphNodes = api.state.nodes.length;
  out.graphLinks = api.state.links.length;
  out.treeRows = w.document.querySelectorAll('#file-tree .tree-file').length;

  // 笔记视图
  const first = g.notes[0];
  api.openNote(first.id);
  out.noteTitle = w.document.querySelector('#note-title').textContent;
  out.noteBodyBlocks = w.document.querySelectorAll('#note-body > *').length;
  out.backlinks = w.document.querySelectorAll('#backlinks li').length;
  out.noteMeta = w.document.querySelector('#note-meta').textContent;
  out.notePaneVisible = !w.document.querySelector('#pane-note').hidden;

  // 视图切换
  api.showView('graph');
  out.graphPaneVisible = !w.document.querySelector('#pane-graph').hidden;
  out.graphToolsVisible = !w.document.querySelector('#graph-tools').hidden;
  api.showView('note');

  // 搜索
  api.state.query = 'tag:错题';
  api.rebuild({});
  out.searchNodes = api.state.nodes.length;
  api.state.query = '';

  // AI 面板（本地分析模式）
  await api.ai.send('这个库里哪些笔记还没有被链接？');
  await sleep(120);
  out.aiMessages = w.document.querySelectorAll('#ai-log .ai-msg').length;
  out.aiLastText = (w.document.querySelector('#ai-log .ai-msg:last-child .ai-bubble') || {}).textContent || '';

  // 双链跳转
  out.openByTitle = api.openNoteByTitle('导数及其应用');
  out.noteAfterJump = w.document.querySelector('#note-title').textContent;

  // 设置窗口：保存配置并校验模式
  api.openPrefs();
  out.prefsVisible = !w.document.querySelector('#prefs-modal').hidden;
  w.document.querySelector('#prefs-mode').value = 'direct';
  w.document.querySelector('#prefs-baseurl').value = 'https://api.example.com/v1';
  w.document.querySelector('#prefs-model').value = 'test-model';
  w.document.querySelector('#prefs-key').value = 'sk-test-1234567890';
  w.document.querySelector('#prefs-save').click();
  await sleep(150);
  out.savedMode = api.ai.state.config.mode;
  out.savedModel = api.ai.state.config.model;
  out.aiMode = api.ai.state.mode;
  out.modelsBtn = Boolean(w.document.querySelector('#prefs-models'));
  const mr = await api.ai.fetchModels({ mode: 'proxy' });
  out.fetchModelsOk = typeof mr.ok === 'boolean';
  await api.ai.applyConfig({ mode: 'local' });
  api.applyAskMode('tutor');
  const tutorBefore = api.ai.threads().tutor.length;
  await api.ai.send('这道题我不会做，帮我一步步讲清楚');
  await sleep(120);
  out.tutorMode = api.ai.state.askMode;
  out.tutorAnswer = (w.document.querySelector('#ai-log .ai-msg:last-child .ai-bubble') || {}).textContent || '';
  out.hasTutorHint = out.tutorAnswer.includes('框架引导');
  api.applyAskMode('notes');
  out.notesMode = api.ai.state.askMode;
  out.tutorThread = api.ai.threads().tutor.length;
  out.notesThread = api.ai.threads().notes.length;
  out.threadsSeparated = out.tutorThread > out.notesThread;
  out.tutorBefore = tutorBefore;
  out.keyNotInDom = !w.document.documentElement.innerHTML.includes('sk-test-1234567890');

  console.log(JSON.stringify(out, null, 2));
  process.exit(errors.length ? 1 : 0);
})();
