  /* ── 拍题入库：图片识别成题目笔记 ───────────────────────── */
  const photoBtn = $('#btn-photo');
  const photoInput = $('#photo-input');
  let photoBusy = false;

  function photoStamp(date) {
    const pad = n => String(n).padStart(2, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate())
      + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
  }

  async function importPhoto(file) {
    if (photoBusy || !file) return;
    if (!/^image\//i.test(file.type || '') && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || '')) {
      return toast('请选择图片文件');
    }
    photoBusy = true;
    if (photoBtn) photoBtn.disabled = true;
    try {
      toast('正在识别题目…');
      const result = await ai.recognizeImage(file);
      if (!result || !result.ok) {
        toast(result && result.error ? result.error : '识别失败');
        return;
      }
      const text = String(result.text || '').trim();
      if (!text) {
        toast('没有识别到题目，换一张更清晰的图片试试');
        return;
      }
      const analysis = RG.ai.classifyLocally(text, '');
      const subject = RG.ai.normalizeSubject(analysis.subject || '其他');
      const points = Array.isArray(analysis.knowledgePoints) ? analysis.knowledgePoints.slice(0, 3) : [];
      const now = new Date();
      const title = subject + '拍题-' + photoStamp(now);
      const safeSubject = subject.replace(/[\/:*?"<>|]/g, '-').trim() || '其他';
      const path = uniquePath('10-错题本/' + safeSubject, title);
      const quoted = text.replace(/\r\n/g, '\n').split('\n').map(line => line ? '> ' + line : '>').join('\n');
      const content = [
        '---',
        'title: ' + title,
        'tags: [错题, 拍题, ' + subject + ']',
        '---',
        '',
        '# ' + title,
        '',
        '## 原题目',
        '',
        quoted,
        '',
        '## 学科与知识点',
        '',
        '- 学科：' + subject,
        '- 知识点：' + (points.length ? points.join('、') : '待整理'),
        '',
        '## 我的错因',
        '',
        '（待补充）',
        '',
        '## 正确思路',
        '',
        '（待补充）',
        ''
      ].join('\n');
      state.files.push({ path: path, content: content });
      refreshVault('已拍题入库：' + title);
      const node = state.graph && state.graph.notes.find(n => n.path === path);
      if (node) openNote(node.id);
      showView('note');
      toast('已拍题入库，可继续向 AI 追问');
    } catch (err) {
      toast('拍题失败：' + (err && err.message ? err.message : err));
    } finally {
      photoBusy = false;
      if (photoBtn) photoBtn.disabled = false;
    }
  }

  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', () => {
      if (!photoBusy) photoInput.click();
    });
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      photoInput.value = '';
      if (file) await importPhoto(file);
    });
  }
