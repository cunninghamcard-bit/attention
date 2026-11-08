## A6 mygo 编辑器、attention 现状与阅读型 UI

### 核心概念

**TokenKind**：mygo 高亮的 uint8 枚举，共 25 种粗粒度类别，主题只按这套枚举上色。
**Language.Highlighter**：语言可选的自定义高亮器工厂，为 nil 时退回内置 Tokenizer。
**Highlighter 接口**：Edit、Highlight(budget)、Tokens 三个方法，增量跟随编辑，final 为 false 时显示猜测结果。
**OnDefinition**：editor.State 的回调，Cmd+click 与 F12 触发，编辑器只回传偏移，不做解析。
**ReadOnly**：editor.State 的只读开关，只拦截编辑命令，文本仍可选中复制。
**NavRevision**：tabtypes.Info 的字段，每次导航递增，textdoc 据此重新应用定位。

### 关键事实

（MG 指 `~/go/pkg/mod/github.com/egoist/mygo@v0.7.5-0.20261104191142-c9438876cbd1/`，见冲突一节）

**高亮（mygo-syntax）**
- 内置 32 种语言（原调研写 33，抽查更正），Rust 与 Python 均内置；内置词法器为手写扫描器，不用正则。 — MG/ui/editor/languages.go:129-496；lexer.go:1-8
- TokenKind 共 25 种，没有 parameter、namespace、enumMember 等细分种类。 — MG/ui/editor/syntax.go:9-42
- 超过 10000 字节的行不高亮；每帧语法高亮预算 4 ms。 — syntax.go:376；paint.go:122
- mygo 模块未依赖 tree-sitter（go.mod 无此依赖），editor 包无 semantic tokens 支持。 — MG/go.mod:1-16；ui/editor 的 grep 无结果
- Rust 单引号规则未见 lifetime 分支，`'a` 可能被误判为字符串（推断，未运行验证）。 — languages.go:205-212

**LSP 接口（mygo-lsp）**
- 已有类型：CompletionRequest、Completion、HoverRequest、Diagnostic（四级 Severity）、Inlay。 — MG/ui/editor/lsp.go:9-90
- 回调与回填：OnCompletion、OnHover、OnDefinition、OnGutterClick；SetDiagnostics（带 version，按编辑迁移偏移）、ShowCompletions、ShowHover、SetInlays、SetSuggestion。 — state.go:86-104, 413-473；state.go:410-437
- 诊断只呈现为文本下方波浪线，滚动条标记最多 2000 个。 — paint.go:448, 648, 878
- 没有 references、peek、call hierarchy、document/workspace symbol、semantic tokens 接口。 — ui/editor 关键词 grep
- 没有链接式悬停（Cmd 悬停下划线或手型光标）的代码证据（推断，build.go 光标逻辑未核对）。 — input.go:331-390
- Cmd+click 分支不检查 readOnly，只读视图也会触发 OnDefinition（抽查确认）。 — input.go:216-220

**只读、折叠、查找（mygo-editor）**
- ReadOnly 在输入层拦截编辑命令；只读时查找栏替换关闭。 — state.go:35-36；input.go:111-113；parts.go:43-45
- 折叠 API：Fold、Unfold、FoldImports、Folded；默认按括号、缩进、import 推导，语言可用 Folder 接口覆盖。 — state.go:364-405；fold.go:9-35
- 查找支持大小写、整词、正则、选区；匹配上限 100000。 — parts.go:18-70；find.go:44
- 行背景与文本背景按固定行号或字节偏移，文本变化后需按 Buffer.Version 重算；gutter 只画单色点，点击只回传行号。 — state.go:96-117, 195-216
- 文本为 4096 字节分块 rope，撤销上限 10000。 — internal/rope/rope.go:21；buffer.go:122-124
- 性能数字未实测，bench_test.go 只定义 10 万行基准，本次未运行。 — bench_test.go:14-19

**attention 现状（attn-code）**
- 文本由 textui 插件渲染（ID text-ui，Fallback 优先级）；textdoc 的 editor.State 为 ReadOnly:true，未设置任何回调。 — native/plugins/textui/textui.go；native/internal/textdoc/textdoc.go:172-175
- 行定位已统一：OpenResource 携带 tabtypes.Nav{Line,To,Col,Len}（1 起始），由 textdoc.Sync 按 NavRevision 应用；gotoline、outline、search、backlinks、CLI 均在使用。 — native/plugins/tabtypes/tabtypes.go:23-46；workspace.go:173
- 命令用 actions.Command，快捷键由 shortcuts 绑定，可被 hotkeys.json 覆盖；gotoline 是现成样板。 — native/plugins/actions/actions.go:50-62；gotoline.go:23-29
- main 的 native/ 中没有 LSP 代码，go.mod 无 LSP 客户端库，也没有 go-to-definition 命令。 — git grep 结果
- index 为纯内存 MetadataCache，只解析 .md（4 MB 上限），每 2 分钟全量重扫；代码文件只入文件名。 — native/plugins/index/index.go:30-34
- 全文搜索不走索引：每次查询 WalkDir 加逐文件 ReadFile，metaFor 为 nil。 — native/plugins/project/project.go:190, 321-334
- outline 明确排除代码文件符号。 — native/plugins/outline/outline.go:1-8

**旧 LSP 方案（attn-oldlsp，提交 fa555f2）**
- 功能：跳转定义（F12、Mod+click）、查找引用（Shift+F12，右侧 References 面板）、hover；不含补全与诊断。 — git show fa555f2 提交正文；LanguageServerRegistry.ts 文件头
- 服务器顺序：python 为 ty、pyrefly、basedpyright、pyright；typescript 为 tsc --lsp、tsgo、typescript-language-server；go、rust、c++ 仅有配置、未测试。 — LanguageServerRegistry.ts
- 规模：32 个文件，+3642 / -194；崩溃退避为 60 秒内 3 次，空闲 5 分钟关闭；会话键为 root 加语言组；失败不缓存。 — LanguageServerService.ts 常量
- 进程：preload 的 lsp-bridge.ts 用 child_process 启动服务，Content-Length 分帧，kill 先 SIGTERM 再 2000 毫秒后 SIGKILL。 — apps/desktop/preload/lsp-bridge.ts
- fa555f2 不是 main 的祖先（main 为 a453570，2026-11-05）。 — git merge-base 检查

**rutis 插件体系（attn-rutis）**
- 每个插件是 rutis.Define；服务通过 Provide 函数字段结构体提供，UI 插件同进程直接拿 Go 指针。 — native/plugins/index/plugin.go:13-60；docs/rfc/0001-go-native-plugin-browser.md:122-130
- 只有 launcher 用 os/exec 启动 rutis-host；插件内没有自管长驻子进程的先例，唯一子进程是 terminalui 经 mygo terminal 启动的 shell。 — native/internal/launcher/launcher.go:374；terminalui.go:24-30
- rutis-host 语言运行时为 binary、bun、go、node、python、swift，无 Rust；Go 运行时 restart 默认为 No。 — rutis crates/rutis-host/src/languages/；config.rs:236-252
- UI 插件只能编译进 Go 二进制；非 Go 服务插件经 plugins.json 加入。 — native/internal/launcher/thirdparty.go:1-20

**线程模型（acard-async）**
- shellapi 已于 2026-11-02 删除，现用 shell.Shell 的 Update 与 shell.OnMain。 — docs/rfc/0001-go-native-plugin-browser.md:546-549
- shell.OnMain 窗口为空时立即返回错误，10 秒超时；在主线程调用不会被阻止，只会超时。 — native/plugins/shell/shell.go:161-191
- 过期结果用 context.WithCancel 加 seq 计数丢弃。 — native/plugins/search/search.go:205-245
- rutis Ctx.Go 在卸载时等待任务结束。 — rutis go/rutis/internal/runtime/runtime.go:1021-1029

**RFC 0006 与 agent 推送（acard-rfc）**
- RFC 0006 为草案（2026-11-09），只在分支 docs/rfc-interaction（d54a62a），main 的 docs/rfc 仅有 0001 至 0004。 — 0006-basic-interaction.md:3-6
- 项目是单一挂载目录，不允许嵌套；移除项目不关闭标签，标签归到 Other。 — 0006-basic-interaction.md:120-123, 149
- 标签所属项目由内容决定并自动迁移。 — 0006-basic-interaction.md:77-87
- RFC 全文没有 LSP、诊断、定义、引用、符号的设计。 — rg 结果
- agent 推送用现有 open CLI，参数只有 path、line、to。 — native/plugins/workspace/plugin.go:297-320；0006 §7.3

**UI 参照（ui-peek、ui-history）**
- VS Code 官方文档：Go to References 为 Shift+F12，Peek Definition 为 Alt+F12，结果内嵌显示；Ctrl+hover 预览，Ctrl+Click 跳转。 — https://code.visualstudio.com/docs/editing/editingevolved（WebFetch 2026-11-09）
- GitHub 符号面板基于 tree-sitter，仅对不超过 100000 个文件的仓库生效。 — https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github
- Sourcegraph 的 Find references 面板结果超过 500 条即截断。 — https://sourcegraph.com/docs/code-navigation/features

### 冲突与未核实

**冲突**
- 版本冲突：native/go.mod 锁定 mygo v0.7.2-0.20261028073710-642005fd4978，而 mygo 的行号结论全部来自 v0.7.5 缓存（c9438876cbd1）。所有 mygo 行号结论需在 v0.7.2 上核对，或先升级 go.mod。
- 只读语义冲突：readOnly 只拦截编辑命令，但 Cmd+click 的 OnDefinition 分支不检查 readOnly，与“只读只拦编辑”的印象不符（已抽查确认）。
- 前提更正：任务中的 shellapi.Update / OnMain 已不存在，应以 shell.Shell 为准。
- 前提冲突：topic 提到“项目有多个文件夹”，但 RFC 0006 的项目是单一目录，没有 multi-root 设计。

**未核实**
- Zed：无 PeekDefinition 动作；multibuffer 默认上下文 2 行、上限 32；find_all_references 单结果直接跳转；sticky header 条数上限未找到常量；hover 延迟未核实。
- Helix：goto_impl 单结果直跳、多结果 Picker；JumpList 容量 30；goto_reference 默认包含声明。
- Zed NavHistory 三栈与上限 1024，未核实。
- VS Code 的 Peek Implementation 是否内嵌，原文未覆盖，未核实。
- GitHub 的 #L 行锚点格式，文档未说明，未核实。
- Zed、Helix 两者的 peek 式内嵌预览是否存在，未核实。
- mygo 高亮与编辑器行为在 v0.7.2 上是否相同，未核实。
- Rust lifetime 误判，未运行验证。
- 旧 LSP 方案中 ty、tsgo 等服务器的当前版本与 TypeScript 7 状态，未核实。
- 所有性能数字未实测：index 2 万文件的建索引与增量耗时，mygo 大文件滚动与打开耗时。
- Go 端 LSP 客户端的循环要求全部为推断。

### 对 Acard 的设计问题

1. 语法高亮是否接受 mygo 的 25 类 TokenKind？若接 LSP semantic tokens 或 tree-sitter，是扩展枚举还是映射到现有 kind。依据：TokenKind 没有 parameter、namespace、enumMember 等细分种类，主题只按枚举上色。
2. 代码导航范围是只做定义与 hover，还是加 references 面板。依据：旧方案已有 Shift+F12 引用面板，而 mygo 编辑器没有任何 references API，需要在共享原语中新增。
3. 多结果引用用列表还是多 excerpt 视图呈现。依据：mygo 只有单色 gutter 点、单色波浪线与 TextBackground，没有可点击的 range 装饰，需要扩展共享原语。
4. 语言服务按项目根还是按标签实例化。依据：RFC 0006 规定项目单目录、可移除、移除后标签归 Other，服务生命周期需跟随项目绑定；旧方案的会话键即为 root 加语言组。
5. 只读阅读视图中 Cmd+click 是否应触发跳转。依据：OnDefinition 分支不检查 readOnly，textdoc 当前只读却会触发回调。
6. 符号索引是否落盘。依据：index 为纯内存、每次启动全量重建，roadmap 要求的 2 万文件耗时尚未测量。

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | mygo-syntax | TokenKind 共 25 种有效 kind（TokenText 到 TokenInvalid），没有 local/parameter/namespace 等细分种类 | syntax.go:9-42 的 const 块逐项数为 25 个（Text 到 Invalid），之后是 tokenKinds 计数哨兵。没有细分种类。 |
| wrong | mygo-syntax | 内置语言共 33 个，Rust 和 Python 都是内置的 | languages.go 中 Name 字段共 32 个（grep 计数为 32，逐个列出也是 32）：Go, JavaScript, TypeScript, JSON, Python, Rust, C, C++, Java, Kotlin, Scala, Swift, Dart, C#, Shell, YAML, TOML, SQL, R, Ruby, Lua, PHP, CSS, HTML, XML, Markdown, Diff, Dockerfile, Makefile, Protobuf, GraphQL, Zig。正确数字是 32。Rust 和 Python 确为内置。 |
| confirmed | mygo-syntax | 超长行不做高亮：maxTokenize = 10000 字节 | syntax.go:376 const maxTokenize = 10000，syntax.go:329 在 Tokens 中使用。 |
| confirmed | mygo-editor | 每帧语法高亮时间预算 4 ms（advanceSyntax） | paint.go:122 调用 v.advanceSyntax(f.last+1, 4*time.Millisecond)。paint.go:100 对 measureWraps 也是 4ms 预算。 |
| confirmed | mygo-lsp | Cmd+click（mods == ui.Cmd，单击）先落光标再调用 onDefinition(off)，不做解析 | input.go:216-220：case mods == ui.Cmd && ed.o.onDefinition != nil && ev.Clicks == 1 中先 setSels，再调用 ed.o.onDefinition(off)。补充：该分支没有检查 readOnly，所以只读视图里 Cmd+click 仍会触发 OnDefinition（与 attn-code 的 inference #21 方向一致）。 |
| confirmed | mygo-lsp | 诊断只有文本下方波浪线；滚动条标记最多 2000 个；没有其他 range 装饰类型 | paint.go:448 调用 squiggle(...SeverityColor)，squiggle 定义在 paint.go:648；滚动条标记循环在 paint.go:878 `if i > 2000` 截断。 |
| confirmed | mygo-editor | 只读时查找栏替换被关闭（Replacing/CanReplace 以 !readOnly 为条件） | parts.go:43-45：Replacing() 返回 f.ed.find.replacing && !f.ed.o.readOnly，CanReplace() 返回 !f.ed.o.readOnly。 |
| confirmed | mygo-editor | 查找上限 maxMatches=100000；diff 重比较区域上限 diffMaxRegion=20000 行；rope ChunkBytes=4096；undoMax=10000，logMax=256，groupTimeout=300ms | find.go:44 maxMatches = 100000；diffmodel.go:34 diffMaxRegion = 20000；internal/rope/rope.go:21 ChunkBytes = 4096；buffer.go:122-124 logMax=256、undoMax=10000、groupTimeout=300ms。数字都对，行号与文件路径略有偏差（buffer 常量在 buffer.go:122 而非 14-17 行）。 |
| confirmed | attn-code | textdoc 的 editor.State 为 ReadOnly:true、NoScrollPastEnd:true，且未设置 OnDefinition/OnHover 等回调；ui/editor 只被 textdoc 与 appearance 使用 | native/internal/textdoc/textdoc.go:172-175 为 &editor.State{ReadOnly: true, NoScrollPastEnd: true}；在 textdoc.go 中无 OnDefinition 或 OnHover 命中。git grep ui/editor 的文件为 textdoc.go、appearance/appearance.go、appearance_test.go、build.go。 |
| confirmed | attn-rutis | attention 锁定的依赖是 rutis v0.19.4-0.20261102025122-f581e25d5f6d 与 mygo v0.7.2-0.20261028073710-642005fd4978，不是 v0.7.5 | native/go.mod:8-9 确认这两个版本。这与其他主题引用的 v0.7.5 模块缓存不一致，见 conflicts。 |
| confirmed | attn-rutis | rutis-host 的语言运行时只有 binary/bun/go/node/python/swift（没有 Rust），Kotlin 挂起 | ~/Projects/rutis/crates/rutis-host/src/languages/ 下只有 binary.rs、bun.rs、go.rs、mod.rs、node.rs、python.rs、swift.rs。Restart 枚举 config.rs:243 默认 No。 |
| confirmed | attn-oldlsp | fa555f2 的崩溃退避 MAX_CRASHES=3、CRASH_WINDOW_MS=60000、IDLE_MS=5 分钟；旧 LSP 提交不是 main 的祖先 | git show fa555f2:apps/web/builtin/language-server/LanguageServerService.ts 第 34、35、37 行常量正确。git merge-base --is-ancestor fa555f2 main 返回 NOT_ANCESTOR。 |
| confirmed | attn-oldlsp | main 的 native/ 下没有任何 language-server 或 lsp 代码 | git grep -il -E 'language.?server\|lsp' main -- native 无输出。 |
| confirmed | acard-async | shellapi 包已在 2026-11-02 的方案中删除，现在用 shell.Shell 的 Update 与 OnMain | git grep -n shellapi main -- native 无输出。这一点与任务前提（shellapi.Update/OnMain）不符，应以 shell.Shell 为准。 |
| confirmed | acard-async | shell.OnMain 在窗口为空时立即返回错误，超时为 10 秒 | native/plugins/shell/shell.go:169 返回 'the window is closed'；shell.go:176 为 time.NewTimer(10 * time.Second)；shell.go:186 返回 'the window did not respond'。 |
| confirmed | acard-rfc | RFC 0006 尚未进入 main，只在 docs/rfc-interaction 分支；main 的 docs/rfc 只有 0001-0004 | ls docs/rfc 只有 0001（三个文件）、0002、0003、0004，没有 0006。git branch -a 显示 docs/rfc-interaction 与 remotes/origin/docs/rfc-interaction。 |
| confirmed | acard-index | 笔记大小上限 maxNote=4<<20；全量重扫 rescanEvery=2 分钟 | native/plugins/index/index.go:30-34 分别为 maxNote = 4 << 20 与 rescanEvery = 2 * time.Minute。 |
| confirmed | acard-index | search 的 metaFor 为 nil（project.New 调用 NewEngine(nil)），搜索不接入 index | native/plugins/project/project.go:190 为 NewEngine(nil)。 |
| confirmed | acard-index | outline 插件明确排除代码文件符号，只显示笔记标题 | native/plugins/outline/outline.go 包注释第 6-7 行：Left out: code-file symbols (OutlineView.renderForCodeView); the reader has no CodeFileView。 |
| unverifiable | ui-peek | Zed 无 PeekDefinition 动作；excerpt_context_lines 默认 2、上限 32；Helix goto_impl 单结果直接跳、多结果弹 Picker | 未打开 ~/Projects/lsp-ref 中的 Zed 与 Helix 源码，本次预算内未核对。 |
| unverifiable | ui-history | Zed NavHistory 三栈、上限 1024；Helix JumpList 容量 30 | 未核对 ~/Projects/lsp-ref 中的 Helix view.rs 与 Zed pane.rs，本次预算内未核对。 |

题目之间的矛盾：

- mygo 版本不一致：attention 的 native/go.mod 锁定 mygo v0.7.2-0.20261028073710-642005fd4978（attn-rutis #1），但 mygo-syntax #21、mygo-lsp #16、mygo-editor、attn-code #3、acard-async #7 等都把 v0.7.5-0.20261104191142-c9438876cbd1 模块缓存的行号当作 attention 的实际行为。两个版本的行号和实现可能不同，所有引用 v0.7.5 行号的结论都需要在 v0.7.2 上重新核对，或先升级 go.mod。
- mygo-syntax 内部矛盾：摘要与 fact 5 写 33 种内置语言，但 fact 5 列出的 Name 只有 32 个（languages.go 实测 32）。
- mygo-editor fact 2 与 mygo-lsp fact 6 对只读的描述有出入：readOnly 只拦截 commandEdits（input.go:111），而 Cmd+click 的 OnDefinition 分支（input.go:216）不检查 readOnly。因此只读的 textdoc 仍会触发跳转回调，与“只读只拦编辑”的整体印象不符。
- acard-async 与 attn-rutis 对 mygo 的使用范围不同：acard-async 的线程模型引用 v0.7.5 的 content.go 与 loop.go，而 attention 实际编译的是 v0.7.2，这一点需要同样的版本核对。

全部事实见 [facts/A6.md](facts/A6.md)。
