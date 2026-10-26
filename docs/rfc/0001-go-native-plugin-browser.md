# RFC 0001：attention 重写为 Go 原生、一切皆插件的阅读型浏览器

- 状态：Draft
- 日期：2026-10-26
- 范围：整个产品，包括 apps/web、apps/desktop 和 packages/shared
- 路线图：[docs/roadmap.md](../roadmap.md)

## 1. 摘要

attention 从「Electron + TS 实现的 Obsidian 重建」改为**全 Go 实现的、以阅读为主的浏览器**：

- 界面使用 mygo 的原生 UI（`ui` 包，由 GPU 绘制，没有 DOM）。网页通过 `ui.WebView` 嵌入。
- 插件运行时使用 rutis。**没有特权内核**：外壳、布局、标签页、导航、索引和 CLI 服务端全部是插件。结构参照 deepseek-harness（下称 dsh）。
- 内容模型从「Markdown vault」改为「以 URI 寻址的资源」。scheme、viewer、extractor、index 都由插件提供。
- agent 通过 attention CLI 操控应用。所有插件命令都会自动成为 CLI 子命令。

不再兼容 Obsidian 插件 API，也不运行真实的 dsh 插件，dsh 只作为架构参考。

## 2. 动机

1. **产品定位变了。** attention 要成为一个能接入 agent、以阅读和查看为主的浏览器，不再是 Markdown 编辑器。编辑能力降级：不做 LSP，也不做实时预览编辑。
2. **现有架构的负担。**
   - `apps/web/app/App.ts` 一次性构造约 60 个服务，`app.workspace` 被引用约 480 次，`app.vault` 约 380 次。
   - 内置插件通过 `plugin.app.X` 随意访问其他服务，功能之间没有边界。
   - 为了忠实复刻 Obsidian，维护着约 5.4k 行兼容层和约 7k 行 parity 测试，在新定位下都没有价值了。
3. **一切皆插件。** git、GitHub（octogo）、终端、各类查看器都应该能单独接入和替换。这需要一个真正的插件运行时，而现有的 `InternalPluginDefinition` 加上静态 `corePlugins[]` 数组做不到。
4. **全 Go。** 用户的另一个项目 octogo 已经验证了 mygo 原生 UI 能支撑大型应用（约 18.7 万行 Go），attention 可以沿用同一套技术栈和组件规范。

## 3. 目标与非目标

**目标**

- G1：用一个 Go 二进制提供完整的桌面应用，Linux 优先，同时覆盖 macOS 和 Windows。
- G2：所有功能都以插件形式接入，可以单独启用、停用或替换。
- G3：以资源为中心的阅读体验，资源包括本地文件、网页、git 对象和插件自定义的 scheme。
- G4：CLI 和现有 `{argv, tty, cwd}` socket 协议保持兼容，现有脚本和 agent 用法不用改。
- G5：服务插件可以运行在独立进程里，用任意 rutis 支持的语言编写，支持热重载。

**非目标**

- 兼容 Obsidian 插件 API、社区插件、主题市场。
- 运行真实的 dsh 插件（它们的 client 半是 React 加 DOM，host 半是 Node）。
- Markdown 编辑器体验：实时预览、LSP、补全。文件写入只保留 CLI 命令。
- 内置 agent 对话界面，以及 MCP 接入。agent 统一走 CLI，以后另写 RFC。
- 在本 RFC 里迁移 GitHub 和 git review。GitHub 由 octogo 负责；git 以插件形式重新设计，见 §9。
- 嵌入 JS 引擎（moejs 等）。rutis 官方也明确不嵌入 JS 引擎。

## 4. 背景：调研结论

调研时间为 2026-10-26。所有版本都是当时 main 分支上的版本。

### 4.1 rutis（arcships/rutis，0.16.0，`go/rutis` PluginAPI 3）

- Go SDK 是 **leaf runtime**，只负责提供插件：`Define`、`Inject`、`Apply`，`Ctx.Use`、`Provide`、`Effect`、`Go`，以及事件 `On`、`Emit`、`Parallel`、`Serial`、`Waterfall`、`Bail`。
- **Go 一侧没有宿主。** 加载、配置、依赖排序和热重载都由 Rust 写的 `rutis-host` 完成（`go/rutis/serve.go:151`，`docs/design-go-runtime-2026-10-10.md`："Out of scope: Cordis in Go"）。
- rutis 不能链接进 Go 进程：没有 C ABI，设计文档以「会引入 cgo」为由拒绝了这种做法（`docs/design-app-integration-2026-10-14.md:106`）。
- 进程之间按名字注入服务。每个服务名只能有一个提供者。依赖缺失时插件会被挂起，依赖恢复后自动重启。清理按 LIFO 顺序串行执行，每个清理函数只执行一次。
- 启动方式：
  - `Serve` 运行结束后会退出进程；
  - `ServeArgs` 支持 `fd:`、`unix:`、`tcp:`、`listen:ws`、`dial:ws`；
  - `ServeConn(net.Conn)` 一直阻塞到会话结束。
  - 拨入循环只能靠 SIGINT 或 SIGTERM 停止。
- 应用集成方案（设计已定稿，尚未实现）：插件编译进应用本身，应用主动连到 rutis 的接入点。Go 的拨入功能已经实现。
- 成熟度：0.x，大约每几天发一个版本，已有 12 份迁移指南。

### 4.2 mygo（egoist/mygo，v0.6.4）

- 纯 Go，不需要 cgo。在 Linux 上通过 purego 加载 GTK3。原生 UI 用 OpenGL、Metal 或 D3D11 绘制，是**即时模式**：`func(c *ui.Context)` 每帧根据状态重新生成界面。
- 组件很完整：
  - `ui/editor`：仿 Zed 的代码编辑器，带 diff 查看器；
  - `ui/markdown`：CommonMark、GFM、脚注和数学公式；
  - Tree、Outline、Tabs、Split、Sidebar、Popover、Dialog 等基础组件。
- `ui.WebView` 能把网页嵌进原生界面，原生弹层可以盖在网页上面。页面一侧提供：`Eval`、`CapturePage`、导航和加载事件、下载、页内查找、导出 PDF、内容过滤规则、权限处理、新窗口拦截。
- **没有**：可信的输入注入、CDP、多 profile 会话隔离、CEF。三个平台的引擎不同：Linux 是 WebKitGTK，macOS 是 WKWebView，Windows 是 WebView2。
- `ui/editor` 只支持一种等宽字体、一种行高，不能隐藏行内的某段文字，也不能在行内嵌组件。所以做不出 Markdown 实时预览，这和非目标一致。
- 文件监听 `WatchFiles` 支持递归、忽略规则和防抖；`Window.Invalidate` 可以在任意 goroutine 里调用，用来触发重绘。
- 本机实测（CachyOS，Wayland）：`examples/code-editor` 能正常渲染，常驻内存约 130MB，单个二进制约 16MB。

### 4.3 deepseek-harness（0.2.1-rc.3，developer preview）

- 基于 Cordis，「一切皆插件，没有特权内核」。
- **两棵插件树**：host（Node）和 client（浏览器）各有一个 Context，并且分别作为两个独立的 TS 程序做类型检查。
- 前端完全由插件组合：
  - `ui-renderer` 和 `ui-slots` 本身就是插件；
  - slot 通过类型声明合并到 `SlotMap` 中定义，有 kind（`single`、`list`、`keyed`、`chain`）和 scope 两个属性；
  - 父组件的 `children` 字段既声明子 slot，也授权自己去渲染它；
  - `ctx.slots.inject(key, …)` 会等 slot 出现后再注册内容，slot 的所有者卸载时内容自动撤销，所有者恢复时再重新注册；
  - 组件拿不到 `ctx`，只能拿到类型化的 props。
- client 通过 `ctx.remote.<ns>.<method>()` 调用 host 用 `@Remote` 标注的方法。
- 一个功能包分成 `.`（host 半）和 `./client`（client 半）两部分。
- 应用由 profile（`cordis.patch.yml`）声明由哪些插件组成。

### 4.4 octogo（/home/cc/Projects/octogo）

- 一个 mygo 原生 UI 写的 GitHub 客户端，约 18.7 万行 Go，Go 1.27.3。
- 有成熟的 `ui/kit`（封装 onevra 组件）、`ui/theme`（Amp 的 token）、`docs/STYLE.md`（页面里禁止出现硬编码的颜色和尺寸）、`internal/keyboard`，以及 `ui/components/{filetree,markdown,code,editor,navigation}`。
- 已经处理好了单实例锁、托盘、退出流程等应用外壳的细节。

### 4.5 现有 attention 中可以迁移的部分

- **CLI**：Unix socket（Linux 上是 `$XDG_RUNTIME_DIR/.attention-cli.sock`）。第二次启动的进程抢不到单实例锁，就变成客户端：发送一行 `{argv, tty, cwd}`，然后把输出转发出来。命令大约 45 个。`scripts/e2e-cli.mjs` 是一个封闭环境下的端到端测试工具，可以直接拿来验收 Go 版。
- **纯逻辑代码**，可以作为 Go 重写的参照：
  - `metadata/`（3.8k 行：frontmatter、链接、标签、block）；
  - `search/`；
  - `mount/`（Home 加多个仓库的路由）；
  - `vault/`（文件模型）；
  - `builtin/terminal/RemoteTerminalAdapter.ts`（通过 WebSocket 传输 PTY）。
- **DOM 视图层**：`views/` 约 1.6 万行，`ui/` 约 6.6k 行，CSS 约 1.7 万行。全部作废。

## 5. 设计

### 5.1 原则

1. **没有特权内核。** 二进制里只有引导代码：启动 mygo 主循环、接入 rutis、加载 profile。所有功能都是插件。
2. **每个功能分两半**（参照 dsh 的 `.` 和 `./client`）：
   - **服务插件**：不画界面，通过名字对外提供服务。可以运行在任意进程里，用任意语言编写。
   - **UI 插件**：运行在 mygo 进程里，用 Go 编写，往 slot 里贡献 `func(c *ui.Context)`，通过 `ctx.Use` 调用服务插件。
3. **以资源为中心。** 所有可以打开的东西都是一个 URI。插件负责解析、呈现和抽取资源。
4. **命令即 CLI。** 命令是唯一的操作入口：快捷键、命令面板、菜单和 CLI 最终都调用同一个命令。
5. **所有注册都可以撤销。** 每项贡献都通过 `Provide` 或 `Effect` 注册，插件卸载时自动撤销，所以热重载是安全的。热重载只适用于外置的服务插件；编译进本体的插件，代码一变就要重启整个 attention runtime。

### 5.2 概念对照（dsh → attention）

| dsh | attention |
|---|---|
| Cordis Context + Loader | rutis（`rutis-host` 加 Go SDK） |
| profile / bundle（`cordis.patch.yml`） | profile：`rutis.json` 加上 UI 插件的启用清单 |
| host 插件，`@Remote` | 服务插件，`ctx.Provide(name, impl)` |
| client 插件，React | UI 插件，`func(c *ui.Context)` |
| `ctx.remote.ns.method()` | `ctx.Use("ns", &client)` |
| `ui-slots`、`ui-renderer` | `slots` UI 插件 |
| `ui-layout`、`ui-dockkit` | `layout`、`tabs` UI 插件 |
| `SlotMap` 声明合并 | Go 中类型化的 slot key（§5.5） |
| client bundle 动态加载 | UI 插件**编译进二进制**（§5.9） |
| Typert 生成 RPC 契约 | Go 接口加 rutis 的值序列化；契约放在共享的 `contract` 包里 |

### 5.3 进程拓扑

```
attention（Go 二进制，用户启动的就是它）
 ├─ 主线程：mygo App.Run()，所有窗口和原生 UI
 ├─ goroutine：rutis Go runtime（以 dial:ws 方式拨入 rutis-host）
 │     承载所有 UI 插件，以及编译进本体的服务插件
 ├─ 子进程：rutis-host（Rust，随包附带）
 │     · 以 listen 模式启动，并配置 instances
 │     · 读取 profile，负责加载、依赖排序、热重载、关停期限
 │     · 按需拉起独立进程的服务插件（Go、TS、Python……）
 └─ CLI socket：由 cli 插件监听
```

**启动顺序**：
1. attention 抢单实例锁。抢不到就作为 CLI 客户端运行并退出（§5.7）。
2. 生成本次运行使用的 rutis 配置，拉起 `rutis-host`。
3. 在 goroutine 里调用 `rutis.ServeArgs([]string{"dial:ws://…", "--id", …}, defs...)`。
4. 主线程执行 `mygo.App.Run()`。

**关停顺序**：
1. 窗口关闭。
2. 通知 rutis-host 卸载所有插件，在关停期限内完成，默认 10 秒。
3. 结束 rutis-host 进程。
4. `os.Exit`。

**线程约束**：UI 插件的服务回调运行在 rutis 的 goroutine 上，不能直接修改 UI 状态。修改状态必须投递到主线程执行，并调用 `Window.Invalidate`。`slots` 插件统一提供 `ctx.Post(func())` 来做这件事。

**这一节的拓扑必须由 P0 spike 验证**（见路线图）：`ServeArgs` 能否在非主 goroutine 上运行，能否正常卸载，信号会不会和 mygo 冲突。如果拨入方案行不通，备选方案是由 rutis-host 通过 `fd:` 把 attention 当作 runtime 拉起来，但这样用户启动的入口就变成 rutis-host 了，需要额外的包装。

### 5.4 插件的两半

```go
// contract/git：两半共享的服务契约（只包含数据类型和方法签名）
type Status struct{ Branch string; Changes []Change }
type Git struct {
    Status func(ctx context.Context, root string) (Status, error)
    Diff   func(ctx context.Context, root, path string) (string, error)
}

// plugins/git：服务插件。可以编译进本体，也可以作为独立进程运行
var Plugin = rutis.Define(rutis.Plugin[Config]{
    Name: "git",
    Apply: func(ctx *rutis.Ctx, cfg Config) error {
        ctx.Provide("git", &service{})
        return nil
    },
})

// plugins/git-ui：UI 插件，只能编译进本体
var UI = rutis.Define(rutis.Plugin[struct{}]{
    Name:   "git-ui",
    Inject: []string{"git", "slots"},
    Apply: func(ctx *rutis.Ctx, _ struct{}) error {
        var git contract.Git
        var slots slotsapi.Slots
        ctx.Use("git", &git)
        ctx.Use("slots", &slots)
        off := slots.Register(slotsapi.SidebarPanel, slotsapi.Panel{
            ID: "git.changes", Title: "Changes", Icon: "git-branch",
            View: func(c *ui.Context, p slotsapi.PanelProps) { /* 读取状态并绘制 */ },
        })
        ctx.Effect(off)
        return nil
    },
})
```

**命名约定**：服务插件叫 `<feature>`，UI 插件叫 `<feature>-ui`，契约放在 `contract/<feature>`。

注意：UI 插件的 `View` 闭包只在本进程内传递，不能经过 rutis 序列化。所以 slots 服务通过一个**进程内的通道**登记这些闭包，而不是通过 rutis 的值传递。§5.5 会说明具体做法。

### 5.5 slot 体系

`slots` 是一个 UI 插件，它的设计照搬 dsh 的规则：

- **slot 的声明**：Go 中的类型化 key，`slotsapi.Key[P]`，其中 `P` 是这个 slot 的 props 类型。kind 有四种：`Single`、`List`、`Keyed`、`Chain`。
- **声明即授权**：一个贡献在注册时声明它会渲染哪些子 slot，只有声明者能调用 `slots.Render(c, key, props)`。
- **注册要等 slot 出现**：`slots.Inject(key, register)` 会等到 slot 被声明后再注册。slot 的所有者卸载时贡献自动撤销，所有者重新出现时自动重新注册。
- **组件拿不到 ctx**：`View` 只接收 `*ui.Context` 和类型化的 props。需要的服务由插件在 `Apply` 里事先 `Use` 好，通过闭包捕获。
- **闭包传递**：`slotsapi` 是一个编译进本体的 Go 包。`slots` 插件只通过 rutis `Provide` 一个占位服务，用来让其他插件按依赖关系挂起和恢复。真正的注册表由同一进程里的包级 registry 持有，按插件行 id 隔离，插件卸载时连同它注册的闭包一起清除。

**初始的 slot 清单**：

| key | kind | props | 所有者 |
|---|---|---|---|
| `root` | Single | 窗口 | slots |
| `layout.left` / `layout.right` | List | 侧栏宽度 | layout |
| `layout.main` | Single | — | layout |
| `sidebar.panel` | List | 面板 props | layout |
| `tab.view` | Keyed（按 viewer id） | 资源、viewer 状态 | tabs |
| `tab.toolbar` | List | 当前资源 | tabs |
| `statusbar.item` | List | — | layout |
| `palette.source` | List | 查询 | palette |
| `settings.section` | List | — | settings |
| `overlay` | List | — | slots |

### 5.6 资源模型

所有资源都用 URI 寻址，常见的 scheme 有：`file:`、`https:`、`git:`、`gh:`（由 octogo 的插件提供），以及插件自定义的 scheme。

| 角色 | 属于哪一半 | 契约 |
|---|---|---|
| **scheme provider** | 服务 | `Stat(uri)`、`Read(uri) (io.Reader 或 []byte, contentType)`、`List(uri)`、`Watch(uri)`。`file:` 以挂载根为单位，取代原来的 vault 和 mount |
| **viewer** | UI | 声明自己能处理的 content-type 和优先级，往 `tab.view` 里贡献 `View`。内置的 viewer 有：markdown（`ui/markdown`）、代码和纯文本（只读 `ui/editor`）、图片、web（`ui.WebView`）、diff |
| **extractor** | 服务 | 声明能处理的 content-type，输出 `Extract{Title, Links[], Tags[], Properties{}, Text}` |
| **index** | 服务 | 订阅资源变化事件，调用 extractor，维护资源之间的链接图（含反链）、标签、属性、全文索引。查询接口提供给搜索、反链面板和 CLI |
| **history / bookmarks** | 服务 | 浏览器的一等数据，也作为 index 的数据来源 |

这个模型带来几个结果：
- 原来 `metadata/` 里那套 Markdown 专用的元数据，变成了 `markdown-extract` 这一个插件。`html-extract` 负责网页的标题、链接、正文，同时也是阅读模式和 agent 读取页面的数据来源。
- 反链跨越资源类型：一个网页、一篇笔记、一个 PR 只要引用了同一个 URL，就能在反链里互相看到。
- 「vault」这个词不再出现在产品里，换成「挂载根」：Home 加上若干仓库，沿用 `mount/` 的语义。
- 打开资源的流程：`navigation` 服务解析 URI，找到对应的 scheme provider，拿到 content-type，再选择优先级最高的 viewer，最后在 `tabs` 里打开。

### 5.7 命令与 CLI

- `commands` 服务负责注册命令，每个命令包含 `{id, title, args schema, handler}`。命令可以由服务插件注册：handler 运行在插件自己的进程里，经过 rutis 调用。
- `cli` 插件负责监听 socket，协议与现有实现**完全兼容**：一行 JSON `{argv, tty, cwd}`，响应是纯文本，socket 关闭表示结束。参数沿用 `key=value` 风格，比如 `open path=… line=3 to=5`。
- **所有命令自动成为 CLI 子命令**。命令 id 就是子命令名，比如 `backlinks`、`property:set`、`git:status`。
- 原有约 45 个命令，按资源模型重新归属到各个插件：
  - 文件读写类（`file`、`create`、`append`、`move`……）→ `files` 插件，作用于 `file:` 资源；
  - 元数据类（`tags`、`properties`、`backlinks`、`orphans`……）→ `index` 插件；
  - 工作区类（`tabs`、`tab:open`、`recents`、`workspace`）→ `tabs` 和 `navigation` 插件；
  - `open line= to=` → `navigation` 插件，把参数透传给 viewer。
- 验收方式：把 `scripts/e2e-cli.mjs` 改成启动 Go 二进制，输出必须与 TS 版逐字节一致。只有资源模型改变了语义的命令可以例外，例外要逐条记录在 `docs/cli-deviations.md` 里。

### 5.8 profile 与配置

- 一个 profile 就是一份 rutis 配置（编译进本体的插件行，加上外部插件行），再加一份 UI 插件的启用清单。默认 profile 编译进二进制，用户的覆盖放在配置目录里。
- 配置目录沿用「只有一个配置主目录」的决定（`docs/superpowers/specs/2026-07-27-single-config-home-design.md`），不往用户打开的目录里写任何文件。目录名改为 `attention/`，不再使用 `.obsidian/` 的布局。
- 插件配置使用 rutis 的 schema。用户修改配置后，经 rutis 热更新。Go 写的插件在配置变化时会先卸载再重新加载。

### 5.9 第三方插件

- **服务插件**：完全动态。安装就是往 profile 里加一行，由 rutis-host 负责拉起和热重载，支持 Go、TS、Python、Swift。
- **UI 插件**：Go 不能在运行时加载代码，所以只有两条路：
  1. 像 xcaddy 那样**挑选插件后重新编译**：提供 `attention build --with <module>` 生成自定义的二进制；
  2. **webview slot 兜底**：插件提供一个 URL 或 HTML，由通用的 `webview-panel` UI 插件显示。这块界面是一扇嵌进去的窗，和原生界面不融合。
- 声明式的跨进程 UI 协议（插件发送视图树，由宿主绘制）不在本 RFC 范围内，见 §10。

### 5.10 UI 规范

- 沿用 octogo 的设计体系：`ui/theme` 管 token，`ui/kit` 管组件，页面里不出现硬编码的颜色和尺寸，规范写在 `docs/STYLE.md`。
- 迁移期间**先复制，后合并**：attention 先复制 octogo 的 `ui/theme`、`ui/kit`、`internal/keyboard` 以及用得上的组件，保持风格一致；等两边都稳定后，再抽成共享的 Go module。原因是 octogo 正在活跃开发，现在拆它会互相干扰。

### 5.11 仓库组织

- 同一个仓库。新的 Go module 放在 `native/`：

```
native/
  cmd/attention/        引导：单实例锁、CLI 客户端、拉起 rutis-host、mygo 主循环
  contract/<feature>/   服务契约（纯类型）
  slotsapi/             slot key、props、进程内的注册表
  plugins/<feature>/    服务插件
  plugins/<feature>-ui/ UI 插件
  kit/ theme/           从 octogo 复制过来
  profiles/default.json
```

- 迁移期间 TS 代码保持不动，作为行为参照。全部完成后（路线图 P5）删除 `apps/`、`packages/`，以及 Node 的测试流程。

## 6. 插件清单（第一批）

| 插件 | 半 | 进程 | 提供 | 依赖 | 阶段 |
|---|---|---|---|---|---|
| slots | UI | 本体 | slots | — | P0 |
| layout | UI | 本体 | — | slots | P0 |
| fs | 服务 | 本体 | `scheme:file`、mounts | — | P0 |
| files-ui | UI | 本体 | 文件树面板 | fs、slots | P0 |
| commands | 服务 | 本体 | commands | — | P0 |
| cli | 服务 | 本体 | socket | commands | P0 |
| navigation | 服务 | 本体 | navigation | commands | P1 |
| tabs | UI | 本体 | tab.view 宿主 | navigation、slots | P1 |
| viewer-markdown / viewer-code / viewer-image | UI | 本体 | viewer | slots | P1 |
| palette | UI | 本体 | 命令面板、快速切换 | commands、slots | P1 |
| markdown-extract | 服务 | 本体 | extractor | — | P2 |
| index | 服务 | 本体 | index | extractor 系列 | P2 |
| search-ui / backlinks-ui / outline-ui | UI | 本体 | 面板 | index、slots | P2 |
| files（CLI 文件命令） | 服务 | 本体 | 命令 | fs、commands | P2 |
| web | 服务 + UI | 本体 | `scheme:https`、web viewer、历史 | navigation | P3 |
| html-extract | 服务 | 可外置 | extractor | — | P3 |
| history / bookmarks | 服务 | 本体 | history | — | P3 |
| terminal | 服务 + UI | 本体 | PTY、终端视图 | slots | P4 |
| git / git-ui | 服务 + UI | 服务可外置 | `scheme:git`、变更面板、diff | fs、slots | P4 |
| webview-panel | UI | 本体 | 第三方 UI 兜底 | slots | P4 |

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
| R1 | mygo 和 rutis 都想控制进程（mygo 锁定主线程，rutis 的退出语义） | P0 spike 首先验证。失败时退路依次是：通过 `fd:` 由 rutis-host 拉起 attention；用 `ServeConn` 自己管理连接；内置插件改用和 rutis 写法一致的进程内注册表，只有外部插件走 rutis-host |
| R2 | rutis 处于 0.x，变动频繁 | 锁定版本；只通过 `contract` 和 `slotsapi` 两层接触 rutis 的 API；跟进它的迁移指南 |
| R3 | mygo v0.6，一个依赖覆盖了所有方面 | 锁定版本；它是纯 Go、MIT 协议，最坏情况可以 fork；octogo 也承担着同样的依赖风险 |
| R4 | 附带一个 Rust 二进制 rutis-host，增加打包体积、增加平台矩阵 | 发布时一并附带；P0 实测体积和启动时间 |
| R5 | 网页引擎在三个平台各不相同；没有可信输入，没有会话隔离 | 本阶段以阅读为主，可以接受；agent 操控能力另写 RFC 处理 |
| R6 | `ui/markdown` 对 wikilink、嵌入、callout 的扩展能力未知 | P1 先实测；不够用就给 mygo 提 PR，或者在 viewer 里先做预处理 |
| R7 | 慢速的服务插件跨进程调用，拖慢 UI | UI 插件对服务调用一律异步处理，结果通过 `ctx.Post` 投递回主线程；`View` 函数里禁止阻塞调用 |
| R8 | 推翻重写的成本 | 现有的 TS 版本在迁移期间继续可用；CLI 的 e2e 测试作为客观的对齐标准 |

## 9. 与现有工作的关系

- **PR #2（LSP）**：不合并。新定位不需要 LSP。分支保留，留作参考。
- **git**：现有的 `builtin/git` 不迁移，在 P4 按 §5.4 重新设计成 `git` 加 `git-ui` 两个插件。
- **GitHub**：不迁移。octogo 负责 GitHub 相关功能。以后可以把 octogo 的功能整理成服务插件和 UI 插件接进 attention，需要另写 RFC。
- **单一配置主目录**的设计决定继续有效（§5.8）。

## 10. 未决问题

1. octogo 的部件是先复制还是先抽成共享模块（§5.10 建议先复制）。需要用户确认。
2. 代码放在 `native/` 目录、留在同一仓库（§5.11）。需要用户确认。
3. slot 和服务契约要不要从一开始就按「可以对外发布的 SDK」来设计，例如做成 `attention/sdk` module？
4. 跨进程的声明式 UI 协议要不要做、什么时候做（§5.9）。
5. index 的存储：纯内存、SQLite（mygo 有官方插件），还是交给插件自己决定？
6. 阅读模式的正文抽取算法：Go 版的 readability，还是让插件实现？
7. 多窗口：dsh 和 octogo 都是单窗口。attention 要不要支持多窗口？slot 的作用范围是否需要包含窗口？

## 11. 验证

每个阶段的完成标准都写在路线图里。贯穿整个迁移的几条硬性标准：

- `go test ./...`、`go vet`，以及从 octogo 迁过来的一致性检查（禁止硬编码颜色和尺寸），全部通过；
- CLI 的 e2e 测试与 TS 版逐字节一致，例外只能写在 `docs/cli-deviations.md` 里；
- 每个插件都有一个 `rutistest` 测试，在没有宿主的情况下单独运行；
- 每个阶段都在 Linux（Wayland）上手动验收，并截图归档。
