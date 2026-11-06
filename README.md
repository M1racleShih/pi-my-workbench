# pi-my-workbench

一套统一安装、分模块维护的 [Pi](https://pi.dev/) 扩展组合。

**聚合安装和经过验证的版本，不合并上游源码。** 四个扩展继续在各自仓库开发和发布；本仓库只维护依赖、独立入口、两个自有模块及组合测试。

## 包含什么

| 模块 | 唯一源码来源 | 入口或开关 |
| --- | --- | --- |
| Provider Model Picker | [pi-provider-model-picker](https://github.com/M1racleShih/pi-provider-model-picker) | `/pm`；快捷键沿用上游 |
| Session Titler | [pi-session-titler](https://github.com/M1racleShih/pi-session-titler) | `--title-*` / `PI_TITLE_*` |
| HUD | [pi-hud](https://github.com/M1racleShih/pi-hud) | `/hud`；沿用 HUD 配置 |
| Block Editor | [pi-block-editor](https://github.com/M1racleShih/pi-block-editor) | `/block-editor`；含新会话欢迎页 |
| Clear | 本仓库 `extensions/clear.ts` | `/clear`：新建会话，保留模型和思考等级 |
| Model Overrides | 本仓库 `extensions/model-overrides.ts` | **默认关闭**；从当前 agent 目录读取个人模型配置 |

版本与来源见 [`upstreams.json`](upstreams.json)，完整安装锁见 `package-lock.json`。
前三项自研 UI 包中的 HUD、Block Editor、Picker 使用公开 GitHub 的完整 commit 归档 URL；Titler 使用精确 npm 版本。**npm 上同名 `pi-hud` 并非这里的 HUD，不要替换成裸 npm 包名。**

## 安装

需要 Node.js 22.19+。本版本以 Pi 1.5.0 验证，通过 GitHub 分发，暂不发布 npm。

```sh
pi install git:github.com/M1racleShih/pi-my-workbench
```

不指定 ref 会跟随本仓库默认分支。需要固定套件版本时，使用完整 commit：

```sh
pi install 'git:github.com/M1racleShih/pi-my-workbench@<full-commit>'
```

不要同时加载套件和对应的四个独立扩展、旧 `clear.ts` 或旧模型覆盖脚本。已有安装请先看 [迁移与回退](docs/MIGRATION.md)。安装和升级不会接管已有交互会话；完成后自行 `/reload` 或重启 Pi。

## 单独关闭一个模块

Pi 支持过滤包内资源，例如不加载 HUD：

```json
{
  "packages": [
    {
      "source": "git:github.com/M1racleShih/pi-my-workbench",
      "extensions": ["!node_modules/pi-hud/**"]
    }
  ]
}
```

其他依赖入口也位于 `node_modules/<package>/...`；自有模块位于 `extensions/`。可以使用 `pi config` 管理资源。

## 模型覆盖：默认不做任何事

只有当前 Pi agent 目录中的 `pi-my-workbench-models.json` 明确设置 `enabled: true` 才注册模型。默认原 Pi 路径为 `~/.pi/agent/pi-my-workbench-models.json`，切换 agent 目录后配置随之隔离。

```json
{
  "enabled": true,
  "providers": {
    "google": {
      "models": [{ "builtin": "google/gemini-3.1-pro-preview" }]
    }
  }
}
```

`models` 是**替换清单**，不是追加清单；`[]` 会清空该 provider 的扩展模型列表。每项可以是 `builtin` 引用或 Pi 接受的自定义模型定义。provider 级仅支持 `models`，不接管认证。文件缺失或 `enabled: false` 时零注册；文件错误会报告扩展加载错误，不静默忽略。

**此文件是个人配置，不要提交进仓库。** 套件不附带作者的模型选择、账户、端点覆盖或额度配置。

## 本地开发与上游更新

```sh
git clone https://github.com/M1racleShih/pi-my-workbench.git
cd pi-my-workbench
npm ci --ignore-scripts --legacy-peer-deps
npm run verify
npm run package:check
pi install "$PWD"
```

需要保留某个扩展的本地未提交功能时：

```sh
npm run dev -- use hud /path/to/pi-hud
npm run dev -- status
# 恢复套件固定版本
npm run dev -- reset hud
```

链接仅修改本 checkout 的 `node_modules` 和被忽略的 `.workbench/`，不会修改上游工作树。**更新依赖前先 reset 所有链接；发布检查拒绝活动开发链接。** 不在 Pi 管理的 Git 缓存中做开发覆盖，Pi 更新会清理该目录。

详见 [本地开发](docs/DEVELOPMENT.md) · [更新流程](docs/UPDATING.md)。

## 配置与请求边界

- 各上游原有配置文件、命令、环境变量和会话状态保持独立，不强行改成一份新配置。
- HUD 的额度查询、Titler 的自动标题保留原有开关。合包并不消除它们可能产生的网络或模型请求。
- 与 `pi-cc-extensions` 同用时，仍需为 footer、editor、欢迎页、`/clear`、`/context` 和补全分配所有权；套件不会重写其他插件配置。
- Subagents、Herdr、REA 和其他第三方扩展不在本套件范围内。
- 测试使用隔离 agent 目录和真实 Pi 资源 loader，不向模型发送提示，不查询账户额度，不启动外部服务。

## License

本仓库自有代码使用 [MIT](LICENSE)。依赖保留各自的许可证与声明，不把它们重新归属到本仓库。
