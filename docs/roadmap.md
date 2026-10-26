# 路线图：attention Go 原生重写

- 依据：[RFC 0001](rfc/0001-go-native-plugin-browser.md)
- 更新：2026-10-26
- 原则：每个阶段结束时，都要有一个**能用的二进制**和**客观的完成标准**。下一个阶段只在上一个阶段的标准全部满足后开始。

## 总览

| 阶段 | 主题 | 产出 | 前置条件 |
|---|---|---|---|
| P0 | 地基 | P0a 拓扑 spike（已完成）；P0b 地基插件：窗口、文件树、CLI | — |
| P1 | 阅读核心 | 打开挂载根，在标签页里阅读 Markdown、代码、图片 | P0 |
| P2 | 索引与 CLI | 资源索引，搜索、反链；47 个 CLI 命令完成对齐 | P1 |
| P3 | 浏览器 | 网页标签页、历史、书签、阅读模式 | P1（可以和 P2 并行；跨类型反链那一条验收依赖 P2） |
| P4 | 工作台插件 | 终端、git、第三方插件通道 | P2 |
| P5 | 收尾 | 删除 Electron 和 TS，完成打包发布 | P2、P3、P4 |

```
P0 ──► P1 ──┬──► P2 ──► P4 ──┐
            └──► P3 ─────────┴──► P5
```

## P0：地基

**目的**：验证 RFC §5.3 的进程拓扑，排除风险 R1，然后用真正的插件结构搭起地基。

### P0a：拓扑 spike（已完成，2026-10-26）

代码在分支 `spike/p0-topology` 的 `native/`，报告在同一分支的 `docs/rfc/0001-spike-report.md`。结论：**拓扑成立**（Linux/Wayland，mygo v0.6.4，rutis 0.17.1）。

- [x] 启动器生成 `rutis.json` 并拉起 rutis-host；宿主用 `fd:3` 拉起 UI runtime；mygo 在主线程、`ServeArgs` 在 goroutine 上共存。
- [x] 同进程调用（`Local()` 为 true，每次约 0.45µs）、跨进程调用（每次约 0.15–0.25ms）、跨进程回调都能用。
- [x] 第二个进程里的 `attention version` 通过 CLI socket 拿到结果。
- [x] 关窗（UI runtime 给宿主发 SIGTERM）、Ctrl-C、`kill -9` 宿主三种退出方式，所有插件的清理都执行，没有残留进程；`kill -9` UI runtime 时由宿主重新拉起。
- [x] 外置插件热替换：换上新二进制、结束旧进程，宿主用新二进制重新拉起，依赖它的插件自动挂起再恢复，界面没有崩溃。
- [x] 启动到窗口打开 228–392ms；UI runtime 约 117MB，rutis-host 约 10.5MB；`attention` 22MB，`rutis-host` 20MB。

### P0b：地基插件

**范围**
- 前提：RFC §10 第 2 条（代码放在 `native/`）由用户确认。
- 把 spike 的 `cmd/attention` 改成正式版本（RFC §5.3）：
  - argv 三种模式：`--rutis-manifest`、rutis 通道、启动器；
  - 启动器用 `flock` 做单实例锁，fork rutis-host 并等待，把宿主的退出码转换后返回；拿不到锁时作为 CLI 客户端，socket 还没就绪时重试几秒；
  - UI runtime 忽略 SIGPIPE，关窗时给宿主发 SIGTERM，会话结束后调用 `App.Quit()`；
  - `rutis.json` 用 `binaries` 列出二进制，`restart: "on-failure"`，每个插件一行；监控宿主输出里的 `gave up`。
- 启动器参数 `--mount <目录>`（可以写多次）：写进 `project` 插件这一行的配置；不传时使用上次保存的挂载列表。
- 插件：`slots`、`resources`、`workspace`（先只有左侧 dock 和一个中间区域）、`fs`（监听用 fsnotify）、`project`、`file-tree-ui`、`actions`、`cli`（RFC §6）。
- 共享 UI：用 `git worktree` 把 attention-ui 钉在 `9cbbf61`，再 `replace`（RFC §5.12）。
- CLI 命令：`version`、`files`。
- `native/AGENTS.md`：写明 `native/` 遵循 octogo 的 `docs/STYLE.md`，根目录 AGENTS.md 里的 Obsidian 重建规则不适用于这里；写明插件规范：`ctx.Go` 的任务必须响应 ctx 取消（spike 发现 3）。

**完成标准**
- [ ] 启动后显示一个窗口，左侧文件树列出 `--mount` 指定的目录。外部创建或删除文件后，界面在 1 秒内更新。
- [ ] `attention version` 和 `attention files` 在第二个进程里执行。对同一个测试目录，`files` 的输出和 TS 版一致；不一致的地方写进 `docs/cli-deviations.md`。
- [ ] 同时启动两个 `attention`，只会出现一个窗口和一个 rutis-host，另一个作为客户端正常拿到输出或报错退出。
- [ ] spike 的五种退出方式在正式版本上重测，结果不能比 spike 差。
- [ ] `fs` 插件改成独立进程运行，功能不变；用 spike 的方式热替换它，`project` 和 `file-tree-ui` 挂起后能恢复。
- [ ] 每个服务插件都有 `rutistest` 测试。
- [ ] `native/` 自己的一致性检查（禁止硬编码颜色和尺寸）通过。

**不做**：tab type、navigation、索引。

## P1：阅读核心

**目的**：成为一个可以日常使用的本地资料阅读器。

**范围**
- 插件：`tab-types`、`navigation`、`settings`、`text-ui` / `markdown-ui` / `image-ui`、`palette-ui`（命令面板，以及按文件名的快速切换）。`workspace` 补全分屏、多个 dock 和布局历史（RFC §5.6、§5.7）。
- 挂载：Home 加多个仓库，语义与 `mount/` 一致；挂载列表持久化到配置主目录。
- 标签页和分屏的布局状态，在重启后恢复。
- 实测 `ui/markdown` 对 wikilink、嵌入、callout 的支持情况（风险 R6）。

**完成标准**
- [ ] 能打开一个约 2 万个文件的目录：文件树可以流畅滚动，打开文件的中位耗时不超过 50ms（原 TS 版本的 README 记录为 32ms，作为参照）。文件监听按 RFC R9 的策略只监听展开的目录，超过 inotify 上限时降级为手动刷新并提示，不能直接失败。
- [ ] Markdown 能正确渲染 CommonMark、GFM 表格和任务列表。
- [ ] R6 门禁：`ui/markdown` 本身不支持 `[[wikilink]]`、`![[embed]]` 和 callout。P1 要么通过预处理让 wikilink 可以点击跳转，要么写明降级方式（例如显示为普通文本）。这一条不阻塞「能日常阅读」。
- [ ] 代码文件只读查看，有语法高亮，`open line= to=` 能定位并选中指定的行。
- [ ] 文件在外部被修改后，已打开的标签页自动刷新，滚动位置保持不变。
- [ ] 重启后标签页、分屏和挂载都能恢复。
- [ ] 写一份 R6 的结论文档，说明 `markdown` tab type 是否需要预处理，或者需要给 mygo 提 PR。

## P2：索引与 CLI 对齐

**目的**：建立资源模型的索引层；完成 CLI 对齐后，agent 就能通过 CLI 全面操控 attention。

**范围**
- 插件：`extractors`、`markdown-extract`、`index`、`search-ui`、`backlinks-ui`、`outline-ui`；`fs` 补全 CLI 的文件类命令。
- 按 RFC §5.9，交付「47 个 CLI 命令 → 插件」的完整归属表，并逐个实现。
- 改造 `scripts/e2e-cli.mjs`：去掉写死的 `electron` 和 `out/desktop/main.cjs`，改为启动 Go 二进制，环境变量也相应调整。
- 确定 index 的存储方式（RFC 未决问题 5）。

**完成标准**
- [ ] CLI e2e 全部通过：socket 协议兼容；47 个命令的输出以 TS 版为基准逐条比对，不一致的全部写在 `docs/cli-deviations.md` 里，并且每一条都有理由。
- [ ] 2 万文件规模下，首次建索引的耗时，以及单个文件变化后的增量更新耗时，都要记录。增量更新不超过 100ms。
- [ ] 反链、标签、属性、孤立文件等查询的结果，与 TS 版在同一个测试 vault 上一致。
- [ ] 每个服务插件都有 `rutistest` 测试；UI 插件的界面用 mygo 的 UI 测试工具测试。

## P3：浏览器

**目的**：完成从阅读器到浏览器的转变。

**范围**
- 插件：`web-ui`（tab type `web`、地址栏、网页内容的读取、「页面加载完成」事件）、`html-extract`、`web-index`（把网页提交给 index，依赖 P2）、`history`、`bookmarks`。
- 每个 `web` 标签页的前进和后退走 WebView 引擎自己的历史（`Page.GoBack/GoForward`），和工作区的打开记录分开（RFC §5.6）。
- 阅读模式：`web-ui` 在页面加载后用 `Page.Eval` 取出 HTML，交给 `html-extract` 抽取正文，再用 `ui/markdown` 原生排版。
- 启用了 index 时，`web-ui` 把网页的抽取结果提交给 index，让网页之间、网页与本地资源之间的链接都进入链接图（依赖 P2）。
- CLI：打开网页继续用已有的 `web url=…`；新增 `web:read url=…`（输出阅读模式抽取的正文；不能复用已有的 `read`），以及 `history`、`bookmarks` 系列命令。
- 确定正文抽取算法（RFC 未决问题 6）。

**完成标准**
- [ ] 多标签浏览网页：前进、后退、刷新、页内查找、下载都能用；原生弹层能正确盖在网页上面。
- [ ] P3 开始时先提交一份 20 个代表性网站的名单（新闻、文档站、博客、GitHub 页面……），每个网站附上人工确认过的期望正文；阅读模式对这份名单的抽取成功率达到 80% 以上。
- [ ] `attention web:read url=…` 输出干净的正文，agent 可以直接使用。
- [ ] （P2 完成后验收）一篇本地笔记和一个网页引用同一个 URL 时，两边的反链都能看到对方。

## P4：工作台插件与第三方通道

**目的**：证明「一切皆插件」能走通：一个功能完整的双半插件，加上第三方插件的两条接入路径。

**范围**
- `terminal` 和 `terminal-ui`：优先使用 mygo 官方的 `plugins/terminal`（自带 PTY，界面是原生的）；如果它不能满足插件化的拆分，再考虑自己封装 PTY。
- `git` 和 `git-ui`：按 RFC §5.4 设计。`git` 服务插件**必须能以独立进程运行**。提供 `git` 资源协议（`attention-resource://git/…`）、变更面板，diff 用 `ui/editor` 的 DiffView 显示。
- `webview-panel-ui`：第三方 UI 的兜底方案。
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
- 打包：mygo 的分发流程（Linux 上是 tar.gz 和 deb），连同 rutis-host 一起发布。AppImage 不是 mygo 的产物，需要的话单独评估。
- 重写 README、`docs/architecture.md`、`PROJECT_INDEX.md`、AGENTS.md 和 CLAUDE.md，删除所有 Obsidian 重建相关的规则和样式文档。

**完成标准**
- [ ] 仓库里没有 Node 依赖，CI 全绿。
- [ ] 在一台干净的 Linux 机器上，能从发布包安装并运行 P1 到 P4 的所有功能。

## 暂缓（需要另写 RFC）

- agent 接入：MCP 服务器、内置对话面板、页面操控（可信输入、会话隔离、CEF 评估）。
- 跨进程的声明式 UI 协议。
- 把 octogo 的 GitHub 功能接入为插件。
- 多窗口，以及 slot 的作用范围是否包含窗口。
