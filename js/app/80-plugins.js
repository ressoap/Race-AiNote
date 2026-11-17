  function renderPluginUI() {
    // 1) 工具栏按钮
    const bar = $('#plugin-buttons');
    if (bar) {
      bar.innerHTML = '';
      for (const btn of pluginHost.toolbarButtons()) {
        const el = document.createElement('button');
        el.className = 'ghost-btn plugin-btn';
        el.textContent = btn.label;
        el.title = btn.title || btn.label;
        el.addEventListener('click', () => {
          try { btn.onClick(); } catch (err) { toast('插件出错：' + err.message); }
        });
        bar.appendChild(el);
      }
    }

    // 2) 命令菜单
    const menu = $('#plugin-menu');
    if (menu && menu.hidden) {
      menu.innerHTML = '';
      const cmds = pluginHost.commands();
      if (!cmds.length) {
        const empty = document.createElement('div');
        empty.className = 'plugin-menu-empty';
        empty.textContent = '还没有插件命令';
        menu.appendChild(empty);
      }
      for (const cmd of cmds) {
        const b = document.createElement('button');
        b.textContent = cmd.title;
        b.addEventListener('click', () => {
          menu.hidden = true;
          try { cmd.run(); } catch (err) { toast('插件出错：' + err.message); }
        });
        menu.appendChild(b);
      }
    }

    // 3) 设置里的插件列表
    const list = $('#plugin-list');
    if (list) {
      list.innerHTML = '';
      const plugins = pluginHost.list();
      if (!plugins.length) {
        const p = document.createElement('p');
        p.className = 'prefs-tip';
        p.textContent = '还没有安装插件。可以先点「安装示例插件」看看效果。';
        list.appendChild(p);
      }
      for (const plugin of plugins) {
        const row = document.createElement('div');
        row.className = 'plugin-row';
        const info = document.createElement('div');
        info.className = 'plugin-info';
        const name = document.createElement('div');
        name.className = 'plugin-name';
        name.textContent = plugin.name + ' v' + plugin.version;
        const desc = document.createElement('div');
        desc.className = 'plugin-desc';
        desc.textContent = plugin.description || '（无说明）';
        info.append(name, desc);

        const actions = document.createElement('div');
        actions.className = 'plugin-actions';
        const toggle = document.createElement('button');
        toggle.className = 'ghost-btn tiny';
        toggle.textContent = plugin.enabled ? '停用' : '启用';
        toggle.addEventListener('click', () => {
          const ok = pluginHost.setEnabled(plugin.id, !plugin.enabled);
          if (!ok) toast('插件启用失败，已回退为停用');
          renderPluginUI();
          refreshNoteWidgets();
        });
        const remove = document.createElement('button');
        remove.className = 'ghost-btn tiny';
        remove.textContent = '卸载';
        remove.addEventListener('click', async () => {
          const okRemove = await askConfirm({ title: '卸载插件', message: '确定卸载「' + plugin.name + '」？', okText: '卸载', danger: true });
          if (!okRemove) return;
          pluginHost.uninstall(plugin.id);
          renderPluginUI();
          refreshNoteWidgets();
          toast('已卸载 ' + plugin.name);
        });
        actions.append(toggle, remove);
        row.append(info, actions);
        list.appendChild(row);
      }
    }
  }

  /** 笔记底部的插件挂件 */
  function refreshNoteWidgets() {
    const box = $('#plugin-widgets');
    if (!box) return;
    box.innerHTML = '';
    const note = currentNote();
    for (const widget of pluginHost.footerWidgets()) {
      const slot = document.createElement('div');
      slot.className = 'plugin-widget-slot';
      box.appendChild(slot);
      try { widget.render(slot, note); } catch (err) { toast('插件挂件出错：' + err.message); }
    }
  }

  $('#btn-plugin-menu').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('#plugin-menu');
    if (!menu) return;
    const willOpen = menu.hidden;
    renderPluginUI();
    menu.hidden = !willOpen;
    if (!menu.hidden) {
      const rect = e.currentTarget.getBoundingClientRect();
      const width = menu.offsetWidth || 200;
      menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
      menu.style.top = (rect.bottom + 6) + 'px';
    }
  });
  document.addEventListener('mousedown', e => {
    const menu = $('#plugin-menu');
    if (menu && !menu.hidden && !e.target.closest('#plugin-menu') && !e.target.closest('#btn-plugin-menu')) menu.hidden = true;
  });

  /* 安装 / 卸载 / 示例 */
  $('#plugin-toggle-form').addEventListener('click', () => {
    const form = $('#plugin-form');
    form.hidden = !form.hidden;
  });

  $('#plugin-install').addEventListener('click', async () => {
    const status = $('#plugin-status');
    const name = $('#plugin-name').value.trim() || '未命名插件';
    const code = $('#plugin-code').value;
    if (!code.trim()) { status.textContent = '❌ 代码不能为空'; return; }
    const okInstall = await askConfirm({ title: '安装插件', message: '插件代码会以本页面权限运行，能读写你的笔记。确定安装「' + name + '」？', okText: '安装' });
    if (!okInstall) return;
    try {
      pluginHost.install({ name: name, version: $('#plugin-version').value.trim() || '1.0.0', code: code });
      status.textContent = '✅ 已安装并启用：' + name;
      $('#plugin-code').value = '';
      $('#plugin-name').value = '';
      renderPluginUI();
      refreshNoteWidgets();
    } catch (err) {
      status.textContent = '❌ ' + (err && err.message ? err.message : err);
    }
  });

  $('#plugin-fetch').addEventListener('click', async () => {
    const status = $('#plugin-status');
    const url = $('#plugin-url').value.trim();
    if (!url) { status.textContent = '请先填代码 URL'; return; }
    status.textContent = '拉取中…';
    try {
      const code = await pluginHost.fetchCode(url);
      $('#plugin-code').value = code;
      status.textContent = '✅ 已拉取 ' + code.length + ' 字符，确认后点「安装并启用」';
    } catch (err) {
      status.textContent = '❌ 拉取失败：' + (err && err.message ? err.message : err);
    }
  });

  $('#plugin-sample').addEventListener('click', () => {
    const samples = RG.samplePlugins || [];
    if (!samples.length) return toast('没有内置示例插件');
    for (const sample of samples) {
      try { pluginHost.install(sample); } catch (err) { toast('示例插件安装失败：' + err.message); }
    }
    renderPluginUI();
    refreshNoteWidgets();
    toast('已安装 ' + samples.length + ' 个示例插件');
  });
