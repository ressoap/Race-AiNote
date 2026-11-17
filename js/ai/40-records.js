
    /* ── 问题记录（右侧时间轴）与错题本去重 ─────────────────── */
    const RECORDS_KEY = 'records';
    const LEGACY_RECORDS_KEY = 'race-ainote:mistakes';

    function loadRecords() {
      try { return JSON.parse(storageGet(RECORDS_KEY, LEGACY_RECORDS_KEY) || '[]'); } catch (_) { return []; }
    }

    let pushTimer = 0;

    function saveRecords(list) {
      const trimmed = list.slice().sort((a, b) => (b.order || b.at || 0) - (a.order || a.at || 0)).slice(0, 300);
      try { storageSet(RECORDS_KEY, JSON.stringify(trimmed), LEGACY_RECORDS_KEY); } catch (_) {}
      pushToServer(trimmed);
    }

    /** 写一份到本地服务（serve.mjs），换端口 / 换浏览器也能读回 */
    function pushToServer(records) {
      if (location.protocol === 'file:' || typeof fetch !== 'function') return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        try {
        fetch('/api/store/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: records })
        }).catch(() => {});
        } catch (_) {}
      }, 400);
    }

    /** 启动时把服务端的记录合并进来（按 id 去重，保留更新的那条） */
    async function initRecords() {
      if (location.protocol === 'file:' || typeof fetch !== 'function') return loadRecords().length;
      try {
        const res = await fetch('/api/store/records', { cache: 'no-store' });
        if (!res.ok) return loadRecords().length;
        const data = await res.json();
        const remote = Array.isArray(data.records) ? data.records : [];
        const local = loadRecords();
        const byId = new Map();
        for (const rec of remote) byId.set(rec.id, rec);
        for (const rec of local) {
          const other = byId.get(rec.id);
          const newer = !other || (rec.resolvedAt || rec.at || 0) >= (other.resolvedAt || other.at || 0);
          if (newer) byId.set(rec.id, rec);
        }
        const merged = [...byId.values()].sort((x, y) => (y.order || y.at || 0) - (x.order || x.at || 0));
        try { storageSet(RECORDS_KEY, JSON.stringify(merged.slice(0, 300)), LEGACY_RECORDS_KEY); } catch (_) {}
        if (merged.length) pushToServer(merged);
        renderRecords();
        return merged.length;
      } catch (_) {
        return loadRecords().length;
      }
    }

    /** 归一化提问，用于判重：去掉空白与标点，取前 80 字 */
    function signatureOf(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[，。？！、；：,.?!;:"'`~()（）\[\]【】]/g, '')
        .slice(0, 80);
    }

    function findRecord(question) {
      const sig = signatureOf(question);
      if (!sig) return null;
      return loadRecords().find(function (r) { return r.sig === sig; }) || null;
    }

    /** 新增或更新记录（同一个问题只保留一条） */
    function upsertRecord(patch) {
      const sig = signatureOf(patch.question);
      const list = loadRecords();
      const idx = list.findIndex(function (r) { return r.sig === sig; });
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], patch, { sig: sig });
      } else {
        list.push(Object.assign({ id: 'mis-' + Date.now(), at: Date.now(), status: 'open' }, patch, { sig: sig, order: Date.now() }));
      }
      saveRecords(list);
      renderRecords();
      return idx >= 0;
    }

    function formatTime(ts) {
      const d = new Date(ts);
      const pad = function (n) { return String(n).padStart(2, '0'); };
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    /* ── 问题记录：搜索 / 日期分块 / 拖拽排序 / 右键 ───────── */
    const state2 = state;
    state2.recordSearch = '';
    state2.recordDate = '';

    function dateKey(ts) {
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function dateLabel(key) {
      const today = dateKey(Date.now());
      const yesterday = dateKey(Date.now() - 86400000);
      if (key === today) return '今天';
      if (key === yesterday) return '昨天';
      return key;
    }

    /** 日期下拉：列出所有有记录的日期，带数量，便于快速定位 */
    function renderDateOptions(all) {
      const select = document.getElementById('record-date-filter');
      if (!select) return;
      const counts = new Map();
      for (const rec of all) {
        const key = dateKey(rec.at);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      if (state2.recordDate && !counts.has(state2.recordDate)) state2.recordDate = '';
      select.innerHTML = '';
      const allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = '全部日期';
      select.appendChild(allOption);
      const keys = [...counts.keys()].sort((a, b) => b.localeCompare(a));
      for (const key of keys) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = dateLabel(key) + ' · ' + counts.get(key);
        select.appendChild(option);
      }
      select.value = state2.recordDate;
    }

    function filteredRecords() {
      const all = loadRecords().slice().sort((a, b) => (b.order || b.at || 0) - (a.order || a.at || 0));
      const byDate = state2.recordDate ? all.filter(r => dateKey(r.at) === state2.recordDate) : all;
      const kw = String(state2.recordSearch || '').trim().toLowerCase();
      if (!kw) return byDate;
      return byDate.filter(r =>
        String(r.question || '').toLowerCase().includes(kw) ||
        String(r.answer || '').toLowerCase().includes(kw) ||
        String(r.targetTitle || '').toLowerCase().includes(kw));
    }

    function renderRecords() {
      const listEl = document.getElementById('ai-record-list');
      const countEl = document.getElementById('ai-records-count');
      if (!listEl) return;

      const all = loadRecords();
      renderDateOptions(all);
      const list = filteredRecords();
      if (countEl) {
        const open = all.filter(r => r.status !== 'resolved').length;
        countEl.textContent = open ? open + '待解决' : String(all.length);
        countEl.classList.toggle('is-open', open > 0);
      }

      listEl.innerHTML = '';
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'ai-record-empty';
        empty.textContent = all.length ? '没有匹配的记录' : '答疑结束可记入错题本';
        listEl.appendChild(empty);
        return;
      }

      // 按日期分块
      const groups = new Map();
      for (const rec of list) {
        const key = dateKey(rec.at);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rec);
      }
      for (const [key, items] of groups) {
        const head = document.createElement('div');
        head.className = 'record-date';
        head.textContent = dateLabel(key) + ' · ' + items.length;
        listEl.appendChild(head);

        for (const rec of items) {
          const item = document.createElement('button');
          item.className = 'ai-record' + (rec.status === 'resolved' ? ' is-resolved' : '');
          item.draggable = true;
          item.dataset.recordId = rec.id;
          item.title = rec.question;

          const head2 = document.createElement('span');
          head2.className = 'ai-record-head';
          const time = document.createElement('span');
          time.className = 'ai-record-time';
          time.textContent = new Date(rec.at).toTimeString().slice(0, 5);
          const badge = document.createElement('span');
          badge.className = 'ai-record-badge' + (rec.status === 'resolved' ? ' is-resolved' : '');
          badge.textContent = rec.status === 'resolved' ? '已解决' : '待解决';
          head2.append(time, badge);

          const title = document.createElement('span');
          title.className = 'ai-record-title';
          title.textContent = String(rec.question || '');
          const target = document.createElement('span');
          target.className = 'ai-record-target';
          target.textContent = rec.targetTitle || (rec.status === 'resolved' ? '未记入错题本' : '未处理');
          if (rec.targetTitle || rec.targetPath) {
            target.classList.add('is-link');
            target.title = '定位到错题笔记：' + (rec.targetPath || rec.targetTitle);
            target.addEventListener('click', e => {
              e.stopPropagation();
              if (opts.onRecordLocate) opts.onRecordLocate(rec);
            });
          }

          item.append(head2, title, target);

          item.addEventListener('click', () => {
            if (opts.onRecordOpen) opts.onRecordOpen(rec);
          });
          item.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            if (opts.onRecordMenu) opts.onRecordMenu(e, rec);
          });
          item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', 'record:' + rec.id);
            item.classList.add('is-dragging');
          });
          item.addEventListener('dragend', () => item.classList.remove('is-dragging'));
          item.addEventListener('dragover', e => {
            e.preventDefault();
            item.classList.add('is-drop-target');
          });
          item.addEventListener('dragleave', () => item.classList.remove('is-drop-target'));
          item.addEventListener('drop', e => {
            e.preventDefault();
            item.classList.remove('is-drop-target');
            const payload = e.dataTransfer.getData('text/plain') || '';
            if (!payload.startsWith('record:')) return;
            const fromId = payload.slice(7);
            if (!fromId || fromId === rec.id) return;
            reorderRecords(fromId, rec.id);
          });

          listEl.appendChild(item);
        }
      }
      listEl.scrollTop = 0;
    }

    /** 把 fromId 移动到 targetId 的位置（按当前显示顺序重排 order） */
    function reorderRecords(fromId, targetId) {
      const list = loadRecords().slice().sort((a, b) => (b.order || b.at || 0) - (a.order || a.at || 0));
      const fromIdx = list.findIndex(r => r.id === fromId);
      const toIdx = list.findIndex(r => r.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      const stamp = Date.now();
      list.forEach((r, i) => { r.order = stamp - i; });
      saveRecords(list);
      renderRecords();
    }

    function updateRecord(id, patch) {
      const list = loadRecords();
      const idx = list.findIndex(r => r.id === id);
      if (idx < 0) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      saveRecords(list);
      renderRecords();
      return list[idx];
    }

    function deleteRecord(id) {
      const list = loadRecords().filter(r => r.id !== id);
      saveRecords(list);
      renderRecords();
    }

    function setRecordSearch(keyword) {
      state2.recordSearch = String(keyword || '');
      renderRecords();
    }

    function setRecordDate(key) {
      state2.recordDate = String(key || '');
      renderRecords();
    }

    /** 错题本目录迁移后，同步记录里的 targetPath */
    function remapRecordPaths(pathMap) {
      if (!pathMap || typeof pathMap.forEach !== 'function') return 0;
      const list = loadRecords();
      let changed = 0;
      for (const rec of list) {
        if (rec.targetPath && pathMap.has(rec.targetPath)) {
          rec.targetPath = pathMap.get(rec.targetPath);
          changed += 1;
        }
      }
      if (changed) {
        saveRecords(list);
        renderRecords();
      }
      return changed;
    }
