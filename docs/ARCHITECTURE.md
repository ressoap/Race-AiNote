# 问墨笔记 · 架构说明

## 1. 设计约束

| 约束 | 原因 |
| --- | --- |
| 零第三方运行时依赖 | 评委双击就跑，不需要 `npm install`，也不会半年后因为依赖升级跑不起来 |
| 数据层纯函数、无 DOM | 能在 Node 里直接跑单测，也能被 AI 脚本复用 |
| 初始布局确定性（哈希，不用随机数） | 「重新布局」可复现，录像、截图、单测才有意义 |
| 单文件交付由构建脚本产生 | 源码可读、交付可跑，两者不手工同步 |
| AI 能力默认放服务端；学科/知识点分类走 `/api/analyze`，失败时客户端本地兜底 | 纯前端打包后密钥明文可见；浏览器直连只作为可选降级项 |
| 本地服务默认只绑 127.0.0.1 | 不把 AI 代理、记录接口和源码目录暴露给局域网 |

## 2. 分层

```
数据层      js/vault.js       Markdown → 图模型（notes / attachments / unresolved / tag 节点 + links）
            js/query.js       Obsidian 风格查询 → 匹配函数
            js/markdown.js    轻量 Markdown 渲染
            js/richtext.js    富文本 ⇄ Markdown 转换

仿真/渲染   js/physics.js     图模型 → 位置（排斥 / 弹簧 / 中心引力 / 网格碰撞）
            js/render.js      位置 → Canvas 像素（纯绘制，不碰数据）

界面层      js/app/*.js       源码片段，构建成 js/app.js
            js/ai/*.js        AI 面板源码片段，构建成 js/ai.js
            js/store.js       本地存储统一入口 + schema 迁移
            js/cloud.js       云备份驱动
            js/plugins.js     插件宿主

服务端      scripts/server-core.cjs   静态资源 + AI / 网盘 / 记录接口的唯一实现
            （/api/chat 支持文本模型 + 可选视觉模型；/api/analyze 负责学科与知识点标签）
            scripts/serve.mjs         开发入口（读 .env、解析参数、启动）
            scripts/desktop.js        桌面窗口启动器
            scripts/build-exe.js      Node SEA 单文件 exe
            scripts/build-electron.js Electron 打包
```

依赖方向保持单向：`app → render/physics/query/vault`，下层不反向依赖上层，
也不依赖 DOM（`render.js` 只要求传入 `CanvasRenderingContext2D`）。

## 3. 数据流

```
File API / 拖放 / 内置示例
        ↓ {path, content}
   vault.buildVault()        ← frontmatter / [[双链]] / #标签 / 附件
        ↓ nodes + links（含未创建链接、标签派生节点）
   filterGraph()             ← 类型筛选 → 局部 BFS → 孤立筛选 → 查询过滤
        ↓
   physics.createSimulation() ← 哈希种子 + 力导向 tick
        ↓ 每帧
   render.draw()             ← 高亮集 / 颜色分组 / 标签避让
```

任何一步都是纯数据变换，因此每一步都能单独写断言：

- 解析层：给定两份 Markdown，断言节点数、连线数、未创建链接数；
- 查询层：给定一个节点与一个表达式，断言布尔值；
- 物理层：给定初值跑 N 个 tick，断言距离、边界、无 NaN。

## 4. 源码拆分与构建链

`app.js` 和 `ai.js` 原先各是一个 1000～2600 行的大 IIFE。为了先降低单文件查找成本，
现在把源码按功能拆成片段，由构建脚本按文件名顺序拼接：

- `js/app/*.js` → `js/app.js`（`scripts/build-app.js`）
- `js/ai/*.js` → `js/ai.js`（`scripts/build-ai.js`）

这一步是**纯搬运**：片段仍然共享同一个 IIFE 闭包，行为、测试和单文件构建都不变。
后续若要继续提升模块化，可逐步引入显式 `ctx` / store，再把闭包依赖改成接口调用。

交付链：

```
源码
  ├─ build-app + build-ai + build.js → dist/Wenmo-Notes.html
  ├─ build-exe.js                    → dist/Wenmo-Notes.exe（Node SEA）
  └─ build-electron.js               → dist/Wenmo-Notes-Electron/
```

`serve.mjs`、SEA exe、Electron 三端共用 `server-core.cjs`，不再各自复制一份服务端逻辑。

## 5. 安全边界

- 本地服务默认 `listen(PORT, '127.0.0.1')`，不监听局域网地址；
- 静态资源白名单：只开放 `index.html`、`styles.css`、`js/**/*.js`；
  `.env`、`.git`、`data/`、`_tmp/`、`node_modules/` 一律 404；
- API 请求校验 Host 与 Origin，只接受本机页面；POST 还要求 `Content-Type: application/json`；
- AI Key 默认从 `COMMAND_CODE_API_KEY` / `AI_API_KEY` 读取，只在服务端内存中使用；
- `.gitignore` 覆盖 `.env*`、`*.pem`、`*.key`、`secrets/`、`credentials*.json`；
- 插件代码以页面权限运行，宿主只提供受控 API，但**不是安全沙箱**，只安装可信插件。

## 6. 本地存储与迁移

`js/store.js` 统一管理键名和 schema 版本：

- `race-ainote:settings`、`race-ainote:vault`、`race-ainote:records` 等；
  前缀暂时保留 `race-ainote:`，用于兼容旧版 localStorage 数据；
- 旧版键（`race-ainote:v1`、`race-ainote:mistakes`、`race-ainote:plugin:*`）
  在启动时迁移到新键并删除旧键，避免凭据和笔记各存两份；
- 当前 schema 版本为 2；后续结构变更在 `MIGRATIONS` 中追加迁移函数。

## 7. 测试策略

- Node 原生单测覆盖解析 / 查询 / 物理 / Markdown / 富文本 / 插件 / 云同步 /
  本地服务安全 / store 迁移；
- 本地服务测试覆盖静态白名单、Host/Origin 校验、JSON Content-Type 和百度网盘上传；
- jsdom 冒烟测试加载源码与构建产物，断言新建/重命名/删除、记录、插件、快捷键等关键流程；
- 冒烟测试现在会在关键断言失败时以非零码退出，不再只打印日志。

## 8. 已知限制

- `app.js` / `ai.js` 的片段仍共享闭包，模块边界是物理拆分，不是运行时隔离；
- 插件没有沙箱，第三方插件等同于页面脚本；
- 浏览器里改的笔记只写 localStorage 缓存，写回磁盘仍靠 `Ctrl+S` 下载；
- 全局排斥力仍是 O(n²)，1000+ 节点需要 Barnes-Hut 或更激进的渲染裁剪；
- 浏览器直连 AI 模式受服务商 CORS 限制，且 Key 会留在本机 localStorage，默认不推荐。
