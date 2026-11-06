# 本地开发覆盖

[返回 README](../README.md)

在自己的开发 clone 中使用，不在 `~/.pi/agent/git/...` 等 Pi 管理的缓存目录中使用。后者可能在升级时执行清理。

## 使用

先安装固定依赖，再将某个模块指向其原工作树：

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run dev -- use hud /path/to/pi-hud
npm run dev -- use editor /path/to/pi-block-editor
npm run dev -- use picker /path/to/pi-provider-model-picker
npm run dev -- status
```

可用别名：`hud`、`editor`、`picker`、`titler`，也可使用完整包名。源目录必须在套件 checkout 之外，其 package name 和入口必须匹配。

工具将套件中已安装的固定依赖移到 `.workbench/pinned/`，再创建指向原工作树的依赖链接；路径记录在 `.workbench/overrides.json`。这两个位置都不进 Git 或发布白名单。**工具不会修改、reset、提交或发布原工作树。** 同一个 Pi 入口会加载被链接的真实源码，因此未提交功能可以继续使用。

恢复固定版本：

```sh
npm run dev -- reset hud
npm run dev -- reset editor
npm run dev -- reset picker
npm run dev -- status
```

## 更新和验证

- **运行 npm ci / 更新依赖之前，先 reset 全部开发链接。** npm 会替换 node_modules；不要把这一操作当作开发覆盖的无损切换工具。
- `npm test` 可以检查当前开发组合；`npm run verify`、`npm pack` 的正常 prepack 和 `npm run package:check` 会拒绝活动开发覆盖。发布必须验证固定版本，而不是把未提交工作树意外打包。
- 只使用受支持的打包命令；`--ignore-scripts` 会禁用 npm 生命周期，不能据绕过 prepack 的结果报告发布检查通过。
- 全局 Pi 只配置套件，不要另留同模块的本地包入口。扩展切换后自行 reload 或重启，工具不接管正在运行的终端。
- 如果 node_modules 或链接被外部工具改写，管理工具会拒绝覆盖。先保存 `.workbench/overrides.json` 中自己的路径，再人工核对固定依赖备份；不要对原工作树执行删除或重置。

## 测试覆盖范围

使用 Node 内置 test runner 和 Pi 1.5.0 的真实 DefaultResourceLoader：独立资源发现、命令/flag 数量、资源过滤、重复 reload、headless 生命周期、模型覆盖的默认关闭和错误边界，以及 `/clear` 的跨工厂恢复。开发链接测试使用临时伪包，检查往返恢复与上游不变。

测试不运行 agent turn，不发送 prompt，不查询额度或启动外部服务。原扩展的单元测试仍在各自仓库维护；这里验证组合与套件自有逻辑。
