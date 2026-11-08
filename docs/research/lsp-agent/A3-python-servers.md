## A3 Python 语言服务器

来源路径相对于 `~/Projects/lsp-ref/`，网页来源为 URL。

### 核心概念

**ty**：Astral 的 Python 类型检查器兼语言服务器，当前为 0.0.x Beta。
**pull 诊断**：客户端主动请求 `textDocument/diagnostic`，服务端按需返回。
**push 诊断**：服务端通过 `publishDiagnostics` 主动推送。
**diagnosticMode**：ty 的全局设置，取值 Off / OpenFilesOnly / Workspace，默认 OpenFilesOnly。
**environment.python**：ty 中显式指定解释器的配置项，设置后跳过自动发现。
**pythonExtension.activeEnvironment**：编辑器经 workspace 配置传入的解释器，ty 仅在项目未配置时作回退。
**MAINTENANCE MODE**：jedi-language-server README 的维护状态标注，建议新用户改用 Zuban。

### 关键事实

**状态与版本**
- ty 为 0.0.x Beta，README 写明无稳定 API，诊断等可能随版本破坏性变化。来源：`ty/README.md`（Version policy 段）。
- ty 最新 0.0.99 发布于 2026-11-06；首个 Beta 为 0.0.2，发布于 2025-12-16。来源：`ty/CHANGELOG.md:3-5`、`4688-4692`。
- Astral 博客 2025-12-16 宣布 Beta，称可用于生产，Stable 目标写作 "next year"。截至 0.0.99 未见 Stable 发布（推断）。来源：https://astral.sh/blog/ty
- pyrefly 1.0.0 于 2026-05-12 标为 STABLE，最新已发布 1.4.1（2026-11-04）。来源：`pyrefly/release_notes/release-notes-v1.0.0.md:1-2`。
- pyright 当前 1.1.414。来源：`pyright/packages/pyright/package.json:5`。
- Zuban 最新 0.10.2（2026-10-29），仍为 0.x。来源：https://pypi.org/pypi/zuban/json
- jedi-language-server 最新 v0.47.0（2026-05-31，MIT）。来源：`jedi-language-server/CHANGELOG.md:7`。

**启动与安装**
- `ty server` 调用 `ty_server::run_server()`，经 `Connection::stdio()` 建立 LSP 连接。来源：`ruff/crates/ty/src/server.rs:21-27`、`ruff/crates/ty_server/src/lib.rs:38`。
- ty 安装方式包括 uv、pipx、pip、mise、standalone 脚本、GitHub Releases、Docker 与 Bazel。来源：`ty/docs/installation.md:13-166`。
- ty 官方目标为 Python 3.10+，3.7–3.9 可选但可能误报。来源：`ty/README.md`（FAQ）。
- pyright npm 包的 bin 为 `pyright-langserver`，engines 要求 node>=14，唯一运行时依赖为可选的 fsevents。来源：`pyright/packages/pyright/package.json:11-13`、`51-54`。PyPI 的 pyright 为社区包装器。来源：`pyright/docs/installation.md:36-40`。
- basedpyright 1.40.2 的 PyPI wheel 为 13,694,487 字节，依赖的 nodejs-wheel-binaries 24.19.0 在 macOS arm64 为 56,047,203 字节。两者合计约 69.7 MB（压缩体积，推断）。解压后体积未核实。来源：https://pypi.org/pypi/basedpyright/1.40.2/json 、https://pypi.org/pypi/nodejs-wheel-binaries/24.19.0/json
- pyrefly 通过 pip、uv、poetry、pixi、conda 安装，文档未列独立二进制。编辑器启动命令为 `pyrefly lsp`。来源：`pyrefly/website/docs/installation.mdx:28-47`、`IDE.mdx:229-231`。
- jedi-language-server 需 Python>=3.10，依赖 jedi>=0.19.2,<0.21 与 pygls>=2.0.0,<3。来源：`jedi-language-server/pyproject.toml:5-6`、`34-41`。

**读侧 LSP 能力**（按各服务端的注册列表判定；"否"表示在注册列表中未见）

| 方法 | ty | pyright | pyrefly | jedi-ls |
|---|---|---|---|---|
| definition / declaration / typeDefinition | 是 | 是 | 是 | 是 |
| implementation | 是 | 否 | 是 | 否 |
| references / hover / documentHighlight | 是 | 是 | 是 | 是 |
| documentSymbol / workspaceSymbol | 是 | 是 | 是 | 是 |
| callHierarchy | 是 | 是 | 是（依赖索引） | 否 |
| typeHierarchy | 是 | 否 | 是 | 否 |
| semanticTokens | 是 | 否 | 是 | 否（默认关闭） |
| inlayHint | 是 | 否 | 是 | 否 |
| foldingRange / selectionRange | 是 | 否 | 是 | 否 |
| codeLens | 否 | 否 | 是 | 否 |

来源：ty 为 `ruff/crates/ty_server/src/server/api.rs` 与 `ruff/crates/ty_server/src/capabilities.rs`；pyright 为 `pyright/packages/pyright-internal/src/languageServerBase.ts:526-690`；pyrefly 为 `pyrefly/pyrefly/lib/lsp/non_wasm/server.rs:1649-1721`、`2371-2950`；jedi 为 `jedi_language_server/server.py:195-214`、`403-640`。ty 文档标 codeLens、documentLink、documentColor 为不支持（`ty/docs/features/language-server.md:127-134`）。

**诊断模型**
- ty 同时支持 pull 与 push。动态注册的客户端下，Off 不注册 pull，OpenFilesOnly 与 Workspace 注册；push 仅在客户端不支持 pull 时发布。来源：`ruff/crates/ty_server/src/session.rs:1097-1145`、`server/api/diagnostics.rs:208-223`、`296-307`。
- pyright 同时支持 pull 与 push，默认 `openFilesOnly=true`。来源：`languageServerBase.ts:561-563`、`pyrightServer.ts:72`。
- pyrefly 的 `preset="off"` 禁用所有 error kind 但保留 hover、definition。来源：`pyrefly/website/docs/configuration.mdx:826-836`。
- jedi-ls 诊断仅为 compile 产生的语法错误，`diagnostics.enable` 默认 false。来源：`jedi_utils.py:317-342`。

**ty 环境与配置**
- 发现顺序：VIRTUAL_ENV（非空即独占，解析失败直接报错）→ 子 Conda/Pixi → 项目 `.venv`（失败则继续）→ base Conda → PATH 上的 python。来源：`ruff/crates/ty_site_packages/src/lib.rs:310-388`、`ty/docs/modules.md:59-67`。
- Python 版本顺序：environment.python-version → requires-python 下界 → pyvenv.cfg 与布局推断 → 默认 PY315。来源：`ruff/crates/ty_project/src/metadata/options.rs:143-160`、`307-320`。
- 配置发现：沿祖先找最近的 ty.toml 或带 `[tool.ty]` 的 pyproject.toml，同目录 ty.toml 优先。来源：`ruff/crates/ty_project/src/metadata.rs:180-200`、`291-315`。
- 模块搜索顺序：extra-paths（含 PYTHONPATH）→ first-party → stdlib → site-packages（含 `.pth` 可编辑路径）。来源：`ruff/crates/ty_module_resolver/src/resolve.rs:740-860`、`989-1068`。
- stdlib 使用内嵌 typeshed（源提交 `2e4d4dcf657f82305709bbe3e86bca4d27d4dd46`）；第三方 stub 未内嵌（代码 TODO）。来源：`ruff/crates/ty_vendored/vendor/typeshed/source_commit.txt`、`resolve.rs:770-835`。

**pyright 环境**
- 未配置解释器时调用 PATH 上的 python。推荐 `python.pythonPath`，但 VS Code Python 扩展已弃用该设置。来源：`pyright/docs/import-resolution.md:18`、`78-80`；`pyright/docs/settings.md:41`。

**性能**（ty `BENCHMARKS.md`，M3 Max 16 核 / 128 GB；ty 0.0.99、Pyrefly 1.4.0、Pyright 1.1.414、mypy 2.4.0、Zuban 0.10.2）
- home-assistant CLI 全量检查：ty 2.107 s（峰值 RSS 3,463 MiB）；Pyrefly 2.303 s（3,031 MiB）；Zuban 7.454 s（1,943 MiB）；Pyright 126.940 s（4,208 MiB）；mypy 52.028 s（4,189 MiB）。以 ty 为 1，倍数分别为 1.09、3.54、24.69、60.25。来源：`ty/BENCHMARKS.md:126-172`。
- LSP 增量编辑（home-assistant）：ty 29.15 ms，Zuban 57.03 ms，Pyrefly 75.69 ms，Pyright 574.48 ms。Zuban 服务器在 discord.py、NumPy、PyTorch 的增量编辑中崩溃。来源：`ty/BENCHMARKS.md:862-866`。
- Pyrefly 博客（2026-04-10，Pyright 1.1.408、ty 0.0.29，M4 64 GB，每包 5 次取平均）：pandas 上 Pyrefly 1.9 s、Pyright 144.4 s、Mypy 13.9 s。来源：https://pyrefly.org/blog/speed-and-memory-comparison/ 。该版本与 BENCHMARKS.md 不同，不可混用。

**其他**
- basedpyright 的增量为语义高亮（PEP 695 `type`、Final 只读）、inlay hints 改进与内置 docstring。call hierarchy 继承自上游 pyright（推断）。来源：`basedpyright/docs/benefits-over-pyright/pylance-features.md`、`language-server-improvements.md`。
- jedi-ls 每个请求新建 `jedi.Script`，无逐文件分析缓存。来源：`jedi_utils.py:130-132`。
- 许可证：ty、Pyrefly、Pyright、basedpyright、jedi-language-server、pylsp 为 MIT；Zuban 为 AGPL-3.0 与商业双许可。

### 冲突与未核实
- **ty 性能倍数口径**：README 写 10x-100x（`ty/README.md:28`），博客写 10x-60x。两者不合并引用。
- **倍数更正**：初稿中 home-assistant 比值 1.35 / 3.51 / 14.16 / 27.21 实际来自另一 CLI 项目段（BENCHMARKS.md 约 835-861 行），不属于 home-assistant。以上文 1.09 / 3.54 / 24.69 / 60.25 为准。
- **数据版本**：博客的 Home Assistant 数值（5.32 s、19.62 s 等）与 BENCHMARKS.md 不一致，博客 PyTorch 增量数字（4.7 ms、386 ms）与图表标签也有出入。均未核实，不引用为定论。
- **ty 的 willRenameFiles**：文档标 Not supported（`ty/docs/features/language-server.md:153`），代码侧是否已注册未核实。
- **ty 的 inlayHint resolve**：是否未声明 resolve 未核实。能力声明文件应为 `ruff/crates/ty_server/src/capabilities.rs`，而非 `session/capabilities.rs`。
- **ty python-version**：文档写 3.14（`ty/docs/python-version.md:38`），代码为 PY315。以代码或 ty 上报值为准。
- **Pyrefly 发布节奏**：README 写每月一个 minor，安装文档写约每两个月（`installation.mdx:4`）。
- **Zuban 速度**：官网称比 mypy 快 20–200 倍，方法未附，第三方页面称 5–7 倍。未核实。
- **Pyrefly 1.85M 行/秒与 15x**：README 无出处，未核实。
- **basedpyright 版本**：源码 1.1.414 与 PyPI 1.40.2 编号体系不同，二者对应关系未核实。
- **Pylance**：闭源与许可条款依据 2020–2021 年二手报道，未核实。
- **未测**：basedpyright 与 nodejs-wheel-binaries 解压后体积，jedi 无可比基准。

### 对 Acard 的设计问题
1. **后端选型**：以 ty 为首选（读侧覆盖最全、stdio 接入），但 0.0.x Beta 无稳定 API，是否接受版本锁定并保留 pyright 降级路径？依据：ty README 的 Version policy。
2. **诊断策略**：Acard 若只做导航，是否关闭诊断？依据：pyrefly 的 `preset="off"` 与 pyright 默认 openFilesOnly 可降低负载。
3. **解释器来源**：Acard 是否由客户端显式注入解释器（ty 用 pythonExtension.activeEnvironment 或 environment.python，pyright 用 python.pythonPath），还是沿用进程环境？依据：ty 的发现顺序与 pyright 对 pythonPath 的弃用说明。
4. **分发形态**：是否接受随包携带 Node 运行时（pyright 系约 70 MB 压缩下载），还是倾向 ty 这类单一原生二进制？依据：basedpyright 的 PyPI 体积与 ty 的 standalone 安装方式。
5. **许可证**：是否排除 AGPL-3.0 的 Zuban？依据：Zuban 为 AGPL-3.0 与商业双许可。
6. **能力缺口**：pyright 缺 implementation、typeHierarchy、inlayHint 等，是否接受按后端能力降级 UI？依据：上文读侧能力表。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | ty-overview | ty 为 Beta，0.0.x 版本，无稳定 API（README 写明） | ~/Projects/lsp-ref/ty/README.md:24 写 'ty is currently in beta'，第 72-74 行 Version policy 写 0.0.x 且尚无稳定 API、可能破坏性变化。 |
| confirmed | ty-overview | 最新 0.0.99 发布于 2026-11-06，前一版 0.0.98 为 2026-11-05 | ty/CHANGELOG.md:3-5 为 '## 0.0.99 / Released on 2026-11-06'，:40-42 为 0.0.98 / 2026-11-05。 |
| confirmed | ty-overview | Beta 首版为 0.0.2，发布于 2025-12-16，原文 'first Beta release' | ty/CHANGELOG.md:4688-4692 为 '## 0.0.2 / Released on 2025-12-16 / This is the first Beta release of ty'。 |
| confirmed | ty-overview | Astral 博客宣布 Beta、称可用于生产，Stable 目标为 next year | WebFetch 核对 https://astral.sh/blog/ty：日期 2025-12-16，'ready to recommend it to motivated users for production use'，Stable 写 'next year'（即 2026）。 |
| confirmed | ty-overview | ty server 以 stdio 建立 LSP 连接 | ruff/crates/ty/src/server.rs 的 run() 调用 ty_server::run_server()；ruff/crates/ty_server/src/lib.rs:38 为 Connection::stdio()。 |
| confirmed | ty-overview | README 宣传 '10x-100x'，博客为 '10x-60x'，两者不一致 | README.md:28 为 '10x - 100x faster than mypy and Pyright'；博客原文 'consistently between 10x and 60x faster than mypy and Pyright'（WebFetch 核对）。两处表述确实不同。 |
| confirmed | ty-overview / py-bench | SVG 中 ty=2.11s、Pyright=126.94s 等数值与工具的对应关系 | 原报告标为推断。现已核实：ty/BENCHMARKS.md 的 homeassistant 段给出 ty 2.107s、Pyrefly 2.303s、Zuban 7.454s、mypy 52.028s、Pyright 126.940s，与 SVG 文本标签按顺序一一对应。 |
| wrong | py-bench | home-assistant 结果中 ty 相对 Pyrefly 1.35 倍、Zuban 3.51 倍、mypy 14.16 倍、Pyright 27.21 倍 | 这四个比值来自另一个 CLI 项目段（BENCHMARKS.md 约 835-861 行，紧邻 ## LSP 之前），不属于 homeassistant。homeassistant 段自己的 Summary（约 165-172 行）为 1.09、3.54、24.69、60.25 倍，与 2.107s 等数值吻合（Pyright 126.94/2.107≈60.2）。 |
| unverifiable | ty-features | workspace/willRenameFiles 在 ty 文档中标 Not supported，但代码已实现 | 文档表 ty/docs/features/language-server.md:153 确认标为 Not supported（引用 #1560）。但本次未读 ruff/crates/ty_server 中 WillRenameFiles 的 handler 与 file_operations 能力声明，代码侧未核实。 |
| confirmed | ty-features | 文档列 codeLens、documentLink、documentColor 为 Not supported | ty/docs/features/language-server.md:127、132、134 三行均为 ❌ Not supported。 |
| partly | ty-features | inlayHint 未声明 resolve_provider；默认 diagnosticMode 为 OpenFilesOnly | diagnosticMode 默认值已确认：ruff/crates/ty_server/src/session/options.rs:452-453 的 #[default] 为 OpenFilesOnly。inlayHint 无 resolve 的说法未核实：原报告引用的 session/capabilities.rs 路径不存在，实际文件是 ruff/crates/ty_server/src/capabilities.rs，本次未读。 |
| confirmed | pyright | pyright 不注册 implementation、typeHierarchy、foldingRange、semanticTokens、inlayHint、codeLens、selectionRange 的 handler | 在 pyright/packages/pyright-internal/src/languageServerBase.ts 全文 grep 上述方法名，无注册命中，仅有 callHierarchy 相关命中。 |
| confirmed | pyright | pyright 当前版本为 1.1.414 | pyright/packages/pyright/package.json:5 为 "version": "1.1.414"。PyPI/npm 的远端版本未在本次核对。 |
| confirmed | pyrefly | pyrefly 1.0.0 于 2026-05-12 标为 STABLE；1.4.1 为 2026-11-04 的 coverage 补丁 | release_notes-v1.0.0.md 首行为 'Status: STABLE / Release date: 12 May 2026'；release-notes-v1.4.1.md 为 'Release date: November 4, 2026'，内容为修复 pyrefly coverage 的补丁。 |
| confirmed | pyrefly | 能力声明中 implementation、inlayHint、foldingRange、selectionRange、workspaceSymbol 为 true；callHierarchy 依赖索引模式；默认 LazyNonBlockingBackground | pyrefly/pyrefly/lib/lsp/non_wasm/server.rs 能力声明段含 implementation_provider、inlay_hint_provider、workspace_symbol_provider、folding_range_provider、selection_range_provider 均为 true；commands/lsp.rs:39-58 的 IndexingMode 默认为 LazyNonBlockingBackground。 |
| confirmed | jedi | jedi-language-server 标注 MAINTENANCE MODE 并推荐 Zuban | jedi-language-server/README.md:10 为 '**MAINTENANCE MODE: we suggest that new users consider the successor to Jedi ... Zuban**'。 |
| confirmed | py-envdetect / ty-env | ty 环境发现优先级：VIRTUAL_ENV 独占 → 子 Conda/Pixi → 项目 .venv（失败继续）→ base Conda → PATH | ruff/crates/ty_site_packages/src/lib.rs:298-355 的 discover 文档注释与分支实现一致；VIRTUAL_ENV 非空即直接返回，解析错误返回给调用方；.venv 解析失败则继续。 |
| confirmed | ty-env | python-version 文档写 fallback 为 3.14，代码为 PY315（文档过期） | ty/docs/python-version.md:38 写 'latest stable Python version supported by ty (currently 3.14)'；ruff/crates/ruff_python_ast/src/python_version.rs:38、64、69 为 PY315。 |
| confirmed | ty-env | 内嵌 typeshed 源提交为 2e4d4dcf657f82305709bbe3e86bca4d27d4dd46 | ruff/crates/ty_vendored/vendor/typeshed/source_commit.txt 内容即该哈希。 |
| confirmed | py-bench | BENCHMARKS.md 测试机与工具版本（M3 Max 128GB；ty 0.0.99、Pyrefly 1.4.0、Pyright 1.1.414、mypy 2.4.0、Zuban 0.10.2） | ty/BENCHMARKS.md:3-9 完全一致。 |
| confirmed | py-bench | home-assistant CLI：ty 2.107s/3,463MiB，Pyrefly 2.303s，Zuban 7.454s/1,943MiB，Pyright 126.940s/4,208MiB，mypy 52.028s | BENCHMARKS.md:126-172 的 homeassistant 段数值一致（Zuban 1,943 MiB 也在该段）。 |
| confirmed | py-bench | Zuban 的 LSP 服务器在 discord.py、NumPy、PyTorch 增量编辑中崩溃 | ty/BENCHMARKS.md:862-866 原文 'Zuban's server crashed on the incremental edits in discord.py, NumPy, and PyTorch.' |

题目之间的矛盾：

- ty 官方宣传口径不统一：README（ty/README.md:28）写 10x-100x，Astral 博客写 10x-60x。两份来源都应引用原文，不能合并成一个区间。
- py-bench 的 home-assistant 比值（1.35/3.51/14.16/27.21）与 BENCHMARKS.md 中 homeassistant 段自己的 Summary（1.09/3.54/24.69/60.25）互相矛盾；前者属于另一个 CLI 项目段。
- ty-overview 与 py-bench 对性能数字的口径需要统一：ty-overview 的 PyTorch 与博客数字（4.7ms、386ms、2.38s）与图表标签有轻微不一致，py-bench 引用的 BENCHMARKS.md 数字来自另一版本的测试，两者不能混用。
- pyrefly 主题内部：README 称每月发布 minor，安装文档称约每两个月一次（pyrefly/website/docs/installation.mdx:4）；两份说法不一致，应以发布节奏实际记录为准。
- ty 文档 python-version 写 3.14，代码为 PY315；Acard UI 若展示默认版本，应以代码/ty 上报值为准，不要引用文档。
- basedpyright 的 call hierarchy 归属（basedpyright 主题认为继承自上游）与 pyright 主题（pyright 已实现 callHierarchy）一致，但 pyright 主题 relevance 写 pyright 覆盖 call hierarchy 而 pyright 主题 facts 列出的是 pyright 本体，二者不冲突。

全部事实见 [facts/A3.md](facts/A3.md)。
