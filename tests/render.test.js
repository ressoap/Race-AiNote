const test = require('node:test');
const assert = require('node:assert');
const render = require('../js/render.js');

/** 极简 Canvas 2D 替身：记录 fillStyle / strokeStyle 的赋值 */
function fakeCtx() {
  const seen = { fills: [], strokes: [], alphas: [] };
  const state = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1, font: '', textAlign: '', textBaseline: '' };
  const api = new Proxy(state, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 20 });
      if (k === 'fill') return () => seen.fills.push(t.fillStyle);
      if (k === 'stroke') return () => seen.strokes.push(t.strokeStyle);
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      if (k === 'fillStyle' && (v === null || v === undefined)) seen.fills.push('NULL_FILL');
      if (k === 'strokeStyle' && (v === null || v === undefined)) seen.strokes.push('NULL_STROKE');
      if (k === 'globalAlpha') seen.alphas.push(v);
      t[k] = v;
      return true;
    }
  });
  api.seen = seen;
  return api;
}

const baseNodes = [
  { id: 'a', x: 0, y: 0, title: '笔记A', type: 'note', degree: 2 },
  { id: 't', x: 60, y: 0, title: '#标签', type: 'tag', degree: 1 },
  { id: 'p', x: -60, y: 0, title: '图.png', type: 'attachment', degree: 1 }
];

function drawWith(opts) {
  const ctx = fakeCtx();
  const nodes = opts.nodes || baseNodes;
  render.draw(ctx, Object.assign({
    width: 400, height: 300, dpr: 1,
    view: { x: 0, y: 0, scale: 1 },
    nodes,
    links: [{ source: 'a', target: 't' }],
    index: new Map(nodes.map(n => [n.id, n])),
    theme: 'light',
    settings: {},
    radiusOf: () => 7
  }, opts));
  return ctx.seen;
}

test('颜色分组返回 null 时回落到类型默认色，不产生空 fillStyle', () => {
  const seen = drawWith({ colorOf: () => null });
  assert.ok(!seen.fills.includes('NULL_FILL'), 'fillStyle 不能被赋成 null');
  assert.ok(seen.fills.includes('#4f5b7d'), '普通笔记应使用默认节点色');
  assert.ok(seen.fills.includes('#7c6cf0'), '标签节点应使用标签色');
  assert.ok(seen.fills.includes('#6f7b90'), '附件节点应使用附件色');
});

test('分组命中时使用分组色', () => {
  const seen = drawWith({ colorOf: n => (n.type === 'note' ? '#3f9c6d' : null) });
  assert.ok(seen.fills.includes('#3f9c6d'));
  assert.ok(seen.fills.includes('#7c6cf0'));
});

test('深色主题下节点色与背景不同', () => {
  const seen = drawWith({ theme: 'dark' });
  assert.ok(seen.fills.includes('#b3bddd'), '深色主题应有独立的节点色');
});

test('alphaOf 返回 0 的节点被跳过绘制', () => {
  const full = drawWith({ alphaOf: () => 1 });
  const faded = drawWith({ alphaOf: n => (n.id === 'a' ? 0 : 1) });
  assert.equal(faded.fills.length, full.fills.length - 1, '完全透明的节点不应绘制');
});
