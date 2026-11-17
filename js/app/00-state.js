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
    vaultLabel: '示例库'
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
