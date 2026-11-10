/* ============================================================
   cloud.js — 云端备份 / 恢复
   只对接官方开放接口：
   · GitHub  Contents API  https://docs.github.com/rest/repos/contents
   · Gitee   OpenAPI v5    https://gitee.com/api/v5/swagger
   · 百度网盘 开放平台 xpan https://pan.baidu.com/union/doc
   夸克网盘目前没有对第三方开放的官方接口，故不提供。
   凭据只存在本机 localStorage，绝不进入仓库。
   ============================================================ */
(function (root) {
  'use strict';

  const CONFIG_KEY = 'race-ainote:cloud';
  const PROVIDERS = {
    github: { name: 'GitHub', official: true, needs: ['token', 'owner', 'repo', 'path'] },
    gitee: { name: 'Gitee', official: true, needs: ['token', 'owner', 'repo', 'path'] },
    baidu: { name: '百度网盘', official: true, needs: ['accessToken', 'path'] },
    quark: { name: '夸克网盘', official: false, needs: [] }
  };

  function defaultConfig() {
    return {
      provider: 'github',
      github: { token: '', owner: '', repo: '', branch: 'main', path: 'race-ainote-backup.json' },
      gitee: { token: '', owner: '', repo: '', branch: 'master', path: 'race-ainote-backup.json' },
      baidu: { accessToken: '', path: '/apps/race-ainote/backup.json' },
      lastSync: null
    };
  }

  function loadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      const base = defaultConfig();
      return {
        provider: raw.provider || base.provider,
        github: Object.assign({}, base.github, raw.github || {}),
        gitee: Object.assign({}, base.gitee, raw.gitee || {}),
        baidu: Object.assign({}, base.baidu, raw.baidu || {}),
        lastSync: raw.lastSync || null
      };
    } catch (_) {
      return defaultConfig();
    }
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  /* ── 编码工具（浏览器与 Node 通用） ─────────────────────── */
  function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(String(text));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function fromBase64Utf8(b64) {
    const binary = atob(String(b64).replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** 备份包：包含所有笔记的 Markdown 原文 */
  function buildSnapshot(files, label) {
    return JSON.stringify({
      app: 'Race-AiNote',
      version: 1,
      savedAt: new Date().toISOString(),
      vault: label || '',
      count: files.length,
      files: files.filter(f => typeof f.content === 'string').map(f => ({ path: f.path, content: f.content }))
    }, null, 2);
  }

  function parseSnapshot(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.files)) throw new Error('备份文件格式不正确');
    return data;
  }

  /* ── GitHub ─────────────────────────────────────────────── */
  const gh = {
    apiBase: 'https://api.github.com',
    baseOf(cfg) { return (cfg && cfg.apiBase) || this.apiBase; },
    headers(cfg) {
      return {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      };
    },
    async read(cfg) {
      const url = this.baseOf(cfg) + '/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path
        + '?ref=' + encodeURIComponent(cfg.branch || 'main');
      const res = await fetch(url, { headers: this.headers(cfg), cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('GitHub 读取失败：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
      const data = await res.json();
      return { sha: data.sha, text: fromBase64Utf8(data.content || '') };
    },
    async write(cfg, text, message) {
      const existing = await this.read(cfg);
      const body = {
        message: message || 'chore: 更新 Race-AiNote 备份',
        content: toBase64Utf8(text),
        branch: cfg.branch || 'main'
      };
      if (existing) body.sha = existing.sha;
      const res = await fetch(this.baseOf(cfg) + '/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path, {
        method: 'PUT',
        headers: this.headers(cfg),
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('GitHub 写入失败：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
      return true;
    },
    async test(cfg) {
      const res = await fetch(this.baseOf(cfg) + '/repos/' + cfg.owner + '/' + cfg.repo, { headers: this.headers(cfg) });
      if (!res.ok) throw new Error('HTTP ' + res.status + '（检查 token 权限与仓库名）');
      const data = await res.json();
      return '已连接 ' + data.full_name + '，默认分支 ' + data.default_branch;
    }
  };

  /* ── Gitee ──────────────────────────────────────────────── */
  const ge = {
    apiBase: 'https://gitee.com/api/v5',
    baseOf(cfg) { return (cfg && cfg.apiBase) || this.apiBase; },
    async read(cfg) {
      const url = this.baseOf(cfg) + '/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path
        + '?access_token=' + encodeURIComponent(cfg.token) + '&ref=' + encodeURIComponent(cfg.branch || 'master');
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Gitee 读取失败：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
      const data = await res.json();
      return { sha: data.sha, text: fromBase64Utf8(data.content || '') };
    },
    async write(cfg, text, message) {
      const existing = await this.read(cfg);
      const payload = {
        access_token: cfg.token,
        content: toBase64Utf8(text),
        message: message || 'chore: 更新 Race-AiNote 备份',
        branch: cfg.branch || 'master'
      };
      if (existing) payload.sha = existing.sha;
      const res = await fetch(this.baseOf(cfg) + '/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path, {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Gitee 写入失败：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
      return true;
    },
    async test(cfg) {
      const res = await fetch(this.baseOf(cfg) + '/repos/' + cfg.owner + '/' + cfg.repo + '?access_token=' + encodeURIComponent(cfg.token));
      if (!res.ok) throw new Error('HTTP ' + res.status + '（检查私人令牌权限与仓库名）');
      const data = await res.json();
      return '已连接 ' + data.full_name + '，默认分支 ' + data.default_branch;
    }
  };

  /* ── 百度网盘（经本地代理，避开跨域） ───────────────────── */
  const bd = {
    endpoint: '/api/cloud/baidu',
    async post(action, payload) {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ action: action }, payload))
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    },
    async test(cfg) {
      const data = await this.post('test', { accessToken: cfg.accessToken, path: cfg.path });
      return data.message || '已连接百度网盘';
    },
    async write(cfg, text) {
      await this.post('upload', { accessToken: cfg.accessToken, path: cfg.path, content: text });
      return true;
    },
    async read(cfg) {
      const data = await this.post('download', { accessToken: cfg.accessToken, path: cfg.path });
      return { text: data.content || '' };
    }
  };

  const DRIVERS = { github: gh, gitee: ge, baidu: bd };

  async function testConnection(cfg) {
    const provider = cfg.provider;
    if (provider === 'quark') throw new Error('夸克网盘没有官方开放接口，暂不支持');
    const driver = DRIVERS[provider];
    if (!driver) throw new Error('未知的云盘类型');
    return driver.test(cfg[provider]);
  }

  async function backup(cfg, files, label) {
    const provider = cfg.provider;
    if (provider === 'quark') throw new Error('夸克网盘没有官方开放接口，暂不支持');
    const driver = DRIVERS[provider];
    if (!driver) throw new Error('未知的云盘类型');
    const snapshot = buildSnapshot(files, label);
    await driver.write(cfg[provider], snapshot, 'chore: Race-AiNote 备份 ' + new Date().toISOString().slice(0, 16));
    return { bytes: snapshot.length, at: Date.now() };
  }

  async function restore(cfg) {
    const provider = cfg.provider;
    if (provider === 'quark') throw new Error('夸克网盘没有官方开放接口，暂不支持');
    const driver = DRIVERS[provider];
    if (!driver) throw new Error('未知的云盘类型');
    const data = await driver.read(cfg[provider]);
    if (!data || !data.text) throw new Error('云端还没有备份文件');
    return parseSnapshot(data.text);
  }

  root.RG = root.RG || {};
  root.RG.cloud = {
    PROVIDERS, defaultConfig, loadConfig, saveConfig,
    buildSnapshot, parseSnapshot, toBase64Utf8, fromBase64Utf8,
    testConnection, backup, restore
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
