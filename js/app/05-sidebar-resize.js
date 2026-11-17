  /* ── 左侧栏：拖动右边缘调整宽度 ─────────────────────────── */
  const sidebarEl = $('.sidebar');
  const sidebarResizer = $('#sidebar-resizer');
  const DEFAULT_SIDEBAR_W = 268;
  const MIN_SIDEBAR_W = 190;
  const MAX_SIDEBAR_W = 520;
  let sidebarW = Number(store.get('sidebarWidth')) || DEFAULT_SIDEBAR_W;

  function sidebarMaxWidth() {
    const ai = $('#ai-panel');
    const aiOpen = ai && !ai.classList.contains('is-collapsed');
    const reserve = aiOpen ? 720 : 320;
    return Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, window.innerWidth - reserve));
  }

  function clampSidebarWidth(w) {
    return Math.max(MIN_SIDEBAR_W, Math.min(sidebarMaxWidth(), Math.round(Number(w) || DEFAULT_SIDEBAR_W)));
  }

  function sidebarAria(w) {
    if (!sidebarResizer) return;
    sidebarResizer.setAttribute('aria-valuenow', String(Math.round(w)));
    sidebarResizer.setAttribute('aria-valuemin', String(MIN_SIDEBAR_W));
    sidebarResizer.setAttribute('aria-valuemax', String(Math.round(sidebarMaxWidth())));
  }

  function applySidebarWidth(w, persist) {
    const next = clampSidebarWidth(w);
    document.documentElement.style.setProperty('--sidebar-w', next + 'px');
    sidebarW = next;
    sidebarAria(next);
    if (persist) store.set('sidebarWidth', next);
    return next;
  }

  /** 窗口变窄或打开 AI 面板后按当前可用空间收缩；不改用户记住的目标宽度。 */
  function syncSidebarWidth() {
    const next = clampSidebarWidth(sidebarW);
    document.documentElement.style.setProperty('--sidebar-w', next + 'px');
    sidebarAria(next);
  }

  function currentSidebarWidth() {
    const measured = sidebarEl && (sidebarEl.getBoundingClientRect().width || sidebarEl.offsetWidth);
    return measured || Math.min(sidebarW, sidebarMaxWidth());
  }

  if (sidebarEl && sidebarResizer) {
    let dragX = 0;
    let dragW = 0;
    let dragging = false;

    sidebarResizer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragging = true;
      dragX = e.clientX;
      dragW = currentSidebarWidth();
      try { sidebarResizer.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.classList.add('is-resizing-sidebar');
      e.preventDefault();
    });
    sidebarResizer.addEventListener('pointermove', e => {
      if (!dragging) return;
      applySidebarWidth(dragW + (e.clientX - dragX), false);
    });
    const stopSidebarDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing-sidebar');
      store.set('sidebarWidth', sidebarW);
    };
    sidebarResizer.addEventListener('pointerup', stopSidebarDrag);
    sidebarResizer.addEventListener('pointercancel', stopSidebarDrag);
    sidebarResizer.addEventListener('lostpointercapture', stopSidebarDrag);
    sidebarResizer.addEventListener('dblclick', () => applySidebarWidth(DEFAULT_SIDEBAR_W, true));
    sidebarResizer.addEventListener('keydown', e => {
      if (e.key === 'Home') {
        e.preventDefault();
        applySidebarWidth(DEFAULT_SIDEBAR_W, true);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -24 : 24;
      applySidebarWidth(currentSidebarWidth() + delta, true);
    });

    syncSidebarWidth();
    window.addEventListener('resize', syncSidebarWidth);
  }
