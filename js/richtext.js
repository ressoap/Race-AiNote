/* ============================================================
   richtext.js — 所见即所得编辑：HTML ⇄ Markdown 转换与选区工具
   用户不需要写 Markdown，编辑区是富文本；保存时再转回 Markdown 存储。
   ============================================================ */
(function (root) {
  'use strict';

  const BLOCK_TAGS = /^(DIV|P|H1|H2|H3|H4|H5|H6|UL|OL|LI|BLOCKQUOTE|PRE|HR|TABLE|SECTION|ARTICLE)$/;

  function inlineChildren(node) {
    let out = '';
    for (const child of node.childNodes) out += inlineNode(child);
    return out;
  }

  function inlineNode(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';

    const tag = node.tagName;
    const inner = inlineChildren(node);

    if (tag === 'BR') return '\n';
    if (tag === 'STRONG' || tag === 'B') return inner.trim() ? '**' + inner + '**' : inner;
    if (tag === 'EM' || tag === 'I') return inner.trim() ? '*' + inner + '*' : inner;
    if (tag === 'U') return '<u>' + inner + '</u>';
    if (tag === 'MARK') return '<mark>' + inner + '</mark>';
    if (tag === 'CODE') return '`' + node.textContent + '`';
    if (tag === 'A') {
      const wiki = node.getAttribute('data-wikilink');
      if (wiki) return '[[' + wiki + ']]';
      const href = node.getAttribute('href') || '';
      return href ? '[' + inner + '](' + href + ')' : inner;
    }
    if (node.classList && node.classList.contains('md-link')) {
      return '[[' + (node.getAttribute('data-wikilink') || node.textContent) + ']]';
    }
    if (node.classList && node.classList.contains('md-tag')) return node.textContent;
    return inner;
  }

  /** 把一段富文本 HTML 转成 Markdown */
  function htmlToMarkdown(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const blocks = [];

    function walk(parent) {
      let buffer = '';
      const flush = () => {
        const text = buffer.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (text) blocks.push(text);
        buffer = '';
      };
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          const text = child.nodeValue.replace(/\s+/g, ' ');
          if (text.trim()) buffer += text;
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName;
        if (BLOCK_TAGS.test(tag)) {
          flush();
          blocks.push(blockOf(child));
        } else {
          buffer += inlineNode(child);
        }
      }
      flush();
    }

    function blockOf(el) {
      const tag = el.tagName;
      if (/^H[1-6]$/.test(tag)) {
        return '#'.repeat(Number(tag[1])) + ' ' + inlineChildren(el).trim();
      }
      if (tag === 'UL' || tag === 'OL') {
        const items = [...el.children].filter(c => c.tagName === 'LI');
        return items.map((li, i) => {
          const marker = tag === 'OL' ? (i + 1) + '. ' : '- ';
          const text = inlineChildren(li).trim().replace(/\n+/g, ' ');
          const task = li.classList && li.classList.contains('md-task');
          if (task) {
            const done = li.querySelector('.md-check.is-done');
            return marker + (done ? '[x] ' : '[ ] ') + text.replace(/^[✓\s]*/, '');
          }
          return marker + text;
        }).join('\n');
      }
      if (tag === 'BLOCKQUOTE') {
        return inlineChildren(el).trim().split('\n').map(l => '> ' + l).join('\n');
      }
      if (tag === 'PRE') {
        return '```\n' + el.textContent.replace(/\n+$/, '') + '\n```';
      }
      if (tag === 'HR') return '---';
      return inlineChildren(el).trim();
    }

    walk(box);
    return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ── 选区格式化 ───────────────────────────────────────────── */

  /** 对当前选区执行命令；execCommand 兼容性最好，失败则静默 */
  function exec(command, value) {
    try {
      return document.execCommand(command, false, value === undefined ? null : value);
    } catch (_) {
      return false;
    }
  }

  function bold() { return exec('bold'); }
  function italic() { return exec('italic'); }
  function underline() { return exec('underline'); }
  function highlight() { return exec('hiliteColor', 'rgba(255, 226, 122, 0.75)'); }
  function clearFormat() { return exec('removeFormat'); }

  /** 把选中的文字包成指向某篇笔记的双链 */
  function wrapWithWikiLink(container, title) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    if (!container.contains(range.commonAncestorContainer)) return false;

    const span = document.createElement('span');
    span.className = 'md-link';
    span.setAttribute('data-wikilink', title);
    span.textContent = sel.toString();
    range.deleteContents();
    range.insertNode(span);

    sel.removeAllRanges();
    const after = document.createRange();
    after.setStartAfter(span);
    after.collapse(true);
    sel.addRange(after);
    return true;
  }

  /** 在选区处插入纯文本 */
  function insertText(container, text) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !container.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      container.appendChild(document.createTextNode(text));
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** 选区是否落在容器内 */
  function selectionIn(container) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    if (!container.contains(range.commonAncestorContainer)) return null;
    return range;
  }

  root.RG = root.RG || {};
  root.RG.richtext = {
    htmlToMarkdown, bold, italic, underline, highlight, clearFormat,
    wrapWithWikiLink, insertText, selectionIn, exec
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
