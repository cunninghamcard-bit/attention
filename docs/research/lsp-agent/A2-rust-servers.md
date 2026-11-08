## A2 Rust 语言服务器

（下文路径缩写：rg = ~/Projects/lsp-ref/rust-glancer，ra = ~/Projects/lsp-ref/rust-analyzer）

### 核心概念

**rust-glancer**：实验性 Rust LSP 实现，目标是低内存与近乎瞬时的编辑器重启，自述约 90% 完整。
**冻结式工作区（frozen workspace）**：一次性索引并落盘，查询时按 package 加载，事务结束即释放；变更需重新索引。
**包级卸载（package offload）**：索引结果写入文件系统，查询时只加载相关 package。
**engine 子进程**：rust-glancer 每个 workspace 对应一个 engine 进程，LSP 服务器作为编排层，经 tarpc 通信。
**ra_ap_ide**：rust-analyzer 每周自动发布到 crates.io 的 IDE 层库，版本为 0.0.x，无语义化兼容承诺。
**cachePriming**：rust-analyzer 项目加载时预热全工程与依赖缓存的配置项，默认开启。
**linkedProjects / rust-project.json**：rust-analyzer 中手动指定项目、替代 Cargo 自动发现的机制。
**detached 文件**：不属于任何 Cargo 包的 .rs 文件，rust-analyzer 只为其挂载 sysroot 基础 crate。
**rust-src**：标准库源码组件，源码位于 sysroot 的 lib/rustlib/src/rust/library。
**SCIP**：rust-analyzer `scip` 子命令输出的代码索引格式。

### 关键事实

#### 能力覆盖（rust-glancer）
- 通告 definition、typeDefinition、implementation、references、rename（prepareProvider）、documentHighlight、hover、documentSymbol、foldingRange、semanticTokens（full+range）、inlayHint（resolve=false）、workspaceSymbol。来源：rg/crates/lsp/server/src/capabilities.rs:14-55
- 额外通告 completion（触发字符 `.` `:`）、codeAction、documentFormatting；格式化调用外部 rustfmt 进程。来源：capabilities.rs:24-37、50；rg/crates/lsp/engine/src/formatting.rs
- 未通告 callHierarchy、typeHierarchy、signatureHelp，也没有 pull diagnostics。诊断通过 publishDiagnostics 推送，且默认关闭。来源：capabilities.rs；rg/editors/code/src/config.ts:102-103
- 文本同步为 Incremental，position encoding 为 UTF-16。来源：capabilities.rs:4-13

#### 能力覆盖（rust-analyzer）
- 直接宣告 hover、definition、typeDefinition、implementation、declaration、references、documentHighlight、documentSymbol、workspaceSymbol、callHierarchy、foldingRange、selectionRange、inlayHint（带 resolve）、semanticTokens（full/delta/range）。来源：ra/crates/rust-analyzer/src/lsp/capabilities.rs:49,71-77,103-104,140-141,163
- diagnostic 为 pull 模式（identifier 为 "rust-analyzer"），workspace_diagnostics 为 false。来源：capabilities.rs:167-175
- semantic token legend 含 58 个 type、23 个 modifier，其中多数为 rust-analyzer 自定义字符串。来源：ra/crates/rust-analyzer/src/lsp/semantic_tokens.rs:35-125
- experimental 块宣告 externalDocs、parentModule、childModules、runnables、ssr 等，未宣告 expandMacro 与 relatedTests。来源：capabilities.rs:175-192
- 读侧扩展方法：`rust-analyzer/expandMacro`（返回宏名与展开文本，ext.rs:325-346）、`rust-analyzer/relatedTests`（返回带 runnable 的 TestInfo，ext.rs:537-549）、`experimental/externalDocs`（ext.rs:747-773）、`experimental/parentModule` / `childModules`（ext.rs:435-451）。
- `viewHir`、`viewSyntaxTree` 仅用于调试 rust-analyzer 本身。来源：ra/crates/rust-analyzer/src/lsp/ext.rs:122-151

#### 索引与内存（rust-glancer）
- 索引阶段依次为 Metadata、Parsing、Item tree、DefMap、Semantic IR、Body IR；函数体只为 workspace 建立索引，依赖只做语义分析。来源：rg/docs/src/architecture/ARCHITECTURE.md（Engine 节）；rg/docs/src/usage/CONFIGURE.md:3-16
- 默认分配器为 mimalloc，并以 `MI_NO_ALIGNED_HINT=1` 编译。来源：rg/docs/src/development/MEMORY.md:40-50；ARCHITECTURE.md（Mimalloc）
- 内存声明为目标值：idle RAM <100MB，每个活动 engine RSS <100MB。来源：rg/docs/src/intro/INTRO.md:15、41；rg/docs/src/intro/SCOPE.md:7。文档无可复现的基准环境。
- 文档示例中，defmap 阶段在 16 线程下约 3.2s、峰值 RSS 约 3.1GB；2 线程下约 3.9s、约 1.8GB。来源：rg/docs/src/development/MEMORY.md:227-230

#### 配置与内存（rust-analyzer）
- cachePriming.enable 默认 true。来源：ra/docs/book/src/configuration_generated.md:29-34
- 关闭 cachePriming 后，flycheck 在 quiescent 时立即重启；priming 只在 proc-macro 加载后入队。来源：ra/crates/rust-analyzer/src/config.rs:2319；main_loop.rs:521-535
- `run_build_scripts = cargo.buildScripts.enable || procMacro.enable`，因此 buildScripts 不能单独关闭。来源：config.rs:2416-2418
- files.exclude 的路径相对 workspace root，不支持 glob；check.workspace 默认 true，只影响 flycheck，不影响索引。来源：configuration_generated.md:370-376、675-684；config.rs:2573-2574

#### 项目发现
- rust-analyzer 顺序为：父目录链上的 rust-project.json、.rust-project.json，然后 Cargo.toml；父链无 Cargo.toml 时只向下扫描一层子目录。来源：ra/crates/project-model/src/lib.rs:133-160
- discover_all 去重并排序，一个打开的文件夹可产生多个 workspace。来源：lib.rs:188-198
- linkedProjects 非空时关闭自动发现。来源：ra/crates/rust-analyzer/src/config.rs:2289-2300
- cargo.noDeps 为 true 时分析完全离线。来源：configuration_generated.md:186-190
- rust-glancer 只有单一 Cargo.toml 根加载路径，无 rust-project.json、linkedProjects、detached 的实现。来源：rg/crates/engine/project/src/change/workspace.rs:24-36
- rust-glancer 的 cargo metadata 默认按 rustc host triple 使用 --filter-platform，失败直接返回错误，无 --no-deps 回退。`--no-deps` 只用于探测新加入的成员 manifest。来源：rg/crates/engine/workspace/src/cargo.rs:52-106
- 独立 .rs 文件在 rust-glancer 中无归属，语法查询用 Edition2024 兜底。来源：rg/crates/lsp/engine/src/engine/query/source.rs:42-50
- rust-glancer 不执行 build script，复用已有 target 产物；产物过期需手动 Reindex。来源：rg/docs/src/usage/LIMITATIONS.md（Build scripts）
- rust-glancer 磁盘缓存位于 target/rust_glancer，按 package fingerprint 复用，失败回退为重新索引。来源：rg/crates/engine/project/src/storage/cache/instance.rs:17、29-35

#### sysroot 与标准库导航
- rust-analyzer 先看 RUST_SRC_PATH，否则从 `rustc --print sysroot` 推导；找不到 rust-src 时自动执行 `rustup component add rust-src` 再重试。来源：ra/crates/project-model/src/sysroot.rs:450-485
- rust-analyzer 对库文件不可变：didOpen 不写入 VFS；跨库编辑附 outside_workspace_annotation。来源：ra/crates/rust-analyzer/src/handlers/notification.rs:88-95；ra/crates/rust-analyzer/src/lsp/to_proto.rs:1385-1387
- rust-glancer 只要求 core、alloc、std、proc_macro 四个 crate 的 lib.rs 存在。缺失时 LSP 只记日志并继续运行，无 std 导航；不自动安装。来源：rg/crates/engine/workspace/src/sysroot.rs:18-37、85-100；rg/crates/lsp/engine/src/engine/project/mod.rs:166-181
- rust-glancer 的导航只返回已保存源码中的位置，不打开或写回依赖文件。来源：rg/crates/lsp/engine/src/engine/query/navigation.rs:251-300

#### 分发与版本
- rust-glancer 最新稳定版 v0.4.0，发布于 2026-10-21；共 5 个 release（v0.1.0 至 v0.4.0）。来源：`gh release view v0.4.0 -R rust-glancer/rust-glancer`
- v0.4.0 提供 5 个平台的 tar.gz（压缩后约 10.2–11.4 MB，无 musl）和 5 个 VSIX（压缩后约 10.7–11.8 MB，每个平台内嵌单一二进制）。未发布未压缩体积。来源：`gh release view v0.4.0 --json assets`；rg/editors/code/scripts/package-vsix.mjs:45-72
- VS Code 解析顺序：server.path、环境变量、bundled、PATH。来源：rg/editors/code/src/language-client/server.ts:28-50
- Zed 扩展钉住 MANAGED_SERVER_VERSION=0.4.0，只从 GitHub releases 路径下载。来源：rg/editors/zed/src/server/mod.rs:18-25；extension.toml:9-12
- Neovim 没有仓库内适配，依赖 nvim-lspconfig 与 mason 等第三方配置。来源：rg/docs/src/usage/INSTALL.md
- rust-analyzer 通过 `rustup component add rust-analyzer` 分发，每周一发布稳定 tag，最新为 2026-11-02。各平台 .gz 或 .zip 约 13.6–17.2 MiB。来源：ra/docs/book/src/rust_analyzer_binary.md；`gh api repos/rust-lang/rust-analyzer/releases/latest`
- rust-analyzer 的 CLI 子命令（含 scip、symbols、analysis-stats 等）明确声明无稳定性保证。来源：ra/crates/rust-analyzer/src/cli/flags.rs 顶部注释
- `scip` 输出的 SymbolInformation.relationships 恒为空；Relationship 支持仍为 open issue #14031。来源：ra/crates/rust-analyzer/src/cli/scip.rs:329；`gh issue view 14031`
- `scip` 为单线程生成。issue #18140（OPEN）报告在 mozilla-central 上墙钟约 1175 秒、CPU 利用率约 110%。来源：`gh issue view 18140 -R rust-lang/rust-analyzer`
- ra_ap_ide 最新版 0.0.358，发布于 2026-10-12，约每周一次。来源：https://crates.io/api/v1/crates/ra_ap_ide
- racer 已停止维护（最后推送 2023-11-19）；2.1 起需要 nightly。来源：https://github.com/racer-rust/racer README
- rust-lang/rls 已归档，由 rust-analyzer 取代。来源：`gh search repos`

### 冲突与未核实

- **命令名冲突**：题目中的 "openDocs" 不是 rust-analyzer 的方法名，实际为 `experimental/externalDocs`（ext.rs:752）。
- **viewMir 命名不一致**：Rust 类型名为 ViewMirRequest，实际方法名为 `rust-analyzer/interpretFunction`（ext.rs:146-152）。
- **lru.capacity 文档与代码不一致**：文档写默认 128，代码默认 None，实际容量由 base-db 的 DEFAULT_PARSE_LRU_CAP=128 决定（configuration_generated.md:1322-1328；config.rs:375-376）。
- **rust-src 要求不一致**：rg INSTALL.md 称 rust-src 为 mandatory，但 LSP 路径缺失时仅继续运行；离线 analyze 命令则直接报错（rg/crates/rust-glancer/src/analyze/mod.rs:68-71）。
- **stars 数字不同**：rust-glancer 为 757 与 758，属于采集时间不同，引用时需注明日期。
- **glancer-accuracy 条目无效**：仅一条占位事实，已排除在结论之外。
- **未核实（博文与 HN）**：博文索引耗时表（M4 Max、M1 8GB）、HN 的 "100x less memory" 评论引文，均未直接访问原页核对，不宜作为确定数字引用。作者在 HN 的 "initial indexing consumes more RAM" 等自述同样未核实原帖。
- **未核实（rust-analyzer 外部数字）**：issue #19402 的 22GB/30GB 与 5.5GiB，以及 Serena #1556 的 40–44GB，均为 WebFetch 二次摘要，未核对原文。论坛 13 GiB 与 Zed 讨论 12 GB 为低置信度。
- **基准无法对齐**：ra 的分阶段内存表未标注机器型号与 rust-analyzer 版本；bench 固定的是 release v0.3.3057，而 MEMORY.md 用的是 commit，两者无法对齐。
- **无受控对比**：rust-glancer 与 rust-analyzer 之间没有受控的 RSS 对比，也没有 time-to-first-definition 数据。
- **未核实**：rust-glancer 未读取 RUST_SRC_PATH；sysroot.discovery 默认值为推断的 auto。

### 对 Acard 的设计问题

1. **索引模型取舍**：是采用 rust-glancer 的“冻结索引 + 按 package 落盘”，还是 rust-analyzer 的内存常驻 salsa 模型？rust-glancer 的 <100MB 只是自述目标，文档示例的峰值 RSS 达 1.8–3.1GB。
2. **能力范围**：Acard 是否接受没有 call/type hierarchy、signatureHelp 的能力集？rust-glancer 未通告 callHierarchy；若需调用图，只能转向 ra_ap_ide 或其他来源。
3. **嵌入方式**：是用 ra_ap_ide 库（0.0.x 版本、依赖重，需 sidecar 或 FFI），还是调 rust-analyzer 子进程，还是用 `scip` 离线预计算？scip 单线程，大项目墙钟以分钟计，且 relationships 为空。
4. **项目发现与覆盖**：是否支持 rust-project.json 与 linkedProjects 手动覆盖，并允许多 workspace 并存？rust-analyzer 的 discover_all 产生多个 workspace，linkedProjects 非空则关闭自动发现。
5. **sysroot 缺失时的策略**：缺 rust-src 时，阅读器是自动执行 `rustup component add rust-src`，还是只提示用户？rust-analyzer 会自动安装，rust-glancer 只报错，自动改工具链对阅读器属于副作用。
6. **构建脚本与 proc-macro 默认值**：是否默认关闭 build script 与 proc-macro？rust-analyzer 中 buildScripts 与 procMacro 任一为真即执行 build script，无法单独关闭其一；rust-glancer 默认不执行。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | glancer-arch | capabilities.rs 声明 definition/typeDefinition/implementation/references/rename(prepare)/documentHighlight/hover/documentSymbol/foldingRange/semanticTokens(full+range)/inlayHint(resolve=false)/workspaceSymbol | capabilities.rs:14-55 与声明一致（inlay_hint resolve_provider=Some(false)，semantic_tokens full=true range=true）。 |
| confirmed | glancer-arch | 额外宣称 completion（触发字符 . 与 :）、codeAction（QuickFix、RefactorRewrite）、documentFormatting，executeCommand 为 None | capabilities.rs 中 completion_provider trigger_characters 为 [".", ":"]，code_action_kinds 为 QuickFix/RefactorRewrite，document_formatting_provider=true，execute_command_provider=None，均与声明一致。 |
| confirmed | glancer-arch | 未声明 callHierarchy、typeHierarchy、signatureHelp，crates/lsp 内无相关实现 | 在 crates/lsp 下对 call_hierarchy/type_hierarchy/signature_help 的搜索无结果；capabilities.rs 中无对应 provider。 |
| confirmed | glancer-arch / glancer-dist | diagnostics.onStartup 与 onSave 默认 false（诊断默认关闭） | editors/code/src/config.ts:102-103 中 readBoolean(config, "diagnostics.onStartup", false) 与 onSave 默认 false。 |
| confirmed | glancer-dist | v0.4.0 发布于 2026-10-21，5 个 tar.gz 与 5 个 VSIX 的压缩包大小 | gh release view 返回 publishedAt 2026-10-21T11:58:11Z；tar.gz 与 vsix 字节数与 summary 逐项一致（如 aarch64-apple-darwin 10178726、linux-x64 vsix 11833311）。未发布 musl 产物，也与列表一致。其他 release 日期未核对。 |
| confirmed | glancer-dist | VS Code 服务器解析顺序：server.path，其次环境变量，其次 bundled，最后 PATH | editors/code/src/language-client/server.ts:28-50 中顺序为 config.serverPath -> SERVER_ENV_OVERRIDE -> bundledServerPath -> "rust-glancer" PATH，一致。 |
| confirmed | glancer-dist / rust-project / glancer-accuracy | rust-glancer 主 cargo 元数据加载失败直接返回错误，无 --no-deps 或离线回退；--no-deps 仅用于探测新 workspace 成员 manifest | cargo.rs:82-96 load_metadata_with_target_cfg 中 command.exec().map_err(...) 直接返回错误，无回退；cargo.rs:101-106 的 --no-deps 探针注释明确仅用于成员 manifest 探测。 |
| confirmed | ra-footprint | run_build_scripts = cargo.buildScripts.enable \|\| procMacro.enable，因此 buildScripts 无法单独关闭 | crates/rust-analyzer/src/config.rs:2416-2418 为 cargo_buildScripts_enable \|\| procMacro_enable。 |
| confirmed | ra-footprint | lru.capacity 文档写 Defaults to 128，但代码默认 None，实际容量由 base-db 的 128 决定 | configuration_generated.md:1322-1328 中 Default: null 且正文写 Defaults to 128；config.rs:375-376 中 lru_capacity: Option<u16> = None。文档与代码表述不一致属实。 |
| confirmed | ra-features | diagnostic_provider 为 pull 模式（identifier rust-analyzer，inter_file_dependencies true，workspace_diagnostics false） | crates/rust-analyzer/src/lsp/capabilities.rs:167-175 与 summary 一致，workspace_diagnostics 带 FIXME 注释为 false。 |
| confirmed | ra-features | externalDocs 的真实方法名为 experimental/externalDocs，不存在 openDocs 方法名；experimental 块未声明 expandMacro/relatedTests | ext.rs:752 为 LspRequestMethod::new("experimental/externalDocs")，grep 无 openDocs；capabilities.rs:175-192 的 experimental 块含 externalDocs、parentModule、childModules、runnables、ssr 等，不含 expandMacro 与 relatedTests。 |
| confirmed | ra-cli | scip 输出 SymbolInformation 的 relationships 恒为空 Vec | crates/rust-analyzer/src/cli/scip.rs:329 为 relationships: Vec::new()。 |
| confirmed | rust-project | rust-analyzer 发现顺序：父链找 rust-project.json，再找 .rust-project.json，再找 Cargo.toml；父链无 Cargo.toml 时只向下扫一层子目录 | crates/project-model/src/lib.rs:133-160 的 discover、find_cargo_toml、find_cargo_toml_in_child_dir 与描述一致。 |
| confirmed | rust-std | rust-analyzer 对 library 文件不可变：didOpen 不写 VFS；缺 rust-src 时自动运行 rustup component add rust-src 再重试 | handlers/notification.rs:88-95 注释 'Library files are immutable...' 且仅对非 library 路径 set_file_contents；project-model/src/sysroot.rs:467-485 的 discover_rust_lib_src_dir_or_add_component 确实调用 rustup component add rust-src。 |
| confirmed | glancer-bench / ra-footprint memory numbers | MEMORY.md 中 defmap 16 线程约 3.2s/3.1GB，2 线程约 3.9s/1.8GB；分阶段表 after semantic-ir a_resident 831.3 MiB、a_mapped 854.7 MiB，after project a_resident 53.0 MiB、累计 9.52 s | docs/src/development/MEMORY.md:227-230 与 99-131 行的数字和表格逐项一致。注意表格是 rust-analyzer 固定 commit 的完整分析，未标机器型号，属于作者自测快照。 |
| confirmed | rust-other | ra_ap_ide 的 Analysis 暴露 call_hierarchy/incoming_calls/outgoing_calls 等 IDE API；ctags 仓库 tag 为 p6.2.20261108.0 | crates/ide/src/lib.rs 中 Analysis 结构体及 call_hierarchy、incoming_calls、outgoing_calls 方法存在；git describe --tags 返回 p6.2.20261108.0。版本号 0.0.358 与 crates.io 数据未在本次核对。 |
| unverifiable | glancer-bench | 博文索引耗时表（M4 Max 与 M1 8GB 的 base/full 数字）与 HN 'Not 100x faster, but 100x less memory' 评论引文 | 本次未调用 WebFetch 访问博文与 HN 页面，无法核对表格数字与引文。只能依据 gaps 所述的转述来源，建议对外引用前直接打开原页复核。 |
| unverifiable | ra-footprint | issue #19402 的 22GB/30GB 与 5.5GiB 数字，以及 Serena #1556 的 40-44GB 数字 | 本次未访问 GitHub issue 原文，无法核对。两者均为 WebFetch 二次摘要，应视为转述，不宜作为确定数字引用。 |

题目之间的矛盾：

- glancer-dist 事实 4 记 rust-glancer 为 757 stars，rust-other 事实 17/19 与 glancer-accuracy 相关记录为 758 stars，属于不同快照时间的差异，不是实质矛盾，引用时应注明采集日期。
- glancer-accuracy 的 summary 为占位文本 '测试：rust-glancer 名称解析调研'，relevance 为 'test'，且仅 1 条 fact，应视为无效条目，不应并入结论。
- rust-std 与 rust-project 对 rust-glancer 的 sysroot 与 --no-deps 行为描述彼此一致，未发现冲突；但 rust-project 的 summary 称 rust-glancer '没有 --no-deps 或离线回退'，需注意这仅指主加载路径，--no-deps 探针仍存在。

全部事实见 [facts/A2.md](facts/A2.md)。
