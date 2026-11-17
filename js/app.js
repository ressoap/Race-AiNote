/* 自动生成：源文件在 js/app/*.js，由 scripts/build-app.js 按文件名顺序拼接。 */
/* 不要直接改本文件；改完片段后运行 npm run build:app。 */
(function () {
  'use strict';

  const vault = RG.vault;
  const query = RG.query;
  const markdown = RG.markdown;
  const richtext = RG.richtext;
  const physics = RG.physics;
  const render = RG.render;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const store = RG.store;

  const DEFAULT_SETTINGS = {
    themeMode: 'system',
    bgPreset: 'default',
    mode: 'global',
    depth: 2,
    showTags: true,
    showAttachments: true,
    existingOnly: true,
    orphansOnly: false,
    arrows: false,
    textFade: 5,
    nodeSize: 1.15,
    linkWidth: 1,
    center: 2,
    repel: 5,
    linkStrength: 8,
    linkDistance: 140,
    groups: [
      { query: 'path:20-数学', color: '#3f9c6d' },
      { query: 'path:30-物理', color: '#e2725b' },
      { query: 'path:10-错题本', color: '#ef9f27' }
    ]
  };

  function loadSettings() {
    try {
      const raw = store.getJSON('settings', {});
      const merged = Object.assign({}, DEFAULT_SETTINGS, raw);
      if (!Array.isArray(merged.groups)) merged.groups = DEFAULT_SETTINGS.groups.map(g => Object.assign({}, g));
      merged.groups = merged.groups
        .filter(g => g && typeof g.query === 'string' && typeof g.color === 'string')
        .slice(0, 16);
      return merged;
    } catch (_) {
      return Object.assign({}, DEFAULT_SETTINGS, { groups: DEFAULT_SETTINGS.groups.map(g => Object.assign({}, g)) });
    }
  }

  function saveSettings() {
    try { store.setJSON('settings', settings); } catch (_) {}
  }

  function loadTheme() {
    try {
      const t = store.get('theme');
      if (t === 'dark' || t === 'light' || t === 'system') return t;
    } catch (_) {}
    return 'system';
  }

  const settings = loadSettings();
  const state = {
    theme: 'light',
    themeMode: 'system',
    files: [],
    graph: null,
    nodes: [],
    links: [],
    index: new Map(),
    sim: null,
    positions: new Map(),
    view: { x: 0, y: 0, scale: 1 },
    width: 0,
    height: 0,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    query: '',
    hoveredId: null,
    selectedId: null,
    localRoot: null,
    openTabs: [],
    activeTab: null,
    favorites: new Set(),
    rootHandle: null,
    diskContents: new Map(),
    diskReadOnly: false,
    drag: null,
    pan: null,
    pointerDown: null,
    dirty: true,
    interacted: false,
    anim: new Map(),
    collapsedFolders: new Set(),
    sortMode: 'usage',
    usage: {},
    manualOrder: {},
    linkAnim: new Map(),
    vaultLabel: '示例库',
    vaultId: null,
    vaultSavedAt: 0
  };

  // 支持 ?theme=dark 强制主题（用于文档截图与演示录像）
  try {
    const forced = new URLSearchParams(location.search).get("theme");
    if (forced === "dark" || forced === "light") state.theme = forced;
  } catch (_) {}
  document.documentElement.dataset.theme = state.theme;

  const canvas = $('#graph-canvas');
  const shell = $('#graph-shell');
  const ctx = canvas.getContext('2d');
  const searchInput = $('#search-input');
  const fileTree = $('#file-tree');
  const settingsPanel = $('#settings-panel');

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* ── 通知 ───────────────────────────────────────────────── */
  let toastTimer = 0;
  let fitPending = false;
  let settleTimer = 0;

  /* ── 左侧栏：拖动右边缘调整宽度 ─────────────────────────── */
  const sidebarEl = $('.sidebar');
  const sidebarResizer = $('#sidebar-resizer');
  const DEFAULT_SIDEBAR_W = 268;
  const MIN_SIDEBAR_W = 190;
  const MAX_SIDEBAR_W = 520;
  let sidebarW = Number(store.get('sidebarWidth')) || DEFAULT_SIDEBAR_W;

  function sidebarMaxWidth() {
    const ai = $('#ai-panel');
    const aiOpen = ai && !ai.classList.contains('is-collapsed');
    const reserve = aiOpen ? 720 : 320;
    return Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, window.innerWidth - reserve));
  }

  function clampSidebarWidth(w) {
    return Math.max(MIN_SIDEBAR_W, Math.min(sidebarMaxWidth(), Math.round(Number(w) || DEFAULT_SIDEBAR_W)));
  }

  function sidebarAria(w) {
    if (!sidebarResizer) return;
    sidebarResizer.setAttribute('aria-valuenow', String(Math.round(w)));
    sidebarResizer.setAttribute('aria-valuemin', String(MIN_SIDEBAR_W));
    sidebarResizer.setAttribute('aria-valuemax', String(Math.round(sidebarMaxWidth())));
  }

  function applySidebarWidth(w, persist) {
    const next = clampSidebarWidth(w);
    document.documentElement.style.setProperty('--sidebar-w', next + 'px');
    sidebarW = next;
    sidebarAria(next);
    if (persist) store.set('sidebarWidth', next);
    return next;
  }

  /** 窗口变窄或打开 AI 面板后按当前可用空间收缩；不改用户记住的目标宽度。 */
  function syncSidebarWidth() {
    const next = clampSidebarWidth(sidebarW);
    document.documentElement.style.setProperty('--sidebar-w', next + 'px');
    sidebarAria(next);
  }

  function currentSidebarWidth() {
    const measured = sidebarEl && (sidebarEl.getBoundingClientRect().width || sidebarEl.offsetWidth);
    return measured || Math.min(sidebarW, sidebarMaxWidth());
  }

  if (sidebarEl && sidebarResizer) {
    let dragX = 0;
    let dragW = 0;
    let dragging = false;

    sidebarResizer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragging = true;
      dragX = e.clientX;
      dragW = currentSidebarWidth();
      try { sidebarResizer.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.classList.add('is-resizing-sidebar');
      e.preventDefault();
    });
    sidebarResizer.addEventListener('pointermove', e => {
      if (!dragging) return;
      applySidebarWidth(dragW + (e.clientX - dragX), false);
    });
    const stopSidebarDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing-sidebar');
      store.set('sidebarWidth', sidebarW);
    };
    sidebarResizer.addEventListener('pointerup', stopSidebarDrag);
    sidebarResizer.addEventListener('pointercancel', stopSidebarDrag);
    sidebarResizer.addEventListener('lostpointercapture', stopSidebarDrag);
    sidebarResizer.addEventListener('dblclick', () => applySidebarWidth(DEFAULT_SIDEBAR_W, true));
    sidebarResizer.addEventListener('keydown', e => {
      if (e.key === 'Home') {
        e.preventDefault();
        applySidebarWidth(DEFAULT_SIDEBAR_W, true);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -24 : 24;
      applySidebarWidth(currentSidebarWidth() + delta, true);
    });

    syncSidebarWidth();
    window.addEventListener('resize', syncSidebarWidth);
  }

  /* ── 进入页：笔记库书架（多库 + 书本平铺） ─────────────────
     设计要点：
     1) 离开一个库时才把它的文件快照写进书架；正在编辑的库仍走 VAULT_KEY 热路径，
        避免每敲一个字都重写整份书架 JSON；
     2) FileSystemDirectoryHandle 进不了 localStorage，另存 IndexedDB；重进书架时
        先尝试申请权限重连文件夹，连不上再回退到快照；
     3) 封面颜色由库 id 哈希得到，同一个库每次颜色一致。 */

  const VAULTS_KEY = 'vaults';
  const VAULT_LIMIT = 18;
  const VAULT_BUDGET = 3500000;
  const HANDLE_DB = 'wenmo-vault-handles';
  let pendingVaultEntry = null;
  let launcherBound = false;
  let launcherPickPending = false;

  function vaultHue(id) {
    let h = 2166136261;
    const s = String(id || 'vault');
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 360;
  }

  function vaultNoteCount(files) {
    let total = 0;
    for (const file of files || []) {
      if (vault.MD_EXT.test(String((file && file.path) || ''))) total += 1;
    }
    return total;
  }

  function timeAgo(ts) {
    const t = Number(ts) || 0;
    if (!t) return '还没打开过';
    const diff = Date.now() - t;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 30) return Math.round(diff / 86400000) + ' 天前';
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function readVaultList() {
    try {
      const raw = store.getJSON(VAULTS_KEY, []);
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(v => v && typeof v.id === 'string' && v.id && v.id !== 'demo')
        .map(v => ({
          id: v.id,
          label: String(v.label || '未命名笔记库').slice(0, 60),
          savedAt: Number(v.savedAt) || 0,
          noteCount: Number(v.noteCount) || 0,
          hasHandle: Boolean(v.hasHandle),
          stale: Boolean(v.stale),
          files: Array.isArray(v.files) ? v.files : null
        }))
        .slice(0, VAULT_LIMIT);
    } catch (_) {
      return [];
    }
  }

  function writeVaultList(list) {
    const next = list.slice(0, VAULT_LIMIT);
    // localStorage 只有 5MB 量级：超预算时从最旧的库开始丢文件快照，书本本身保留
    for (let i = next.length - 1; i >= 1; i -= 1) {
      let size = 0;
      try { size = JSON.stringify(next).length; } catch (_) { size = 0; }
      if (size <= VAULT_BUDGET) break;
      if (next[i].files) {
        next[i].files = null;
        next[i].stale = true;
      }
    }
    try {
      store.setJSON(VAULTS_KEY, next);
      return true;
    } catch (_) {
      return false;
    }
  }

  function vaultEntryOf(id) {
    return readVaultList().find(v => v.id === id) || null;
  }

  function newVaultId() {
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** 只更新元信息，不动已有的文件快照 */
  function touchVaultMeta(patch) {
    if (!patch || !patch.id || patch.id === 'demo') return;
    const list = readVaultList();
    const hit = list.find(v => v.id === patch.id);
    if (hit) Object.assign(hit, patch, { files: hit.files || null });
    else list.unshift(Object.assign({ files: null, stale: false }, patch));
    writeVaultList(list);
  }

  /** 离开当前库前，把最新文件写进书架条目 */
  function commitActiveVault() {
    if (!state.vaultId || state.vaultId === 'demo') return false;
    if (!Array.isArray(state.files) || !state.files.length) return false;
    const prev = vaultEntryOf(state.vaultId) || {};
    const list = readVaultList().filter(v => v.id !== state.vaultId);
    list.unshift({
      id: state.vaultId,
      label: state.vaultLabel || prev.label || '本地库',
      savedAt: Date.now(),
      noteCount: vaultNoteCount(state.files),
      hasHandle: Boolean(prev.hasHandle || state.rootHandle),
      stale: false,
      files: state.files.map(f => ({ path: f.path, content: f.content, mtime: f.mtime }))
    });
    state.vaultSavedAt = Date.now();
    return writeVaultList(list);
  }

  /** loadFiles 收尾时认领身份：这次载入归到哪本书 */
  function adoptVault(label, files, prevLabel) {
    if (label === '示例库') {
      state.vaultId = 'demo';
      state.vaultSavedAt = Date.now();
      pendingVaultEntry = null;
      return state.vaultId;
    }
    let id = pendingVaultEntry && pendingVaultEntry.id && pendingVaultEntry.id !== 'demo' ? pendingVaultEntry.id : null;
    if (!id && state.vaultId && state.vaultId !== 'demo' && prevLabel && prevLabel === label) {
      id = state.vaultId; // 同一个库的刷新（重连、重新载入）
    }
    if (!id) {
      const hit = readVaultList().find(v => v.label === label);
      id = hit ? hit.id : newVaultId();
    }
    state.vaultId = id;
    state.vaultSavedAt = Date.now();
    pendingVaultEntry = null;
    touchVaultMeta({
      id: id,
      label: label,
      savedAt: Date.now(),
      noteCount: vaultNoteCount(files),
      hasHandle: Boolean(state.rootHandle)
    });
    return id;
  }

  /* ── 文件夹句柄：localStorage 存不了，放 IndexedDB ───────── */

  function withHandleStore(mode, worker) {
    return new Promise(resolve => {
      const factory = typeof indexedDB !== 'undefined' ? indexedDB : null;
      if (!factory) return resolve(null);
      let req = null;
      try {
        req = factory.open(HANDLE_DB, 1);
      } catch (_) {
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore('handles'); } catch (_) {}
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        let tx = null;
        let out = null;
        try {
          tx = db.transaction('handles', mode);
          out = worker(tx.objectStore('handles'));
        } catch (_) {
          try { db.close(); } catch (_) {}
          return resolve(null);
        }
        tx.oncomplete = () => {
          try { db.close(); } catch (_) {}
          resolve(out && typeof out.result !== 'undefined' ? out.result : null);
        };
        tx.onerror = () => {
          try { db.close(); } catch (_) {}
          resolve(null);
        };
      };
    });
  }

  function idbPutHandle(id, handle) {
    return withHandleStore('readwrite', box => box.put(handle, id));
  }

  function idbGetHandle(id) {
    return withHandleStore('readonly', box => box.get(id));
  }

  function idbDeleteHandle(id) {
    return withHandleStore('readwrite', box => box.delete(id));
  }

  /** 打开文件夹成功后调用：把句柄存起来，下次从书架重进可直接重连 */
  function attachVaultHandle(handle) {
    if (!handle || !state.vaultId || state.vaultId === 'demo') return Promise.resolve(false);
    touchVaultMeta({ id: state.vaultId, label: state.vaultLabel, savedAt: Date.now(), hasHandle: true });
    return Promise.resolve(idbPutHandle(state.vaultId, handle)).then(() => true).catch(() => false);
  }

  /* ── 进入页渲染 ─────────────────────────────────────────── */

  function bookCard(book) {
    const card = document.createElement('article');
    card.className = 'book';
    card.tabIndex = 0;
    card.dataset.id = book.id;
    card.setAttribute('role', 'listitem');
    card.title = book.label + '（点击进入）';
    card.style.setProperty('--book-hue', String(book.kind === 'demo' ? 224 : vaultHue(book.id)));
    if (state.vaultId === book.id) card.classList.add('is-current');

    const cover = document.createElement('div');
    cover.className = 'book-cover';

    const title = document.createElement('h3');
    title.className = 'book-title';
    title.textContent = book.label;
    cover.appendChild(title);

    const meta = document.createElement('p');
    meta.className = 'book-meta';
    meta.textContent = (book.noteCount || 0) + (book.kind === 'demo' ? ' 篇示例笔记' : ' 篇笔记');
    cover.appendChild(meta);

    if (state.vaultId === book.id) {
      const badge = document.createElement('span');
      badge.className = 'book-badge';
      badge.textContent = '当前';
      cover.appendChild(badge);
    } else if (book.stale) {
      const badge = document.createElement('span');
      badge.className = 'book-badge is-warn';
      badge.textContent = '需重连';
      cover.appendChild(badge);
    }

    card.appendChild(cover);

    const foot = document.createElement('div');
    foot.className = 'book-foot';
    foot.textContent = book.kind === 'demo'
      ? '开箱即用 · 无需配置'
      : (book.stale ? '快照已清理，请重新选择文件夹' : timeAgo(book.savedAt));
    card.appendChild(foot);

    if (book.kind !== 'demo') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'book-remove';
      del.title = '从列表移出（不会删除磁盘文件）';
      del.textContent = '×';
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        removeVaultBook(book.id);
      });
      card.appendChild(del);
    }

    const go = () => { Promise.resolve(enterVault(book.id)).catch(() => {}); };
    card.addEventListener('click', go);
    card.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      Promise.resolve(openVaultMenu(book.id, ev.clientX, ev.clientY)).catch(() => {});
    });
    card.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    });
    return card;
  }

  function addBookCard() {
    const card = document.createElement('article');
    card.className = 'book book-add';
    card.tabIndex = 0;
    card.dataset.action = 'open-folder';
    card.setAttribute('role', 'listitem');
    card.title = '打开本地文件夹作为新笔记库';

    const cover = document.createElement('div');
    cover.className = 'book-cover';
    const icon = document.createElement('span');
    icon.className = 'book-add-icon';
    icon.textContent = '+';
    const label = document.createElement('span');
    label.className = 'book-add-label';
    label.textContent = '打开本地文件夹';
    cover.appendChild(icon);
    cover.appendChild(label);
    card.appendChild(cover);

    const foot = document.createElement('div');
    foot.className = 'book-foot';
    foot.textContent = '读取 Markdown 笔记库';
    card.appendChild(foot);

    const go = () => { startLauncherPick(); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    });
    return card;
  }

  function newBookCard() {
    const card = document.createElement('article');
    card.className = 'book book-add book-new';
    card.tabIndex = 0;
    card.dataset.action = 'new-vault';
    card.setAttribute('role', 'listitem');
    card.title = '新建一个空笔记库';

    const cover = document.createElement('div');
    cover.className = 'book-cover';
    const icon = document.createElement('span');
    icon.className = 'book-add-icon';
    icon.textContent = '+';
    const label = document.createElement('span');
    label.className = 'book-add-label';
    label.textContent = '新建笔记库';
    cover.appendChild(icon);
    cover.appendChild(label);
    card.appendChild(cover);

    const foot = document.createElement('div');
    foot.className = 'book-foot';
    foot.textContent = '从空白开始记录';
    card.appendChild(foot);

    const go = () => { Promise.resolve(createVaultBook()).catch(() => {}); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    });
    return card;
  }

  /** 新建笔记库的起步文件：一篇欢迎页 + 一篇错题本说明，保证图谱不是空的 */
  function newVaultStarterFiles(label) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    return [
      {
        path: '欢迎使用.md',
        content: [
          '---',
          'title: 欢迎使用',
          'tags: [入门]',
          '---',
          '',
          '# 欢迎使用《' + label + '》',
          '',
          '这是 ' + date + ' 新建的空笔记库，所有内容只保存在本机。',
          '',
          '## 从这里开始',
          '',
          '- 左上角「新建笔记 / 新建文件夹」开始写；笔记可以多级嵌套',
          '- 用 [[双链]] 互相引用，切到「关系图谱」就能看到结构',
          '- 右侧「答疑老师」可以直接问题目，答完自动归档到 10-错题本，并打上知识点标签',
          '- 编辑内容会自动存进本机缓存；想落到磁盘，随时右键这本书「备份到文件」',
          '',
          '## 小提示',
          '',
          '- 想换个名字：在进入页右键这本书 →「改名」',
          '- 想接着用本地文件夹：进入页点「打开本地文件夹」，选到已有 Markdown 库即可',
          ''
        ].join(String.fromCharCode(10))
      },
      {
        path: '10-错题本/使用说明.md',
        content: [
          '---',
          'title: 错题本使用说明',
          'tags: [错题, 说明]',
          '---',
          '',
          '# 错题本使用说明',
          '',
          '向「答疑老师」提问后，答案会自动归档到本目录下的「学科-错题索引.md」，',
          '每条记录包含：学科、知识点标签（可多个）、原题目、解析。',
          '',
          '知识点会写成 #标签 形式，便于关系图谱分类；进入页右侧的错题看板也按这些标签统计。',
          '',
          '可以手动补一行「我的错因」，下次复习更快。',
          ''
        ].join(String.fromCharCode(10))
      }
    ];
  }

  /** 新建一个空笔记库并直接进入 */
  async function createVaultBook() {
    const input = await askText({
      title: '新建笔记库',
      desc: '会新建一个只有欢迎页的空笔记库，随时可以改名、备份或连接本地文件夹。',
      value: '我的笔记库',
      placeholder: '给笔记库起个名字'
    });
    if (input == null) return false;
    const label = String(input).trim().slice(0, 40) || '我的笔记库';
    const files = newVaultStarterFiles(label);
    const id = newVaultId();
    commitActiveVault();
    const list = readVaultList();
    list.unshift({
      id: id,
      label: label,
      savedAt: Date.now(),
      noteCount: files.length,
      hasHandle: false,
      stale: false,
      files: files
    });
    writeVaultList(list);
    pendingVaultEntry = { id: id, label: label };
    launcherPickPending = false;
    closeLauncher();
    loadFiles(files.map(f => Object.assign({}, f)), label);
    toast('已新建《' + label + '》，可以开始写了');
    return id;
  }

  function renderLauncher() {
    const shelf = $('#launcher-shelf');
    if (!shelf) return;
    shelf.innerHTML = '';
    const list = readVaultList();
    const demoFiles = (RG.demoVault && RG.demoVault.files) || [];
    shelf.appendChild(bookCard({
      id: 'demo',
      kind: 'demo',
      label: '内置示例库',
      noteCount: demoFiles.length,
      savedAt: 0
    }));
    for (const item of list) {
      shelf.appendChild(bookCard(Object.assign({ kind: 'vault' }, item)));
    }
    shelf.appendChild(newBookCard());
    shelf.appendChild(addBookCard());
    const count = $('#launcher-count');
    if (count) count.textContent = list.length ? '共 ' + (list.length + 1) + ' 个' : '只有示例库';
    if (typeof renderLauncherStats === 'function') renderLauncherStats();
  }

  function openLauncher() {
    const root = $('#launcher');
    if (!root) return false;
    if (state.files && state.files.length) commitActiveVault();
    renderLauncher();
    root.hidden = false;
    requestAnimationFrame(() => {
      const first = root.querySelector('.book');
      if (first && first.focus) first.focus({ preventScroll: true });
    });
    return true;
  }

  function closeLauncher() {
    const root = $('#launcher');
    if (!root || root.hidden) return false;
    root.hidden = true;
    launcherPickPending = false;
    return true;
  }

  /** 从进入页发起「打开本地文件夹」：选完且真的读到了笔记，才退出进入页 */
  function startLauncherPick() {
    launcherPickPending = true;
    return openViaPicker({ fromLauncher: true });
  }

  function launcherPickDone(ok) {
    const wasPending = launcherPickPending;
    launcherPickPending = false;
    if (ok && wasPending) closeLauncher();
    return wasPending;
  }

  /* ── 进入 / 移出一个库 ─────────────────────────────────── */

  async function enterVault(id) {
    if (id === 'demo') {
      closeLauncher();
      loadDemo();
      return true;
    }
    const entry = vaultEntryOf(id);
    if (!entry) {
      toast('这个笔记库已不在列表里');
      renderLauncher();
      return false;
    }
    commitActiveVault();
    closeLauncher();
    pendingVaultEntry = { id: entry.id, label: entry.label };

    // 1) 优先重连原文件夹，拿到磁盘上的最新内容
    if (entry.hasHandle) {
      const handle = await idbGetHandle(entry.id);
      if (handle) {
        try {
          let perm = 'granted';
          if (handle.queryPermission) perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted' && handle.requestPermission) {
            perm = await handle.requestPermission({ mode: 'readwrite' });
          }
          if (perm === 'granted') {
            const files = [];
            await walkDirectory(handle, '', files);
            if (files.length) {
              loadFiles(files, handle.name || entry.label);
              if (typeof bindDiskRoot === 'function') bindDiskRoot(handle, files);
              toast('已重新连接文件夹：' + (handle.name || entry.label));
              return true;
            }
          }
        } catch (_) {}
      }
    }

    // 2) 回退到快照
    if (Array.isArray(entry.files) && entry.files.length) {
      loadFiles(entry.files.map(f => Object.assign({}, f)), entry.label);
      toast('已打开笔记库：' + entry.label);
      return true;
    }

    pendingVaultEntry = null;
    toast('《' + entry.label + '》没有可用的文件快照，请重新选择文件夹');
    return false;
  }

  async function removeVaultBook(id) {
    const entry = vaultEntryOf(id);
    if (!entry) return false;
    const ok = await askConfirm({
      title: '移出笔记库列表',
      message: '只会把《' + entry.label + '》从进入页移出，不会删除磁盘上的任何笔记。',
      okText: '移出',
      danger: true
    });
    if (!ok) return false;
    writeVaultList(readVaultList().filter(v => v.id !== id));
    idbDeleteHandle(id);
    if (state.vaultId === id) state.vaultId = null; // 当前正在编辑的库被移出：解除身份，下次保存重新建书
    renderLauncher();
    toast('已移出列表，磁盘文件未改动');
    return true;
  }

  /* ── 初始化 ─────────────────────────────────────────────── */

  function initLauncher() {
    const root = $('#launcher');
    if (!root || launcherBound) return false;
    launcherBound = true;

    const openBtn = $('#launcher-open');
    if (openBtn) {
      openBtn.addEventListener('click', () => { startLauncherPick(); });
    }
    const demoBtn = $('#launcher-demo');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        closeLauncher();
        loadDemo();
      });
    }
    const closeBtn = $('#launcher-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { closeLauncher(); });
    const vaultBtn = $('#btn-vaults');
    if (vaultBtn) vaultBtn.addEventListener('click', () => { openLauncher(); });
    const vaultTitle = $('.vault-title');
    if (vaultTitle) {
      vaultTitle.style.cursor = 'pointer';
      vaultTitle.title = '切换笔记库（打开进入页）';
      vaultTitle.addEventListener('click', () => { openLauncher(); });
    }

    const menuEl = $('#vault-menu');
    if (menuEl) {
      menuEl.addEventListener('click', ev => {
        const btn = ev.target.closest('button');
        if (!btn || !vaultMenuId) return;
        const act = btn.dataset.act;
        const id = vaultMenuId;
        closeVaultMenu();
        if (act === 'open') enterVault(id);
        else if (act === 'duplicate') duplicateVaultBook(id);
        else if (act === 'rename') renameVaultBook(id);
        else if (act === 'backup') backupVaultBook(id);
        else if (act === 'detail') showVaultDetail(id);
        else if (act === 'delete') removeVaultBook(id);
      });
    }
    document.addEventListener('mousedown', ev => {
      const menu = $('#vault-menu');
      if (menu && !menu.hidden && !ev.target.closest('#vault-menu')) closeVaultMenu();
    });
    const detailClose = $('#vault-detail-close');
    if (detailClose) detailClose.addEventListener('click', () => { $('#vault-detail').hidden = true; });
    const detailModal = $('#vault-detail');
    if (detailModal) {
      detailModal.addEventListener('click', ev => {
        if (ev.target === detailModal) detailModal.hidden = true;
      });
    }

    // 进入页打开时把键盘事件留在这一层，别触发工作区快捷键
    root.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (closeVaultMenu()) return;
        const detail = $('#vault-detail');
        if (detail && !detail.hidden) { detail.hidden = true; return; }
        if (state.files && state.files.length) closeLauncher();
        return;
      }
      ev.stopPropagation();
    });
    // 焦点落在进入页外面时（比如刚打开首页还没点书），把工作区快捷键挡掉
    document.addEventListener('keydown', ev => {
      const shell = $('#launcher');
      if (!shell || shell.hidden) return;
      if (shell.contains(ev.target)) return;
      ev.stopPropagation();
      if (closeVaultMenu()) return;
      const detail = $('#vault-detail');
      if (detail && !detail.hidden) { detail.hidden = true; return; }
      if (ev.key === 'Escape' && state.files && state.files.length) closeLauncher();
    }, true);

    window.addEventListener('beforeunload', () => {
      try { commitActiveVault(); } catch (_) {}
    });

    renderLauncher();
    let skip = false;
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('launch') === '0') skip = true;
      if (params.get('note') || params.get('vault') || params.get('view') === 'graph' || params.get('prefs') === '1') skip = true;
    } catch (_) {}
    if (!skip) openLauncher();
    return true;
  }

  /* ── 书本右键菜单：复制 / 改名 / 删除 / 备份 / 查看详情 ───── */

  let vaultMenuId = null;

  function openVaultMenu(id, x, y) {
    const menu = $('#vault-menu');
    if (!menu) return false;
    vaultMenuId = id;
    const limited = id === 'demo';
    for (const btn of menu.querySelectorAll('button')) {
      const act = btn.dataset.act;
      btn.hidden = limited && (act === 'rename' || act === 'duplicate' || act === 'delete');
    }
    menu.hidden = false;
    const width = menu.offsetWidth || 168;
    const height = menu.offsetHeight || 214;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + 'px';
    return true;
  }

  function closeVaultMenu() {
    const menu = $('#vault-menu');
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    vaultMenuId = null;
    return true;
  }

  /** 取某个库当前可用的文件：正在编辑的库以内存为准，其它用快照 */
  function vaultFilesOf(id) {
    if (id === 'demo') return ((RG.demoVault && RG.demoVault.files) || []).map(f => Object.assign({}, f));
    if (id === state.vaultId && Array.isArray(state.files) && state.files.length) return state.files;
    const entry = vaultEntryOf(id);
    return entry && Array.isArray(entry.files) ? entry.files : [];
  }

  function vaultStatsOf(files) {
    let notes = 0;
    let attachments = 0;
    let words = 0;
    for (const file of files || []) {
      const filePath = String((file && file.path) || '');
      if (vault.MD_EXT.test(filePath)) {
        notes += 1;
        words += String(file.content || '').replace(/\s+/g, '').length;
      } else if (vault.ATTACH_EXT.test(filePath)) {
        attachments += 1;
      }
    }
    return { notes: notes, attachments: attachments, words: words };
  }

  function downloadJson(filename, data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (err) {
      toast('导出失败：' + (err && err.message ? err.message : err));
      return false;
    }
  }

  async function renameVaultBook(id) {
    const entry = vaultEntryOf(id);
    if (!entry) return false;
    const next = await askText({
      title: '给笔记库改名',
      desc: '只改进入页里显示的名字，磁盘上的文件夹名不会变。',
      value: entry.label,
      placeholder: '例如：考研数学'
    });
    if (next == null) return false;
    const label = String(next).trim().slice(0, 40);
    if (!label) {
      toast('名字不能为空');
      return false;
    }
    const list = readVaultList();
    const hit = list.find(v => v.id === id);
    if (!hit) return false;
    hit.label = label;
    writeVaultList(list);
    if (state.vaultId === id) {
      state.vaultLabel = label;
      $('#vault-name').textContent = label;
      $('#vault-name').title = label;
      saveLocalVault();
    }
    renderLauncher();
    toast('已改名为《' + label + '》');
    return true;
  }

  function duplicateVaultBook(id) {
    const entry = vaultEntryOf(id);
    if (!entry) return false;
    const files = vaultFilesOf(id);
    const copy = {
      id: newVaultId(),
      label: (entry.label + ' 副本').slice(0, 40),
      savedAt: Date.now(),
      noteCount: vaultNoteCount(files),
      hasHandle: false,
      stale: files.length ? false : true,
      files: files.length ? files.map(f => Object.assign({}, f)) : null
    };
    const list = readVaultList();
    list.unshift(copy);
    writeVaultList(list);
    renderLauncher();
    toast('已复制为《' + copy.label + '》');
    return copy.id;
  }

  function backupVaultBook(id) {
    const entry = vaultEntryOf(id);
    const files = vaultFilesOf(id);
    if (!files.length) {
      toast('这个库还没有可备份的笔记');
      return false;
    }
    const label = id === 'demo' ? '示例库' : (entry ? entry.label : '笔记库');
    const paths = new Set(files.map(f => f.path));
    const records = launcherRecordList().filter(r => !r.targetPath || paths.has(r.targetPath));
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());
    const ok = downloadJson(label + '-备份-' + stamp + '.json', {
      app: '问墨笔记',
      kind: 'vault-backup',
      version: 1,
      label: label,
      exportedAt: now.toISOString(),
      noteCount: vaultNoteCount(files),
      files: files,
      records: records
    });
    if (ok) toast('已导出《' + label + '》：' + files.length + ' 个文件');
    return ok;
  }

  function showVaultDetail(id) {
    const modal = $('#vault-detail');
    if (!modal) return false;
    const isDemo = id === 'demo';
    const entry = isDemo ? null : vaultEntryOf(id);
    if (!isDemo && !entry) return false;
    const files = vaultFilesOf(id);
    const stats = vaultStatsOf(files);
    const label = isDemo ? '内置示例库' : entry.label;
    const kind = isDemo
      ? '内置示例库（随应用打包，不占磁盘）'
      : (entry.hasHandle ? '本地文件夹 · 已连接磁盘，改动会写回' : (entry.files ? '本地快照 · 未连接磁盘，改动只存本机缓存' : '本地文件夹 · 需要重新授权'));
    let bytes = 0;
    try { bytes = JSON.stringify(files).length; } catch (_) { bytes = 0; }
    const rows = [
      ['类型', kind],
      ['笔记', stats.notes + ' 篇'],
      ['附件', stats.attachments + ' 个'],
      ['正文规模', stats.words.toLocaleString('zh-CN') + ' 字'],
      ['缓存占用', bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'],
      ['最近打开', isDemo ? '随时可用' : timeAgo(entry.savedAt)],
      ['库 ID', isDemo ? 'demo' : entry.id]
    ];
    const titleEl = $('#vault-detail-title');
    if (titleEl) titleEl.textContent = label;
    const subEl = $('#vault-detail-sub');
    if (subEl) subEl.textContent = isDemo ? '开箱即用 · 无需配置' : ('保存于 ' + new Date(entry.savedAt || Date.now()).toLocaleString('zh-CN'));
    const box = $('#vault-detail-rows');
    if (box) {
      box.innerHTML = '';
      for (const row of rows) {
        const dt = document.createElement('dt');
        dt.textContent = row[0];
        const dd = document.createElement('dd');
        dd.textContent = row[1];
        box.appendChild(dt);
        box.appendChild(dd);
      }
    }
    modal.hidden = false;
    return true;
  }

  /* ── 本地文件夹读写同步（File System Access API） ───────── */
  let diskSyncTimer = 0;
  let diskSyncBusy = false;
  let diskSyncPending = false;

  function resetDiskBinding() {
    state.rootHandle = null;
    state.diskContents = new Map();
    state.diskReadOnly = false;
    clearTimeout(diskSyncTimer);
    diskSyncTimer = 0;
  }

  function bindDiskRoot(handle, files) {
    state.rootHandle = handle || null;
    state.diskReadOnly = false;
    state.diskContents = new Map();
    for (const file of files || []) {
      if (vault.MD_EXT.test(String(file.path || ''))) {
        state.diskContents.set(file.path, String(file.content || ''));
      }
    }
    return Boolean(handle);
  }

  async function diskDirForPath(root, path, create) {
    const parts = String(path || '').split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error('空文件路径');
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: Boolean(create) });
    }
    return { dir, name };
  }

  async function writeDiskFile(root, path, content) {
    const target = await diskDirForPath(root, path, true);
    const fileHandle = await target.dir.getFileHandle(target.name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(String(content == null ? '' : content));
    } finally {
      await writable.close();
    }
  }

  async function removeDiskFile(root, path) {
    const target = await diskDirForPath(root, path, false);
    await target.dir.removeEntry(target.name);
  }

  async function syncDiskNow() {
    if (!state.rootHandle || state.diskReadOnly) return { wrote: 0, removed: 0, skipped: true };
    if (diskSyncBusy) {
      diskSyncPending = true;
      return { wrote: 0, removed: 0, pending: true };
    }
    diskSyncBusy = true;
    diskSyncPending = false;
    const root = state.rootHandle;
    const next = new Map();
    for (const file of state.files) {
      if (vault.MD_EXT.test(String(file.path || ''))) next.set(file.path, String(file.content || ''));
    }
    let wrote = 0;
    let removed = 0;
    let failed = false;
    try {
      for (const [path, content] of next) {
        if (state.diskContents.get(path) === content) continue;
        try {
          await writeDiskFile(root, path, content);
          wrote += 1;
        } catch (err) {
          failed = true;
        }
      }
      for (const path of [...state.diskContents.keys()]) {
        if (next.has(path)) continue;
        try {
          await removeDiskFile(root, path);
          removed += 1;
        } catch (err) {
          failed = true;
        }
      }
      if (!failed) state.diskContents = next;
      if (wrote || removed) toast('已写回磁盘：' + wrote + ' 个修改，' + removed + ' 个删除');
      return { wrote, removed, failed };
    } finally {
      diskSyncBusy = false;
      if (diskSyncPending) {
        diskSyncPending = false;
        setTimeout(() => { syncDiskNow(); }, 0);
      }
    }
  }

  function scheduleDiskSync() {
    if (!state.rootHandle || state.diskReadOnly) return;
    clearTimeout(diskSyncTimer);
    diskSyncTimer = setTimeout(() => { diskSyncNow(); }, 350);
  }

  /* ── 进入页右侧：错题分布看板（扇形图 + 知识点比例） ───────
     数据来自问题记录（store 的 records 键），与右侧 AI 面板同源；
     学科占比画成环形扇形图，知识点按「首知识点」统计并给出百分比条。 */

  const STATS_PALETTE = ['#4a6ef5', '#e2725b', '#3f9c6d', '#ef9f27', '#9a6ef5', '#2fa5b8', '#d9534f', '#7a9eff'];

  function launcherRecordList() {
    try {
      const list = store.getJSON('records', []);
      return Array.isArray(list) ? list.filter(r => r && typeof r === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function statsSubjectOf(record) {
    const raw = String((record && record.subject) || '').trim();
    if (!raw) return '其他';
    if (typeof RG !== 'undefined' && RG.ai && typeof RG.ai.normalizeSubject === 'function') {
      try { return RG.ai.normalizeSubject(raw); } catch (_) {}
    }
    return raw.slice(0, 8);
  }

  /** 一道题可以有多个知识点：一条记录会把它的每个知识点各算一次 */
  function statsPointsOf(record) {
    const out = [];
    const list = record && record.knowledgePoints;
    if (Array.isArray(list)) {
      for (const item of list) {
        const label = String(item == null ? '' : item).trim();
        if (label && out.indexOf(label) < 0) out.push(label);
      }
    }
    if (!out.length) {
      const single = String((record && record.knowledgePoint) || '').trim();
      if (single) out.push(single);
    }
    return out.length ? out : ['未分类'];
  }

  /** 多知识点计数：百分比 = 提到该知识点的错题数 / 总错题数（可多选，合计会超过 100%） */
  function statsGroupMulti(records, pick) {
    const totals = new Map();
    for (const rec of records) {
      for (const label of pick(rec)) totals.set(label, (totals.get(label) || 0) + 1);
    }
    const base = records.length || 1;
    return [...totals.entries()]
      .map(([label, count]) => ({ label: label, count: count, pct: Math.round((count / base) * 100) }))
      .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), 'zh-Hans-CN'));
  }

  /** 计数 → 百分比（最大余数法，保证相加正好 100） */
  function statsPercents(items) {
    const total = items.reduce((sum, it) => sum + it.count, 0);
    if (!total) return items.map(it => Object.assign({}, it, { pct: 0 }));
    const out = items.map(it => {
      const exact = (it.count / total) * 100;
      return Object.assign({}, it, { pct: Math.floor(exact), exact: exact });
    });
    let left = 100 - out.reduce((sum, it) => sum + it.pct, 0);
    out.sort((a, b) => b.exact - a.exact);
    for (let i = 0; i < out.length && left > 0; i += 1, left -= 1) out[i].pct += 1;
    return out;
  }

  function statsGroup(records, pick) {
    const map = new Map();
    for (const rec of records) {
      const key = pick(rec);
      map.set(key, (map.get(key) || 0) + 1);
    }
    const items = [...map.entries()].map(([label, count]) => ({ label: label, count: count }));
    items.sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), 'zh-Hans-CN'));
    return statsPercents(items);
  }

  function renderLauncherStats() {
    const pie = $('#stats-pie');
    if (!pie) return;
    const chart = $('#stats-chart');
    const legend = $('#stats-subjects');
    const pointsEl = $('#stats-points');
    const emptyEl = $('#stats-empty');
    const totalEl = $('#stats-total');
    const scopeEl = $('#stats-scope');
    const solvedEl = $('#stats-solved');

    if (scopeEl) scopeEl.textContent = state.vaultLabel || '当前笔记库';
    pie.innerHTML = '';
    if (legend) legend.innerHTML = '';
    if (pointsEl) pointsEl.innerHTML = '';

    const records = launcherRecordList();
    if (!records.length) {
      if (chart) chart.hidden = true;
      if (legend) legend.hidden = true;
      if (pointsEl) pointsEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (solvedEl) solvedEl.textContent = '';
      if (totalEl) totalEl.textContent = '0';
      return;
    }
    if (chart) chart.hidden = false;
    if (legend) legend.hidden = false;
    if (pointsEl) pointsEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;

    const subjects = statsGroup(records, statsSubjectOf);
    const total = subjects.reduce((sum, it) => sum + it.count, 0);
    if (totalEl) totalEl.textContent = String(total);
    const solved = records.filter(r => r && r.status === 'resolved').length;
    if (solvedEl) solvedEl.textContent = solved + ' / ' + records.length + ' 已解决';

    const NS = 'http://www.w3.org/2000/svg';
    const R = 45;
    const W = 15;
    const C = 2 * Math.PI * R;

    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', '60');
    track.setAttribute('cy', '60');
    track.setAttribute('r', String(R));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke-width', String(W));
    track.style.stroke = 'var(--bg-hover)';
    pie.appendChild(track);

    const gap = subjects.length > 1 ? 2.6 : 0;
    let offset = 0;
    subjects.forEach((item, i) => {
      const color = STATS_PALETTE[i % STATS_PALETTE.length];
      const span = (item.pct / 100) * C;
      const len = Math.max(span - gap, 0.8);
      const arc = document.createElementNS(NS, 'circle');
      arc.setAttribute('cx', '60');
      arc.setAttribute('cy', '60');
      arc.setAttribute('r', String(R));
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke-width', String(W));
      arc.setAttribute('stroke-dasharray', len + ' ' + (C - len));
      arc.setAttribute('stroke-dashoffset', String(-offset));
      arc.style.stroke = color;
      const tip = document.createElementNS(NS, 'title');
      tip.textContent = item.label + ' ' + item.count + ' 道 · ' + item.pct + '%';
      arc.appendChild(tip);
      pie.appendChild(arc);
      offset += span;

      if (legend) {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'stats-dot';
        dot.style.background = color;
        const name = document.createElement('span');
        name.textContent = item.label;
        const val = document.createElement('b');
        val.textContent = item.count + ' · ' + item.pct + '%';
        li.appendChild(dot);
        li.appendChild(name);
        li.appendChild(val);
        legend.appendChild(li);
      }
    });

    if (!pointsEl) return;
    const allPoints = statsGroupMulti(records, statsPointsOf);
    const points = allPoints.slice(0, 8);
    for (const item of points) {
      const row = document.createElement('li');
      row.className = 'stats-point-row';

      const top = document.createElement('div');
      top.className = 'stats-point-top';
      const name = document.createElement('span');
      name.className = 'stats-point-name';
      name.textContent = item.label;
      name.title = item.label + ' · ' + item.count + ' 道';
      const pct = document.createElement('span');
      pct.className = 'stats-point-pct';
      pct.textContent = item.pct + '%';
      top.appendChild(name);
      top.appendChild(pct);

      const bar = document.createElement('div');
      bar.className = 'stats-bar';
      const fill = document.createElement('i');
      fill.style.width = Math.max(item.pct, 2) + '%';
      bar.appendChild(fill);

      row.appendChild(top);
      row.appendChild(bar);
      pointsEl.appendChild(row);
    }

    if (allPoints.length > points.length) {
      const rest = allPoints.slice(points.length);
      const tail = document.createElement('li');
      tail.className = 'stats-point-rest';
      tail.textContent = '其余 ' + rest.length + ' 个知识点' + (rest[0] ? '（最高 ' + rest[0].pct + '%）' : '');
      pointsEl.appendChild(tail);
    }
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
  }

  /* ── 设置 → 物理参数映射 ─────────────────────────────────── */
  function physicsSettings() {
    return {
      repel: 120 + settings.repel * 130,
      center: 0.000004 + settings.center * 0.000011,
      linkStrength: settings.linkStrength / 1000,
      linkDistance: settings.linkDistance,
      nodeSize: settings.nodeSize
    };
  }

  /* ── 载入数据 ───────────────────────────────────────────── */
  function loadFiles(files, label) {
    const prevLabel = state.vaultLabel;
    if (typeof commitActiveVault === 'function' && state.files && state.files.length) commitActiveVault();
    if (typeof resetDiskBinding === 'function') resetDiskBinding();
    state.files = files;
    state.vaultLabel = label || '本地库';
    state.graph = vault.buildVault(files);
    state.positions.clear();
    state.selectedId = null;
    state.localRoot = null;
    const firstNote = state.graph.notes[0];
    if (firstNote) state.localRoot = firstNote.id;
    $('#vault-name').textContent = state.vaultLabel;
    $('#vault-name').title = state.vaultLabel;
    const s = state.graph.stats;
    $('#vault-stats').textContent = s.notes + ' 篇笔记 · ' + s.links + ' 条连线 · ' + s.orphans + ' 个孤立';
    $('#graph-empty').hidden = state.graph.nodes.length > 0;
    renderTree();
    rebuild({ fresh: true, fit: true });
    if (typeof ai !== "undefined" && ai && ai.reset) ai.reset();
    currentNoteId = null;
    const wantedTab = state.activeTab;
    if (typeof renderNoteTabs === 'function') renderNoteTabs();
    if (wantedTab && state.graph.notes.some(n => n.id === wantedTab)) openNote(wantedTab);
    else if (state.graph.notes[0]) openNote(state.graph.notes[0].id);
    setSearch('');
    if (typeof adoptVault === 'function') adoptVault(label || '本地库', files, prevLabel);
    if (typeof saveLocalVault === 'function') saveLocalVault();
  }

  function loadDemo() {
    loadFiles(RG.demoVault.files.map(f => Object.assign({}, f)), '示例库');
    toast('已载入内置示例库');
  }

  /** <input webkitdirectory> 或拖放得到的 FileList */
  async function readFileList(fileList) {
    const list = [...fileList];
    if (!list.length) return [];
    const out = [];
    for (const file of list) {
      const path = (file.webkitRelativePath || file.name).replace(/^[^/]*\//, '');
      if (vault.MD_EXT.test(path)) {
        out.push({ path, content: await file.text(), mtime: file.lastModified || 0 });
      } else if (vault.ATTACH_EXT.test(path)) {
        out.push({ path, mtime: file.lastModified || 0 });
      }
    }
    return out;
  }

  async function openViaInput() { $('#folder-input').click(); }

  /** fromLauncher：从进入页发起时，只有真的读到笔记才关掉进入页，取消就留在原地 */
  async function openViaPicker(options) {
    const fromLauncher = Boolean(options && options.fromLauncher);
    const finish = ok => {
      if (fromLauncher && typeof launcherPickDone === 'function') launcherPickDone(ok);
    };
    if (!window.showDirectoryPicker) return openViaInput();
    try {
      let dir = null;
      let writable = false;
      try {
        dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        writable = true;
      } catch (err) {
        if (err && err.name === 'AbortError') { finish(false); return; }
        dir = await window.showDirectoryPicker({ mode: 'read' });
      }
      if (writable && dir.queryPermission) {
        try {
          const permission = await dir.queryPermission({ mode: 'readwrite' });
          writable = permission === 'granted';
        } catch (_) {}
      }
      const files = [];
      await walkDirectory(dir, '', files);
      if (!files.length) {
        finish(false);
        return toast('这个文件夹里没有 Markdown 笔记');
      }
      loadFiles(files, dir.name);
      if (writable && typeof bindDiskRoot === 'function') {
        bindDiskRoot(dir, files);
        if (typeof attachVaultHandle === 'function') attachVaultHandle(dir);
      }
      toast('已读取 ' + dir.name + '：' + files.length + ' 个文件' + (writable ? '，修改会写回磁盘' : '（只读）'));
      finish(true);
    } catch (err) {
      if (err && err.name === 'AbortError') { finish(false); return; }
      finish(false);
      toast('读取失败：' + (err && err.message ? err.message : err));
    }
  }

  async function walkDirectory(dir, prefix, out) {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith('.')) continue;
      const path = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.kind === 'directory') {
        await walkDirectory(entry, path, out);
      } else if (vault.MD_EXT.test(path)) {
        const file = await entry.getFile();
        out.push({ path, content: await file.text(), mtime: file.lastModified || 0 });
      } else if (vault.ATTACH_EXT.test(path)) {
        out.push({ path, mtime: entry.lastModified || 0 });
      }
    }
  }

  /** 拖放：优先用 entry API 递归读目录 */
  async function readDataTransfer(dt) {
    const items = dt.items ? [...dt.items] : [];
    const entries = items
      .map(item => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (!entries.length) return readFileList(dt.files);

    const out = [];
    const walkEntry = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        const path = prefix ? prefix + '/' + entry.name : entry.name;
        if (vault.MD_EXT.test(path)) out.push({ path, content: await file.text(), mtime: file.lastModified || 0 });
        else if (vault.ATTACH_EXT.test(path)) out.push({ path, mtime: file.lastModified || 0 });
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const children = await new Promise(res => reader.readEntries(res, () => res([])));
        for (const child of children) {
          await walkEntry(child, prefix ? prefix + '/' + entry.name : entry.name);
        }
      }
    };
    for (const entry of entries) await walkEntry(entry, '');
    return out;
  }

  /* ── 筛选与重建 ─────────────────────────────────────────── */
  function allowedTypes() {
    const types = new Set(['note']);
    if (settings.showTags) types.add('tag');
    if (settings.showAttachments) types.add('attachment');
    if (!settings.existingOnly) types.add('unresolved');
    return types;
  }

  function filterGraph() {
    if (!state.graph) return { nodes: [], links: [] };
    const types = allowedTypes();
    let nodes = state.graph.nodes.filter(n => types.has(n.type));
    const keep = new Set(nodes.map(n => n.id));
    let links = state.graph.links.filter(l => keep.has(l.source) && keep.has(l.target));

    // 局部图谱：BFS 取 depth 层邻域
    if (settings.mode === 'local') {
      let root = state.localRoot;
      if (!root || !keep.has(root)) {
        root = state.selectedId && keep.has(state.selectedId)
          ? state.selectedId
          : (nodes.find(n => n.type === 'note') || {}).id;
      }
      state.localRoot = root || null;
      if (root) {
        const adjacency = new Map();
        for (const link of links) {
          if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
          if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
          adjacency.get(link.source).add(link.target);
          adjacency.get(link.target).add(link.source);
        }
        const depth = new Map([[root, 0]]);
        const queue = [root];
        while (queue.length) {
          const id = queue.shift();
          const d = depth.get(id);
          if (d >= settings.depth) continue;
          for (const next of adjacency.get(id) || []) {
            if (!depth.has(next)) { depth.set(next, d + 1); queue.push(next); }
          }
        }
        nodes = nodes.filter(n => depth.has(n.id));
        links = links.filter(l => depth.has(l.source) && depth.has(l.target));
      }
    }

    // 孤立节点统计（用当前候选连线）
    let degree = new Map(nodes.map(n => [n.id, 0]));
    for (const link of links) {
      if (degree.has(link.source)) degree.set(link.source, degree.get(link.source) + 1);
      if (degree.has(link.target)) degree.set(link.target, degree.get(link.target) + 1);
    }
    if (settings.orphansOnly) {
      nodes = nodes.filter(n => (degree.get(n.id) || 0) === 0);
      const only = new Set(nodes.map(n => n.id));
      links = links.filter(l => only.has(l.source) && only.has(l.target));
    }

    // 查询过滤
    if (state.query.trim()) {
      nodes = nodes.filter(n => query.matches(n, state.query));
      const hit = new Set(nodes.map(n => n.id));
      links = links.filter(l => hit.has(l.source) && hit.has(l.target));
      degree = new Map(nodes.map(n => [n.id, 0]));
      for (const link of links) {
        if (degree.has(link.source)) degree.set(link.source, degree.get(link.source) + 1);
        if (degree.has(link.target)) degree.set(link.target, degree.get(link.target) + 1);
      }
    }

    return { nodes, links, degree };
  }

  function rebuild(opts) {
    const options = opts || {};
    const filtered = filterGraph();
    if (options.fresh) state.positions.clear();

    // 复用已有位置，避免筛选时节点乱跳
    for (const node of filtered.nodes) {
      const p = state.positions.get(node.id);
      if (p) { node.x = p.x; node.y = p.y; node.vx = p.vx || 0; node.vy = p.vy || 0; }
      node.degree = filtered.degree.get(node.id) || 0;
    }

    state.nodes = filtered.nodes;
    state.links = filtered.links;
    state.index = new Map(state.nodes.map(n => [n.id, n]));
    state.sim = physics.createSimulation({
      nodes: state.nodes,
      links: state.links,
      settings: physicsSettings()
    });
    state.dirty = true;
    updateStats(filtered.degree);
    updateTreeSelection();
    if (options.fit) {
      // 先同步预热，避免首屏看到半成品布局
      for (let i = 0; i < 140; i++) state.sim.tick();
      syncPositions();
      fitView(false);
      fitPending = true;
    }
  }

  function syncPositions() {
    for (const node of state.nodes) {
      state.positions.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
    }
  }

  function updateStats(degree) {
    const total = state.graph ? state.graph.stats : { notes: 0 };
    let orphans = 0;
    if (degree) {
      for (const [, d] of degree) if (d === 0) orphans += 1;
    }
    $('#status-notes').textContent = String(total.notes || 0);
    $('#status-links').textContent = String(state.links.length);
    $('#status-nodes').textContent = String(state.nodes.length);
    $('#status-orphans').textContent = String(orphans);
  }

  /* ── 颜色分组 ───────────────────────────────────────────── */
  function colorOf(node) {
    for (const group of settings.groups) {
      if (group.query && group.query.trim() && query.matches(node, group.query)) return group.color;
    }
    return null;
  }

  /* ── 渲染循环 ───────────────────────────────────────────── */
  function radiusOf(node) {
    return physics.radiusOf(node, settings.nodeSize);
  }

  const linkKey = l => l.source + "|" + l.target + "|" + (l.kind || "");

  /** 每帧把透明度/强调度插值到目标值，得到渐入渐出而不是硬切 */
  function stepAnim() {
    const focus = state.hoveredId || state.selectedId;
    const hasFocus = Boolean(focus && state.index.has(focus));
    const near = new Set();
    if (hasFocus) {
      near.add(focus);
      for (const link of state.links) {
        if (link.source === focus) near.add(link.target);
        else if (link.target === focus) near.add(link.source);
      }
    }
    const rate = 0.16;
    let moving = false;
    for (const node of state.nodes) {
      const cur = state.anim.get(node.id) || { a: 1, e: 0 };
      const targetAlpha = hasFocus ? (near.has(node.id) ? 1 : 0.14) : 1;
      const targetEmph = node.id === state.hoveredId ? 1 : (node.id === state.selectedId ? 0.55 : 0);
      const a = cur.a + (targetAlpha - cur.a) * rate;
      const e = cur.e + (targetEmph - cur.e) * rate;
      if (Math.abs(targetAlpha - a) > 0.004 || Math.abs(targetEmph - e) > 0.004) moving = true;
      state.anim.set(node.id, { a, e });
    }
    for (const link of state.links) {
      const key = linkKey(link);
      const cur = state.linkAnim.has(key) ? state.linkAnim.get(key) : 1;
      const targetAlpha = hasFocus ? (near.has(link.source) && near.has(link.target) ? 1 : 0.1) : 1;
      const a = cur + (targetAlpha - cur) * rate;
      if (Math.abs(targetAlpha - a) > 0.004) moving = true;
      state.linkAnim.set(key, a);
    }
    return moving;
  }

  function highlightSet() {
    const focus = state.hoveredId || state.selectedId;
    if (!focus || !state.index.has(focus)) return null;
    const set = new Set([focus]);
    for (const link of state.links) {
      if (link.source === focus) set.add(link.target);
      else if (link.target === focus) set.add(link.source);
    }
    return set;
  }

  function draw() {
    const highlight = highlightSet();
    render.draw(ctx, {
      width: state.width,
      height: state.height,
      dpr: state.dpr,
      view: state.view,
      nodes: state.nodes,
      links: state.links,
      index: state.index,
      theme: state.theme,
      background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      settings: {
        arrows: settings.arrows,
        textFade: settings.textFade,
        nodeSize: settings.nodeSize,
        linkWidth: settings.linkWidth
      },
      hoveredId: state.hoveredId,
      selectedId: state.selectedId,
      favoritePaths: state.favorites,
      highlight,
      radiusOf,
      colorOf,
      alphaOf: node => (state.anim.get(node.id) ? state.anim.get(node.id).a : 1),
      emphasisOf: node => (state.anim.get(node.id) ? state.anim.get(node.id).e : 0),
      linkAlphaOf: link => (state.linkAnim.has(linkKey(link)) ? state.linkAnim.get(linkKey(link)) : 1)
    });
  }

  function resize() {
    const rect = shell.getBoundingClientRect();
    state.width = Math.max(1, rect.width);
    state.height = Math.max(1, rect.height);
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = state.width + 'px';
    canvas.style.height = state.height + 'px';
    state.dirty = true;
  }

  function frame() {
    if (state.sim && !state.sim.paused) {
      state.sim.tick();
      for (const node of state.nodes) {
        state.positions.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
      }
      state.dirty = true;
    }
    const dot = $('#engine-dot');
    const running = state.sim && !state.sim.paused;
    dot.classList.toggle('is-idle', !running);
    $('#status-engine').textContent = running ? '引擎运行中' : '引擎空闲';
    if (stepAnim()) state.dirty = true;
    if (state.sim && state.sim.paused && fitPending) {
      fitPending = false;
      syncPositions();
      fitView(true);
    }
    if (state.dirty) {
      draw();
      state.dirty = false;
    }
    requestAnimationFrame(frame);
  }

  /* ── 视图控制 ───────────────────────────────────────────── */
  function zoomAt(factor, sx, sy) {
    const px = sx == null ? state.width / 2 : sx;
    const py = sy == null ? state.height / 2 : sy;
    const next = clamp(state.view.scale * factor, 0.15, 4.5);
    const k = next / state.view.scale;
    state.view.x = px - (px - state.view.x) * k;
    state.view.y = py - (py - state.view.y) * k;
    state.view.scale = next;
    state.dirty = true;
  }

  function fitView(animate) {
    if (!state.nodes.length) { state.view = { x: state.width / 2, y: state.height / 2, scale: 1 }; state.dirty = true; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const pad = 70;
    const w = Math.max(maxX - minX, 40);
    const h = Math.max(maxY - minY, 40);
    const scale = clamp(Math.min((state.width - pad * 2) / w, (state.height - pad * 2) / h), 0.2, 2.2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const target = {
      scale,
      x: state.width / 2 - cx * scale,
      y: state.height / 2 - cy * scale
    };
    if (animate) animateView(target);
    else { state.view = target; state.dirty = true; }
  }

  function animateView(target) {
    const from = Object.assign({}, state.view);
    const start = performance.now();
    const duration = 340;
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      state.view.scale = from.scale + (target.scale - from.scale) * e;
      state.view.x = from.x + (target.x - from.x) * e;
      state.view.y = from.y + (target.y - from.y) * e;
      state.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function focusNode(id) {
    const node = state.index.get(id);
    if (!node) return;
    state.selectedId = id;
    animateView({
      scale: clamp(Math.max(state.view.scale, 1.2), 0.4, 2.4),
      x: state.width / 2 - node.x * clamp(Math.max(state.view.scale, 1.2), 0.4, 2.4),
      y: state.height / 2 - node.y * clamp(Math.max(state.view.scale, 1.2), 0.4, 2.4)
    });
    updateTreeSelection();
  }

  /* ── 指针交互 ───────────────────────────────────────────── */
  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function worldPoint(x, y) {
    return render.screenToWorld(state.view, x, y);
  }

  function hitTest(sx, sy) {
    const w = worldPoint(sx, sy);
    let best = null;
    let bestDist = Infinity;
    for (const node of state.nodes) {
      const r = radiusOf(node) + 6;
      const d = Math.hypot(node.x - w.x, node.y - w.y);
      if (d <= r && d < bestDist) { best = node; bestDist = d; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', e => {
    state.interacted = true;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const p = localPoint(e);
    const hit = hitTest(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
    state.pointerDown = { x: p.x, y: p.y, moved: false };

    if (hit) {
      const w = worldPoint(p.x, p.y);
      state.drag = { id: hit.id, dx: hit.x - w.x, dy: hit.y - w.y };
      state.selectedId = hit.id;
      state.sim.fixedId = hit.id;
      state.sim.reheat(0.35);
      updateTreeSelection();
      state.dirty = true;
    } else {
      state.pan = { x: p.x, y: p.y, viewX: state.view.x, viewY: state.view.y };
      canvas.classList.add('is-dragging');
    }
  });

  canvas.addEventListener('pointermove', e => {
    const p = localPoint(e);
    if (state.drag) {
      const w = worldPoint(p.x, p.y);
      const node = state.index.get(state.drag.id);
      if (node) {
        node.x = w.x + state.drag.dx;
        node.y = w.y + state.drag.dy;
        node.vx = 0;
        node.vy = 0;
        state.positions.set(node.id, { x: node.x, y: node.y, vx: 0, vy: 0 });
        state.sim.reheat(0.32);
        state.dirty = true;
      }
      if (state.pointerDown && Math.hypot(p.x - state.pointerDown.x, p.y - state.pointerDown.y) > 3) state.pointerDown.moved = true;
      return;
    }
    if (state.pan) {
      state.view.x = state.pan.viewX + (p.x - state.pan.x);
      state.view.y = state.pan.viewY + (p.y - state.pan.y);
      if (state.pointerDown && Math.hypot(p.x - state.pointerDown.x, p.y - state.pointerDown.y) > 3) state.pointerDown.moved = true;
      state.dirty = true;
      return;
    }
    const hit = hitTest(p.x, p.y);
    const nextHover = hit ? hit.id : null;
    if (nextHover !== state.hoveredId) { state.hoveredId = nextHover; state.dirty = true; }
    canvas.classList.toggle('is-hovering', Boolean(hit));
  });

  function endPointer(e) {
    const p = localPoint(e);
    const moved = Boolean(state.pointerDown && state.pointerDown.moved);
    const hit = hitTest(p.x, p.y);
    endDrag();
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    state.pointerDown = null;
    state.dirty = true;
    // 单击（没有拖动）= 直接打开笔记内容，和 Obsidian 一致
    if (!moved && hit) { openNote(hit.id); showView('note'); }
    // 单击空白处 = 取消选中
    else if (!moved && !hit) { state.selectedId = null; state.dirty = true; }
  }

  function endDrag() {
    if (state.drag) {
      state.drag = null;
      if (state.sim) state.sim.fixedId = null;
      if (state.sim) state.sim.reheat(0.2);
    }
    if (state.pan) {
      state.pan = null;
      canvas.classList.remove('is-dragging');
    }
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', e => {
    endDrag();
    state.pointerDown = null;
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerleave', () => {
    if (!state.drag && !state.pan && state.hoveredId) { state.hoveredId = null; state.dirty = true; }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    state.interacted = true;
    const p = localPoint(e);
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.033 : 0.0018));
    zoomAt(factor, p.x, p.y);
  }, { passive: false });
  canvas.addEventListener('dblclick', e => {
    const p = localPoint(e);
    const hit = hitTest(p.x, p.y);
    if (hit) { openNote(hit.id); showView('note'); }
    else fitView(true);
  });

/* ── 笔记视图（主视图） ─────────────────────────────────── */
  let currentNoteId = null;
  let editing = false;

  /* ── 拍题入库：图片识别成题目笔记 ───────────────────────── */
  const photoBtn = $('#btn-photo');
  const photoInput = $('#photo-input');
  let photoBusy = false;

  function photoStamp(date) {
    const pad = n => String(n).padStart(2, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate())
      + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
  }

  async function importPhoto(file) {
    if (photoBusy || !file) return;
    if (!/^image\//i.test(file.type || '') && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || '')) {
      return toast('请选择图片文件');
    }
    photoBusy = true;
    if (photoBtn) photoBtn.disabled = true;
    try {
      toast('正在识别题目…');
      const result = await ai.recognizeImage(file);
      if (!result || !result.ok) {
        toast(result && result.error ? result.error : '识别失败');
        return;
      }
      const text = String(result.text || '').trim();
      if (!text) {
        toast('没有识别到题目，换一张更清晰的图片试试');
        return;
      }
      const analysis = RG.ai.classifyLocally(text, '');
      const subject = RG.ai.normalizeSubject(analysis.subject || '其他');
      const points = RG.ai.sanitizeKnowledgePoints(analysis.knowledgePoints);
      const now = new Date();
      const title = subject + '拍题-' + photoStamp(now);
      const safeSubject = subject.replace(/[\/:*?"<>|]/g, '-').trim() || '其他';
      const path = uniquePath('10-错题本/' + safeSubject, title);
      const quoted = text.replace(/\r\n/g, '\n').split('\n').map(line => line ? '> ' + line : '>').join('\n');
      const content = [
        '---',
        'title: ' + title,
        'tags: [错题, 拍题, ' + subject + ']',
        '---',
        '',
        '# ' + title,
        '',
        '## 原题目',
        '',
        quoted,
        '',
        '## 学科与知识点',
        '',
        '- 学科：' + subject,
        '- 知识点：' + (points.length ? points.join('、') : '待整理'),
        '',
        '## 我的错因',
        '',
        '（待补充）',
        '',
        '## 正确思路',
        '',
        '（待补充）',
        ''
      ].join('\n');
      state.files.push({ path: path, content: content });
      refreshVault('已拍题入库：' + title);
      const node = state.graph && state.graph.notes.find(n => n.path === path);
      if (node) openNote(node.id);
      showView('note');
      toast('已拍题入库，可继续向 AI 追问');
    } catch (err) {
      toast('拍题失败：' + (err && err.message ? err.message : err));
    } finally {
      photoBusy = false;
      if (photoBtn) photoBtn.disabled = false;
    }
  }

  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', () => {
      if (!photoBusy) photoInput.click();
    });
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      photoInput.value = '';
      if (file) await importPhoto(file);
    });
  }

  /* ── 关系图谱右键菜单 ───────────────────────────────────── */
  const graphMenu = $('#graph-menu');
  const graphMenuTitle = $('#graph-menu-title');
  const graphMenuFavLabel = $('#graph-menu-fav-label');
  const graphPicker = $('#graph-picker');
  const graphPickerTitle = $('#graph-picker-title');
  const graphPickerDesc = $('#graph-picker-desc');
  const graphPickerSearch = $('#graph-picker-search');
  const graphPickerList = $('#graph-picker-list');
  let graphMenuNode = null;
  let graphPickerMode = '';
  let graphPickerNode = null;

  function loadFavorites() {
    try {
      const saved = store.getJSON('favorites', []);
      state.favorites = new Set(Array.isArray(saved) ? saved.filter(x => typeof x === 'string' && x) : []);
    } catch (_) {
      state.favorites = new Set();
    }
  }
  loadFavorites();

  function saveFavorites() {
    try { store.setJSON('favorites', [...state.favorites].slice(0, 500)); } catch (_) {}
  }

  function closeGraphMenu() {
    if (graphMenu) graphMenu.hidden = true;
    if (graphMenu) {
      graphMenu.classList.remove('align-left');
      graphMenu.querySelectorAll('.graph-menu-subwrap.is-open').forEach(el => el.classList.remove('is-open'));
    }
    graphMenuNode = null;
  }

  function openGraphMenu(event, node) {
    if (!graphMenu || !node) return;
    graphMenuNode = node;
    if (graphMenuTitle) graphMenuTitle.textContent = node.title || node.path || '未命名节点';
    if (graphMenuFavLabel) {
      graphMenuFavLabel.textContent = state.favorites.has(node.path) ? '取消收藏' : '收藏';
    }
    graphMenu.hidden = false;
    graphMenu.classList.remove('align-left');
    graphMenu.querySelectorAll('.graph-menu-subwrap.is-open').forEach(el => el.classList.remove('is-open'));
    const rect = graphMenu.getBoundingClientRect();
    const width = rect.width || 270;
    const height = rect.height || 420;
    let left = Math.min(event.clientX, window.innerWidth - width - 10);
    let top = Math.min(event.clientY, window.innerHeight - height - 10);
    left = Math.max(8, left);
    top = Math.max(8, top);
    graphMenu.style.left = left + 'px';
    graphMenu.style.top = top + 'px';
    if (left + width + 196 > window.innerWidth) graphMenu.classList.add('align-left');
  }

  function copyText(text) {
    const value = String(text == null ? '' : text);
    const done = () => toast('已复制：' + value.slice(0, 46));
    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        done();
      } catch (_) {
        toast('复制失败，请手动复制');
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function noteFile(node) {
    return state.files.find(f => f.path === node.path) || null;
  }

  function downloadNoteFile(node) {
    const file = noteFile(node);
    const blob = new Blob([String((file && file.content) || node.content || '')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = String(node.path || node.title || 'note.md').split('/').pop() || 'note.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出 ' + a.download + '，可用系统默认应用打开');
  }

  function revealInTree(node) {
    const parts = String(node.path || '').split('/');
    parts.pop();
    let acc = '';
    for (const part of parts) {
      acc = acc ? acc + '/' + part : part;
      state.collapsedFolders.delete(acc);
    }
    state.selectedId = node.id;
    renderTree();
    updateTreeSelection();
    const row = [...document.querySelectorAll('#file-tree .tree-file')].find(el => el.dataset.id === node.id);
    if (row) {
      if (row.scrollIntoView) row.scrollIntoView({ block: 'center' });
      row.classList.add('is-active');
      toast('已在文件列表中定位');
    }
  }

  function focusGraphNode(node) {
    showView('graph');
    if (state.index.has(node.id)) focusNode(node.id);
  }

  function showBacklinks(node) {
    openNote(node.id);
    showView('note');
    setTimeout(() => {
      const links = document.querySelector('.note-links');
      if (!links) return;
      if (links.scrollIntoView) links.scrollIntoView({ behavior: 'smooth', block: 'center' });
      links.classList.add('record-locate-flash');
      setTimeout(() => links.classList.remove('record-locate-flash'), 2400);
    }, 60);
  }

  function openNoteInNewWindow(node) {
    try {
      const url = new URL(location.href);
      url.searchParams.set('note', node.title);
      url.searchParams.set('view', 'note');
      const win = window.open(url.href, '_blank', 'noopener');
      if (!win) toast('浏览器拦截了新窗口，请允许弹窗后重试');
    } catch (_) {
      toast('当前环境无法打开新窗口');
    }
  }

  function toggleFavorite(node) {
    if (state.favorites.has(node.path)) {
      state.favorites.delete(node.path);
      toast('已取消收藏：' + node.title);
    } else {
      state.favorites.add(node.path);
      toast('已收藏：' + node.title);
    }
    saveFavorites();
    renderTree();
    updateTreeSelection();
    state.dirty = true;
    if (graphMenuFavLabel) graphMenuFavLabel.textContent = state.favorites.has(node.path) ? '取消收藏' : '收藏';
  }

  async function deleteGraphNote(node) {
    const ok = await askConfirm({
      title: '确认删除',
      message: '将删除 ' + node.path + '，此操作不可撤销。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    state.files = state.files.filter(f => f.path !== node.path);
    if (state.favorites.delete(node.path)) saveFavorites();
    refreshVault('已删除');
  }

  /* ── 文件夹 / 目标笔记选择器 ─────────────────────────────── */
  function closeGraphPicker() {
    if (graphPicker) graphPicker.hidden = true;
    graphPickerMode = '';
    graphPickerNode = null;
  }

  function openGraphPicker(mode, node) {
    if (!graphPicker) return;
    graphPickerMode = mode;
    graphPickerNode = node;
    if (graphPickerTitle) graphPickerTitle.textContent = mode === 'move' ? '移动文件到…' : '合并到笔记…';
    if (graphPickerDesc) {
      graphPickerDesc.textContent = mode === 'move'
        ? '为《' + node.title + '》选择一个目标文件夹'
        : '选择要接收《' + node.title + '》内容的笔记';
    }
    if (graphPickerSearch) {
      graphPickerSearch.value = '';
      graphPickerSearch.placeholder = mode === 'move' ? '搜索文件夹…' : '搜索笔记标题…';
    }
    graphPicker.hidden = false;
    renderGraphPickerList('');
    if (graphPickerSearch) graphPickerSearch.focus();
  }

  function renderGraphPickerList(keyword) {
    if (!graphPickerList) return;
    graphPickerList.innerHTML = '';
    const kw = String(keyword || '').trim().toLowerCase();
    let items = [];
    if (graphPickerMode === 'move') {
      const currentDir = String(graphPickerNode.path || '').split('/').slice(0, -1).join('/');
      items = [{ value: '', title: '根目录', path: '库根目录' }];
      for (const path of allFolderPaths()) {
        if (path === currentDir) continue;
        items.push({ value: path, title: path.split('/').pop(), path: path });
      }
    } else {
      const notes = state.graph ? state.graph.notes.filter(n => n.id !== graphPickerNode.id) : [];
      items = notes.map(n => ({ value: n.path, title: n.title, path: n.path, node: n }));
    }
    items = items.filter(item => !kw || (item.title + ' ' + item.path).toLowerCase().includes(kw)).slice(0, 80);
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'link-picker-empty';
      p.textContent = graphPickerMode === 'move' ? '没有可用文件夹' : '没有可合并的笔记';
      graphPickerList.appendChild(p);
      return;
    }
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-picker-item';
      const title = document.createElement('span');
      title.textContent = item.title;
      const path = document.createElement('span');
      path.className = 'link-picker-path';
      path.textContent = item.path;
      btn.append(title, path);
      btn.addEventListener('click', () => {
        const source = graphPickerNode;
        const mode = graphPickerMode;
        closeGraphPicker();
        if (!source) return;
        if (mode === 'move') moveGraphNote(source, item.value);
        else mergeGraphNote(source, item.node);
      });
      graphPickerList.appendChild(btn);
    }
  }

  function moveGraphNote(node, targetDir) {
    moveNote(node.path, targetDir);
    const moved = state.graph && state.graph.notes.find(n => n.title === node.title);
    if (moved) openNote(moved.id);
    toast('已移动到 ' + (targetDir || '根目录'));
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function mergeGraphNote(source, target) {
    if (!source || !target || source.id === target.id) return;
    const ok = await askConfirm({
      title: '合并笔记',
      message: '将《' + source.title + '》的正文合并到《' + target.title + '》，然后删除源文件；指向源文件的 Wiki 链接会改指向目标。此操作不可撤销。',
      okText: '合并',
      danger: true
    });
    if (!ok) return;
    const sourceFile = state.files.find(f => f.path === source.path);
    const targetFile = state.files.find(f => f.path === target.path);
    if (!sourceFile || !targetFile) return;
    const parsed = vault.parseFrontmatter(sourceFile.content || '');
    const body = String(parsed.body || sourceFile.content || '').trim();
    targetFile.content = String(targetFile.content || '').replace(/\s*$/, '')
      + '\n\n---\n\n## 来自《' + source.title + '》\n\n' + body + '\n';
    state.files = state.files.filter(f => f.path !== source.path);
    if (state.favorites.delete(source.path)) saveFavorites();
    const names = [source.title, String(source.path || '').replace(/\.md$/i, ''), source.path];
    for (const file of state.files) {
      if (typeof file.content !== 'string') continue;
      let content = file.content;
      for (const name of names) {
        if (!name) continue;
        const re = new RegExp('\\[\\[(' + escapeRegExp(name) + ')(\\|[^\\]]*)?\\]\\]', 'g');
        content = content.replace(re, function (_, _name, alias) {
          return '[[' + target.title + (alias || '') + ']]';
        });
      }
      file.content = content;
    }
    refreshVault('已合并到《' + target.title + '》');
    const targetNode = state.graph && state.graph.notes.find(n => n.path === target.path);
    if (targetNode) openNote(targetNode.id);
  }

  /* ── 菜单动作 ───────────────────────────────────────────── */
  function runGraphAction(action, node) {
    if (!node) return;
    if (action === 'open-tab') { openNote(node.id); showView('note'); return; }
    if (action === 'open-window') { openNoteInNewWindow(node); return; }
    if (action === 'move') { openGraphPicker('move', node); return; }
    if (action === 'favorite') { toggleFavorite(node); return; }
    if (action === 'merge') { openGraphPicker('merge', node); return; }
    if (action === 'copy-relative') { copyText(node.path); return; }
    if (action === 'copy-wikilink') { copyText('[[' + node.title + ']]'); return; }
    if (action === 'copy-title') { copyText(node.title); return; }
    if (action === 'reveal-folder') { revealInTree(node); return; }
    if (action === 'show-backlinks') { showBacklinks(node); return; }
    if (action === 'focus-graph') { focusGraphNode(node); return; }
    if (action === 'default-app') { downloadNoteFile(node); return; }
    if (action === 'explorer') { copyText(node.path); toast('浏览器版已复制相对路径；可在系统资源管理器中定位'); return; }
    if (action === 'show-tree') { revealInTree(node); return; }
    if (action === 'delete') { deleteGraphNote(node); return; }
  }

  if (graphMenu) {
    graphMenu.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.submenu) {
        const wrap = btn.closest('.graph-menu-subwrap');
        const open = wrap.classList.contains('is-open');
        graphMenu.querySelectorAll('.graph-menu-subwrap.is-open').forEach(el => el.classList.remove('is-open'));
        if (!open) wrap.classList.add('is-open');
        return;
      }
      if (!btn.dataset.act) return;
      const node = graphMenuNode;
      closeGraphMenu();
      runGraphAction(btn.dataset.act, node);
    });
  }

  const graphCanvasEl = $('#graph-canvas');
  if (graphCanvasEl) {
    graphCanvasEl.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const point = localPoint(e);
      const hit = hitTest(point.x, point.y);
      if (!hit || hit.type !== 'note') {
        closeGraphMenu();
        return;
      }
      state.selectedId = hit.id;
      state.dirty = true;
      openGraphMenu(e, hit);
    });
  }

  document.addEventListener('mousedown', e => {
    if (graphMenu && !graphMenu.hidden && !e.target.closest('#graph-menu')) closeGraphMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeGraphMenu();
      closeGraphPicker();
    }
  });
  window.addEventListener('resize', closeGraphMenu);
  window.addEventListener('blur', closeGraphMenu);

  if (graphPicker) {
    const closeBtn = $('#graph-picker-close');
    if (closeBtn) closeBtn.addEventListener('click', closeGraphPicker);
    graphPicker.addEventListener('pointerdown', e => { if (e.target === graphPicker) closeGraphPicker(); });
    if (graphPickerSearch) {
      graphPickerSearch.addEventListener('input', e => renderGraphPickerList(e.target.value));
    }
  }

  function currentNote() {
    if (!state.graph || !currentNoteId) return null;
    return state.graph.nodes.find(n => n.id === currentNoteId) || null;
  }

  function showView(view) {
    const isGraph = view === 'graph';
    $('#pane-note').hidden = isGraph;
    $('#pane-graph').hidden = !isGraph;
    $('#graph-tools').hidden = !isGraph;
    $('#view-note').classList.toggle('is-active', !isGraph);
    $('#view-graph').classList.toggle('is-active', isGraph);
    state.viewName = view;
    if (isGraph) {
      resize();
      state.dirty = true;
      if (currentNoteId) focusNode(currentNoteId);
    }
  }

  function tagChips(container, tags, onClick) {
    container.innerHTML = '';
    for (const tag of tags || []) {
      const chip = document.createElement('button');
      chip.className = 'tag-chip';
      chip.textContent = '#' + tag;
      chip.addEventListener('click', () => onClick(tag));
      container.appendChild(chip);
    }
  }

  function renderNote() {
    const node = currentNote();
    if (!node) {
      $('#note-empty').hidden = false;
      $('#note-view').hidden = true;
      return;
    }
    $('#note-empty').hidden = true;
    $('#note-view').hidden = false;
    $('#note-title').textContent = node.title;
    $('#note-path').textContent = node.path || '(无路径)';

    const body = $('#note-body');
    // 正文开头如果就是标题，去掉它，避免与页面标题重复
    let content = String(node.content || '');
    const headMatch = content.match(/^\s*#{1,3}\s+(.+)\n/);
    if (headMatch && headMatch[1].trim() === node.title.trim()) content = content.slice(headMatch[0].length);
    body.innerHTML = content.trim()
      ? markdown.render(content)
      : '<p class="md-empty">（这篇笔记还没有正文）</p>';

    tagChips($('#note-tags'), node.tags, tag => { showView('graph'); setSearch('tag:' + tag); });

    const words = String(node.content || '').replace(/\s+/g, '').length;
    const outlinks = (node.links || []).length;
    $('#note-meta').textContent = words + ' 字 · ' + outlinks + ' 条出链 · ' + (node.tags || []).length + ' 个标签';

    // 反向链接
    const backlinks = [];
    for (const link of state.graph.links) {
      if (link.target === node.id && link.kind !== 'tag') {
        const src = state.graph.nodes.find(n => n.id === link.source);
        if (src && src.type === 'note') backlinks.push(src);
      }
    }
    const ul = $('#backlinks');
    ul.innerHTML = '';
    $('#backlink-count').textContent = backlinks.length ? '(' + backlinks.length + ')' : '(0)';
    if (!backlinks.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '还没有笔记链接到这里';
      ul.appendChild(li);
    }
    for (const src of backlinks.slice(0, 30)) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'link-pill';
      btn.textContent = src.title;
      btn.addEventListener('click', () => openNote(src.id));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    updateTreeSelection();
  }

  function openNote(id) {
    const node = state.graph && state.graph.nodes.find(n => n.id === id);
    if (!node) return;
    if (node.type === 'note') touchUsage(node.path, 'open');
    if (typeof pluginHost !== 'undefined') pluginHost.emit('note:open', { note: node });
    if (typeof refreshNoteWidgets === 'function') refreshNoteWidgets();
    currentNoteId = id;
    state.selectedId = id;
    editing = false;
    $('#note-editor').hidden = true;
    $('#note-body').hidden = false;
    $('#btn-note-edit').textContent = '编辑';
    if (node.type === 'note') rememberNoteTab(id);
    else renderNoteTabs();
    renderNote();
  }

  function openNoteByTitle(title) {
    const node = findNodeByTitle(title);
    if (node && node.type === 'note') { openNote(node.id); return true; }
    return false;
  }

  function findNodeByTitle(title) {
    if (!state.graph) return null;
    const want = String(title).trim().toLowerCase();
    return state.graph.nodes.find(n => n.title.toLowerCase() === want)
      || state.graph.nodes.find(n => n.path.toLowerCase().replace(/\.md$/, '').endsWith(want));
  }

  /* 正文里的双链 / 标签 / 反链点击 */
  $('#note-body').addEventListener('click', e => {
    const linkEl = e.target.closest('[data-wikilink]');
    if (linkEl) {
      const title = linkEl.dataset.wikilink;
      if (!openNoteByTitle(title)) toast('尚未创建：' + title);
      return;
    }
    const tagEl = e.target.closest('.md-tag');
    if (tagEl) {
      showView('graph');
      setSearch('tag:' + tagEl.textContent.replace(/^#/, ''));
    }
  });

  /* 编辑：内存内修改 + 可下载，不直接写盘 */
  function toggleEdit() {
    const node = currentNote();
    if (!node) return;
    editing = !editing;
    const editor = $('#note-editor');
    if (editing) {
      // 进编辑：把 Markdown 渲染成富文本直接改，用户不用看语法
      editor.innerHTML = markdown.render(node.content || '') || '<p><br></p>';
      editor.hidden = false;
      $('#note-body').hidden = true;
      $('#btn-note-edit').textContent = '保存';
      editor.focus();
      placeCaretAtEnd(editor);
    } else {
      saveEditing(node, editor);
    }
  }

  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  /** 把编辑器内容写回笔记（不负责退出编辑态） */
  function commitEditor(node, editor) {
    const md = richtext.htmlToMarkdown(editor.innerHTML);
    touchUsage(node.path, 'edit');
    node.content = md;
    node.summary = vault.summarize(md);
    node.links = vault.extractLinks(md);
    node.tags = [...new Set(vault.extractTags(md))];
    // 写回数据源（保留原 frontmatter，只替换正文）
    const file = state.files.find(f => f.path === node.path);
    if (file) {
      const fm = String(file.content || '').match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      file.content = (fm ? fm[0] : '') + md;
    }
    state.graph = vault.buildVault(state.files);
    rebuild({});
    renderNote();
    saveLocalVault();
    if (typeof pluginHost !== 'undefined') pluginHost.emit('note:save', { note: node });
    return md;
  }

  /** 退出编辑态保存（按钮「保存」走这里） */
  function saveEditing(node, editor) {
    commitEditor(node, editor);
    editor.hidden = true;
    $('#note-body').hidden = false;
    $('#btn-note-edit').textContent = '编辑';
    toast('已保存');
  }

  /** Ctrl+S：只保存，不退出编辑、不打断光标位置 */
  function quickSave() {
    const node = currentNote();
    if (!node) return false;
    const editor = $('#note-editor');
    if (editing && !editor.hidden) {
      commitEditor(node, editor);
      toast('已保存（编辑继续，不影响光标）');
      return true;
    }
    // 没在编辑：把当前内容写进本机缓存，避免误以为没保存
    saveLocalVault();
    toast('已保存到本机缓存');
    return true;
  }

  function downloadNote() {
    const node = currentNote();
    if (!node) return;
    const blob = new Blob([node.content || ''], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (node.path || node.title + '.md').split('/').pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已下载 ' + a.download);
  }

  /* ── 应用内输入 / 确认框（替换原生 prompt / confirm） ──── */
  function askText(options) {
    const cfg = options || {};
    return new Promise(resolve => {
      const modal = $('#input-dialog');
      const field = $('#input-dialog-field');
      $('#input-dialog-title').textContent = cfg.title || '输入';
      $('#input-dialog-desc').textContent = cfg.desc || '';
      field.value = cfg.value || '';
      field.placeholder = cfg.placeholder || '';
      modal.hidden = false;
      setTimeout(() => { field.focus(); field.select(); }, 20);

      const done = value => {
        modal.hidden = true;
        field.onkeydown = null;
        $('#input-dialog-ok').onclick = null;
        $('#input-dialog-cancel').onclick = null;
        resolve(value);
      };
      $('#input-dialog-ok').onclick = () => done(field.value);
      $('#input-dialog-cancel').onclick = () => done(null);
      field.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); done(field.value); }
        else if (e.key === 'Escape') { e.preventDefault(); done(null); }
      };
    });
  }

  function askConfirm(options) {
    const cfg = options || {};
    return new Promise(resolve => {
      const modal = $('#confirm-dialog');
      const okBtn = $('#confirm-dialog-ok');
      $('#confirm-dialog-title').textContent = cfg.title || '确认';
      $('#confirm-dialog-text').textContent = cfg.message || '';
      okBtn.textContent = cfg.okText || '确定';
      okBtn.classList.toggle('is-danger', Boolean(cfg.danger));
      modal.hidden = false;

      const done = value => {
        modal.hidden = true;
        okBtn.onclick = null;
        $('#confirm-dialog-cancel').onclick = null;
        resolve(value);
      };
      okBtn.onclick = () => done(true);
      $('#confirm-dialog-cancel').onclick = () => done(false);
    });
  }

  /* ── 浏览器式笔记标签页 ─────────────────────────────────── */
  const NOTE_TABS_MAX = 24;
  const noteTabStrip = $('#note-tab-strip');
  const noteTabsEl = $('#note-tabs');
  let noteTabDragId = null;

  function noteTabNode(id) {
    if (!state.graph) return null;
    return state.graph.nodes.find(n => n.id === id && n.type === 'note') || null;
  }

  function persistNoteTabs() {
    try {
      store.setJSON('noteTabs', {
        tabs: state.openTabs.slice(0, NOTE_TABS_MAX),
        active: state.activeTab || null
      });
    } catch (_) {}
  }

  function restoreNoteTabs() {
    try {
      const saved = store.getJSON('noteTabs', null);
      if (!saved) return;
      const tabs = Array.isArray(saved.tabs) ? saved.tabs : [];
      state.openTabs = tabs
        .filter((id, i) => typeof id === 'string' && id && tabs.indexOf(id) === i)
        .slice(0, NOTE_TABS_MAX);
      if (typeof saved.active === 'string' && saved.active) state.activeTab = saved.active;
    } catch (_) {}
  }

  /** 库重建、切换库、删除笔记后，剔除已经不存在的标签。 */
  function pruneNoteTabs() {
    if (!state.graph) {
      state.openTabs = [];
      state.activeTab = null;
      return;
    }
    const valid = new Set(state.graph.notes.map(n => n.id));
    state.openTabs = state.openTabs.filter(id => valid.has(id));
    if (state.activeTab && !valid.has(state.activeTab)) {
      state.activeTab = valid.has(currentNoteId) ? currentNoteId : null;
    }
  }

  function clearNoteTabDropMarks() {
    $$('#note-tabs .note-tab').forEach(el => {
      el.classList.remove('is-drop-before', 'is-drop-after');
    });
  }

  function focusNoteTab(id) {
    requestAnimationFrame(() => {
      const tab = [...noteTabsEl.querySelectorAll('.note-tab')].find(el => el.dataset.id === id);
      if (tab) tab.focus();
    });
  }

  function moveNoteTab(fromId, targetId, after) {
    const from = state.openTabs.indexOf(fromId);
    const target = state.openTabs.indexOf(targetId);
    if (from < 0 || target < 0 || from === target) return;
    const moved = state.openTabs.splice(from, 1)[0];
    const at = state.openTabs.indexOf(targetId);
    state.openTabs.splice(after ? at + 1 : at, 0, moved);
    renderNoteTabs();
    persistNoteTabs();
  }

  function moveNoteTabToEnd(id) {
    const from = state.openTabs.indexOf(id);
    if (from < 0 || from === state.openTabs.length - 1) return;
    state.openTabs.push(state.openTabs.splice(from, 1)[0]);
    renderNoteTabs();
    persistNoteTabs();
  }

  function attachNoteTabDrag(tab, id) {
    tab.addEventListener('dragstart', e => {
      noteTabDragId = id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'note-tab:' + id); } catch (_) {}
      }
      tab.classList.add('is-dragging');
    });
    tab.addEventListener('dragend', () => {
      noteTabDragId = null;
      tab.classList.remove('is-dragging');
      clearNoteTabDropMarks();
    });
    tab.addEventListener('dragover', e => {
      if (!noteTabDragId || noteTabDragId === id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = tab.getBoundingClientRect();
      const after = (e.clientX - rect.left) > rect.width / 2;
      tab.classList.toggle('is-drop-before', !after);
      tab.classList.toggle('is-drop-after', after);
    });
    tab.addEventListener('dragleave', e => {
      if (e.relatedTarget && tab.contains(e.relatedTarget)) return;
      tab.classList.remove('is-drop-before', 'is-drop-after');
    });
    tab.addEventListener('drop', e => {
      if (!noteTabDragId) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = tab.getBoundingClientRect();
      const after = (e.clientX - rect.left) > rect.width / 2;
      const fromId = noteTabDragId;
      noteTabDragId = null;
      clearNoteTabDropMarks();
      moveNoteTab(fromId, id, after);
    });
  }

  function renderNoteTabs() {
    if (!noteTabStrip || !noteTabsEl) return;
    pruneNoteTabs();
    noteTabsEl.innerHTML = '';
    const items = state.openTabs.map(noteTabNode).filter(Boolean);
    noteTabStrip.hidden = items.length === 0;
    const activeId = currentNoteId && noteTabNode(currentNoteId) ? currentNoteId : null;
    if (activeId) state.activeTab = activeId;

    for (const note of items) {
      const tab = document.createElement('div');
      tab.className = 'note-tab' + (note.id === activeId ? ' is-active' : '');
      tab.dataset.id = note.id;
      tab.draggable = true;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', note.id === activeId ? 'true' : 'false');
      tab.tabIndex = note.id === activeId ? 0 : -1;
      tab.title = (note.title || '(无标题)') + '\n' + (note.path || '');

      const icon = document.createElement('span');
      icon.className = 'note-tab-icon';
      icon.textContent = '▤';
      icon.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'note-tab-title';
      label.textContent = note.title || '(无标题)';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'note-tab-close';
      close.title = '关闭标签页';
      close.setAttribute('aria-label', '关闭 ' + (note.title || '笔记'));
      close.textContent = '×';
      close.addEventListener('mousedown', e => e.stopPropagation());
      close.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeNoteTab(note.id);
      });

      tab.append(icon, label, close);
      tab.addEventListener('click', e => {
        if (e.target.closest('.note-tab-close')) return;
        openNote(note.id);
        showView('note');
      });
      tab.addEventListener('auxclick', e => {
        if (e.button === 1) {
          e.preventDefault();
          closeNoteTab(note.id);
        }
      });
      tab.addEventListener('keydown', e => {
        const index = state.openTabs.indexOf(note.id);
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNote(note.id);
          showView('note');
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          closeNoteTab(note.id);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const nextId = state.openTabs[index + (e.key === 'ArrowRight' ? 1 : -1)];
          if (!nextId) return;
          openNote(nextId);
          showView('note');
          focusNoteTab(nextId);
        }
      });
      attachNoteTabDrag(tab, note.id);
      noteTabsEl.appendChild(tab);
    }

    persistNoteTabs();
    requestAnimationFrame(() => {
      const active = [...noteTabsEl.querySelectorAll('.note-tab')].find(el => el.classList.contains('is-active'));
      if (!active) return;
      if (active.scrollIntoView) {
        try { active.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
      }
    });
  }

  /** 打开笔记时把它放进标签条；同一篇只保留一个标签。 */
  function rememberNoteTab(id) {
    if (!noteTabNode(id)) return false;
    if (!state.openTabs.includes(id)) {
      if (state.openTabs.length >= NOTE_TABS_MAX) {
        const victim = state.openTabs.find(tabId => tabId !== id);
        if (victim) state.openTabs.splice(state.openTabs.indexOf(victim), 1);
      }
      state.openTabs.push(id);
    }
    state.activeTab = id;
    renderNoteTabs();
    return true;
  }

  /** 没有可切换的标签时，回到「未选择笔记」的空状态。 */
  function clearCurrentNote() {
    currentNoteId = null;
    state.selectedId = null;
    state.activeTab = null;
    editing = false;
    const editor = $('#note-editor');
    const body = $('#note-body');
    if (editor) editor.hidden = true;
    if (body) body.hidden = false;
    const editBtn = $('#btn-note-edit');
    if (editBtn) editBtn.textContent = '编辑';
    renderNote();
    updateTreeSelection();
  }

  function closeNoteTab(id) {
    const index = state.openTabs.indexOf(id);
    if (index < 0) return;
    const wasActive = currentNoteId === id;
    state.openTabs.splice(index, 1);
    if (!wasActive) {
      if (state.activeTab === id) state.activeTab = currentNoteId;
      renderNoteTabs();
      persistNoteTabs();
      return;
    }
    const nextId = state.openTabs[index] || state.openTabs[index - 1] || null;
    showView('note');
    if (nextId) {
      openNote(nextId);
    } else {
      clearCurrentNote();
      renderNoteTabs();
    }
  }

  if (noteTabsEl) {
    noteTabsEl.addEventListener('dragover', e => {
      if (!noteTabDragId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    noteTabsEl.addEventListener('drop', e => {
      if (!noteTabDragId) return;
      if (e.target.closest && e.target.closest('.note-tab')) return;
      e.preventDefault();
      const fromId = noteTabDragId;
      noteTabDragId = null;
      clearNoteTabDropMarks();
      moveNoteTabToEnd(fromId);
    });
    noteTabsEl.addEventListener('wheel', e => {
      if (noteTabsEl.scrollWidth <= noteTabsEl.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      noteTabsEl.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  restoreNoteTabs();


  /* ── 文件树：多级目录 + 增删改查 ───────────────────────── */
  const VAULT_KEY = 'vault';
  let treeMenuTarget = null;

  const USAGE_KEY = 'usage';
  const ORDER_KEY = 'order';
  const SORT_KEY = 'sort';

  function loadMeta() {
    try { state.usage = store.getJSON(USAGE_KEY, {}) || {}; } catch (_) { state.usage = {}; }
    try { state.manualOrder = store.getJSON(ORDER_KEY, {}) || {}; } catch (_) { state.manualOrder = {}; }
    try { state.sortMode = store.get(SORT_KEY, 'usage') || 'usage'; } catch (_) { state.sortMode = 'usage'; }
  }

  function saveUsage() {
    try { store.setJSON(USAGE_KEY, state.usage); } catch (_) {}
  }

  function saveOrder() {
    try { store.setJSON(ORDER_KEY, state.manualOrder); } catch (_) {}
  }

  /** 记录一次使用：打开/编辑都会累加，用于「使用频率」和「更新日期」排序 */
  function touchUsage(path, kind) {
    if (!path) return;
    const rec = state.usage[path] || { count: 0, openedAt: 0, updatedAt: 0 };
    if (kind === 'open') rec.count += 1;
    rec.openedAt = Date.now();
    if (kind !== 'open') rec.updatedAt = Date.now();
    state.usage[path] = rec;
    saveUsage();
  }

  function usageOf(path) {
    const rec = state.usage[path];
    return rec ? rec.count : 0;
  }

  function updatedAtOf(path) {
    const rec = state.usage[path];
    if (rec && rec.updatedAt) return rec.updatedAt;
    if (rec && rec.openedAt) return rec.openedAt;
    const file = state.files.find(f => f.path === path);
    return (file && file.mtime) || 0;
  }

  /** 文件夹聚合使用频率：其下所有笔记之和 */
  function folderUsage(folderPath) {
    const prefix = folderPath + '/';
    let total = 0;
    for (const key in state.usage) {
      if (key.startsWith(prefix)) total += state.usage[key].count || 0;
    }
    return total;
  }

  function folderUpdatedAt(folderPath) {
    const prefix = folderPath + '/';
    let latest = 0;
    for (const key in state.usage) {
      if (key.startsWith(prefix)) latest = Math.max(latest, updatedAtOf(key));
    }
    return latest;
  }

  /** 手动顺序：没记录过的按名称排在后面 */
  function manualRank(parentPath, name) {
    const list = state.manualOrder[parentPath || ''] || [];
    const i = list.indexOf(name);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }

  function setManualOrder(parentPath, names) {
    state.manualOrder[parentPath || ''] = names;
    saveOrder();
  }

  function saveLocalVault() {
    try {
      store.setJSON(VAULT_KEY, {
        id: state.vaultId || null,
        label: state.vaultLabel,
        savedAt: Date.now(),
        files: state.files
      });
    } catch (_) {}
    if (typeof scheduleDiskSync === 'function') scheduleDiskSync();
  }

  function loadLocalVault() {
    try {
      const raw = store.getJSON(VAULT_KEY, null);
      if (!raw || !Array.isArray(raw.files) || !raw.files.length) return null;
      if (raw.id && raw.id !== 'demo' && typeof pendingVaultEntry !== 'undefined') {
        pendingVaultEntry = { id: raw.id, label: raw.label || '本地库' };
      }
      return raw;
    } catch (_) {
      return null;
    }
  }

  /** 由文件路径构建多级树 */
  function buildTree(notes) {
    const root = { name: '', path: '', folders: new Map(), notes: [] };
    for (const note of notes) {
      const parts = String(note.path || '').split('/');
      const fileName = parts.pop();
      let cursor = root;
      let acc = '';
      for (const part of parts) {
        acc = acc ? acc + '/' + part : part;
        if (!cursor.folders.has(part)) {
          cursor.folders.set(part, { name: part, path: acc, folders: new Map(), notes: [] });
        }
        cursor = cursor.folders.get(part);
      }
      cursor.notes.push(Object.assign({ fileName: fileName }, note));
    }
    return root;
  }

  function allFolderPaths() {
    const paths = [];
    const root = buildTree(state.graph ? state.graph.notes : []);
    const walk = node => {
      for (const folder of node.folders.values()) {
        paths.push(folder.path);
        walk(folder);
      }
    };
    walk(root);
    return paths;
  }

  function collapseAllFolders() {
    const paths = allFolderPaths();
    if (!paths.length) return toast('当前没有可收起的文件夹');
    const scrollTop = fileTree.scrollTop;
    state.collapsedFolders.clear();
    for (const path of paths) state.collapsedFolders.add(path);
    renderTree();
    fileTree.scrollTop = scrollTop;
    toast('已收起全部文件夹');
  }

  function expandAllFolders() {
    if (!state.collapsedFolders.size) {
      renderTree();
      return toast('文件夹已经全部展开');
    }
    const scrollTop = fileTree.scrollTop;
    state.collapsedFolders.clear();
    renderTree();
    fileTree.scrollTop = scrollTop;
    toast('已展开全部文件夹');
  }

  function renderTree() {
    fileTree.innerHTML = '';
    const notes = state.graph ? state.graph.notes : [];
    if (!notes.length) {
      const empty = document.createElement('p');
      empty.className = 'sidebar-foot';
      empty.textContent = '（空库，点上面的 ＋ 新建笔记）';
      fileTree.appendChild(empty);
      return;
    }
    fileTree.appendChild(renderFolderNode(buildTree(notes), 0));
  }

  /** 按当前排序模式排序文件夹 */
  function sortFolders(list, parentPath) {
    if (state.sortMode === 'manual') {
      return list.slice().sort((a, b) => {
        const ra = manualRank(parentPath, a.name);
        const rb = manualRank(parentPath, b.name);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
    }
    if (state.sortMode === 'updated') {
      return list.slice().sort((a, b) => folderUpdatedAt(b.path) - folderUpdatedAt(a.path) || a.name.localeCompare(b.name, 'zh-CN'));
    }
    if (state.sortMode === 'name') {
      return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    // 默认：使用频率优先
    return list.slice().sort((a, b) => folderUsage(b.path) - folderUsage(a.path) || a.name.localeCompare(b.name, 'zh-CN'));
  }

  /** 按当前排序模式排序笔记 */
  function sortNotes(list, parentPath) {
    if (state.sortMode === 'manual') {
      return list.slice().sort((a, b) => {
        const ra = manualRank(parentPath, a.fileName);
        const rb = manualRank(parentPath, b.fileName);
        if (ra !== rb) return ra - rb;
        return a.title.localeCompare(b.title, 'zh-CN');
      });
    }
    if (state.sortMode === 'updated') {
      return list.slice().sort((a, b) => updatedAtOf(b.path) - updatedAtOf(a.path) || a.title.localeCompare(b.title, 'zh-CN'));
    }
    if (state.sortMode === 'name') {
      return list.slice().sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    }
    return list.slice().sort((a, b) => usageOf(b.path) - usageOf(a.path) || a.title.localeCompare(b.title, 'zh-CN'));
  }

  function renderFolderNode(node, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-group';
    const collapsed = state.collapsedFolders;

    for (const folder of sortFolders([...node.folders.values()], node.path)) {
      const row = document.createElement('div');
      row.className = 'tree-folder';
      row.style.paddingLeft = (9 + depth * 12) + 'px';
      row.dataset.folder = folder.path;
      row.dataset.depth = String(depth);
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '▾';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = folder.name;
      row.append(chevron, name);

      const children = document.createElement('div');
      children.className = 'tree-children';
      children.appendChild(renderFolderNode(folder, depth + 1));
      const isCollapsed = collapsed.has(folder.path);
      children.hidden = isCollapsed;
      row.classList.toggle('is-collapsed', isCollapsed);

      row.addEventListener('click', () => {
        if (collapsed.has(folder.path)) collapsed.delete(folder.path);
        else collapsed.add(folder.path);
        children.hidden = collapsed.has(folder.path);
        row.classList.toggle('is-collapsed', children.hidden);
      });
      row.addEventListener('contextmenu', e => openTreeMenu(e, 'folder', folder.path));
      row.draggable = true;
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', 'folder:' + folder.path);
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', e => {
        e.preventDefault();
        row.classList.add('is-drop');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('is-drop');
        handleDrop(e.dataTransfer.getData('text/plain'), { kind: 'folder', path: folder.path });
      });

      wrap.appendChild(row);
      wrap.appendChild(children);
    }

    for (const note of sortNotes(node.notes, node.path)) {
      const row = document.createElement('div');
      row.className = 'tree-file';
      row.style.paddingLeft = (28 + depth * 12) + 'px';
      row.dataset.id = note.id;
      row.draggable = true;
      row.title = note.path;
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '▤';
      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = note.title;
      row.append(icon, label);
      if (state.favorites && state.favorites.has(note.path)) {
        const star = document.createElement('span');
        star.className = 'file-fav';
        star.textContent = '★';
        star.title = '已收藏';
        row.appendChild(star);
      }
      row.addEventListener('click', () => { openNote(note.id); showView('note'); });
      row.addEventListener('contextmenu', e => openTreeMenu(e, 'note', note.path));
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', 'note:' + note.path);
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', e => {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        row.classList.toggle('is-drop-before', !after);
        row.classList.toggle('is-drop-after', after);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('is-drop-before', 'is-drop-after');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('is-drop-before', 'is-drop-after');
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        handleDrop(e.dataTransfer.getData('text/plain'), { kind: 'note', path: note.path, after: after, parent: node.path });
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* ── 右键菜单 ───────────────────────────────────────────── */
  const treeMenu = $('#tree-menu');

  function openTreeMenu(event, kind, path) {
    event.preventDefault();
    event.stopPropagation();
    treeMenuTarget = { kind: kind, path: path };
    treeMenu.hidden = false;
    treeMenu.style.left = Math.min(event.clientX, window.innerWidth - 160) + 'px';
    treeMenu.style.top = Math.min(event.clientY, window.innerHeight - 150) + 'px';
  }

  function closeTreeMenu() {
    treeMenu.hidden = true;
    treeMenuTarget = null;
  }

  document.addEventListener('mousedown', e => {
    if (!treeMenu.hidden && !e.target.closest('#tree-menu')) closeTreeMenu();
  });

  treeMenu.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || !treeMenuTarget) return;
    const target = treeMenuTarget;
    closeTreeMenu();
    const dir = target.kind === 'folder' ? target.path : target.path.split('/').slice(0, -1).join('/');
    if (btn.dataset.act === 'new-note') createNote(dir);
    else if (btn.dataset.act === 'new-folder') createFolder(dir);
    else if (btn.dataset.act === 'rename') renameEntry(target);
    else if (btn.dataset.act === 'delete') deleteEntry(target);
  });

  $('#btn-new-note').addEventListener('click', () => {
    const dir = state.selectedId && state.graph
      ? (state.graph.nodes.find(n => n.id === state.selectedId) || { path: '' }).path.split('/').slice(0, -1).join('/')
      : '';
    createNote(dir);
  });
  $('#btn-new-folder').addEventListener('click', () => createFolder(''));
  $('#btn-collapse-all').addEventListener('click', collapseAllFolders);
  $('#btn-expand-all').addEventListener('click', expandAllFolders);

  /* ── 增删改查 ───────────────────────────────────────────── */
  function uniquePath(dir, base) {
    let candidate = (dir ? dir + '/' : '') + base + '.md';
    let i = 2;
    while (state.files.some(f => f.path === candidate)) {
      candidate = (dir ? dir + '/' : '') + base + '-' + i + '.md';
      i += 1;
    }
    return candidate;
  }

  async function createNote(dir) {
    const input = await askText({ title: '新建笔记', desc: '输入标题，会在当前文件夹下创建 .md 文件', value: '未命名笔记', placeholder: '例如：导数错题整理' });
    if (input == null) return;
    const title = input.trim();
    if (!title) return;
    const path = uniquePath(dir || '', title.replace(/[\/:*?"<>|]/g, '-'));
    state.files.push({ path: path, content: '# ' + title + '\n\n' });
    refreshVault('已新建笔记：' + title);
    openNoteByTitle(title);
    showView('note');
  }

  async function createFolder(dir) {
    const input = await askText({ title: '新建文件夹', desc: '文件夹可以无限嵌套', value: '新文件夹', placeholder: '例如：40-竞赛' });
    if (input == null) return;
    const folder = input.trim().replace(/[\/:*?"<>|]/g, '-');
    if (!folder) return;
    const path = (dir ? dir + '/' : '') + folder + '/.folder.md';
    if (state.files.some(f => f.path === path)) return toast('这个文件夹已存在');
    state.files.push({ path: path, content: '# ' + folder + '\n\n' });
    refreshVault('已新建文件夹：' + folder);
  }

  async function renameEntry(target) {
    const isFolder = target.kind === 'folder';
    const base = target.path.split('/').pop().replace(/\.md$/, '');
    const input = await askText({ title: isFolder ? '重命名文件夹' : '重命名笔记', desc: '改名后双链会自动重新解析', value: base });
    if (input == null) return;
    const clean = input.trim().replace(/[\/:*?"<>|]/g, '-');
    if (!clean || clean === base) return;
    const parentDir = target.path.split('/').slice(0, -1).join('/');
    if (isFolder) {
      const prefix = target.path + '/';
      for (const file of state.files) {
        if (file.path.startsWith(prefix)) {
          file.path = (parentDir ? parentDir + '/' : '') + clean + '/' + file.path.slice(prefix.length);
        }
      }
    } else {
      const file = state.files.find(f => f.path === target.path);
      if (!file) return;
      file.path = uniquePath(parentDir, clean);
    }
    refreshVault('已重命名');
  }

  async function deleteEntry(target) {
    const isFolder = target.kind === 'folder';
    const label = isFolder ? '文件夹 ' + target.path + ' 及其中所有内容' : target.path;
    const ok = await askConfirm({ title: '确认删除', message: '将删除 ' + label + '，此操作不可撤销。', okText: '删除', danger: true });
    if (!ok) return;
    if (isFolder) {
      const prefix = target.path + '/';
      state.files = state.files.filter(f => !f.path.startsWith(prefix));
    } else {
      state.files = state.files.filter(f => f.path !== target.path);
    }
    refreshVault('已删除');
  }

  function moveNote(fromPath, toDir) {
    const file = state.files.find(f => f.path === fromPath);
    if (!file) return;
    const currentDir = fromPath.split('/').slice(0, -1).join('/');
    if (currentDir === toDir) return;
    const name = fromPath.split('/').pop().replace(/\.md$/, '');
    file.path = uniquePath(toDir, name);
    refreshVault('已移动到 ' + (toDir || '根目录'));
  }

  /** 处理拖放：笔记进文件夹=移动；同级之间=手动排序 */
  function handleDrop(payload, target) {
    if (!payload) return;
    const sep = payload.indexOf(':');
    const kind = payload.slice(0, sep);
    const fromPath = payload.slice(sep + 1);
    if (!fromPath) return;

    if (kind === 'note') {
      if (target.kind === 'folder') { moveNote(fromPath, target.path); return; }
      const fromDir = fromPath.split('/').slice(0, -1).join('/');
      const toDir = target.parent || '';
      if (fromDir !== toDir) moveNote(fromPath, toDir);
      reorderWithin(toDir, fromPath, target.path, target.after);
      return;
    }

    if (kind === 'folder') {
      if (target.kind !== 'folder') return;
      const parent = fromPath.split('/').slice(0, -1).join('/');
      const targetParent = target.path.split('/').slice(0, -1).join('/');
      if (parent !== targetParent) return;
      reorderFolders(targetParent, fromPath, target.path);
    }
  }

  /** 笔记同级重排：把 fromPath 放到 targetPath 前/后，写入手动顺序 */
  function reorderWithin(dir, fromPath, targetPath, after) {
    const notes = sortNotes(
      (state.graph ? state.graph.notes : []).filter(n => n.path.startsWith(dir ? dir + '/' : '')
        && !n.path.slice(dir ? dir.length + 1 : 0).includes('/')),
      dir
    );
    const names = notes.map(n => n.path.split('/').pop());
    const fromName = fromPath.split('/').pop();
    const targetName = targetPath.split('/').pop();
    if (fromName === targetName) return;
    const without = names.filter(n => n !== fromName);
    let idx = without.indexOf(targetName);
    if (idx < 0) idx = without.length;
    else if (after) idx += 1;
    without.splice(idx, 0, fromName);
    setManualOrder(dir, without);
    switchToManual();
  }

  /** 文件夹同级重排 */
  function reorderFolders(parentPath, fromPath, targetPath) {
    const prefix = parentPath ? parentPath + '/' : '';
    const folders = sortFolders(
      [...new Set((state.graph ? state.graph.notes : []).
        map(n => n.path).filter(p => p.startsWith(prefix)).
        map(p => p.slice(prefix.length).split('/')[0]).filter(Boolean))]
        .map(name => ({ name: name, path: prefix + name })),
      parentPath
    );
    const names = folders.map(f => f.name);
    const fromName = fromPath.split('/').pop();
    const targetName = targetPath.split('/').pop();
    if (fromName === targetName) return;
    const without = names.filter(n => n !== fromName);
    let idx = without.indexOf(targetName);
    if (idx < 0) idx = without.length;
    without.splice(idx, 0, fromName);
    const existing = state.manualOrder[parentPath || ''] || [];
    const merged = without.concat(existing.filter(n => !without.includes(n)));
    setManualOrder(parentPath, merged);
    switchToManual();
  }

  /** 拖过一次就切到手动排序，避免下次刷新又被打回按频率排 */
  function switchToManual() {
    if (state.sortMode !== 'manual') {
      state.sortMode = 'manual';
      try { store.set(SORT_KEY, 'manual'); } catch (_) {}
      const sel = $('#sort-mode');
      if (sel) sel.value = 'manual';
    }
    refreshVault();
  }

  /** 结构改动后统一刷新：重解析 → 重画树 → 落本地 */
  function refreshVault(message) {
    const keep = currentNoteId;
    state.graph = vault.buildVault(state.files);
    state.positions = new Map();
    rebuild({ fresh: true });
    renderTree();
    if (keep && state.graph.nodes.some(n => n.id === keep)) openNote(keep);
    else if (state.graph.notes[0]) openNote(state.graph.notes[0].id);
    saveLocalVault();
    if (message) toast(message);
  }

  function updateTreeSelection() {
    $$('#file-tree .tree-file').forEach(row => {
      row.classList.toggle('is-active', row.dataset.id === state.selectedId);
    });
  }

  /* ── 设置面板 ───────────────────────────────────────────── */
  function formatSetting(key, value) {
    if (key === 'nodeSize') return Number(value).toFixed(1) + '×';
    if (key === 'linkWidth') return Number(value).toFixed(1);
    if (key === 'linkDistance') return Math.round(value) + 'px';
    return String(Math.round(value * 10) / 10);
  }

  function syncSettingsUI() {
    $$('[data-toggle]').forEach(el => {
      el.checked = Boolean(settings[el.dataset.toggle]);
    });
    $$('[data-setting]').forEach(el => {
      el.value = settings[el.dataset.setting];
      const out = $('#out-' + el.dataset.setting);
      if (out) out.textContent = formatSetting(el.dataset.setting, el.value);
    });
    $('#depth-input').value = settings.depth;
    $('#depth-output').textContent = String(settings.depth);
    $$('#mode-global, #mode-local').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.mode === settings.mode);
    });
    renderGroups();
  }

  function renderGroups() {
    const list = $('#group-list');
    list.innerHTML = '';
    settings.groups.forEach((group, index) => {
      const row = document.createElement('div');
      row.className = 'group-row';

      const color = document.createElement('input');
      color.type = 'color';
      color.value = group.color;
      color.addEventListener('input', () => { settings.groups[index].color = color.value; saveSettings(); state.dirty = true; });

      const text = document.createElement('input');
      text.type = 'text';
      text.value = group.query;
      text.placeholder = '搜索表达式，如 tag:错题';
      text.addEventListener('input', () => { settings.groups[index].query = text.value; saveSettings(); state.dirty = true; });

      const remove = document.createElement('button');
      remove.className = 'icon-btn small';
      remove.title = '删除分组';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        settings.groups.splice(index, 1);
        saveSettings();
        renderGroups();
        state.dirty = true;
      });

      row.append(color, text, remove);
      list.appendChild(row);
    });
  }

  $('#add-group').addEventListener('click', () => {
    settings.groups.push({ query: '', color: '#7a9eff' });
    saveSettings();
    renderGroups();
  });

  $('#reset-settings').addEventListener('click', () => {
    Object.assign(settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
    saveSettings();
    syncSettingsUI();
    rebuild({ fit: true });
    toast('已恢复默认设置');
  });

  $$('[data-toggle]').forEach(el => {
    el.addEventListener('change', () => {
      settings[el.dataset.toggle] = el.checked;
      saveSettings();
      rebuild({});
      state.dirty = true;
    });
  });

  $$('[data-setting]').forEach(el => {
    el.addEventListener('input', () => {
      const key = el.dataset.setting;
      settings[key] = Number(el.value);
      const out = $('#out-' + key);
      if (out) out.textContent = formatSetting(key, settings[key]);
      if (key === 'textFade') state.dirty = true;
      else {
        if (state.sim) state.sim.setSettings(physicsSettings());
        if (state.sim && key !== 'linkWidth') state.sim.reheat(0.25);
        state.dirty = true;
      }
      saveSettings();
    });
  });

  function setPanel(open) {
    settingsPanel.hidden = !open;
  }

  /* ── 搜索 ───────────────────────────────────────────────── */
  function setSearch(value) {
    state.query = value;
    searchInput.value = value;
    rebuild({});
    state.dirty = true;
    const n = state.nodes.length;
    if (value.trim()) toast('搜索命中 ' + n + ' 个节点');
  }

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    rebuild({});
    state.dirty = true;
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!prefsModal.hidden) { closePrefs(); return; } searchInput.value = ''; setSearch(''); searchInput.blur(); }
  });
  $('#search-clear').addEventListener('click', () => { setSearch(''); searchInput.focus(); });

  $('#file-search').addEventListener('input', e => {
    const keyword = e.target.value.trim().toLowerCase();
    $$('#file-tree .tree-file').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.classList.toggle('is-muted', Boolean(keyword) && !text.includes(keyword));
    });
  });

  /* ── 模式 / 视图按钮 ─────────────────────────────────────── */
  function setMode(mode) {
    if (settings.mode === mode) return;
    settings.mode = mode;
    saveSettings();
    syncSettingsUI();
    rebuild({ fit: true });
    toast(mode === 'local' ? '局部图谱 · 深度 ' + settings.depth : '全局图谱');
  }

  $$('#mode-global, #mode-local').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('#depth-input').addEventListener('input', e => {
    settings.depth = Number(e.target.value);
    $('#depth-output').textContent = String(settings.depth);
    saveSettings();
    if (settings.mode === 'local') rebuild({});
  });
  $('#btn-zoom-in').addEventListener('click', () => zoomAt(1.22));
  $('#btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.22));
  $('#btn-fit').addEventListener('click', () => fitView(true));
  $('#btn-relayout').addEventListener('click', () => {
    state.positions.clear();
    for (const node of state.nodes) { delete node.x; delete node.y; node.vx = 0; node.vy = 0; }
    rebuild({ fresh: true, fit: true });
    toast('已重新计算布局');
  });
  $('#btn-theme').addEventListener('click', cycleTheme);
  $('#btn-settings').addEventListener('click', () => setPanel(settingsPanel.hidden));
  $('#btn-settings-close').addEventListener('click', () => setPanel(false));

  $('#btn-open-folder').addEventListener('click', openViaPicker);
  $('#btn-demo').addEventListener('click', loadDemo);
  $('#btn-empty-demo').addEventListener('click', loadDemo);
  $('#btn-clear').addEventListener('click', () => {
    state.graph = null;
    state.files = [];
    state.nodes = [];
    state.links = [];
    state.index = new Map();
    state.sim = null;
    state.selectedId = null;
    state.positions.clear();
    state.vaultLabel = '（空）';
    $('#vault-name').textContent = '（空）';
    $('#vault-stats').textContent = '0 篇笔记';
    $('#graph-empty').hidden = false;
    renderTree();
    updateStats(new Map());
    state.dirty = true;
    toast('已清空');
  });

  $('#folder-input').addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const rootName = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : '本地库';
    const parsed = await readFileList(files);
    if (!parsed.length) {
      e.target.value = '';
      if (typeof launcherPickDone === 'function') launcherPickDone(false);
      return toast('这个文件夹里没有 Markdown 笔记');
    }
    loadFiles(parsed, rootName);
    toast('已读取 ' + rootName + '：' + parsed.length + ' 个文件');
    e.target.value = '';
    if (typeof launcherPickDone === 'function') launcherPickDone(true);
  });

  /* ── 拖放 ───────────────────────────────────────────────── */
  let dragDepth = 0;
  ['dragenter', 'dragover'].forEach(type => {
    window.addEventListener(type, e => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      if (e.target && e.target.closest && e.target.closest('#ai-panel')) return;
      e.preventDefault();
      if (type === 'dragenter') dragDepth += 1;
      $('#drop-hint').hidden = false;
    });
  });
  window.addEventListener('dragleave', e => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#drop-hint').hidden = true;
  });
  window.addEventListener('drop', async e => {
    if (!e.dataTransfer) return;
    if (e.target && e.target.closest && e.target.closest('#ai-panel')) return;
    e.preventDefault();
    dragDepth = 0;
    $('#drop-hint').hidden = true;
    try {
      const parsed = await readDataTransfer(e.dataTransfer);
      if (!parsed.length) return toast('没有找到 Markdown 笔记');
      loadFiles(parsed, '拖入的库');
      toast('已读取 ' + parsed.length + ' 个文件');
    } catch (err) {
      toast('读取失败：' + (err && err.message ? err.message : err));
    }
  });

  /* ── 右键：接管浏览器默认菜单 ───────────────────────────── */
  document.addEventListener('contextmenu', e => {
    // 输入框和富文本编辑区保留原生菜单（复制 / 粘贴 / 拼写检查要用）
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
  });

  /* ── 键盘 ───────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    const isSaveCombo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
    if (isSaveCombo) {
      e.preventDefault();
      if (e.shiftKey) downloadNote();
      else quickSave();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (e.key === 'Escape') {
      if (!settingsPanel.hidden) { setPanel(false); return; }
      if (document.activeElement === searchInput) { setSearch(''); searchInput.blur(); return; }
      state.selectedId = null;
      state.dirty = true;
      return;
    }
    if (inField) return;
    if (e.key === '/') { e.preventDefault(); searchInput.focus(); return; }
    const k = e.key.toLowerCase();
    if (k === 'p') { openPrefs(); return; }
    if (k === 'a') { setAiPanel($('#ai-panel').classList.contains('is-collapsed')); return; }
    if (k === 'f') fitView(true);
    else if (k === 'r') $('#btn-relayout').click();
    else if (k === 'g') setMode('global');
    else if (k === 'l') setMode('local');
    else if (k === 's') setPanel(settingsPanel.hidden);
    else if (e.key === '+' || e.key === '=') zoomAt(1.22);
    else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.22);
  });

  /* ── 图例 ───────────────────────────────────────────────── */
  function renderLegend() {
    const legend = $('#legend');
    legend.innerHTML = '';
    const colors = render.palette(state.theme);
    const items = [
      { label: '笔记', color: colors.node },
      { label: '标签', color: colors.tag },
      { label: '附件', color: colors.attachment },
      { label: '未创建', color: colors.unresolved }
    ];
    for (const group of settings.groups) {
      if (group.query && group.query.trim()) items.push({ label: group.query, color: group.color });
    }
    for (const item of items) {
      const wrap = document.createElement('span');
      wrap.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-swatch';
      dot.style.background = item.color;
      const label = document.createElement('span');
      label.textContent = item.label;
      wrap.append(dot, label);
      legend.appendChild(wrap);
    }
  }

  /* ── 选区工具条（选中文字后弹出） ───────────────────────── */
  const selToolbar = $('#sel-toolbar');
  let selMode = null;

  function hideSelToolbar() {
    selToolbar.hidden = true;
    selMode = null;
  }

  function updateSelToolbar() {
    const editor = $('#note-editor');
    const body = $('#note-body');
    let range = null;
    let mode = null;
    if (!editor.hidden && richtext.selectionIn(editor)) { mode = 'edit'; }
    else if (!body.hidden && richtext.selectionIn(body)) { mode = 'read'; }
    if (!mode) { hideSelToolbar(); return; }

    const sel = window.getSelection();
    range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideSelToolbar(); return; }

    selMode = mode;
    selToolbar.hidden = false;
    const tbWidth = selToolbar.offsetWidth || 220;
    const left = Math.max(8, Math.min(window.innerWidth - tbWidth - 8, rect.left + rect.width / 2 - tbWidth / 2));
    const top = Math.max(8, rect.top - 42 + window.scrollY);
    selToolbar.style.left = left + 'px';
    selToolbar.style.top = top + 'px';

    // 只读视图下隐藏「只对编辑有意义」的按钮
    for (const btn of selToolbar.querySelectorAll('.sel-btn')) {
      const fmt = btn.dataset.fmt;
      const editOnly = ['bold', 'italic', 'underline', 'mark', 'link', 'clear'].includes(fmt);
      btn.hidden = mode === 'read' && editOnly;
    }
  }

  document.addEventListener('mouseup', () => setTimeout(updateSelToolbar, 10));
  document.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Escape') setTimeout(updateSelToolbar, 10); });
  document.addEventListener('mousedown', e => {
    if (selToolbar.hidden) return;
    if (e.target.closest('#sel-toolbar')) return;
    if (e.target.closest('#note-editor, #note-body')) return;
    hideSelToolbar();
  });

  selToolbar.addEventListener('mousedown', e => e.preventDefault());

  selToolbar.addEventListener('click', e => {
    const btn = e.target.closest('.sel-btn');
    if (!btn) return;
    const fmt = btn.dataset.fmt;
    const editor = $('#note-editor');

    if (fmt === 'copy') {
      const text = window.getSelection().toString();
      if (text && navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('已复制'));
      hideSelToolbar();
      return;
    }
    if (fmt === 'ask') {
      const text = window.getSelection().toString().trim();
      if (text) {
        setAiPanel(true);
        ai.send('帮我讲讲这段：' + text.slice(0, 400));
      }
      hideSelToolbar();
      return;
    }
    if (selMode !== 'edit') return;

    if (fmt === 'bold') richtext.bold();
    else if (fmt === 'italic') richtext.italic();
    else if (fmt === 'underline') richtext.underline();
    else if (fmt === 'mark') richtext.highlight();
    else if (fmt === 'clear') richtext.clearFormat();
    else if (fmt === 'link') { openLinkPicker(); return; }

    editor.focus();
    updateSelToolbar();
  });

  /* ── 链接到笔记的选择器 ─────────────────────────────────── */
  const linkPicker = $('#link-picker');

  function openLinkPicker() {
    linkPicker.hidden = false;
    $('#link-picker-search').value = '';
    renderLinkPickerList('');
    $('#link-picker-search').focus();
  }

  function closeLinkPicker() { linkPicker.hidden = true; }

  function renderLinkPickerList(keyword) {
    const list = $('#link-picker-list');
    list.innerHTML = '';
    const notes = state.graph ? state.graph.notes.filter(n => n.type === 'note') : [];
    const kw = keyword.trim().toLowerCase();
    const shown = notes
      .filter(n => !kw || n.title.toLowerCase().includes(kw) || n.path.toLowerCase().includes(kw))
      .slice(0, 40);
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'link-picker-empty';
      p.textContent = '没有匹配的笔记';
      list.appendChild(p);
      return;
    }
    for (const note of shown) {
      const item = document.createElement('button');
      item.className = 'link-picker-item';
      const title = document.createElement('span');
      title.textContent = note.title;
      const path = document.createElement('span');
      path.className = 'link-picker-path';
      path.textContent = note.path;
      item.append(title, path);
      item.addEventListener('click', () => {
        richtext.wrapWithWikiLink($('#note-editor'), note.title);
        closeLinkPicker();
      });
      list.appendChild(item);
    }
  }

  $('#link-picker-close').addEventListener('click', closeLinkPicker);
  linkPicker.addEventListener('pointerdown', e => { if (e.target === linkPicker) closeLinkPicker(); });
  $('#link-picker-search').addEventListener('input', e => renderLinkPickerList(e.target.value));

  /* ── AI 优化格式 ────────────────────────────────────────── */
  $('#btn-note-format').addEventListener('click', async () => {
    const node = currentNote();
    if (!node) return;
    const editor = $('#note-editor');
    const source = editing ? richtext.htmlToMarkdown(editor.innerHTML) : String(node.content || '');
    if (!source.trim()) return toast('这篇还没有正文，没什么可整理的');
    toast('正在整理格式…');
    try {
      const result = await ai.optimizeFormat(source);
      const output = typeof result === 'string' ? result : (result && result.text) || '';
      const note = (result && result.note) || (result && result.used === 'model' ? '已用模型整理排版（正文未改动）' : '已用本地规则整理排版');
      if (!output.trim()) return toast('没有产生可用的排版结果');
      if (editing) {
        editor.innerHTML = markdown.render(output);
        toast(note + '，确认后点「保存」');
      } else {
        node.content = output;
        node.summary = vault.summarize(output);
        state.graph = vault.buildVault(state.files.map(f => (f.path === node.path ? Object.assign({}, f, { content: output }) : f)));
        rebuild({});
        renderNote();
        toast(note);
      }
    } catch (err) {
      toast('优化失败：' + (err && err.message ? err.message : err));
    }
  });

  /* ── 主题与背景色 ───────────────────────────────────────── */
  const BG_PRESETS = [
    { id: 'default', label: '默认', light: '#fbfbfd', dark: '#17181c' },
    { id: 'paper', label: '米纸', light: '#f7f1e6', dark: '#221f19' },
    { id: 'mint', label: '护眼', light: '#e8f1e6', dark: '#1b2019' },
    { id: 'blue', label: '淡蓝', light: '#e9eef9', dark: '#161b26' },
    { id: 'graphite', label: '石墨', light: '#ececee', dark: '#101114' }
  ];

  const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function resolveTheme() {
    const mode = settings.themeMode || 'system';
    if (mode === 'system') return systemDark && systemDark.matches ? 'dark' : 'light';
    return mode === 'dark' ? 'dark' : 'light';
  }

  function applyTheme() {
    state.theme = resolveTheme();
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dataset.bg = settings.bgPreset || 'default';
    state.dirty = true;
    updateThemeButton();
    try { store.set('theme', settings.themeMode || 'system'); } catch (_) {}
  }

  function updateThemeButton() {
    const btn = $('#btn-theme');
    if (!btn) return;
    const mode = settings.themeMode || 'system';
    const label = mode === 'system' ? '跟随系统' : (mode === 'dark' ? '黑夜' : '白日');
    btn.title = '主题：' + label + '（点击切换）';
    btn.classList.toggle('is-active', mode !== 'system');
  }

  function cycleTheme() {
    const order = ['light', 'dark', 'system'];
    const idx = order.indexOf(settings.themeMode || 'system');
    settings.themeMode = order[(idx + 1) % order.length];
    saveSettings();
    applyTheme();
    toast('主题：' + (settings.themeMode === 'system' ? '跟随系统' : settings.themeMode === 'dark' ? '黑夜' : '白日'));
  }

  function renderBgSwatches() {
    const box = $('#bg-swatches');
    if (!box) return;
    box.innerHTML = '';
    for (const preset of BG_PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'bg-swatch' + ((settings.bgPreset || 'default') === preset.id ? ' is-active' : '');
      btn.style.background = state.theme === 'dark' ? preset.dark : preset.light;
      btn.title = preset.label;
      const label = document.createElement('span');
      label.textContent = preset.label;
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        settings.bgPreset = preset.id;
        saveSettings();
        applyTheme();
        renderBgSwatches();
        toast('背景色：' + preset.label);
      });
      box.appendChild(btn);
    }
  }

  /* ── 云同步 ─────────────────────────────────────────────── */
  const cloud = RG.cloud;
  let cloudConfig = cloud.loadConfig();

  const CLOUD_FIELDS = {
    github: [
      { key: 'token', label: 'Token', type: 'password', placeholder: 'ghp_…（需 repo 权限）' },
      { key: 'owner', label: '用户名', type: 'text', placeholder: 'ressoap' },
      { key: 'repo', label: '仓库', type: 'text', placeholder: 'wenmo-notes' },
      { key: 'branch', label: '分支', type: 'text', placeholder: 'main' },
      { key: 'path', label: '文件路径', type: 'text', placeholder: 'wenmo-notes-backup.json' }
    ],
    gitee: [
      { key: 'token', label: '私人令牌', type: 'password', placeholder: '需 projects 权限' },
      { key: 'owner', label: '用户名', type: 'text', placeholder: 'ressoap' },
      { key: 'repo', label: '仓库', type: 'text', placeholder: 'wenmo-notes' },
      { key: 'branch', label: '分支', type: 'text', placeholder: 'master' },
      { key: 'path', label: '文件路径', type: 'text', placeholder: 'wenmo-notes-backup.json' }
    ],
    baidu: [
      { key: 'accessToken', label: 'access_token', type: 'password', placeholder: '百度网盘开放平台授权后获得' },
      { key: 'path', label: '网盘路径', type: 'text', placeholder: '/apps/wenmo-notes/backup.json' }
    ]
  };

  const CLOUD_HINTS = {
    github: '用官方 Contents API：填一个有 repo 权限的 token 即可，备份文件会作为普通提交写进仓库。',
    gitee: '用官方 OpenAPI v5：私人令牌需要 projects 权限，更新时自动带上文件 sha。',
    baidu: '用官方 xpan 开放接口：先在 .env 填 BAIDU_APP_KEY / BAIDU_SECRET_KEY，再点「获取百度 access_token」完成授权；回调页会把 token 显示出来，复制回这里。'
  };

  function renderCloudFields() {
    const provider = $('#cloud-provider').value;
    const box = $('#cloud-fields');
    box.innerHTML = '';
    const defs = CLOUD_FIELDS[provider] || [];
    const values = cloudConfig[provider] || {};
    for (const def of defs) {
      const label = document.createElement('label');
      label.className = 'prefs-row';
      const name = document.createElement('span');
      name.textContent = def.label;
      const input = document.createElement('input');
      input.type = def.type;
      input.placeholder = def.placeholder;
      input.dataset.cloudKey = def.key;
      input.value = values[def.key] || '';
      if (def.type === 'password') input.autocomplete = 'off';
      label.append(name, input);
      box.appendChild(label);
    }
    $('#cloud-hint').textContent = CLOUD_HINTS[provider] || '';
    const baiduAuth = $('#cloud-baidu-auth');
    if (baiduAuth) baiduAuth.hidden = provider !== 'baidu';
    if (cloudConfig.lastSync) {
      const when = new Date(cloudConfig.lastSync.at);
      $('#cloud-status').textContent = '上次备份：' + when.toLocaleString('zh-CN') + '（' + cloudConfig.lastSync.provider + '）';
    } else {
      $('#cloud-status').textContent = '';
    }
  }

  function collectCloudConfig() {
    const provider = $('#cloud-provider').value;
    const values = Object.assign({}, cloudConfig[provider] || {});
    for (const input of $('#cloud-fields').querySelectorAll('[data-cloud-key]')) {
      values[input.dataset.cloudKey] = input.value.trim();
    }
    cloudConfig.provider = provider;
    cloudConfig[provider] = values;
    cloud.saveConfig(cloudConfig);
    return cloudConfig;
  }

  $('#cloud-provider').addEventListener('change', () => {
    cloudConfig.provider = $('#cloud-provider').value;
    cloud.saveConfig(cloudConfig);
    renderCloudFields();
  });

  const baiduAuthBtn = $('#cloud-baidu-auth');
  if (baiduAuthBtn) {
    baiduAuthBtn.addEventListener('click', () => {
      if (location.protocol === 'file:') return toast('单文件模式没有 OAuth 回调服务，请用本地服务或桌面版获取 token');
      window.open('/oauth/baidu/start', '_blank', 'noopener');
    });
  }

  $('#cloud-test').addEventListener('click', async () => {
    const status = $('#cloud-status');
    status.textContent = '测试中…';
    try {
      const message = await cloud.testConnection(collectCloudConfig());
      status.textContent = '✅ ' + message;
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  $('#cloud-backup').addEventListener('click', async () => {
    const status = $('#cloud-status');
    const cfg = collectCloudConfig();
    status.textContent = '备份中…';
    try {
      const result = await cloud.backup(cfg, state.files, state.vaultLabel);
      cloudConfig.lastSync = { at: result.at, provider: cfg.provider };
      cloud.saveConfig(cloudConfig);
      status.textContent = '✅ 已备份 ' + state.files.length + ' 个文件，' + Math.round(result.bytes / 1024) + ' KB';
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  $('#cloud-restore').addEventListener('click', async () => {
    const status = $('#cloud-status');
    const cfg = collectCloudConfig();
    const okRestore = await askConfirm({ title: '从云端恢复', message: '会用云端备份覆盖当前库（' + state.files.length + ' 个文件）。', okText: '覆盖恢复', danger: true });
    if (!okRestore) return;
    status.textContent = '恢复中…';
    try {
      const snapshot = await cloud.restore(cfg);
      const files = snapshot.files.map(f => ({ path: f.path, content: f.content }));
      loadFiles(files, (snapshot.vault || '云端备份') + ' · 恢复于 ' + new Date().toLocaleString('zh-CN'));
      status.textContent = '✅ 已恢复 ' + files.length + ' 篇笔记（备份时间 ' + new Date(snapshot.savedAt).toLocaleString('zh-CN') + '）';
      closePrefs();
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  /* ── 视图 / AI 面板 / 笔记按钮 ──────────────────────────── */
  $('#view-note').addEventListener('click', () => showView('note'));
  $('#view-graph').addEventListener('click', () => showView('graph'));
  $('#btn-note-edit').addEventListener('click', toggleEdit);
  $('#btn-note-graph').addEventListener('click', () => {
    if (!currentNoteId) return;
    showView('graph');
    focusNode(currentNoteId);
  });
  $('#btn-note-ai').addEventListener('click', () => {
    setAiPanel(true);
    const node = currentNote();
    ai.send(node ? '分析「' + node.title + '」的核心考点和易错点' : '这个笔记库的整体结构怎么样');
  });
  $('#btn-ai').addEventListener('click', () => setAiPanel($('#ai-panel').classList.contains('is-collapsed')));
  $('#btn-ai-close').addEventListener('click', () => setAiPanel(false));

  function setAiPanel(open) {
    $('#ai-panel').classList.toggle('is-collapsed', !open);
    document.querySelector('.workspace').classList.toggle('no-ai', !open);
    $('#btn-ai').classList.toggle('is-active', open);
    if (typeof syncSidebarWidth === 'function') syncSidebarWidth();
    resize();
    state.dirty = true;
  }

  /* ── 设置窗口（AI / 本地数据） ──────────────────────────── */
  const prefsModal = $('#prefs-modal');
  const teacherModal = $('#teacher-modal');

  const TEACHER_TRAIT_FIELDS = [
    { key: 'lively', id: 'teacher-lively', out: 'teacher-lively-value' },
    { key: 'detail', id: 'teacher-detail', out: 'teacher-detail-value' },
    { key: 'guidance', id: 'teacher-guidance', out: 'teacher-guidance-value' },
    { key: 'correction', id: 'teacher-correction', out: 'teacher-correction-value' }
  ];
  const TEACHER_PROFILE_TEMPLATE = [
    '1. 讲题前先问我卡在哪一步，不要直接报最终答案。',
    '2. 每道题先写考点，再给思路，最后一步一步推导。',
    '3. 我算错时先指出错在哪一行，不要只给正确答案。',
    '4. 条件不足时先追问，不要自行假设条件。',
    '5. 公式用纯文本 / Unicode，步骤之间留空行。'
  ].join('\n');

  function updateTeacherCount() {
    const profile = $('#teacher-profile');
    const count = $('#teacher-count');
    if (profile && count) count.textContent = profile.value.length + ' / 6000';
  }

  function markTeacherDirty() {
    const status = $('#teacher-status');
    if (status) status.textContent = '有未保存的修改';
  }

  function renderTeacherConfig(cfg) {
    const source = (cfg && cfg.teacherProfile) || '';
    const profile = $('#teacher-profile');
    if (profile) {
      profile.value = source;
    }
    const traits = RG.ai.normalizeTeacherTraits((cfg && cfg.teacherTraits) || {});
    for (const field of TEACHER_TRAIT_FIELDS) {
      const input = document.getElementById(field.id);
      const out = document.getElementById(field.out);
      if (input) input.value = String(traits[field.key]);
      if (out) out.textContent = String(traits[field.key]);
    }
    updateTeacherCount();
    const status = $('#teacher-status');
    if (status) status.textContent = '';
  }

  function restoreTeacherDefaults() {
    const profile = $('#teacher-profile');
    if (profile) profile.value = '';
    const traits = RG.ai.DEFAULT_TEACHER_TRAITS;
    for (const field of TEACHER_TRAIT_FIELDS) {
      const input = document.getElementById(field.id);
      const out = document.getElementById(field.out);
      if (input) input.value = String(traits[field.key]);
      if (out) out.textContent = String(traits[field.key]);
    }
    updateTeacherCount();
  }

  function readTeacherConfig() {
    const profile = $('#teacher-profile');
    const traits = {};
    for (const field of TEACHER_TRAIT_FIELDS) {
      const input = document.getElementById(field.id);
      const n = Number(input && input.value);
      traits[field.key] = Number.isFinite(n) ? n : RG.ai.DEFAULT_TEACHER_TRAITS[field.key];
    }
    return {
      teacherProfile: String(profile ? profile.value : '').slice(0, 6000),
      teacherTraits: RG.ai.normalizeTeacherTraits(traits)
    };
  }

  function readTextFile(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取失败'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsText(file);
    });
  }

  function openTeacher() {
    renderTeacherConfig(ai.state.config);
    if (teacherModal) teacherModal.hidden = false;
    const btn = $('#btn-teacher');
    if (btn) btn.classList.add('is-active');
  }

  function closeTeacher() {
    if (teacherModal) teacherModal.hidden = true;
    const btn = $('#btn-teacher');
    if (btn) btn.classList.remove('is-active');
  }

  function openPrefs() {
    const cfg = ai.state.config;
    $('#prefs-mode').value = cfg.mode || 'proxy';
    $('#prefs-baseurl').value = cfg.baseUrl || '';
    $('#prefs-model').value = cfg.model || '';
    $('#prefs-vision-model').value = cfg.visionModel || '';
    $('#prefs-key').value = cfg.key || '';
    $('#prefs-ai-format').checked = Boolean(cfg.aiFormatModel);
    $('#prefs-model-status').textContent = '';
    $('#prefs-vault').textContent = state.vaultLabel || '—';
    $('#prefs-theme').value = settings.themeMode || 'system';
    renderBgSwatches();
    $('#cloud-provider').value = cloudConfig.provider || 'github';
    renderCloudFields();
    const listEl = $('#prefs-model-list');
    if (listEl && !listEl.children.length) {
      const cached = (ai.state.models || []).slice(0, 50);
      for (const id of cached) { const o = document.createElement('option'); o.value = id; listEl.appendChild(o); }
    }
    $('#prefs-status').textContent = ai.state.mode === 'local' ? '当前：本地分析模式' : '当前：' + (ai.state.mode === 'direct' ? '直连模式' : '代理模式');
    prefsModal.hidden = false;
    syncKeyRow();
  }

  function closePrefs() { prefsModal.hidden = true; }

  function syncKeyRow() {
    const mode = $('#prefs-mode').value;
    $('#prefs-key-row').hidden = mode !== 'direct';
  }

  $('#btn-prefs').addEventListener('click', openPrefs);
  $('#prefs-close').addEventListener('click', closePrefs);
  prefsModal.addEventListener('pointerdown', e => { if (e.target === prefsModal) closePrefs(); });
  const teacherBtn = $('#btn-teacher');
  if (teacherBtn) teacherBtn.addEventListener('click', openTeacher);
  const teacherClose = $('#teacher-close');
  if (teacherClose) teacherClose.addEventListener('click', closeTeacher);
  if (teacherModal) teacherModal.addEventListener('pointerdown', e => { if (e.target === teacherModal) closeTeacher(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && teacherModal && !teacherModal.hidden) closeTeacher();
  });
  $('#prefs-mode').addEventListener('change', syncKeyRow);
  $('#prefs-theme').addEventListener('change', e => {
    settings.themeMode = e.target.value;
    saveSettings();
    applyTheme();
    renderBgSwatches();
  });

  for (const field of TEACHER_TRAIT_FIELDS) {
    const input = document.getElementById(field.id);
    if (input) {
      input.addEventListener('input', () => {
        const out = document.getElementById(field.out);
        if (out) out.textContent = String(input.value);
        markTeacherDirty();
      });
    }
  }
  const teacherProfile = $('#teacher-profile');
  if (teacherProfile) {
    teacherProfile.addEventListener('input', () => { updateTeacherCount(); markTeacherDirty(); });
  }
  const teacherFile = $('#teacher-file');
  const teacherImport = $('#teacher-import');
  if (teacherImport && teacherFile) {
    teacherImport.addEventListener('click', () => teacherFile.click());
    teacherFile.addEventListener('change', async () => {
      const file = teacherFile.files && teacherFile.files[0];
      if (!file) return;
      const status = $('#teacher-status');
      if (status) status.textContent = '正在读取…';
      try {
        let text = await readTextFile(file);
        if (text.length > 6000) {
          text = text.slice(0, 6000);
          if (status) status.textContent = '文件较长，已截取前 6000 字';
        } else if (status) {
          status.textContent = '已载入 ' + file.name + '，点「保存性格」生效';
        }
        if (teacherProfile) teacherProfile.value = text;
        updateTeacherCount();
      } catch (err) {
        if (status) status.textContent = '读取失败：' + (err && err.message ? err.message : err);
      }
      teacherFile.value = '';
    });
  }
  const teacherTemplate = $('#teacher-template');
  if (teacherTemplate && teacherProfile) {
    teacherTemplate.addEventListener('click', () => {
      teacherProfile.value = TEACHER_PROFILE_TEMPLATE;
      updateTeacherCount();
      markTeacherDirty();
    });
  }
  const teacherClear = $('#teacher-clear');
  if (teacherClear && teacherProfile) {
    teacherClear.addEventListener('click', () => {
      teacherProfile.value = '';
      updateTeacherCount();
      markTeacherDirty();
    });
  }
  const teacherReset = $('#teacher-reset');
  if (teacherReset) {
    teacherReset.addEventListener('click', async () => {
      const ok = await askConfirm({
        title: '恢复默认性格',
        message: '会清空自定义讲课方式，并把四根滑杆恢复到默认值。',
        okText: '恢复',
        danger: true
      });
      if (!ok) return;
      restoreTeacherDefaults();
      const status = $('#teacher-status');
      if (status) status.textContent = '正在恢复…';
      await ai.applyConfig(readTeacherConfig());
      if (status) status.textContent = '已恢复默认性格';
      toast('已恢复默认性格');
    });
  }
  const teacherSave = $('#teacher-save');
  if (teacherSave) {
    teacherSave.addEventListener('click', async () => {
      const status = $('#teacher-status');
      if (status) status.textContent = '保存中…';
      await ai.applyConfig(readTeacherConfig());
      if (status) status.textContent = ai.state.mode === 'local' ? '已保存；接入模型后生效' : '已保存老师性格';
      toast('老师性格已保存');
    });
  }
  $('#prefs-open-folder').addEventListener('click', () => { closePrefs(); openViaPicker(); });

  $('#prefs-save').addEventListener('click', async () => {
    const patch = {
      mode: $('#prefs-mode').value,
      baseUrl: $('#prefs-baseurl').value.trim(),
      model: $('#prefs-model').value.trim(),
      visionModel: $('#prefs-vision-model').value.trim(),
      key: $('#prefs-key').value.trim(),
      aiFormatModel: $('#prefs-ai-format').checked
    };
    const mode = await ai.applyConfig(patch);
    $('#prefs-status').textContent = '已保存 · 当前模式：' + (mode === 'local' ? '本地分析' : mode === 'direct' ? '直连' : '代理');
    toast(mode === 'direct' ? '设置已保存（直连模式的 Key 只存在本机浏览器）' : '设置已保存（代理模式不保存 Key）');
  });

  $('#prefs-models').addEventListener('click', async () => {
    const statusEl = $('#prefs-model-status');
    statusEl.textContent = '拉取中…';
    const result = await ai.fetchModels({
      mode: $('#prefs-mode').value,
      baseUrl: $('#prefs-baseurl').value.trim(),
      model: $('#prefs-model').value.trim(),
      key: $('#prefs-key').value.trim()
    });
    if (!result.ok) { statusEl.textContent = '❌ ' + result.message; return; }
    const list = $('#prefs-model-list');
    list.innerHTML = '';
    for (const id of result.models) {
      const opt = document.createElement('option');
      opt.value = id;
      list.appendChild(opt);
    }
    statusEl.textContent = '✅ ' + result.message + '（点输入框可选）';
    if (!$('#prefs-model').value.trim() && result.models.length) {
      $('#prefs-model').value = result.models[0];
    }
  });

  $('#prefs-test').addEventListener('click', async () => {
    $('#prefs-status').textContent = '测试中…';
    const result = await ai.testConnection({
      mode: $('#prefs-mode').value,
      baseUrl: $('#prefs-baseurl').value.trim(),
      model: $('#prefs-model').value.trim(),
      key: $('#prefs-key').value.trim()
    });
    $('#prefs-status').textContent = (result.ok ? '✅ ' : '❌ ') + result.message;
  });

  $('#prefs-clear-key').addEventListener('click', () => {
    $('#prefs-key').value = '';
    ai.applyConfig({ key: '' });
    $('#prefs-status').textContent = '已清除 Key，回到本地分析模式';
  });

  $('#prefs-reset').addEventListener('click', () => {
    ai.clearConfig();
    store.resetAll();
    toast('已重置本地设置，即将刷新');
    setTimeout(() => location.reload(), 600);
  });

  /* AI 人设切换：答疑老师 / 笔记问答 */
  const SUGGEST = {
    tutor: [
      { label: '讲题', q: '这道题我不会做，帮我一步步讲清楚' },
      { label: '为什么', q: '为什么这个公式的适用条件是这两个' },
      { label: '找错因', q: '我总在这一类题上出错，帮我找原因' },
      { label: '举个例子', q: '用一个生活里的例子解释这个概念' }
    ],
    notes: [
      { label: '核心考点', q: '这篇笔记的核心考点是什么？' },
      { label: '薄弱环节', q: '帮我找出薄弱环节并给出复习计划' },
      { label: '孤立笔记', q: '这个库里哪些笔记还没有被链接？' },
      { label: '知识卡', q: '把当前笔记整理成一张知识卡' }
    ]
  };

  function applyAskMode(mode) {
    ai.setAskMode(mode);
    $('#ask-tutor').classList.toggle('is-active', mode === 'tutor');
    $('#ask-notes').classList.toggle('is-active', mode === 'notes');
    $('#ai-text').placeholder = mode === 'tutor'
      ? '直接把题目或疑问发给我…（Enter 发送，Shift+Enter 换行）'
      : '问关于你笔记库的问题…（Enter 发送，Shift+Enter 换行）';
    const box = $('#ai-suggest');
    box.innerHTML = '';
    for (const item of SUGGEST[mode]) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.q = item.q;
      b.textContent = item.label;
      box.appendChild(b);
    }
  }

  $('#ask-tutor').addEventListener('click', () => { closeRecordDetail(); applyAskMode('tutor'); });
  $('#ask-notes').addEventListener('click', () => { closeRecordDetail(); applyAskMode('notes'); });

  /* ── 问题记录：内嵌详情子选项卡 / 右键菜单 / 搜索 ─────── */
  const recordMenu = $('#record-menu');
  const recordInline = $('#record-inline');
  const recordInlineScroll = recordInline ? recordInline.querySelector('.record-inline-scroll') : null;
  const recordSubtab = $('#record-subtab');
  const aiChatcol = $('.ai-chatcol');
  let recordMenuTarget = null;
  let recordOpenId = null;

  function findRecordById(id) {
    return (ai.records() || []).find(r => r.id === id) || null;
  }

  /** 打开记录对应的错题笔记，并滚动到这条问答的具体位置 */
  function locateRecordInNote(record) {
    if (!record) return;
    const targetPath = String(record.targetPath || '');
    const targetTitle = String(record.targetTitle || '');
    let node = null;
    if (state.graph && targetPath) {
      node = state.graph.notes.find(n => n.path === targetPath || n.path.endsWith('/' + targetPath)) || null;
    }
    if (!node && targetTitle) node = findNodeByTitle(targetTitle);
    if (!node) return toast('找不到错题笔记：' + (targetTitle || targetPath || '尚未记入'));

    showView('note');
    openNote(node.id);

    const question = String(record.question || '').replace(/\s+/g, ' ').trim();
    const needle = question.slice(0, Math.min(40, question.length));
    const when = new Date(record.at || Date.now());
    const pad = n => String(n).padStart(2, '0');
    const stamp = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate())
      + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());

    setTimeout(() => {
      const body = $('#note-body');
      if (!body) return;
      const normalize = s => String(s || '').replace(/\s+/g, ' ').trim();
      const blocks = [...body.querySelectorAll('h2,h3,h4,h5,h6,p,li,blockquote')];
      let found = needle
        ? blocks.find(el => normalize(el.textContent).includes(needle))
        : null;
      if (!found) {
        const heading = blocks.find(el => /^H[2-6]$/.test(el.tagName) && normalize(el.textContent).includes('AI 答疑记录 ' + stamp));
        if (heading) found = heading.nextElementSibling || heading;
      }
      if (!found) return toast('已打开《' + node.title + '》，但没有找到这条记录');
      if (typeof found.scrollIntoView === 'function') found.scrollIntoView({ behavior: 'smooth', block: 'center' });
      found.classList.add('record-locate-flash');
      setTimeout(() => found.classList.remove('record-locate-flash'), 2400);
      toast('已定位到《' + node.title + '》中的这条记录');
    }, 40);
  }

  /** 把旧版平铺的 10-错题本/*.md 迁进 10-错题本/<学科>/，并同步记录目标路径 */
  function migrateMistakeFolders() {
    const mapping = new Map();
    const keep = currentNote();
    const keepTitle = keep ? keep.title : '';
    const bs = String.fromCharCode(92);
    const nl = String.fromCharCode(10);
    for (const file of state.files.slice()) {
      const m = String(file.path || '').match(new RegExp('^10-错题本/([^/]+' + bs + '.md)$'));
      if (!m) continue;
      const name = m[1];
      if (/使用指南|使用说明|模板|README/i.test(name)) continue;
      const raw = name.replace(new RegExp(bs + '.md$', 'i'), '');
      const subject = RG.ai.guessSubject(raw + nl + String(file.content || '').slice(0, 2000)).subject;
      if (!subject || subject === '其他') continue;
      const safe = subject.replace(/[\/:*?"<>|]/g, '-');
      const target = '10-错题本/' + safe + '/' + name;
      if (state.files.some(f => f.path === target)) continue;
      const oldPath = file.path;
      file.path = target;
      mapping.set(oldPath, target);
    }
    if (!mapping.size) return 0;
    state.graph = vault.buildVault(state.files);
    state.positions = new Map();
    renderTree();
    rebuild({ fresh: true });
    saveLocalVault();
    if (ai && ai.remapRecordPaths) ai.remapRecordPaths(mapping);
    if (keepTitle) {
      const node = state.graph.notes.find(n => n.title === keepTitle);
      if (node) openNote(node.id);
    }
    return mapping.size;
  }

  function openRecordDetail(record) {
    if (!record) return;
    recordOpenId = record.id;
    $('#record-inline-mode').textContent = record.mode === 'notes' ? '笔记问答' : '答疑老师';
    $('#record-inline-time').textContent = new Date(record.at).toLocaleString('zh-CN');
    const status = $('#record-inline-status');
    status.className = 'record-status ' + (record.status === 'resolved' ? 'is-resolved' : '');
    status.textContent = record.status === 'resolved'
      ? '已解决' + (record.targetTitle ? ' · 已记入《' + record.targetTitle + '》' : ' · 未记入错题本')
      : '待解决';
    $('#record-inline-question').textContent = record.question || '（无）';
    const answerEl = $('#record-inline-answer');
    answerEl.innerHTML = record.answer
      ? (markdown.renderAi ? markdown.renderAi(record.answer) : markdown.render(record.answer))
      : '（无）';
    $('#record-inline-toggle').textContent = record.targetTitle ? '取消记入错题本' : '记入错题本';
    const locateBtn = $('#record-inline-locate');
    if (locateBtn) locateBtn.hidden = !(record.targetPath || record.targetTitle);

    if (aiChatcol) aiChatcol.classList.add('is-record-view');
    if (recordInline) recordInline.hidden = false;
    if (recordInlineScroll) recordInlineScroll.scrollTop = 0;

    if (recordSubtab) {
      recordSubtab.hidden = false;
      $('#record-subtab-title').textContent = String(record.question || '问题记录').slice(0, 16);
      recordSubtab.classList.remove('is-in');
      void recordSubtab.offsetWidth;
      recordSubtab.classList.add('is-in');
    }
  }

  function closeRecordDetail() {
    recordOpenId = null;
    if (aiChatcol) aiChatcol.classList.remove('is-record-view');
    if (recordInline) recordInline.hidden = true;
    if (recordSubtab) recordSubtab.hidden = true;
  }

  $('#record-inline-locate').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    if (record) locateRecordInNote(record);
  });

  $('#record-inline-close').addEventListener('click', closeRecordDetail);
  $('#record-subtab-close').addEventListener('click', e => {
    e.stopPropagation();
    closeRecordDetail();
  });

  $('#record-inline-ask').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    closeRecordDetail();
    if (record) continueAsking(record);
  });

  $('#record-inline-copy').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    if (!record || !navigator.clipboard) return;
    const text = '问：' + (record.question || '') + String.fromCharCode(10, 10) + '答：' + String.fromCharCode(10) + (record.answer || '');
    navigator.clipboard.writeText(text).then(() => toast('已复制问答'));
  });

  $('#record-inline-toggle').addEventListener('click', () => {
    const record = findRecordById(recordOpenId);
    if (record) toggleRecordMistake(record);
  });

  /** 自动归档：按 API/本地分析出的学科建错题本，并写入知识点+日期标题 */
  function autoFileRecord(record, analysis, force) {
    if (!record) return null;
    const questionText = String(record.question || '');
    const isMeta = /哪些笔记.*链接|薄弱环节|复习计划|核心考点|知识卡|整体结构|分析.*笔记|整理.*笔记|这个库.*怎么样|怎么用|介绍一下|你是谁/.test(questionText);
    const subject = RG.ai.normalizeSubject((analysis && analysis.subject) || record.subject || '其他');
    if (!force && isMeta) return null;
    const points = RG.ai.sanitizeKnowledgePoints(
      (analysis && analysis.knowledgePoints && analysis.knowledgePoints.length)
        ? analysis.knowledgePoints
        : (record.knowledgePoints || [])
    );
    const safeSubject = subject.replace(/[\/:*?"<>|]/g, '-').trim() || '其他';
    const bookTitle = safeSubject + '-错题索引';
    const bookPath = '10-错题本/' + safeSubject + '/' + bookTitle + '.md';
    if (record.targetPath === bookPath) return null;

    let file = state.files.find(f => f.path === bookPath);
    if (!file) {
      file = {
        path: bookPath,
        content: [
          '---',
          'title: ' + bookTitle,
          'tags: [错题, ' + subject + ']',
          '---',
          '',
          '# ' + subject + '错题索引',
          '',
          '按知识点归档：',
          ''
        ].join('\n')
      };
      state.files.push(file);
    }

    const alreadyFiled = file && typeof RG.ai.mistakeContentHasQuestion === 'function'
      && RG.ai.mistakeContentHasQuestion(file.content, record.question);
    if (alreadyFiled) {
      const node = state.graph && state.graph.notes.find(n => n.path === bookPath);
      return { targetId: node ? node.id : null, targetTitle: bookTitle, targetPath: bookPath };
    }

    const snippet = RG.ai.mistakeSnippet(Object.assign({}, record, { subject, knowledgePoints: points }), analysis);
    file.content = String(file.content || '').replace(/\s*$/, '') + snippet;
    state.graph = vault.buildVault(state.files);
    renderTree();
    rebuild({});
    saveLocalVault();
    if (currentNoteId) renderNote();
    const node = state.graph.notes.find(n => n.path === bookPath);
    return { targetId: node ? node.id : null, targetTitle: bookTitle, targetPath: bookPath };
  }

  /** 记入 / 取消记入错题本 */
  function toggleRecordMistake(record) {
    if (record.targetTitle) {
      ai.updateRecord(record.id, { targetId: null, targetTitle: null, targetPath: null, status: 'open' });
      toast('已取消记入《' + record.targetTitle + '》，状态回到待解决');
      const fresh = findRecordById(record.id);
      if (recordOpenId === record.id && fresh) openRecordDetail(fresh);
      return;
    }
    const local = RG.ai.classifyLocally(record.question || '', record.answer || '');
    const analysis = {
      subject: record.subject || local.subject,
      knowledgePoints: (Array.isArray(record.knowledgePoints) && record.knowledgePoints.length)
        ? record.knowledgePoints
        : local.knowledgePoints
    };
    const filed = autoFileRecord(record, analysis, true);
    if (!filed || !filed.targetPath) return toast('自动归档失败，请检查错题本目录');
    const fresh = ai.updateRecord(record.id, {
      targetId: filed.targetId || null,
      targetTitle: filed.targetTitle,
      targetPath: filed.targetPath,
      status: 'resolved',
      resolvedAt: Date.now(),
      subject: analysis.subject,
      knowledgePoints: analysis.knowledgePoints,
      knowledgePoint: (analysis.knowledgePoints && analysis.knowledgePoints[0]) || ''
    });
    toast('已记入《' + filed.targetTitle + '》并标记为已解决');
    if (recordOpenId === record.id && fresh) openRecordDetail(fresh);
  }

  /** 继续追问：把这个问题带回答疑老师继续聊 */
  function continueAsking(record) {
    closeRecordDetail();
    applyAskMode('tutor');
    setAiPanel(true);
    const box = $('#ai-text');
    box.value = '接着上面这个问题继续：' + String(record.question || '').slice(0, 200);
    box.focus();
    toast('已把问题带回答疑老师，按 Enter 发送');
  }

  /* 右键菜单 */
  function openRecordMenu(event, record) {
    recordMenuTarget = record;
    recordMenu.hidden = false;
    recordMenu.style.left = Math.min(event.clientX, window.innerWidth - 170) + 'px';
    recordMenu.style.top = Math.min(event.clientY, window.innerHeight - 130) + 'px';
    const toggle = recordMenu.querySelector('[data-act="toggle-mistake"]');
    if (toggle) toggle.textContent = record.targetTitle ? '取消记入错题本' : '记入错题本';
  }

  function closeRecordMenu() {
    recordMenu.hidden = true;
    recordMenuTarget = null;
  }

  document.addEventListener('mousedown', e => {
    if (!recordMenu.hidden && !e.target.closest('#record-menu')) closeRecordMenu();
  });

  recordMenu.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn || !recordMenuTarget) return;
    const record = recordMenuTarget;
    closeRecordMenu();
    if (btn.dataset.act === 'toggle-mistake') toggleRecordMistake(record);
    else if (btn.dataset.act === 'ask-again') continueAsking(record);
    else if (btn.dataset.act === 'delete') {
      const okDel = await askConfirm({ title: '删除记录', message: '只删除这条问题记录，不会删除错题本里的内容。', okText: '删除', danger: true });
      if (!okDel) return;
      ai.deleteRecord(record.id);
      if (recordOpenId === record.id) closeRecordDetail();
      toast('已删除该条记录');
    }
  });

  /* 搜索 */
  const recordSearch = $('#record-search');
  if (recordSearch) {
    recordSearch.addEventListener('input', () => ai.setRecordSearch(recordSearch.value));
    recordSearch.addEventListener('keydown', e => {
      if (e.key === 'Escape') { recordSearch.value = ''; ai.setRecordSearch(''); recordSearch.blur(); }
    });
  }

  const recordDate = $('#record-date-filter');
  if (recordDate) recordDate.addEventListener('change', () => ai.setRecordDate(recordDate.value));

  /* ── AI 输入框：拖动上边缘扩大（类 QQ / 微信） ─────────── */
  const aiTextArea = $('#ai-text');
  const aiInputResizer = $('#ai-input-resizer');
  if (aiTextArea && aiInputResizer) {
    const MIN_INPUT_H = 104;
    const maxInputH = () => Math.max(MIN_INPUT_H, Math.min(Math.round(window.innerHeight * 0.55), 520));
    const clampInputH = h => Math.max(MIN_INPUT_H, Math.min(maxInputH(), Math.round(Number(h) || MIN_INPUT_H)));
    let inputStartY = 0;
    let inputStartH = 0;
    let inputDragging = false;
    const applyInputHeight = (h, persist) => {
      const next = clampInputH(h);
      aiTextArea.style.height = next + 'px';
      if (persist) store.set('aiInputHeight', next);
      return next;
    };
    applyInputHeight(store.get('aiInputHeight') || MIN_INPUT_H, false);

    aiInputResizer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      inputDragging = true;
      inputStartY = e.clientY;
      inputStartH = aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H;
      try { aiInputResizer.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.classList.add('is-resizing-ai-input');
      e.preventDefault();
    });
    aiInputResizer.addEventListener('pointermove', e => {
      if (!inputDragging) return;
      applyInputHeight(inputStartH + (inputStartY - e.clientY), false);
    });
    const stopInputDrag = () => {
      if (!inputDragging) return;
      inputDragging = false;
      document.body.classList.remove('is-resizing-ai-input');
      store.set('aiInputHeight', Math.round(aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H));
    };
    aiInputResizer.addEventListener('pointerup', stopInputDrag);
    aiInputResizer.addEventListener('pointercancel', stopInputDrag);
    aiInputResizer.addEventListener('lostpointercapture', stopInputDrag);
    aiInputResizer.addEventListener('dblclick', () => applyInputHeight(MIN_INPUT_H, true));
    aiInputResizer.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? 16 : -16;
      const current = aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H;
      applyInputHeight(current + delta, true);
    });
    window.addEventListener('resize', () => {
      const current = aiTextArea.getBoundingClientRect().height || aiTextArea.offsetHeight || MIN_INPUT_H;
      if (current > maxInputH()) applyInputHeight(maxInputH(), true);
    });
  }

  /* ── AI 面板：拖入图片只做聊天附件，不触发全库载入 ─────── */
  const aiPanel = $('#ai-panel');
  const aiInputBox = $('.ai-input');
  if (aiPanel && aiInputBox) {
    const hasFileDrag = e => Boolean(e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
    ['dragenter', 'dragover'].forEach(type => {
      aiPanel.addEventListener(type, e => {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        aiInputBox.classList.add('is-drag-over');
      });
    });
    aiPanel.addEventListener('dragleave', e => {
      if (!e.relatedTarget || !aiPanel.contains(e.relatedTarget)) aiInputBox.classList.remove('is-drag-over');
    });
    aiPanel.addEventListener('drop', async e => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      aiInputBox.classList.remove('is-drag-over');
      const files = [...(e.dataTransfer.files || [])];
      if (!files.some(f => /^image\//i.test(f.type || '') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || ''))) {
        toast('AI 助手只支持拖入图片');
        return;
      }
      try {
        const added = await ai.addImageFiles(files);
        toast(added ? '已添加 ' + added + ' 张图片' : '最多添加 3 张图片');
      } catch (err) {
        toast('图片读取失败：' + (err && err.message ? err.message : err));
      }
    });
  }

  /* ── AI 面板：左右拖动分割线调整宽度 ───────────────────── */
  const aiPanelEl = $('#ai-panel');
  const aiPanelResizer = $('#ai-resizer');
  if (aiPanelEl && aiPanelResizer) {
    const DEFAULT_AI_W = 560;
    const MIN_AI_W = 360;
    const maxAiW = () => Math.max(MIN_AI_W, Math.min(920, window.innerWidth - 40));
    const clampAiW = w => Math.max(MIN_AI_W, Math.min(maxAiW(), Math.round(Number(w) || DEFAULT_AI_W)));
    const applyAiWidth = (w, persist) => {
      const next = clampAiW(w);
      document.documentElement.style.setProperty('--ai-panel-w', next + 'px');
      if (persist) store.set('aiPanelWidth', next);
      return next;
    };
    applyAiWidth(store.get('aiPanelWidth') || DEFAULT_AI_W, false);

    let aiDragX = 0;
    let aiDragW = 0;
    let aiDragging = false;
    aiPanelResizer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      aiDragging = true;
      aiDragX = e.clientX;
      aiDragW = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      try { aiPanelResizer.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.classList.add('is-resizing-ai-panel');
      e.preventDefault();
    });
    aiPanelResizer.addEventListener('pointermove', e => {
      if (!aiDragging) return;
      applyAiWidth(aiDragW + (aiDragX - e.clientX), false);
    });
    const stopAiDrag = () => {
      if (!aiDragging) return;
      aiDragging = false;
      document.body.classList.remove('is-resizing-ai-panel');
      const current = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      store.set('aiPanelWidth', clampAiW(current));
    };
    aiPanelResizer.addEventListener('pointerup', stopAiDrag);
    aiPanelResizer.addEventListener('pointercancel', stopAiDrag);
    aiPanelResizer.addEventListener('lostpointercapture', stopAiDrag);
    aiPanelResizer.addEventListener('dblclick', () => applyAiWidth(DEFAULT_AI_W, true));
    aiPanelResizer.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const current = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      applyAiWidth(current + (e.key === 'ArrowLeft' ? 24 : -24), true);
    });
    window.addEventListener('resize', () => {
      const current = aiPanelEl.getBoundingClientRect().width || aiPanelEl.offsetWidth || DEFAULT_AI_W;
      if (current > maxAiW()) applyAiWidth(maxAiW(), true);
    });
  }

  const ai = RG.ai.create({
    getGraph: () => state.graph,
    getCurrentNote: () => currentNote(),
    onOpenNote: title => { if (!openNoteByTitle(title)) toast('尚未创建：' + title); },
    onToast: message => toast(message),
    onRecordOpen: record => openRecordDetail(record),
    onRecordAnalyzed: (record, analysis) => autoFileRecord(record, analysis),
    onRecordLocate: record => locateRecordInNote(record),
    onRecordMenu: (event, record) => openRecordMenu(event, record),
    onRecordMistake: record => {
      const local = RG.ai.classifyLocally(record.question || '', record.answer || '');
      const subject = record.subject || local.subject;
      const points = (Array.isArray(record.knowledgePoints) && record.knowledgePoints.length)
        ? record.knowledgePoints
        : local.knowledgePoints;
      const chosenTitle = record.targetTitle || '';
      if (subject && subject !== '其他' && chosenTitle && !chosenTitle.includes(subject)) {
        const filed = autoFileRecord(record, { subject, knowledgePoints: points }, true);
        if (filed && filed.targetPath) {
          ai.updateRecord(record.id, {
            targetId: filed.targetId || null,
            targetTitle: filed.targetTitle,
            targetPath: filed.targetPath,
            status: 'resolved',
            resolvedAt: Date.now(),
            subject,
            knowledgePoints: points,
            knowledgePoint: points[0] || ''
          });
          toast('已按学科自动改到《' + filed.targetTitle + '》');
          return;
        }
      }
      const snippet = RG.ai.mistakeSnippet(Object.assign({}, record, { subject, knowledgePoints: points }), { subject, knowledgePoints: points });
      let file = state.files.find(f => f.path === record.targetPath);
      const alreadyFiled = file && typeof RG.ai.mistakeContentHasQuestion === 'function'
        && RG.ai.mistakeContentHasQuestion(file.content, record.question);
      if (alreadyFiled) {
        toast('这条已经在《' + record.targetTitle + '》里，未重复写入');
        return;
      }
      if (file) file.content = String(file.content || '') + snippet;
      else state.files.push({ path: record.targetPath, content: snippet });
      state.graph = vault.buildVault(state.files);
      rebuild({});
      if (currentNoteId) renderNote();
      toast(record.duplicate ? '这条之前记过，《' + record.targetTitle + '》未重复写入' : '已记入《' + record.targetTitle + '》并标记为已解决');
    }  });

  /* ── 插件宿主 ───────────────────────────────────────────── */
  const pluginHost = RG.plugins.createHost({
    onToast: message => toast(message),
    getNotes: () => (state.graph ? state.graph.notes : []),
    getCurrentNote: () => currentNote(),
    openNote: id => { openNote(id); showView('note'); },
    askAi: text => { setAiPanel(true); ai.send(text); },
    onError: (id, message) => toast('插件 ' + id + '：' + message),
    onRegistryChange: () => renderPluginUI()
  });

  function renderPluginUI() {
    // 1) 工具栏按钮
    const bar = $('#plugin-buttons');
    if (bar) {
      bar.innerHTML = '';
      for (const btn of pluginHost.toolbarButtons()) {
        const el = document.createElement('button');
        el.className = 'ghost-btn plugin-btn';
        el.textContent = btn.label;
        el.title = btn.title || btn.label;
        el.addEventListener('click', () => {
          try { btn.onClick(); } catch (err) { toast('插件出错：' + err.message); }
        });
        bar.appendChild(el);
      }
    }

    // 2) 命令菜单
    const menu = $('#plugin-menu');
    if (menu && menu.hidden) {
      menu.innerHTML = '';
      const cmds = pluginHost.commands();
      if (!cmds.length) {
        const empty = document.createElement('div');
        empty.className = 'plugin-menu-empty';
        empty.textContent = '还没有插件命令';
        menu.appendChild(empty);
      }
      for (const cmd of cmds) {
        const b = document.createElement('button');
        b.textContent = cmd.title;
        b.addEventListener('click', () => {
          menu.hidden = true;
          try { cmd.run(); } catch (err) { toast('插件出错：' + err.message); }
        });
        menu.appendChild(b);
      }
    }

    // 3) 设置里的插件列表
    const list = $('#plugin-list');
    if (list) {
      list.innerHTML = '';
      const plugins = pluginHost.list();
      if (!plugins.length) {
        const p = document.createElement('p');
        p.className = 'prefs-tip';
        p.textContent = '还没有安装插件。可以先点「安装示例插件」看看效果。';
        list.appendChild(p);
      }
      for (const plugin of plugins) {
        const row = document.createElement('div');
        row.className = 'plugin-row';
        const info = document.createElement('div');
        info.className = 'plugin-info';
        const name = document.createElement('div');
        name.className = 'plugin-name';
        name.textContent = plugin.name + ' v' + plugin.version;
        const desc = document.createElement('div');
        desc.className = 'plugin-desc';
        desc.textContent = plugin.description || '（无说明）';
        info.append(name, desc);

        const actions = document.createElement('div');
        actions.className = 'plugin-actions';
        const toggle = document.createElement('button');
        toggle.className = 'ghost-btn tiny';
        toggle.textContent = plugin.enabled ? '停用' : '启用';
        toggle.addEventListener('click', () => {
          const ok = pluginHost.setEnabled(plugin.id, !plugin.enabled);
          if (!ok) toast('插件启用失败，已回退为停用');
          renderPluginUI();
          refreshNoteWidgets();
        });
        const remove = document.createElement('button');
        remove.className = 'ghost-btn tiny';
        remove.textContent = '卸载';
        remove.addEventListener('click', async () => {
          const okRemove = await askConfirm({ title: '卸载插件', message: '确定卸载「' + plugin.name + '」？', okText: '卸载', danger: true });
          if (!okRemove) return;
          pluginHost.uninstall(plugin.id);
          renderPluginUI();
          refreshNoteWidgets();
          toast('已卸载 ' + plugin.name);
        });
        actions.append(toggle, remove);
        row.append(info, actions);
        list.appendChild(row);
      }
    }
  }

  /** 笔记底部的插件挂件 */
  function refreshNoteWidgets() {
    const box = $('#plugin-widgets');
    if (!box) return;
    box.innerHTML = '';
    const note = currentNote();
    for (const widget of pluginHost.footerWidgets()) {
      const slot = document.createElement('div');
      slot.className = 'plugin-widget-slot';
      box.appendChild(slot);
      try { widget.render(slot, note); } catch (err) { toast('插件挂件出错：' + err.message); }
    }
  }

  $('#btn-plugin-menu').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('#plugin-menu');
    if (!menu) return;
    const willOpen = menu.hidden;
    renderPluginUI();
    menu.hidden = !willOpen;
    if (!menu.hidden) {
      const rect = e.currentTarget.getBoundingClientRect();
      const width = menu.offsetWidth || 200;
      menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
      menu.style.top = (rect.bottom + 6) + 'px';
    }
  });
  document.addEventListener('mousedown', e => {
    const menu = $('#plugin-menu');
    if (menu && !menu.hidden && !e.target.closest('#plugin-menu') && !e.target.closest('#btn-plugin-menu')) menu.hidden = true;
  });

  /* 安装 / 卸载 / 示例 */
  $('#plugin-toggle-form').addEventListener('click', () => {
    const form = $('#plugin-form');
    form.hidden = !form.hidden;
  });

  $('#plugin-install').addEventListener('click', async () => {
    const status = $('#plugin-status');
    const name = $('#plugin-name').value.trim() || '未命名插件';
    const code = $('#plugin-code').value;
    if (!code.trim()) { status.textContent = '❌ 代码不能为空'; return; }
    const okInstall = await askConfirm({ title: '安装插件', message: '插件代码会以本页面权限运行，能读写你的笔记。确定安装「' + name + '」？', okText: '安装' });
    if (!okInstall) return;
    try {
      pluginHost.install({ name: name, version: $('#plugin-version').value.trim() || '1.0.0', code: code });
      status.textContent = '✅ 已安装并启用：' + name;
      $('#plugin-code').value = '';
      $('#plugin-name').value = '';
      renderPluginUI();
      refreshNoteWidgets();
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  $('#plugin-fetch').addEventListener('click', async () => {
    const status = $('#plugin-status');
    const url = $('#plugin-url').value.trim();
    if (!url) { status.textContent = '请先填代码 URL'; return; }
    status.textContent = '拉取中…';
    try {
      const code = await pluginHost.fetchCode(url);
      $('#plugin-code').value = code;
      status.textContent = '✅ 已拉取 ' + code.length + ' 字符，确认后点「安装并启用」';
    } catch (err) {
      status.textContent = '❌ 拉取失败：' + (err && err.message ? err.message : err);
    }
  });

  $('#plugin-sample').addEventListener('click', () => {
    const samples = RG.samplePlugins || [];
    if (!samples.length) return toast('没有内置示例插件');
    for (const sample of samples) {
      try { pluginHost.install(sample); } catch (err) { toast('示例插件安装失败：' + err.message); }
    }
    renderPluginUI();
    refreshNoteWidgets();
    toast('已安装 ' + samples.length + ' 个示例插件');
  });

  /* ── 启动 ───────────────────────────────────────────────── */
  const ro = new ResizeObserver(() => resize());
  ro.observe(shell);

  settings.themeMode = settings.themeMode || loadTheme();
  applyTheme();
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener('change', () => { if ((settings.themeMode || 'system') === 'system') applyTheme(); });
  }
  loadMeta();
  const sortSelect = $('#sort-mode');
  if (sortSelect) {
    sortSelect.value = state.sortMode;
    sortSelect.addEventListener('change', () => {
      state.sortMode = sortSelect.value;
      try { store.set(SORT_KEY, state.sortMode); } catch (_) {}
      renderTree();
      toast('排序：' + sortSelect.options[sortSelect.selectedIndex].textContent);
    });
  }

  resize();
  syncSettingsUI();
  renderLegend();
  const localVault = loadLocalVault();
  if (localVault) {
    loadFiles(localVault.files, localVault.label || '本地库');
    toast('已恢复本地笔记库（' + localVault.files.length + ' 个文件）');
  } else {
    loadDemo();
  }
  showView('note');
  if (state.graph && state.graph.notes[0]) {
    const restoreTab = state.activeTab;
    if (restoreTab && state.graph.notes.some(n => n.id === restoreTab)) openNote(restoreTab);
    else openNote(state.graph.notes[0].id);
  } else {
    renderNoteTabs();
  }
  try {
    const params = new URLSearchParams(location.search);
    const themeParam = params.get('theme');
    if (themeParam === 'dark' || themeParam === 'light' || themeParam === 'system') { settings.themeMode = themeParam; }
    const bgParam = params.get('bg');
    if (bgParam) { settings.bgPreset = bgParam; }
    applyTheme();
    if (params.get('view') === 'graph') showView('graph');
    if (params.get('ai') === '0') setAiPanel(false);
    if (params.get('prefs') === '1') openPrefs();
    const openTitle = params.get('note');
    if (openTitle) openNoteByTitle(openTitle);
  } catch (_) {}
  applyAskMode('tutor');
  ai.initRecords().then(() => {
    if (typeof migrateMistakeFolders === 'function') migrateMistakeFolders();
  });
  pluginHost.boot();
  renderPluginUI();
  refreshNoteWidgets();
  pluginHost.emit('app:ready', { notes: state.graph ? state.graph.notes.length : 0 });
  if (typeof initLauncher === 'function') initLauncher();
  requestAnimationFrame(frame);

  window.__raceAiNote = {
    state, settings, rebuild, fitView, setMode, openNote, openNoteByTitle, sortNotes, sortFolders, handleDrop, touchUsage, showView, setAiPanel, openPrefs, applyAskMode, applyTheme, cycleTheme, quickSave, saveEditing, openRecordDetail, continueAsking, closeNoteTab, renderNoteTabs, openGraphMenu, closeGraphMenu, bindDiskRoot, syncDiskNow, resetDiskBinding, pluginHost, renderPluginUI, refreshNoteWidgets, loadFiles, loadDemo, ai,
    openLauncher, closeLauncher, enterVault, renderLauncher, removeVaultBook, vaultLibrary: readVaultList, commitActiveVault,
    openVaultMenu, closeVaultMenu, showVaultDetail, duplicateVaultBook, renameVaultBook, backupVaultBook, startLauncherPick, launcherPickDone, openViaPicker,
    get graph() { return state.graph; },
    query, vault, physics, render
  };
  window.__wenmoNotes = window.__raceAiNote; // 新名字别名；旧 API 名保留给测试与插件兼容
  console.log('[问墨笔记] ready');
})();
