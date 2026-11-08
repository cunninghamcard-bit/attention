## B2 rutis 与集成方向

### 核心概念

**rutis**：以 Cordis 生命周期模型为基础的插件运行时，Rust 核心，插件可用 TypeScript、Python、Go、Swift 编写。
**Fiber**：生命周期容器，六个状态（Pending、Loading、Active、Failed、Unloading、Disposed），带依赖门控与级联卸载。
**rows（行）**：rutis-loader 中声明式管理的单位，loader 驱动运行中的 fiber 树朝有序 patch 层收敛。
**Session / Channel**：rutis-bridge 中跨进程、跨机器的会话与连接，Channel 含 pipe、websocket、memory 三种。
**rutis-host**：Rust 宿主二进制，按 rutis.json 管理运行时与连接行（dial、listen、spawn）。
**manifest**：Go 插件经 `--rutis-manifest` 输出的自描述信息，宿主据此路由，无需启动进程。
**ENDPOINT_PROTOCOL**：会话协议版本的单一整数，决定 WebSocket 子协议 `rutis.<n>`，与插件 API 版本 PLUGIN_API 分开。
**dim App Server**：dim 的 Rust 守护进程，对外是自有的 `/ws` 协议与本地 NDJSON socket。
**actions.Register**：attention 的扩展点，外部插件借此注册带 CLI 标记的命令。

### 关键事实

**rutis 核心与 Go 绑定**
- 核心 crate 运行时依赖为七个：tokio、tokio-util、thiserror、serde、serde_json、erased-serde、rutis-macros；后两者属于核心 crate，不属于 bridge（抽查更正）。~/Projects/rutis/crates/rutis/Cargo.toml:13-21
- 事件总线五种模式：emit、parallel、serial、waterfall、bail。~/Projects/rutis/docs/guide/plugin-api.en.md
- 清理严格 LIFO 串行，是相对 Cordis 的刻意加强。~/Projects/rutis/docs/core-features.en.md:82
- Go 模块 `github.com/arcships/rutis/go/rutis`，go 指令 1.24。「仅标准库」只见于设计文档 D17，go.mod 未核实。~/Projects/rutis/go/rutis/go.mod:1-3
- Go 公开 API 只有插件端：advanced 段的 ServeConn、ServeArgs；rutistest 的 Load 需要 rutis-host test。Go 进程本身不是 rutis 宿主（推断）。~/Projects/rutis/go/rutis/public-api.txt
- `on-demand`、`idle 60` 只出现在 config.rs 的文档示例中，不是默认值；attention 实际用 `eager`。~/Projects/rutis/crates/rutis-host/src/config.rs:10
- Go 服务方法默认 async；跨运行时的同步等待循环会被检测并拒绝（ErrSyncWaitCycle）。~/Projects/rutis/docs/design-go-runtime-2026-10-10.en.md D12、§7
- 跨语言同步调用约 30 µs（Node 侧测得）。~/Projects/rutis/README.md「Trade-offs」
- 平台要求：核心 Rust 1.88+；Node 22+、Bun 1.4+、Python 3.12+；Go 1.24+；Swift 仅 macOS 14+。~/Projects/rutis/README.md「Platforms and status」
- 宿主侧指南只有 Rust 嵌入（open-host），没有 Go host 指南。~/Projects/rutis/docs/guide/open-host.en.md

**版本与兼容**
- 最新正式 tag 为 v0.19.3（2026-10-31），所有包共用版本号。~/Projects/rutis/CHANGELOG.md；`git tag`
- attention 的 `native/go.mod` 钉伪版本 `v0.19.4-0.20261102025122-f581e25d5f6d`，即 2026-11-02 的 PR #1029 合并提交，位于 0.19.3 发布提交之后 103 个提交。~/Projects/attention/native/go.mod:8
- f581e25d 上 `version.go` 的 Version 为 `"0.20.0"`，而本地分支 HEAD 为 0.19.3。对 attention 实际使用的 SDK 应以 0.20.0 为准；PluginAPI 在该提交上未核对。~/Projects/rutis/go/rutis/internal/runtime/version.go:5
- Optional 服务与 `ctx.Get` 的文档标注需要 rutis-host 0.20+，CHANGELOG 无 0.20 行。该功能已随 f581e25d（提交 45890ec8）进入 attention 钉的版本。~/Projects/rutis/go/rutis/README.md:48；docs/guide/go-plugin.en.md:138
- ENDPOINT_PROTOCOL 在 v0.19.3 与 f581e25d 中均为 4，子协议为 `rutis.4`。~/Projects/rutis/crates/rutis-bridge/src/session/mod.rs:14；go/rutis/internal/runtime/listen.go:28-40。协议层兼容由常量推断，未做互通测试。
- 0.19 把协议从 3 升到 4，拒绝 0.18 及更早版本握手，拒绝信息指明升级哪一端；跨版本只在相邻发行版之间成立。~/Projects/rutis/docs/releases/0.19.0.en.md:5、13（原引用的第 101 行未核对）
- PLUGIN_API 在 0.19 未变，0.18 SDK 插件修好 import 后可运行；Go、Swift 二进制需重建。~/Projects/rutis/docs/migration-0.19.en.md:274
- dim 的 `rutis-0.19-upgrade.md` 状态写 Ready，但 Cargo.toml 已是 0.19.3，文档与代码不一致（低置信推断）。该升级范围排除 Go、Swift、Kotlin 运行时、dylib 插件与节点连接行。~/Projects/dim-ref/docs/design/rutis-0.19-upgrade.md §1

**集成形态（方向 1：Acard 挂 dim）**
- attention 已采用的形态：Go 启动器写 rutis.json（runtimes.go 为 `{binaries:[self], start:eager, restart:on-failure}`），再执行 `rutis-host run`。~/Projects/attention/native/internal/launcher/launcher.go:191-225、314-318
- rutis-host 的连接行有 dial、listen、spawn 三类，token 名为 `RUTIS_TOKEN_<row id>`。~/Projects/rutis/crates/rutis-host/src/connect/mod.rs:1-40
- spawn 的 greeting 默认 30 秒。~/Projects/rutis/crates/rutis-host/src/connect/spawn.rs:30、69
- dim 的 Node/Python 运行时模式与 spawn 相同，但实现是 rutis-bridge 直接使用 Launcher、pipe::greeted、Session::new，并不经过 rutis-host 的 SpawnPlugin（抽查更正）。~/Projects/dim-ref/crates/dim-app-server/src/session_typescript.rs:330-400
- dim 守护进程的 rutis 身份为 `LocalId("dim-daemon")`，UI leaf 的远端 id 必须是 dim-daemon，否则丢弃。~/Projects/dim-ref/crates/dim-app-server/src/lib.rs:641-645；rutis-0.19-upgrade.md:376-410
- dim 对外是 axum 的 `/ws` WebSocket，`PROTOCOL_VERSION = 3`，不是 rutis session。~/Projects/dim-ref/crates/dim-app-server/src/transport.rs:448-452；protocol.rs:8
- rutis 总线为每个 root 一条扁平总线，同名事件投递给所有监听者，不存储不重放，payload 必须可 serde 序列化。~/Projects/dim-ref/docs/design/rutis-usage.md:241-265

**dim App Server 客户端（方向 2）**
- 本地 transport 为 Unix socket（NDJSON），Windows 为经 bridge 子进程转接的命名管道；无应用层 token。~/Projects/dim-ref/crates/dim-app-server/README.md:3；dim-client/src/lib.rs:149-190
- Unix 认证为 OS 级：socket 须为当前用户所有，`mode & 0o077 == 0`，且 peer uid 与 euid 一致。~/Projects/dim-ref/crates/dim-client/src/lib.rs:170-200
- hello 要求 protocolVersion 为 3，且必须同时具备 session.create、session.history，否则报 Incompatible daemon；hello 超时 5 秒，帧上限 16 MiB。~/Projects/dim-ref/crates/dim-client/src/lib.rs:15-18、329-344
- 受保护 profile 下，WebSocket 端点只支持 hello 与 ping，执行类 RPC 需要 mock profile；Web 入口另用 bootstrap token 换 cookie。两者不是同一连接面。~/Projects/dim-ref/docs/design/web-workspace.md:52-63
- 流式通知为 session.event、session.state、approval.request、approval.cancelled；审批回复为 approval.respond。~/Projects/dim-ref/crates/dim-app-server/src/protocol.rs:759-765、1309-1334
- 历史读取为有界窗口：latestTurn，limit 256，向前翻页最多 4 页或 100 行。~/Projects/dim-ref/docs/design/clients.md §2
- 活动 turn、待回答问题等运行状态不能从 transcript 推断，需单独调用 session.permission.get、session.question.pending 等。~/Projects/dim-ref/docs/design/clients.md §2
- 线协议只在 protocol.rs 中定义，没有散文或 schema 规范；dim-client 约 1312 行 Rust 可作参考，Go 端无现成实现。~/Projects/dim-ref/docs/design/clients.md §4

**Acard CLI 推送面**
- socket 默认为 `$XDG_RUNTIME_DIR/attention-cli.sock`，未设时落在配置目录；`ATTENTION_SOCKET` 可覆盖。RFC 写的是 `.attention-cli.sock`，以代码为准。~/Projects/attention/native/internal/paths/paths.go:30-47
- 协议为一行 JSON `{argv,tty,cwd}`，纯文本应答，读超时 5 秒，无流式与结构化应答。~/Projects/attention/native/plugins/cli/cli.go:79-118
- `open` 支持 path、file、line、to、kind、newtab；不支持 col、len、split、reveal。Nav 结构有 Col、Len，但 CLI 未透传。~/Projects/attention/native/plugins/workspace/plugin.go:296-350
- 分屏只能经 `command id=workspace:split-vertical`（或 split-horizontal）触发，二者无 CLI 标记，且无法传参。~/Projects/attention/native/plugins/workspace/plugin.go:216-221、247-248；actions.go:340-357
- 外部插件可经 `actions.Register` 注册带 CLI 标记的命令。导读卡片的 trail/push 命令代码中不存在，仅列为议题。~/Projects/attention/native/plugins/actions/actions.go:140-170；docs/product.md:93
- 只有 search 与 search:context 支持 `format=json`；open、tabs、tab:open、workspace 无 JSON 应答。~/Projects/attention/native/plugins/workspace/plugin.go:322-340
- `cli_test.go` 只测了 quit；roadmap 写明 CLI e2e 未验收。~/Projects/attention/native/plugins/cli/cli_test.go:1-20；docs/roadmap.md:105

**进程管理**
- native 中已知 exec.Command 三处：buildcmd.go:231、launcher.go:374、terminalui.go:385。全仓总数未经 rg 核实（原条目「4 处」与所列不符）。
- launcher 以 Setpgid 启动 rutis-host，输出写 host.log，每 50ms 轮询；信号转一次 SIGTERM。~/Projects/attention/native/internal/launcher/launcher.go:374-450
- rutis 重启退避数字固定不可配：首次 1 秒、上限 30 秒、运行满 60 秒重置、5 分钟内最多 5 次。~/Projects/rutis/crates/rutis-host/src/restart.rs:20-33
- 终端 pty 由 mygo 以 Setsid 启动；Close 先关 master（子进程收 SIGHUP），2 秒后 `proc.Kill()`。attention 不自动重启，用户点 Restart。~/Projects/mygo 伪版本 `v0.7.5-0.20261104191142-c9438876cbd1` plugins/terminal/terminal.go:1145-1175；terminalui.go:160-235
- dim 的 MCP stdio 子进程设置 `kill_on_drop(true)`；daemon 启动时关闭继承的 fd。~/Projects/dim-ref/crates/dim-app-server/src/mcp/server/stdio.rs:168-175；src/cli.rs:30-52

### 冲突与未核实

- **Go SDK 版本**：本地分支 HEAD 为 0.19.3，attention 钉的 f581e25d 为 0.20.0。以钉的提交为准。
- **0.20 是否已发布**：CHANGELOG 只到 0.19.3，但 attention 钉的提交已含 optional 依赖，attention 的 Go 端已在使用未发布行为。
- **dim 的 Node/Python 挂载**：模式相同，实现路径不同（rutis-host/spawn 与 rutis-bridge 直接 Launcher 不能混为一谈）。
- **dir-client 两个限制**：hello/ping 限制针对受保护 profile 的 WebSocket，Web 入口的 v3 Session 方法属于另一连接面。
- **未核实**：0.19.4 与 rutis-host 0.20 是否正式发布；Go 侧直接挂载 Rust 会话的可行性（仅由 ENDPOINT_PROTOCOL 推断）；Swift、Kotlin、Python 的 wire 兼容性；`v1::SharedEvent` 与 `ApprovalDecision` 的完整 schema；dim 守护进程能否被 rutis-host/spawn 当作 session 运行时启动。

### 对 Acard 的设计问题

1. Acard 的 Go 进程走哪条 rutis 路径：沿用 attention 的 Go 启动器写 rutis.json 经 rutis-host，还是直连 dim 的 `/ws`？依据：Go 无 host API，直连需自行实现 v3 协议。
2. 是否要求 dim 守护进程以 rutis session 身份（dial 或 spawn 行）挂入 rutis-host？依据：dim 设计只覆盖 Node/Python 运行时与 UI leaf 的握手，守护进程挂载未设计。
3. attention 的 Go 端应保留伪版本 f581e25d（已含未发布的 optional 依赖），还是回退到正式 0.19.3？依据：二者协议常量相同，但 f581e25d 多 103 个提交，Go 端行为已不同。
4. 导读卡片推送应在 `open` 上补 col、len、split、format=json，还是由外部插件经 `actions.Register` 实现 trail:add？依据：open 只透传 Line/To，分屏无参数，且无结构化应答。
5. 方向 2 是否接受在 Go 中重写 NDJSON 客户端、hello 能力协商与历史窗口折叠？依据：wire 只在 Rust 的 protocol.rs 定义，无 Go 参考实现，dim-client 约 1312 行。
6. 语言服务器与 dim 守护进程的监督策略，是复用 rutis 的退避数字与 kill 语义，还是各自实现？依据：rutis 退避不可配置，mygo 关闭语义是 SIGHUP 后 2 秒强杀，attention 没有通用 supervisor。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| partly | rutis-core | 核心 crate 依赖只有 tokio、tokio-util、thiserror、serde、serde_json（rutis-bridge 另加 erased-serde 与 rutis-macros） | crates/rutis/Cargo.toml 的 [dependencies] 段（第 13-21 行）实际包含 tokio、tokio-util、thiserror、serde、serde_json，但还包含 erased-serde = "0.4"（第 20 行）和 rutis-macros（第 21 行）。rutis-bridge/Cargo.toml 的 [dependencies]（第 15-34 行）并不含这两项。正确说法：核心 crate 的运行时依赖是七个，不是五个；erased-serde 与 rutis-macros 属于核心 crate 而非 bridge。 |
| partly | rutis-core | Go SDK 版本常量 Version = "0.19.3"，PluginAPI = 3，Implementation 为模块路径 | 在本地克隆当前分支 claude/row-inject-gated 的 HEAD 上，version.go:5 确为 Version = "0.19.3"，PluginAPI = 3。但 attention 钉住的提交 f581e25d 中同一文件的 Version 为 "0.20.0"（git show f581e25d:go/rutis/internal/runtime/version.go）。对 attention 实际使用的 Go SDK，应以 0.20.0 为准。PluginAPI 在 f581e25d 上未核对。 |
| confirmed | rutis-core | Go 模块路径为 github.com/arcships/rutis/go/rutis，go 指令为 1.24，仅标准库 | go/rutis/go.mod 第 1 行为 module github.com/arcships/rutis/go/rutis，第 3 行为 go 1.24。标准库限定的说明未在 go.mod 中核对，仅确认模块路径与 go 版本。 |
| confirmed | rutis-core | 最新发布 tag 为 v0.19.3（2026-10-31）；0.7.0（2026-10-06）是第一个进入 release train 的版本；所有包共用版本号 | git tag 最新为 v0.19.3；CHANGELOG 表首行为 0.19.3 / 2026-10-31；0.7.0 行写明“First release of the release train”（2026-10-06）；顶部说明“Every rutis package shares one version number”。 |
| confirmed | rutis-core | Optional 服务与 ctx.Get 需要 rutis-host 0.20 或更高版本，但最新 tag 与 CHANGELOG 只到 0.19.3；当前分支为 claude/row-inject-gated | go/rutis/README.md:48 写明“This needs rutis-host 0.20 or later”；go-plugin.en.md:138 同样标注 0.20。CHANGELOG 中 0.20 出现次数为 0；git branch --show-current 输出 claude/row-inject-gated。注意：attention 钉住的伪版本 f581e25d 已包含这些可选依赖功能（见 rutis-compat 第 16 条），因此“未发布”的判断对 attention 的 pin 有实际影响。 |
| confirmed | rutis-compat | pin 提交 f581e25d 为 2026-11-02 的合并提交（PR #1029），位于 0.19.3 发布提交 d3e8b5da（2026-10-31）之后 103 个提交 | git log -1 显示 f581e25d 为 2026-11-02 的 Merge pull request #1029；d3e8b5da 为 2026-10-31 的 release: 0.19.3；git rev-list --count d3e8b5da..f581e25d 为 103。 |
| confirmed | rutis-compat | 会话协议版本 ENDPOINT_PROTOCOL 在 v0.19.3 与 f581e25d 中都是 4，WebSocket 子协议为 rutis.4 | crates/rutis-bridge/src/session/mod.rs:14 在 v0.19.3 与 f581e25d 上均为 pub const ENDPOINT_PROTOCOL: u32 = 4。子协议由 format!("rutis.{...}") 构造（v0.19.3 smoke.rs:140）。协议层面的握手兼容性由此推断，互通测试未做。 |
| confirmed | rutis-compat | 0.19 拒绝 0.18 及更早版本的握手，并提示升级哪一端；跨版本只在相邻版本间成立 | docs/releases/0.19.0.en.md 第 5 行与第 13 行明确写明“0.19 refuses 0.18 and earlier at the handshake”，并给出“upgrade the far end”之类的提示文本。原文引用的第 101 行未核对，正确出处应为第 5 与 13 行。 |
| confirmed | rutis-compat | PLUGIN_API 在 0.19 中未变，0.18 SDK 写的插件可在 0.19 运行时运行 | docs/migration-0.19.en.md 第 274 行写明“The plugin API version is unchanged: plugins built with an older SDK run on the 0.19 runtimes as before.”。引用的第 103 行不是该句，正确行号为 274。 |
| confirmed | dir-host | rutis-host/spawn 的 greeting 默认 30 秒 | crates/rutis-host/src/connect/spawn.rs:30 定义 GREETING = 30 秒；第 69 行文档写明“30 s by default”；greeting(limit) 方法见第 73 行。 |
| confirmed | dir-client | WebSocket 端点在受保护 profile 下只支持 hello 与 ping，执行类 RPC 需要 mock profile | crates/dim-app-server/README.md 第 3 行写明“their WebSocket endpoint supports only hello and ping. The explicit mock profile permits WebSocket execution for protocol testing.”。该 README 同段还说明 Web 入口连接使用 v3 协议并获得 Session 方法，这与 hello/ping 限制针对的是不同端点，需区分。 |
| confirmed | dir-client | PROTOCOL_VERSION = 3；hello 超时 5 秒；协议版本不符时报 Incompatible daemon | crates/dim-client/src/lib.rs:15 为 PROTOCOL_VERSION: u32 = 3；第 331 行 hello 包在 5 秒超时内；第 332-344 行在版本不符时返回 “Incompatible daemon” 错误。dim-app-server/src/protocol.rs:8 同为 3。FRAME_LIMIT 为 16 MiB（lib.rs:16）也已核对。 |
| confirmed | acard-cli | open 命令只支持 path/file、line、to、kind、newtab；导航只传 Nav{Line, To}，没有 Col 与 Len，没有分屏参数 | native/plugins/workspace/plugin.go 的 cliOpen 只解析 line 与 to，构造 Nav{Line: line, To: to}，未暴露 Col 或 Len；校验规则“to= needs line=”与“Invalid to”也与引用一致。OpenOptions 只含 Nav、NewTab、Kind，没有分屏字段。 |
| confirmed | acard-cli | 分屏只能由 UI 命令 workspace:split-vertical 与 workspace:split-horizontal 触发，它们由 ui() 辅助函数生成，带 Run 但没有 CLI 标记 | native/plugins/workspace/plugin.go:216-221 的 ui 辅助函数只设置 ID、Title、Keys、Main 与 Run，没有 CLI 字段；split-vertical 与 split-horizontal 通过它注册（第 247-248 行）。RunCLI（actions.go:227-250）只对 argv[0] 做 CLI 检查，因此 command id= 可以触发它，但无法传参，这与事实第 8 条一致。 |
| partly | acard-proc | native 中直接 exec.Command 只有 4 处：buildcmd.go:231、launcher.go:374、terminalui.go:385 及其他 | 该条自身列出的调用点只有 3 处（buildcmd.go、launcher.go、terminalui.go 各一处），与“4 处”自相矛盾。未运行全仓 rg 核对数量。正确表述应为：已知三处 exec.Command 调用点，总数需用 rg 重新确认。 |
| confirmed | acard-proc | rutis 重启退避常数：首次 1 秒，上限 30 秒，稳定 60 秒，5 分钟窗口内最多 5 次，超过放弃 | crates/rutis-host/src/restart.rs:20-33 中 FIRST = 1s、LONGEST = 30s、STABLE = 60s、WINDOW = 5 分钟、LIMIT = 5，与引用完全一致，数字固定不可配置。 |
| confirmed | acard-proc | mygo terminal 的 Close 先关闭 pty master，2 秒未退出则 proc.Kill()；pty Close 只关 master 不等待；pty Kill 对进程组发 SIGKILL | mygo@v0.7.5-0.20261104191142-c9438876cbd1 的 plugins/terminal/terminal.go:1145 为 Close，第 1174-1175 行为 time.After(2*time.Second) 后 proc.Kill()。internal/pty/pty_unix.go:95-96 的 Close 只关 master 且注释写明不等待；第 98-103 行 Kill 对 -pid 发 SIGKILL，失败再 Process.Kill。 |

题目之间的矛盾：

- Go SDK 版本在三处说法不一致：rutis-core 第 16 条（本地分支 HEAD 为 Version 0.19.3）、rutis-compat 第 1 条（attention 钉伪版本 v0.19.4-0.20261102025122-f581e25d5f6d），而 f581e25d 上 version.go 的实际值是 0.20.0。应以钉住的提交为准，即 attention 实际运行的 SDK 报告 0.20.0。
- 0.20 是否已发布的判断不一致：rutis-core 第 18 条称 optional 服务依赖的 0.20 功能尚未发布（CHANGELOG 只到 0.19.3），而 rutis-compat 第 16 条显示 attention 钉住的 f581e25d 已包含 optional 依赖（45890ec8）。attention 的 Go 端因此已经在使用未发布的 0.20 行为。
- dim 的 Node/Python 运行时挂载方式描述不一致：dir-host 第 12 条称其为“rutis-host/spawn 同款模式”，而 rutis-compat 第 12 条明确说 dim 不用 rutis-host 的 SpawnPlugin，而是直接用 rutis-bridge 的 Launcher、pipe::greeted 与 Session::new。模式相同，实现路径不同，不应写成同一机制。
- acard-proc 第 1 条自相矛盾：摘要说“只有 4 处”，事实列出的调用点却只有 3 处。
- rutis-core 第 12 条的 go on-demand 与 idle 60 只出现在 config.rs 模块文档的示例 JSON 中，不是默认值；attention 实际使用 start: eager（acard-proc 第 6 条、dir-host 第 9 条），两者并不矛盾，但 rutis-core 的说法不应被当作 Go 运行时默认行为。
- dir-client 的“hello/ping 限制”与 dir-client 的“Web 入口协议 v3”在同一 README 段内并存，需要区分受保护 profile 的 WebSocket 端点与 Web 入口端点，两者不是同一连接面。

全部事实见 [facts/B2.md](facts/B2.md)。
