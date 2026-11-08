/* ============================================================
   render.js — Canvas 2D 渲染层（只负责画，不改数据）
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RG = root.RG || {};
  root.RG.render = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = {
    light: {
      bg: '#fbfbfd',
      link: 'rgba(120,124,140,0.34)',
      linkHi: 'rgba(74,110,245,0.85)',
      linkDim: 'rgba(150,154,170,0.10)',
      node: '#8a90a6',
      nodeStroke: '#ffffff',
      text: 'rgba(46,50,64,0.92)',
      textDim: 'rgba(46,50,64,0.20)',
      ring: 'rgba(74,110,245,0.9)',
      tag: '#8b7cf6',
      attachment: '#9aa3b2',
      unresolved: '#e2725b'
    },
    dark: {
      bg: '#17181c',
      link: 'rgba(190,196,214,0.22)',
      linkHi: 'rgba(122,158,255,0.95)',
      linkDim: 'rgba(190,196,214,0.06)',
      node: '#9aa2b8',
      nodeStroke: '#1f2126',
      text: 'rgba(232,236,246,0.92)',
      textDim: 'rgba(232,236,246,0.18)',
      ring: 'rgba(122,158,255,0.95)',
      tag: '#a898ff',
      attachment: '#7b8494',
      unresolved: '#ef8a72'
    }
  };

  function palette(theme) { return THEMES[theme] || THEMES.light; }

  function screenToWorld(view, x, y) {
    return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale };
  }

  function worldToScreen(view, x, y) {
    return { x: x * view.scale + view.x, y: y * view.scale + view.y };
  }

  /** 节点颜色优先级：颜色分组 > 类型默认色 */
  function nodeColor(node, groupColor, colors) {
    if (groupColor) return groupColor;
    if (node.type === 'tag') return colors.tag;
    if (node.type === 'attachment') return colors.attachment;
    if (node.type === 'unresolved') return colors.unresolved;
    return colors.node;
  }

  function drawArrow(ctx, from, to, radius, color, width) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d < radius + 6) return;
    const ux = dx / d;
    const uy = dy / d;
    const tipX = to.x - ux * (radius + 3);
    const tipY = to.y - uy * (radius + 3);
    const size = 4 + width * 1.6;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
    ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * 主绘制入口
   * @param {CanvasRenderingContext2D} ctx
   * @param {{
   *   width:number, height:number, dpr:number,
   *   view:{x:number,y:number,scale:number},
   *   nodes:Array, links:Array, index:Map,
   *   theme:string, settings:Object,
   *   hoveredId?:string|null, selectedId?:string|null,
   *   highlight?:Set<string>|null, colorOf?:function
   * }} opts
   */
  function draw(ctx, opts) {
    const colors = palette(opts.theme);
    const view = opts.view;
    const settings = opts.settings || {};
    const scale = view.scale;
    const highlight = opts.highlight;
    const hasHighlight = highlight && highlight.size > 0;
    const radiusOf = opts.radiusOf || (n => 8);

    ctx.save();
    ctx.setTransform(opts.dpr || 1, 0, 0, opts.dpr || 1, 0, 0);
    ctx.clearRect(0, 0, opts.width, opts.height);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, opts.width, opts.height);
    ctx.translate(view.x, view.y);
    ctx.scale(scale, scale);

    const index = opts.index;
    const linkWidth = (settings.linkWidth == null ? 1 : settings.linkWidth);

    // ── 连线 ────────────────────────────────────────────────
    for (const link of opts.links) {
      const a = index.get(link.source);
      const b = index.get(link.target);
      if (!a || !b) continue;
      const active = !hasHighlight ||
        (highlight.has(a.id) && highlight.has(b.id));
      ctx.strokeStyle = active
        ? (hasHighlight ? colors.linkHi : colors.link)
        : colors.linkDim;
      ctx.lineWidth = (active ? 1 : 0.7) * linkWidth;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // ── 箭头（画在节点之前，避免压住节点） ───────────────────
    if (settings.arrows) {
      for (const link of opts.links) {
        const a = index.get(link.source);
        const b = index.get(link.target);
        if (!a || !b) continue;
        const active = !hasHighlight || (highlight.has(a.id) && highlight.has(b.id));
        if (!active) continue;
        drawArrow(ctx, a, b, radiusOf(b), hasHighlight ? colors.linkHi : colors.link, linkWidth);
      }
    }

    // ── 节点 ────────────────────────────────────────────────
    const ordered = opts.nodes.slice().sort((p, q) => {
      const ap = (p.id === opts.selectedId) || (p.id === opts.hoveredId);
      const aq = (q.id === opts.selectedId) || (q.id === opts.hoveredId);
      return (ap ? 1 : 0) - (aq ? 1 : 0);
    });

    for (const node of ordered) {
      const r = radiusOf(node) * Math.max(0.55, Math.min(1.6, scale));
      const active = !hasHighlight || highlight.has(node.id);
      const color = opts.colorOf
        ? opts.colorOf(node)
        : nodeColor(node, null, colors);

      ctx.globalAlpha = active ? 1 : 0.22;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (node.type === 'unresolved') {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = colors.unresolved;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (node.type === 'attachment') {
        ctx.strokeStyle = colors.nodeStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (node.id === opts.selectedId) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = colors.ring;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (node.id === opts.hoveredId) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = colors.ring;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ── 标签（按屏幕半径阈值淡入淡出） ───────────────────────
    const fadeAt = settings.textFade == null ? 35 : settings.textFade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const node of ordered) {
      const screenR = radiusOf(node) * scale;
      const emphasis = node.id === opts.hoveredId || node.id === opts.selectedId;
      let alpha = emphasis ? 1 : Math.max(0, Math.min(1, (screenR - fadeAt) / 26));
      if (node.type === 'tag') alpha = Math.max(alpha, emphasis ? 1 : 0);
      if (alpha <= 0.02) continue;
      const active = !hasHighlight || highlight.has(node.id);
      if (!active) alpha *= 0.25;
      const fontSize = Math.max(9, Math.min(15, 11.5 / Math.max(0.8, scale * 0.9)));
      ctx.globalAlpha = alpha;
      ctx.font = fontSize + 'px ui-sans-serif, system-ui, "Segoe UI", sans-serif';
      ctx.fillStyle = emphasis ? colors.text : colors.text;
      const label = node.title.length > 16 ? node.title.slice(0, 15) + '…' : node.title;
      ctx.fillText(label, node.x, node.y + radiusOf(node) + 4);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  return { draw, palette, nodeColor, screenToWorld, worldToScreen, THEMES };
});
