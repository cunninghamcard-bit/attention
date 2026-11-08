## B1 dim 智能体运行时

### 核心概念

**Timeline**：每个分支一条带序号的事件总线，只有 Timeline 提交分配 sequence，是历史事实的唯一来源。
**Session**：一个主体的身份、交互面、能力与工作区，持有分支树与审批。
**Branch（分支）**：同一 Session 内同一主体的另一条行为线，共享历史事实但不共享上下文。
**Member（成员）**：Collaboration 中的另一个独立 Session，只拿任务，不继承 leader 历史，结果自动回传。
**Capability**：在分支 Timeline 上折叠事实或写入自有域事实的状态机，只提供工具的部件不算。
**rutis**：dim 使用的插件机制，每个插件是 loader 中的一行（row）。
**part（部件）**：插件运行时向 part registry 注册的 generator，按 Process、Session 或 Branch 作用域挂载。
**Permission preset**：read-only、workspace-write、full-access 三档，决定能否运行、是否先询问。
**Approval**：只裁决 agent 发起的工具调用的审批机制。
**daemon profile**：hello 声明的 product、configured、mock 三种档位，客户端不匹配必须拒绝。
**Notice**：Session 显示用通知，无序号、不排队、不重放。
**ToolRegistry**：Session 级工具表，插件注册定义加 handler，随插件卸载撤销。
**TemporaryMcp**：Session 级临时 MCP，30 秒 lease，由客户端 attach、renew、detach。

### 关键事实

除特别注明外，来源路径相对于 `~/Projects/dim-ref`。

#### 架构与协议
- 分层为终端 launcher、Rust dimcode、本地 NDJSON RPC、dim-app-server；App Server 每个 product home 一个，一个执行器、多个 viewer。来源：docs/architecture/README.md；docs/design/clients.md:9
- 协议 v3（PROTOCOL_VERSION=3），单帧上限 16 MiB。来源：crates/dim-app-server/src/protocol.rs:8；outbound.rs:6
- Unix 端点为 `<home>/rust/daemon.sock`（目录 0700、socket 0600），Windows 为 named pipe。来源：crates/dim-cli/src/client.rs:535,561-572
- HTTP 仅 /ws 与 /health；产品与配置 profile 的 WebSocket 只允许 hello 与 ping，仅 mock 档允许执行。来源：transport.rs:448-450
- 每连接在途请求上限 64（另留 8 个控制槽），出站 1024 帧、32 MiB；饱和时关闭慢消费者。来源：connection.rs:40；outbound.rs:7-9
- 客户端断开只是 detach，不关闭 Session；session.attach 不互斥。来源：dim-app-server/README.md:429；docs/design/plugins/Tui.md:323
- Session 空闲 60 秒后卸载（idle_unload_after），下次 acquire 恢复，不写 Timeline。来源：crates/dim-app-server/src/lib.rs:134；docs/design/appserver/idle-unload.md
- daemon 替换仅在 daemon.shutdown {ifIdle:true} 确认空闲时发生，否则返回 daemon_busy。来源：crates/dim-cli/src/client.rs:440-493
- 仓库内没有 Go 客户端，也没有语言中立的协议规范，wire 只定义在 protocol.rs。来源：docs/design/clients.md:51；crates/dim-client/src/lib.rs
- submit 的超时或断开不能证明输入被拒，客户端不得盲目重提交。来源：dim-app-server/README.md（Session submission errors）

#### 存储
- 原生库为 `<home>/rust/dimcode.sqlite`，当前格式 v36（FORMAT=36），旧版原地升级，未知格式拒绝打开。来源：crates/dim-app-server/src/storage/sqlite.rs:19,451-472
- session.catalog 为 keyset 分页，limit 默认 50，cwd 精确过滤，不加 lease 也不加载 Session。来源：docs/design/appserver/session-catalog.md:50-58
- 压缩不改写 Timeline，只用 retain_from 界定之后的上下文，重载时未完成的压缩结算为 cancelled。来源：docs/design/plugins/ContextCompaction.md §5.7、§10
- dimcode export 导出整条 Timeline 为 JSONL，只读快照，标记 sensitive。来源：docs/design/appserver/timeline-export.md §1–7

#### 分支与消息
- 子分支从切点继承历史，之后各自折叠、组装上下文、压缩；兄弟线不直接通信。来源：docs/design/timeline-branches.md §1、§4
- 只有 main 能开 agent 线，开出的线是叶子；线数与消息数不设上限。来源：timeline-branches.md:61-63、123
- 消息 append 随下次请求生效、不唤醒 wait；steer 进入下一步，空闲时开新回合。来源：timeline-branches.md §6
- 工作区共享，edit/write 凭每线读绑定拒绝陈旧文件。来源：timeline-branches.md:270-279
- 模型只看见已采纳的输入与工具结果，事件不直接进入上下文。来源：docs/adr/001-harness-foundation.md

#### 插件与 rutis
- rutis 锁定 0.19.3，三个 crate 同版本；Rust 工具链 1.98.1 只见于 README 徽章。来源：Cargo.toml:14-16；README.md
- Session 与分支部件通过 part registry 注册，按实例挂载；服务名唯一属于一个 group，就近解析，不回退。来源：docs/design/rutis-usage.md §2、§3.1
- 事件为 0.15.1 起的单一平总线，payload 必须 serde；Dim 拒绝第二条总线与 plugin trait。来源：rutis/CHANGELOG.md:17-18；rutis-usage.md §1、§5
- 跨语言运行时为连接行：Node 为 session-node（`node --import tsx`），Python 为 py（`python -m rutis`），握手 30 秒。来源：crates/dim-app-server/src/session_typescript.rs:334,337,340,368-403
- 生命周期分 Activated（发布后）与 Closing（关闭开始时）。来源：docs/design/plugin-contract.md §7.1

#### 协作与子智能体
- member 为独立 Session，不继承历史，不能再委派，每成员同一时间只一个任务。来源：docs/design/plugins/Collaboration.md:14,88
- 模型策略三种：agent、inherit、fixed，存于 collaboration.json，只影响此后新建的成员。来源：crates/dim-app-server/src/collaboration_model_policy.rs:19-35
- 成员审批路由回发起委派的分支，决策结果码为 answered、not_pending、unavailable。来源：docs/design/subagent-tool-approval.md §1、§5
- Scheduler 并发上限 8（MAX_CONCURRENT_RUNS），轮询 1 秒，终态保留 100 条，拒绝成员调用。来源：crates/dim-agent-scheduler/src/engine.rs:19-20；session.rs:340-346
- Goal 续跑规则 C1–C7，连续 3 轮无进展（NO_PROGRESS_TURNS=3）即暂停。来源：docs/design/plugins/Goal.md 附录 A.4

#### 权限、审批与提问
- read-only 拒绝写、命令与网络；workspace-write 对其余询问；full-access 不询问；deny 在所有 preset 下生效。来源：docs/architecture/rust-agent/plugins/Permission.md:19-40
- 默认 preset 为 ReadOnly。来源：crates/dim-agent-types/src/permission.rs:4-11
- 配置驱动的执行（MCP、Hook、workflow、插件）不经审批，启用即运行（ADR 003 D2）。来源：docs/adr/003-approval-scope.md
- 项目来源条目默认禁用，项目文件不能自启用，启用记录只存用户本地。来源：docs/adr/003-approval-scope.md D3；AGENTS.md:112
- ask_user 最多 4 题，每题 2–6 个选项；非交互会话直接返回 NON_INTERACTIVE，不等待。来源：crates/dim-agent-questions/src/lib.rs:248-290
- 交互会话挂起至 session.question.respond，答案作为 ToolResult 写回，不产生额外事件。来源：lib.rs:322-370

#### 工具与模型
- 插件调用 ToolRegistry::register 注册定义与 handler，不能与宿主工具重名，随卸载撤销；新工具需 adoption 后才对模型可见。来源：crates/dim-agent-capabilities/src/tool_registry.rs:167-179
- 工具的使用指导就是 ToolDefinition.description，不存在独立的 guide 条目。来源：crates/dim-agent-capabilities/src/prompt_guide.rs:48-56
- TemporaryMcp 的 LEASE 为 30 秒，网关每 10 秒续期，配置不写入 mcp.json 或 SQLite。来源：crates/dim-app-server/src/mcp/temporary.rs:34
- 模型协议枚举为 8 种，aimux README 只列 5 类；开发配置拒绝 bedrock。来源：crates/dim-agent-types/src/model.rs:6-23；crates/dim-agent-aimux/src/models.rs:40-44
- 每个模型必填正整数 contextWindow、maxOutputTokens 与 config.maxTokens；凭据只存环境变量名。来源：crates/dim-agent-aimux/README.md
- 重试最多 8 次、基数 1 秒、封顶 30 秒、总预算 300 秒。来源：crates/dim-agent-capabilities/src/model_provider/recovery.rs:11,16,18,22

#### Web 客户端
- 请求超时 30000 ms，心跳 20000 ms，重连退避 500 至 15000 ms。来源：web/src/rpc/client.ts:39-42
- 历史分页每页 256 条，以首页 through 固定上界，按 sequence 去重。来源：web/src/stores/chat.ts:88-89
- 命令输出尾部预览为 2000 行或 50 KiB；输出分页默认 1 MiB、上限 4 MiB；已结束任务保留 50 条。来源：crates/dim-agent-capabilities/src/workspace_tools/exec.rs:39-40；mod.rs:40-48；crates/dim-cli/src/projection.rs:1233-1254

### 冲突与未核实

- **存储版本冲突**：dim-appserver 的摘要与 README 称当前格式为 v29，代码 sqlite.rs:19 为 v36。**按代码改正为 v36**，v29 为过时文档。timeline-export.md 的 v29 与 store_format 23 同属陈旧文档。
- **Session 驻留冲突**：clients.md 与 cold-attach-profile.md 写 Session 驻留至关闭，已被 idle-unload 默认 60 秒取代，以代码为准。
- **thin-instances 版本**：其正文的"现状"固定在 rutis 0.17.1，与当前 0.19.3 不冲突，只是历史提交。
- **LocalId 与 PeerId**：文档写 LocalId，代码 lib.rs:647 为 PeerId::new("dim-daemon")，**以代码为准**。
- **malformed_response 重试次数（部分改正）**：四类都可重试的说法不完整。recovery.rs 中 MALFORMED_RETRIES=1，该类最多重试一次。
- **分类表未核实**：ModelFailureKind 的 11 类与可重试集合仅来自 model-failures.md，未对照代码。
- **ask_user 上限未核实**：MAX_QUESTIONS=4、选项 2..=6、header 40 字符，lib.rs:31-35 中找不到这些定义，行号有误，数值未核实。
- **MemoryTimelineStore 回退未核实**：默认 10 秒启动超时已确认，但未读到未设置 timeline_store 时回退到内存存储的代码。
- **ADR 003 状态**：仍为 Proposed，但 AGENTS.md 与 ADR 004 已按其实施。
- **设计文档状态滞后**：timeline-ui 标 Proposed 而代码已有 ⑂ 标记；collaboration-timeline 为 Proposed 未实现；web-tui-parity 标 Proposed 而 P0–P2 已标 Implemented。
- **版本号**：checkout 的 Cargo.toml 为 0.1.0-alpha.18，而 npm 已发布 alpha.20（推断，以发布源为准）。
- **dima-auto-research**：仅有 README，worker 归为 member 是推断。

### 对 Acard 的设计问题

1. Acard 接入 dim 时，是用 Go 重写精简的 RPC v3 客户端，还是通过 Rust 侧桥接？依据：仓库没有 Go 客户端，dim-client 是 Rust crate，FFI 未核实。
2. Acard 应嵌入进程（AgentBuilder::build）还是连接独立守护进程？依据：嵌入 API 近期可能因 thin-instances 改变，daemon 层的多 viewer 语义只在守护进程模式下存在。
3. 一个项目含多个文件夹时，用多个 grant 还是多个 Session 表示？依据：dim 的 Session 只有单个 cwd，worktree 扩展仅覆盖同一 Git 仓库。
4. 打开文件到行、读取选区、展示 diff 等能力，应做宿主 handler 注册还是走 MCP？依据：ToolRegistry 注册随插件卸载撤销，MCP 只是另一种 source。
5. agent 的提问与审批在 Acard 中用 Modal 还是 Notice 承载？依据：非交互会话的 ask_user 直接返回错误而不等待，审批又需要单点作答。
6. 项目来源的插件是否默认禁用、启用记录只存用户本地？依据：ADR 003 状态仍为 Proposed，但项目条目默认禁用的规则已在 AGENTS.md 中实施。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | dim-overview | rutis 固定为 0.19.3（Cargo workspace 的 rutis、rutis-loader、rutis-bridge 均为 0.19.3），Rust 工具链 1.98.1 | ~/Projects/dim-ref/Cargo.toml:14-16 确认三个 crate 均为 0.19.3。Cargo.toml:11 写的是 rust-version = "1.98"，未核对 README 徽章中的 1.98.1，因此工具链小版本只部分核实。 |
| wrong | dim-appserver | native 存储格式当前为 v29，启动时单向升级到 v29 | 代码 ~/Projects/dim-ref/crates/dim-app-server/src/storage/sqlite.rs:19 为 pub const FORMAT: u32 = 36，当前格式是 v36。crates/dim-app-server/README.md:408、410、423 写的 v29 是过时文档。应以代码为准，改为 v36，并注意 v29 是旧版文档的内容。 |
| confirmed | dim-persist | 会话库当前原生格式 v36，代码常量 FORMAT=36 | ~/Projects/dim-ref/crates/dim-app-server/src/storage/sqlite.rs:19 确认 FORMAT = 36。 |
| confirmed | dim-appserver | NDJSON 单帧上限 MAX_FRAME_BYTES = 16 MiB，WebSocket 同样以该值设置 max_message_size / max_frame_size | crates/dim-app-server/src/outbound.rs:6 定义 16*1024*1024；transport.rs:498-499 以 MAX_FRAME_BYTES 设置 max_message_size 与 max_frame_size。 |
| confirmed | dim-appserver | Session 空闲卸载默认 idle_unload_after = 60 s，且 clients.md 中“Session 一直驻留”的描述已过时 | crates/dim-app-server/src/lib.rs:98 为 idle_unload_after 字段，:134 默认 Duration::from_secs(60)；:481 处理 zero 值。过时文档的说法未逐条核对，但默认值成立。 |
| confirmed | dim-rutis | 等待运行时问候的超时为 30 秒（GREETING = Duration::from_secs(30)），位于 session_typescript.rs:340 | crates/dim-app-server/src/session_typescript.rs:340 为 const GREETING: Duration = Duration::from_secs(30)，:522 用于 greeted 等待。 |
| confirmed | dim-timeline-ui | 已结束任务按结束时间倒序保留 50 条，未结束任务全部保留（tasks.truncate(unfinished + 50)） | crates/dim-cli/src/projection.rs:1233-1254 的 retain_tasks 与 truncate(unfinished + 50) 一致；未结束任务由 take_while 计数，全部保留。 |
| confirmed | dim-uiext | 包内资源分页默认 1 MiB、上限 4 MiB（DEFAULT_PAGE / MAX_PAGE） | crates/dim-app-server/src/ui_extensions/resources.rs:80 为 DEFAULT_PAGE = 1024*1024，:82 为 MAX_PAGE = 4*1024*1024。 |
| partly | dim-models | 重试策略常量：最多 8 次尝试、1 秒基数、退避封顶 30 秒、总等待预算 300 秒；只重试 network、rate_limited、server_error、malformed_response 四类 | recovery.rs 中 MAX_ATTEMPTS=8、BASE_DELAY=1s、MAX_BACKOFF=30s、WAIT_BUDGET=300s 均确认。但 malformed_response 并非与其他三类同等重试：同文件 MALFORMED_RETRIES = 1，即该类最多重试一次。四类的分类表只来自设计文档，未核对代码映射。 |
| confirmed | dim-tools | 插件通过 ToolRegistry::register(ctx, ToolContribution) 注册工具，名称须符合 tool name grammar 且不能与 host tool 重名，并随插件卸载撤销 | crates/dim-agent-capabilities/src/tool_registry.rs:167-179 中 register 校验 valid_tool_name，拒绝 is_host 的名字，并以 ctx 作 owner 注册。卸载撤销的机制来自 ctx 所有权，未逐行核对撤销路径。 |
| confirmed | dim-subagents | Scheduler 运行并发硬上限 MAX_CONCURRENT_RUNS = 8，POLL = 1s | crates/dim-agent-scheduler/src/engine.rs:19 为 POLL = 1s，:20 为 MAX_CONCURRENT_RUNS: usize = 8。 |
| unverifiable | dim-approvals | ask_user 的 MAX_QUESTIONS=4、选项 2..=6 等上限定义在 dim-agent-questions/src/lib.rs:31-35 | lib.rs:31-35 实际是 use 语句与 const TOOL = "ask_user"，没有看到 MAX_QUESTIONS、OPTIONS、MAX_HEADER_CHARS 的定义，数值与行号均未核实。需在更靠后的行重新定位。 |
| confirmed | dim-release | npm dist-tags：dimcode-alpha 的 latest 与 alpha 为 0.1.0-alpha.20；dimcode 的 latest=0.5.24、beta=0.5.24-beta.0、alpha=0.1.0-alpha.7 | 2026-11-09 实时 npm view 输出与该说法一致。 |
| confirmed | dim-web | RPC 客户端常量：请求超时 30000 ms，心跳间隔 20000 ms，心跳超时 10000 ms，重连退避 [500..15000] ms | ~/Projects/dim-ref/web/src/rpc/client.ts:39-42 与所述数值完全一致。 |
| partly | dim-embed | AgentBuilder 默认启动超时 10 秒，未设置 timeline_store 时默认 MemoryTimelineStore | assembly.rs:233 确认 startup_timeout 默认 Duration::from_secs(10)。MemoryTimelineStore 作为默认存储的回退路径未在本次读取中核对。 |

题目之间的矛盾：

- native 存储版本互相矛盾：dim-appserver（summary 与 fact 13）称当前格式为 v29、升级链止于 v29，而 dim-persist（fact 3）与代码 sqlite.rs:19 均为 v36。应以代码为准，dim-appserver 的版本描述陈旧，其 README 的 v29 段落也已过时。dim-persist fact 18 指出的 timeline-export.md 写 v29 同属同一源头的陈旧文档。
- dim-appserver 的 summary 将 Session 驻留描述为“直至关闭”的旧说法，与同一主题 fact 19（idle unload 默认 60 s）冲突；本次以代码默认值为准，旧说法应删除。
- dim-embed fact 19 说 thin-instances 的“现状”固定在 rutis 0.17.1，而 dim-overview 与 dim-rutis 说当前 workspace 为 0.19.3。两者并非冲突：前者指设计文档所描述的历史 main 提交，后者是当前 Cargo.toml，但文档之间易被误读为版本不一致。

全部事实见 [facts/B1.md](facts/B1.md)。
