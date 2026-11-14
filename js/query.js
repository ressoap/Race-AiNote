/* ============================================================
   query.js — 双链笔记风格的查询语法解析与匹配
   支持：
   · 普通文本、"带空格的引号"、-排除、OR、/正则/（可带 i、g 等 flags）
   · 字段：path: file: tag: content: section: line: block:
   · 任务：task: task-todo: task-done:
   · 属性： [键] 存在、[键:值] 等于、[键:null] 为空、[键:>2] 比较
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RG = root.RG || {};
  root.RG.query = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OPERATORS = ['path', 'file', 'tag', 'content', 'section', 'line', 'block', 'task', 'task-todo', 'task-done'];
  // 长的放前面，避免 task-todo: 被 task: 抢先匹配
  const OP_RE = /^(task-todo|task-done|section|content|block|path|file|line|tag|task):/i;

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
        // 紧跟的字母是正则 flags，如 /导数/i
        let flags = '';
        while (i < group.length && /[gimsuy]/.test(group[i])) flags += group[i++];
        if (flags) value = value + '@@FLAGS@@' + flags;
      } else {
        while (i < group.length && !/\s/.test(group[i])) value += group[i++];
      }

      const bareTask = !value && /^task(-todo|-done)?$/.test(operator || '');
      if (!value && !bareTask) continue;

      // 属性查询：[键] / [键:值] / [键:null] / [键:>2]
      const propMatch = !operator && value.match(/^\[([^\]:]+)(?::([^\]]*))?\]$/);
      if (propMatch) {
        const rawVal = propMatch[2] == null ? '' : propMatch[2].trim();
        const cmp = rawVal.match(/^(>=|<=|>|<|=)?(.*)$/);
        tokens.push({
          negated: negated,
          operator: 'property',
          propKey: lower(propMatch[1]).trim(),
          propOp: (cmp && cmp[1]) || '=',
          propValue: lower(cmp ? cmp[2] : rawVal),
          value: value,
          needle: lower(value)
        });
        continue;
      }

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
    const parts = String(token.value).split('@@FLAGS@@');
    const pattern = parts[0];
    const flags = (parts[1] || '') + (parts[1] && parts[1].includes('i') ? '' : 'i');
    try {
      token._re = new RegExp(pattern, flags);
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

  /** 把正文按标题切成小节 */
  function sectionsOf(content) {
    const out = [];
    const lines = String(content || '').split('\n');
    let cur = { title: '', body: [] };
    for (const line of lines) {
      const h = line.match(/^#{1,6}\s+(.+)$/);
      if (h) {
        out.push(cur);
        cur = { title: h[1].trim(), body: [] };
      } else {
        cur.body.push(line);
      }
    }
    out.push(cur);
    return out.map(function (s) { return { title: s.title, body: s.body.join('\n') }; });
  }

  /** 读取 frontmatter 属性值 */
  function propValuesOf(node, key) {
    const fm = node && node.frontmatter;
    if (!fm) return [];
    const raw = fm[key];
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw.map(function (v) { return lower(v); });
    return [lower(raw)];
  }

  function compareProp(values, op, target) {
    if (!values.length) return op === '=' && target === 'null';
    if (op === '=' && target === 'null') return values.every(function (v) { return !v; });
    return values.some(function (v) {
      if (op === '=') return v === target || v.includes(target);
      const a = Number(v);
      const b = Number(target);
      if (isNaN(a) || isNaN(b)) {
        if (op === '>') return v > target;
        if (op === '<') return v < target;
        if (op === '>=') return v >= target;
        if (op === '<=') return v <= target;
        return false;
      }
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '>=') return a >= b;
      if (op === '<=') return a <= b;
      return false;
    });
  }

  /** 任务查询：是否有任务项 / 未完成 / 已完成 */
  function hasTask(content, kind) {
    const lines = String(content || '').split('\n');
    return lines.some(function (line) {
      const m = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
      if (!m) return false;
      if (kind === 'task') return true;
      const done = m[1].toLowerCase() === 'x';
      return kind === 'task-done' ? done : !done;
    });
  }

  function matchToken(node, token) {
    const title = lower(node.title);
    const path = lower(node.path);
    const content = lower(node.content || '');
    const tags = (node.tags || []).map(lower);
    let matched;

    // 属性查询：[键] / [键:值] / [键:null] / [键:>2]
    if (token.operator === 'property') {
      const values = propValuesOf(node, token.propKey);
      const hitProp = (token.propOp === '=' && !token.propValue)
        ? values.length > 0
        : compareProp(values, token.propOp, token.propValue);
      return token.negated ? !hitProp : hitProp;
    }

    // 任务查询：task: / task-todo: / task-done:
    if (token.operator === 'task' || token.operator === 'task-todo' || token.operator === 'task-done') {
      const hitTask = hasTask(node.content, token.operator);
      return token.negated ? !hitTask : hitTask;
    }

    // 小节查询：标题或该小节正文命中
    if (token.operator === 'section') {
      const needle = token.needle;
      const hitSection = sectionsOf(node.content).some(function (sec) {
        const t = lower(sec.title);
        if (t.includes(needle)) return true;
        return t.length > 0 && lower(sec.body).includes(needle);
      });
      return token.negated ? !hitSection : hitSection;
    }

    // 按行查询：同一行内出现所有词
    if (token.operator === 'line') {
      const words = token.needle.split(/\s+/).filter(Boolean);
      const hitLine = String(node.content || '').split('\n').some(function (line) {
        const l = lower(line);
        return words.every(function (w) { return l.includes(w); });
      });
      return token.negated ? !hitLine : hitLine;
    }

    // 块引用 ^blockid
    if (token.operator === 'block') {
      const hitBlock = lower(node.content).includes('^' + token.needle);
      return token.negated ? !hitBlock : hitBlock;
    }

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
