/* ============================================================
   plugins.js — 插件宿主
   插件 = 一段 JS 代码 + 元信息，安装后存在本机 localStorage，
   启动时按启用状态加载。插件只能通过受控 API 与主程序交互。

   ⚠ 安全提示：插件代码在你的浏览器里运行，权限等同本页面，
   只安装你信任的插件。安装前会二次确认。
   ============================================================ */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'race-ainote:plugins';
  const API_VERSION = 1;

  function loadAll() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function saveAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (_) {}
  }

  function normalizeId(input) {
    return String(input || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40);
  }

  function createHost(options) {
    const opts = options || {};
    const events = new Map();      // eventName -> [ {pluginId, cb} ]
    const commands = new Map();    // id -> { id, title, run, pluginId }
    const toolbarButtons = [];     // { id, label, title, onClick, pluginId }
    const footerWidgets = [];      // { id, render, pluginId }
    const loaded = new Map();      // pluginId -> { api, meta }

    function emit(name, payload) {
      const list = events.get(name) || [];
      for (const entry of list) {
        try {
          entry.cb(payload);
        } catch (err) {
          report(entry.pluginId, '事件 ' + name + ' 出错：' + (err && err.message ? err.message : err));
        }
      }
    }

    function report(pluginId, message) {
      if (opts.onError) opts.onError(pluginId, message);
      else console.warn('[plugin:' + pluginId + '] ' + message);
    }

    function makeApi(record) {
      const pid = record.id;
      return {
        apiVersion: API_VERSION,
        meta: { id: pid, name: record.name, version: record.version },
        log: (...args) => console.log('[plugin:' + pid + ']', ...args),
        toast: message => { if (opts.onToast) opts.onToast(String(message)); },
        on(eventName, cb) {
          if (typeof cb !== 'function') return;
          if (!events.has(eventName)) events.set(eventName, []);
          events.get(eventName).push({ pluginId: pid, cb: cb });
        },
        registerCommand(cmd) {
          if (!cmd || !cmd.id || typeof cmd.run !== 'function') return report(pid, '命令缺少 id 或 run');
          commands.set(pid + ':' + cmd.id, {
            id: pid + ':' + cmd.id,
            title: cmd.title || cmd.id,
            run: cmd.run,
            pluginId: pid
          });
          if (opts.onRegistryChange) opts.onRegistryChange();
        },
        addToolbarButton(btn) {
          if (!btn || typeof btn.onClick !== 'function') return report(pid, '按钮缺少 onClick');
          toolbarButtons.push({
            id: pid + ':' + (btn.id || Math.random().toString(36).slice(2)),
            label: btn.label || '插件',
            title: btn.title || '',
            onClick: btn.onClick,
            pluginId: pid
          });
          if (opts.onRegistryChange) opts.onRegistryChange();
        },
        addNoteFooterWidget(widget) {
          if (!widget || typeof widget.render !== 'function') return report(pid, '小组件缺少 render');
          footerWidgets.push({
            id: pid + ':' + (widget.id || Math.random().toString(36).slice(2)),
            render: widget.render,
            pluginId: pid
          });
          if (opts.onRegistryChange) opts.onRegistryChange();
        },
        notes: {
          list: () => (opts.getNotes ? opts.getNotes() : []),
          current: () => (opts.getCurrentNote ? opts.getCurrentNote() : null),
          open: id => { if (opts.openNote) opts.openNote(id); }
        },
        ai: {
          ask: text => { if (opts.askAi) opts.askAi(String(text || '')); }
        },
        storage: {
          get(key) {
            try {
              const raw = JSON.parse(localStorage.getItem('race-ainote:plugin:' + pid) || '{}');
              return raw[key];
            } catch (_) { return undefined; }
          },
          set(key, value) {
            try {
              const raw = JSON.parse(localStorage.getItem('race-ainote:plugin:' + pid) || '{}');
              raw[key] = value;
              localStorage.setItem('race-ainote:plugin:' + pid, JSON.stringify(raw));
            } catch (_) {}
          }
        }
      };
    }

    /** 执行插件代码 */
    function run(record) {
      const api = makeApi(record);
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('api', '"use strict";\n' + record.code + '\n//# sourceURL=plugin:' + record.id);
        fn(api);
        loaded.set(record.id, { api: api, meta: record });
        return { ok: true };
      } catch (err) {
        report(record.id, '加载失败：' + (err && err.message ? err.message : err));
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    }

    function unload(pluginId) {
      for (const map of [events]) {
        for (const [name, list] of map) {
          map.set(name, list.filter(entry => entry.pluginId !== pluginId));
        }
      }
      for (const id of [...commands.keys()]) {
        if (id.startsWith(pluginId + ':')) commands.delete(id);
      }
      for (let i = toolbarButtons.length - 1; i >= 0; i--) {
        if (toolbarButtons[i].pluginId === pluginId) toolbarButtons.splice(i, 1);
      }
      for (let i = footerWidgets.length - 1; i >= 0; i--) {
        if (footerWidgets[i].pluginId === pluginId) footerWidgets.splice(i, 1);
      }
      loaded.delete(pluginId);
      if (opts.onRegistryChange) opts.onRegistryChange();
    }

    const host = {
      apiVersion: API_VERSION,
      list: loadAll,
      loadedIds: () => [...loaded.keys()],
      commands: () => [...commands.values()],
      toolbarButtons: () => toolbarButtons.slice(),
      footerWidgets: () => footerWidgets.slice(),
      emit: emit,

      /** 安装（或覆盖）一个插件并立即启用 */
      install(input) {
        const id = normalizeId(input.id || input.name);
        if (!id) throw new Error('插件需要 id 或 name');
        if (!input.code || !String(input.code).trim()) throw new Error('插件代码不能为空');
        const list = loadAll();
        const record = {
          id: id,
          name: input.name || id,
          version: input.version || '1.0.0',
          description: input.description || '',
          author: input.author || '',
          code: String(input.code),
          enabled: true,
          installedAt: Date.now()
        };
        const idx = list.findIndex(p => p.id === id);
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], record);
        else list.push(record);
        saveAll(list);
        unload(id);
        const result = run(record);
        if (!result.ok) {
          // 加载失败就保持禁用，避免每次启动都报错
          const after = loadAll();
          const item = after.find(p => p.id === id);
          if (item) { item.enabled = false; saveAll(after); }
          throw new Error('插件加载失败：' + result.error);
        }
        return record;
      },

      uninstall(id) {
        unload(id);
        saveAll(loadAll().filter(p => p.id !== id));
        if (opts.onRegistryChange) opts.onRegistryChange();
      },

      setEnabled(id, enabled) {
        const list = loadAll();
        const record = list.find(p => p.id === id);
        if (!record) return false;
        record.enabled = Boolean(enabled);
        saveAll(list);
        if (record.enabled) {
          const result = run(record);
          if (!result.ok) { record.enabled = false; saveAll(list); return false; }
        } else {
          unload(id);
        }
        if (opts.onRegistryChange) opts.onRegistryChange();
        return true;
      },

      /** 启动时加载所有已启用插件 */
      boot() {
        const results = [];
        for (const record of loadAll()) {
          if (!record.enabled) continue;
          results.push({ id: record.id, result: run(record) });
        }
        if (opts.onRegistryChange) opts.onRegistryChange();
        return results;
      },

      /** 从 URL 拉取插件代码（插件作者可以把 .js 放任意静态地址） */
      async fetchCode(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.text();
      }
    };

    return host;
  }

  root.RG = root.RG || {};
  root.RG.plugins = { createHost, API_VERSION, STORAGE_KEY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
