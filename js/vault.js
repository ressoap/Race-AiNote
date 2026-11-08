/* ============================================================
   vault.js — Markdown 库解析：frontmatter / [[双链]] / #标签 / 附件
   纯函数，无 DOM 依赖，Node 与浏览器通用。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RG = root.RG || {};
  root.RG.vault = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MD_EXT = /\.(md|markdown)$/i;
  const ATTACH_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|pdf|mp3|mp4|wav|canvas|excalidraw)$/i;

  function baseName(path) {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return i >= 0 ? path.slice(i + 1) : path;
  }

  function dirName(path) {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return i >= 0 ? path.slice(0, i) : '';
  }

  function stripMdExt(name) { return name.replace(MD_EXT, ''); }
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

  /** 稳定 ID：由路径推导 */
  function idFromPath(path) {
    return lower(path).replace(/\\/g, '/').replace(MD_EXT, '');
  }

  function unquote(s) { return s.replace(/^["']|["']$/g, ''); }

  function parseScalar(value) {
    if (/^\[.*\]$/.test(value)) {
      return value.slice(1, -1).split(',').map(v => unquote(v.trim())).filter(Boolean);
    }
    return unquote(value);
  }

  function asTagList(value) {
    if (Array.isArray(value)) return value.map(v => unquote(String(v).replace(/^#/, ''))).filter(Boolean);
    if (typeof value === 'string' && value.trim()) {
      return value.split(/[,\s]+/).map(v => unquote(v.replace(/^#/, ''))).filter(Boolean);
    }
    return [];
  }

  /* ── frontmatter（精简 YAML：标量 / 行内数组 / 块数组） ────── */
  function parseFrontmatter(text) {
    const src = String(text || '');
    if (!/^---\r?\n/.test(src)) return { data: {}, body: src };
    const end = src.indexOf('\n---', 3);
    if (end < 0) return { data: {}, body: src };
    const raw = src.slice(4, end);
    const body = src.slice(src.indexOf('\n', end + 1) + 1);
    const data = {};
    let currentKey = null;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const listItem = line.match(/^\s*-\s+(.*)$/);
      if (listItem && currentKey) {
        if (!Array.isArray(data[currentKey])) data[currentKey] = [];
        data[currentKey].push(unquote(listItem[1].trim()));
        continue;
      }
      const kv = line.match(/^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      currentKey = kv[1];
      const value = kv[2].trim();
      if (!value) { data[currentKey] = []; continue; }
      data[currentKey] = parseScalar(value);
    }
    return { data, body };
  }

  /* ── 正文抽取 ─────────────────────────────────────────────── */
  function stripFencedCode(body) {
    return body.replace(/```[\s\S]*?```/g, m => m.replace(/[^\n]/g, ' '))
               .replace(/~~~[\s\S]*?~~~/g, m => m.replace(/[^\n]/g, ' '));
  }

  function stripInlineCode(text) {
    return text.replace(/`[^`\n]*`/g, m => ' '.repeat(m.length));
  }

  /** [[目标|别名]] → { target, alias, heading, embed } */
  function extractLinks(body) {
    const text = stripInlineCode(stripFencedCode(body));
    const out = [];
    const re = /(!?)\[\[([^\[\]\n]{1,400})\]\]/g;
    let m;
    while ((m = re.exec(text))) {
      let inner = m[2].trim();
      if (!inner) continue;
      let alias = null;
      const pipe = inner.indexOf('|');
      if (pipe >= 0) { alias = inner.slice(pipe + 1).trim() || null; inner = inner.slice(0, pipe).trim(); }
      let heading = null;
      const hash = inner.indexOf('#');
      if (hash >= 0) { heading = inner.slice(hash + 1).trim() || null; inner = inner.slice(0, hash).trim(); }
      if (!inner) continue;
      if (/^https?:/i.test(inner)) continue;
      out.push({ target: inner, alias, heading, embed: m[1] === '!' });
    }
    return out;
  }

  /** 正文 #标签（排除 Markdown 标题、URL 锚点、代码块） */
  function extractTags(body) {
    const text = stripInlineCode(stripFencedCode(body));
    const tags = new Set();
    const re = /(^|[\s(（【\[>])#([\p{L}\p{N}_][\p{L}\p{N}_\/-]{0,63})/gu;
    let m;
    while ((m = re.exec(text))) {
      const tag = m[2].replace(/[-/]+$/, '');
      if (tag) tags.add(tag);
    }
    return [...tags];
  }

  /** 摘要：去掉标题、链接语法后截断 */
  function summarize(body, limit) {
    const max = limit || 120;
    const text = stripInlineCode(stripFencedCode(body))
      .replace(/^#+\s+.*$/gm, '')
      .replace(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[>*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  /* ── 单篇笔记 ─────────────────────────────────────────────── */
  function parseNote(path, content, mtime) {
    const { data, body } = parseFrontmatter(String(content || ''));
    const fmTags = asTagList(data.tags != null ? data.tags : data.tag);
    const inlineTags = extractTags(body);
    const tags = [...new Set([...fmTags, ...inlineTags])];
    const title = (typeof data.title === 'string' && data.title.trim())
      ? data.title.trim()
      : stripMdExt(baseName(path));
    return {
      id: idFromPath(path),
      title,
      path,
      dir: dirName(path),
      type: 'note',
      tags,
      aliases: asTagList(data.aliases != null ? data.aliases : data.alias),
      links: extractLinks(body),
      content: body,
      summary: summarize(body),
      frontmatter: data,
      mtime: mtime || 0,
      degree: 0
    };
  }

  /** Obsidian 风格最短路径解析：先路径/别名，再文件名（唯一时后缀匹配） */
  function resolveTarget(target, byPath, byName) {
    const raw = String(target).trim().replace(/\\/g, '/');
    if (!raw) return null;
    for (const key of [lower(raw), lower(stripMdExt(raw))]) {
      const hit = byPath.get(key);
      if (hit) return hit;
    }
    const list = byName.get(lower(stripMdExt(baseName(raw))));
    if (list && list.length) {
      if (raw.includes('/')) {
        const suffix = lower(stripMdExt(raw));
        const matched = list.find(n => lower(stripMdExt(n.path)).endsWith(suffix));
        if (matched) return matched;
      }
      return list[0];
    }
    return null;
  }

  /* ── 库 → 图模型 ──────────────────────────────────────────── */
  function buildVault(files, options) {
    const opts = Object.assign(
      { includeTags: true, includeAttachments: true, includeUnresolved: true },
      options || {}
    );

    const notes = [];
    const attachments = [];
    const skipped = [];

    for (const file of files || []) {
      const path = String(file.path || '').replace(/\\/g, '/');
      if (!path) continue;
      if (MD_EXT.test(path)) {
        notes.push(parseNote(path, file.content, file.mtime));
      } else if (ATTACH_EXT.test(path)) {
        attachments.push({
          id: idFromPath(path),
          title: baseName(path),
          path,
          dir: dirName(path),
          type: 'attachment',
          tags: [],
          content: '',
          summary: '',
          mtime: file.mtime || 0,
          ext: (path.match(/\.[^.]+$/) || [''])[0].toLowerCase()
        });
      } else {
        skipped.push(path);
      }
    }

    // 解析索引：完整路径 / 去扩展名路径 / 文件名 / 别名
    const byPath = new Map();
    const byName = new Map();
    for (const node of [...notes, ...attachments]) {
      byPath.set(lower(node.path), node);
      byPath.set(lower(stripMdExt(node.path)), node);
      const nameKey = lower(stripMdExt(baseName(node.path)));
      if (!byName.has(nameKey)) byName.set(nameKey, []);
      byName.get(nameKey).push(node);
      for (const alias of node.aliases || []) {
        const key = lower(alias);
        if (!byPath.has(key)) byPath.set(key, node);
      }
    }

    const unresolved = new Map();
    const linkMap = new Map();
    const addLink = (source, target, kind) => {
      if (!source || !target || source === target) return;
      const key = source + '\u0000' + target + '\u0000' + kind;
      if (linkMap.has(key)) return;
      linkMap.set(key, { source, target, kind });
    };

    for (const note of notes) {
      for (const link of note.links) {
        const hit = resolveTarget(link.target, byPath, byName);
        if (hit) {
          addLink(note.id, hit.id, link.embed ? 'embed' : 'link');
          if (!hit.backlinks) hit.backlinks = [];
          hit.backlinks.push(note.id);
        } else if (opts.includeUnresolved) {
          const key = lower(link.target);
          if (!unresolved.has(key)) {
            unresolved.set(key, {
              id: 'unresolved:' + key,
              title: link.target,
              path: link.target,
              dir: '',
              type: 'unresolved',
              tags: [],
              content: '',
              summary: '',
              mtime: 0
            });
          }
          addLink(note.id, unresolved.get(key).id, 'unresolved');
        }
      }
    }

    const nodes = [...notes];
    if (opts.includeAttachments) nodes.push(...attachments);
    if (opts.includeUnresolved) nodes.push(...unresolved.values());

    if (opts.includeTags) {
      const tagMap = new Map();
      for (const node of nodes) {
        for (const tag of node.tags || []) {
          const key = lower(tag);
          if (!tagMap.has(key)) {
            tagMap.set(key, {
              id: 'tag:' + key,
              title: '#' + tag,
              path: '#' + tag,
              dir: 'tags',
              type: 'tag',
              tags: [],
              content: '',
              summary: '',
              mtime: 0
            });
          }
          addLink(node.id, tagMap.get(key).id, 'tag');
        }
      }
      nodes.push(...tagMap.values());
    }

    const links = [...linkMap.values()];
    const degree = new Map(nodes.map(n => [n.id, 0]));
    for (const link of links) {
      if (degree.has(link.source)) degree.set(link.source, degree.get(link.source) + 1);
      if (degree.has(link.target)) degree.set(link.target, degree.get(link.target) + 1);
    }
    for (const node of nodes) node.degree = degree.get(node.id) || 0;

    return {
      nodes,
      links,
      notes,
      attachments,
      unresolved: [...unresolved.values()],
      skipped,
      stats: {
        notes: notes.length,
        attachments: attachments.length,
        unresolved: unresolved.size,
        tags: nodes.filter(n => n.type === 'tag').length,
        links: links.length,
        orphans: nodes.filter(n => n.degree === 0).length
      }
    };
  }

  return {
    buildVault, parseNote, parseFrontmatter, extractLinks, extractTags,
    summarize, idFromPath, baseName, dirName, stripMdExt, MD_EXT, ATTACH_EXT
  };
});
