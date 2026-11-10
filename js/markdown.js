/* ============================================================
   markdown.js — 极简 Markdown → HTML 渲染（笔记预览用）
   安全策略：先转义 HTML，再做结构化替换，原文标签永远不会变成 HTML。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RG = root.RG || {};
  root.RG.markdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inline(text) {
    let s = escapeHtml(text);

    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, function (_, code) {
      codes.push('<code>' + code + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    // [[双链|别名]]
    s = s.replace(/!?\[\[([^\[\]\n]+?)\]\]/g, function (_, inner) {
      const parts = inner.split('|');
      const target = parts[0].split('#')[0].trim();
      const label = (parts[1] || target).trim();
      if (/^https?:/i.test(target)) {
        return '<a href="' + target + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
      }
      return '<span class="md-link" data-wikilink="' + target + '">' + label + '</span>';
    });

    // [文本](https://…)
    s = s.replace(/\[([^\]\n]*)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // #标签
    s = s.replace(/(^|[\s(（])#([\p{L}\p{N}_][\p{L}\p{N}_\/-]*)/gu,
      '$1<span class="md-tag">#$2</span>');

    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[Number(i)]; });
    // 只允许这几个排版标签从编辑器带进来，其余 HTML 一律保持转义状态
    s = s.replace(/&lt;(\/?)(u|mark|br)&gt;/gi, function (_, slash, tag) { return "<" + slash + tag + ">"; });
    return s;
  }

  function render(text) {
    const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const out = [];
    let inCode = false;
    let codeBuf = [];
    let listType = null;
    let inQuote = false;

    function closeList() {
      if (listType) { out.push('</' + listType + '>'); listType = null; }
    }
    function closeQuote() {
      if (inQuote) { out.push('</blockquote>'); inQuote = false; }
    }

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        if (inCode) {
          out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
          codeBuf = [];
          inCode = false;
        } else {
          closeList(); closeQuote();
          inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      if (!line.trim()) { closeList(); closeQuote(); continue; }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList(); closeQuote();
        const level = Math.min(heading[1].length + 1, 6);
        out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        continue;
      }

      if (/^\s*(---+\*\*\*|___)\s*$/.test(line)) {
        closeList(); closeQuote();
        out.push('<hr>');
        continue;
      }

      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        closeList();
        if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
        out.push('<p>' + inline(quote[1]) + '</p>');
        continue;
      }
      closeQuote();

      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        const task = ul[1].match(/^\[([\ xX])\]\s*(.*)$/);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          out.push('<li class="md-task"><span class="md-check' + (checked ? ' is-done' : '') + '">' + (checked ? '✓' : '') + '</span>' + inline(task[2]) + '</li>');
        } else {
          out.push('<li>' + inline(ul[1]) + '</li>');
        }
        continue;
      }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + inline(ol[1]) + '</li>');
        continue;
      }
      closeList();
      out.push('<p>' + inline(line) + '</p>');
    }

    if (inCode && codeBuf.length) {
      out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
    }
    closeList(); closeQuote();
    return out.join('\n');
  }

  /** 纯文本化：摘要与搜索用，双链优先取别名 */
  function toText(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!?\[\[([^\]\n]+?)\]\]/g, function (_, inner) {
        const alias = (inner.split('|')[1] || '').trim();
        return alias || inner.split('|')[0].split('#')[0].trim();
      })
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { render: render, inline: inline, escapeHtml: escapeHtml, toText: toText };
});
