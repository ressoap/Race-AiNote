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

