const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
require('./build-app.js').writeApp();
require('./build-ai.js').writeAi();
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
const fillDialog = async value => {
  const modal = w.document.querySelector('#input-dialog');
  if (!modal || modal.hidden) return false;
  w.document.querySelector('#input-dialog-field').value = value;
  w.document.querySelector('#input-dialog-ok').click();
  await sleep(80);
  return true;
};
const acceptConfirm = async () => {
  const modal = w.document.querySelector('#confirm-dialog');
  if (!modal || modal.hidden) return false;
  w.document.querySelector('#confirm-dialog-ok').click();
  await sleep(80);
  return true;
};

(async () => {
  await sleep(400);
  const api = w.__raceAiNote;
  const scopedKey = name => w.RG.store.scopedKey(name, api.state.vaultId);
  // 启动即停在进入页：先关掉，后面的快捷键与工作区断言才和真实使用一致
  if (api && api.closeLauncher) api.closeLauncher();
  const out = { errors };
  if (!api) {
    console.log(JSON.stringify({ errors, api: 'MISSING' }, null, 2));
    process.exit(1);
  }
  out.newApiAlias = Boolean(w.__wenmoNotes && w.__wenmoNotes === api);
  const g = api.graph;
  out.demoStats = g.stats;
  out.graphNodes = api.state.nodes.length;
  out.graphLinks = api.state.links.length;
  out.treeRows = w.document.querySelectorAll('#file-tree .tree-file').length;
  out.nestedFolderDepth = Boolean(w.document.querySelector('#file-tree .tree-folder[data-depth="1"]'));
  out.mistakeSubjectFolders = ['数学', '物理'].every(name => [...w.document.querySelectorAll('#file-tree .tree-folder .file-name')].some(el => el.textContent === name));
  const collapseBtn = w.document.querySelector('#btn-collapse-all');
  const expandBtn = w.document.querySelector('#btn-expand-all');
  out.collapseExpandButtons = Boolean(collapseBtn && expandBtn);
  const toolbarItems = [...w.document.querySelector('.toolbar').children];
  const pluginMenuIndex = toolbarItems.indexOf(w.document.querySelector('#btn-plugin-menu'));
  const teacherIndex = toolbarItems.indexOf(w.document.querySelector('#btn-teacher'));
  const prefsIndex = toolbarItems.indexOf(w.document.querySelector('#btn-prefs'));
  out.pluginMenuNearSettings = pluginMenuIndex > 0 && teacherIndex === pluginMenuIndex + 1 && prefsIndex === teacherIndex + 1;
  if (collapseBtn && expandBtn) {
    collapseBtn.click();
    await sleep(60);
    out.collapsedFoldersAfterClick = w.document.querySelectorAll('#file-tree .tree-children[hidden]').length;
    expandBtn.click();
    await sleep(60);
    out.expandedFoldersAfterClick = w.document.querySelectorAll('#file-tree .tree-children[hidden]').length;
    out.expandWorked = out.collapsedFoldersAfterClick > 0 && out.expandedFoldersAfterClick === 0;
  }

  // 笔记视图
  const first = g.notes[0];
  api.openNote(first.id);
  out.noteTitle = w.document.querySelector('#note-title').textContent;
  out.noteBodyBlocks = w.document.querySelectorAll('#note-body > *').length;
  out.backlinks = w.document.querySelectorAll('#backlinks li').length;
  out.noteMeta = w.document.querySelector('#note-meta').textContent;
  out.notePaneVisible = !w.document.querySelector('#pane-note').hidden;

  // 浏览器式笔记标签页：打开、选中、拖动排序、关闭
  out.noteTabStrip = Boolean(w.document.querySelector('#note-tab-strip'));
  out.noteTabFirst = w.document.querySelectorAll('#note-tabs .note-tab').length;
  out.noteTabActive = Boolean(w.document.querySelector('#note-tabs .note-tab.is-active'));
  const second = g.notes.find(n => n.id !== first.id);
  api.openNote(second.id);
  out.noteTabSecond = w.document.querySelectorAll('#note-tabs .note-tab').length;
  const firstTab = [...w.document.querySelectorAll('#note-tabs .note-tab')].find(el => el.dataset.id === first.id);
  if (firstTab) firstTab.click();
  await sleep(40);
  out.noteTabClickSwitches = w.document.querySelector('#note-title').textContent === first.title;
  const tabEls = [...w.document.querySelectorAll('#note-tabs .note-tab')];
  const firstTabEl = tabEls.find(el => el.dataset.id === first.id);
  const secondTabEl = tabEls.find(el => el.dataset.id === second.id);
  if (firstTabEl && secondTabEl) {
    const dt = { effectAllowed: '', dropEffect: '', types: [], files: [], setData() {}, getData() { return ''; } };
    const dragStart = new w.Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dt });
    firstTabEl.dispatchEvent(dragStart);
    const dragOver = new w.Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, 'dataTransfer', { value: dt });
    Object.defineProperty(dragOver, 'clientX', { value: 1 });
    secondTabEl.dispatchEvent(dragOver);
    const drop = new w.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    Object.defineProperty(drop, 'clientX', { value: 1 });
    secondTabEl.dispatchEvent(drop);
    await sleep(40);
  }
  out.noteTabReordered = api.state.openTabs[0] === second.id && api.state.openTabs[1] === first.id;
  out.noteTabsSaved = JSON.parse(w.localStorage.getItem(scopedKey('noteTabs')) || '{}').tabs.length >= 2;
  const activeClose = w.document.querySelector('#note-tabs .note-tab.is-active .note-tab-close');
  if (activeClose) activeClose.click();
  await sleep(40);
  out.noteTabCloseSwitches = w.document.querySelector('#note-title').textContent === second.title;
  out.noteTabCloseCount = w.document.querySelectorAll('#note-tabs .note-tab').length;
  api.openNote(first.id);

  // 本地文件夹写回：用假的 FileSystemDirectoryHandle 验证只写变更文件
  const diskTarget = api.state.files.find(f => /\.md$/i.test(f.path));
  const diskWrites = new Map();
  const makeFakeDir = prefix => ({
    getDirectoryHandle: async name => makeFakeDir(prefix + name + '/'),
    getFileHandle: async name => ({
      createWritable: async () => ({
        write: async content => { diskWrites.set(prefix + name, String(content)); },
        close: async () => {}
      })
    }),
    removeEntry: async name => { diskWrites.delete(prefix + name); }
  });
  if (diskTarget) {
    const diskOriginal = diskTarget.content;
    api.bindDiskRoot(makeFakeDir(''), api.state.files);
    diskTarget.content = diskOriginal + '\n\n磁盘同步测试';
    await api.syncDiskNow();
    out.diskWriteBack = String(diskWrites.get(diskTarget.path) || '').includes('磁盘同步测试');
    diskTarget.content = diskOriginal;
    api.resetDiskBinding();
    out.diskBindingReset = api.state.rootHandle === null;
  }

  // 视图切换
  api.showView('graph');
  out.graphPaneVisible = !w.document.querySelector('#pane-graph').hidden;
  out.graphToolsVisible = !w.document.querySelector('#graph-tools').hidden;

  // 图谱右键菜单：分组、收藏、移动选择器
  const menuNode = g.notes.find(n => n.type === 'note');
  api.openGraphMenu({ clientX: 120, clientY: 120 }, menuNode);
  out.graphMenuVisible = !w.document.querySelector('#graph-menu').hidden;
  out.graphMenuTitle = w.document.querySelector('#graph-menu-title').textContent === menuNode.title;
  out.graphMenuGroups = w.document.querySelectorAll('#graph-menu .graph-menu-group').length >= 5;
  out.graphMenuItemCount = w.document.querySelectorAll('#graph-menu button').length >= 10;
  const favBtn = w.document.querySelector('#graph-menu button[data-act="favorite"]');
  if (favBtn) favBtn.click();
  await sleep(50);
  out.graphFavorite = api.state.favorites.has(menuNode.path);
  out.graphFavoriteStar = [...w.document.querySelectorAll('#file-tree .file-fav')].length > 0;
  api.openGraphMenu({ clientX: 120, clientY: 120 }, menuNode);
  const unfavBtn = w.document.querySelector('#graph-menu button[data-act="favorite"]');
  if (unfavBtn) unfavBtn.click();
  await sleep(50);
  out.graphFavoriteToggle = !api.state.favorites.has(menuNode.path);
  api.openGraphMenu({ clientX: 120, clientY: 120 }, menuNode);
  const moveBtn = w.document.querySelector('#graph-menu button[data-act="move"]');
  if (moveBtn) moveBtn.click();
  await sleep(50);
  out.graphMovePicker = !w.document.querySelector('#graph-picker').hidden
    && w.document.querySelectorAll('#graph-picker-list .link-picker-item').length > 0;
  w.document.querySelector('#graph-picker-close').click();
  await sleep(30);
  out.graphPickClosed = w.document.querySelector('#graph-picker').hidden;
  api.showView('note');

  // 搜索
  api.state.query = 'tag:错题';
  api.rebuild({});
  out.searchNodes = api.state.nodes.length;
  api.state.query = '';

  // AI 面板（本地分析模式）
  await api.ai.send('这个库里哪些笔记还没有被链接？');
  await sleep(120);
  out.useNoteDefaultOff = !w.document.querySelector('#ai-use-note').checked;
  out.aiMessages = w.document.querySelectorAll('#ai-log .ai-msg').length;
  out.aiLastText = (w.document.querySelector('#ai-log .ai-msg:last-child .ai-bubble') || {}).textContent || '';
  out.imageAttachApi = typeof api.ai.addImageFiles === 'function';
  out.photoButton = Boolean(w.document.querySelector('#btn-photo') && w.document.querySelector('#photo-input'));
  out.photoApi = typeof api.ai.recognizeImage === 'function';
  const photoLocal = await api.ai.recognizeImage(new w.File([new Uint8Array([137, 80, 78, 71])], 'photo-test.png', { type: 'image/png' }));
  out.photoLocalGuard = Boolean(photoLocal && photoLocal.ok === false && /视觉模型/.test(photoLocal.error || ''));
  out.imageEmptyAdd = out.imageAttachApi ? (await api.ai.addImageFiles([])) === 0 : false;
  out.attachmentBox = Boolean(w.document.querySelector('#ai-attachments'));
  const inputResizer = w.document.querySelector('#ai-input-resizer');
  out.inputResizer = Boolean(inputResizer);
  out.inputInitialHeight = w.document.querySelector('#ai-text').style.height;
  if (inputResizer) {
    inputResizer.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    out.inputResetHeight = w.document.querySelector('#ai-text').style.height === '104px';
    inputResizer.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 300 }));
    inputResizer.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientY: 200 }));
    out.inputDragHeight = w.document.querySelector('#ai-text').style.height;
    out.inputDragResized = out.inputDragHeight !== '104px';
    inputResizer.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
    out.inputHeightSaved = Boolean(w.localStorage.getItem(w.RG.store.KEYS.aiInputHeight));
  }

  // 左侧栏右侧分割线：拖动可拉宽并记忆
  const sidebarResizer = w.document.querySelector('#sidebar-resizer');
  out.sidebarResizer = Boolean(sidebarResizer);
  if (sidebarResizer) {
    const sidebarBefore = w.document.documentElement.style.getPropertyValue('--sidebar-w');
    sidebarResizer.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200 }));
    sidebarResizer.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 300 }));
    out.sidebarWidthBefore = sidebarBefore;
    out.sidebarDragWidth = w.document.documentElement.style.getPropertyValue('--sidebar-w');
    out.sidebarDragResized = out.sidebarDragWidth !== sidebarBefore;
    sidebarResizer.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
    out.sidebarWidthSaved = Boolean(w.localStorage.getItem(w.RG.store.KEYS.sidebarWidth));
    sidebarResizer.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    out.sidebarReset = w.document.documentElement.style.getPropertyValue('--sidebar-w') === '268px';
  }

  // AI 面板左侧分割线：拖动可扩宽并记忆
  const aiResizer = w.document.querySelector('#ai-resizer');
  out.aiPanelResizer = Boolean(aiResizer);
  if (aiResizer) {
    aiResizer.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 900 }));
    aiResizer.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 800 }));
    out.aiPanelWidth = w.document.documentElement.style.getPropertyValue('--ai-panel-w');
    out.aiPanelResized = out.aiPanelWidth !== '560px';
    aiResizer.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
    out.aiPanelWidthSaved = Boolean(w.localStorage.getItem(w.RG.store.KEYS.aiPanelWidth));
    aiResizer.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    out.aiPanelReset = w.document.documentElement.style.getPropertyValue('--ai-panel-w') === '560px';
  }

  // 图片拖入 AI 面板：只生成聊天附件，不能触发全库载入
  const filesBeforeDrop = api.state.files.length;
  const RealImage = w.Image;
  w.Image = class FakeImage {
    constructor() { this.width = 100; this.height = 80; }
    set src(value) {
      this._src = value;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  };
  try {
    const imageFile = new w.File([new Uint8Array([137, 80, 78, 71])], 'drop-test.png', { type: 'image/png' });
    const dropEvent = new w.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { types: ['Files'], files: [imageFile], dropEffect: 'copy' } });
    w.document.querySelector('#ai-panel').dispatchEvent(dropEvent);
    await sleep(250);
    out.imageDropNoVaultChange = api.state.files.length === filesBeforeDrop;
    out.imageDropPreview = w.document.querySelectorAll('#ai-attachments .ai-attachment').length === 1;
    const removeImage = w.document.querySelector('.ai-attachment-remove');
    if (removeImage) removeImage.click();
    await sleep(40);
    out.imageDropCleared = w.document.querySelector('#ai-attachments').hidden;

    // 图片入口：按钮 + 输入框 + 粘贴
    out.aiImageButton = Boolean(w.document.querySelector('#ai-attach-image'));
    out.aiImageInput = Boolean(w.document.querySelector('#ai-image-input'));
    const pasteEvent = new w.Event('paste', { bubbles: true, cancelable: true });
    const pasteFile = new w.File([new Uint8Array([137, 80, 78, 71])], 'paste-test.png', { type: 'image/png' });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => pasteFile }] }
    });
    w.document.querySelector('#ai-text').dispatchEvent(pasteEvent);
    await sleep(250);
    out.aiImagePaste = w.document.querySelectorAll('#ai-attachments .ai-attachment').length === 1;
    const pasteRemove = w.document.querySelector('.ai-attachment-remove');
    if (pasteRemove) pasteRemove.click();
  } finally {
    w.Image = RealImage;
  }

  // 双链跳转
  out.openByTitle = api.openNoteByTitle('导数及其应用');
  out.noteAfterJump = w.document.querySelector('#note-title').textContent;

  // 设置窗口：保存配置并校验模式
  api.openPrefs();
  out.prefsVisible = !w.document.querySelector('#prefs-modal').hidden;
  w.document.querySelector('#prefs-mode').value = 'direct';
  w.document.querySelector('#prefs-baseurl').value = 'https://api.example.com/v1';
  w.document.querySelector('#prefs-model').value = 'test-model';
  w.document.querySelector('#prefs-vision-model').value = 'test-vision';
  w.document.querySelector('#prefs-key').value = 'sk-test-1234567890';
  w.document.querySelector('#prefs-save').click();
  await sleep(150);
  out.savedMode = api.ai.state.config.mode;
  out.savedModel = api.ai.state.config.model;
  out.savedVisionModel = api.ai.state.config.visionModel;
  out.visionModelField = Boolean(w.document.querySelector('#prefs-vision-model'));
  out.aiMode = api.ai.state.mode;
  out.modelsBtn = Boolean(w.document.querySelector('#prefs-models'));
  const mr = await api.ai.fetchModels({ mode: 'proxy' });
  out.fetchModelsOk = typeof mr.ok === 'boolean';
  await api.ai.applyConfig({ mode: 'local' });
  const savedAi = JSON.parse(w.localStorage.getItem(w.RG.store.KEYS.aiConfig) || '{}');
  out.keyClearedInLocalMode = api.ai.state.config.key === '' && savedAi.key === '';
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
  const STORE = w.RG.store.KEYS;
  w.localStorage.removeItem(STORE.records);
  api.ai.renderRecords();
  api.applyAskMode('tutor');
  await api.ai.send('这道导数题求切线方程，帮我讲讲');
  await sleep(120);
  out.recordAfterAnswer = api.ai.records().length;
  const initialRecord = api.ai.records()[0] || {};
  out.recordInitialStatus = initialRecord.status;
  out.initialOpenWithTarget = initialRecord.status === 'open' && Boolean(initialRecord.targetTitle);
  out.recordInitialTarget = initialRecord.targetTitle;
  out.recordInitialSubject = initialRecord.subject;
  out.recordInitialKnowledge = Array.isArray(initialRecord.knowledgePoints) ? initialRecord.knowledgePoints.length : 0;
  const bars = [...w.document.querySelectorAll('.ai-mistake')];
  const bar = bars[bars.length - 1];
  out.mistakeBar = Boolean(bar);
  out.autoFiledBar = Boolean(bar && bar.querySelector('.ai-mistake-done'));
  if (bar) {
    const resolve = [...bar.querySelectorAll('.ghost-btn')].find(b => b.textContent === '标记已解决');
    if (resolve) resolve.click();
  }
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
  // 云同步：只保留有官方接口的三种云盘
  out.cloudProviders = [...w.document.querySelectorAll('#cloud-provider option')].map(o => o.value);
  out.noQuark = !out.cloudProviders.includes('quark');
  w.document.querySelector('#cloud-provider').value = 'github';
  w.document.querySelector('#cloud-provider').dispatchEvent(new w.Event('change'));
  out.githubFields = w.document.querySelectorAll('#cloud-fields [data-cloud-key]').length;
  out.cloudApi = typeof w.RG.cloud.backup === 'function' && typeof w.RG.cloud.restore === 'function';
  // 文件树：多级目录 + 新建/重命名/删除
  out.treeFolders = w.document.querySelectorAll('#file-tree .tree-folder').length;
  const filesBefore = api.state.files.length;
  w.document.querySelector('#btn-new-note').click();
  await sleep(60);
  out.createdDialog = await fillDialog('冒烟新笔记');
  await sleep(120);
  out.createdNote = api.state.files.length === filesBefore + 1;
  out.createdPath = (api.state.files[api.state.files.length - 1] || {}).path;
  out.vaultPersisted = Boolean(w.localStorage.getItem(STORE.vault));

  // 右键重命名
  const firstRow = w.document.querySelector('#file-tree .tree-file');
  firstRow.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  out.menuVisible = !w.document.querySelector('#tree-menu').hidden;
  [...w.document.querySelectorAll('#tree-menu button')].find(b => b.dataset.act === 'rename').click();
  await sleep(60);
  out.renameDialog = await fillDialog('冒烟改名');
  await sleep(120);
  out.renamed = api.state.files.some(f => f.path.includes('冒烟改名'));

  // 右键删除
  const rowNow = w.document.querySelector('#file-tree .tree-file');
  rowNow.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  const filesBeforeDelete = api.state.files.length;
  [...w.document.querySelectorAll('#tree-menu button')].find(b => b.dataset.act === 'delete').click();
  await sleep(60);
  out.deleteConfirm = await acceptConfirm();
  await sleep(120);
  out.deleted = api.state.files.length === filesBeforeDelete - 1;
  // 排序：默认按使用频率；拖拽后转手动
  out.defaultSort = api.state.sortMode;
  const idxOf = name => [...w.document.querySelectorAll('#file-tree .tree-file .file-name')].findIndex(e => e.textContent === name);
  const targetNote = api.graph.notes.find(n => n.title === '磁场');
  for (let i = 0; i < 4; i++) api.openNote(targetNote.id);
  await sleep(100);
  out.usageCount = (api.state.usage['30-物理/磁场.md'] || {}).count;
  const beforeIdx = idxOf('圆周运动与万有引力');
  api.handleDrop('note:30-物理/圆周运动与万有引力.md', { kind: 'note', path: '30-物理/磁场.md', after: false, parent: '30-物理' });
  await sleep(200);
  out.sortAfterDrag = api.state.sortMode;
  out.dragMoved = idxOf('圆周运动与万有引力') < idxOf('磁场');
  out.orderSaved = Boolean(w.localStorage.getItem(scopedKey('order')));
  // 老师性格：设置按钮左侧的独立入口 + 文本约束 + 四维滑杆
  const teacherBtn = w.document.querySelector('#btn-teacher');
  const toolbarForTeacher = [...w.document.querySelector('.toolbar').children];
  out.teacherButtonLeftOfSettings = Boolean(teacherBtn && toolbarForTeacher.indexOf(teacherBtn) + 1 === toolbarForTeacher.indexOf(w.document.querySelector('#btn-prefs')));
  if (teacherBtn) teacherBtn.click();
  await sleep(60);
  out.teacherModalOpened = Boolean(w.document.querySelector('#teacher-modal') && !w.document.querySelector('#teacher-modal').hidden);
  const teacherProfile = w.document.querySelector('#teacher-profile');
  out.teacherModule = Boolean(teacherProfile && w.document.querySelector('#teacher-save'));
  out.teacherTraitSliders = w.document.querySelectorAll('.teacher-trait input[type="range"]').length;
  if (teacherProfile) {
    teacherProfile.value = '先让我说思路，再一步步讲，不要直接给答案。';
    teacherProfile.dispatchEvent(new w.Event('input', { bubbles: true }));
    const lively = w.document.querySelector('#teacher-lively');
    if (lively) {
      lively.value = '80';
      lively.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
    w.document.querySelector('#teacher-save').click();
    await sleep(180);
    const savedTeacher = JSON.parse(w.localStorage.getItem(STORE.aiConfig) || '{}');
    out.teacherSaved = api.ai.state.config.teacherProfile.includes('先让我说思路')
      && api.ai.state.config.teacherTraits.lively === 80;
    out.teacherConfigSaved = String(savedTeacher.teacherProfile || '').includes('先让我说思路')
      && savedTeacher.teacherTraits && savedTeacher.teacherTraits.lively === 80;
    out.teacherPromptApplied = w.RG.ai.buildTeacherPrompt(api.ai.state.config).includes('先让我说思路');
  }
  const teacherReset = w.document.querySelector('#teacher-reset');
  out.teacherResetButton = Boolean(teacherReset);
  if (teacherReset) {
    teacherReset.click();
    await sleep(50);
    out.teacherResetConfirm = await acceptConfirm();
    await sleep(180);
    out.teacherReset = api.ai.state.config.teacherProfile === ''
      && api.ai.state.config.teacherTraits.lively === 50
      && api.ai.state.config.teacherTraits.detail === 60
      && api.ai.state.config.teacherTraits.guidance === 45
      && api.ai.state.config.teacherTraits.correction === 55;
  }
  w.document.querySelector('#teacher-close').click();
  await sleep(50);
  out.teacherModalClosed = w.document.querySelector('#teacher-modal').hidden;
  w.document.querySelector('#btn-prefs').click();
  await sleep(60);
  w.document.querySelector('#plugin-sample').click();
  await sleep(150);
  out.pluginCount = api.pluginHost.list().length;
  out.pluginButtons = w.document.querySelectorAll('#plugin-buttons .plugin-btn').length;
  out.pluginCommands = api.pluginHost.commands().length;
  out.pluginWidgets = w.document.querySelectorAll('#plugin-widgets .plugin-widget').length;
  out.pluginRows = w.document.querySelectorAll('#plugin-list .plugin-row').length;

  // 停用再启用
  const firstToggle = w.document.querySelector('#plugin-list .plugin-row .ghost-btn');
  firstToggle.click();
  await sleep(120);
  out.afterDisable = api.pluginHost.list().filter(p => p.enabled).length;
  w.document.querySelector('#plugin-list .plugin-row .ghost-btn').click();
  await sleep(120);
  out.afterEnable = api.pluginHost.list().filter(p => p.enabled).length;

  // 卸载全部
  for (const row of [...w.document.querySelectorAll('#plugin-list .plugin-row')]) {
    const btns = [...row.querySelectorAll('.ghost-btn')];
    btns[btns.length - 1].click();
    await sleep(60);
    out.pluginUninstallConfirm = await acceptConfirm();
    await sleep(60);
  }
  out.afterUninstall = api.pluginHost.list().length;
  // 问题记录：日期分块 / 搜索 / 左键详情 / 右键菜单 / 时间排序 / 删除
  w.localStorage.removeItem(STORE.records);
  api.ai.renderRecords();
  for (const q of ['导数题怎么下手', '磁场偏转角怎么求', '概率分布列怎么列', 'The report ______ by the end of next week. 选项：will have been finished / will be finished']) {
    await api.ai.send(q);
    await sleep(80);
  }
  const autoRecords = api.ai.records();
  out.recordCount = autoRecords.length;
  out.autoFiledAll = autoRecords.every(r => Boolean(r.targetTitle));
  out.autoTaggedAll = autoRecords.every(r => Boolean(r.subject) && Array.isArray(r.knowledgePoints) && r.knowledgePoints.length > 0);
  out.englishAutoFiled = autoRecords.some(r => r.subject === '英语' && /英语/.test(r.targetTitle || ''));
  const engFile = api.state.files.find(f => f.path === '10-错题本/英语/英语-错题索引.md');
  out.englishBookCreated = Boolean(engFile);
  out.autoHeading = Boolean(engFile && /^## .+ · \d{4}-\d{2}-\d{2}$/m.test(engFile.content));
  out.autoEnglishTag = Boolean(engFile && engFile.content.includes('**学科**：英语'));
  out.mistakePointTags = Boolean(engFile && engFile.content.indexOf('**知识点**：#') >= 0);
  out.mistakeTypeSaved = autoRecords.every(r => w.RG.ai.MISTAKE_TYPES.includes(r.mistakeType));
  out.mistakeTypeInBook = Boolean(engFile && engFile.content.indexOf('**错题类型**：') >= 0);
  out.mistakeTypeChip = w.document.querySelectorAll('#ai-record-list .ai-record-type').length > 0;
  out.mistakeTypeNormalized = w.RG.ai.normalizeMistakeType('思路不清') === '方法不会';
  out.sanitizePoints = w.RG.ai.sanitizeKnowledgePoints(['导数', '#导数', '数列 递推', '点、线']).join('|') === '导数|数列-递推|点线';
  const multiSnippet = w.RG.ai.mistakeSnippet({ question: 'q', answer: 'a', at: Date.now() }, { subject: '数学', knowledgePoints: ['导数', '数列', '三角'] });
  out.multiPointSnippet = multiSnippet.indexOf('**知识点**：#导数 #数列 #三角') >= 0;
  const bookContents = new Map(api.state.files.map(f => [f.path, String(f.content || '')]));
  out.allOriginalQuestionsArchived = autoRecords.every(r => !r.targetPath || w.RG.ai.mistakeContentHasQuestion(bookContents.get(r.targetPath) || '', r.question));
  out.originalQuestionHeading = Boolean(engFile && engFile.content.includes('### 原题目'));
  const latestBar = [...w.document.querySelectorAll('.ai-mistake')].pop();
  const latestResolve = latestBar && [...latestBar.querySelectorAll('.ghost-btn')].find(b => b.textContent === '标记已解决');
  if (latestResolve) latestResolve.click();
  await sleep(120);
  out.autoResolved = api.ai.records().some(r => r.status === 'resolved' && r.targetTitle);
  const domRecordIds = [...w.document.querySelectorAll('#ai-record-list .ai-record')].map(e => e.dataset.recordId);
  const atById = new Map(api.ai.records().map(r => [r.id, r.at]));
  out.recordsNewestFirst = domRecordIds.length < 2 || domRecordIds.every((id, i) => i === 0 || atById.get(domRecordIds[i - 1]) >= atById.get(id));
  out.recordDateBlocks = w.document.querySelectorAll('.record-date').length;
  const dateFilter = w.document.querySelector('#record-date-filter');
  out.recordDateFilter = Boolean(dateFilter);
  out.recordDateOptions = dateFilter ? dateFilter.options.length : 0;
  if (dateFilter && dateFilter.options.length > 1) {
    dateFilter.value = dateFilter.options[1].value;
    dateFilter.dispatchEvent(new w.Event('change'));
    await sleep(60);
    out.recordDateFiltered = w.document.querySelectorAll('#ai-record-list .ai-record').length > 0;
    dateFilter.value = '';
    dateFilter.dispatchEvent(new w.Event('change'));
    await sleep(60);
  }

  const rsearch = w.document.querySelector('#record-search');
  rsearch.value = '磁场';
  rsearch.dispatchEvent(new w.Event('input'));
  await sleep(80);
  out.recordSearchHits = w.document.querySelectorAll('#ai-record-list .ai-record').length;
  rsearch.value = '';
  rsearch.dispatchEvent(new w.Event('input'));
  await sleep(60);

  w.document.querySelector('#ai-record-list .ai-record').click();
  await sleep(80);
  out.recordDetailOpen = !w.document.querySelector('#record-inline').hidden;
  out.recordSubtabOpen = !w.document.querySelector('#record-subtab').hidden;
  out.recordInlineView = w.document.querySelector('.ai-chatcol').classList.contains('is-record-view');
  out.recordInlineQuestion = w.document.querySelector('#record-inline-question').textContent.length > 0;
  w.document.querySelector('#record-inline-close').click();
  await sleep(60);
  out.recordDetailClosed = w.document.querySelector('#record-inline').hidden && w.document.querySelector('#record-subtab').hidden;

  const unfiledCandidate = api.ai.records().find(r => r.status !== 'resolved' && r.targetTitle) || api.ai.records()[0];
  const recItem = [...w.document.querySelectorAll('#ai-record-list .ai-record')].find(e => e.dataset.recordId === unfiledCandidate.id) || w.document.querySelector('#ai-record-list .ai-record');
  const recItemId = recItem.dataset.recordId;
  recItem.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  await sleep(60);
  out.recordMenuOpen = !w.document.querySelector('#record-menu').hidden;
  out.recordMenuItems = [...w.document.querySelectorAll('#record-menu button')].length;
  [...w.document.querySelectorAll('#record-menu button')].find(b => b.dataset.act === 'toggle-mistake').click();
  await sleep(120);
  const afterUnfile = api.ai.records().find(r => r.id === recItemId) || {};
  out.recordUnfiled = !afterUnfile.targetTitle;
  const resolvedRec = api.ai.records().find(r => r.status === 'resolved' && r.targetTitle);
  if (resolvedRec) {
    const recEl = [...w.document.querySelectorAll('#ai-record-list .ai-record')].find(e => e.dataset.recordId === resolvedRec.id);
    if (recEl) {
      recEl.click();
      await sleep(80);
      out.recordLocateButton = !w.document.querySelector('#record-inline-locate').hidden;
      w.document.querySelector('#record-inline-locate').click();
      await sleep(180);
      out.recordLocated = w.document.querySelector('#note-title').textContent === resolvedRec.targetTitle;
      out.recordLocateHighlight = Boolean(w.document.querySelector('.record-locate-flash'));
      w.document.querySelector('#record-inline-close').click();
      await sleep(60);
    }
  }

  const recordEls = [...w.document.querySelectorAll('#ai-record-list .ai-record')];
  out.recordDragDisabled = recordEls.length > 0 && recordEls.every(el => !el.draggable);
  out.recordReorderApiRemoved = typeof api.ai.reorderRecords !== 'function';
  out.recordTimeSorted = domRecordIds.length < 2 || domRecordIds.every((id, i) => i === 0 || atById.get(domRecordIds[i - 1]) >= atById.get(id));

  const countBefore = api.ai.records().length;
  const delItem = w.document.querySelector('#ai-record-list .ai-record');
  delItem.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  await sleep(60);
  [...w.document.querySelectorAll('#record-menu button')].find(b => b.dataset.act === 'delete').click();
  await sleep(60);
  out.recordDeleteConfirm = await acceptConfirm();
  await sleep(100);
  out.recordDeleted = api.ai.records().length === countBefore - 1;
  // Ctrl+S 快捷保存：不打断编辑态（用当前任意一篇笔记，避免依赖具体标题）
  const anyNote = api.graph.notes[0];
  api.openNote(anyNote.id);
  await sleep(40);
  w.document.querySelector('#btn-note-edit').click();
  await sleep(60);
  const ed = w.document.querySelector('#note-editor');
  ed.innerHTML = '<h2>CtrlS 测试</h2><p>正文</p>';
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(120);
  out.quickSaveStaysEditing = !ed.hidden;
  const savedFile = api.state.files.find(f => f.path === anyNote.path);
  out.quickSaveWroteContent = Boolean(savedFile && String(savedFile.content).includes('CtrlS 测试'));
  const cached = JSON.parse(w.localStorage.getItem(STORE.vault) || '{"files":[]}').files.find(f => f.path === anyNote.path);
  out.quickSavePersisted = Boolean(cached && String(cached.content).includes('CtrlS 测试'));
  w.document.querySelector('#btn-note-edit').click();
  await sleep(100);
  out.editorClosedAfterToggle = ed.hidden;
  out.keyNotInDom = !w.document.documentElement.innerHTML.includes('sk-test-1234567890');

  // AI 问答中断：请求挂起时出现「停止」，点击后 abort、恢复输入并跳过记入记录
  const realFetch = w.fetch;
  const previousMode = api.ai.state.mode;
  const interruptQuestion = '中断测试：请写一段很长的回答';
  w.fetch = (url, opts = {}) => {
    if (String(url).includes('/api/chat')) {
      return new Promise((resolve, reject) => {
        const fail = () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (opts.signal && opts.signal.aborted) return fail();
        if (opts.signal) opts.signal.addEventListener('abort', fail, { once: true });
      });
    }
    return realFetch.call(w, url, opts);
  };
  api.ai.state.mode = 'proxy';
  out.stopApi = typeof api.ai.stop === 'function';
  const pendingSend = api.ai.send(interruptQuestion);
  await sleep(80);
  out.stopButtonVisible = !w.document.querySelector('#ai-stop').hidden;
  out.sendDisabledWhileBusy = w.document.querySelector('#ai-send').disabled;
  const stopEl = w.document.querySelector('#ai-stop');
  const sendEl = w.document.querySelector('#ai-send');
  out.stopAboveSend = Boolean(stopEl && sendEl && stopEl.parentElement === sendEl.parentElement
    && [...stopEl.parentElement.children].indexOf(stopEl) < [...stopEl.parentElement.children].indexOf(sendEl));
  w.document.querySelector('#ai-stop').click();
  await pendingSend.catch(() => {});
  await sleep(80);
  const interruptThread = api.ai.threads()[api.ai.state.askMode];
  const interruptLast = interruptThread[interruptThread.length - 1] || {};
  out.stopInterrupted = api.ai.state.busy === false;
  out.stopMessage = String(interruptLast.text || '').includes('已停止');
  out.stopButtonHidden = w.document.querySelector('#ai-stop').hidden;
  out.sendEnabledAfterStop = !w.document.querySelector('#ai-send').disabled;
  out.stopNoRecord = !api.ai.records().some(r => r.question === interruptQuestion);
  w.fetch = realFetch;
  api.ai.state.mode = previousMode;

  // ── 进入页：笔记库书本平铺 ──
  out.launcherApi = typeof api.openLauncher === 'function' && typeof api.enterVault === 'function' && typeof api.vaultLibrary === 'function';
  api.openLauncher();
  await sleep(80);
  const launcherEl = w.document.querySelector('#launcher');
  out.launcherVisible = Boolean(launcherEl) && !launcherEl.hidden;
  out.launcherBooks = w.document.querySelectorAll('#launcher .book').length >= 2;
  out.launcherAddCard = Boolean(w.document.querySelector('#launcher .book-add'));
  out.launcherDemoBook = Boolean(w.document.querySelector('#launcher .book[data-id="demo"]'));
  out.launcherDemoNoRemove = !w.document.querySelector('#launcher .book[data-id="demo"] .book-remove');
  const demoBookEl = w.document.querySelector('#launcher .book[data-id="demo"]');
  if (demoBookEl) demoBookEl.click();
  await sleep(150);
  out.launcherClosedOnEnter = launcherEl.hidden;
  out.launcherEnteredDemo = api.state.vaultId === 'demo' && api.state.files.length > 0;
  w.document.querySelector('#btn-vaults').click();
  await sleep(80);
  out.launcherSidebarButton = !launcherEl.hidden;
  w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(60);
  out.launcherEscOnBody = launcherEl.hidden;
  api.closeLauncher();
  out.launcherEscClosed = launcherEl.hidden;
  const demoUsagePaths = Object.keys(api.state.usage || {});
  api.loadFiles([{ path: 'a.md', content: '# A' }, { path: 'b.md', content: '# B' }], 'Smoke 测试库');
  const nextUsagePaths = Object.keys(api.state.usage || {});
  out.usageIsolated = demoUsagePaths.length > 0
    && nextUsagePaths.length > 0
    && nextUsagePaths.every(p => demoUsagePaths.indexOf(p) < 0);
  out.launcherVaultBookSaved = api.vaultLibrary().some(v => v.label === 'Smoke 测试库');

  // 记录按笔记库隔离：给新库塞 3 条自己的错题，demo 的 4 条不应串过来
  const allRecordsBefore = JSON.parse(w.localStorage.getItem(STORE.records) || '[]');
  const smokeVaultId = api.state.vaultId;
  w.localStorage.setItem(STORE.records, JSON.stringify(allRecordsBefore.concat([
    { id: 'seed-1', question: '导数题怎么下手', answer: 'a', at: Date.now(), subject: '数学', knowledgePoints: ['导数与函数单调性'], status: 'open', vaultId: smokeVaultId, targetPath: '10-错题本/数学/数学-错题索引.md', targetTitle: '数学-错题索引' },
    { id: 'seed-2', question: '磁场偏转角怎么求', answer: 'a', at: Date.now() - 1000, subject: '物理', knowledgePoints: ['洛伦兹力'], status: 'resolved', vaultId: smokeVaultId, targetPath: '10-错题本/物理/物理-错题索引.md', targetTitle: '物理-错题索引' },
    { id: 'seed-3', question: '圆锥曲线离心率怎么求', answer: 'a', at: Date.now() - 2000, subject: '数学', knowledgePoints: ['圆锥曲线'], status: 'open', vaultId: smokeVaultId, targetPath: '10-错题本/数学/数学-错题索引.md', targetTitle: '数学-错题索引' }
  ])));
  api.ai.renderRecords();
  out.vaultRecordsIsolated = api.ai.records().length === 3;
  api.openLauncher();
  await sleep(80);
  out.launcherVaultBookRendered = Boolean([...w.document.querySelectorAll('#launcher .book .book-title')].find(el => el.textContent === 'Smoke 测试库'));

  // 右侧错题分布看板
  out.statsTotal = Number(w.document.querySelector('#stats-total').textContent) > 0;
  out.statsPieArcs = w.document.querySelectorAll('#stats-pie circle').length >= 2;
  const legendRows = [...w.document.querySelectorAll('#stats-subjects li')];
  out.statsLegend = legendRows.length >= 1;
  const pctSum = legendRows.reduce((sum, li) => {
    const raw = (li.querySelector('b').textContent.split('·')[1] || '').replace('%', '').trim();
    return sum + (Number(raw) || 0);
  }, 0);
  out.statsPercentSum = pctSum === 100;
  out.statsPoints = w.document.querySelectorAll('#stats-points .stats-point-row').length >= 1;
  out.statsEmptyHidden = w.document.querySelector('#stats-empty').hidden;

  // 分析范围：按笔记库（全部 / 示例库 / 当前库）
  const scopeSelect = w.document.querySelector('#stats-scope-select');
  const optionTexts = [...scopeSelect.options].map(o => o.textContent);
  out.statsScopeSelect = scopeSelect.options.length === 3
    && optionTexts[0].indexOf('全部错题') === 0;
  out.statsScopeVaultOnly = optionTexts.every(t => t.indexOf('错题索引') < 0);
  const allRecordsNow = JSON.parse(w.localStorage.getItem(STORE.records) || '[]');
  const demoCount = allRecordsNow.filter(r => (r.vaultId || 'demo') === 'demo').length;
  const smokeCount = allRecordsNow.filter(r => r.vaultId === smokeVaultId).length;
  const smokeScopeOption = [...scopeSelect.options].find(o => o.value === smokeVaultId);
  out.statsScopeHasVaults = Boolean(smokeScopeOption)
    && scopeSelect.options.length === 3
    && Boolean([...scopeSelect.options].find(o => o.value === 'demo'));
  scopeSelect.value = smokeVaultId;
  scopeSelect.dispatchEvent(new w.Event('change'));
  await sleep(80);
  out.statsScopeSingle = w.document.querySelector('#stats-total').textContent === String(smokeCount);
  scopeSelect.value = '';
  scopeSelect.dispatchEvent(new w.Event('change'));
  await sleep(80);
  out.statsScopeAll = w.document.querySelector('#stats-total').textContent === String(demoCount + smokeCount);

  // 书本右键菜单：复制 / 改名 / 删除 / 备份 / 查看详情
  const smokeBook = [...w.document.querySelectorAll('#launcher .book')].find(el =>
    el.querySelector('.book-title') && el.querySelector('.book-title').textContent === 'Smoke 测试库');
  smokeBook.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 200 }));
  await sleep(60);
  const vaultMenu = w.document.querySelector('#vault-menu');
  out.vaultMenuOpened = !vaultMenu.hidden;
  out.vaultMenuItemCount = vaultMenu.querySelectorAll('button').length === 6;
  out.vaultMenuBackup = Boolean(vaultMenu.querySelector('button[data-act="backup"]'));

  [...vaultMenu.querySelectorAll('button')].find(b => b.dataset.act === 'detail').click();
  await sleep(60);
  out.vaultDetailOpened = !w.document.querySelector('#vault-detail').hidden;
  out.vaultDetailRows = w.document.querySelectorAll('#vault-detail-rows dt').length >= 5;
  w.document.querySelector('#vault-detail-close').click();
  out.vaultDetailClosed = w.document.querySelector('#vault-detail').hidden;

  smokeBook.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 200 }));
  await sleep(50);
  [...w.document.querySelectorAll('#vault-menu button')].find(b => b.dataset.act === 'rename').click();
  await sleep(60);
  await fillDialog('冒烟改名库');
  await sleep(90);
  out.vaultRenamed = api.vaultLibrary().some(v => v.label === '冒烟改名库');

  const renamedBook = [...w.document.querySelectorAll('#launcher .book')].find(el =>
    el.querySelector('.book-title') && el.querySelector('.book-title').textContent === '冒烟改名库');
  renamedBook.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 200 }));
  await sleep(50);
  const beforeCopy = api.vaultLibrary().length;
  [...w.document.querySelectorAll('#vault-menu button')].find(b => b.dataset.act === 'duplicate').click();
  await sleep(90);
  out.vaultDuplicated = api.vaultLibrary().length === beforeCopy + 1
    && api.vaultLibrary().some(v => v.label === '冒烟改名库 副本');

  const copyBook = [...w.document.querySelectorAll('#launcher .book')].find(el =>
    el.querySelector('.book-title') && el.querySelector('.book-title').textContent === '冒烟改名库 副本');
  copyBook.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 200 }));
  await sleep(50);
  [...w.document.querySelectorAll('#vault-menu button')].find(b => b.dataset.act === 'delete').click();
  await sleep(60);
  await acceptConfirm();
  await sleep(90);
  out.vaultDeleted = !api.vaultLibrary().some(v => v.label === '冒烟改名库 副本');
  out.vaultWentToTrash = api.vaultTrash().some(v => v.label === '冒烟改名库 副本');
  out.noHoverDelete = !w.document.querySelector('#launcher .book-remove');
  const trashed = api.vaultTrash().find(v => v.label === '冒烟改名库 副本');
  out.vaultRestored = Boolean(trashed) && api.restoreVaultBook(trashed.id) === true
    && api.vaultLibrary().some(v => v.label === '冒烟改名库 副本')
    && !api.vaultTrash().some(v => v.id === trashed.id);

  const demoBookEl2 = w.document.querySelector('#launcher .book[data-id="demo"]');
  demoBookEl2.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }));
  await sleep(50);
  out.vaultMenuDemoLimited = [...w.document.querySelectorAll('#vault-menu button')].filter(b => b.hidden).length === 3;
  api.closeVaultMenu();
  out.vaultMenuClosed = w.document.querySelector('#vault-menu').hidden;

  // 打开本地文件夹：取消要留在进入页，选到文件夹才退出
  const realPicker = w.showDirectoryPicker;
  api.openLauncher();
  await sleep(60);
  w.showDirectoryPicker = async () => {
    const err = new Error('cancel');
    err.name = 'AbortError';
    throw err;
  };
  await api.startLauncherPick();
  await sleep(80);
  out.pickCancelStaysOnLauncher = !launcherEl.hidden;

  w.showDirectoryPicker = async () => ({
    name: 'Smoke 文件夹',
    queryPermission: async () => 'granted',
    values: async function* fakeDir() {
      yield {
        kind: 'file',
        name: 'picked.md',
        getFile: async () => ({ text: async () => '# 选中的笔记', lastModified: 0 })
      };
    }
  });
  await api.startLauncherPick();
  await sleep(150);
  out.pickSuccessEntersVault = launcherEl.hidden && api.state.vaultLabel === 'Smoke 文件夹';
  out.pickSuccessLoadedNote = api.state.files.length === 1 && api.state.files[0].path === 'picked.md';
  w.showDirectoryPicker = realPicker;

  // 新建笔记库：填名字 → 建库 → 直接进入 → 带起步文件
  api.openLauncher();
  await sleep(70);
  out.newVaultCard = Boolean(w.document.querySelector('#launcher .book-new'));
  w.document.querySelector('#launcher .book-new').click();
  await sleep(80);
  await fillDialog('冒烟新建库');
  await sleep(180);
  out.newVaultCreated = api.vaultLibrary().some(v => v.label === '冒烟新建库');
  out.newVaultEntered = launcherEl.hidden && api.state.vaultLabel === '冒烟新建库';
  out.newVaultStarter = api.state.files.length >= 2 && api.state.files.some(f => f.path === '欢迎使用.md');
  out.newVaultGraph = Boolean(api.graph && api.graph.notes.length >= 2);
  // 记录归属修复：targetPath 指向示例库的错题索引，就该算回 demo
  const beforeRepair = JSON.parse(w.localStorage.getItem(STORE.records) || '[]');
  beforeRepair.push({
    id: 'mis-repair',
    question: '被归错库的题',
    answer: 'a',
    at: Date.now(),
    subject: '数学',
    knowledgePoints: ['导数'],
    status: 'open',
    vaultId: api.state.vaultId,
    targetPath: '10-错题本/数学/数学-错题索引.md',
    targetTitle: '数学-错题索引'
  });
  w.localStorage.setItem(STORE.records, JSON.stringify(beforeRepair));
  const repairedCount = api.ai.repairRecordVaults(api.buildRecordOwners());
  const afterRepair = JSON.parse(w.localStorage.getItem(STORE.records) || '[]');
  const movedRecord = afterRepair.find(r => r.id === 'mis-repair');
  out.recordOwnerRepaired = repairedCount >= 1 && Boolean(movedRecord) && movedRecord.vaultId === 'demo';

  const welcomeFile = api.state.files.find(f => f.path === '欢迎使用.md');
  out.newVaultContent = Boolean(welcomeFile && welcomeFile.content.indexOf('## 从这里开始') >= 0 && welcomeFile.content.split(String.fromCharCode(10)).length > 8);

  api.closeLauncher();

  // 没有错题记录时回到空状态
  w.localStorage.removeItem(STORE.records);
  api.openLauncher();
  await sleep(80);
  out.statsEmptyState = !w.document.querySelector('#stats-empty').hidden && w.document.querySelector('#stats-chart').hidden;
  api.closeLauncher();

  const required = ['createdNote', 'renamed', 'deleted', 'pluginMenuNearSettings', 'diskWriteBack', 'diskBindingReset', 'graphMenuVisible', 'graphMenuTitle', 'graphMenuGroups', 'graphMenuItemCount', 'graphFavorite', 'graphFavoriteStar', 'graphFavoriteToggle', 'graphMovePicker', 'graphPickClosed', 'teacherButtonLeftOfSettings', 'teacherModalOpened', 'teacherModule', 'teacherTraitSliders', 'teacherSaved', 'teacherConfigSaved', 'teacherPromptApplied', 'teacherResetButton', 'teacherResetConfirm', 'teacherReset', 'teacherModalClosed', 'sidebarResizer', 'sidebarDragResized', 'sidebarWidthSaved', 'sidebarReset', 'noteTabStrip', 'noteTabFirst', 'noteTabActive', 'noteTabSecond', 'noteTabClickSwitches', 'noteTabReordered', 'noteTabsSaved', 'noteTabCloseSwitches', 'noteTabCloseCount', 'recordDeleted', 'quickSaveStaysEditing', 'quickSaveWroteContent', 'quickSavePersisted', 'nestedFolderDepth', 'stopApi', 'stopButtonVisible', 'sendDisabledWhileBusy', 'stopAboveSend', 'stopInterrupted', 'stopMessage', 'stopButtonHidden', 'sendEnabledAfterStop', 'stopNoRecord', 'noQuark', 'keyClearedInLocalMode', 'newApiAlias', 'recordDateFilter', 'recordDateOptions', 'recordDateFiltered', 'recordDetailOpen', 'recordSubtabOpen', 'recordInlineView', 'recordInlineQuestion', 'recordDetailClosed', 'useNoteDefaultOff', 'collapseExpandButtons', 'expandWorked', 'mistakeSubjectFolders', 'aiPanelResizer', 'aiPanelResized', 'aiPanelWidthSaved', 'aiPanelReset', 'imageAttachApi', 'photoButton', 'photoApi', 'photoLocalGuard', 'imageEmptyAdd', 'attachmentBox', 'savedVisionModel', 'visionModelField', 'imageDropNoVaultChange', 'imageDropPreview', 'imageDropCleared', 'aiImageButton', 'aiImageInput', 'aiImagePaste', 'inputResizer', 'inputInitialHeight', 'inputResetHeight', 'inputDragResized', 'inputHeightSaved', 'recordLocateButton', 'recordLocated', 'recordLocateHighlight', 'initialOpenWithTarget', 'autoFiledBar', 'autoFiledAll', 'autoTaggedAll', 'englishAutoFiled', 'englishBookCreated', 'autoHeading', 'autoEnglishTag', 'allOriginalQuestionsArchived', 'originalQuestionHeading', 'autoResolved', 'recordsNewestFirst', 'recordDragDisabled', 'recordReorderApiRemoved', 'recordTimeSorted', 'recordUnfiled', 'vaultRecordsIsolated', 'usageIsolated', 'launcherApi', 'launcherVisible', 'launcherBooks', 'launcherAddCard', 'launcherDemoBook', 'launcherDemoNoRemove', 'launcherClosedOnEnter', 'launcherEnteredDemo', 'launcherSidebarButton', 'launcherEscOnBody', 'launcherEscClosed', 'launcherVaultBookSaved', 'launcherVaultBookRendered', 'statsTotal', 'statsPieArcs', 'statsLegend', 'statsPercentSum', 'statsPoints', 'mistakePointTags', 'mistakeTypeSaved', 'mistakeTypeInBook', 'mistakeTypeChip', 'mistakeTypeNormalized', 'sanitizePoints', 'multiPointSnippet', 'statsEmptyHidden', 'statsEmptyState', 'statsScopeSelect', 'statsScopeVaultOnly', 'statsScopeHasVaults', 'statsScopeSingle', 'statsScopeAll', 'vaultMenuOpened', 'vaultMenuItemCount', 'vaultMenuBackup', 'vaultDetailOpened', 'vaultDetailRows', 'vaultDetailClosed', 'vaultRenamed', 'vaultDuplicated', 'vaultDeleted', 'vaultWentToTrash', 'noHoverDelete', 'vaultRestored', 'vaultMenuDemoLimited', 'vaultMenuClosed', 'pickCancelStaysOnLauncher', 'pickSuccessEntersVault', 'pickSuccessLoadedNote', 'newVaultCard', 'newVaultCreated', 'newVaultEntered', 'newVaultStarter', 'newVaultGraph', 'newVaultContent', 'recordOwnerRepaired'];
  const failed = required.filter(key => !out[key]);
  if (failed.length) errors.push('smoke assertions failed: ' + failed.join(', '));
  if (out.afterUninstall !== 0) errors.push('plugins not fully uninstalled: ' + out.afterUninstall);

  console.log(JSON.stringify(out, null, 2));
  process.exit(errors.length ? 1 : 0);
})();
