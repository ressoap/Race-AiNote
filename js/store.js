/* ============================================================
   store.js — 本地存储统一入口
   · 所有键名集中在 KEYS，避免 6 个模块各写一份字符串；
   · 带 schema 版本号，旧键在启动时迁移到新键；
   · localStorage 不可用时静默降级，不阻塞应用。
   ============================================================ */
(function (root) {
  'use strict';

  const RG = root.RG = root.RG || {};
  const VERSION = 2;
  // 前缀保留旧名 race-ainote，避免已存笔记/设置/凭据失联
  const PREFIX = 'race-ainote:';

  const KEYS = {
    schema: PREFIX + 'schema',
    settings: PREFIX + 'settings',
    theme: PREFIX + 'settings:theme',
    usage: PREFIX + 'usage',
    order: PREFIX + 'order',
    sort: PREFIX + 'sort',
    vault: PREFIX + 'vault',
    aiConfig: PREFIX + 'ai-config',
    cloudConfig: PREFIX + 'cloud',
    records: PREFIX + 'records',
    plugins: PREFIX + 'plugins',
    pluginData: PREFIX + 'plugin-data:',
    aiInputHeight: PREFIX + 'ai-input-height',
    aiPanelWidth: PREFIX + 'ai-panel-width',
    sidebarWidth: PREFIX + 'sidebar-width',
    noteTabs: PREFIX + 'note-tabs',
    favorites: PREFIX + 'favorites'
  };

  /* v1 时代的旧键名；迁移后删除，避免凭据和笔记各存两份 */
  const LEGACY = {
    settings: 'race-ainote:v1',
    theme: 'race-ainote:v1:theme',
    usage: 'race-ainote:usage',
    order: 'race-ainote:order',
    sort: 'race-ainote:sort',
    vault: 'race-ainote:vault',
    aiConfig: 'race-ainote:ai-config',
    cloudConfig: 'race-ainote:cloud',
    records: 'race-ainote:mistakes',
    plugins: 'race-ainote:plugins',
    pluginData: 'race-ainote:plugin:'
  };

  function storage() {
    try { return root.localStorage || null; } catch (_) { return null; }
  }

  function resolve(name) {
    if (KEYS[name]) return KEYS[name];
    if (String(name).startsWith('pluginData:')) {
      return KEYS.pluginData + String(name).slice('pluginData:'.length);
    }
    return String(name);
  }

  function get(name, fallback) {
    const s = storage();
    if (!s) return fallback == null ? null : fallback;
    try {
      const value = s.getItem(resolve(name));
      return value == null ? (fallback == null ? null : fallback) : value;
    } catch (_) {
      return fallback == null ? null : fallback;
    }
  }

  function getJSON(name, fallback) {
    const raw = get(name, null);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function set(name, value) {
    const s = storage();
    if (!s) return false;
    try { s.setItem(resolve(name), String(value)); return true; } catch (_) { return false; }
  }

  function setJSON(name, value) {
    try { return set(name, JSON.stringify(value)); } catch (_) { return false; }
  }

  function remove(name) {
    const s = storage();
    if (!s) return false;
    try { s.removeItem(resolve(name)); return true; } catch (_) { return false; }
  }

  function copyLegacy() {
    const s = storage();
    if (!s) return 0;
    let count = 0;
    for (const [name, legacyKey] of Object.entries(LEGACY)) {
      if (name === 'pluginData') continue;
      const value = s.getItem(legacyKey);
      if (value == null) continue;
      if (s.getItem(KEYS[name]) == null) s.setItem(KEYS[name], value);
      s.removeItem(legacyKey);
      count++;
    }
    const pluginKeys = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && key.startsWith(LEGACY.pluginData)) pluginKeys.push(key);
    }
    for (const key of pluginKeys) {
      const nextKey = KEYS.pluginData + key.slice(LEGACY.pluginData.length);
      if (s.getItem(nextKey) == null) s.setItem(nextKey, s.getItem(key));
      s.removeItem(key);
      count++;
    }
    return count;
  }

  const MIGRATIONS = {
    2: copyLegacy
  };

  function migrate() {
    const s = storage();
    if (!s) return { from: 0, to: VERSION, migrated: 0 };
    let from = Number(s.getItem(KEYS.schema) || 1);
    if (!Number.isFinite(from) || from < 1) from = 1;
    let migrated = 0;
    for (let version = from + 1; version <= VERSION; version++) {
      const step = MIGRATIONS[version];
      if (step) migrated += Number(step() || 0);
    }
    s.setItem(KEYS.schema, String(VERSION));
    return { from, to: VERSION, migrated };
  }

  function resetAll() {
    const s = storage();
    if (!s) return;
    const keys = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) s.removeItem(key);
  }

  RG.store = { VERSION, KEYS, LEGACY, get, getJSON, set, setJSON, remove, migrate, resetAll };
  try { RG.store.migrate(); } catch (_) {}
})(typeof window !== 'undefined' ? window : globalThis);
