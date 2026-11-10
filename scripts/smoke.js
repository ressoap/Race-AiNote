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
  // 错题本流程：答疑 → 待解决记录 → 记入 → 已解决 → 去重
  w.localStorage.removeItem('race-ainote:mistakes');
  api.ai.renderRecords();
  api.applyAskMode('tutor');
  await api.ai.send('这道导数题求切线方程，帮我讲讲');
  await sleep(120);
  out.recordAfterAnswer = api.ai.records().length;
  out.recordInitialStatus = api.ai.records()[0] && api.ai.records()[0].status;
  const bars = [...w.document.querySelectorAll('.ai-mistake')];
  const bar = bars[bars.length - 1];
  out.mistakeBar = Boolean(bar);
  if (bar) bar.querySelector('.ghost-btn').click();
  await sleep(60);
  const sel = bar.querySelector('.ai-mistake-select');
  out.mistakeCandidates = sel ? sel.options.length : 0;
  out.mistakeSuggested = sel ? sel.options[sel.selectedIndex].text : null;
  const okBtn = bar.querySelector('.primary-btn');
  if (okBtn) okBtn.click();
  await sleep(150);
  const afterSave = api.ai.records();
  out.mistakeRecords = afterSave.length;
  out.recordStatus = afterSave[0] && afterSave[0].status;
  out.recordTarget = afterSave[0] && afterSave[0].targetTitle;
  out.recordColumn = w.document.querySelectorAll('#ai-record-list .ai-record').length;
  out.badge = (w.document.querySelector('.ai-record-badge') || {}).textContent;

  // 同一个问题再问一次：不得重复记录，且直接显示已解决
  await api.ai.send('这道导数题求切线方程，帮我讲讲');
  await sleep(150);
  out.recordsAfterRepeat = api.ai.records().length;
  out.repeatShowsDone = Boolean([...w.document.querySelectorAll('.ai-mistake-done')].length);

  // 标记已解决（不记入错题本）
  await api.ai.send('为什么导数的几何意义是切线斜率');
  await sleep(150);
  const lastBar = [...w.document.querySelectorAll('.ai-mistake')].pop();
  const btns = [...lastBar.querySelectorAll('.ghost-btn')];
  const resolveBtn = btns.find(b => b.textContent === '标记已解决');
  if (resolveBtn) resolveBtn.click();
  await sleep(120);
  const all = api.ai.records();
  out.recordCountFinal = all.length;
  out.allResolved = all.every(r => r.status === 'resolved');
  out.archivedMsgs = api.ai.threads().tutor.filter(m => m.archived).length;
  // 富文本编辑：渲染 → 用户排版 → 转回 Markdown
  api.openNoteByTitle('导数及其应用');
  w.document.querySelector('#btn-note-edit').click();
  const editor = w.document.querySelector('#note-editor');
  out.editorIsRich = !editor.hidden && editor.getAttribute('contenteditable') === 'true';
  editor.innerHTML = '<h2>T</h2><p>有 <b>粗</b> 与 <u>线</u> 和 <span class="md-link" data-wikilink="磁场">磁场</span></p>';
  w.document.querySelector('#btn-note-edit').click();
  await sleep(120);
  const edited = api.graph.notes.find(n => n.title === '导数及其应用').content;
  out.editorMarkdown = edited.trim();
  out.editorKeepsBold = edited.includes('**粗**');
  out.editorKeepsUnderline = edited.includes('<u>线</u>');
  out.editorKeepsWikiLink = edited.includes('[[磁场]]');
  out.selToolbarExists = Boolean(w.document.querySelector('#sel-toolbar'));
  out.linkPickerExists = Boolean(w.document.querySelector('#link-picker'));
  // AI 优化格式：接口存在且按钮可用（本地模式走规则整理）
  out.hasOptimizeFormat = typeof api.ai.optimizeFormat === 'function';
  const messy = ['- 第一点', '1、第二点', '一、小标题', '普通段落', '', '', '结尾'].join(String.fromCharCode(10));
  const tidy = await api.ai.optimizeFormat(messy);
  out.formatted = tidy;
  out.formatWorks = (tidy.text || '').includes('1. 第二点') && (tidy.text || '').includes('- 第一点') && !(tidy.text || '').includes('1、');
  out.formatUsed = tidy.used;
  out.formatKeepsText = w.RG.ai.plainTextOf(tidy.text) === w.RG.ai.plainTextOf(messy);
  // 云同步：四种云盘、夸克明确不支持、GitHub/Gitee 走官方接口
  out.cloudProviders = [...w.document.querySelectorAll('#cloud-provider option')].map(o => o.value);
  out.hasQuark = out.cloudProviders.includes('quark');
  w.document.querySelector('#cloud-provider').value = 'quark';
  w.document.querySelector('#cloud-provider').dispatchEvent(new w.Event('change'));
  out.quarkDisabled = w.document.querySelector('#cloud-backup').disabled;
  out.quarkHint = w.document.querySelector('#cloud-hint').textContent.includes('官方');
  w.document.querySelector('#cloud-provider').value = 'github';
  w.document.querySelector('#cloud-provider').dispatchEvent(new w.Event('change'));
  out.githubFields = w.document.querySelectorAll('#cloud-fields [data-cloud-key]').length;
  out.cloudApi = typeof w.RG.cloud.backup === 'function' && typeof w.RG.cloud.restore === 'function';
  // 文件树：多级目录 + 新建/重命名/删除
  out.treeFolders = w.document.querySelectorAll('#file-tree .tree-folder').length;
  const filesBefore = api.state.files.length;
  w.prompt = () => '冒烟新笔记';
  w.document.querySelector('#btn-new-note').click();
  await sleep(120);
  out.createdNote = api.state.files.length === filesBefore + 1;
  out.createdPath = (api.state.files[api.state.files.length - 1] || {}).path;
  out.vaultPersisted = Boolean(w.localStorage.getItem('race-ainote:vault'));

  // 右键重命名
  const firstRow = w.document.querySelector('#file-tree .tree-file');
  firstRow.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  out.menuVisible = !w.document.querySelector('#tree-menu').hidden;
  w.prompt = () => '冒烟改名';
  [...w.document.querySelectorAll('#tree-menu button')].find(b => b.dataset.act === 'rename').click();
  await sleep(120);
  out.renamed = api.state.files.some(f => f.path.includes('冒烟改名'));

  // 右键删除
  const rowNow = w.document.querySelector('#file-tree .tree-file');
  rowNow.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  const filesBeforeDelete = api.state.files.length;
  w.confirm = () => true;
  [...w.document.querySelectorAll('#tree-menu button')].find(b => b.dataset.act === 'delete').click();
  await sleep(120);
  out.deleted = api.state.files.length === filesBeforeDelete - 1;
  out.keyNotInDom = !w.document.documentElement.innerHTML.includes('sk-test-1234567890');

  console.log(JSON.stringify(out, null, 2));
  process.exit(errors.length ? 1 : 0);
})();
