# RFC 0001：attention 重写为 Go 原生、一切皆插件的阅读型浏览器

- 状态：Draft（含 2026-11-01 架构与产品线决议；2026-11-02 按 `native/` 代码改写 §5、§6、§10）
- 日期：2026-10-26
- 范围：整个产品，包括 apps/web、apps/desktop 和 packages/shared
- 路线图：[docs/roadmap.md](../roadmap.md)
- 产品线与定位：[docs/product.md](../product.md)

## 1. 摘要

attention 从「Electron + TS 实现的 Obsidian 重建」改为**全 Go 实现的、以阅读为主的浏览器**：

- 界面使用 mygo 的原生 UI（`ui` 包，由 GPU 绘制，没有 DOM）。网页通过 `ui.WebView` 嵌入。
- 插件运行时使用 rutis。**没有特权内核**：外壳、布局、标签页、导航、索引和 CLI 服务端全部是插件。结构参照 deepseek-harness（下称 dsh）。
- 内容模型从「Markdown vault」改为「按地址读取的资源」。资源协议的 provider、tab type（显示某类地址的标签页）、index 都由插件提供，模型照搬 dsh。
- agent 通过 attention CLI 操控应用。所有插件命令都会自动成为 CLI 子命令。

不再兼容 Obsidian 插件 API，也不运行真实的 dsh 插件，dsh 只作为架构参考。

## 2. 动机

1. **产品定位变了。** attention 要成为一个能接入 agent、以阅读和查看为主的浏览器，不再是 Markdown 编辑器。编辑能力降级：不做 LSP，也不做实时预览。只读不是产品要求：源码和纯文本标签应能改字并写回文件。当前代码仍是 `ReadOnly`，这一条还没改。
2. **现有架构的负担。**
   - `apps/web/app/App.ts` 一次性构造约 60 个服务，`app.workspace` 在 `apps/web` 里被引用约 550 次，`app.vault` 约 410 次。
   - 内置插件通过 `plugin.app.X` 随意访问其他服务，功能之间没有边界。
   - 为了忠实复刻 Obsidian，维护着一套兼容层（`apps/web/api/` 约 530 行，加上 `plugin/` 里的社区插件运行时约 3.4k 行）和约 3.6k 行 `*Parity*` 测试，在新定位下都没有价值了。
3. **一切皆插件。** git、GitHub（octogo）、终端、各类查看器都应该能单独接入和替换。这需要一个真正的插件运行时，而现有的 `InternalPluginDefinition` 加上静态 `corePlugins[]` 数组做不到。
4. **全 Go。** 用户的另一个项目 octogo 已经验证了 mygo 原生 UI 能支撑大型应用（约 18.5 万行 Go，含测试），attention 可以沿用同一套技术栈和组件规范。

## 3. 目标与非目标

**目标**

- G1：用一个 Go 二进制提供完整的桌面应用，Linux 优先，同时覆盖 macOS 和 Windows。
- G2：所有功能都以插件形式接入，可以单独启用、停用或替换。
- G3：以资源为中心的阅读体验，资源包括本地文件、git 对象和插件自定义的协议；网页由 `web` 标签页显示。
- G4：CLI 的 socket 协议（一行 `{argv, tty, cwd}`）保持兼容；现有命令尽量保持原有的名字、参数和输出，因为资源模型而改变的地方逐条记录在 `docs/cli-deviations.md` 里（§5.9）。
- G5：服务插件可以运行在独立进程里，用任意 rutis 支持的语言编写，支持热重载。

**非目标**

- 兼容 Obsidian 插件 API、社区插件、主题市场。
- 运行真实的 dsh 插件（它们的 client 半是 React 加 DOM，host 半是 Node）。
- Markdown 编辑器体验：实时预览、LSP、补全。阅读视图本身不编辑。源码和纯文本的只读要去掉，修改写回文件；CLI 的写入命令仍在。代码还没改。
- 内置 agent 对话界面，以及 MCP 接入。agent 统一走 CLI，以后另写 RFC。
- 在本 RFC 里迁移 GitHub 和 git review。GitHub 由 octogo 负责；git 以插件形式重新设计，见 §9。
- 嵌入 JS 引擎（moejs 等）。rutis 官方也明确不嵌入 JS 引擎。

## 4. 背景：调研结论

调研时间为 2026-10-26。所有版本都是当时 main 分支上的版本。这些依赖更新很快，具体锁定哪个版本在 P0 开工时决定。

### 4.1 rutis（arcships/rutis，调研时 0.16.0，2026-10-26 的 main 已是 0.17.1；`go/rutis` PluginAPI 3）

- Go SDK 是 **leaf runtime**，只负责提供插件：`Define`、`Inject`、`Apply`，`Ctx.Use`、`Provide`、`Effect`、`Go`，以及事件 `On`、`Emit`、`Parallel`、`Serial`、`Waterfall`、`Bail`。
- **Go 一侧没有宿主。** 加载、配置、依赖排序和热重载都由 Rust 写的 `rutis-host` 完成（`docs/design-go-runtime-2026-10-10.md`："Out of scope: Cordis in Go"）。Go SDK 本身是纯标准库的叶子 runtime，直接链接进 attention 的二进制。
- **`rutis-host`（Rust）不能嵌进 Go 进程**：没有 C ABI，设计文档以「会引入 cgo」为由拒绝了这种做法（`docs/design-app-integration-2026-10-14.md:106`）。所以宿主只能作为独立进程存在。
- 进程之间按名字注入服务。每个服务名只能有一个提供者。依赖缺失时插件会被挂起，依赖恢复后自动重启。清理按 LIFO 顺序串行执行，每个清理函数只执行一次。
- 启动方式：
  - `Serve` 运行结束后会退出进程；
  - `ServeArgs` 的参数格式是 `<channel> [--id <endpoint>] [--peer <endpoint>] <project>`，channel 支持 `fd:`、`unix:`、`tcp:`、`listen:ws://…`、`dial:ws://…`（`go/rutis/serve.go`）；
  - `ServeConn(net.Conn)` 一直阻塞到会话结束。
  - `dial:` 的拨入循环内部用 `signal.NotifyContext` 监听 SIGINT/SIGTERM，**只能靠信号停止**，连接断开后会按退避重连，没有可编程的停止接口（`go/rutis/dial.go`）。Swift、Kotlin 有 `RutisApp.start/stop`，Go 没有。
- 文档里支持的 Go 拓扑是**宿主做父进程**：`rutis.json` 的 `runtimes.go.dir` 指向放二进制的目录，宿主在第一次用到时通过 `fd:` 拉起它；`"start": "eager"` 让它一启动就运行；`"restart": "exit"` 让这个 runtime 自己结束时，宿主卸载所有插件后退出（`docs/guide/go-plugin.md`、`docs/guide/rutis-host.md`）。
- 跨进程传值的规则（`docs/guide/plugin-api.md`）：结构体、切片、map 复制传递；函数按引用传递；**Go 的 channel 不能跨进程**；带方法的对象传给 Go 时会失败。
- 应用集成方案（设计已定稿，尚未实现）：插件编译进应用本身，应用主动连到 rutis 的接入点。Go 目前只有上面那个只能靠信号停止的拨入。
- 成熟度：0.x，大约每几天发一个版本，已有 12 份以上的迁移指南。支持的语言：Go、TS（Node、Bun）、Python、Swift、Kotlin（仅远程）、Rust。

### 4.2 mygo（egoist/mygo，v0.6.4）

- 纯 Go，不需要 cgo。在 Linux 上通过 purego 加载 GTK3。原生 UI 用 OpenGL、Metal 或 D3D11 绘制，是**即时模式**：有输入、调用 `Invalidate` 或者有动画时，`func(c *ui.Context)` 根据状态重新生成界面，静止时不重建。
- 组件很完整：
  - `ui/editor`：仿 Zed 的代码编辑器，带 diff 查看器；
  - `ui/markdown`：CommonMark、GFM、脚注和数学公式；
  - Tree、Outline、Tabs、Split、Sidebar、Popover、Modal、AlertDialog 等基础组件（`mygo.Dialog` 是系统的文件和消息对话框，不是组件）。
- `ui.WebView` 能把网页嵌进原生界面，原生弹层可以盖在网页上面。页面一侧提供：`Eval`、`CapturePage`、导航和加载事件、下载、页内查找、导出 PDF、内容过滤规则、权限处理、新窗口拦截。
- **没有**：可信的输入注入、CDP、多 profile 会话隔离、CEF。三个平台的引擎不同：Linux 是 WebKitGTK，macOS 是 WKWebView，Windows 是 WebView2。
- `ui/editor` 的字体和行高是整个编辑器一份（可以配置），不能按文字片段换字体，不能隐藏行内的某段文字，也不能在行内嵌组件。所以做不出 Markdown 实时预览，这和非目标一致。
- 文件监听 `WatchFiles` 支持递归、忽略规则和防抖，但有两个限制：
  - 它要求本进程里有一个已经在运行的 mygo `App`（`needsApp`），所以**外置的插件进程里用不了**；
  - 在 Linux 上默认最多跟踪 8192 个条目，超过就以 `ErrWatchLimit` 停止；`HintsOnly` 模式不受这个限制，但只报告「哪个目录下有变化」。
- `Window.Update(fn)` 可以在任意 goroutine 里调用：把 `fn` 投递到主线程执行，然后重绘；`Window.Invalidate` 只触发重绘。
- `App.RequestSingleInstanceLock()` 提供单实例锁。
- 本机实测（2026-10-26，CachyOS，Wayland，`ps` 的 RSS）：`examples/code-editor` 能正常渲染，常驻内存约 130MB，二进制约 16MB。mygo 文档给出的 hello world 是约 7MB 二进制、35–62MB 内存。

### 4.3 deepseek-harness（0.2.1-rc.3，developer preview）

- 基于 Cordis，「一切皆插件，没有特权内核」。
- **两棵插件树**：host（Node）和 client（浏览器）各有一个 Context，并且分别作为两个独立的 TS 程序做类型检查。
- 前端完全由插件组合：
  - 渲染器 `ui-renderer` 本身就是插件（`ui-slots` 是它使用的无运行时类型库）；
  - slot 通过类型声明合并到 `SlotMap` 中定义，有 kind（`single`、`list`、`keyed`、`chain`）和 scope 两个属性；
  - 父组件的 `children` 字段既声明子 slot，也授权自己去渲染它；
  - `ctx.slots.inject(key, …)` 会等 slot 出现后再注册内容，slot 的所有者卸载时内容自动撤销，所有者恢复时再重新注册；
  - 组件拿不到 `ctx`，只能拿到类型化的 props。
- client 通过 `ctx.remote.<ns>.<method>()` 调用 host 用 `@Remote` 标注的方法。
- 一个功能包分成 `.`（host 半）和 `./client`（client 半）两部分。
- 应用由哪些插件组成，由多层配置叠加决定：bundle 的 `cordis.patch.yml` → profile → `$DSH_HOME` → 命令行 `--patch`。

### 4.4 octogo（/home/cc/Projects/octogo）

- 一个 mygo 原生 UI 写的 GitHub 客户端，约 18.5 万行 Go（含测试），Go 1.27.3。
- 设计体系：`ui/theme`（Amp 的 token）；组件库在 `ui/components/ui`，包名 `omgui`（封装 onevra）。`docs/STYLE.md` 里写的 `ui/kit` 目录实际并不存在，以代码为准。页面里禁止出现硬编码的颜色和尺寸，由 `ui/consistency_test.go` 检查。
- **哪些能直接复用**：`ui/theme` 和 `omgui` 是通用的。`internal/keyboard` 依赖 octogo 的 `internal/app` 配置；`ui/components/filetree` 的输入是 GitHub 的仓库文件节点；`ui/components/markdown` 走的是 GitHub README 的内容管线。这三者都**不是通用组件**，attention 的文件树和 Markdown 阅读改用 mygo 的原件（`ui.Tree`/`Outline`、`ui/markdown`）。
- **octogo 正在重构**：2026-10-26 的 `refactor/host-contract` 分支比 main 多约 38 个提交，正在把页面组件从设计系统里移出去、整理 composables 的宿主接口。共享模块的抽取要等这次重构合并之后再做（§5.12）。
- 已经处理好了单实例锁、托盘、退出流程等应用外壳的细节。

### 4.5 现有 attention 中可以迁移的部分

- **CLI**：Unix socket（Linux 上是 `$XDG_RUNTIME_DIR/.attention-cli.sock`）。第二次启动的进程抢不到单实例锁，就变成客户端：发送一行 `{argv, tty, cwd}`，然后把输出转发出来。已注册的命令有 47 个。注意几个容易误解的语义：`file` 输出文件的元数据（路径、大小、时间），读内容的是 `read`；`folder` 是目录统计，不是挂载。`scripts/e2e-cli.mjs` 是一个封闭环境下的端到端测试工具，但写死了 `electron` 和 `out/desktop/main.cjs`，环境变量也是 Electron 版的，**要改造后才能驱动 Go 版**。
- **纯逻辑代码**，可以作为 Go 重写的参照：
  - `metadata/`（3.8k 行：frontmatter、链接、标签、block）；
  - `search/`；
  - `mount/`（Home 加多个仓库的路由）；
  - `vault/`（文件模型）；
  - `builtin/terminal/RemoteTerminalAdapter.ts`（通过 WebSocket 传输 PTY）。
- **DOM 视图层**：`views/` 约 1.6 万行，`ui/` 约 6.6k 行，CSS 约 1.7 万行。全部作废，**它们的视觉风格也不保留**（见 §5.12）。

## 5. 设计

> 2026-11-02 按 `main`（`d91400c`）上 `native/` 的代码改写本节和 §6。本节写的是代码现在的结构。设计仍然有效、代码还没做到的部分，在对应小节里标「未实现」，并汇总在[路线图](../roadmap.md)的「RFC 中尚未实现的设计」一节。原稿中被代码替换掉的写法（类型化 slot key、`UseResource`/`UseCall`、共享 `contract/` 包、`navigation` 插件等）不再保留，改写前的原文见 `77f2c67`。

### 5.1 原则

1. **没有特权内核。** 二进制里只有引导代码（`native/app`）：启动 mygo 主循环、接入 rutis、按 profile 生成插件行。所有功能都是插件，窗口本身也是（`shell`）。
2. **服务和界面分开。**
   - **服务插件**：不画界面，通过名字对外提供服务。使用方拿到的是一个函数字段的结构体（例如 `fs.FS`），所以它可以运行在 UI runtime 里，也可以运行在独立进程里。headless profile 只加载这一类插件。
   - **UI 插件**：运行在 UI runtime 里，用 Go 编写。它们之间通过 rutis 的同进程注入直接传递 Go 指针（`*slots.Registry`、`*workspace.Workspace`），可以注册 `func(c *ui.Context)` 闭包。
   - 一个功能不强制拆成两个插件。只有需要外置的那部分才做成服务插件。
3. **以资源为中心。** 所有可以打开的东西都有一个地址（§5.6）。
4. **命令即 CLI。** 快捷键、命令面板和 CLI 调用的是同一个命令（§5.9）。
5. **所有注册都可以撤销。** 每个 `Register…`/`Add` 返回一个 `off func()`，插件把它交给 `ctx.Effect`，卸载时撤销。热重载只适用于外置的服务插件；编译进本体的插件，代码一变就要重启整个 attention。

### 5.2 概念对照（dsh → attention）

| dsh | attention |
|---|---|
| Cordis Context + Loader | rutis（`rutis-host` 加 Go SDK） |
| bundle、profile、`--patch` 多层配置 | `launcher.Rows` 里的 `desktop` / `headless` 两个 profile，加上配置目录里的 `plugins.json`（§5.10、§5.11） |
| host 插件，`@Remote` | 服务插件，`ctx.Provide(name, impl)`，使用方拿到函数字段结构体 |
| client 插件，React | UI 插件，`View func(c *ui.Context, …)` |
| `ctx.remote.ns.method()` | `rctx.Use("ns", &client)` |
| `ui-renderer`（加上 `ui-slots` 类型库） | `shell` 插件（窗口、根视图、主线程投递）加 `slots` 插件（`*slots.Registry`） |
| `ui-layout` | `layout` 插件 |
| `ui-dockkit` 的中间区域 | `workspace` 插件 |
| `client-resources` | `resources` 插件（`*resources.Registry`） |
| `ui-sidebar-right` 的 tab type 注册表 | `tabtypes` 包，`tabTypes` 服务由 `workspace` 提供 |
| `dsh-client-shortcuts` | `shortcuts` 插件 |
| `SlotMap` 声明合并 | `slots.Registry` 上固定的几类注册方法（§5.5） |
| React 自动重渲染 | 插件把结果投递到主线程（`sh.Update`）后重绘（§5.8） |
| client bundle 动态加载 | UI 插件编译进二进制，`attention build --with`（§5.11） |
| Typert 生成 RPC 契约 | 契约类型放在提供服务的插件包里（`plugins/fs` 的 `fs.FS`、`fs.Entry`），使用方 import 这个包 |

### 5.3 进程拓扑

```
attention（用户启动，启动器模式，internal/launcher）
 ├─ 拿不到单实例锁（paths.LockPath() 的 flock）：作为 CLI 客户端，
 │  经 socket 发送 {argv, tty, cwd}，转发输出后退出（§5.9）
 └─ 拿到锁：生成本次运行的 rutis.json，把 `rutis-host run` 作为子进程启动并等待
      rutis-host（Rust，父进程是启动器）
       ├─ attention（UI runtime 模式，rutis-host 通过 fd: / unix: / tcp: 拉起）
       │    · 主线程：mygo App.Run()
       │    · goroutine：advanced.ServeArgs(...)，承载 profile 选中的本体插件
       │    · socket 由其中的 cli 插件监听
       ├─ attention-services（可选：同一个二进制的符号链接，
       │    运行 ATTENTION_SEPARATE 列出的插件）
       └─ plugins.json 里的第三方运行时（Python、TS……），§5.11
```

**二进制的四个入口**（`app.Main`）：`build` 是 `attention build --with`（§5.11）；`--rutis-manifest` 向 rutis-host 报告本二进制带的插件；第一个参数是 channel（`fd:`、`unix:`、`tcp:`）时进入 UI runtime；其余情况是启动器。

**生成的 `rutis.json`**：`runtimes.go` 为 `{"binaries": [attention, (attention-services)], "start": "eager", "restart": "on-failure"}`。没有采用 `"restart": "exit"`，因为退出由 UI runtime 主动发起（见下）。启动器把 `ATTENTION_PROFILE` 和 `ATTENTION_LAUNCHER_PID` 传给子进程。

**关停顺序**（`app.runtimeMain`）：
1. 任何退出（关窗、`quit` 命令、Ctrl Q、mygo 转换的信号）先进入 `mygo.App.OnBeforeQuit`。UI runtime 给父进程 rutis-host 发**一次** SIGTERM，并阻止这次退出。
2. rutis-host 卸载所有插件。此时 mygo 主循环仍在运行，插件清理可以投递到主线程，例如 `internal/persist` 的最后一次保存。
3. 会话结束后 `ServeArgs` 返回，UI runtime 调用 `App.Quit()`，这一次放行。
4. 主循环自己结束而会话还没结束时，UI runtime 补发 SIGTERM，最多等 15 秒。

**其他约束**：
- UI runtime 忽略 SIGPIPE（它的 stdout、stderr 是通向 rutis-host 的管道）。
- 不给 rutis-host 发第二个信号，第二个信号会让它跳过清理。
- 启动器退出时 UI runtime 随之退出（`watchLauncher`）。
- headless profile 没有窗口：第一次 SIGINT/SIGTERM 转成给 rutis-host 的 SIGTERM，第二次直接退出。
- 各种退出路径的实测结果见 [spike 报告](0001-spike-report.md)。

**同进程调用不经过宿主**：`rctx.Use` 发现服务的提供者在同一个进程里时，直接拿到提供者的 Go 值（rutis 的 `Service.Local()`），不做序列化。所以 UI 插件之间可以传递指针和闭包；只有跨进程的服务调用才需要往返发消息。当前锁定的 rutis 是 `v0.19.4-0.20261102025122-f581e25d5f6d`（v0.20 发版前的提交）。

### 5.4 插件的写法

**UI 插件**（取自 `native/examples/hello-ui`）：

```go
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "hello-ui",
	Inject: []string{"shell", "slots", "layout", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			sl  *slots.Registry
			lyt *layout.Layout
			act *actions.Service
		)
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		// slots、layout、actions 同样 Use
		offPanel := sl.RegisterPanel(slots.Panel{
			ID: "hello", Title: "Hello", Dock: slots.Left,
			View: func(c *ui.Context, _ slots.PanelProps) { /* 只读主线程上的状态 */ },
		})
		offCmd := act.Add(actions.Command{ID: "hello-ui:open", Title: "Open Hello", CLI: true,
			Main: func() { lyt.RevealPanel("hello") },
			Run: func(ctx context.Context, _ actions.Args) (string, error) {
				return shell.OnMain(ctx, sh, func() (string, error) { lyt.RevealPanel("hello"); return "", nil })
			}})
		rctx.Effect(func(context.Context) error { offCmd(); offPanel(); return nil })
		return nil
	},
})
```

**服务插件**（`plugins/fs`）：`ctx.Provide("fs", svc)`；使用方 `var fs fsplugin.FS; rctx.Use("fs", &fs)`，`fs.FS` 是函数字段结构体，在同一个包里定义。事件用 `ctx.Emit` 发出，名字是 `<插件>/<事件>`，常量和载荷类型也在提供方的包里：`fs/changed`、`fs/watch-error`、`project/mounts-changed`、`index/changed`、`web/page-loaded`、`web-history/cleared`。

**契约规则**（`native/AGENTS.md`）：服务契约的方法以 `error` 结尾；契约里不出现 channel；每个 `ctx.Go` 任务在 context 取消时返回；先注册，再把 off 交给 `ctx.Effect`。

**命名**：插件 id 是 kebab-case，Go 包名去掉连字符（`text-ui` → `plugins/textui`）。`-ui` 后缀现在没有统一规则：`text-ui`、`markdown-ui`、`image-ui`、`terminal-ui`、`backlinks-ui`、`outline-ui`、`webview-panel-ui` 带后缀；同样画界面的 `filetree`、`search`、`bookmarks`、`web`、`settings` 不带。

### 5.5 slot 体系

`slots` 插件提供 `*slots.Registry`。注册表上是固定的几类贡献，每类一对注册和读取方法；注册返回 off，注册表变化时触发重绘：

| 贡献 | 注册 | 谁来画 |
|---|---|---|
| `Panel`：左侧栏的面板或右侧上下文栏的段（`slots.Sidebar` / `slots.Context`） | `RegisterPanel` | layout |
| `Chrome`：中间区域的所有者加在窗口上的部分：后退前进、地址栏、状态行、窗口底色 | `SetChrome` | layout（所有者是 workspace） |
| `Overlay`：窗口级浮层（模态框等）；`Order` 小于 0 的画在内容之前 | `RegisterOverlay` | layout |
| `PaletteSource`：浮层面板的一种模式，用 `OpenPalette(id)` 打开 | `RegisterPaletteSource` | palette |
| `SettingsSection`：设置里的一个标签，分 `Options` 和 `CorePlugins` 两组，`Keywords` 供设置搜索 | `RegisterSettingsSection` | settings |
| 中间区域，只有一个所有者 | `SetCenter` | layout（所有者是 workspace） |

- 窗口的根视图由 `layout` 通过 `shell.SetRoot` 设置。
- `Panel`、`Overlay`、`PaletteSource` 可以带 `State`/`Restore`，由 layout 存进 `layout.json`。
- 原稿的类型化 slot key、四种 kind、「声明即授权」没有实现，也不再计划。贡献随所有者撤销这件事由 rutis 的依赖挂起完成：`slots` 卸载时，注入它的插件先被挂起，它们的 Effect 撤销各自的注册。

### 5.6 资源、标签页与导航

#### 地址

| 类别 | 格式 | 例子 | 说明 |
|---|---|---|---|
| **资源地址** | `attention-resource://<protocol>/<path>` | `attention-resource://file/mount/<挂载根 id>/<相对路径>`、`attention-resource://file/absolute/<绝对路径>` | host 部分是协议名，也就是 provider 注册表的 key。`file` 协议的辅助函数在 `plugins/fs/address.go`（`AddressFor`、`AbsoluteAddress`）。`git` 协议未实现 |
| **页面地址** | `attention://<kind>` | `attention://webviewer-history`、`attention://terminal/<n>` | 不对应资源的标签页，`tabtypes.PageAddress(kind)` 生成 |
| **网页地址** | `http(s)://…`、`about:…` | `https://example.com` | 直接作为标签页的地址，由 `web` 的 tab type（kind `webviewer`）认领；不经过 resources，内容由 WebView 自己加载 |

- 地址按字符串比较，规范化由协议的所有者负责。
- 资源地址只在 attention 内部有意义，复制到外面打不开。Markdown 里的链接由 `workspace.ResolveLink` 翻译成可打开的地址。

#### resources：地址变成实时数据

- `resources.Provider{Protocol, Open(ctx, address, emit func(value any, err error))}`。每个协议只有一个 provider，重复注册会 panic。现在只有 `file` 一个协议，由 `fileresource` 插件注册。
- 读取方用 `Hold(address)` 持有（返回 release），在主线程上用 `Get(address)` 取 `Snapshot{Status, Value, Err, Version}`。`Status` 有四种：

| 状态 | 含义 |
|---|---|
| `None` | 这个协议没有 provider，或者地址无法解析 |
| `Loading` | 已经打开，还没有收到第一帧 |
| `Live` | 最近一帧成功 |
| `Failed` | 最近一帧失败，保留最后一次成功的值，同时带上失败原因 |

- 第一个持有者打开流，最后一个释放时关闭。provider 在任意 goroutine 上 `emit`，注册表把更新投递到主线程（`SetPost`，默认 `sh.Update`）。
- 标签页在打开期间持有自己的地址。`fileresource` 对文件做 stat、监听它的父目录，在 `fs/changed` 和 `project/mounts-changed` 时重新推一帧。帧的内容是元数据，查看器在 `Version` 变化时自己通过 `fs` 重新读内容。
- provider 在外置进程里的写法（跨进程订阅）未实现；`fileresource` 运行在 UI runtime 里，通过 `fs` 服务读写。

#### tab type：地址由谁来显示

`tabtypes` 是一个包，不是插件；`workspace` 创建注册表并以 `tabTypes` 的名字提供。tab type 是一个 `tabtypes.TabType`：

| 字段 | 含义 |
|---|---|
| `ID` | 实现的身份，全局唯一，只能注册一次 |
| `Kind` | 类型名，`OpenTab(kind)` 和 `OpenOptions.Kind` 里用的名字 |
| `Patterns` | 能认领的地址 glob。含 `:` 的匹配整个地址，比如 `attention-resource://file/**`；不含的匹配路径的任意一段，比如 `*.md`。按 kind 打开的页面类型可以没有 pattern |
| `Priority` | `Extension` > `Builtin` > `Fallback`；不写时是 `Extension` |
| `CanOpen(address)` | 可选，否决某次匹配 |
| `Title(address)`、`Icon` | 标签页上的文字和图标 |
| `Body`、`Header`、`Actions`、`Status` | 正文、视图头、视图头右侧按钮、状态栏条目，都是 `func(c *ui.Context, p Props)` |
| `Menu(tabID)` | 标签页「更多选项」菜单的条目 |
| `Closed(tabID)` | 标签页关闭或改用别的类型时调用，用来丢掉按 `Info.ID` 保存的状态 |
| `Lines(tabID)` | 当前行和总行数，供「跳转到行」使用 |

- 一个 kind 最多同时有一个 `Builtin` 和一个 `Extension`（`Extension` 生效），`Fallback` 只能单独存在；违反这些规则会 panic。
- `Claim(address, kind)`：不指定 kind 时取排名第一的候选（先按优先级，再按最长 pattern，再按注册顺序，跳过 `CanOpen` 否决的）；指定 kind 时用这个 kind 当前生效的实现。
- 注册表的 generation 变化时，workspace 重新认领已打开的标签页。
- 正文拿到的 `Props.Info` 有 `ID`、`Kind`、`Address`、`Path`、`Title`、`Nav`、`NavRevision`、`Version`、`Pending`、`Missing`、`Focused`；`Retarget`、`SetTitle` 让正文改变自己的地址和标题。`Missing` 来自资源的状态，查看器不自己订阅文件变化。
- **标签页的身份**是 `(kind, address)`。

内置的 tab type：

| 插件 | kind | 优先级 | patterns |
|---|---|---|---|
| `text-ui` | `text` | Fallback | `attention-resource://file/**`；只读，`internal/textdoc`。可编辑未实现，见 §10.1 第 2 条 |
| `markdown-ui` | `markdown` | Builtin | `*.md`、`*.markdown`、`*.mdx`；阅读视图和源码视图（Ctrl E），源码视图只读 |
| `image-ui` | `image` | Builtin | `*.png`、`*.jpg`、`*.jpeg`、`*.gif`、`*.bmp`、`*.webp`、`*.svg` |
| `web` | `webviewer` | Builtin | `https://**`、`http://**`、`about:**` |
| `web-history` | `webviewer-history` | Builtin | 页面，按 kind 打开 |
| `terminal-ui` | `terminal` | Builtin | `attention://terminal/*` |

设置不是标签页，是 `settings` 插件的模态浮层（`Settings.Open(id)` / `Toggle()`）。

#### 打开与导航

- 打开标签页的入口在 `*workspace.Workspace` 上：`Open(path, nav, newTab)`、`OpenResource(address, OpenOptions{Nav, NewTab, Kind})`、`OpenTab(kind, OpenOptions)`。打开先认领，已有 `(kind, address)` 相同的标签页就聚焦它；地址不合法或 kind 不能打开它时返回错误，不建标签页。
- `open line= to=` 这类定位通过 `Nav{Line, To, Col, Len}` 传给 tab type；每次导航 `NavRevision` 加一。
- **历史**：每个标签页有自己的后退、前进栈（`workspace:go-back` / `go-forward`，Alt Left / Alt Right），记录这个标签页打开过的地址。网页里的导航提交后，`web` 通过 `Retarget` 把新地址记入同一条历史（对应 TS 版的 `handleCommittedNavigation`）。另外 workspace 维护「最近打开的文件」（`RecentFiles`）。`web-history` 插件记录的是浏览器意义上的访问历史，和这两者分开。
- **未实现**：独立的 `navigation` 插件（唯一的打开入口、链接翻译、布局历史的撤销和重做）。现在的入口在 workspace 上，`plugins/workspace/plugin.go:7` 有对应的 TODO。

#### 索引

按 §10.1 第 5 条，索引是纯内存的 MetadataCache，没有 extractor 注册表：

- `index` 插件：启动时遍历挂载根，用 `internal/mdmeta` 解析笔记，维护标题、链接解析（`resolvedLinks` / `unresolvedLinks`）、反链、标签和 frontmatter 属性；跟随 `fs/changed` 更新被监听的目录，其余部分按固定间隔重新遍历；变化时发出 `index/changed`。服务是 `index.Index`（`Backlinks`、`URLBacklinks`、`Headings`、`SubmitPage`、`RemovePages`、`Generation` 等），带有元数据类的 CLI 命令。
- 网页正文抽取在 `internal/htmlextract`（readability 加 html-to-markdown），`web` 的阅读模式和 `web-read` 的 `web:read` 都用它。
- `web-index` 插件：收到 `web/page-loaded` 时把网页交给 `index.SubmitPage`，收到 `web-history/cleared` 时 `RemovePages`。`web` 不依赖 index；profile 里没有 index 时就不加载 `web-index`。
- 反链跨越资源类型：笔记和网页引用同一个 URL，在反链里互相可见（`URLBacklinks`）。

### 5.7 服务划分

每个服务由一个插件提供，按名字注入。「运行位置」一栏中，headless 指 headless profile 也加载它；「可外置」指它可以由 `ATTENTION_SEPARATE` 放进 `attention-services` 进程运行。

| 服务名 | 提供者 | 使用方拿到的类型 | 职责 | 运行位置 |
|---|---|---|---|---|
| `shell` | shell | `*shell.Shell` | 窗口、根视图、`Update` 投递到主线程、`Invalidate` | UI runtime |
| `slots` | slots | `*slots.Registry` | §5.5 | UI runtime |
| `resources` | resources | `*resources.Registry` | §5.6 | UI runtime |
| `layout` | layout | `*layout.Layout` | 左侧栏、内容卡片、右侧上下文栏、浮层的绘制；侧栏和面板状态存 `layout.json`；`RevealPanel`、`Toggle` | UI runtime |
| `workspace` | workspace | `*workspace.Workspace` | 中间区域：分屏树、标签组、标签页、视图头、`session.json`；打开入口和标签页历史（§5.6）；`open`、`tabs`、`recents`、`tab:open`、`workspace` 命令 | UI runtime |
| `tabTypes` | workspace | `*tabtypes.Registry` | §5.6 | UI runtime |
| `settings` | settings | `*settings.Settings` | 设置模态框；`app`、`appearance`、`hotkeys` 三个 JSON 文件的 `Get`/`Set`（§5.10） | UI runtime |
| `shortcuts` | shortcuts | `*shortcuts.Shortcuts` | 按命令的 `Keys` 绑定快捷键，读取 `hotkeys.json` 的覆盖；`SetCapture` 让终端拿到 Control 加字母 | UI runtime |
| `appearance` | appearance | `*appearance.Appearance` | 解析 `appearance.json`、读取主题文件，构建界面、编辑器、Markdown、终端四个主题，提供文件图标设置（[docs/appearance.md](../appearance.md)） | UI runtime |
| `actions` | actions | `*actions.Service` | 命令注册表；外部进程通过 `register` / `unregister` / `run` / `list` 调用（§5.9） | UI runtime 和 headless |
| `fs` | fs | `fs.FS` | 列目录、读、写、追加、建目录、改名、删除、移到回收站、stat、按目录监听（fsnotify，只监听有人要的目录，R9） | headless；可外置 |
| `project` | project | `project.Project` | 挂载根（`mounts.json`）、文件列表、项目搜索；文件和文件夹类 CLI 命令 | headless |
| `index` | index | `index.Index` | §5.6 索引 | headless |
| `web` | web | `struct{}` | 只表示 web 插件在场，供 `web-index` 依赖 | UI runtime |
| `web-history` | web-history | `*webhistory.History` | 访问历史（`web-history.json`）、历史页、`web:history` | UI runtime |
| `bookmarks` | bookmarks | `*bookmarks.Bookmarks` | 书签（`bookmarks.json`）：文件、文件夹、分组、URL、搜索 | UI runtime |
| `webview-panels` | webview-panel-ui | `*webviewpanel.Service` | 外部进程注册的 URL 或 HTML 面板（§5.11） | UI runtime |

`fileresource`、`filetree`、`search`、`backlinks-ui`、`outline-ui`、`palette`、`switcher`、`command-palette`、`go-to-line`、各 tab type 插件、`web-read`、`web-index`、`cli` 不提供服务，只注册贡献或命令。

原稿要求 `history`、`bookmarks` 是可外置的服务插件；现在 `web-history` 和 `bookmarks` 注入了 `shell`、`workspace`，只能运行在 UI runtime 里。

### 5.8 线程模型

- UI 状态只在 mygo 主线程上修改。`View` 函数里不做磁盘读写和服务调用。
- 后台 goroutine 上的结果用 `sh.Update(fn)` 投递到主线程并重绘。窗口出现之前，投递先排队。
- 需要在主线程上执行并拿回结果的命令处理函数用 `shell.OnMain(ctx, sh, fn)`；它不能在主线程上调用。
- 构造函数接收一个 `post func(func())`（插件里传 `sh.Update`），测试传一个 channel，因为窗口不存在时 `sh.Update` 会一直排队。
- rutis 的事件处理函数（`ctx.On`）运行在 rutis 的 goroutine 上，UI 插件在里面只做投递。
- resources 由注册表负责投递（§5.6）；状态文件由 `internal/persist` 保存：主线程上取快照，后台写入，防抖，卸载时保证最后一次保存最后落盘。
- 原稿的 `UseResource` / `UseCall` hook 没有实现，也不再计划。异步调用由各插件自己管理，按标签页的 `Info.ID` 或面板保存状态。
- 服务插件不画界面，按普通的 Go 并发方式编写。

### 5.9 命令与 CLI

- 命令是 `actions.Command{ID, Title, Keys, CLI, Flags, Run, Main}`：
  - `Main func()` 在主线程上执行，供快捷键和命令面板调用；
  - `Run(ctx, Args) (string, error)` 是 CLI 的处理函数，返回纯文本输出；
  - `CLI: true` 的命令才是 CLI 子命令，命令 id 就是子命令名；`Flags` 是它接受的 `<id>:<flag>` 形式的子命令。
  - `Keys` 是默认快捷键，多个用逗号分隔；`Ctrl` 指平台的命令键，`Control` 指 Control 键本身。`shortcuts` 插件负责绑定，`hotkeys.json` 覆盖默认值；模态框打开时，应用快捷键不送到窗口。
- 外部进程通过 `actions` 服务的 `register(command, run)` 注册命令，`run(params, cwd)` 跨进程调用，`unregister(id)` 撤销；`actions` 卸载时清空所有外部命令。
- `cli` 插件监听 socket（`paths.SocketPath()`，可用 `ATTENTION_SOCKET` 覆盖），协议与 TS 版兼容：一行 JSON `{argv, tty, cwd}`，响应是纯文本，socket 关闭表示结束。参数沿用 `key=value`。
- 命令的现行归属：

| 类别 | 命令（举例） | 插件 |
|---|---|---|
| 文件、文件夹、挂载 | `file`、`files`、`folder`、`folders`、`read`、`create`、`append`、`prepend`、`move`、`rename`、`delete`、`random`、`vault`、`mounts`、`mount` | `project`（`plugins/project/cli.go`） |
| 搜索 | `search`、`search:context`、`search:open` | `search`，引擎在 `project` |
| 元数据 | `backlinks`、`links`、`unresolved`、`orphans`、`deadends`、`outline`、`tags`、`tag`、`properties`、`property:read`、`property:set`、`property:remove`、`aliases`、`wordcount` | `index` |
| 工作区 | `open`、`tabs`、`tab:open`、`recents`、`workspace` | `workspace` |
| 网页 | `web`、`web:read`、`web:history` | `web`、`web-read`、`web-history` |
| 其他 | `bookmarks`、`quit`、`help` | `bookmarks`、`actions` |

- **未实现**：文件类命令按原稿归到 `fs` 插件。现在放在 `project`，因为它们要先解析挂载根和相对路径（`plugins/project/clipath.go`）。
- 新命令不能占用已有命令的名字（`web:read` 而不是 `read`）。
- 验收：`scripts/e2e-cli-native.mjs` 驱动 Go 二进制；输出以 TS 版为基准逐条比对，不一致写进 `docs/cli-deviations.md`。

### 5.10 profile 与配置

- **profile** 写在代码里（`launcher.Rows`），没有 `profiles/default.json`：
  - `headless`：`actions`、`cli`、`fs`、`project`、`index`、`web-read`；
  - `desktop`（默认）：上面这些，加上其余 26 个 UI 插件（§6）。
  - `attention build --with` 编进来的插件追加在后面；`plugins.json` 的第三方行在生成 `rutis.json` 时合并（§5.11）。
- 插件行是平的，每个功能一行。rutis 的 group 行只用于整体开关的可选组合，核心不用。
- **配置主目录**：`$ATTENTION_CONFIG_DIR`，否则 `$XDG_CONFIG_HOME/attention`（其他平台用各自的标准位置）。不往用户打开的目录里写任何文件。目录里的文件：

| 文件 | 写入者 |
|---|---|
| `app.json`、`appearance.json`、`hotkeys.json` | settings |
| `mounts.json` | project |
| `session.json` | workspace |
| `layout.json` | layout |
| `bookmarks.json` | bookmarks |
| `web-history.json` | web-history |
| `plugins.json` | 用户（§5.11） |
| `themes/*.json` | 用户自定义主题（§5.12） |

- **设置**是这三个 JSON 文件的键值，在主线程上用 `Get` / `Set` 读写，`Generation` 变化时重新解析。没有「默认值 → 用户 → 项目」的分层，也不使用 rutis 的插件配置 schema；插件行的 `config` 现在只有 `project` 的 `mounts` 在用。

### 5.11 第三方插件

- **服务插件**，任意语言，不用重新编译：在配置目录的 `plugins.json` 里写 rutis.json 格式的 `runtimes` 和 `rows`，每次启动合并进本次的 `rutis.json`（`internal/launcher/thirdparty.go`）；id 和内置行冲突时拒绝。它通过两个服务接入 attention：
  - `actions`：`register` 注册命令，命令出现在命令面板和 CLI 里；
  - `webview-panels`：`register({id, title, dock, url | html, icon})` 在 dock 里显示一个 WebView 面板。
  - 示例：`native/examples/hello-py`。
- **UI 插件**：Go 不能在运行时加载代码，所以只有两条路：
  1. `attention build --with <module>=<dir> -o <out>`（`internal/buildcmd`）：生成一个临时 main 包，import `native/app` 和每个插件模块，把插件的 `Plugin` 传给 `app.Main`，构建出自定义的 attention。示例：`native/examples/hello-ui`。
  2. `webview-panel-ui` 兜底：上面的 `webview-panels`，界面是嵌进去的网页，和原生界面不融合。
- 跨进程的声明式 UI 协议不做（§10.2）。

### 5.12 UI 规范

- 视觉和组件风格采用 octogo 的风格，不再对照 Obsidian。废弃的是：与 Obsidian `app.css` 逐字节一致的样式层、Obsidian 的类名语义和尺寸规格、`styles/deviations/` 和 `StyleSystem.test.ts` 的规则。
- 组件库是仓库内的 `native/ui`（调用处别名 `aui`，图标在 `native/ui/icon`），按 [RFC 0002](0002-crychic-ui.md) 从 CrychicUI 和原 attention-ui 的 omgui 内化而来；`native/go.mod` 不再依赖 `attention-ui`、`smallnest/uix`、`onevra`，也没有 `replace`。组件只读 `ui.Theme` 取色，页面里不出现硬编码的颜色。
- **主题**：只有颜色：9 个界面色、9 个语法色、可选的终端 16 色，其余颜色由代码推导。`appearance` 插件读取内置主题（`plugins/appearance/themes/`）和 `<配置目录>/themes/`，也接受 Zed 主题文件里映射得到的那部分键。同一份主题生成 `*ui.Theme`、`*editor.Theme`、`*markdown.Theme` 和终端主题。设计见 [docs/appearance.md](../appearance.md)。
- **文件图标**：`internal/fileicon` 内置 `@pierre/trees` 的 57 个 SVG 图标和语义色板，按文件名、后缀匹配。`fileicon.Theme` 是一个值，由 `appearance.Icons()` 给出；文件树、标签页、快速切换、搜索、书签和反链用它画图标。
- 正文字体跟随系统（fontconfig 的 sans-serif），不在主题里写死。
- **窗口结构**：Arc 式的左侧栏、内容卡片和右侧上下文栏，标签列表、地址栏、Omnibox 和起始页，以 [RFC 0003](0003-arc-layout.md) 为准；本节和 §5.5 的 slot 表与它不一致时，以 RFC 0003 为准。
- 根目录 AGENTS.md / CLAUDE.md 的「忠实重建 Obsidian」规则只适用于 TS 代码；`native/AGENTS.md` 写明了这一点。到 P5 再整体重写根目录的这两份文件。

### 5.13 仓库组织

同一个仓库，Go module 在 `native/`：

```
native/
  cmd/attention/      main，只调用 app.Main
  app/                四个入口（§5.3）和内置插件的清单；`attention build` 生成的
                      二进制也调用它
  plugins/<feature>/  每个插件一个包，契约类型和事件常量也在里面
  internal/           不对外的共享代码：launcher、buildcmd、lifecycle、paths、
                      persist、watchq、textdoc、mdmeta、htmlextract、
                      fileicon、fuzzy、natural、clifmt
  examples/           第三方插件示例：hello-py、hello-ui
  bin/                本地构建产物
```

没有 `contract/`、`slotsapi/`、`profiles/`。`contract/` 和各个 `*api` 包在 `4e19197` 里删除，类型移进了提供服务的插件包（§10.1 第 3 条）。

迁移期间 TS 代码保持不动，作为行为参照。全部完成后（路线图 P5）删除 `apps/`、`packages/` 和 Node 的测试流程。

## 6. 插件清单

`native/app/app.go` 带 32 个插件，profile 决定加载哪些（§5.10）。

| 插件 id | Go 包 | 提供 | 注入 | profile |
|---|---|---|---|---|
| `shell` | shell | `shell` | — | desktop |
| `slots` | slots | `slots` | shell | desktop |
| `resources` | resources | `resources` | shell | desktop |
| `actions` | actions | `actions` | — | 两者 |
| `cli` | cli | — | actions | 两者 |
| `fs` | fs | `fs` | — | 两者 |
| `project` | project | `project` | actions、fs | 两者 |
| `index` | index | `index` | actions、fs、project | 两者 |
| `web-read` | webread | — | actions | 两者 |
| `fileresource` | fileresource | `file` 协议 provider | resources、fs、project | desktop |
| `layout` | layout | `layout` | shell、slots、actions、appearance | desktop |
| `workspace` | workspace | `workspace`、`tabTypes` | shell、slots、resources、layout、shortcuts、fs、project、actions、appearance | desktop |
| `shortcuts` | shortcuts | `shortcuts` | slots、actions、settings | desktop |
| `palette` | palette | — | slots | desktop |
| `switcher` | switcher | — | shell、slots、workspace、project、actions、appearance | desktop |
| `command-palette` | commandpalette | — | shell、slots、actions、shortcuts | desktop |
| `go-to-line` | gotoline | — | shell、slots、tabTypes、workspace、actions | desktop |
| `settings` | settings | `settings` | shell、slots、actions | desktop |
| `appearance` | appearance | `appearance` | shell、slots、settings、actions | desktop |
| `filetree` | filetree | — | shell、slots、layout、workspace、fs、project、actions、appearance | desktop |
| `search` | search | — | shell、slots、layout、workspace、project、actions、appearance | desktop |
| `backlinks-ui` | backlinks | — | shell、slots、layout、workspace、index、actions、appearance | desktop |
| `outline-ui` | outline | — | shell、slots、layout、workspace、index、actions | desktop |
| `bookmarks` | bookmarks | `bookmarks` | shell、slots、layout、workspace、project、actions、appearance | desktop |
| `text-ui` | textui | tab type `text` | shell、tabTypes、fs、appearance | desktop |
| `markdown-ui` | markdownui | tab type `markdown` | shell、tabTypes、workspace、fs、actions、appearance | desktop |
| `image-ui` | imageui | tab type `image` | shell、tabTypes、fs | desktop |
| `web` | web | `web`、tab type `webviewer` | shell、slots、tabTypes、workspace、actions、settings | desktop |
| `web-history` | webhistory | `web-history`、tab type `webviewer-history` | shell、tabTypes、workspace、actions | desktop |
| `web-index` | webindex | — | index、web、web-history | desktop |
| `webview-panel-ui` | webviewpanel | `webview-panels` | shell、slots | desktop |
| `terminal-ui` | terminalui | tab type `terminal` | shell、slots、tabTypes、workspace、actions、settings、shortcuts、appearance | desktop |

原稿清单里有、代码里没有的：

| 插件 | 状态 |
|---|---|
| `tab-types` | 不再单独做插件，并入 workspace |
| `navigation` | 未实现（§5.6） |
| `extractors`、`markdown-extract`、`html-extract` | 不做，§10.1 第 5 条；HTML 抽取是 `internal/htmlextract` |
| `git`、`git-ui` | 未实现（路线图 P4） |
| `terminal`（服务那一半） | 未实现：PTY 在 `terminal-ui` 里，用 mygo 的 `plugins/terminal` |

## 7. 被否决的方案

| 方案 | 否决原因 |
|---|---|
| 保留 Electron 和 TS，只做插件化 | 违背全 Go 的目标；`App` 这个上帝对象和 Obsidian 兼容层的负担仍然在 |
| mygo webview，前端用 React 并兼容 dsh client 插件 | 主界面会继续依赖 DOM；dsh 插件的 host 半是 Node，Go 跑不了，所以兼容性本来就只有一半 |
| 声明式视图协议，作为跨进程 UI 的主路径 | 等于自己设计一套 UI 协议，工作量大；参照 dsh 的两半拆分可以解决绝大部分场景 |
| 不用 rutis，在 Go 里自己实现一套 Cordis | 得不到多语言、独立进程、热重载和跨机器的能力；不过如果 P0 spike 失败，这会是退路（§8 R1） |
| 嵌入 moejs 跑 JS 插件 | rutis 明确拒绝嵌入 JS 引擎，而 rutis 本身已有 node 和 bun runtime；这件事也不在主线上 |
| 用 CEF（Chromium）作为网页引擎 | 体积大几百 MB，mygo 不支持，和全 Go 的目标冲突。等 agent 操控有需要时再评估 |

## 8. 风险

| # | 风险 | 应对 |
|---|---|---|
| R1 | mygo 和 rutis 共处一个进程：mygo 锁定主线程并接管 SIGINT/SIGTERM；rutis 的 `Serve` 会退出进程，`dial:` 只能靠信号停止 | 采用宿主做父进程、`fd:` 拉起 UI runtime 的拓扑（§5.3），P0 首先验证。失败时退路依次是：UI runtime 用 `ServeConn` 自己管理连接；内置插件改用和 rutis 写法一致的进程内注册表，只有外部插件走 rutis-host |
| R2 | rutis 处于 0.x，变动频繁 | 锁定版本（§5.3）；rutis 的 API 只出现在各插件的 `Plugin` 定义、`native/app` 和 `internal/launcher` 里；跟进它的迁移指南 |
| R3 | mygo v0.6，一个依赖覆盖了所有方面 | 锁定版本；它是纯 Go、MIT 协议，最坏情况可以 fork；octogo 也承担着同样的依赖风险 |
| R4 | 附带一个 Rust 二进制 rutis-host，增加打包体积、增加平台矩阵 | 发布时一并附带；P0 实测体积和启动时间 |
| R5 | 网页引擎在三个平台各不相同；没有可信输入，没有会话隔离 | 本阶段以阅读为主，可以接受；agent 操控能力另写 RFC 处理 |
| R6 | `ui/markdown` 对 wikilink、嵌入、callout 的扩展能力未知 | P1 先实测；不够用就给 mygo 提 PR，或者在 `markdown` tab type 里先做预处理 |
| R7 | 慢速的服务插件跨进程调用，拖慢 UI | UI 插件对服务调用一律通过 `UseCall` 异步处理，结果用 `Window.Update` 投递回主线程；`View` 函数里禁止阻塞调用 |
| R9 | 大目录的文件监听：mygo 在 Linux 上默认最多 8192 个条目，inotify 也有 `max_user_watches` 上限 | `fs` 用 fsnotify，按需只监听展开的目录（dsh 的文件树也是这样）；处理 ENOSPC，失败时降级为手动刷新并提示。P1 用 2 万文件的目录验证 |
| R10 | octogo 正在重构，共享 UI 模块的边界还在变 | 等 `refactor/host-contract` 合并后再抽取；在那之前用 `replace` 直接依赖，不复制代码（§5.12） |
| R8 | 推翻重写的成本 | 现有的 TS 版本在迁移期间继续可用；CLI 的 e2e 测试作为客观的对齐标准 |

## 9. 与现有工作的关系

- **PR #2（LSP）**：不合并。新定位不需要 LSP。分支保留，留作参考。
- **git**：现有的 `builtin/git` 不迁移，在 P4 重新设计成 `git` 服务插件（可外置，提供 `git` 资源协议）加 `git-ui` 两个插件，写法见 §5.1 第 2 条和 §5.4。
- **GitHub**：不迁移。octogo 负责 GitHub 相关功能。以后可以把 octogo 的功能整理成服务插件和 UI 插件接进 attention，需要另写 RFC。
- **单一配置主目录**：「不往打开的目录里写文件」的原则继续有效，但配置的布局是新的决定（§5.10）。

## 10. 未决问题与 2026-11-01 架构决议

### 10.1 已决定的架构与产品边界（2026-11-01）

1. **产品线分阶段推进（见 [docs/product.md](../product.md)）**：
   - **近期重心（V1）**：先做成简单、干净、好用的原生编辑器与阅读器，不急于引入复杂的子 Agent 或重型交互。
   - **中远期愿景（V2 / V3）**：打造「编辑器界的浏览器（以文件 Tab 为自然单元、自带所属 Project 与文件夹列上下文）」与「AI 带着人读真实原文（外部 Agent 负责搜索、网页检索、代码调研与终端实验，向编辑器推送原文锚定卡片，用户通过类似 Slack / 左右滑方式分拣阅读）」。
2. **编辑器读写与保存模型**：
   - 现状：未实现。`internal/textdoc/textdoc.go` 仍是 `ReadOnly: true`，没有自动保存；`fs.Write` 已经有了。列在路线图「RFC 中尚未实现的设计」。
   - 去掉 `internal/textdoc` 中的 `ReadOnly: true` 限制。
   - 采用 **Obsidian 式无感自动保存**：编辑状态变化后防抖（约 1~2 秒）自动通过 `fs.Write` 写回磁盘，同时支持 `Ctrl+S` / `Cmd+S` 立即写回；不强求传统的脏标记（dirty dot）确认流，并在写回时记录文件版本/内容摘要以抑制 `fsnotify` 触发自身二次重读。
3. **同进程插件接线与消除 10 个 `*api` 全局单例包**（2026-11-02 已落地，方式与原决议不同）：
   - 原问题：`go/rutis` 在同进程调用（`s.Local() == true`）时仍走序列化，`Service.bind` 只接受函数结构体，无法传递 Go 接口和 `func(c *ui.Context)` 闭包，所以 `native/` 拆出了 `shellapi`、`layoutapi`、`slotsapi`、`actionsapi` 等 10 个进程级全局单例包。
   - 原决议：推动上游 rutis 支持同进程直接透传，再把 `*api` 包收敛进 `contract/`。
   - 实际落地（`4e19197`）：rutis 已支持同进程直接传 Go 值（锁定版本见 §5.3）。`*api` 包、`contract/` 和 `pluginreg` 全部删除，没有收进 `contract/`；每个插件直接 `rctx.Provide` 自己的 Go 类型，契约类型和事件常量放在提供方的插件包里，使用方 import 那个包（§5.2、§5.4）。
4. **外壳底座（Workbench Shell）与 4 类标准扩展点**：
   - 参考 Zed 的 `workspace` 设计，把窗口、dock、中间分屏与标签树、快捷键分发与设置做成内聚的外壳。现在由 `shell`（窗口、主线程投递）、`layout`（左侧栏、上下文栏、浮层）、`workspace`（中间区域）、`shortcuts`、`settings` 五个插件分担（§5.7）。
   - 业务插件与第三方编译插件（`attention build --with`）围绕 4 个扩展点接入：**`TabType`**（`tabtypes.TabType`）、**`Slot`**（`slots.Registry` 的 `Panel`、`Ribbon`、`Status`、`Overlay`、`PaletteSource`、`SettingsSection`）、**`Command`**（`actions.Command`）、**`Resource`**（`resources.Provider`）。公共类型放在各自的插件包里，不设 `contract/`（第 3 条）。
5. **保留并固化内存级 `MetadataCache`（替代泛化 `extractors` 与 SQLite 索引）**：
   - 放弃原稿 §5.6 中未落地的跨进程 `extractors` 注册表以及本地 SQLite 索引库方案。现行设计见 §5.6「索引」。
   - 正式保留当前 `internal/mdmeta` + `plugins/index` 的**纯内存增量 `MetadataCache` 抽象**（参考 Obsidian `CachedMetadata`）：在内存中维护标题大纲（Headings）、行号定位、双链解析（`resolvedLinks` / `unresolvedLinks`）、反链（Backlinks）、标签（Tags）、Frontmatter 属性以及网页 URL 跨类型反链。

### 10.2 早期未决问题状态对照

1. 共享 UI 模块放在哪里：内化为仓库内的 `native/ui/`（[RFC 0002](0002-crychic-ui.md)）。
2. 代码放在 `native/` 目录、留在同一仓库（§5.13）：已确认并落地。
3. 插件接口包（`contract`）对外稳定：不再有 `contract/`。第三方插件 import 提供服务的插件包（`plugins/slots`、`plugins/actions` 等），这些包的导出类型就是对外接口（§10.1 第 3 条）。
4. 跨进程的声明式 UI 协议要不要做、什么时候做（§5.11）：暂不做，优先使用编译期 `build --with` 与 `webview-panel` 兜底。
5. index 的存储：**已决定采用纯内存增量 `MetadataCache`**（见 §10.1 第 5 条）。
6. 阅读模式的正文抽取算法：已在 `internal/htmlextract` 实现内置抽取。
7. 多窗口：当前保持单窗口模型，多项目并行优先通过 V2 的「顶层浏览器式 Tab（Tab-as-a-Project）」承载。

## 11. 验证

每个阶段的完成标准都写在路线图里。贯穿整个迁移的几条硬性标准：

- `go test ./...`、`go vet`，以及从 octogo 迁过来的一致性检查（禁止硬编码颜色和尺寸），全部通过；
- CLI 的 e2e 测试以 TS 版为基准逐条比对，不一致只能写在 `docs/cli-deviations.md` 里；
- 每个服务插件都有一个 `rutistest` 测试；UI 插件的界面部分用 mygo 的 `ui.NewTester` 在进程内测试。`rutistest` 需要 `rutis-host`：它不在 `PATH` 上时，用 `RUTIS_HOST` 指定路径，否则 `actions`、`cli`、`fs`、`project` 的测试会失败；
- 每个阶段都在 Linux（Wayland）上手动验收，并截图归档。
