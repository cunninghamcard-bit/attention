## B4 其他多智能体与推送到 UI 的参照

### 核心概念
**线程（thread）**：Zed Agent 中相互独立的运行单元，各自有 agent、上下文窗口和对话历史。
**worktree**：git worktree，并行智能体常用的隔离检出单元。
**配置档（profile）**：决定工具是否可用（Zed 内置 Write / Ask / Minimal），不决定调用是否自动允许。
**工具权限（tool permissions）**：调用时决定允许、拒绝或确认。
**Steer**：Zed Agent 在工具调用与回复之间插入用户消息的机制，外部 agent 不支持。
**跟随（Follow）**：编辑器跳转到 agent 读写文件的显式开关。
**会话授权（session grant）**：dim ADR 012 中按 (session_id, path) 记录的路径授权。
**allow_always**：Alma 的“始终允许”，按线程记录。
**@-mention**：消息输入框中引用上下文的语法，如 Claude Code 的 `@path#START-END`。

### 关键事实

#### 线程与存储
- Zed 线程互相独立，Threads Sidebar 按项目分组。归档后进入 Thread History 可恢复，运行中的线程须先结束；永久删除不可恢复。（~/Projects/lsp-ref/zed/docs/src/ai/parallel-agents.md:36-44）
- Zed 线程存于 `paths::data_dir()/threads/threads.db`（SQLite），列表查询只读元数据列，`data` 为 zstd 压缩 JSON。项目身份是 `folder_paths`，另有 `main_paths` 记录 main worktree。（zed/crates/agent/src/db.rs:405、L178-184；zed/crates/project/src/worktree_store.rs:46-85；内容经 gh api 取自上游）
- Claude Code 线程为 `~/.claude/projects/<编码 cwd>/<sessionId>.jsonl`。仅观察到 `/` 替换为 `-`，含 `.` 或空格的编码未核实。
- Codex 线程索引在 `~/.codex/state_5.sqlite` 的 `threads` 表。`projects` 与 `project_roots` 表允许一个项目挂多个根路径。（sqlite3 查询结果）
- dim 列表过滤键为规范化后的 `cwd`，经 `canonicalize` 写入（crates/dim-app-server/src/protocol.rs:30-37；storage/catalog.rs:243、263）。git root 只用于文件访问校验，不作分组键（file_access.rs:451）。`settings.projects` 为 `Arc<Mutex<BTreeMap<PathBuf, usize>>>`，仅在进程内存，重启清空（settings.rs:191）。

#### 并行 worktree 产品
- Conductor 每个 workspace 是 git worktree 独立检出，新分支以 origin/main 为基准。磁盘路径与运行状态展示未说明。（https://www.conductor.build/docs/concepts/workspaces-and-branches）
- Claude Code 桌面版的 Worktree 默认关闭，默认存于 `<project-root>/.claude/worktrees/`，可在 Settings > Code 修改。归档可能丢弃未提交改动，会先警告。本地会话的 worktree 在归档或最后打开约 30 天后删除。（https://code.claude.com/docs/en/desktop）
- Sculptor 每个 agent 运行于独立容器而非 worktree，支持 Apple Silicon Mac 与 Linux。（https://imbue.com/sculptor/）
- Cursor Cloud Agents 每个 agent 运行于独立 VM，产出 merge-ready PR，需 Premium 及以上套餐。状态展示未说明。（https://cursor.com/docs/background-agents）
- Vibe Kanban 把工作区定义为“一个分支、一个终端、一个 dev server”。worktree 隔离为推断，README 未明说。stars 28617，最后 push 2026-11-04。（https://github.com/BloopAI/vibe-kanban）
- Crystal 最新 release v0.3.5 发布于 2026-02-26，MIT，stars 3129。（gh api repos/stravu/crystal）

#### 审阅、推送与选区
- Claude Code 桌面版逐文件查看 diff，悬停行号出现 + 按钮添加行内评论，Cmd+Enter 一次提交回传。（https://code.claude.com/docs/en/desktop）
- Conductor Diff Viewer 支持逐文件、unified 视图和按 commit 过滤，评论可指向变更行回传 agent。（https://www.conductor.build/docs/reference/diff-viewer）
- Zed 的 Review Changes（shift-ctrl-r）逐 hunk 接受或拒绝；`agent.single_file_review` 可切为 inline diff。选区入口为编辑器右键 “Add to Agent Thread”，绑定 `AddSelectionToThread`。（zed/crates/editor/src/mouse_context_menu.rs:295；zed docs agent-panel.md:145）
- Zed 粘贴多行代码会自动转为带文件上下文的 @-mention，`agent::PasteRaw` 可粘贴原文。（agent-panel.md:140-141）
- Claude Code 的 VS Code 扩展以 Option+K 插入 `@app.ts#5-10` 形式引用。选中文本自动可见，`claudeCode.attachSelection` 默认 true，需 v2.1.300+。（https://code.claude.com/docs/en/vs-code）
- Cursor 快捷键表列有 Cmd Shift L 为加入选区到对话，但同表 Cmd L/Cmd K 存在冲突。插入文本格式未核实。（https://cursor.com/docs/reference/keyboard-shortcuts）
- Claude Code IDE 工具名（PROTOCOL.md，claudecode.nvim commit 9aeedc9）：openFile、openDiff、getCurrentSelection、getLatestSelection、getOpenEditors、getWorkspaceFolders、getDiagnostics、checkDocumentDirty、saveDocument、closeAllDiffTabs、executeCode、close_tab。

#### Zed Agent 权限与运行
- 工具权限优先级从高到低：内置安全规则、always_deny、always_confirm、always_allow、工具级 default、全局 default（默认 confirm）。（https://zed.dev/docs/ai/tool-permissions）
- 版本分界：v0.224.0 起由 `agent.tool_permissions.default` 控制，早期由布尔 `agent.always_allow_tool_actions`（默认 false）控制。（zed docs tool-permissions.md:8-9）
- “Always for <tool>”为工具级；“Always for <pattern>”仅在能提取安全模式时可用；MCP 工具只支持工具级。（tool-permissions）
- 生成期间发送的消息默认排队。Steer 仅 Zed Agent 可用，外部 agent 因无法检测轮次边界而不支持。（agent-panel.md:67）
- 自动压缩默认开启，90% 触发；上下文窗口小于 80000 token 时无法自动压缩，并显示横幅。（agent-settings.md:62、69；agent-panel.md:161）
- 子 agent 默认继承父线程模型，可用 `agent.subagent_model` 覆盖。（agent-settings.md:159-161）

#### Claude Code 与 Alma 的审批
- Claude Code 权限模式为 default、acceptEdits、plan、auto、dontAsk、bypassPermissions。“Yes, and don't ask again”的范围按工具定：Bash 永久按仓库加命令，文件修改到会话结束，WebFetch 按仓库加域名。规则写入 `.claude/settings.local.json`，复合 Bash 按子命令各存一条。（https://code.claude.com/docs/en/permissions）
- Alma 四种审批动作为 allow_once、allow_always、deny、deny_with_reason，服务端对非法动作返回 400。allow_always 按线程记录键，如 `bash:thread:<id>:command:<cmd>`，存于模块级 Set。（alma-ref/app/alma-server/lib/server.mjs）

#### dim 的审批
- `ApprovalDecision` 只有 Allow 与 Deny，没有 allow-always。（dim-ref/crates/dim-agent-types/src/events.rs:33）
- CLI 中空回答视为拒绝；非交互运行遇到审批以非零状态退出。（dim-ref/README.md:111；session_host.rs:1223-1225）
- ADR 012（会话授权）、ADR 003（审批只约束模型工具调用）、ADR 009 均为 Proposed。ADR 017（Accepted）规定文件与工具审批合并为一次。（dim-ref/docs/adr/）

### 冲突与未核实
- **Vibe Kanban 公告标题（按抽查改正）**：标题为 “Goodbye bloop”，不是 “Vibe Kanban is sunsetting”。日期 2026-04-10、保留 30 天的事实成立。约 2026-05-10 的截止日期为推断，未核实。
- **Zed 线程存储可核实性冲突**：zed-agent 结论称本地 sparse checkout 无 agent crate，无法核实；thread-store 称 db.rs 与本地 b5cd310 “一致”，实际只核实了 commit hash，内容取自上游 gh api。以“未核实本地源码”为准。
- **“Zed 已实现 LSP window/showDocument”**：无对应证据，未核实。
- **Alma 动作集合**：“恰好四种”未核实，schema 字面量中还含 reject_once。allow_always 跨重启是否保留未核实。
- **dim ADR 018 是否取消 ADR 017 的覆盖项**：未核实。
- **dim settings.projects**：按抽查修正为 `Arc<Mutex<BTreeMap>>`，仅内存态的结论成立。
- **Crystal “Deprecated: February 2026” 标注**：未核实。
- **批量审批**：所查来源均未找到证据。
- **Cursor Cmd+L 行为**：版本间有争议，以本机版本为准。
- **未核实项**：Claude Code 编码规则（`.` 与空格）、Claude Code 回复中 file:line 链接规范、`@file#L10-20` 写法、VS Code Copilot `#selection` 语法、Cursor 插入文本格式、Zed 在 macOS 上的线程库路径。

### 对 Acard 的设计问题
1. **线程分组键**：用规范化 cwd 单键（dim 做法），还是 folder_paths 加 main worktree 双键（Zed 做法）以归并同仓库多 worktree？依据：Zed 另存 `main_paths`，dim 不以 git root 分组。
2. **worktree 策略**：是否默认启用，存于项目内 `.claude/worktrees` 还是 Acard 自有目录？归档遇到未提交改动时，是警告、强制先提交还是丢弃？依据：Claude Code 桌面版默认关闭，归档前警告。
3. **“始终允许”的范围**：收窄到会话加具体命令或路径（Alma 线程键、dim ADR 012），还是工具级（Zed）？依据：Claude Code 按工具定范围，Bash 永久、文件修改到会话结束。
4. **审批动作与边界**：采用允许一次、始终允许、拒绝、拒绝并说明原因四个动作，并把 hook、MCP 启动等配置类动作排除在智能体审批之外？依据：Alma 四动作，dim ADR 003 提议只约束模型工具调用。
5. **选区引用格式**：采用 `@path#START-END`（Claude Code 有文档示例），还是 Zed 式多行选区自动转 @-mention 并保留原文出口？依据：Claude Code 的 `#L` 写法未核实，Zed 的 PasteRaw 有文档。
6. **跟随开关**：“跟随 agent”是否做成显式开关并默认关闭？依据：Zed 文档为显式开关，开启后才跳转到 agent 读写的文件。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | zed-agent | 工具权限版本分界：v0.224.0 及以上由 agent.tool_permissions.default 控制，早期由布尔 agent.always_allow_tool_actions（默认 false）控制 | ~/Projects/lsp-ref/zed/docs/src/ai/tool-permissions.md 第 8-9 行原文一致。 |
| confirmed | zed-agent | 内置配置档三个：Write、Ask、Minimal | ~/Projects/lsp-ref/zed/docs/src/ai/agent-profiles.md 第 16-18 行列出 Write、Ask、Minimal。 |
| confirmed | zed-agent | Steer 仅对 Zed Agent 可用，外部 agent 不支持，因为无法检测轮次边界 | ~/Projects/lsp-ref/zed/docs/src/ai/agent-panel.md 第 67 行原文一致。 |
| confirmed | zed-agent | 自动压缩默认开启，阈值 90%；上下文窗口小于 80000 token 时无法自动压缩并显示横幅 | agent-settings.md 第 62、69 行为 90% 默认阈值；agent-panel.md 第 161 行为 80000 token 横幅规则。 |
| confirmed | zed-agent | 本地 sparse checkout 的 crates 中没有 agent 相关 crate，无法从源码核实线程存储 | 在 lsp-ref/zed/crates 下 ls \| grep -i agent 无结果。该结论与 thread-store 组引用的 gh api 上游源码需要区分来源。 |
| confirmed | sel-chat | Zed 编辑器右键菜单文案为 'Add to Agent Thread'，绑定 AddSelectionToThread | lsp-ref/zed/crates/editor/src/mouse_context_menu.rs 第 295 行 this.action("Add to Agent Thread", AddSelectionToThread)。 |
| confirmed | approval-ui | dim 协议层 ApprovalDecision 只有 Allow 与 Deny，没有 allow-always | ~/Projects/dim-ref/crates/dim-agent-types/src/events.rs 中 enum ApprovalDecision 仅 Allow、Deny；事件名 approval/request、approval/respond、approval/cancelled 均在第 1479-1480 行附近。 |
| confirmed | approval-ui | dim ADR 012（会话授权）仍为 Proposed，ADR 003、009 也为 Proposed，ADR 017、018 为 Accepted | docs/adr 下各文件第 3 行状态分别为 Proposed、Proposed、Proposed、Accepted、Accepted。但 ADR 018 'Accepted' 是否'取消 017 的两个覆盖项' 未在本次核实。 |
| partly | approval-ui | Alma 工具审批动作为 allow_once、allow_always、deny、deny_with_reason 四种，服务端白名单校验，非法值返回 400 | server.mjs 中确有 {error:"Invalid approval action"} 400 响应，且存在 allow_once、allow_always、deny_with_reason 分支；但同一文件的 schema 字面量列表还包含 reject_once 等值，'恰好四种' 未被证实，且 deny 是映射值而非独立白名单项。压缩 JS 中 grep 受限，只能部分核实。 |
| partly | thread-store | dim 的 settings.projects 是 BTreeMap<PathBuf, usize>，仅在进程内存中 | dim-app-server/src/settings.rs 第 191 行字段为 projects: Arc<Mutex<BTreeMap<PathBuf, usize>>>，即 BTreeMap 外包 Arc<Mutex>，内存态结论成立。 |
| partly | parallel-agents | Vibe Kanban 官方公告标题为 'Vibe Kanban is sunsetting'，日期 2026-04-10，远程服务保留 30 天后转为完全本地 | 正确标题是 'Goodbye bloop'（vibekanban.com/blog/shutdown 实际页面标题）。日期 2026-04-10、30 天保留、'找不到值得投入的商业模式' 的原因均属实。 |
| confirmed | parallel-agents | Vibe Kanban 仓库 stars 28617、最后 push 2026-11-04；latest release v0.1.44-20260424091429 发布于 2026-04-24 | gh api 返回 stargazers 28617、pushed_at 2026-11-04T11:52:09Z，latest release 为 v0.1.44-20260424091429，发布于 2026-04-24T09:46:55Z。 |
| confirmed | parallel-agents | Crystal latest release v0.3.5 发布于 2026-02-26，stars 3129，许可证 MIT | gh api 返回 v0.3.5 2026-02-26T22:26:05Z，stars 3129，license MIT License。未核实 README 中 'Deprecated: February 2026' 标注。 |
| confirmed | parallel-agents | Claude Code 桌面版 Worktree 默认关闭，worktree 默认在 <project-root>/.claude/worktrees/，可在 Settings > Code 修改；归档可能丢弃未提交 worktree 改动 | https://code.claude.com/docs/en/desktop 原文：'By default, Worktree is off'；'Worktrees are stored in <project-root>/.claude/worktrees/ by default'；本地会话可在 Settings > Code 设置 Worktree location；归档时可能丢失未提交改动，选 Archive anyway 或先提交。 |

题目之间的矛盾：

- zed-agent 结论称本地 sparse checkout 无 agent crate、线程存储无法核实；thread-store 第 1 条称 db.rs 'b5cd310 与本地 ~/Projects/lsp-ref/zed 一致'，但本地并没有 agent crate，这一'一致'实际只核实了 commit hash，并未核实 db.rs 内容。两组对 Zed 线程存储的可验证性表述相互冲突。
- push-ide 摘要称 'Zed 已实现 LSP window/showDocument'，但该组 facts 中没有任何对应证据条目，属于无依据的断言。
- approval-ui 把 Alma 动作描述为四种（与 relevance 建议的四动作内联卡片对齐），而 Alma 的 ACP schema 字面量列表还含 reject_once，两处关于 Alma 动作集合的说法不完全一致。
- parallel-agents 摘要称 Vibe Kanban 官方公告标题为 'Vibe Kanban is sunsetting'，与 blog 页面实际标题 'Goodbye bloop' 不符；其 relevance 中的停更风险判断本身仍成立。

全部事实见 [facts/B4.md](facts/B4.md)。
