/* ============================================================
   query.js — Obsidian 风格查询语法解析与匹配
   支持：普通文本、path: file: tag: content: 、-排除、OR、
        "带空格的引号"、/正则/、#tag 简写
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RG = root.RG || {};
  root.RG.query = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OPERATORS = ['path', 'file', 'tag', 'content'];
  const OP_RE = /^(path|file|tag|content):/i;

  function lower(v) { return String(v == null ? '' : v).toLowerCase(); }

  /** 按顶层 OR 切分（引号、正则内部不切） */
  function splitTopLevelOr(raw) {
    const parts = [];
    let current = '';
    let quoted = false;
    let inRegex = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"' && !inRegex) { quoted = !quoted; current += c; continue; }
      if (c === '/' && !quoted && raw[i - 1] !== '/') { inRegex = !inRegex; current += c; continue; }
      if (!quoted && !inRegex && raw.slice(i, i + 4).toUpperCase() === ' OR ') {
        parts.push(current);
        current = '';
        i += 3;
        continue;
      }
      current += c;
    }
    parts.push(current);
    return parts.map(s => s.trim()).filter(Boolean);
  }

  /** 单个 OR 分组 → token 数组（token 之间是 AND 关系） */
  function tokenizeGroup(group) {
    const tokens = [];
    let i = 0;
    while (i < group.length) {
      while (i < group.length && /\s/.test(group[i])) i++;
      if (i >= group.length) break;

      let negated = false;
      if (group[i] === '-' && i + 1 < group.length && !/\s/.test(group[i + 1])) { negated = true; i++; }

      let operator = null;
      const opMatch = group.slice(i).match(OP_RE);
      if (opMatch) { operator = opMatch[1].toLowerCase(); i += opMatch[0].length; }

      let value = '';
      let isRegex = false;

      if (group[i] === '"') {
        i++;
        while (i < group.length && group[i] !== '"') value += group[i++];
        if (group[i] === '"') i++;
      } else if (group[i] === '/') {
        i++;
        while (i < group.length && group[i] !== '/') value += group[i++];
        if (group[i] === '/') i++;
        isRegex = true;
      } else {
        while (i < group.length && !/\s/.test(group[i])) value += group[i++];
      }

      if (!value) continue;
      tokens.push({ negated, operator, value, isRegex, needle: lower(value) });
    }
    return tokens;
  }

  function parseQuery(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    const groups = splitTopLevelOr(text).map(tokenizeGroup).filter(g => g.length);
    return groups.length ? groups : null;
  }

  function regexOf(token) {
    if (!token.isRegex) return null;
    if (token._re !== undefined) return token._re;
    try {
      token._re = new RegExp(token.value, 'i');
    } catch (_) {
      token._re = null;
    }
    return token._re;
  }

  function textOf(node) {
    if (node._haystack) return node._haystack;
    const parts = [node.title, node.path, node.content || ''];
    for (const tag of node.tags || []) parts.push('#' + tag);
    node._haystack = lower(parts.join(' '));
    return node._haystack;
  }

  function hit(haystack, token) {
    const re = regexOf(token);
    if (re) return re.test(haystack);
    return haystack.includes(token.needle);
  }

  function matchToken(node, token) {
    const title = lower(node.title);
    const path = lower(node.path);
    const content = lower(node.content || '');
    const tags = (node.tags || []).map(lower);
    let matched;

    if (token.isRegex) {
      const re = regexOf(token);
      if (!re) return token.negated ? true : false;
      if (token.operator === 'path') matched = re.test(path);
      else if (token.operator === 'file') matched = re.test(title) || re.test(path);
      else if (token.operator === 'tag') matched = tags.some(t => re.test(t));
      else if (token.operator === 'content') matched = re.test(content);
      else matched = re.test(textOf(node));
    } else if (token.operator === 'path') {
      matched = path.includes(token.needle);
    } else if (token.operator === 'file') {
      matched = title.includes(token.needle) || path.includes(token.needle);
    } else if (token.operator === 'tag') {
      const want = token.needle.replace(/^#/, '');
      matched = tags.some(t => t === want || t.includes(want));
    } else if (token.operator === 'content') {
      matched = content.includes(token.needle);
    } else {
      matched = hit(textOf(node), token);
    }
    return token.negated ? !matched : matched;
  }

  /** 真正的匹配入口：空查询视为全部命中 */
  function matches(node, rawQuery) {
    const groups = parseQuery(rawQuery);
    if (!groups) return true;
    return groups.some(tokens => tokens.every(token => matchToken(node, token)));
  }

  function describe(rawQuery) {
    const groups = parseQuery(rawQuery);
    if (!groups) return [];
    return groups.map(tokens => tokens.map(t => ({
      negated: t.negated,
      operator: t.operator,
      value: t.value,
      isRegex: t.isRegex
    })));
  }

  return { parseQuery, matches, describe, splitTopLevelOr, tokenizeGroup, OPERATORS };
});
