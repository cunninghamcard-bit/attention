# 路线图：attention Go 原生重写

- 依据：[RFC 0001](rfc/0001-go-native-plugin-browser.md)
- 更新：2026-10-26
- 原则：每个阶段结束时，都要有一个**能用的二进制**和**客观的完成标准**。下一个阶段只在上一个阶段的标准全部满足后开始。

## 总览

| 阶段 | 主题 | 产出 | 前置条件 |
|---|---|---|---|
| P0 | 地基 spike | 进程拓扑跑通：mygo、rutis-host、插件、CLI | — |
| P1 | 阅读核心 | 打开挂载根，在标签页里阅读 Markdown、代码、图片 | P0 |
| P2 | 索引与 CLI | 资源索引，搜索、反链；约 45 个 CLI 命令完成对齐 | P1 |
| P3 | 浏览器 | 网页标签页、历史、书签、阅读模式 | P1（可以和 P2 并行） |
| P4 | 工作台插件 | 终端、git、第三方插件通道 | P2 |
| P5 | 收尾 | 删除 Electron 和 TS，完成打包发布 | P2、P3、P4 |

```
P0 ──► P1 ──┬──► P2 ──► P4 ──┐
            └──► P3 ─────────┴──► P5
```

## P0：地基 spike

**目的**：验证 RFC §5.3 的进程拓扑，排除风险 R1，确定之后整个代码库的结构。

**范围**
- `native/` 目录下的 Go module。mygo 锁定 v0.6.4，rutis 锁定 0.16.0。
- `cmd/attention`：
  - 单实例锁，抢不到时作为 CLI 客户端运行；
  - 拉起 `rutis-host`；
  - 在 goroutine 里调用 `ServeArgs(dial:…)`；
  - 主线程运行 `App.Run()`；
  - 按顺序关停。
- 插件：`slots`、`layout`、`fs`、`files-ui`、`commands`、`cli`。
- 从 octogo 复制 `theme`、`kit`，以及 `keyboard` 的最小子集。
- CLI 命令：`version`、`files`。

**完成标准**
- [ ] 启动后显示一个窗口，左侧文件树列出 `--mount` 指定的目录。外部创建或删除文件后，界面在 1 秒内更新。
- [ ] `attention version` 和 `attention files` 在第二个进程里执行，输出正确。
- [ ] 关闭窗口后，rutis-host 和所有插件进程在关停期限内退出，没有残留进程。
- [ ] 把 `fs` 插件改成独立进程运行，功能不变。这证明服务插件放在本体内或外置都一样。
- [ ] 外置的 `fs` 在 `rutis-host dev` 下修改后自动重载，`files-ui` 能挂起后恢复，界面没有崩溃。（编译进本体的插件，重载时整个 attention runtime 都要重启，所以热重载只对外置插件有要求。）
- [ ] 记录启动时间、常驻内存、二进制体积，以及 rutis-host 的体积。
- [ ] 写出 spike 报告 `docs/rfc/0001-spike-report.md`，结论只能是「拓扑成立」或「启用 R1 的某个退路」。

**不做**：标签页、viewer、索引。

## P1：阅读核心

**目的**：成为一个可以日常使用的本地资料阅读器。

**范围**
- 插件：`navigation`、`tabs`（多标签页，可以分屏）、`viewer-markdown`、`viewer-code`、`viewer-image`、`palette`（命令面板，以及按文件名的快速切换）。
- 挂载：Home 加多个仓库，语义与 `mount/` 一致；挂载列表持久化到配置主目录。
- 标签页和分屏的布局状态，在重启后恢复。
- 实测 `ui/markdown` 对 wikilink、嵌入、callout 的支持情况（风险 R6）。

**完成标准**
- [ ] 能打开一个约 2 万个文件的目录：文件树可以流畅滚动，打开文件的中位耗时不超过 50ms（原 TS 版本是 32ms，作为参照）。
- [ ] Markdown 能正确渲染 CommonMark、GFM 表格和任务列表；`[[wikilink]]` 能点击跳转。
- [ ] 代码文件只读查看，有语法高亮，`open line= to=` 能定位并选中指定的行。
- [ ] 文件在外部被修改后，已打开的标签页自动刷新，滚动位置保持不变。
- [ ] 重启后标签页、分屏和挂载都能恢复。
- [ ] 写一份 R6 的结论文档，说明 viewer-markdown 是否需要预处理，或者需要给 mygo 提 PR。

## P2：索引与 CLI 对齐

**目的**：建立资源模型的索引层；完成 CLI 对齐后，agent 就能通过 CLI 全面操控 attention。

**范围**
- 插件：`markdown-extract`、`index`、`search-ui`、`backlinks-ui`、`outline-ui`、`files`（CLI 的文件写入命令）。
- 按 RFC §5.7，把约 45 个 CLI 命令重新分配到各插件。
- 把 `scripts/e2e-cli.mjs` 改成驱动 Go 二进制。
- 确定 index 的存储方式（RFC 未决问题 5）。

**完成标准**
- [ ] CLI e2e 全部通过，输出与 TS 版逐字节一致；例外全部写在 `docs/cli-deviations.md` 里，并且每一条都有理由。
- [ ] 2 万文件规模下，首次建索引的耗时，以及单个文件变化后的增量更新耗时，都要记录。增量更新不超过 100ms。
- [ ] 反链、标签、属性、孤立文件等查询的结果，与 TS 版在同一个测试 vault 上一致。
- [ ] 每个插件都有 `rutistest` 测试。

## P3：浏览器

**目的**：完成从阅读器到浏览器的转变。

**范围**
- 插件：`web`（`https:` scheme、web viewer、地址栏）、`html-extract`、`history`、`bookmarks`。
- 阅读模式：用 `html-extract` 抽取正文，交给 `viewer-markdown` 原生排版。
- 网页之间的链接，以及网页与本地资源之间的链接，都进入索引，反链可以跨资源类型。
- CLI：`open url=…`、`read`（输出阅读模式抽取的正文），以及 `history`、`bookmarks` 系列命令。
- 确定正文抽取算法（RFC 未决问题 6）。

**完成标准**
- [ ] 多标签浏览网页：前进、后退、刷新、页内查找、下载都能用；原生弹层能正确盖在网页上面。
- [ ] 准备 20 个代表性网站（新闻、文档站、博客、GitHub 页面……），阅读模式的抽取成功率达到 80% 以上，结果写进测试 fixture。
- [ ] `attention read url=…` 输出干净的正文，agent 可以直接使用。
- [ ] 一篇本地笔记和一个网页引用同一个 URL 时，两边的反链都能看到对方。

## P4：工作台插件与第三方通道

**目的**：证明「一切皆插件」能走通：一个功能完整的双半插件，加上第三方插件的两条接入路径。

**范围**
- `terminal`：PTY 服务，UI 采用 mygo 的终端组件，或者自己封装 creack/pty。
- `git` 和 `git-ui`：按 RFC §5.4 设计。`git` 服务插件**必须能以独立进程运行**。提供 `git:` scheme、变更面板，diff 用 `ui/editor` 的 DiffView 显示。
- `webview-panel`：第三方 UI 的兜底方案。
- `attention build --with`：xcaddy 风格的重编译工具，至少能跑通一个示例插件。
- 写一份第三方服务插件示例，用 TS 或 Python 编写，演示「不用重新编译 attention 也能接入」。

**完成标准**
- [ ] git 服务插件以外部进程运行，并且能热重载；它崩溃时 git-ui 能挂起后恢复，主程序不受影响。
- [ ] 外部的 TS 或 Python 服务插件注册的命令，可以通过 CLI 调用。
- [ ] 用 `attention build --with ./examples/hello-ui` 生成的二进制，界面里出现示例插件的面板。

## P5：收尾

**范围**
- 删除 `apps/`、`packages/`、Node 的测试流程、`pnpm-lock.yaml`，以及 mise 里所有 Node 相关的配置。
- CI 改为 Go 流程：test、vet、一致性检查、CLI e2e、三个平台的构建。
- 打包：mygo 的分发流程（Linux 上是 tar.gz 和 deb），连同 rutis-host 一起发布；评估 AppImage。
- 重写 README、`docs/architecture.md`、`PROJECT_INDEX.md` 和 AGENTS.md。
- 评估 octogo 共享模块的抽取（RFC 未决问题 1）。

**完成标准**
- [ ] 仓库里没有 Node 依赖，CI 全绿。
- [ ] 在一台干净的 Linux 机器上，能从发布包安装并运行 P1 到 P4 的所有功能。

## 暂缓（需要另写 RFC）

- agent 接入：MCP 服务器、内置对话面板、页面操控（可信输入、会话隔离、CEF 评估）。
- 跨进程的声明式 UI 协议。
- 把 octogo 的 GitHub 功能接入为插件。
- 多窗口，以及 slot 的作用范围是否包含窗口。
