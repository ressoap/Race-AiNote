const test = require('node:test');
const assert = require('node:assert');
const physics = require('../js/physics.js');

function makeNodes(list) {
  return list.map(id => ({ id }));
}

test('初始位置由 id 哈希决定，可复现且不使用随机数', () => {
  const a = makeNodes(['a', 'b', 'c']);
  const b = makeNodes(['a', 'b', 'c']);
  physics.seedPositions(a, 1);
  physics.seedPositions(b, 1);
  assert.deepEqual(a.map(n => [n.x, n.y]), b.map(n => [n.x, n.y]));
  for (const n of a) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  }
});

test('模拟推进后处于加速衰减，最终自动暂停', () => {
  const nodes = makeNodes(['a', 'b']);
  const sim = physics.createSimulation({ nodes, links: [{ source: 'a', target: 'b' }], settings: { alphaDecay: 0.9 } });
  const first = sim.alpha;
  sim.tick();
  assert.ok(sim.alpha < first);
  for (let i = 0; i < 500 && !sim.paused; i++) sim.tick();
  assert.equal(sim.paused, true);
  assert.ok(sim.alpha < 0.01);
});

test('重合节点会被碰撞分离推开', () => {
  const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 0 }];
  const sim = physics.createSimulation({ nodes, links: [], settings: { alphaDecay: 0.995, repel: 0 } });
  for (let i = 0; i < 60; i++) sim.tick();
  const dist = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);
  assert.ok(dist > 5, '重合节点应被推开，实际距离 ' + dist.toFixed(2));
  assert.ok(Number.isFinite(nodes[0].x) && Number.isFinite(nodes[0].y), '不得出现 NaN');
});

test('有连线的节点距离趋向 linkDistance 附近', () => {
  const nodes = makeNodes(['a', 'b']);
  const sim = physics.createSimulation({
    nodes,
    links: [{ source: 'a', target: 'b' }],
    settings: { linkDistance: 120, repel: 0, alphaDecay: 0.985 }
  });
  for (let i = 0; i < 1200 && !sim.paused; i++) sim.tick();
  const dist = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);
  assert.ok(Math.abs(dist - 120) < 40, '连线长度应接近目标距离，实际 ' + dist.toFixed(1));
});

test('reheat 提升 alpha 并解除暂停', () => {
  const nodes = makeNodes(['a']);
  const sim = physics.createSimulation({ nodes, links: [] });
  for (let i = 0; i < 800 && !sim.paused; i++) sim.tick();
  assert.equal(sim.paused, true);
  sim.reheat(0.6);
  assert.equal(sim.paused, false);
  assert.ok(sim.alpha >= 0.6);
  assert.equal(sim.tick(), true);
});

test('固定节点不移动（拖拽时冻结该节点）', () => {
  const nodes = [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 200, y: 200 }];
  const sim = physics.createSimulation({ nodes, links: [], settings: { alphaDecay: 0.999 } });
  sim.fixedId = 'a';
  for (let i = 0; i < 30; i++) sim.tick();
  assert.equal(nodes[0].x, 10);
  assert.equal(nodes[0].y, 10);
});

test('位置被限制在边界内', () => {
  const nodes = [{ id: 'a', x: 99999, y: -99999 }];
  const sim = physics.createSimulation({ nodes, links: [], settings: { bounds: 500, center: 0, alphaDecay: 0.999 } });
  for (let i = 0; i < 20; i++) sim.tick();
  assert.ok(Math.abs(nodes[0].x) <= 500);
  assert.ok(Math.abs(nodes[0].y) <= 500);
});

test('空数据不报错', () => {
  const sim = physics.createSimulation({ nodes: [], links: [] });
  assert.doesNotThrow(() => sim.tick());
});

test('网格索引覆盖所有节点', () => {
  const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 5, y: 5 }, { id: 'c', x: 500, y: 500 }];
  const { grid } = physics.buildGrid(nodes, 50);
  let count = 0;
  for (const cell of grid.values()) count += cell.length;
  assert.equal(count, 3);
});
