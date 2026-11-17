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

  let imageResolver = null;

  /** 外部注册：把库内图片路径（如 10-错题本/图片/x.jpg）换成 data URL */
  function setImageResolver(fn) {
    imageResolver = typeof fn === 'function' ? fn : null;
  }

  function inline(text) {
    let s = escapeHtml(text);

  // 图片先抽成占位符，避免 ![](x) 被后面的链接规则吃掉
  const images = [];
  s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, function (_, alt, src) {
    images.push({ alt: alt || '图片', src: src });
    return '\u0001' + (images.length - 1) + '\u0001';
  });

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

    s = s.replace(/\u0001(\d+)\u0001/g, function (_, i) {
      const item = images[Number(i)] || { alt: '图片', src: '' };
      const resolved = typeof imageResolver === 'function' ? imageResolver(item.src) : null;
      const finalSrc = resolved || (/^(data:image\/|https?:)/i.test(item.src) ? item.src : '');
      if (!finalSrc) return '<span class="md-img-missing">［图片：' + item.alt + '］</span>';
      return '<img class="md-img" src="' + finalSrc + '" alt="' + item.alt + '" loading="lazy">';
    });

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

      // 空行只结束引用；列表允许「松散写法」（项之间有空行）仍然算同一个列表
      if (!line.trim()) { closeQuote(); continue; }

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

      const ul = line.match(/^\s*[-*+]\s*(.*)$/);
      if (ul) {
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        if (!ul[1].trim()) continue;
        const task = ul[1].match(/^\[([ xX])\]\s*(.*)$/);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          out.push('<li class="md-task"><span class="md-check' + (checked ? ' is-done' : '') + '">' + (checked ? '✓' : '') + '</span>' + inline(task[2]) + '</li>');
        } else {
          out.push('<li>' + inline(ul[1]) + '</li>');
        }
        continue;
      }
      const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (ol) {
        if (listType !== 'ol') {
          closeList();
          const startNum = Number(ol[1]);
          out.push(startNum > 1 ? '<ol start="' + startNum + '">' : '<ol>');
          listType = 'ol';
        }
        out.push('<li>' + inline(ol[2]) + '</li>');
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


  /** AI 输出清洗：把常见 LaTeX 改成可读纯文本，并把 • / 单 * 项目符号转成 Markdown 列表 */
  function normalizeAiText(text) {
    const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    const parts = src.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => idx % 2 ? part : normalizeMathSegment(part)).join('');
  }

  function normalizeMathSegment(segment) {
    let s = String(segment || '');
    const bs = String.fromCharCode(92);
    const nl = String.fromCharCode(10);
    s = s.split(bs + '[').join(nl).split(bs + ']').join(nl);
    s = s.split(bs + '(').join('').split(bs + ')').join('');
    s = s.replace(/\$\$([\s\S]*?)\$\$/g, function (_, body) { return nl + body.trim() + nl; });
    s = s.replace(/\$([^$\n]+)\$/g, function (_, body) { return body.trim(); });

    for (let i = 0; i < 3; i++) {
      s = s.replace(new RegExp(bs + bs + 'frac' + bs + 's*' + bs + '{([^{}]+)' + bs + '}' + bs + 's*' + bs + '{([^{}]+)' + bs + '}', 'g'), '($1)/($2)');
      s = s.replace(new RegExp(bs + bs + 'sqrt' + bs + 's*' + bs + '{([^{}]+)' + bs + '}', 'g'), '√($1)');
    }
    s = s.replace(new RegExp(bs + bs + '(?:text|mathrm|mathbf|operatorname)' + bs + 's*' + bs + '{([^{}]*)' + bs + '}', 'g'), '$1');
    s = s.replace(new RegExp(bs + bs + '(?:left|right)' + bs + 's*', 'g'), '');
    s = s.replace(new RegExp(bs + bs + '(?:begin|end)' + bs + 's*' + bs + '{[^{}]*' + bs + '}', 'g'), '');

    const cmd = name => bs + name;
    const commands = {
      [cmd('cdot')]: '·', [cmd('times')]: '×', [cmd('div')]: '÷', [cmd('pm')]: '±',
      [cmd('le')]: '≤', [cmd('leq')]: '≤', [cmd('ge')]: '≥', [cmd('geq')]: '≥', [cmd('neq')]: '≠', [cmd('ne')]: '≠',
      [cmd('approx')]: '≈', [cmd('infty')]: '∞', [cmd('pi')]: 'π', [cmd('alpha')]: 'α', [cmd('beta')]: 'β',
      [cmd('gamma')]: 'γ', [cmd('theta')]: 'θ', [cmd('lambda')]: 'λ', [cmd('mu')]: 'μ', [cmd('sigma')]: 'σ',
      [cmd('omega')]: 'ω', [cmd('Delta')]: 'Δ', [cmd('sum')]: 'Σ', [cmd('int')]: '∫', [cmd('partial')]: '∂',
      [cmd('to')]: '→', [cmd('rightarrow')]: '→', [cmd('Rightarrow')]: '⇒', [cmd('in')]: '∈', [cmd('notin')]: '∉'
    };
    for (const key of Object.keys(commands)) s = s.split(key).join(commands[key]);
    s = s.replace(new RegExp(bs + bs + '(sin|cos|tan|log|ln|lim|max|min|exp)' + bs + 'b', 'g'), '$1');
    s = s.replace(new RegExp(bs + bs + '[a-zA-Z]+', 'g'), '');
    s = s.replace(new RegExp(bs + bs, 'g'), '');

    const sup = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', 'n': 'ⁿ' };
    s = s.replace(/\^\{([0-9+\-n]+)\}/g, function (_, p) {
      return [...p].map(ch => sup[ch] || ch).join('');
    });
    s = s.replace(/\^([0-9+\-n])/g, function (_, p) { return sup[p] || p; });

    s = s.replace(/^(\s*)[•●▪◦·]\s+/gm, '$1- ');
    s = s.replace(/^(\s*)\*\s+/gm, '$1- ');
    return s;
  }

  function renderAi(text) {
    return render(normalizeAiText(text));
  }

  return { render: render, renderAi: renderAi, normalizeAiText: normalizeAiText, inline: inline, escapeHtml: escapeHtml, toText: toText, setImageResolver: setImageResolver };
});
