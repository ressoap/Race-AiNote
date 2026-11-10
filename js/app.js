/* ============================================================
   app.js — 界面装配：载入真实 Markdown 库、筛选、交互、持久化
   ============================================================ */
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
  const STORAGE_KEY = 'race-ainote:v1';

  const DEFAULT_SETTINGS = {
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
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  function loadTheme() {
    try {
      const t = localStorage.getItem(STORAGE_KEY + ':theme');
      if (t === 'dark' || t === 'light') return t;
    } catch (_) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  const settings = loadSettings();
  const state = {
    theme: loadTheme(),
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
    if (state.graph.notes[0]) openNote(state.graph.notes[0].id);
    setSearch('');
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

  async function openViaPicker() {
    if (!window.showDirectoryPicker) return openViaInput();
    try {
      const dir = await window.showDirectoryPicker({ mode: 'read' });
      const files = [];
      await walkDirectory(dir, '', files);
      if (!files.length) return toast('这个文件夹里没有 Markdown 笔记');
      loadFiles(files, dir.name);
      toast('已读取 ' + dir.name + '：' + files.length + ' 个文件');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
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
      settings: {
        arrows: settings.arrows,
        textFade: settings.textFade,
        nodeSize: settings.nodeSize,
        linkWidth: settings.linkWidth
      },
      hoveredId: state.hoveredId,
      selectedId: state.selectedId,
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
    currentNoteId = id;
    state.selectedId = id;
    editing = false;
    $('#note-editor').hidden = true;
    $('#note-body').hidden = false;
    $('#btn-note-edit').textContent = '编辑';
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

  function saveEditing(node, editor) {
    const md = richtext.htmlToMarkdown(editor.innerHTML);
    touchUsage(node.path, 'edit');
    node.content = md;
    node.summary = vault.summarize(md);
    node.links = vault.extractLinks(md);
    node.tags = [...new Set(vault.extractTags(md))];
    editor.hidden = true;
    $('#note-body').hidden = false;
    $('#btn-note-edit').textContent = '编辑';
    state.graph = vault.buildVault(state.files.map(f => (f.path === node.path ? Object.assign({}, f, { content: md }) : f)));
    rebuild({});
    renderNote();
    toast('已保存到当前会话（Ctrl+S 可下载 .md）');
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

  /* ── 文件树：多级目录 + 增删改查 ───────────────────────── */
  const VAULT_KEY = 'race-ainote:vault';
  let treeMenuTarget = null;

  const USAGE_KEY = 'race-ainote:usage';
  const ORDER_KEY = 'race-ainote:order';
  const SORT_KEY = 'race-ainote:sort';

  function loadMeta() {
    try { state.usage = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') || {}; } catch (_) { state.usage = {}; }
    try { state.manualOrder = JSON.parse(localStorage.getItem(ORDER_KEY) || '{}') || {}; } catch (_) { state.manualOrder = {}; }
    try { state.sortMode = localStorage.getItem(SORT_KEY) || 'usage'; } catch (_) { state.sortMode = 'usage'; }
  }

  function saveUsage() {
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(state.usage)); } catch (_) {}
  }

  function saveOrder() {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(state.manualOrder)); } catch (_) {}
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
      localStorage.setItem(VAULT_KEY, JSON.stringify({
        label: state.vaultLabel,
        savedAt: Date.now(),
        files: state.files
      }));
    } catch (_) {}
  }

  function loadLocalVault() {
    try {
      const raw = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
      if (!raw || !Array.isArray(raw.files) || !raw.files.length) return null;
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
      row.style.paddingLeft = (6 + depth * 12) + 'px';
      row.dataset.folder = folder.path;
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
      row.style.paddingLeft = (20 + depth * 12) + 'px';
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

  function createNote(dir) {
    const input = window.prompt('新建笔记，输入标题：', '未命名笔记');
    if (input == null) return;
    const title = input.trim();
    if (!title) return;
    const path = uniquePath(dir || '', title.replace(/[\/:*?"<>|]/g, '-'));
    state.files.push({ path: path, content: '# ' + title + '\n\n' });
    refreshVault('已新建笔记：' + title);
    openNoteByTitle(title);
    showView('note');
  }

  function createFolder(dir) {
    const input = window.prompt('新建文件夹，输入名称：', '新文件夹');
    if (input == null) return;
    const folder = input.trim().replace(/[\/:*?"<>|]/g, '-');
    if (!folder) return;
    const path = (dir ? dir + '/' : '') + folder + '/.folder.md';
    if (state.files.some(f => f.path === path)) return toast('这个文件夹已存在');
    state.files.push({ path: path, content: '# ' + folder + '\n\n' });
    refreshVault('已新建文件夹：' + folder);
  }

  function renameEntry(target) {
    const isFolder = target.kind === 'folder';
    const base = target.path.split('/').pop().replace(/\.md$/, '');
    const input = window.prompt(isFolder ? '重命名文件夹：' : '重命名笔记：', base);
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

  function deleteEntry(target) {
    const isFolder = target.kind === 'folder';
    const label = isFolder ? '文件夹 ' + target.path + ' 及其中所有内容' : target.path;
    if (!window.confirm('确定删除 ' + label + ' ？')) return;
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
      try { localStorage.setItem(SORT_KEY, 'manual'); } catch (_) {}
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
  $('#btn-theme').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    try { localStorage.setItem(STORAGE_KEY + ':theme', state.theme); } catch (_) {}
    state.dirty = true;
  });
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
    if (!parsed.length) return toast('这个文件夹里没有 Markdown 笔记');
    loadFiles(parsed, rootName);
    toast('已读取 ' + rootName + '：' + parsed.length + ' 个文件');
    e.target.value = '';
  });

  /* ── 拖放 ───────────────────────────────────────────────── */
  let dragDepth = 0;
  ['dragenter', 'dragover'].forEach(type => {
    window.addEventListener(type, e => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
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

  /* ── 键盘 ───────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
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
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); downloadNote(); return; }
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

  /* ── 云同步 ─────────────────────────────────────────────── */
  const cloud = RG.cloud;
  let cloudConfig = cloud.loadConfig();

  const CLOUD_FIELDS = {
    github: [
      { key: 'token', label: 'Token', type: 'password', placeholder: 'ghp_…（需 repo 权限）' },
      { key: 'owner', label: '用户名', type: 'text', placeholder: 'ressoap' },
      { key: 'repo', label: '仓库', type: 'text', placeholder: 'Race-AiNote' },
      { key: 'branch', label: '分支', type: 'text', placeholder: 'main' },
      { key: 'path', label: '文件路径', type: 'text', placeholder: 'race-ainote-backup.json' }
    ],
    gitee: [
      { key: 'token', label: '私人令牌', type: 'password', placeholder: '需 projects 权限' },
      { key: 'owner', label: '用户名', type: 'text', placeholder: 'ressoap' },
      { key: 'repo', label: '仓库', type: 'text', placeholder: 'race-ai-note' },
      { key: 'branch', label: '分支', type: 'text', placeholder: 'master' },
      { key: 'path', label: '文件路径', type: 'text', placeholder: 'race-ainote-backup.json' }
    ],
    baidu: [
      { key: 'accessToken', label: 'access_token', type: 'password', placeholder: '百度网盘开放平台授权后获得' },
      { key: 'path', label: '网盘路径', type: 'text', placeholder: '/apps/race-ainote/backup.json' }
    ],
    quark: []
  };

  const CLOUD_HINTS = {
    github: '用官方 Contents API：填一个有 repo 权限的 token 即可，备份文件会作为普通提交写进仓库。',
    gitee: '用官方 OpenAPI v5：私人令牌需要 projects 权限，更新时自动带上文件 sha。',
    baidu: '用官方 xpan 开放接口：需要先在百度网盘开放平台创建应用并完成 OAuth 授权拿到 access_token；上传经本地服务中转，避开浏览器跨域。',
    quark: '夸克网盘没有对第三方开放的官方接口（市面上的方案都是逆向 cookie），按「有官方接口才做」的原则这里不做。'
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
    const disabled = provider === 'quark';
    for (const id of ['cloud-test', 'cloud-backup', 'cloud-restore']) {
      $('#' + id).disabled = disabled;
      $('#' + id).style.opacity = disabled ? 0.5 : 1;
    }
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
    if (!window.confirm('从云端恢复会覆盖当前库（' + state.files.length + ' 个文件），确定继续？')) return;
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
    resize();
    state.dirty = true;
  }

  /* ── 设置窗口（AI / 本地数据） ──────────────────────────── */
  const prefsModal = $('#prefs-modal');

  function openPrefs() {
    const cfg = ai.state.config;
    $('#prefs-mode').value = cfg.mode || 'proxy';
    $('#prefs-baseurl').value = cfg.baseUrl || '';
    $('#prefs-model').value = cfg.model || '';
    $('#prefs-key').value = cfg.key || '';
    $('#prefs-ai-format').checked = Boolean(cfg.aiFormatModel);
    $('#prefs-model-status').textContent = '';
    $('#prefs-vault').textContent = state.vaultLabel || '—';
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
  $('#prefs-mode').addEventListener('change', syncKeyRow);
  $('#prefs-open-folder').addEventListener('click', () => { closePrefs(); openViaPicker(); });

  $('#prefs-save').addEventListener('click', async () => {
    const patch = {
      mode: $('#prefs-mode').value,
      baseUrl: $('#prefs-baseurl').value.trim(),
      model: $('#prefs-model').value.trim(),
      key: $('#prefs-key').value.trim(),
      aiFormatModel: $('#prefs-ai-format').checked
    };
    const mode = await ai.applyConfig(patch);
    $('#prefs-status').textContent = '已保存 · 当前模式：' + (mode === 'local' ? '本地分析' : mode === 'direct' ? '直连' : '代理');
    toast('设置已保存（Key 只存在本机浏览器）');
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
    localStorage.removeItem('race-ainote:v1');
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

  $('#ask-tutor').addEventListener('click', () => applyAskMode('tutor'));
  $('#ask-notes').addEventListener('click', () => applyAskMode('notes'));

  const ai = RG.ai.create({
    getGraph: () => state.graph,
    getCurrentNote: () => currentNote(),
    onOpenNote: title => { if (!openNoteByTitle(title)) toast('尚未创建：' + title); },
    onToast: message => toast(message),
    onRecordMistake: record => {
      const snippet = RG.ai.mistakeSnippet(record);
      let file = state.files.find(f => f.path === record.targetPath);
      const questionKey = String(record.question || '').slice(0, 18);
      if (file && questionKey && String(file.content || '').includes(questionKey)) {
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

  /* ── 启动 ───────────────────────────────────────────────── */
  const ro = new ResizeObserver(() => resize());
  ro.observe(shell);

  loadMeta();
  const sortSelect = $('#sort-mode');
  if (sortSelect) {
    sortSelect.value = state.sortMode;
    sortSelect.addEventListener('change', () => {
      state.sortMode = sortSelect.value;
      try { localStorage.setItem(SORT_KEY, state.sortMode); } catch (_) {}
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
  if (state.graph && state.graph.notes[0]) openNote(state.graph.notes[0].id);
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'graph') showView('graph');
    if (params.get('ai') === '0') setAiPanel(false);
    if (params.get('prefs') === '1') openPrefs();
    const openTitle = params.get('note');
    if (openTitle) openNoteByTitle(openTitle);
  } catch (_) {}
  applyAskMode('tutor');
  requestAnimationFrame(frame);

  window.__raceAiNote = {
    state, settings, rebuild, fitView, setMode, openNote, openNoteByTitle, sortNotes, sortFolders, handleDrop, touchUsage, showView, setAiPanel, openPrefs, applyAskMode, loadFiles, loadDemo, ai,
    get graph() { return state.graph; },
    query, vault, physics, render
  };
  console.log('[Race-AiNote] ready');
})();
