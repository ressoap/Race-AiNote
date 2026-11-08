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
      text: '#25293a',
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
      text: '#e9edf7',
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

    const alphaOf = opts.alphaOf || (() => 1);
    const linkAlphaOf = opts.linkAlphaOf || (() => 1);
    const emphasisOf = opts.emphasisOf || (() => 0);

    // ── 连线 ────────────────────────────────────────────────
    for (const link of opts.links) {
      const a = index.get(link.source);
      const b = index.get(link.target);
      if (!a || !b) continue;
      const la = linkAlphaOf(link);
      if (la <= 0.02) continue;
      const strong = hasHighlight && la > 0.85;
      ctx.globalAlpha = la;
      ctx.strokeStyle = strong ? colors.linkHi : colors.link;
      ctx.lineWidth = (0.35 + la * 0.65) * linkWidth;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
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
      const na = alphaOf(node);
      if (na <= 0.02) continue;
      const emphasis = emphasisOf(node);
      const r = radiusOf(node) * (1 + 0.22 * emphasis);
      const color = opts.colorOf
        ? opts.colorOf(node)
        : nodeColor(node, null, colors);

      ctx.globalAlpha = na;
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
    const fadeAt = settings.textFade == null ? 5 : settings.textFade;
    const fadeThreshold = 0.28 + fadeAt / 100;
    const drawnLabels = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const node of ordered) {
      const emphasis = node.id === opts.hoveredId || node.id === opts.selectedId;
      let alpha = emphasis ? 1 : Math.max(0, Math.min(1, (scale - fadeThreshold) / 0.22));
      if (node.type === 'tag') alpha = Math.max(alpha, emphasis ? 1 : 0);
      if (alpha <= 0.02) continue;
      alpha *= alphaOf(node);
      const fontSize = Math.max(10, Math.min(15, 12 / Math.max(0.75, scale * 0.85)));
      ctx.globalAlpha = alpha;
      ctx.font = '500 ' + fontSize + 'px ui-sans-serif, system-ui, "Segoe UI", sans-serif';
      ctx.fillStyle = emphasis ? colors.text : colors.text;
      const label = node.title.length > 16 ? node.title.slice(0, 15) + '…' : node.title;
      // 标签避让：与已绘制标签重叠则跳过，避免文字糊成一团
      const textWidth = ctx.measureText(label).width / scale;
      const box = {
        x1: node.x - textWidth / 2 - 2,
        x2: node.x + textWidth / 2 + 2,
        y1: node.y + radiusOf(node) + 3,
        y2: node.y + radiusOf(node) + 4 + fontSize / scale
      };
      const clash = !emphasis && drawnLabels.some(b =>
        box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1);
      if (!clash) {
        drawnLabels.push(box);
        ctx.fillText(label, node.x, node.y + radiusOf(node) + 4);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  return { draw, palette, nodeColor, screenToWorld, worldToScreen, THEMES };
});
