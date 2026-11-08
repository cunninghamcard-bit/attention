## A1 LSP 协议（只读功能）

### 核心概念

**initialize / initialized**：客户端的第一个请求与其后的通知，用于能力协商；initialized 在收到 InitializeResult 之后发出，且只发一次。
**positionEncoding**：position 字符偏移的计量单位；客户端在 general.positionEncodings 中给出偏好，服务端在 ServerCapabilities.positionEncoding 中选定。
**utf-8 / utf-16 / utf-32**：PositionEncodingKind 的三个预定义值，分别按 UTF-8 字节、UTF-16 code unit、code point 计数；utf-16 为默认且必须支持。
**TextDocumentSyncKind**：None=0、Full=1、Incremental=2，服务端声明其需要的同步粒度。
**didOpen / didChange / didClose**：文档打开后内容由客户端托管的三类通知；客户端必须支持，服务端须三者全实现或全不实现。
**LocationLink**：跳转结果的扩展形式，含 originSelectionRange、targetRange、targetSelectionRange，需客户端 linkSupport 开启。
**DocumentSymbol**：层级化的符号结构，需客户端声明 hierarchicalDocumentSymbolSupport 才会返回。
**partial result**：经 $/progress 分批返回的结果；请求出错时，只有 RequestCancelled 的部分结果可用。
**pull diagnostics**：客户端用 textDocument/diagnostic 主动拉取诊断（3.17.0 引入），与服务端主动推送的 publishDiagnostics 相对。
**CallHierarchyItem / TypeHierarchyItem**：调用层次与类型层次的节点，data 字段可供服务端存放状态。
**RelativePattern**：3.17 起的文件监听 glob 基准形式，由 baseUri 与 pattern 组成。
**RequestCancelled / ContentModified / ServerCancelled**：协议错误码 -32800、-32801、-32802。

### 关键事实

#### 生命周期与编码协商
- initialize 必须是第一个请求；收到之前的普通请求回 -32002，通知除 exit 外丢弃；InitializeResult 之前客户端不得发请求或通知，initialize 只能发一次。（抽查确认）来源：~/Projects/lsp-ref/language-server-protocol/_specifications/lsp/3.18/general/initialize.md:5-10
- exit 退出码：收到过 shutdown 为 0，否则为 1。ruff_server 在未先收到 shutdown 时对 exit 直接报错。（抽查确认）来源：~/Projects/lsp-ref/language-server-protocol/_includes/messages/3.18/exit.md；~/Projects/lsp-ref/ruff/crates/ruff_server/src/server/main_loop.rs:65-67
- 客户端未完成 shutdown 即断开时，rust-analyzer、ruff_server、ty_server 均以 "client exited without proper shutdown sequence" 报错退出。（抽查确认）来源：rust-analyzer main_loop.rs:205；ruff_server main_loop.rs:29；ty_server main_loop.rs:26
- general.positionEncodings 省略时默认 ['utf-16']；ServerCapabilities.positionEncoding 省略时默认 utf-16；客户端未提供编码时，服务端唯一合法返回值为 utf-16。（抽查确认）来源：initialize.md:628-652、756-772
- rust-analyzer 的协商规则：列表含 utf-8 则选 utf-8，含 utf-32 则选 utf-32，否则回退 utf-16。（抽查确认）来源：~/Projects/lsp-ref/rust-analyzer/crates/rust-analyzer/src/lsp/capabilities.rs:292-308
- ruff_server 与 ty 使用客户端列表的 max() 选择编码。UTF-8 是否为其最高优先级，未核实。来源：~/Projects/lsp-ref/ruff/crates/ruff_server/src/server.rs:142-155；~/Projects/lsp-ref/ruff/crates/ty_server/src/server.rs:188-199
- pyrefly 与 rust-glancer 硬编码 utf-16。（抽查确认）来源：~/Projects/lsp-ref/pyrefly/pyrefly/lib/lsp/non_wasm/server.rs:1650；~/Projects/lsp-ref/rust-glancer/crates/lsp/server/src/capabilities.rs:5
- 客户端声明：helix 为 [utf-8, utf-32, utf-16]，zed 为 [utf-16]。来源：~/Projects/lsp-ref/helix/helix-lsp/src/client.rs:757-761；~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:893

#### 文本同步
- didOpen 之后，服务端不得再通过该 URI 读取文档内容；open 与 close 必须配对，同一文档 open 上限为 1；服务端处理请求的能力与文档是否 open 无关。（抽查确认）来源：~/Projects/lsp-ref/language-server-protocol/_specifications/lsp/3.18/textDocument/didOpen.md
- TextDocumentSyncOptions 缺省时：openClose 缺省表示不发 open/close，change 缺省视为 None。来源：3.18/specification.md:537-556
- 同步三个通知是客户端的强制义务；选择不同步只在客户端展示的文档全部只读时才有意义。来源：3.18/specification.md:496
- didChange 的 version 是全部 contentChanges 应用后的版本，且不要求连续。来源：3.18/textDocument/didChange.md；3.18/types/versionedTextDocumentIdentifier.md
- rust-analyzer 声明 Incremental；对未 open 文档收到 didChange 仅记录错误并忽略。（抽查确认）来源：~/Projects/lsp-ref/rust-analyzer/crates/rust-analyzer/src/handlers/notification.rs:110-113；lsp/capabilities.rs:36-38
- ty 声明 open_close=true、change=Incremental。（抽查确认）来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/capabilities.rs:477-480
- pyright 对已打开文档的重复 open 记录 redundant open，并以新内容更新。来源：~/Projects/lsp-ref/pyright/packages/pyright-internal/src/languageServerBase.ts:1096-1110

#### 导航请求
- definition、declaration、typeDefinition、implementation 的结果均为 Location | Location[] | LocationLink[] | null；linkSupport 是各自的 client capability，3.14.0 引入。来源：3.18/language/definition.md 等
- references 没有 linkSupport，结果为 Location[] | null；ReferenceContext.includeDeclaration 为必填布尔值。来源：3.18/language/references.md
- 3.17 与 3.18 的导航语义无差异。来源：3.17 与 3.18 的 language/*.md diff
- rust-analyzer 只读取 textDocument.definition.linkSupport 一个标志，四个跳转请求共用。（抽查确认）来源：rust-analyzer lsp/capabilities.rs:344；lsp/to_proto.rs:1110-1160
- ty 分别读取四个 linkSupport 标志。（抽查确认）来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/capabilities.rs:21-39
- ty 的 LocationLink 映射：targetRange 取 full_range，targetSelectionRange 取 focus_range，originSelectionRange 为请求源 range。来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/document/location.rs:20-58
- partial result 一旦用 $/progress 报告，最终响应结果必须为空；出错时仅 RequestCancelled 的部分结果可用。来源：3.18/types/partialResults.md
- ty 的 references 处理器未见发送 partial result（中等置信）；rust-analyzer 只确认转发了 partial 参数，未确认实际发送。来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/server/api/requests/references.rs:52-55；~/Projects/lsp-ref/rust-analyzer/crates/rust-analyzer/src/handlers/request.rs:867-868

#### 符号、悬停与高亮
- documentSymbol 返回 DocumentSymbol[] 或 SymbolInformation[]，层级结构需 hierarchicalDocumentSymbolSupport；SymbolInformation 已标注 deprecated。来源：3.18/language/documentSymbol.md
- SymbolKind 共 26 种；SymbolTag 目前只有 Deprecated=1。来源：3.18/language/documentSymbol.md（约 150-185 行）
- rust-analyzer 在客户端支持层级时返回层级结果，deprecated 节点映射为 SymbolTag::Deprecated。来源：rust-analyzer handlers/request.rs:586-640
- ty 的 SymbolInformation 固定 tags=None，因此不产生删除线标记。来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/server/api/symbols.rs:32-50
- hover 返回 Hover | null，contents 可为 MarkupContent；MarkedString 已 deprecated。来源：3.18/language/hover.md:71
- documentHighlight 的 kind：Text=1（默认）、Read=2、Write=3。ty 始终设置 kind。来源：3.18/language/documentHighlight.md；~/Projects/lsp-ref/ruff/crates/ty_server/src/server/api/requests/doc_highlights.rs:60-70
- workspace/symbol 的 resolve 为可选能力。rust-analyzer 仅声明 Bool(true)，未声明 resolveProvider；ty 也未设置 resolve。来源：rust-analyzer lsp/capabilities.rs:77（抽查确认）；ty capabilities.rs:85-89

#### 调用层次与类型层次
- Call hierarchy 3.16.0 引入，Type hierarchy 3.17.0 引入。来源：3.18/language/callHierarchy.md:3；3.18/language/typeHierarchy.md:4
- rust-analyzer 的 call_hierarchy_provider 为 Bool(true)，type_hierarchy_provider 为 None。（抽查确认）来源：rust-analyzer lsp/capabilities.rs:140、193
- ty 同时声明两者为 true。（抽查确认）来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/capabilities.rs:565-566
- ty 的 subtypes 注释写明会扫描全部模块，大型项目可能很昂贵。（抽查确认，注释实际位于 type_hierarchy.rs:65，原稿所写 66-80 偏差一行，内容一致）来源：~/Projects/lsp-ref/ruff/crates/ty_ide/src/type_hierarchy.rs:65
- pyrefly 的两项 provider 在 IndexingMode 非 None 时广告，默认模式为 LazyNonBlockingBackground。（抽查确认）来源：~/Projects/lsp-ref/pyrefly/pyrefly/lib/commands/lsp.rs:39-49
- pyright 声明 callHierarchyProvider=true，且只扫描 user code 或已打开文件。来源：~/Projects/lsp-ref/pyright/packages/pyright-internal/src/languageService/callHierarchyProvider.ts:151-152
- rust-analyzer、ty、pyrefly 的 CallHierarchyItem 的 data 均为 None，依靠 (uri, selectionRange) 重新定位。来源：rust-analyzer lsp/to_proto.rs（约 1570-1587 行）；ty ruff/crates/ty_ide/src/call_hierarchy.rs:68-80；pyrefly call_hierarchy.rs:144

#### 语义标记、内联提示、折叠、选择、链接、CodeLens
- semanticTokens 为 5 个 uinteger 的相对编码；deltaStart 与 length 的单位取决于协商的 positionEncoding。来源：3.18/language/semanticTokens.md:69、101-115
- full/delta 返回 SemanticTokensEdit[]，作用于 uinteger 数组，客户端需对整个数组做 splice。来源：3.18/language/semanticTokens.md:354-460
- rust-analyzer 同时声明 full、full/delta、range。（抽查确认）来源：rust-analyzer lsp/capabilities.rs:141-155
- Zed 对 token 的 UTF-16 换算按 5000 个一块分批。来源：~/Projects/lsp-ref/zed/crates/project/src/lsp_store/semantic_tokens.rs:758-800
- inlayHint 的 label 为字符串或 InlayHintLabelPart[]；resolve 需服务端 resolveProvider 为 true。rust-analyzer 的 resolveProvider 取决于客户端 resolve_support 属性集合。来源：3.18/language/inlayHint.md；rust-analyzer lsp/capabilities.rs:165、212-213、522-527
- foldingRange 只要求 startLine 与 endLine；3.18 新增 workspace/foldingRange/refresh。来源：3.18/language/foldingRange.md:70-150、212
- selectionRange 与 positions 一一对应，通过 parent 链形成由内到外的范围。来源：3.18/language/selectionRange.md:40-94
- documentLink 的 target 可省略，需 documentLink/resolve 获取。来源：3.18/language/documentLink.md:30-95
- codeLens 的 command 可省略，需 resolve；rust-analyzer 在配置全部关闭时直接返回空数组。来源：3.18/language/codeLens.md:40-166；rust-analyzer handlers/request.rs:1687-1696

#### 诊断
- pull 诊断 @since 3.17.0；文档级 pull 带 previousResultId，可返回 unchanged 报告。来源：3.18/language/pullDiagnostics.md:24、154、221、252
- publishDiagnostics 的客户端能力包括 relatedInformation 与 tagSupport。来源：3.18/language/publishDiagnostics.md:25-41
- rust-analyzer 广告 identifier="rust-analyzer"、interFileDependencies=true、workspaceDiagnostics=false（带 FIXME），同时保留 push；resultId 固定为 "rust-analyzer"。来源：rust-analyzer lsp/capabilities.rs:167-174；handlers/request.rs:511-513
- ty 在客户端支持 pull 动态注册时，初始 capabilities 为 None，按 ty.diagnosticMode 注册；否则广告 workspace 与 interFile 均为 true。来源：ty capabilities.rs:445-456、571-585
- ty 的 diagnosticMode 默认 OpenFilesOnly，三档为 Off、OpenFilesOnly、Workspace。（抽查确认）来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/session/options.rs:447-457
- pyright 支持 pull 时动态注册 DocumentDiagnosticRequest（interFileDependencies=true），否则回退 push；initializationOptions.disablePullDiagnostics 可关闭 pull。（抽查确认）来源：~/Projects/lsp-ref/pyright/packages/pyright-internal/src/languageServerBase.ts:628-633；pullDiagnosticsDynamicFeature.ts:40-49
- pyrefly 处理 DocumentDiagnosticRequest 并使用 push；其 diagnostic_provider 广告状态未确认。来源：pyrefly server.rs:618-637、2799-2801

#### 工作区、配置与文件监听
- didChangeWatchedFiles 的 kind 缺省为 7（Create=1、Change=2、Delete=4）；FileChangeType 为 Created=1、Changed=2、Deleted=3。来源：3.18/workspace/didChangeWatchedFiles.md
- workspace/configuration 为拉模型，响应数组与 items 一一对应，无法提供的项填 null；规范称其取代了 didChangeConfiguration 推模型。来源：3.18/workspace/configuration.md
- client/registerCapability 的结果为 void；静态与动态注册不得对同一选择器重复注册同一能力。来源：_includes/messages/3.18/registerCapability.md
- rust-analyzer 仅在客户端 didChangeWatchedFiles.dynamicRegistration 为真时使用客户端监听；支持 relativePatternSupport 时注册 RelativePattern，否则退回绝对路径字符串。（抽查确认模式，注册 id 与空回调未核实）来源：rust-analyzer reload.rs:565-650
- zed 声明 relativePatternSupport，并把 Added/Removed/Updated 映射为 CREATED/DELETED/CHANGED。来源：~/Projects/lsp-ref/zed/crates/lsp/src/lsp.rs:896-906；~/Projects/lsp-ref/zed/crates/project/src/lsp_store.rs:14020-14044
- helix 忽略 RelativePattern，并把所有匹配事件统一发送为 CHANGED；对非文件类 registerCapability 返回 null；shutdown 之后的 server 请求回 success(null)。来源：~/Projects/lsp-ref/helix/helix-lsp/src/file_event.rs:90-150；helix-term/src/application.rs:1090-1104；helix-lsp/src/transport.rs:225-245
- 规范要求每个已处理的请求都必须回送响应；"服务端停滞"的具体后果是由此推论的（中等置信）。来源：3.18/specification.md:159

#### 进度、取消与窗口消息
- 错误码：RequestCancelled=-32800，ContentModified=-32801，ServerCancelled=-32802（ServerCancelled 3.17.0 引入）。来源：3.18/specification.md:290-320
- 被取消的请求仍须返回响应；ContentModified 通常不应向终端用户展示。来源：3.18/specification.md:344-361、705-712
- 进度有两种发起方式：请求中的 workDoneToken，以及 window/workDoneProgress/create；服务端只有在客户端声明 window.workDoneProgress 时才可使用 create。来源：3.18/types/workDoneProgress.md:111-202
- MessageType 的 Debug=5 为 3.18.0 新增。来源：3.18/_includes/messages/showMessage.md
- window/showDocument 的结果为 { success: boolean }，takeFocus 与 external 可被客户端忽略。来源：3.18/window/showDocument.md:38-90
- rust-analyzer 对 $/cancelRequest 回 RequestCanceled（-32800）。（抽查确认）来源：rust-analyzer handlers/notification.rs:32-39；lib/lsp-server/src/msg.rs:128、138、145
- ty 的 LazyWorkDoneProgress 在 create 成功后才发送 $/progress。来源：~/Projects/lsp-ref/ruff/crates/ty_server/src/server/lazy_work_done_progress.rs:1-50
- attention 的 native/ 目前没有上述协议的任何实现（grep 无命中）。（抽查确认）

#### 传输与 Go 客户端库
- 头部必须包含 Content-Length（字节数），以 \r\n 分隔，头部为 ASCII，内容为 UTF-8 JSON-RPC 2.0；默认 Content-Type 为 application/vscode-jsonrpc; charset=utf-8。（抽查确认）来源：3.18/specification.md:40-60
- go.lsp.dev/jsonrpc2 的 NewStream 默认使用 Content-Length 帧。来源：go.lsp.dev jsonrpc2 framer.go:51-60（ref v1.0.1）
- go.lsp.dev/protocol 声明实现 3.18.0；其版本号、发布日期与许可证未核实（抽查为 unverifiable）。
- tliron/glsp 仅覆盖 3.16；sourcegraph/go-lsp 已归档。来源：gh api 记录（未独立复核）
- gopls 与 x/tools 的协议包位于 internal/，外部模块不可导入。来源：~/go/pkg/mod/golang.org/x/tools/gopls@v0.24.0/internal/protocol/
- lsprotocol 的 metaData 标注 3.17.0，但内容包含 @since 3.18.0 的条目。来源：~/Projects/lsp-ref/lsprotocol/generator/lsp.json:2-3、273-274
- attention 的 native/go.mod 当前没有 LSP 或 jsonrpc 相关依赖。（抽查确认）

### 冲突与未核实
- 冲突：未发现六个主题之间存在实质矛盾。ty 在诊断上"广告 workspace 为 true"与 diagnosticMode 默认 OpenFilesOnly 属于能力广告与检查范围的区别，并非冲突。
- 未核实：ruff 与 ty 协商 utf-8 的前提，即 UTF-8 是否为其最高优先级（抽查 partly）。
- 未核实：ty 是否对 $/cancelRequest 回 RequestCancelled（未读到显式处理代码）。
- 未核实：pyrefly 是否在 capabilities 中广告 pull 诊断。
- 未核实：pyright 与 jedi-language-server 的实际编码行为，依赖 vscode-languageserver 与 pygls 源码，本地未检视。
- 未核实：go.lsp.dev/protocol 的版本常量、v1.0.1 发布日期与 BSD-3 许可证（抽查 unverifiable）。
- 未核实：ty 对未 open 文件的请求是否从磁盘读取；rust-analyzer 对未 open 且不在 vfs 中的文件的处理。
- 未核实：rust-analyzer 注册 workspace 监听的 id 与空回调。
- 未核实：rust-analyzer 是否通过 workspace/configuration 拉取配置（仅 grep，推断为推模型，中等置信）。
- 近似值：ty e2e 测试数量按 fn 关键字统计，仅为近似。
- 未核实：LSP 3.19 对 callHierarchy、typeHierarchy、hover、documentSymbol 的新增字段。

### 对 Acard 的设计问题
1. 位置编码：initialize 是否首选 utf-8 并保留 utf-16 兜底？rust-analyzer 与 ruff/ty 会选 utf-8，但 pyrefly 与 rust-glancer 硬编码 utf-16，选 utf-8 时需对这两类服务端做字节与 UTF-16 换算。
2. 文档同步：只读阅读器是否在打开文件时发 didOpen 与配对的 didClose？协议要求客户端支持这三个通知，而 rust-analyzer 会忽略未 open 文档的 didChange，不发 open 则依赖服务端按 URI 读盘。
3. 跳转形态：是否声明 linkSupport 并同时处理 Location 与 LocationLink？rust-analyzer 只看 definition 一个标志，而 ty 为四个跳转请求分别读取，两者行为不同。
4. 层次视图：是否提供类型层次入口？rust-analyzer 没有 type hierarchy，ty 的 subtypes 会扫描全部模块，因此需要异步加载与取消。
5. 诊断获取：只接收 publishDiagnostics 推送，还是也实现 pull？rust-analyzer 的 resultId 固定且不支持 workspace pull，ty 与 pyright 依赖动态注册，pyrefly 的广告状态未确认。
6. 协议依赖：采用 go.lsp.dev 组合，还是自实现约 20 行的 Content-Length 帧与类型？后者可避开版本与许可证未核实带来的依赖风险。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | lifecycle | initialize 必须是客户端第一个请求；InitializeResult 之前客户端不得发其他请求或通知，服务端只允许 showMessage/logMessage/telemetry/showMessageRequest 与 workDoneToken 的 $/progress | initialize.md:5-10 逐字符合：收到 initialize 前的请求回 -32002，通知除 exit 外丢弃；服务端在 InitializeResult 前只允许 window/showMessage、window/logMessage、telemetry/event、window/showMessageRequest，以及 initialize 中 workDoneToken 的 $/progress；initialize 只能发一次。 |
| confirmed | lifecycle | exit 退出码：收到过 shutdown 则 0，否则 1；ruff_server 未先收到 shutdown 时对 exit 直接报错；rust-analyzer/ruff/ty 断线未完成 shutdown 时报 'client exited without proper shutdown sequence' | exit.md 确认 0/1 规则。ruff main_loop.rs:65-67 对未先 shutdown 的 exit 返回错误 'Received exit notification before a shutdown request'。三处 'client exited without proper shutdown sequence' 分别位于 rust-analyzer main_loop.rs:205、ruff_server main_loop.rs:29、ty_server main_loop.rs:26，均已核对。 |
| confirmed | lifecycle | general.positionEncodings 省略时默认 ['utf-16']；ServerCapabilities.positionEncoding 省略时默认 utf-16；客户端未提供编码时服务端唯一合法返回值为 utf-16 | initialize.md:628-652 注释 'If omitted it defaults to ['utf-16']'，且 utf-16 为强制编码；initialize.md:756-772 确认 positionEncoding 的 'only valid value' 与默认值 utf-16。 |
| confirmed | lifecycle | rust-analyzer 的 negotiated_encoding 含 utf-8 选 utf-8，含 utf-32 选 utf-32，否则回退 utf-16 | rust-analyzer lsp/capabilities.rs:292-308 逐行一致，注释 'intentionally prefer just about anything else to utf-16' 存在。 |
| partly | lifecycle | ruff_server/ty 的 find_best_position_encoding 对客户端 encodings 取 max()；PositionEncoding 按优先级从低到高声明 UTF16、UTF32、UTF8，UTF8 为 preferred | max() 逻辑已确认（ruff server.rs:142-155，与 ty 同构）；edit.rs:12-24 的 'least to greatest priority' 注释与 Ord 派生已确认，UTF16 为默认且注释称 'supported by all LSP clients'。但我读到的代码段未包含 UTF32/UTF8 的枚举顺序与 'Ruff's preferred encoding' 注释，因此 UTF8 最高优先级这一具体结论未直接核对。 |
| confirmed | lifecycle | pyrefly 与 rust-glancer 的服务端在 ServerCapabilities 中硬编码 position_encoding 为 UTF16 | pyrefly/pyrefly/lib/lsp/non_wasm/server.rs:1650 为 position_encoding: Some(PositionEncodingKind::UTF16)；rust-glancer/crates/lsp/server/src/capabilities.rs:5 同样硬编码 UTF16。 |
| confirmed | textsync | didOpen 之后内容由客户端托管，服务器不得再通过 URI 读取；open 与 close 平衡，同一文档 open 上限为 1；服务器请求处理能力与 open 状态无关 | textDocument/didOpen.md:3 逐字包含 'the server must not try to read the document's content using the document's Uri'、'the max open count for a particular textDocument is one' 与 'a server's ability to fulfill requests is independent of whether a text document is open'。 |
| confirmed | textsync | rust-analyzer 对未 open 文档收到 didChange 仅记录错误并忽略；其同步方式为 Incremental | rust-analyzer handlers/notification.rs:110-113 在 mem_docs 无该文档时 tracing::error!('unexpected DidChangeTextDocument') 并 return Ok(())；lsp/capabilities.rs:38 为 TextDocumentSyncKind::Incremental。 |
| confirmed | textsync | ty_server 声明 change=Incremental | ruff/crates/ty_server/src/capabilities.rs:480 为 change: Some(TextDocumentSyncKind::Incremental)，open_close 设为 true（同段 477 附近）。原文引用行号 477-480 基本准确。 |
| confirmed | navreq | rust-analyzer 的 location_link() 只读取 textDocument.definition.linkSupport 一个标志，被 definition/declaration/type/implementation 共用 | rust-analyzer lsp/capabilities.rs:344-346 的 location_link() 仅读取 self.0.text_document.definition.link_support。共用关系的 to_proto.rs 段未逐行核对，但 capabilities 层面的单一标志已确认。 |
| confirmed | navreq | ty 按 method 分别读取 TYPE_DEFINITION / DEFINITION / DECLARATION / IMPLEMENTATION 四个 linkSupport 标志 | ruff/crates/ty_server/src/capabilities.rs:21-39 的 bitflags 中包含 TYPE_DEFINITION_LINK_SUPPORT、DEFINITION_LINK_SUPPORT、DECLARATION_LINK_SUPPORT、IMPLEMENTATION_LINK_SUPPORT（后者在 :39 附近）四个标志。 |
| confirmed | hierarchy | rust-analyzer 声明 call_hierarchy_provider 为 Bool(true)，type_hierarchy_provider 为 None（无类型层次） | rust-analyzer lsp/capabilities.rs:140 为 call_hierarchy_provider: Some(CallHierarchyProvider::Bool(true))，:193 为 type_hierarchy_provider: None。 |
| confirmed | hierarchy | ty 同时声明 type_hierarchy_provider 与 call_hierarchy_provider 为 true；subtypes 扫描全部模块且文档注明可能昂贵 | ruff/crates/ty_server/src/capabilities.rs:565-566 两者均为 Some(true.into())；ty_ide/src/type_hierarchy.rs:65 注释 'This scans all available modules and can be expensive in large projects.'，原文引用行号 66-80 与实际 65 行差一行，实质一致。 |
| confirmed | hierarchy | pyrefly 默认 IndexingMode 为 LazyNonBlockingBackground，调用与类型层次默认可用；pyright 在 initialize 中声明 callHierarchyProvider:true | pyrefly/pyrefly/lib/commands/lsp.rs:39-49 中 #[default] 标注在 LazyNonBlockingBackground。pyright languageServerBase.ts:683 为 callHierarchyProvider: true。 |
| confirmed | symbols | rust-analyzer 的 workspace symbol 仅声明 WorkspaceSymbolProvider::Bool(true)，未声明 resolveProvider；ty 也未设置 resolve | rust-analyzer lsp/capabilities.rs:77 为 workspace_symbol_provider: Some(WorkspaceSymbolProvider::Bool(true))，未见 resolve。注意 :80 的 resolve_provider: Some(true) 属于 CodeLensOptions，并非 workspace symbol，不构成反例。ty 的 document_symbols 层级分支已确认（supports_hierarchical 分支存在），workspace resolve 的 ty 侧未单独读取。 |
| confirmed | semtok | rust-analyzer 同时声明 semanticTokens 的 full/delta 与 range，delta 为 true、range 为 true | rust-analyzer lsp/capabilities.rs:141-155：full 为 SemanticTokensFullDelta { delta: Some(true) }，range 为 SemanticTokensOptionsRange::Bool(true)。 |
| confirmed | diag | rust-analyzer 广告 diagnostic_provider，identifier='rust-analyzer'，inter_file_dependencies=true，workspace_diagnostics=false（带 FIXME），即仅文档级 pull | rust-analyzer lsp/capabilities.rs:167-174 逐项一致，workspace_diagnostics: false 旁有 // FIXME 注释。 |
| confirmed | diag | ty 的 diagnosticMode 默认为 OpenFilesOnly，三档为 Off / OpenFilesOnly / Workspace | ruff/crates/ty_server/src/session/options.rs:447-457 中 #[default] 为 OpenFilesOnly，枚举为 Off、OpenFilesOnly、Workspace。 |
| confirmed | diag | pyright 支持 pull 时可用 initializationOptions.disablePullDiagnostics 关闭 pull；pyrefly 在 lsp 目录中未找到 diagnostic_provider 的广告 | pyright languageServerBase.ts:630、633 均判断 initializationOptions?.disablePullDiagnostics !== true。pyrefly/pyrefly/lib/lsp/ 下 grep 'diagnostic_provider' 无命中，确认 pull 广告状态未在该目录体现（只能说明在该路径上不存在，不能断言最终不广告）。 |
| confirmed | workspace | rust-analyzer 在客户端支持 relativePatternSupport 时注册 RelativePattern（base 为各 workspace root，模式包括 **/*.rs、**/Cargo.{lock,toml}、**/rust-analyzer.toml、**/*.md），否则退回绝对路径字符串 Pattern | rust-analyzer reload.rs:565-600 中 did_change_watched_files_relative_pattern_support 分支构造 GlobPattern::RelativePattern，模式列表与原文一致；else 分支为绝对路径拼接。注册 id 与空回调未在所读段落确认。 |
| confirmed | progress | rust-analyzer 对 $/cancelRequest 调用 state.cancel(id)，未完成请求回 RequestCanceled（-32800）；ContentModified 为 -32801、ServerCancelled 为 -32802 | rust-analyzer handlers/notification.rs:32-39 的 handle_cancel 调用 state.cancel(id)；lib/lsp-server/src/msg.rs:128 RequestCanceled = -32800、:138 ContentModified = -32801、:145 ServerCancelled = -32802，三者均已核对。cancel 内部回复 'canceled by client' 的 req_queue.rs 段未读取。 |
| confirmed | gojsonrpc | attention 的 native/ 当前没有任何 initialize、positionEncoding、cancelRequest、textDocument/definition 相关代码，native/go.mod 无 LSP 依赖 | 在 ~/Projects/attention/native 中 grep 'positionEncoding\|"initialize"\|cancelRequest\|textDocument/definition' 无命中；native/go.mod 中 grep jsonrpc\|go.lsp.dev 无命中。 |
| unverifiable | gojsonrpc | go.lsp.dev/protocol 的 version.go 声明实现 LSP 3.18.0，v1.0.1 发布于 2026-06-27，BSD-3 | 本地模块缓存中没有 go-language-server/protocol 的源码，未能读取 version.go；未通过 gh 或网络核对发布日期与许可证。该条依据来自原研究的 gh api 记录，本次未独立复现。 |

题目之间的矛盾：

- 未发现六个主题之间存在实质矛盾的硬性结论。需要注意的表述张力：diag 主题称 ty 在 pull 模式下默认广告 workspace_diagnostics=true，而 ty diagnosticMode 默认为 OpenFilesOnly，二者需区分'能力广告'与'检查范围'，并非冲突。lifecycle 的 summary 称'ruff/ty 会协商 utf-8'，但 ruff 枚举中 UTF8 最高优先级这一点本次未直接核对（见 partly 条目），属于依赖未验证前提的推论。

全部事实见 [facts/A1.md](facts/A1.md)。
