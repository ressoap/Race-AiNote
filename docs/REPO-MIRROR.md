# 仓库托管：Gitee 主仓 + GitHub 镜像

赛题允许 GitHub 或 Gitee（须 Public 或提供评审访问权限）。
本项目的默认策略：**Gitee 作为主仓（国内评委访问快），GitHub 作为镜像（国际可见、Actions 可跑 CI）**。

## 1. 一次性配置双远程

```bash
cd Race-AiNote
# 主仓
git remote add gitee  git@gitee.com:<你的账号>/Race-AiNote.git
# 镜像
git remote add github git@github.com:<你的账号>/Race-AiNote.git

# 校验：应当看到两个远程
git remote -v
```

> 用 HTTPS 也行：`https://gitee.com/<账号>/Race-AiNote.git`。
> 凭据交给系统的凭据管理器（Windows 的「凭据管理器」/ Git Credential Manager），
> **不要**把 token 写进 remote URL，更不要提交到仓库。

## 2. 日常推送

```bash
git push gitee  main
git push github main
```

或者一条命令推两边：

```bash
git remote set-url --add --push origin git@gitee.com:<账号>/Race-AiNote.git
git remote set-url --add --push origin git@github.com:<账号>/Race-AiNote.git
git push origin main        # 一次推两个仓库
```

## 3. 常见坑

| 坑 | 说明 |
| --- | --- |
| 默认分支名不一致 | Gitee 新建仓库默认 `master`，GitHub 默认 `main`。统一改成 `main`，否则评委点进去看到空仓库 |
| Gitee 私有仓库 | 赛题要求 Public 或提供评审访问权限，建议直接 Public |
| 大文件 | 截图 ≤ 200 KB 没问题；演示视频不要进仓库，用外部链接 |
| 提交历史 | 两边都要保留完整历史，**不要**在 Gitee 用「导入仓库」再压缩成一次提交 |
| CI | `.github/workflows/ci.yml` 只在 GitHub 生效；Gitee 需另配「Gitee Go」流水线，命令相同（`npm test` → `npm run build`） |
| 凭据 | 任何 token / 密钥都不进仓库，`.gitignore` 已覆盖 `.env*`、`*.pem`、`*.key`、`secrets/` |
