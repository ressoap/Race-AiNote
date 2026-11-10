/* ============================================================
   sample-plugins.js — 内置示例插件（安装后可在设置里启用/卸载）
   每个插件的 code 都是字符串，宿主用 new Function 执行，
   只拿到受控的 api 对象。
   ============================================================ */
(function (root) {
  'use strict';

  const readingStats = [
    "// 阅读统计：在笔记底部显示字数、预计阅读时间、出链数",
    "api.addNoteFooterWidget({",
    "  id: 'reading-stats',",
    "  render: function (el, note) {",
    "    if (!note) return;",
    "    var text = String(note.content || '').replace(/\s+/g, '');",
    "    var words = text.length;",
    "    var minutes = Math.max(1, Math.round(words / 400));",
    "    var links = (note.links || []).length;",
    "    el.innerHTML = '';",
    "    var box = document.createElement('div');",
    "    box.className = 'plugin-widget';",
    "    box.textContent = '📖 ' + words + ' 字 · 约 ' + minutes + ' 分钟读完 · ' + links + ' 条出链';",
    "    el.appendChild(box);",
    "  }",
    "});",
    "api.registerCommand({",
    "  id: 'count-all',",
    "  title: '统计整个库的字数',",
    "  run: function () {",
    "    var notes = api.notes.list();",
    "    var total = notes.reduce(function (sum, n) { return sum + String(n.content || '').replace(/\s+/g, '').length; }, 0);",
    "    api.toast('全库 ' + notes.length + ' 篇，共 ' + total + ' 字');",
    "  }",
    "});"
  ].join('\n');

  const quickSummary = [
    "// 一键摘要：工具栏按钮，把当前笔记丢给 AI 总结",
    "api.addToolbarButton({",
    "  id: 'summary',",
    "  label: '摘要',",
    "  title: '让 AI 总结当前笔记',",
    "  onClick: function () {",
    "    var note = api.notes.current();",
    "    if (!note) return api.toast('先打开一篇笔记');",
    "    api.ai.ask('用三句话总结这篇笔记，并指出它还缺什么：' + note.title);",
    "  }",
    "});",
    "api.on('note:open', function (payload) {",
    "  if (payload && payload.note) api.log('打开笔记：' + payload.note.title);",
    "});"
  ].join('\n');

  const pomodoro = [
    "// 番茄钟：工具栏按钮，25 分钟后提醒你休息",
    "var timer = null;",
    "api.addToolbarButton({",
    "  id: 'pomodoro',",
    "  label: '番茄钟',",
    "  title: '开始 / 停止 25 分钟专注',",
    "  onClick: function () {",
    "    if (timer) { clearTimeout(timer); timer = null; api.toast('已停止计时'); return; }",
    "    api.toast('开始专注，25 分钟后提醒');",
    "    timer = setTimeout(function () { timer = null; api.toast('⏰ 25 分钟到，起来活动一下'); }, 25 * 60 * 1000);",
    "  }",
    "});"
  ].join('\n');

  root.RG = root.RG || {};
  root.RG.samplePlugins = [
    {
      id: 'reading-stats',
      name: '阅读统计',
      version: '1.0.0',
      description: '在笔记底部显示字数、预计阅读时间、出链数，并支持统计全库字数。',
      code: readingStats
    },
    {
      id: 'quick-summary',
      name: '一键摘要',
      version: '1.0.0',
      description: '工具栏加一个「摘要」按钮，点一下让 AI 总结当前笔记。',
      code: quickSummary
    },
    {
      id: 'pomodoro',
      name: '番茄钟',
      version: '1.0.0',
      description: '工具栏加一个 25 分钟专注计时器，结束提醒你休息。',
      code: pomodoro
    }
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
