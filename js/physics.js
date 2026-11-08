/* ============================================================
   physics.js — 自定义力导向模拟（无第三方依赖，确定性可复现）
   力：节点排斥 / 连线弹簧 / 中心引力 / 碰撞分离
   碰撞用均匀网格降低复杂度；初始位置由路径哈希决定，不用随机数。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RG = root.RG || {};
  root.RG.physics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = {
    repel: 850,        // 排斥强度
    center: 0.00004,   // 中心引力
    linkStrength: 0.02,
    linkDistance: 110,
    damping: 0.82,
    collisionPadding: 14,
    nodeSize: 1,
    alphaDecay: 0.986,
    alphaMin: 0.004,
    bounds: 2600
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** FNV-1a：同一路径永远得到同一初始位置，保证「重新布局」可复现 */
  function hash01(text) {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function radiusOf(node, nodeSize) {
    const degree = node.degree || 0;
    return (6.1 + Math.min(degree, 16) * 0.34) * (nodeSize == null ? 1 : nodeSize);
  }

  /** 环形 + 哈希抖动：同层节点分散，且不使用 Math.random */
  function seedPositions(nodes, nodeSize) {
    const total = Math.max(nodes.length, 1);
    nodes.forEach((n, i) => {
      if (typeof n.x === 'number' && typeof n.y === 'number') return;
      const angle = (i / total) * Math.PI * 2 + hash01(n.id) * 0.9;
      const radius = 40 + Math.sqrt(i + 1) * (18 + total * 1.6) * (0.7 + hash01(n.id + ':r') * 0.6);
      n.x = Math.cos(angle) * radius;
      n.y = Math.sin(angle) * radius;
      n.vx = 0;
      n.vy = 0;
    });
  }

  /** 均匀网格：只与相邻格子内的节点做碰撞检测 */
  function buildGrid(nodes, cellSize) {
    const grid = new Map();
    for (const n of nodes) {
      const cx = Math.floor(n.x / cellSize);
      const cy = Math.floor(n.y / cellSize);
      const key = cx + ',' + cy;
      let cell = grid.get(key);
      if (!cell) { cell = []; grid.set(key, cell); }
      cell.push(n);
    }
    return { grid, cellSize };
  }

  function createSimulation(options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const nodes = opts.nodes || [];
    const links = (opts.links || []).map(l => ({ source: l.source, target: l.target, kind: l.kind }));
    const index = new Map(nodes.map(n => [n.id, n]));
    const settings = Object.assign({}, opts.settings || {});

    const sim = {
      nodes,
      links,
      index,
      settings,
      alpha: 1,
      paused: false,
      ticks: 0,
      fixedId: null,
      config: opts,

      setSettings(patch) {
        if (!patch) return;
        Object.assign(settings, patch);
        if (patch.nodeSize != null) opts.nodeSize = patch.nodeSize;
      },

      reheat(amount) {
        sim.alpha = Math.max(sim.alpha, amount == null ? 0.6 : amount);
        sim.paused = false;
      }
    };

    function cfg(key) {
      const v = settings[key];
      return v == null ? opts[key] : v;
    }

    sim.tick = function tick() {
      if (sim.paused || nodes.length === 0) return false;
      const alpha = sim.alpha;
      if (alpha < cfg('alphaMin')) {
        sim.paused = true;
        return false;
      }

      const repel = cfg('repel');
      const center = cfg('center');
      const linkStrength = cfg('linkStrength') || 0;
      const linkDistance = cfg('linkDistance');
      const damping = cfg('damping');
      const padding = cfg('collisionPadding');
      const nodeSize = cfg('nodeSize');
      const bounds = cfg('bounds');

      // 1) 两两排斥（带软化项，避免近距离爆炸）
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = hash01(a.id + b.id) - 0.5;
            dy = hash01(b.id + a.id) - 0.5;
            d2 = dx * dx + dy * dy + 0.01;
          }
          const d = Math.sqrt(d2);
          const f = (repel * alpha) / (d2 + 240);
          const ux = dx / d;
          const uy = dy / d;
          a.vx += ux * f; a.vy += uy * f;
          b.vx -= ux * f; b.vy -= uy * f;
        }
      }

      // 2) 连线弹簧
      for (const link of links) {
        const a = index.get(link.source);
        const b = index.get(link.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - linkDistance) * linkStrength * alpha;
        const ux = dx / d;
        const uy = dy / d;
        a.vx += ux * f; a.vy += uy * f;
        b.vx -= ux * f; b.vy -= uy * f;
      }

      // 3) 中心引力
      for (const n of nodes) {
        n.vx -= n.x * center * alpha;
        n.vy -= n.y * center * alpha;
      }

      // 4) 碰撞分离（网格加速）
      const cellSize = Math.max(24, 2 * radiusOf({ degree: 16 }, nodeSize) + padding);
      const { grid } = buildGrid(nodes, cellSize);
      for (const cell of grid.values()) {
        for (let i = 0; i < cell.length; i++) {
          const a = cell[i];
          for (let j = i + 1; j < cell.length; j++) {
            const b = cell[j];
            separate(a, b, alpha, padding, nodeSize);
          }
        }
      }

      // 5) 积分
      for (const n of nodes) {
        if (sim.fixedId && sim.fixedId === n.id) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= damping;
        n.vy *= damping;
        n.x = clamp(n.x + n.vx, -bounds, bounds);
        n.y = clamp(n.y + n.vy, -bounds, bounds);
        if (!isFinite(n.x) || !isFinite(n.y)) { n.x = 0; n.y = 0; n.vx = 0; n.vy = 0; }
      }

      sim.alpha *= cfg('alphaDecay');
      sim.ticks += 1;
      if (sim.alpha < cfg('alphaMin')) sim.paused = true;
      return true;
    };

    function separate(a, b, alpha, padding, nodeSize) {
      const min = radiusOf(a, nodeSize) + radiusOf(b, nodeSize) + padding;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d >= min) return;
      if (d < 0.0001) {
        // 完全重合：用 id 哈希给出确定性分离方向，避免 NaN 与随机抖动
        const ang = hash01(a.id + "|" + b.id) * Math.PI * 2;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      }
      const overlap = (min - d) * 0.5 * (0.35 + alpha * 0.65);
      const ux = (dx / d) * overlap;
      const uy = (dy / d) * overlap;
      const fixedA = sim.fixedId === a.id;
      const fixedB = sim.fixedId === b.id;
      if (fixedA && fixedB) return;
      if (fixedA) { b.x += ux * 2; b.y += uy * 2; return; }
      if (fixedB) { a.x -= ux * 2; a.y -= uy * 2; return; }
      a.x -= ux; a.y -= uy;
      b.x += ux; b.y += uy;
    }

    Object.assign(sim, {
      cfg,
      radiusOf: n => radiusOf(n, cfg('nodeSize')),
      reheat(amount) {
        sim.alpha = Math.max(sim.alpha, amount == null ? 0.6 : amount);
        sim.paused = false;
      }
    });

    seedPositions(nodes, cfg('nodeSize'));
    sim.alpha = opts.alpha == null ? 1 : opts.alpha;
    sim.paused = false;
    return sim;
  }

  return { createSimulation, seedPositions, hash01, radiusOf, buildGrid, DEFAULTS };
});
