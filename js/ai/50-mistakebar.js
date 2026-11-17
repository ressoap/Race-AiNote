    /** 答疑结束后，追加「是否记入错题本 / 标记已解决」的操作条 */
    function buildMistakeBar(msg) {
      const bar = document.createElement('div');
      bar.className = 'ai-mistake';
      const rec = findRecord(msg.question);
      const resolved = Boolean(msg.resolved || (rec && rec.status === 'resolved'));
      if (resolved && !msg.resolved) { msg.resolved = true; msg.archived = true; if (rec && rec.targetTitle) msg.mistake = rec.targetTitle; }

      if (resolved) {
        const done = document.createElement('span');
        done.className = 'ai-mistake-done';
        const target = msg.mistake || (rec && rec.targetTitle);
        done.textContent = target
          ? '✓ 已记入《' + target + '》· 已解决 · 本轮对话不再作为上下文'
          : '✓ 已标记解决 · 本轮对话不再作为上下文';
        bar.appendChild(done);
        return bar;
      }

      const recorded = Boolean(rec && rec.targetTitle);
      if (recorded) {
        const done = document.createElement('span');
        done.className = 'ai-mistake-done';
        done.textContent = '✓ 已自动记入《' + rec.targetTitle + '》· 仍待解决';
        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'ghost-btn tiny';
        resolveBtn.textContent = '标记已解决';
        resolveBtn.addEventListener('click', function () {
          const wasThere = findRecord(msg.question);
          const saved = wasThere || rec;
          upsertRecord({
            question: msg.question || '',
            answer: msg.text || '',
            targetId: saved.targetId || null,
            targetTitle: saved.targetTitle || rec.targetTitle,
            targetPath: saved.targetPath || rec.targetPath,
            status: 'resolved',
            resolvedAt: Date.now(),
            at: saved.at || Date.now(),
            mode: state.askMode,
            subject: saved.subject || '',
            knowledgePoints: saved.knowledgePoints || [],
            knowledgePoint: saved.knowledgePoint || ''
          });
          msg.resolved = true;
          msg.archived = true;
          msg.mistake = rec.targetTitle;
          if (opts.onToast) opts.onToast('已标记解决，本轮不再作为上下文');
          render();
          renderRecords();
        });
        bar.append(done, resolveBtn);
        return bar;
      }
      if (msg.mistakeSkipped) {
        const skip = document.createElement('span');
        skip.className = 'ai-mistake-skip';
        skip.textContent = '未记入错题本（仍在待解决列表）';
        bar.appendChild(skip);
        return bar;
      }

      const ask = document.createElement('span');
      ask.className = 'ai-mistake-ask';
      ask.textContent = '这道题解决了吗？';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'ghost-btn tiny';
      saveBtn.textContent = '记入错题本';

      const resolveBtn = document.createElement('button');
      resolveBtn.className = 'ghost-btn tiny';
      resolveBtn.textContent = '标记已解决';

      const skipBtn = document.createElement('button');
      skipBtn.className = 'ghost-btn tiny';
      skipBtn.textContent = '稍后再说';

      saveBtn.addEventListener('click', function () {
        bar.innerHTML = '';
        const info = recommendMistakeBook(msg.question || '', opts.getGraph());
        if (!info.candidates.length) {
          const tip = document.createElement('span');
          tip.className = 'ai-mistake-skip';
          tip.textContent = '当前库里没有错题本类笔记，先建一篇吧';
          bar.appendChild(tip);
          return;
        }
        const head = document.createElement('span');
        head.className = 'ai-mistake-ask';
        head.textContent = info.subject ? ('AI 判断是' + info.subject + '题，推荐：') : 'AI 推荐：';

        const select = document.createElement('select');
        select.className = 'ai-mistake-select';
        for (const c of info.candidates) {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.title;
          if (info.recommended && c.id === info.recommended.id) opt.selected = true;
          select.appendChild(opt);
        }
        const ok = document.createElement('button');
        ok.className = 'primary-btn tiny';
        ok.textContent = '确认';
        const cancel = document.createElement('button');
        cancel.className = 'ghost-btn tiny';
        cancel.textContent = '取消';

        ok.addEventListener('click', function () {
          const chosen = info.candidates.find(function (c) { return c.id === select.value; }) || info.recommended;
          if (!chosen) return;
          const wasThere = findRecord(msg.question);
          const createdAt = wasThere ? wasThere.at : Date.now();
          const record = {
            question: msg.question || '',
            answer: msg.text || '',
            targetId: chosen.id,
            targetTitle: chosen.title,
            targetPath: chosen.path,
            status: 'resolved',
            resolvedAt: Date.now(),
            at: createdAt,
            mode: state.askMode,
            subject: wasThere ? (wasThere.subject || '') : '',
            knowledgePoints: wasThere ? (wasThere.knowledgePoints || []) : [],
            knowledgePoint: wasThere ? (wasThere.knowledgePoint || '') : ''
          };
          const existed = upsertRecord(record);
          msg.mistake = chosen.title;
          msg.resolved = true;
          msg.archived = true;
          if (opts.onRecordMistake) opts.onRecordMistake(Object.assign({ at: createdAt }, record, { duplicate: existed }));
          render();
          renderRecords();
        });

        cancel.addEventListener('click', function () { render(); });
        bar.append(head, select, ok, cancel);
      });

      resolveBtn.addEventListener('click', function () {
        const wasThere = findRecord(msg.question);
        upsertRecord({
          question: msg.question || '',
          answer: msg.text || '',
          targetId: null,
          targetTitle: null,
          targetPath: null,
          status: 'resolved',
          resolvedAt: Date.now(),
          at: wasThere ? wasThere.at : Date.now(),
          mode: state.askMode,
          subject: wasThere ? (wasThere.subject || '') : '',
          knowledgePoints: wasThere ? (wasThere.knowledgePoints || []) : [],
          knowledgePoint: wasThere ? (wasThere.knowledgePoint || '') : ''
        });
        msg.resolved = true;
        msg.archived = true;
        if (opts.onToast) opts.onToast('已标记解决，本轮不再作为上下文');
        render();
        renderRecords();
      });

      bar.append(ask, saveBtn, resolveBtn, skipBtn);
      return bar;
    }
