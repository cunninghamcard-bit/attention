## A5 不依赖 LSP 的代码导航

### 核心概念

**tags 查询**：在语法节点上用 @definition.* / @reference.* 与 @name 标注实体的查询文件，约定位于语言仓库的 queries/tags.scm。
**locals 查询**：tree-sitter 的单文件作用域解析，固定捕获名为 @local.scope / @local.definition / @local.reference。
**search-based 导航**：在仓库内按名字检索全部同名定义与引用，不做语义解析（GitHub 与 dumb-jump 采用）。
**precise 导航**：基于名字绑定或类型语义的精确跳转（stack graphs、SCIP 索引属此类）。
**stack graphs**：以符号栈与作用域栈在图上求名字绑定的框架，源自 scope graphs。
**SCIP**：protobuf 格式的离线代码智能索引，Occurrence 通过 SymbolRole 位集区分定义与引用。
**ctags**：生成符号标签的外部工具，Rust 与 Python 解析器只产生定义类标签。

### 关键事实

#### tree-sitter tags 与增量模型
- generate_tags 每次都 set_language、reset，并以 None 旧树整文件重解析，tags 生成本身非增量。 — ~/Projects/lsp-ref/tree-sitter/crates/tags/src/tags.rs:286-293（抽查确认）
- 增量解析只在核心 API：对旧 Tree 调用 Tree::edit(&InputEdit) 后，把旧树作为 old_tree 传给 parse。 — ~/Projects/lsp-ref/tree-sitter/docs/src/using-parsers/3-advanced-parsing.md:1-31；lib/binding_rust/lib.rs:1543
- tags 合法捕获只有 @definition.*、@reference.*、@doc、@name、@local.(scope|definition|reference)。 — tags.rs:81（抽查确认）
- 单行摘要上限 MAX_LINE_LEN=180；取消检查每 100 次迭代一次。 — tags.rs:23-24（抽查确认）
- tags crate 的 README 仍是 0.19 时代 API（tag.kind），源码 Tag 无 kind 字段而有 syntax_type_id，以源码为准。 — crates/tags/README.md；tags.rs:53-64
- tree-sitter 工作区版本 0.28.0。 — ~/Projects/lsp-ref/tree-sitter/Cargo.toml:25
- 标准标签词表：definition.class/function/interface/method/module，reference.call/class/implementation。 — docs/src/4-code-navigation.md（Tagging and captures 表）
- 文档注释用 @doc 配合 #strip! 与 #select-adjacent!。 — docs/src/4-code-navigation.md；tags.rs:216-221

#### 本地 Rust 与 Python 的 tags.scm
- tree-sitter-rust（0.24.2，77a3747）的 queries 只有 highlights、injections、tags，没有 locals.scm。 — ~/Projects/lsp-ref/tree-sitter-rust/queries/
- Rust tags.scm 共 60 行：struct/enum/union/type 为 definition.class，顶层 fn 为 definition.function，trait 为 definition.interface，mod 为 definition.module，macro_definition 为 definition.macro。 — tree-sitter-rust/queries/tags.scm:1-30
- declaration_list 模式使 mod 内的顶层函数也被标为 definition.method（抽查确认：mod_item 的 body 为 declaration_list）。 — tags.scm:19-21；grammar.js:273-279
- Rust tags.scm 没有 const/static、enum variant、带路径调用（如 Type::new()）、use 声明。 — tags.scm 全文；grammar.js:392,407,449
- Rust 引用只取裸名：call_expression 的 identifier、field_expression 的 field_identifier、单段宏调用。 — tags.scm:38-60
- Python tags.scm 仅 14 行（约 350 字节）：模块顶层赋值为 definition.constant，class、function 为定义，call 为 reference.call。 — ~/Projects/lsp-ref/tree-sitter-python/queries/tags.scm:1-14
- Python 不区分方法，类内 def 也标为 definition.function；不捕获 import、继承、装饰器、self 属性。 — tree-sitter-python/test/tags/main.py:1-10
- Rust highlights.scm:11 的全大写常量正则末尾多一个单引号，永远不匹配（抽查确认）。 — tree-sitter-rust/queries/highlights.scm:11

#### locals 与编辑器实践
- locals 固定捕获名为 @local.definition、@local.definition-value、@local.reference、@local.scope；作用域默认继承，可由 #set! local.scope-inherits 覆盖。 — tree-sitter/crates/highlight/src/highlight.rs:421-431、1005-1008；docs/src/3-syntax-highlighting.md:178-196
- tags 引擎把 locals 与 tags 查询拼接编译；#is-not? local 可过滤被局部变量遮蔽的名字。 — tree-sitter/crates/tags/src/tags.rs:129-132、195-196、442-460
- Helix 的 Rust locals.scm 有 9 类作用域且无 module；Python 的作用域为 module、function_definition、lambda，无 class。 — helix/runtime/queries/rust/locals.scm:1-14；helix/runtime/queries/python/locals.scm:1-40
- Helix 的 Rust highlights 注释承认局部变量高亮“largely guesswork”。 — helix/runtime/queries/rust/highlights.scm:419
- Zed 跳转先走 LSP，失败后只有 None 与 FindAllReferences 两种回退，没有语法启发式。 — zed/crates/editor/src/navigation.rs:1047-1059；hover_links.rs:447-470（抽查确认）
- Zed 的 outline 基于 buffer 语法树；其 rust/python outline.scm 在本地克隆中缺失，内容未核实。 — zed/crates/language/src/buffer.rs:4985-5060

#### GitHub 搜索式与精确导航
- GitHub 搜索式导航基于 tree-sitter，列出仓库内同名的全部定义与引用，官方列出 21 种语言，包括 Rust。 — https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github（语言列表为 WebFetch 转述）
- 官方文档不区分 precise 与 search 两种模式，Rust 是否走精确导航未核实（抽查 unverifiable）。
- stack graphs 精确导航 2021-12-09 首发仅 Python，TypeScript 于 2024-03-13 changelog 加入。 — https://github.blog/2021-12-09-precise-code-navigation-python-code-navigation-pull-requests/；https://github.blog/changelog/2024-03-13-precise-code-navigation-for-typescript-projects
- 同一博客承认搜索式结果“can result in a lot of noise”。 — 同上 2021 博客
- 本地 stack-graphs 的 languages/ 只有 java、javascript、python、typescript，没有 Rust。 — ~/Projects/lsp-ref/stack-graphs/languages/
- stack-graphs README 声明已不再由 GitHub 维护；最后 release 为 tree-sitter-stack-graphs-v0.10.0（2024-12-13）。isArchived 字段本次未独立核实。 — ~/Projects/lsp-ref/stack-graphs/README.md:1
- stack-graphs 的 Python TSG 规则 1377 行，锁定 tree-sitter-python 0.23.5；测试夹具覆盖绝对与相对导入、__init__ 重导出、星号导入、self 属性、继承、super()、装饰器（夹具为期望，未运行）。 — ~/Projects/lsp-ref/stack-graphs/languages/tree-sitter-stack-graphs-python/src/stack-graphs.tsg；test/*.py
- stack-graphs-python 缺口：没有 site-packages 解析，builtins.py 为 0 字节。 — languages/tree-sitter-stack-graphs-python/src/builtins.py
- stack-graphs 存储为 SQLite，schema VERSION=6，重索引时按文件删除 partial path 记录。 — ~/Projects/lsp-ref/stack-graphs/stack-graphs/src/storage.rs:37、228、356
- stack-graphs crate 有 C API（c.rs 中 42 个 extern 函数，cbindgen 生成 stack-graphs.h）；TSG 加载器与 CLI 无 C API。 — stack-graphs/src/c.rs:46,54,65；stack-graphs/include/stack-graphs.h；tree-sitter-stack-graphs/Cargo.toml 无 cbindgen（推断）
- 许可证 MIT OR Apache-2.0。 — ~/Projects/lsp-ref/stack-graphs/stack-graphs/Cargo.toml:8

#### search-based 启发式
- dumb-jump 用 ag、rg 或 grep 搜候选，按语言正则匹配定义（Rust 含 fn/struct/trait/enum/impl/macro_rules/let/const，Python 含 def/class/lambda 赋值）。 — https://raw.githubusercontent.com/jacktasia/dumb-jump/master/dumb-jump.el（WebFetch 转述）
- dumb-jump 排序：当前文件优先，过滤注释行，路径短者优先；仅一个候选时直接跳转；dumb-jump-max-find-time 默认 2 秒（转述，原文未逐行核实）。
- Sourcegraph 的 search-based 导航基于 universal-ctags 符号索引加启发式文本搜索，文档称需要 100% 准确时应使用 precise；不跨包边界。 — https://sourcegraph.com/docs/code-navigation/search-based-code-navigation（WebFetch 转述）
- 公开的搜索式导航精度或召回率数据：未找到。

#### universal-ctags
- Rust 解析器有 13 种 kind：module、struct、interface、implementation、function、enum、typedef、variable、macro、field、enumerator、method、constant，没有 use 类。 — ~/Projects/lsp-ref/ctags/parsers/rust.c:58-72（抽查确认）
- impl Trait for Type 的名字取 Type，trait 名被丢弃；方法 scope 由 :: 拼接外层 mod 与 impl 类型名。 — rust.c:715-736、474-491
- Python kind 为 class、function、member、variable、namespace、module、unknown；import 只写 role 标签（imported、indirectlyImported），不做跨文件解析。 — ctags/parsers/python.c:136-146、1245-1362
- JSON 输出为 JSON Lines，需 libjansson；kind 用长名，scope 与 scopeKind 分开。 — ctags/man/ctags-json-output.5.rst.in
- 速度数据互相矛盾（官方 FAQ 称约 1-2 MB/s），不采信。 — https://www.mankier.com/7/ctags-faq（WebSearch 摘要）

#### SCIP 与 rust-analyzer
- Index 由 metadata、documents、external_symbols 组成；SymbolRole 位集中 Definition=0x1、Import=0x2、WriteAccess=0x4、ReadAccess=0x8，不带 Definition 位即为引用。 — ~/Projects/lsp-ref/scip/scip.proto:20-38、524-547（抽查确认）
- Go 绑定提供 ParseStreaming 与 SymbolTable，但没有 definition/references 反向索引，需自建（推断）。 — scip/bindings/go/scip/parse.go:29；symbol_table.go:4
- LSIF 已被 Sourcegraph 完全弃用。 — scip/docs/DESIGN.md:16-23
- rust-analyzer 的 scip 子命令对整个 cargo workspace 做一次性全量索引，没有增量机制。 — rust-analyzer/crates/rust-analyzer/src/cli/scip.rs:24-65
- trait impl 方法与 trait 声明的方法是两个不同符号。 — scip.rs:630-705（测试期望）
- 已知缺陷：同一结构体的多个 inherent impl 不消歧；函数内嵌套定义符号重复（issue #18771）。 — scip.rs:298-306、420-450
- scip-python 是 pyright 的 fork，要求 Python 3.10+、Node 16+，依赖 venv 或 --environment，大项目建议 NODE_OPTIONS=--max-old-space-size=8192。 — ~/Projects/lsp-ref/scip-python/README.md；packages/pyright-scip/src/config.ts:315-330
- SCIP 索引的速度、内存、准确率公开数据：未找到。

#### Go 绑定与 cgo（Acard 的语言约束）
- mygo 要求 CGO_ENABLED=0，模块内没有真正的 cgo 源文件。 — mygo AGENTS.md:14-16（研究所用版本 v0.7.5-0.20261104191142-c9438876cbd1）
- attention/native 没有 import "C"，go.mod 没有 tree-sitter 依赖。 — ~/Projects/attention/native/go.mod（抽查确认）
- 官方 go-tree-sitter 为 MIT、cgo 构建，最新 tag v0.24.0，最后推送 2025-11-16；语法需单独引入，它自己的 go.mod 固定 rust v0.23.2、python v0.23.6。 — ~/Projects/lsp-ref/go-tree-sitter/tree_sitter.go:1-10；go.mod
- smacker/go-tree-sitter 为 MIT、cgo，最后推送 2024-08-27。 — gh api repos/smacker/go-tree-sitter
- 语法 C 源体积：rust 的 parser.c 6.5M，python 的 parser.c 3.4M，cgo 构建时全部编入包。 — tree-sitter-rust/src/parser.c；tree-sitter-python/src/parser.c
- gotreesitter 为纯 Go、无 cgo，MIT，v0.57.0 发布于 2026-11-08，内置 206 个语法；默认包含 GPL-3.0（caddy、disassembly、jq）与 MPL-2.0（nim）语法，需裁剪。 — gotreesitter README License 段；releases/latest
- malivvan/tree-sitter 为 wazero 路线，预发布，最后推送 2025-01-25，5 星，不建议直接采用。 — gh api repos/malivvan/tree-sitter
- purego 为 Apache-2.0，可运行时加载共享库，但仍需分发 .so 或 .dylib。 — go-tree-sitter/README.md；attention/native/go.mod 已间接依赖 purego v0.11.1

### 冲突与未核实
- 两份“Rust tags.scm”不是同一文件：ctags 组引用的 Helix 版本含 const_item 与 enum_variant 捕获、无引用；ts-queries 与 rust-nolsp 引用的 tree-sitter-rust 版本缺 const 与 variant、有引用。结论不矛盾，但引用时必须标明来源。
- mygo 版本不一致：ts-go 的结论依据 v0.7.5-…c9438876cbd1，而 attention/native/go.mod 锁定 v0.7.2-…642005fd4978。禁止 cgo 的结论需在锁定版本上复核（抽查 partly）。
- GitHub 是否对 Rust 做精确导航：未核实。
- stack-graphs 的 isArchived=true 与 release 日期仅来自 gh api，未独立核实；README 声明属实。
- 搜索式导航对 Get 等常见名字更易误判：未核实（来自搜索摘要）。
- dumb-jump 的评分函数与阈值细节：未核实（转述，原文未读全）。
- Zed rust/python outline.scm 的内容：未核实。
- SCIP 对 pub use、glob import、宏生成项的解析结果：未运行验证。
- 增量：tags 生成非增量；SCIP 与 rust-analyzer 无增量实现。

### 对 Acard 的设计问题
1. 无 LSP 的基线采用进程内 tree-sitter tags.scm，还是外部 ctags 二进制？依据：tags 每次整文件重解析，Rust 的 tags.scm 缺 const 与 use；ctags 的 scope 字段更利于区分同名方法。
2. 是否接受 cgo 依赖，还是采用纯 Go 的 gotreesitter 并裁剪 GPL/MPL 语法？依据：mygo 要求 CGO_ENABLED=0，rust parser.c 6.5M 会编入 cgo 包。
3. 搜索式结果是否标注“启发式”，并且只在唯一候选时直接跳转？依据：GitHub 博客承认同名噪声大，dumb-jump 也只在单候选时直接跳。
4. 精确层选 SCIP 离线索引，还是 stack graphs？依据：SCIP 需全量加载 cargo workspace 且无增量；stack graphs 已停止维护，且没有 Rust 语言包，需从零写 TSG。
5. 单文件 locals 是否进入 MVP？依据：tree-sitter-rust 没有 locals.scm，只能裁剪 Helix 版本，而 Helix 自己称其为 guesswork。
6. 索引快照与磁盘文件漂移时以谁为准，是否用 Tree::edit 增量维护单文件缓存？依据：SCIP 的 Document.text 为可选字段，按磁盘读取会错位；tags 生成本身非增量。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | ts-core | generate_tags 每次都 set_language、reset，并以 None 旧树整文件重新解析（tags 生成非增量） | tags.rs:286-293 中 set_language、reset，随后 parse_with_options(..., None, ...) 确认非增量。 |
| confirmed | ts-core | MAX_LINE_LEN 为 180，取消检查间隔 CANCELLATION_CHECK_INTERVAL 为 100 | tags.rs:23 MAX_LINE_LEN=180；tags.rs:24 CANCELLATION_CHECK_INTERVAL=100，用于 :351 的计数检查。 |
| confirmed | ts-core | tags 合法捕获错误信息为 Expected one of @definition.*, @reference.*, @doc, @name, @local.(scope\|definition\|reference) | tags.rs 错误定义 InvalidCapture 的文本与该列表一致。 |
| confirmed | ts-core | tree-sitter 工作区版本为 0.28.0；README 仍用 tag.kind，已与源码不一致 | tree-sitter/Cargo.toml:25 version="0.28.0"；crates/tags/README.md:55 仍有 tag.kind 示例，而源码 Tag 结构无 kind 字段（syntax_type_id 代替）。 |
| confirmed | ts-queries | Rust highlights 全大写常量正则末尾多一个单引号，导致永不匹配 | highlights.scm:11 为 #match? "^[A-Z][A-Z\\d_]+$'"，末尾的 ' 是正则的一部分，标识符不可能以字面单引号结尾，规则确实失效。 |
| confirmed | ts-queries | Rust queries 目录只有 highlights.scm、injections.scm、tags.scm，没有 locals.scm；Python 只有 highlights 与 tags（tags 14 行） | ls 结果：tree-sitter-rust/queries 为 highlights/injections/tags；tree-sitter-python/queries 为 highlights/tags，wc -l tags.scm=14，350 字节。 |
| confirmed | ts-queries / rust-nolsp | Rust tags.scm 的 declaration_list 模式把 mod 内顶层函数也标为 definition.method（mod_item body 为 declaration_list） | tags.scm:19-21 为 (declaration_list (function_item ...)) @definition.method；grammar.js:273-279 mod_item 的 body 为 declaration_list，故 mod 内函数会命中该模式。原文标为 inference，现已由代码直接确认。 |
| confirmed | ts-queries / rust-nolsp | tree-sitter-rust tags.scm 没有 const/static、enum_variant、use_declaration 等捕获，共 60 行 | tags.scm 全文 60 行，grep const/use_declaration 无命中，全文无 enum_variant 捕获。引用捕获（call_expression identifier、field_expression、macro_invocation、impl_item）确实存在（tags.scm:43-60）。 |
| confirmed | ctags | Rust 解析器 kind 表共 13 种 kind（module 到 constant），无 use/import 类 | ctags/parsers/rust.c:58-72 rustKinds 表恰好 13 项，无 import 类 kind。 |
| partly | ctags | Helix 的 Rust tags.scm 只有定义捕获、没有引用捕获 | helix/runtime/queries/rust/tags.scm（29 行）确实只有 @definition.*，无 @reference.*。但该结论只适用于 Helix 的文件，不是 tree-sitter-rust 仓库的 tags.scm（后者有引用捕获，见 ts-queries 与 rust-nolsp）。Helix 版本含 const_item、enum_variant 和 function_signature_item 的定义捕获，这与 ts-queries 说的 tree-sitter-rust 缺 const/variant 不是同一文件，报告里需明确标注文件来源。 |
| confirmed | ts-go | attention/native 没有 import "C"，go.mod 中也没有 tree-sitter 依赖 | native/ 下 grep 'import "C"' 命中 0 个文件；native/go.mod 无 tree 相关 require。 |
| partly | ts-go | mygo 模块内没有真正的 cgo 源文件，mygo AGENTS.md 要求 CGO_ENABLED=0 | AGENTS.md:14 确有 No cgo / CGO_ENABLED=0 规则。mygo 模块中 import "C" 只命中 cmd/mygo/vet_ui.go:94 的注释，无真正 cgo 文件，结论成立。但研究引用的是 v0.7.5-0.20261104191142-c9438876cbd1，而 attention/native/go.mod 实际锁定的是 mygo v0.7.2-0.20261028073710-642005fd4978。规则是否一致未在旧版本上核对，应以 attention 实际依赖版本为准。 |
| confirmed | ts-go | rust 与 python 语法源 parser.c 分别为 6.5M 与 3.4M；go-tree-sitter 依赖 lib.c 的 cgo 构建；go.mod 固定 rust 0.23.2、python 0.23.6 | ls -la 得 tree-sitter-rust/src/parser.c 6.5M、tree-sitter-python/src/parser.c 3.4M；go-tree-sitter/tree_sitter.go:4-6 含 #include "lib.c"；go.mod:17、19 分别为 python v0.23.6、rust v0.23.2。scanner.c 大小未核对。 |
| confirmed | hybrid | Zed 跳转失败后的回退只有 None 与 FindAllReferences 两个分支，即引用搜索而非语法启发式 | zed/crates/editor/src/navigation.rs:1047-1059 的 match 仅有 GoToDefinitionFallback::None 与 FindAllReferences；hover_links.rs:447-470 也只在设置为 FindAllReferences 时派发引用查找。 |
| confirmed | scip | SymbolRole 位集：Definition=0x1、Import=0x2、WriteAccess=0x4、ReadAccess=0x8、Generated=0x10、Test=0x20、ForwardDefinition=0x40 | scip/scip.proto:524-545 的 enum SymbolRole 数值与报告完全一致。 |
| confirmed | stackgraphs | stack-graphs 的 storage VERSION=6；c.rs 中有 42 个 extern C 函数；语言定义只有 java/javascript/python/typescript，没有 Rust；Python tsg 为 1377 行 | storage.rs:37 VERSION=6；c.rs 中 extern "C" 计数 42；stack-graphs/languages/ 只有 java、javascript、python、typescript 四个目录；stack-graphs-python src/stack-graphs.tsg 为 1377 行。 |
| partly | stackgraphs | GitHub stack-graphs 已归档（isArchived=true，pushed 2025-09-09，最新 release tree-sitter-stack-graphs-v0.10.0 为 2024-12-13） | 本地 README.md:1 写明 no longer supported or updated by GitHub，属实。归档标志、stars 与 release 日期来自 gh api，本次未联网核对，只能确认 README 声明，无法独立确认 isArchived 字段与 release 日期。 |
| unverifiable | ghnav / stackgraphs | GitHub 官方文档列出的 21 种支持语言包含 Rust，但文档不区分精确与搜索两种模式 | 需要抓取 docs.github.com 原文核对，本次未联网；仅能确认本地 stack-graphs 没有 Rust 语言包，Rust 不能确认为精确导航。 |

题目之间的矛盾：

- ctags 组说 Rust 的 tags.scm 只有定义捕获、没有引用捕获（依据 helix/runtime/queries/rust/tags.scm），而 ts-queries 与 rust-nolsp 说 tree-sitter-rust/queries/tags.scm 有 call_expression、field_expression、macro_invocation、impl_item 的引用捕获。两者针对不同仓库的不同文件，但报告里都叫“Rust tags.scm”，读者容易误解为同一份文件，需要统一标注来源。
- ts-queries 说 tree-sitter-rust 的 tags.scm 缺 const_item、enum_variant 捕获；而 ctags 组引用的 Helix Rust tags.scm 含 const_item（@definition.constant）与 enum_variant（@definition.struct）。同样是文件来源不同，不是真实冲突，但若写进设计文档会自相矛盾。
- ts-go 组的结论引用 mygo v0.7.5-0.20261104191142-c9438876cbd1 的 AGENTS.md 与 cgo 规则，而 attention/native/go.mod 实际锁定 mygo v0.7.2-0.20261028073710-642005fd4978。结论（禁止 cgo）依据的版本与 attention 实际依赖的版本不一致，需要以锁定版本复核。
- ts-go 总结称 mygo 有 CGO_ENABLED=0 约束并建议避开 cgo 绑定，而 ghnav 与 ts-core 等组把 tree-sitter 作为 GitHub 搜索导航的基础；这不是矛盾，但 ts-go 的 Go 绑定选型结论与其他组的语法数据（语法 MIT 许可、GPL/MPL 语法）尚未在同一份选型表中对齐。

全部事实见 [facts/A5.md](facts/A5.md)。
