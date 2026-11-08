## A4 客户端侧服务器生命周期

### 核心概念

**stdio 子进程传输**：客户端以子进程启动 LSP 服务器，stdin/stdout/stderr 均为管道，LSP 消息经 stdin/stdout 交换。
**Content-Length 帧**：LSP 基础协议的消息封装，头部为 `Content-Length`，以 `\r\n\r\n` 结束头部，后接 JSON 正文。
**kill_on_drop**：子进程句柄被丢弃时自动杀死进程，使宿主退出时服务器随之回收。
**入站队列背压**：入站消息队列有界，队列满时停止读取 stdout，由 OS 管道压住服务器的写入。
**tombstone**：Helix 中手动停止服务器后留下的空占位，阻止自动再启动，只能手动 restart。
**workspaceFolders**：LSP 3.6 起的多根工作区列表，已取代标注为弃用的 rootUri。
**root marker**：用于判定项目根的文件（如 Cargo.toml、pyproject.toml），编辑器从文件向上查找。
**positionEncoding**：客户端与服务器协商的列号单位，强制默认 UTF-16，3.17 起可协商 UTF-8 或 UTF-32。
**LanguageServerSeed**：Zed 的进程去重键，由 worktree、server 名、binary 与 initialization_options 设置、toolchain 组成。

### 关键事实

#### 启动与传输
- Zed 启动时 stdin/stdout/stderr 均为 piped 且 kill_on_drop(true)，工作目录为 root（root 为文件时取父目录）：`~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:515-560`
- Zed 解析 stdout 只读取 Content-Length 头，正文先按通知或请求反序列化，失败再按 id 查回调表，都失败则记 warn：`~/Projects/lsp-ref/zed/crates/lsp/src/input_handler.rs:17, 27-44, 83-130`
- Zed 入站队列容量 INCOMING_MESSAGE_QUEUE_CAPACITY=128，队列满时停止读 stdout 施加背压：`~/Projects/lsp-ref/zed/crates/lsp/src/input_handler.rs:27`，测试断言见 `input_handler.rs:147-178`
- Zed 出站消息经 BufWriter 写 Content-Length 帧后 flush，发送前触发 IoKind::StdIn 回调：`~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:826-860`
- Helix 每个 server 起三个 tokio 任务（读 stdout、读 stderr、写 stdin），子进程 current_dir 为 root_path，kill_on_drop(true)：`~/Projects/lsp-ref/helix/helix-lsp/src/transport.rs:44-95`，`~/Projects/lsp-ref/helix/helix-lsp/src/client.rs:211-240`

#### 请求超时与关闭
- Zed 请求超时默认 120 秒（DEFAULT_LSP_REQUEST_TIMEOUT_SECS=120），配置项 request_timeout 默认 120，0 表示不超时：`~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:45-55, 1666-1668`，`~/Projects/lsp-ref/zed/crates/project/src/project_settings.rs:132-150`
- Zed 超时后从回调表删除该 id 并返回 Timeout，通道被取消则返回 ConnectionReset：`~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:1600-1636`
- Zed shutdown 超时 SERVER_SHUTDOWN_TIMEOUT 为 5 秒，超时打印 warn 后继续排空输出；Drop 时在后台执行 shutdown：`~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:57-58, 1205-1260, 1826-1832`
- Zed 退出时并发关闭所有 server，没有空闲关闭逻辑：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:1422-1445, 5007`
- Helix 的 force_shutdown 不等待 shutdown 响应，子进程依赖 kill_on_drop 回收：`~/Projects/lsp-ref/helix/helix-lsp/src/client.rs:778-815, 804-812`

#### stderr
- Zed 的 stderr 由独立任务按行读取并转发 IoKind::StdErr 回调，运行期全程有效：`~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:791-823`
- Zed 的 stderr_capture 缓冲仅在启动期存在：成功时清空，失败时拼成 `{err}\n-- stderr --\n{log}` 并报 BinaryStatus::Failed：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:531, 743-764`
- Helix 的 stderr 任务只把内容写入日志，读取失败时记一次 error 后退出，没有重启逻辑：`~/Projects/lsp-ref/helix/helix-lsp/src/transport.rs:355-368`

#### 崩溃与重启
- Zed 的重启入口为 restart_all_language_servers 与 restart_language_servers_for_buffers：先 stop，再对仍注册的 buffer 以 Explicit 模式重新注册：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:12503-12511, 13120-13129, 13229-13275`
- Zed 未找到子进程退出监听或按次数的自动重启代码，崩溃后条目可能停留在 Running，直到用户 Restart 或 Stop（缺席式结论，未核实）：`~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:140, 718, 1206, 1212-1257`
- Zed 的指数退避 50×2^attempts（夹在 30 到 1000 ms）属于诊断请求重试，不是进程重启策略：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:15936-15946`
- Helix 的 restart_server 先对旧 client 调 force_shutdown 并移出，再启动新 client；`:lsp-stop` 留下 tombstone，get 不会自动重启：`~/Projects/lsp-ref/helix/helix-lsp/src/lib.rs:653-705`
- vscode-languageclient 默认 maxRestartCount 为 4，第 5 次崩溃且距第一次在 3 分钟内则 DoNotRestart；error() 在 count<=3 时返回 Continue；stop 默认超时 2000 ms（来源为 main 分支，非固定 commit）：`https://raw.githubusercontent.com/microsoft/vscode-languageserver-node/main/client/src/common/client.ts:1180, 456, 1623`

#### 进程去重与选择
- Zed 节点按 (worktree, 子根路径, server name) 缓存；根由 manifest 决定，找不到则回退到 worktree 根：`~/Projects/lsp-ref/zed/crates/project/src/manifest_tree/server_tree.rs:24-75`，`manifest_tree.rs:176-191`
- Zed 进程去重键为 LanguageServerSeed，seed 相同则共享进程，子根记入 project_roots：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:278-289, 448-512`
- Zed 同一语言可同时启用多个 adapter，集合与顺序由 settings 决定：`~/Projects/lsp-ref/zed/crates/project/src/manifest_tree/server_tree.rs:245-300`
- Helix 注册表按 server 名索引，每个名下为 Vec<Arc<Client>>，同名实例可因 root 不同而存在多个；复用依据 try_add_doc 的 root 比较：`~/Projects/lsp-ref/helix/helix-lsp/src/lib.rs:581-587, 705-752`，`client.rs:76-110`
- Helix 的 root 从文件出发向上取最顶层的 root marker，以 .git/.svn/.jj/.helix 为 workspace 上界：`~/Projects/lsp-ref/helix/helix-lsp/src/lib.rs:980-1030`，`~/Projects/lsp-ref/helix/book/src/languages.md:84-96`
- Helix 的 required-root-patterns 不匹配时静默不启动：`~/Projects/lsp-ref/helix/book/src/languages.md:99-105`，`helix-lsp/src/lib.rs:917-926`
- Helix 多 server 按 feature 路由，同一 feature 取数组中第一个支持者，diagnostics、completion 等则合并：`~/Projects/lsp-ref/helix/book/src/languages.md:218-242`，`~/Projects/lsp-ref/helix/helix-core/src/syntax/config.rs:381-383`

#### 二进制获取
- Zed 的解析顺序：用户已装（PATH 或 toolchain，受 allow_path_lookup 控制，不缓存），然后内存缓存（pre_release 一致时复用），再下载；下载失败回退旧缓存，否则 BinaryStatus::Failed：`~/Projects/lsp-ref/zed/crates/language/src/language.rs:~800-915`
- Zed 的 ty、ruff、pyrefly 忽略调用方的 pre_release，固定传 false：`~/Projects/lsp-ref/zed/crates/languages/src/python.rs:466, 2590, 2890`
- Zed 的 rust-analyzer 缓存目录为 `rust-analyzer-{tag}`，旁挂 .metadata 记录 digest，复用需 digest 相等且 --version 可执行：`~/Projects/lsp-ref/zed/crates/languages/src/rust.rs:838-925`
- Helix 没有自动安装路径，缺失二进制经 which 直接报错（推断）：`~/Projects/lsp-ref/helix/helix-lsp/src/client.rs:218-230`
- mason 的 GitHub release 路径不校验 asset 的 sha256，checksums.txt 只写入 info.json；PyPI 路径为 venv + pip，未加 --require-hashes：`~/Projects/lsp-ref/mason.nvim/lua/mason-core/installer/compiler/compilers/github/release.lua:44-48`，`lua/mason-core/installer/managers/pypi.lua:176-190`
- rust-analyzer 2026-11-02 的 aarch64-apple-darwin.gz 为 14307639 字节，GitHub API 给出 sha256 digest d10ca0a1…：`gh api repos/rust-lang/rust-analyzer/releases/tags/2026-11-02`
- ty 0.0.99 的 macOS arm64 wheel 为 13417256 字节，sha256 以 7cb88d3e7513dbf9 开头；pyrefly 1.4.1 的同类 wheel 为 14994348 字节：`https://pypi.org/pypi/ty/json`，`https://pypi.org/pypi/pyrefly/json`
- basedpyright 1.40.2 只有纯 Python wheel，requires_dist 含 nodejs-wheel-binaries>=20.13.1：`https://pypi.org/pypi/basedpyright/json`

#### 根与多根
- LSP 3.18：workspaceFolders 返回 null 表示只打开单个文件，空数组表示工作区未配置文件夹；rootUri 已弃用：`~/Projects/lsp-ref/language-server-protocol/_specifications/lsp/3.18/workspace/workspaceFolders.md`，`general/initialize.md:48-62, 87`
- rust-analyzer 对单一路径先找最近的 rust-project.json，再向上找 Cargo.toml，只有都找不到才向下扫一层；多个 workspace_roots 各自 discover 后去重：`~/Projects/lsp-ref/rust-analyzer/crates/project-model/src/lib.rs:133-175, 188-196`
- rust-analyzer 的 linkedProjects 非空时关闭自动发现：`~/Projects/lsp-ref/rust-analyzer/crates/rust-analyzer/src/config.rs:2254-2262`
- ty_server 每个 workspace folder 建一个 ProjectDatabase，注释标明嵌套项目支持尚未实现：`~/Projects/lsp-ref/ruff/crates/ty_server/src/session.rs:760-800`
- pyright 每个 workspaceFolders 项一个 service；LSP 模式下找配置不向上回溯：`~/Projects/lsp-ref/pyright/packages/pyright-internal/src/workspaceFactory.ts:116-170`，`analyzer/service.ts:783-800`

#### 位置编码
- LSP 3.17 唯一强制编码为 utf-16；客户端经 general.positionEncodings 声明偏好，服务器在 capabilities.positionEncoding 中选定，省略则为 utf-16：`~/Projects/lsp-ref/language-server-protocol/_specifications/lsp/3.17/types/textDocuments.md:7`，`3.17/general/initialize.md:652-661`
- Zed 只声明 [UTF16]，位置在 `~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:893`（抽查修正，原写 862-880）
- Helix 声明顺序为 UTF8、UTF32、UTF16，非法值回落 utf-16：`~/Projects/lsp-ref/helix/helix-lsp/src/client.rs:757-761, 413-425`
- ty 与 rust-analyzer 会协商到 UTF-8（ty 优先级 UTF16<UTF32<UTF8；rust-analyzer 遇到 utf-8 立即选用）：`~/Projects/lsp-ref/ruff/crates/ty_server/src/document.rs:49-62`，`~/Projects/lsp-ref/rust-analyzer/crates/rust-analyzer/src/lsp/capabilities.rs:292-307`
- pyrefly 在 initialize 中硬编码 UTF16，不协商：`~/Projects/lsp-ref/pyrefly/pyrefly/lib/lsp/non_wasm/server.rs:1650`
- Zed 发送增量变更时以 PointUtf16 计列，文本先做 LF 归一化，行尾变化时整文档重同步：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:9694-9730`

#### 状态与日志（Zed）
- LanguageServerStatus 包含 name、server_version、pending_work、binary、worktree、process_id 等字段：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:4779-4793`
- LspButton 状态灯汇总 binary 状态（Failed、Starting、Stopping）与 ServerHealth（Ok、Warning、Error）；菜单含 Restart Server、Stop Server、View Logs：`~/Projects/lsp-ref/zed/crates/language_tools/src/lsp_button.rs:363-370, 224-320`
- 日志按 server 保存，MAX_STORED_LOG_ENTRIES=2000，为环形缓冲：`~/Projects/lsp-ref/zed/crates/project/src/lsp_store/log_store.rs:23-24, 141-142`

### 冲突与未核实
- **stderr 表述冲突（已统一）**：zed-lsp 称「只在启动阶段按行捕获」，procmgmt 称「只在启动失败时输出」。两者实为不同通道：启动期 stderr_capture 缓冲仅启动期存在；按行转发给 StdErr 回调则全程进行。
- **Zed 无崩溃自动重启（未核实）**：zed-store 与 procmgmt 的结论为缺席推断，未逐一排查退出监听。
- **vscode「5 次」疑问已撤销**：4 次重启后的第 5 次崩溃即 DoNotRestart，与「5 次/3 分钟」一致；WebFetch 摘要的数值正确。
- **未核实**：Zed 的 github_releases crate 不在稀疏检出中，latest_github_release 的签名与 digest 校验实现未核实。
- **未核实**：扩展的 language_server_command 接入 LspStore 的路径（extension_host 不在检出中）。
- **未核实**：ty 在单进程内同时管理多个 root 的行为。ty 每个 folder 一个 DB 已确认，procmgmt 中的多根描述未证实。
- **未核实**：basedpyright 的多根实现；pyright 的位置编码行为（推断依赖 vscode-languageserver 默认值）。
- **未核实**：BinaryStatus 与 ServerHealth 的枚举定义不在本地检出中，仅见使用侧。
- **未核实**：mason 在 macOS 的根目录 ~/.local/share/nvim/mason 为推断；ty、pyrefly wheel 内二进制路径未验证。
- **未核实**：attention native/ 是否已有 UTF-16 列换算代码。

### 对 Acard 的设计问题
1. 服务器崩溃后是否自动重启？若要，采用 vscode 式「4 次加 3 分钟窗口」，还是 Zed 式「仅手动 Restart」？依据：Zed 未见自动重启代码（未核实），vscode 默认 maxRestartCount 为 4。
2. 实例键取 Zed 式 (worktree, 子根, server 名, 设置) 去重，还是 Helix 式 (server 名, root) 复用？依据：Zed 以 LanguageServerSeed 共享进程，Helix 按 root 复用 Client。
3. 多文件夹项目是把每个文件夹作为独立 workspaceFolder 传入，还是传父目录由服务端发现？依据：rust-analyzer 只向上找最近的 Cargo.toml、向下只扫一层；ty 每个 folder 一个 ProjectDatabase 且不拆嵌套项目。
4. 位置编码只宣告 UTF-16（Zed 式，Go 侧需做列换算），还是优先宣告 UTF-8 并保留回落？依据：pyrefly 硬编码 UTF-16，ty 与 rust-analyzer 会选 UTF-8，两种情况都要处理。
5. 语言服务器二进制是否自动下载？依据：Helix 不做自动安装；mason 下载不校验 sha256，而 GitHub API 提供 digest，Acard 可自行校验。
6. 是否纳入 basedpyright？依据：它依赖 nodejs-wheel-binaries，需要 Node 运行时随 pip 引入。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | zed-lsp | Zed 入站消息队列容量为 INCOMING_MESSAGE_QUEUE_CAPACITY = 128，队列满时停止读 stdout 以施加背压，测试断言缓冲数不超过 130 | input_handler.rs:27 定义 `pub(crate) const INCOMING_MESSAGE_QUEUE_CAPACITY: usize = 128`；注释说明满时读取端停止读取、由 OS 管道施加背压；测试 input_handler.rs:147-178 断言 received <= 128+2（即 130）。 |
| confirmed | zed-lsp | 默认请求超时 DEFAULT_LSP_REQUEST_TIMEOUT_SECS = 120 秒，0 表示不超时 | lsp.rs:45-55 常量为 120；lsp.rs:1666-1668 request_timeout_future 对 Duration::MAX 或 Duration::ZERO 返回 future::pending()，即无超时。 |
| confirmed | zed-lsp / zed-store / procmgmt | 服务器 shutdown 超时 SERVER_SHUTDOWN_TIMEOUT = 5 秒 | lsp.rs:58 `SERVER_SHUTDOWN_TIMEOUT = Duration::from_secs(5)`，lsp.rs:1218/1225 用于 shutdown 的 select 计时。另 lsp_store.rs:176 有 SERVER_LAUNCHING_BEFORE_SHUTDOWN_TIMEOUT 同为 5 秒，zed-store 的 gap（未核对取值）可以关闭。 |
| partly | zed-lsp | client 的 initialize 只声明 positionEncodings = [UTF16] | 内容正确：lsp.rs:893 `position_encodings: Some(vec![PositionEncodingKind::UTF16])`。但 zed-lsp 的行号 862-880 有误，正确位置是 lsp.rs:893。 |
| confirmed | zed-lsp | textDocument.diagnostic 与 workspace.diagnostics 只在 pull_diagnostics 为真时才广告 | lsp.rs:914 `diagnostics: pull_diagnostics.then_some(...)` 与 lsp.rs:1110 `diagnostic: pull_diagnostics.then_some(DiagnosticClientCapabilities{...})`。 |
| partly | zed-lsp / procmgmt | stderr 只在启动期间捕获到 stderr_capture；启动成功时 take 清空，启动失败时拼接为 '-- stderr --' 并以 BinaryStatus::Failed 报告 | capture 缓冲的生命周期正确：lsp_store.rs:531 初始化为 Some，:743 成功路径 take，:748 失败路径 take 后随错误输出。但 zed-lsp 的摘要称“stderr 只在启动阶段按行捕获”，把两件事混在一起：fact 11 说明 stderr 任务按行读取并在整个进程生命周期转发给 IoKind::StdErr 回调（未核对 handle_stderr 的 791-823 行）。只有 capture 缓冲是启动期专属。拼接格式的行号是 748 而非 745-760 所述，但语义一致。 |
| confirmed | zed-lsp / zed-install / zed-store | ty、ruff、pyrefly 的 GitHub 版本查询忽略调用方的 pre_release，固定传 false | python.rs:466 `latest_github_release("astral-sh/ty", true, false, ...)`，参数 `_: bool` 在 python.rs:462；ruff python.rs:2590 与 pyrefly python.rs:2890 同样传 false，签名参数为 `_: bool`（:2586、:2886）。 |
| confirmed | helix-view / helix-ui | jumplist 容量 JUMP_LIST_CAPACITY = 30；LanguageServerFeature 枚举共 21 项 | view.rs:25 `const JUMP_LIST_CAPACITY: usize = 30`；对 helix-core/src/syntax/config.rs 的 LanguageServerFeature 枚举按行计数得 21，与报告一致（计数为脚本统计，非逐行人工核对）。 |
| confirmed | encoding | pyrefly 服务端在 initialize 中硬编码返回 positionEncoding = UTF16，不协商 | pyrefly/pyrefly/lib/lsp/non_wasm/server.rs:1650 `position_encoding: Some(PositionEncodingKind::UTF16)`，未见协商分支。 |
| confirmed | acquire | rust-analyzer 2026-11-02 的 aarch64-apple-darwin.gz 大小 14307639 字节，GitHub API digest 为 sha256:d10ca0a1... | gh api releases/tags/2026-11-02 返回 name=rust-analyzer-aarch64-apple-darwin.gz、size=14307639、digest=sha256:d10ca0a10e386f74ca36847b3df2ad5ab6f1328feeb1591467b3724f3fd8e8cf，与报告完全一致。 |
| confirmed | acquire | ty 0.0.99 的 macOS arm64 wheel 为 13417256 字节，sha256 前缀 7cb88d3e7513dbf9，上传于 2026-11-06 | PyPI JSON：ty-0.0.99-py3-none-macosx_11_0_arm64.whl，size 13417256，sha256 7cb88d3e7513dbf9…，upload_time 2026-11-06T10:11:26。 |
| confirmed | procmgmt | vscode-languageclient 默认 maxRestartCount 为 4；第 5 次崩溃且与第一次的时间差在 3 分钟内则 DoNotRestart；error() 在 count<=3 时 Continue；stop 默认超时 2000 ms | 已读 vscode-languageserver-node client/src/common/client.ts（main 分支，WebFetch 摘要的数值正确）：line 1180 `maxRestartCount ?? 4`；closed() 中 restarts.length <= maxRestartCount 则 Restart，否则若 3*60*1000 ms 内则 DoNotRestart（即第 5 次崩溃）；error() line 456 count<=3 返回 Continue；shutdown 默认 timeout 2000（line 1623）。procmgmt 中“与题目 5 次不符”的疑问应撤销：5 次是 4 次重启后的第 5 次崩溃，两者一致。注意这是 main 分支而非固定 commit。 |
| confirmed | helix-lsp / procmgmt | Helix force_shutdown 为 fire-and-forget，不等待 shutdown 响应，子进程依赖 kill_on_drop 回收 | helix-lsp/src/client.rs:804-812 force_shutdown 构造 Shutdown 请求后用已丢弃接收端的 channel，注释明确 “we do not wait for a reply”；kill_on_drop 的设置未在本次核对。 |
| confirmed | zed-lsp | 子进程启动时 kill_on_drop(true) | lsp.rs:548 `.kill_on_drop(true)`；stdin/stdout/stderr piped 未在本次核对。 |
| confirmed | nvim | nvim-lspconfig 的 ty 配置：cmd {'ty','server'}，filetypes python，root_markers 为 ty.toml、pyproject.toml、setup.py、setup.cfg、requirements.txt、.git | lsp/ty.lua 的 cmd、filetypes、root_markers 与报告一致（行号 9-13，报告写 11-13，为小偏差）。 |

题目之间的矛盾：

- zed-lsp 的 fact 15 把 positionEncodings 写在 lsp.rs:862-880，而 zed-encoding 写的是 lsp.rs:893。源码确认在 893，zed-lsp 的行号有误。
- zed-lsp 摘要称 stderr“只在启动阶段按行捕获”，而 zed-lsp fact 11 称 stderr 任务全程按行转发给 IoKind::StdErr 回调。procmgmt fact 1 与 zed-lsp 的说法也不同：procmgmt 说 Zed“只在启动失败时输出 stderr”。这些是不同通道（启动捕获缓冲、运行期回调、UI 错误），但表述相互打架，需要统一为“捕获缓冲仅启动期、转发回调全程”。
- zed-store gap 写“未核对 SERVER_SHUTDOWN_TIMEOUT 取值”，zed-lsp 与 procmgmt 都已给出 5 秒。本次核对确认为 5 秒，两处结论一致，gap 可以关闭。
- procmgmt fact 12 写“与题目 5 次不符，需核对”。源码（client.ts 的 closed()）表明：4 次重启后的第 5 次崩溃，若在 3 分钟内即 DoNotRestart，与“5 次/3 分钟”一致，WebFetch 摘要无误。这一“不一致”应撤销。
- zed-store 与 procmgmt 都称 Zed 无崩溃自动重启，属于缺席式结论。本次未逐一排查 lsp_store.rs 的退出监听，因此该点未能证实，仅能确认已读到的部分。
- encoding 与 zed-lsp 对 Zed 的 UTF-16 声明是一致的（均为 lsp.rs:893 附近），但 encoding 说 Zed 发送增量变更用 PointUtf16，与 positionEncodings 的 UTF-16 一致，无冲突。

全部事实见 [facts/A4.md](facts/A4.md)。
