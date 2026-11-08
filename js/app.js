/* ============================================================
   app.js — 界面装配：载入真实 Markdown 库、筛选、交互、持久化
   ============================================================ */
(function () {
  'use strict';

  const vault = RG.vault;
  const query = RG.query;
  const markdown = RG.markdown;
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
      editor.value = node.content || '';
      editor.hidden = false;
      $('#note-body').hidden = true;
      $('#btn-note-edit').textContent = '保存';
      editor.focus();
    } else {
      node.content = editor.value;
      node.summary = vault.summarize(node.content);
      node.links = vault.extractLinks(node.content);
      node.tags = [...new Set([...vault.extractTags(node.content), ...(node.frontmatter && node.frontmatter.tags ? [] : [])])];
      editor.hidden = true;
      $('#note-body').hidden = false;
      $('#btn-note-edit').textContent = '编辑';
      state.graph = vault.buildVault(state.files.map(f => (f.path === node.path ? Object.assign({}, f, { content: node.content }) : f)));
      rebuild({});
      renderNote();
      toast('已保存到当前会话（Ctrl+S 可下载 .md）');
    }
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

  /* ── 文件树 ─────────────────────────────────────────────── */
  function renderTree() {
    fileTree.innerHTML = '';
    if (!state.graph || !state.graph.notes.length) {
      const empty = document.createElement('p');
      empty.className = 'sidebar-foot';
      empty.textContent = '（空）';
      fileTree.appendChild(empty);
      return;
    }
    const folders = new Map();
    for (const note of state.graph.notes) {
      const dir = note.dir || '';
      if (!folders.has(dir)) folders.set(dir, []);
      folders.get(dir).push(note);
    }
    const dirs = [...folders.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    for (const dir of dirs) {
      const folder = document.createElement('div');
      folder.className = 'tree-folder';
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '▾';
      const name = document.createElement('span');
      name.textContent = dir || '/';
      folder.append(chevron, name);
      const group = document.createElement('div');
      folder.addEventListener('click', () => {
        const collapsed = group.hidden;
        group.hidden = !collapsed;
        folder.classList.toggle('is-collapsed', collapsed);
      });
      fileTree.appendChild(folder);
      fileTree.appendChild(group);
      const notes = folders.get(dir).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      for (const note of notes) {
        const row = document.createElement('div');
        row.className = 'tree-file';
        row.dataset.id = note.id;
        row.title = note.path;
        const icon = document.createElement('span');
        icon.className = 'file-icon';
        icon.textContent = '▤';
        const label = document.createElement('span');
        label.className = 'file-name';
        label.textContent = note.title;
        row.append(icon, label);
        row.addEventListener('click', () => { openNote(note.id); showView('note'); });
        group.appendChild(row);
      }
    }
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
    $('#prefs-model-status').textContent = '';
    $('#prefs-vault').textContent = state.vaultLabel || '—';
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
      key: $('#prefs-key').value.trim()
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
    onRecordMistake: record => {
      const snippet = RG.ai.mistakeSnippet(record);
      let file = state.files.find(f => f.path === record.targetPath);
      if (file) file.content = String(file.content || '') + snippet;
      else state.files.push({ path: record.targetPath, content: snippet });
      state.graph = vault.buildVault(state.files);
      rebuild({});
      if (currentNoteId) renderNote();
      toast('已记入《' + record.targetTitle + '》');
    }
  });

  /* ── 启动 ───────────────────────────────────────────────── */
  const ro = new ResizeObserver(() => resize());
  ro.observe(shell);

  resize();
  syncSettingsUI();
  renderLegend();
  loadDemo();
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
    state, settings, rebuild, fitView, setMode, openNote, openNoteByTitle, showView, setAiPanel, openPrefs, applyAskMode, loadFiles, loadDemo, ai,
    get graph() { return state.graph; },
    query, vault, physics, render
  };
  console.log('[Race-AiNote] ready');
})();
