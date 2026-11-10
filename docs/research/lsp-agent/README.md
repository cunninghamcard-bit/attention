# 代码导航与智能体接入：调研总览

- 日期：2026-11-09
- 用途：先和你确认核心概念与领域边界，再进入 RFC。本文只陈述事实和待定问题，不做决定。
- 方法：101 个窄题目，各由一个 Haiku 代理调研，要求每条事实附来源（`path:line` 或 URL）。每组再由一个代理抽查关键说法，一个代理综合。共 121 个代理，产出 2041 条事实。参照仓库为浅克隆，放在 `~/Projects/lsp-ref/`、`~/Projects/dim-ref/`、`~/Projects/alma-ref/`。

## 1. 边界

| | 内容 |
|---|---|
| 范围内 | Rust 与 Python 的读侧代码智能：跳转到定义、声明、类型定义和实现，引用，悬停，文件与工作区符号，调用层次与类型层次，语义高亮，内联提示，折叠，诊断的显示 |
| 范围内 | 客户端侧的语言服务器生命周期：获取二进制、启动、按根目录分实例、崩溃重启、位置编码 |
| 范围内 | 不用 LSP 的导航：tree-sitter tags 与 locals、ctags、SCIP 离线索引、stack graphs、基于搜索的启发式 |
| 范围内 | 阅读型 UI：peek、引用面板、导航历史；mygo 编辑器现有的钩子；attention 旧的 LSP 分支 |
| 范围内 | 智能体：dim（arcships/dim）的接入方式，Alma 的多智能体设计，智能体如何把内容推到 Acard 的界面 |
| 范围外 | 写侧 LSP（补全、重命名、格式化、code action、signature help）、DAP、给智能体用的代码智能（Serena、LSP MCP）、ACP |

## 2. 核心概念

**读侧 LSP**
- **读侧方法**：上面「范围内」第一行列出的 LSP 请求。它们都不修改代码。
- **positionEncoding**：LSP 位置里列号的计量单位，有 utf-8、utf-16、utf-32 三种。不协商时默认 utf-16。Go 的字符串按 UTF-8 字节存储，所以只要服务器用 utf-16，Go 端就要换算。
- **didOpen / didClose**：客户端告诉服务器「这个文件归我管」的通知。协议要求客户端必须发送；只读阅读器也要发。

**语言服务器**
- **rust-analyzer**：Rust 官方语言服务器。功能最全，内存常驻。
- **rust-glancer**：实验性的轻量 Rust 语言服务器。做法是索引一次后冻结，按 package 写进磁盘缓存。
- **ty**：Astral 用 Rust 写的 Python 类型检查器，内置语言服务器，运行 `ty server` 启动。
- **pyright / basedpyright / pyrefly / jedi**：其他 Python 语言服务器。前两个依赖 Node。

**不用 LSP 的导航**
- **tree-sitter tags**：用查询文件（`tags.scm`）从语法树里抓「定义」和「引用」，只按名字匹配，不做名字解析。
- **locals**：tree-sitter 的单文件作用域查询（`locals.scm`），只能在一个文件内解析局部变量。
- **ctags**：外部程序，扫源码后输出符号表（名字、种类、所在作用域）。不输出引用。
- **SCIP**：Sourcegraph 的离线索引格式，记录每个符号出现在哪里、是定义还是引用。由 `rust-analyzer scip`、`scip-python` 这类索引器生成。
- **stack graphs**：GitHub 的跨文件名字解析方案，用 TSG 规则逐种语言描述。已不再维护。
- **启发式与精确**：启发式结果是「所有同名的候选」，精确结果是「这一处真正指向的那一个」。

**Acard 宿主**
- **mygo 编辑器钩子**：`ui/editor` 已经提供的回调和回填接口：`OnDefinition`（Cmd+click）、`OnHover`/`ShowHover`、`SetDiagnostics`、`SetInlays`。
- **Nav**：attention 统一的定位结构 `tabtypes.Nav{Line,To,Col,Len}`。gotoline、大纲、搜索和 CLI 都用它。

**dim**
- **Timeline**：dim 的事件时间线。一个会话的一切事实都按顺序记在上面。
- **branch**：同一会话里从某一点分出的子线，继承分出点之前的历史。
- **member**：协作里的另一个独立会话，不继承历史。
- **App Server / protocol v3**：dim 的守护进程，以及它对客户端开放的 NDJSON RPC 协议，监听 `<home>/rust/daemon.sock`。
- **UI leaf**：dim 终端界面和守护进程之间的 rutis 会话。它只承担生命周期，业务仍然走 protocol v3。

**rutis**
- **loader row**：rutis 配置里的一个插件条目。
- **连接行**：rutis-host 接入另一个进程的配置条目，有 dial、listen、spawn 三种。
- **rutis-host**：Rust 写的宿主进程，attention 现在由它拉起 Go 二进制。

**Alma**
- **子 agent**：挂在父消息的 Task 工具调用上（`parentToolCallId`），没有独立线程。
- **reference_open**：agent 让界面打开某个内容的调用。它只发出去，不等回执。

## 3. 事实带来的结论

### 3.1 不用 LSP 能跳转，但只能给出同名候选

- tree-sitter tags 只认名字。
  - Rust 的 `tags.scm` 不捕获 `const`/`static`、enum 变体、`use` 声明，也不捕获 `Type::new()` 这类带路径的调用。
  - Python 的 `tags.scm` 只有 14 行，不区分方法，也不捕获 import、继承和 `self` 属性。
  - 详见 [A5](A5-non-lsp-navigation.md)。
- GitHub 的基于搜索的导航正是这个做法。GitHub 自己的博客也承认它「can result in a lot of noise」。
- tags 每次都整文件重新解析，不是增量的。
- 精确解析（trait 方法分派、`pub use` 重导出、Python import）需要语义分析，有两条路：
  - **SCIP 离线索引**：`rust-analyzer scip` 一次索引整个 cargo workspace，单线程，没有增量。issue #18140 报告它在 mozilla-central 上跑了约 1175 秒。
  - **stack graphs**：只有 Python 的规则（1377 行），没有 Rust。README 声明已不再由 GitHub 维护，最后一次发布在 2024-12-13。
- 所以，不用 LSP 的那一层适合做三件事：大纲、单文件内跳转、「同名候选」列表。跨文件的精确跳转仍然需要语言服务器或 SCIP。

### 3.2 Go 端不能用 cgo

- mygo 在 `AGENTS.md:14` 规定所有代码都要能在 `CGO_ENABLED=0` 下构建。mygo CLI 构建时，如果没有设置 `CGO_ENABLED`，会默认设成 0（`cmd/mygo/proc.go:74`）。attention 锁定的 v0.7.2 和最新的 v0.7.5 都是这样（已亲自复核）。
- 所以官方的 go-tree-sitter（cgo）和 smacker/go-tree-sitter（cgo）都不能直接用。可选的路有三条：
  - **gotreesitter**：纯 Go、MIT，v0.57.0 于 2026-11-08 发布，内置 206 种语法。其中有 GPL-3.0 和 MPL-2.0 的语法，要裁掉。
  - **外部 ctags 二进制**。
  - **purego**：在运行时加载 tree-sitter 的 dylib。attention 已经间接依赖 purego v0.11.1。

### 3.3 mygo 编辑器已有跳转和悬停的钩子

- 已有的接口：
  - `OnDefinition`（Cmd+click）、`OnHover`/`ShowHover`；
  - `SetDiagnostics`：带版本号，编辑后会迁移偏移；
  - `SetInlays`、`OnGutterClick`。
- 缺少的接口：references、peek、调用层次、文件与工作区符号、语义高亮，以及可点击的范围装饰。按 CLAUDE.md 的规则，这些要加在共享原语上。
- 高亮用的是手写的词法器，内置 32 种语言，包括 Rust 和 Python。`TokenKind` 共 25 种，没有 parameter、namespace 这类细分。
- attention 现状：
  - textdoc 用 `ReadOnly:true` 打开文件，没有接任何回调；
  - Cmd+click 那个分支不检查 readOnly，只读视图里也会触发 `OnDefinition`；
  - main 上的 `native/` 没有任何 LSP 代码。
- 详见 [A6](A6-editor-and-reading-ui.md)。
- TS 旧线已经做过一版 LSP（提交 fa555f2，分支 `feat/language-servers`，不在 main 上）：
  - 功能：F12 跳转定义、Shift+F12 引用面板、悬停。
  - Python 服务器按 ty、pyrefly、basedpyright、pyright 的顺序回落。
  - 崩溃后 60 秒内最多重启 3 次，空闲 5 分钟关闭；会话键是根目录加语言组。

### 3.4 Rust 服务器：rust-glancer 内存省，功能少一些

| | rust-glancer v0.4.0（2026-10-21） | rust-analyzer（每周发布，最新一版 2026-11-02） |
|---|---|---|
| 读侧方法 | definition、typeDefinition、implementation、references、hover、documentHighlight、文件与工作区符号、semanticTokens、inlayHint、folding | 左列全部，另有 declaration、callHierarchy、selectionRange、semanticTokens delta，以及 pull 诊断 |
| 没有的 | callHierarchy、typeHierarchy | typeHierarchy |
| 位置编码 | 固定 utf-16 | 客户端提出 utf-8 时选 utf-8 |
| 项目发现 | 只认单一的 Cargo.toml 根；没有 rust-project.json，没有 linkedProjects | 一个文件夹可以发现多个 workspace，也支持 rust-project.json 和 linkedProjects |
| 构建脚本 | 不执行，沿用 target 下已有的产物 | `buildScripts` 或 `procMacro` 任一打开就会执行 |
| 缺 rust-src 时 | 只记日志，此时没有 std 导航 | 自动执行 `rustup component add rust-src` |
| 内存 | 以 rust-analyzer 仓库为样本，索引完成后常驻约 53 MiB（`MEMORY.md:131`）；索引过程中峰值 1.8–3.1 GB，取决于宏展开用 2 个线程还是 16 个（`MEMORY.md:229-230`） | 常驻，随项目增长 |
| 分发 | GitHub Release，每个平台压缩后约 10–11 MB；磁盘缓存放在 `target/rust_glancer` | rustup component，或 GitHub Release（13.6–17.2 MiB） |

详见 [A2](A2-rust-servers.md)。注意：A2 第一个设计问题把「<100MB」说成只是目标。准确的说法是：索引完成后的常驻内存有实测表支撑，峰值指的是索引过程中的瞬时值。

### 3.5 Python 服务器：ty 的读侧覆盖最全，但仍是 Beta

- ty 0.0.99 于 2026-11-06 发布，仍是 0.0.x Beta，README 写明没有稳定 API。它是单一原生二进制，读侧方法里只缺 codeLens。
- pyrefly 1.4.1 于 2026-11-04 发布，从 1.0 起标为 STABLE。读侧覆盖和 ty 相当，但只能通过 pip、uv 这类 Python 包管理器安装。
- pyright 1.1.414 依赖 Node，缺 implementation、typeHierarchy、semanticTokens 和 inlayHint。
- basedpyright 要带上 Node；在 macOS arm64 上两个 wheel 压缩后合计约 70 MB。
- Zuban 是 AGPL-3.0 与商业双许可。
- 详见 [A3](A3-python-servers.md) 的能力表。

### 3.6 dim：业务流量都走 protocol v3

- dim 对客户端开放的是 App Server 的本地 NDJSON RPC v3：
  - 地址：Unix socket `<home>/rust/daemon.sock`；
  - 握手：hello 时检查协议版本和能力；
  - 审批：通过 `approval.request` 和 `approval.respond`。
- 线协议只定义在 Rust 的 `protocol.rs` 里，仓库里没有 Go 客户端；`dim-client` 约 1312 行 Rust。
- 「dim 同样是 rutis 插件架构」，事实是这样的：
  - dim 用 rutis 组织自己内部的插件，rutis 版本锁定 0.19.3。attention 锁的伪版本比它晚 103 个提交，但两边的 `ENDPOINT_PROTOCOL` 都是 4。这只是从常量推断，没有做过互通测试。
  - dim 的终端界面和守护进程之间有一个 rutis 会话（UI leaf），它承担生命周期。会话两端互相屏蔽插件目录，谁也不能在对方那里运行插件，业务流量照样走 protocol v3（`docs/design/plugins/Tui.md` §3.6，已亲自复核）。
  - 不过按 dim 的规则，每个 rutis 会话都会把进程级共享名和监听名导出给对端，事件总线也跨会话投递。UI leaf 能调用这些名字（`docs/design/rutis-usage.md:212-214`、`:262-266`，已亲自复核）。所以在 UI leaf 这种形态下，服务和事件是互通的。
  - rutis 的 Go SDK 只有插件侧的 API，例如 `advanced.ServeConn`，没有宿主 API（`go/rutis/public-api.txt`）。dim 的 UI leaf 目前是 Rust 写的 `dimcode` 进程。Go 进程能否作为被 dim 拨入的那一端，并带着自报的 id 完成握手，以及守护进程会不会调用对端提供的名字，都没有核实。
- 所以两种接入方式的现状是：
  - **Acard 当 dim 的客户端**：现在就能做，代价是用 Go 实现 protocol v3。
  - **经 rutis 会话互通，即 Acard 作为 UI leaf 一类的对端**：机制上存在名字导出和跨会话总线，但 dim 只给终端界面设计过这个入口，Go 端能否接入没有核实，需要验证并和上游商定。
- 详见 [B1](B1-dim.md)、[B2](B2-rutis-and-integration.md)。

### 3.7 多智能体有三种形态

| | 子智能体是什么 | 历史 | 审批 |
|---|---|---|---|
| dim branch | 同一会话里的子线；只有 main 能开，开出的线是叶子 | 继承分出点之前的历史 | 跟着会话走 |
| dim member | 另一个独立会话，不能再委派；每个成员同一时间只做一个任务 | 不继承 | 转回发起委派的那条分支 |
| Alma 子 agent | 挂在父消息的 Task 工具调用上，没有独立线程 | 留在父线程里 | Alma 有允许一次、始终允许、拒绝、拒绝并说明原因四个动作 |

另外：
- dim Scheduler 最多同时跑 8 个任务。
- Alma 的主 agent 默认最多 20 步，子 agent 最多 100 步，工具集按类型裁剪。详见 [B1](B1-dim.md)、[B3](B3-alma-multi-agent.md)、[B4](B4-other-references.md)。

### 3.8 推送到界面：现有的 open 命令不够用

- Acard 的 CLI 是一行 JSON 请求、一段纯文本应答。
- `open` 只透传 line 和 to，没有 col、len 和分屏参数；分屏只能经 `command id=workspace:split-vertical` 触发，而且不能带参数。
- 除了 search，其他命令都没有 JSON 应答。
- Alma 的 `reference_open` 也是只发不收，没有回执。
- 详见 [B2](B2-rutis-and-integration.md)。

## 4. 待你确认的问题

1. **导航分几层。** 有两种做法：
   - 分两层：先用不依赖 LSP 的启发式层（同名候选，界面上标注「启发式」，只有唯一候选时才直接跳），语言服务器起来后再换成精确结果。
   - 只做语言服务器。
   - 依据：§3.1。启发式层零启动成本；GitHub 和 dumb-jump 都只在单一候选时直接跳。
2. **tree-sitter 在 Go 里怎么跑。** 依据：§3.2，cgo 被禁。可选：
   - gotreesitter（纯 Go，要裁掉 GPL/MPL 语法）；
   - 外部 ctags 二进制；
   - purego 加载 dylib；
   - 不用 tree-sitter，留着 mygo 现有的词法器。
3. **Rust 默认用哪个服务器。** 依据：§3.4。
   - 选项 A：默认 rust-glancer，rust-analyzer 作为可选项。这样会缺调用层次，也不支持多 workspace。
   - 选项 B：只用 rust-analyzer。
4. **Python 默认用哪个服务器。** 依据：§3.5。
   - 选项 A：默认 ty，锁定版本，回落到 pyrefly 或 pyright。
   - 要不要直接排除 Zuban（AGPL）和 basedpyright（要带 Node）？
5. **服务器的获取与生命周期。** 依据：A4，以及旧 TS 线的做法。
   - 二进制来源：自动从 GitHub Release 下载并自己校验 digest，还是只从 PATH 和用户配置里找？
   - 缺 rust-src 时：只提示用户，还是像 rust-analyzer 那样自动装？
   - 实例粒度：按「项目 × 语言」开实例（RFC 0006 的项目是单一目录）？
   - 崩溃后：沿用旧 TS 线的「60 秒内 3 次」重启和空闲 5 分钟关闭？
6. **dim 怎么接。** 依据：§3.6。
   - 现在先用 Go 写 protocol v3 客户端，连 `daemon.sock`？
   - 要不要先验证 Go 进程能否像 UI leaf 那样和 dim 守护进程建立 rutis 会话？验证可行，再和上游商定让 dim 插件调用 Acard 的服务。
   - Acard 给智能体的工具（打开到某一行、分屏、读取当前选区）放在哪里：注册为 dim 的工具插件（ToolRegistry），还是走 MCP？
7. **Chat 标签里子智能体怎么呈现。** 依据：§3.7。
   - 选项 A：像 Alma 那样嵌在父线程的工具调用里。
   - 选项 B：像 dim member 那样作为独立会话，Acard 给它单独开一个标签。
   - 线程按什么分组：用规范化的 cwd 作为单键，还是同时记录 git 主 worktree（Zed 的做法）？
8. **推送协议。** 依据：§3.8。
   - 要不要给 CLI 的 `open` 补上 col、len、split 和 JSON 回执？
   - 选区引用用什么格式：`@path#L12-30`，还是 Alma 的「— path:L12-30」？

## 5. 文档索引与可信度

| 组 | 综合 | 原始事实 |
|---|---|---|
| A1 LSP 协议（读侧） | [A1-lsp-protocol.md](A1-lsp-protocol.md) | [facts/A1.md](facts/A1.md) |
| A2 Rust 语言服务器 | [A2-rust-servers.md](A2-rust-servers.md) | [facts/A2.md](facts/A2.md) |
| A3 Python 语言服务器 | [A3-python-servers.md](A3-python-servers.md) | [facts/A3.md](facts/A3.md) |
| A4 客户端侧生命周期 | [A4-client-lifecycle.md](A4-client-lifecycle.md) | [facts/A4.md](facts/A4.md) |
| A5 不依赖 LSP 的导航 | [A5-non-lsp-navigation.md](A5-non-lsp-navigation.md) | [facts/A5.md](facts/A5.md) |
| A6 mygo 编辑器、attention 现状、阅读型 UI | [A6-editor-and-reading-ui.md](A6-editor-and-reading-ui.md) | [facts/A6.md](facts/A6.md) |
| B1 dim | [B1-dim.md](B1-dim.md) | [facts/B1.md](facts/B1.md) |
| B2 rutis 与集成方向 | [B2-rutis-and-integration.md](B2-rutis-and-integration.md) | [facts/B2.md](facts/B2.md) |
| B3 Alma 多智能体 | [B3-alma-multi-agent.md](B3-alma-multi-agent.md) | 不入库：Alma 是闭源软件，原始事实里有其 bundle 的代码片段，只存本地 `~/Projects/alma-ref/notes/facts-B3.md` |
| B4 其他参照 | [B4-other-references.md](B4-other-references.md) | [facts/B4.md](facts/B4.md) |

可信度说明：
- 每组综合后附有抽查记录。10 组共抽查 187 条：156 条确认，18 条部分正确，5 条错误（已在综合里改正），8 条无法核实。
- `facts/` 是代理的原始产出，只被抽查了约 9%。引用之前要回到来源核对。
- 以下关键结论已由我亲自复核：mygo 禁用 cgo（两个版本）、rust-glancer 内存数字的上下文、gotreesitter 是否存在、dim UI leaf 的职责。
- 时间敏感的状态（ty 的 Beta 状态、各项目的版本号、stack graphs 的维护状态）以 2026-11-09 为准。
