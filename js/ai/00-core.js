  const store = root.RG && root.RG.store;

  function storageGet(name, legacyKey) {
    if (store) {
      const value = store.get(name);
      if (value != null) return value;
    }
    try { return localStorage.getItem(legacyKey); } catch (_) { return null; }
  }

  function storageSet(name, value, legacyKey) {
    if (store) return store.set(name, value);
    try { localStorage.setItem(legacyKey, value); return true; } catch (_) { return false; }
  }

  function storageRemove(name, legacyKey) {
    if (store) return store.remove(name);
    try { localStorage.removeItem(legacyKey); return true; } catch (_) { return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 极简 BM25 风格检索：按关键词命中数排序 */
  /** 分词：英文按词，中文按二元组切开（中文没空格，二元组命中率更稳） */
  function tokenize(text) {
    const raw = String(text || '').toLowerCase();
    const parts = raw.split(/[^0-9a-z\u4e00-\u9fa5]+/i).filter(Boolean);
    const out = new Set();
    for (const p of parts) {
      out.add(p);
      if (p.length > 2 && /[\u4e00-\u9fa5]/.test(p)) {
        for (let i = 0; i < p.length - 1; i++) out.add(p.slice(i, i + 2));
      }
    }
    return [...out].filter(t => t.length > 1 || /[0-9a-z]/i.test(t));
  }

  /** 极简 BM25 风格检索：按关键词命中数排序，标题命中加权 */
  function retrieve(question, noteList, limit) {
    const terms = tokenize(question);
    if (!terms.length) return [];
    const scored = [];
    for (const note of noteList) {
      const title = String(note.title || '').toLowerCase();
      const hay = (title + ' ' + (note.path || '') + ' ' + (note.content || '') + ' ' + (note.tags || []).join(' ')).toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (!hay.includes(t)) continue;
        score += title.includes(t) ? 4 : 1;
      }
      if (score > 0) scored.push({ note, score });
    }
    return scored.sort((x, y) => y.score - x.score).slice(0, limit || 5).map(s => s.note);
  }

  function headingsOf(content) {
    return (String(content || '').match(/^#{1,6}\s+(.+)$/gm) || []).map(h => h.replace(/^#+\s+/, '').trim());
  }

  /* ── 本地规则分析 ─────────────────────────────────────────── */

  function answerLocal(question, ctx) {
    const q = String(question || '');
    const graph = ctx.graph;
    const note = ctx.currentNote;
    const notes = graph ? graph.notes : [];

    if (/孤立|没有被链接|没人链/.test(q)) {
      const orphans = graph.nodes.filter(n => n.type === 'note' && n.degree === 0);
      if (!orphans.length) return { text: '当前库里没有孤立笔记，所有笔记都至少有一条双链。', refs: [] };
      return {
        text: '当前库有 ' + orphans.length + ' 篇孤立笔记（没有任何双链指向它，也没有向外链接）：',
        refs: orphans.map(n => n.title)
      };
    }

    if (/薄弱|弱点|短板|复习计划|怎么补/.test(q)) {
      const weak = notes.filter(n => (n.tags || []).some(t => /薄弱|错题/.test(t)));
      const plan = notes.filter(n => /复习计划|复盘/.test(n.title));
      const lines = [];
      lines.push('根据标签与错题记录，当前有 ' + weak.length + ' 篇与薄弱环节相关的笔记。');
      if (weak.length) lines.push('建议优先处理：' + weak.slice(0, 5).map(n => n.title).join('、') + '。');
      if (plan.length) lines.push('排期可以套用现成模板：' + plan.map(n => n.title).join('、') + '。');
      lines.push('执行节奏建议：当天记错因 → 三天后重做 → 一周后清零。');
      return { text: lines.join('\n'), refs: [...weak.slice(0, 5), ...plan].map(n => n.title) };
    }

    if (/知识卡|整理|归纳|总结这张|提炼/.test(q)) {
      if (!note) return { text: '先在左侧选一篇笔记，我再来帮你整理成知识卡。', refs: [] };
      const hs = headingsOf(note.content);
      const lines = [
        '按知识卡模板整理「' + note.title + '」：',
        '## 定义\n' + (note.summary || '（原文没有摘要，建议补一句一句话定义）'),
        '## 结构\n' + (hs.length ? hs.map(h => '- ' + h).join('\n') : '- （原文没有小标题，建议先分 3 段）'),
        '## 已有双链\n' + ((note.links || []).length ? note.links.map(l => '- [[' + l.target + ']]').join('\n') : '- 暂无，建议至少挂 2 条'),
        '## 建议标签\n' + ((note.tags || []).length ? note.tags.map(t => '#' + t).join(' ') : '暂无')
      ];
      return { text: lines.join('\n\n'), refs: [note.title] };
    }

    if (note && /核心|考点|讲了什么|重点|一句话/.test(q)) {
      const hs = headingsOf(note.content).slice(0, 6);
      const links = (note.links || []).slice(0, 5).map(l => l.target);
      const lines = ['「' + note.title + '」的要点：', note.summary || '（无摘要）'];
      if (hs.length) lines.push('结构：' + hs.join(' / '));
      if (note.tags.length) lines.push('标签：' + note.tags.map(t => '#' + t).join(' '));
      if (links.length) lines.push('关联：' + links.map(t => '[[' + t + ']]').join(' '));
      return { text: lines.join('\n'), refs: [note.title, ...links] };
    }

    // 兜底：全文检索
    const hits = retrieve(q, notes, 5);
    if (!hits.length) {
      return { text: '没在库里找到直接相关的内容。换个关键词，或者问我「哪些笔记还没被链接」「我的薄弱环节」。', refs: [] };
    }
    const lines = ['在库里找到 ' + hits.length + ' 篇相关笔记：'];
    for (const n of hits) {
      lines.push('· ' + n.title + '：' + (n.summary || n.path));
    }
    return { text: lines.join('\n'), refs: hits.map(n => n.title) };
  }
