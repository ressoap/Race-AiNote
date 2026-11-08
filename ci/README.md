# CI 配置（暂存位置）

`ci/github-actions.yml` 就是 GitHub Actions 的流水线定义，
暂时没有放在 `.github/workflows/ci.yml`，原因是推送所用的 GitHub 凭据缺少 `workflow` 权限。

授权后启用（二选一）：

1. **重新授权**：用带 `workflow` scope 的 PAT，或在本机重新登录 Git Credential Manager，
   然后执行：
   ```bash
   mkdir -p .github/workflows
   git mv ci/github-actions.yml .github/workflows/ci.yml
   git commit -m "ci: 启用 GitHub Actions"
   git push github main
   ```

2. **网页创建**：在 GitHub 网页上手动新建 `.github/workflows/ci.yml`，把本文件内容粘进去。

Gitee 侧对应的是「Gitee Go」流水线，命令同样是 `npm test` → `npm run build`。
