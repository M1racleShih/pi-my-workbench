# 更新上游与发布套件

[返回 README](../README.md)

## 所有权

功能修改仍提交到对应的原仓库，不向本仓库复制源码。套件只选择已经发布到公开来源的版本，并验证组合兼容性。不能把某个工作树的未提交功能称为已锁定的上游版本。

## 更新步骤

1. 在原仓库完成修改、测试与提交/发布，确认目标 commit 或 npm 版本可公开获取。
2. 若本 checkout 有开发链接，先运行 `npm run dev -- status`，逐项 `reset`。不要直接对链接状态运行 `npm ci`。
3. 修改 `upstreams.json` 中的 commit / version，再同步 `package.json`。GitHub 源使用完整 commit 的公开 HTTPS 归档，不使用分支名，也不依赖 SSH 权限。例如：

   ```sh
   npm install --ignore-scripts --legacy-peer-deps --save-exact \
     'pi-hud=https://codeload.github.com/M1racleShih/pi-hud/tar.gz/<full-commit>'
   ```

4. 提交 npm 自动生成的 `package-lock.json`。归档依赖除 commit 外还有 tarball integrity；不要手写 integrity。
5. 运行 `npm ci --ignore-scripts --legacy-peer-deps`、`npm run verify` 和 `npm run package:check`。确认安装没有复制 Pi 宿主依赖到运行包，所有入口存在，过滤和 reload 测试通过。
6. 组合 UI 人工验收：HUD/footer、editor/header、模型选择与快捷键、`/clear`、恢复旧会话、`/reload`，以及与现用第三方 UI 的避让。不要为了验收向真实模型发送提示或查询账户，除非该次任务另有授权。
7. 更新套件版本和 CHANGELOG，提交并推送。GitHub Actions 在 Node 24 上运行测试；0.2.0 起最低 Node 版本为 24，不再宣称 Node 22 支持。使用者再明确升级套件。

`npm update` 或 `pi update --extensions` 不会把固定 commit 自动变成上游最新 commit。更改组合是套件自己的版本决策。

## 重要边界

- npm 上同名的 `pi-hud` 是另一个项目，不能据同名或同版本号替换这里的 GitHub 源。
- 本仓库 `private: true` 只阻止误发 npm，不表示 GitHub 仓库私有。
- `bundledDependencies` 使打包产物包含所需的五个依赖目录；Git 中不跟踪这些源码副本。GitHub 安装由 Pi 在 checkout 内安装运行依赖。
- 普通安装不包含开发依赖中的 Pi 测试宿主；Pi 自己提供运行时 API。`.npmrc` 禁止自动安装 peers，避免重复的宿主类或注册表。
- 只有候选版本经过验证才升级；无需 cherry-pick 上游代码。回退时选择旧套件 commit，再 reload / 重启，并保留用户配置。
- 测试通过不代表所有终端、输入法、剪贴板、额度服务和真实模型都已验收。
