  /* ── 主题与背景色 ───────────────────────────────────────── */
  const BG_PRESETS = [
    { id: 'default', label: '默认', light: '#fbfbfd', dark: '#17181c' },
    { id: 'paper', label: '米纸', light: '#f7f1e6', dark: '#221f19' },
    { id: 'mint', label: '护眼', light: '#e8f1e6', dark: '#1b2019' },
    { id: 'blue', label: '淡蓝', light: '#e9eef9', dark: '#161b26' },
    { id: 'graphite', label: '石墨', light: '#ececee', dark: '#101114' }
  ];

  const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function resolveTheme() {
    const mode = settings.themeMode || 'system';
    if (mode === 'system') return systemDark && systemDark.matches ? 'dark' : 'light';
    return mode === 'dark' ? 'dark' : 'light';
  }

  function applyTheme() {
    state.theme = resolveTheme();
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dataset.bg = settings.bgPreset || 'default';
    state.dirty = true;
    updateThemeButton();
    try { store.set('theme', settings.themeMode || 'system'); } catch (_) {}
  }

  function updateThemeButton() {
    const btn = $('#btn-theme');
    if (!btn) return;
    const mode = settings.themeMode || 'system';
    const label = mode === 'system' ? '跟随系统' : (mode === 'dark' ? '黑夜' : '白日');
    btn.title = '主题：' + label + '（点击切换）';
    btn.classList.toggle('is-active', mode !== 'system');
  }

  function cycleTheme() {
    const order = ['light', 'dark', 'system'];
    const idx = order.indexOf(settings.themeMode || 'system');
    settings.themeMode = order[(idx + 1) % order.length];
    saveSettings();
    applyTheme();
    toast('主题：' + (settings.themeMode === 'system' ? '跟随系统' : settings.themeMode === 'dark' ? '黑夜' : '白日'));
  }

  function renderBgSwatches() {
    const box = $('#bg-swatches');
    if (!box) return;
    box.innerHTML = '';
    for (const preset of BG_PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'bg-swatch' + ((settings.bgPreset || 'default') === preset.id ? ' is-active' : '');
      btn.style.background = state.theme === 'dark' ? preset.dark : preset.light;
      btn.title = preset.label;
      const label = document.createElement('span');
      label.textContent = preset.label;
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        settings.bgPreset = preset.id;
        saveSettings();
        applyTheme();
        renderBgSwatches();
        toast('背景色：' + preset.label);
      });
      box.appendChild(btn);
    }
  }

  /* ── 云同步 ─────────────────────────────────────────────── */
  const cloud = RG.cloud;
  let cloudConfig = cloud.loadConfig();

  const CLOUD_FIELDS = {
    github: [
      { key: 'token', label: 'Token', type: 'password', placeholder: 'ghp_…（需 repo 权限）' },
      { key: 'owner', label: '用户名', type: 'text', placeholder: 'ressoap' },
      { key: 'repo', label: '仓库', type: 'text', placeholder: 'wenmo-notes' },
      { key: 'branch', label: '分支', type: 'text', placeholder: 'main' },
      { key: 'path', label: '文件路径', type: 'text', placeholder: 'wenmo-notes-backup.json' }
    ],
    gitee: [
      { key: 'token', label: '私人令牌', type: 'password', placeholder: '需 projects 权限' },
      { key: 'owner', label: '用户名', type: 'text', placeholder: 'ressoap' },
      { key: 'repo', label: '仓库', type: 'text', placeholder: 'wenmo-notes' },
      { key: 'branch', label: '分支', type: 'text', placeholder: 'master' },
      { key: 'path', label: '文件路径', type: 'text', placeholder: 'wenmo-notes-backup.json' }
    ],
    baidu: [
      { key: 'accessToken', label: 'access_token', type: 'password', placeholder: '百度网盘开放平台授权后获得' },
      { key: 'path', label: '网盘路径', type: 'text', placeholder: '/apps/wenmo-notes/backup.json' }
    ]
  };

  const CLOUD_HINTS = {
    github: '用官方 Contents API：填一个有 repo 权限的 token 即可，备份文件会作为普通提交写进仓库。',
    gitee: '用官方 OpenAPI v5：私人令牌需要 projects 权限，更新时自动带上文件 sha。',
    baidu: '用官方 xpan 开放接口：需要先在百度网盘开放平台创建应用并完成 OAuth 授权拿到 access_token；上传经本地服务中转，避开浏览器跨域。'
  };

  function renderCloudFields() {
    const provider = $('#cloud-provider').value;
    const box = $('#cloud-fields');
    box.innerHTML = '';
    const defs = CLOUD_FIELDS[provider] || [];
    const values = cloudConfig[provider] || {};
    for (const def of defs) {
      const label = document.createElement('label');
      label.className = 'prefs-row';
      const name = document.createElement('span');
      name.textContent = def.label;
      const input = document.createElement('input');
      input.type = def.type;
      input.placeholder = def.placeholder;
      input.dataset.cloudKey = def.key;
      input.value = values[def.key] || '';
      if (def.type === 'password') input.autocomplete = 'off';
      label.append(name, input);
      box.appendChild(label);
    }
    $('#cloud-hint').textContent = CLOUD_HINTS[provider] || '';
    if (cloudConfig.lastSync) {
      const when = new Date(cloudConfig.lastSync.at);
      $('#cloud-status').textContent = '上次备份：' + when.toLocaleString('zh-CN') + '（' + cloudConfig.lastSync.provider + '）';
    } else {
      $('#cloud-status').textContent = '';
    }
  }

  function collectCloudConfig() {
    const provider = $('#cloud-provider').value;
    const values = Object.assign({}, cloudConfig[provider] || {});
    for (const input of $('#cloud-fields').querySelectorAll('[data-cloud-key]')) {
      values[input.dataset.cloudKey] = input.value.trim();
    }
    cloudConfig.provider = provider;
    cloudConfig[provider] = values;
    cloud.saveConfig(cloudConfig);
    return cloudConfig;
  }

  $('#cloud-provider').addEventListener('change', () => {
    cloudConfig.provider = $('#cloud-provider').value;
    cloud.saveConfig(cloudConfig);
    renderCloudFields();
  });

  $('#cloud-test').addEventListener('click', async () => {
    const status = $('#cloud-status');
    status.textContent = '测试中…';
    try {
      const message = await cloud.testConnection(collectCloudConfig());
      status.textContent = '✅ ' + message;
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  $('#cloud-backup').addEventListener('click', async () => {
    const status = $('#cloud-status');
    const cfg = collectCloudConfig();
    status.textContent = '备份中…';
    try {
      const result = await cloud.backup(cfg, state.files, state.vaultLabel);
      cloudConfig.lastSync = { at: result.at, provider: cfg.provider };
      cloud.saveConfig(cloudConfig);
      status.textContent = '✅ 已备份 ' + state.files.length + ' 个文件，' + Math.round(result.bytes / 1024) + ' KB';
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  $('#cloud-restore').addEventListener('click', async () => {
    const status = $('#cloud-status');
    const cfg = collectCloudConfig();
    const okRestore = await askConfirm({ title: '从云端恢复', message: '会用云端备份覆盖当前库（' + state.files.length + ' 个文件）。', okText: '覆盖恢复', danger: true });
    if (!okRestore) return;
    status.textContent = '恢复中…';
    try {
      const snapshot = await cloud.restore(cfg);
      const files = snapshot.files.map(f => ({ path: f.path, content: f.content }));
      loadFiles(files, (snapshot.vault || '云端备份') + ' · 恢复于 ' + new Date().toLocaleString('zh-CN'));
      status.textContent = '✅ 已恢复 ' + files.length + ' 篇笔记（备份时间 ' + new Date(snapshot.savedAt).toLocaleString('zh-CN') + '）';
      closePrefs();
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  /* ── 视图 / AI 面板 / 笔记按钮 ──────────────────────────── */
  $('#view-note').addEventListener('click', () => showView('note'));
  $('#view-graph').addEventListener('click', () => showView('graph'));
  $('#btn-note-edit').addEventListener('click', toggleEdit);
  $('#btn-note-graph').addEventListener('click', () => {
    if (!currentNoteId) return;
    showView('graph');
    focusNode(currentNoteId);
  });
  $('#btn-note-ai').addEventListener('click', () => {
    setAiPanel(true);
    const node = currentNote();
    ai.send(node ? '分析「' + node.title + '」的核心考点和易错点' : '这个笔记库的整体结构怎么样');
  });
  $('#btn-ai').addEventListener('click', () => setAiPanel($('#ai-panel').classList.contains('is-collapsed')));
  $('#btn-ai-close').addEventListener('click', () => setAiPanel(false));

  function setAiPanel(open) {
    $('#ai-panel').classList.toggle('is-collapsed', !open);
    document.querySelector('.workspace').classList.toggle('no-ai', !open);
    $('#btn-ai').classList.toggle('is-active', open);
    if (typeof syncSidebarWidth === 'function') syncSidebarWidth();
    resize();
    state.dirty = true;
  }

  /* ── 设置窗口（AI / 本地数据） ──────────────────────────── */
  const prefsModal = $('#prefs-modal');
  const teacherModal = $('#teacher-modal');

  const TEACHER_TRAIT_FIELDS = [
    { key: 'lively', id: 'teacher-lively', out: 'teacher-lively-value' },
    { key: 'detail', id: 'teacher-detail', out: 'teacher-detail-value' },
    { key: 'guidance', id: 'teacher-guidance', out: 'teacher-guidance-value' },
    { key: 'correction', id: 'teacher-correction', out: 'teacher-correction-value' }
  ];
  const TEACHER_PROFILE_TEMPLATE = [
    '1. 讲题前先问我卡在哪一步，不要直接报最终答案。',
    '2. 每道题先写考点，再给思路，最后一步一步推导。',
    '3. 我算错时先指出错在哪一行，不要只给正确答案。',
    '4. 条件不足时先追问，不要自行假设条件。',
    '5. 公式用纯文本 / Unicode，步骤之间留空行。'
  ].join('\n');

  function updateTeacherCount() {
    const profile = $('#teacher-profile');
    const count = $('#teacher-count');
    if (profile && count) count.textContent = profile.value.length + ' / 6000';
  }

  function markTeacherDirty() {
    const status = $('#teacher-status');
    if (status) status.textContent = '有未保存的修改';
  }

  function renderTeacherConfig(cfg) {
    const source = (cfg && cfg.teacherProfile) || '';
    const profile = $('#teacher-profile');
    if (profile) {
      profile.value = source;
    }
    const traits = RG.ai.normalizeTeacherTraits((cfg && cfg.teacherTraits) || {});
    for (const field of TEACHER_TRAIT_FIELDS) {
      const input = document.getElementById(field.id);
      const out = document.getElementById(field.out);
      if (input) input.value = String(traits[field.key]);
      if (out) out.textContent = String(traits[field.key]);
    }
    updateTeacherCount();
    const status = $('#teacher-status');
    if (status) status.textContent = '';
  }

  function restoreTeacherDefaults() {
    const profile = $('#teacher-profile');
    if (profile) profile.value = '';
    const traits = RG.ai.DEFAULT_TEACHER_TRAITS;
    for (const field of TEACHER_TRAIT_FIELDS) {
      const input = document.getElementById(field.id);
      const out = document.getElementById(field.out);
      if (input) input.value = String(traits[field.key]);
      if (out) out.textContent = String(traits[field.key]);
    }
    updateTeacherCount();
  }

  function readTeacherConfig() {
    const profile = $('#teacher-profile');
    const traits = {};
    for (const field of TEACHER_TRAIT_FIELDS) {
      const input = document.getElementById(field.id);
      const n = Number(input && input.value);
      traits[field.key] = Number.isFinite(n) ? n : RG.ai.DEFAULT_TEACHER_TRAITS[field.key];
    }
    return {
      teacherProfile: String(profile ? profile.value : '').slice(0, 6000),
      teacherTraits: RG.ai.normalizeTeacherTraits(traits)
    };
  }

  function readTextFile(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取失败'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsText(file);
    });
  }

  function openTeacher() {
    renderTeacherConfig(ai.state.config);
    if (teacherModal) teacherModal.hidden = false;
    const btn = $('#btn-teacher');
    if (btn) btn.classList.add('is-active');
  }

  function closeTeacher() {
    if (teacherModal) teacherModal.hidden = true;
    const btn = $('#btn-teacher');
    if (btn) btn.classList.remove('is-active');
  }

  function openPrefs() {
    const cfg = ai.state.config;
    $('#prefs-mode').value = cfg.mode || 'proxy';
    $('#prefs-baseurl').value = cfg.baseUrl || '';
    $('#prefs-model').value = cfg.model || '';
    $('#prefs-vision-model').value = cfg.visionModel || '';
    $('#prefs-key').value = cfg.key || '';
    $('#prefs-ai-format').checked = Boolean(cfg.aiFormatModel);
    $('#prefs-model-status').textContent = '';
    $('#prefs-vault').textContent = state.vaultLabel || '—';
    $('#prefs-theme').value = settings.themeMode || 'system';
    renderBgSwatches();
    $('#cloud-provider').value = cloudConfig.provider || 'github';
    renderCloudFields();
    const listEl = $('#prefs-model-list');
    if (listEl && !listEl.children.length) {
      const cached = (ai.state.models || []).slice(0, 50);
      for (const id of cached) { const o = document.createElement('option'); o.value = id; listEl.appendChild(o); }
    }
    $('#prefs-status').textContent = ai.state.mode === 'local' ? '当前：本地分析模式' : '当前：' + (ai.state.mode === 'direct' ? '直连模式' : '代理模式');
    prefsModal.hidden = false;
    syncKeyRow();
  }

  function closePrefs() { prefsModal.hidden = true; }

  function syncKeyRow() {
    const mode = $('#prefs-mode').value;
    $('#prefs-key-row').hidden = mode !== 'direct';
  }

  $('#btn-prefs').addEventListener('click', openPrefs);
  $('#prefs-close').addEventListener('click', closePrefs);
  prefsModal.addEventListener('pointerdown', e => { if (e.target === prefsModal) closePrefs(); });
  const teacherBtn = $('#btn-teacher');
  if (teacherBtn) teacherBtn.addEventListener('click', openTeacher);
  const teacherClose = $('#teacher-close');
  if (teacherClose) teacherClose.addEventListener('click', closeTeacher);
  if (teacherModal) teacherModal.addEventListener('pointerdown', e => { if (e.target === teacherModal) closeTeacher(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && teacherModal && !teacherModal.hidden) closeTeacher();
  });
  $('#prefs-mode').addEventListener('change', syncKeyRow);
  $('#prefs-theme').addEventListener('change', e => {
    settings.themeMode = e.target.value;
    saveSettings();
    applyTheme();
    renderBgSwatches();
  });

  for (const field of TEACHER_TRAIT_FIELDS) {
    const input = document.getElementById(field.id);
    if (input) {
      input.addEventListener('input', () => {
        const out = document.getElementById(field.out);
        if (out) out.textContent = String(input.value);
        markTeacherDirty();
      });
    }
  }
  const teacherProfile = $('#teacher-profile');
  if (teacherProfile) {
    teacherProfile.addEventListener('input', () => { updateTeacherCount(); markTeacherDirty(); });
  }
  const teacherFile = $('#teacher-file');
  const teacherImport = $('#teacher-import');
  if (teacherImport && teacherFile) {
    teacherImport.addEventListener('click', () => teacherFile.click());
    teacherFile.addEventListener('change', async () => {
      const file = teacherFile.files && teacherFile.files[0];
      if (!file) return;
      const status = $('#teacher-status');
      if (status) status.textContent = '正在读取…';
      try {
        let text = await readTextFile(file);
        if (text.length > 6000) {
          text = text.slice(0, 6000);
          if (status) status.textContent = '文件较长，已截取前 6000 字';
        } else if (status) {
          status.textContent = '已载入 ' + file.name + '，点「保存性格」生效';
        }
        if (teacherProfile) teacherProfile.value = text;
        updateTeacherCount();
      } catch (err) {
        if (status) status.textContent = '读取失败：' + (err && err.message ? err.message : err);
      }
      teacherFile.value = '';
    });
  }
  const teacherTemplate = $('#teacher-template');
  if (teacherTemplate && teacherProfile) {
    teacherTemplate.addEventListener('click', () => {
      teacherProfile.value = TEACHER_PROFILE_TEMPLATE;
      updateTeacherCount();
      markTeacherDirty();
    });
  }
  const teacherClear = $('#teacher-clear');
  if (teacherClear && teacherProfile) {
    teacherClear.addEventListener('click', () => {
      teacherProfile.value = '';
      updateTeacherCount();
      markTeacherDirty();
    });
  }
  const teacherReset = $('#teacher-reset');
  if (teacherReset) {
    teacherReset.addEventListener('click', async () => {
      const ok = await askConfirm({
        title: '恢复默认性格',
        message: '会清空自定义讲课方式，并把四根滑杆恢复到默认值。',
        okText: '恢复',
        danger: true
      });
      if (!ok) return;
      restoreTeacherDefaults();
      const status = $('#teacher-status');
      if (status) status.textContent = '正在恢复…';
      await ai.applyConfig(readTeacherConfig());
      if (status) status.textContent = '已恢复默认性格';
      toast('已恢复默认性格');
    });
  }
  const teacherSave = $('#teacher-save');
  if (teacherSave) {
    teacherSave.addEventListener('click', async () => {
      const status = $('#teacher-status');
      if (status) status.textContent = '保存中…';
      await ai.applyConfig(readTeacherConfig());
      if (status) status.textContent = ai.state.mode === 'local' ? '已保存；接入模型后生效' : '已保存老师性格';
      toast('老师性格已保存');
    });
  }
  $('#prefs-open-folder').addEventListener('click', () => { closePrefs(); openViaPicker(); });

  $('#prefs-save').addEventListener('click', async () => {
    const patch = {
      mode: $('#prefs-mode').value,
      baseUrl: $('#prefs-baseurl').value.trim(),
      model: $('#prefs-model').value.trim(),
      visionModel: $('#prefs-vision-model').value.trim(),
      key: $('#prefs-key').value.trim(),
      aiFormatModel: $('#prefs-ai-format').checked
    };
    const mode = await ai.applyConfig(patch);
    $('#prefs-status').textContent = '已保存 · 当前模式：' + (mode === 'local' ? '本地分析' : mode === 'direct' ? '直连' : '代理');
    toast(mode === 'direct' ? '设置已保存（直连模式的 Key 只存在本机浏览器）' : '设置已保存（代理模式不保存 Key）');
  });

  $('#prefs-models').addEventListener('click', async () => {
    const statusEl = $('#prefs-model-status');
    statusEl.textContent = '拉取中…';
    const result = await ai.fetchModels({
      mode: $('#prefs-mode').value,
      baseUrl: $('#prefs-baseurl').value.trim(),
      model: $('#prefs-model').value.trim(),
      key: $('#prefs-key').value.trim()
    });
    if (!result.ok) { statusEl.textContent = '❌ ' + result.message; return; }
    const list = $('#prefs-model-list');
    list.innerHTML = '';
    for (const id of result.models) {
      const opt = document.createElement('option');
      opt.value = id;
      list.appendChild(opt);
    }
    statusEl.textContent = '✅ ' + result.message + '（点输入框可选）';
    if (!$('#prefs-model').value.trim() && result.models.length) {
      $('#prefs-model').value = result.models[0];
    }
  });

  $('#prefs-test').addEventListener('click', async () => {
    $('#prefs-status').textContent = '测试中…';
    const result = await ai.testConnection({
      mode: $('#prefs-mode').value,
      baseUrl: $('#prefs-baseurl').value.trim(),
      model: $('#prefs-model').value.trim(),
      key: $('#prefs-key').value.trim()
    });
    $('#prefs-status').textContent = (result.ok ? '✅ ' : '❌ ') + result.message;
  });

  $('#prefs-clear-key').addEventListener('click', () => {
    $('#prefs-key').value = '';
    ai.applyConfig({ key: '' });
    $('#prefs-status').textContent = '已清除 Key，回到本地分析模式';
  });

  $('#prefs-reset').addEventListener('click', () => {
    ai.clearConfig();
    store.resetAll();
    toast('已重置本地设置，即将刷新');
    setTimeout(() => location.reload(), 600);
  });

  /* AI 人设切换：答疑老师 / 笔记问答 */
  const SUGGEST = {
    tutor: [
      { label: '讲题', q: '这道题我不会做，帮我一步步讲清楚' },
      { label: '为什么', q: '为什么这个公式的适用条件是这两个' },
      { label: '找错因', q: '我总在这一类题上出错，帮我找原因' },
      { label: '举个例子', q: '用一个生活里的例子解释这个概念' }
    ],
    notes: [
      { label: '核心考点', q: '这篇笔记的核心考点是什么？' },
      { label: '薄弱环节', q: '帮我找出薄弱环节并给出复习计划' },
      { label: '孤立笔记', q: '这个库里哪些笔记还没有被链接？' },
      { label: '知识卡', q: '把当前笔记整理成一张知识卡' }
    ]
  };
