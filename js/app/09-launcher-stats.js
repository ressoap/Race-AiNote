  /* ── 进入页右侧：错题分布看板（扇形图 + 知识点比例） ───────
     数据来自问题记录（store 的 records 键），与右侧 AI 面板同源；
     学科占比画成环形扇形图，知识点按「首知识点」统计并给出百分比条。 */

  const STATS_PALETTE = ['#4a6ef5', '#e2725b', '#3f9c6d', '#ef9f27', '#9a6ef5', '#2fa5b8', '#d9534f', '#7a9eff'];

  /** 只看当前笔记库自己的记录，别的库的错题不混进来 */
  function launcherRecordList() {
    try {
      const list = store.getJSON('records', []);
      if (!Array.isArray(list)) return [];
      const id = state.vaultId ? String(state.vaultId) : 'demo';
      return list.filter(r => r && typeof r === 'object' && r.vaultId === id);
    } catch (_) {
      return [];
    }
  }

  /** 分析范围：'' 表示整库总分析，否则只统计这一篇错题本笔记 */
  let statsScopePath = '';

  function statsScopeLabel(record) {
    const title = String((record && record.targetTitle) || '').trim();
    if (title) return title;
    const full = String((record && record.targetPath) || '').trim();
    if (!full) return '未归档错题';
    const name = full.split('/').pop() || full;
    return name.replace(/.md$/i, '');
  }

  /** 按 targetPath 归组，给下拉框列出「可以单独分析的那几篇笔记」 */
  function statsScopeOptions(records) {
    const map = new Map();
    for (const rec of records) {
      const path = String((rec && rec.targetPath) || '').trim();
      if (!path) continue;
      if (!map.has(path)) map.set(path, { path: path, label: statsScopeLabel(rec), count: 0 });
      map.get(path).count += 1;
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  }

  function renderStatsScopeSelect(records, totalRecords) {
    const select = $('#stats-scope-select');
    if (!select) return;
    const options = statsScopeOptions(records);
    if (statsScopePath && !options.some(o => o.path === statsScopePath)) statsScopePath = '';
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = '全部错题（总分析） · ' + totalRecords + ' 道';
    select.appendChild(all);
    for (const item of options) {
      const opt = document.createElement('option');
      opt.value = item.path;
      opt.textContent = item.label + ' · ' + item.count + ' 道';
      select.appendChild(opt);
    }
    select.value = statsScopePath;
    select.disabled = options.length === 0;
  }

  function initStatsScope() {
    const select = $('#stats-scope-select');
    if (!select || select.dataset.bound === '1') return;
    select.dataset.bound = '1';
    select.addEventListener('change', () => {
      statsScopePath = select.value || '';
      renderLauncherStats();
    });
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

    if (scopeEl) {
      scopeEl.textContent = statsScopePath
        ? (statsScopeLabel({ targetPath: statsScopePath, targetTitle: '' }) + ' · ' + (state.vaultLabel || '当前笔记库'))
        : (state.vaultLabel || '当前笔记库');
    }
    pie.innerHTML = '';
    if (legend) legend.innerHTML = '';
    if (pointsEl) pointsEl.innerHTML = '';

    const allRecords = launcherRecordList();
    const filterEl = $('#stats-scope-select');
    if (filterEl && filterEl.parentElement) filterEl.parentElement.hidden = false;
    initStatsScope();
    renderStatsScopeSelect(allRecords, allRecords.length);
    const records = statsScopePath
      ? allRecords.filter(r => String((r && r.targetPath) || '') === statsScopePath)
      : allRecords;
    if (!allRecords.length) {
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
