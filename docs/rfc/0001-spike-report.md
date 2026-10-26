# RFC 0001 P0 spike 报告：进程拓扑

- 日期：2026-10-26
- 代码：`native/`（分支 `spike/p0-topology`）
- 环境：CachyOS，Wayland，Go 1.27.3，mygo v0.6.4，rutis Go SDK v0.17.1，rutis-host 0.17.1（官方发布的 `x86_64-unknown-linux-musl` 预编译版本，sha256 校验通过）
- 结论：**拓扑成立**。RFC §5.3 的「宿主做父进程、`fd:` 拉起 UI runtime」可以用，不需要启用 R1 的退路。关停方式要改用「关窗时给宿主发 SIGTERM」，见下文。

## 验证了什么

spike 由两个二进制组成：

- `attention`：启动器加 UI runtime。UI runtime 里有三个插件：`hello`（进程内服务）、`ui`（调用 `hello` 和外置的 `clock`，并接收跨进程回调）、`cli`（沿用现有 `{argv, tty, cwd}` 协议的 socket）。
- `clock`：外置的服务插件，提供 `Now()` 和 `Subscribe(n, onTick func)`。

启动器生成的 `rutis.json`：

```json
{
  "format": 1,
  "id": "attention",
  "runtimes": { "go": { "binaries": ["<attention>", "<clock>"], "start": "eager", "restart": "<见下文>" } },
  "rows": [
    { "id": "hello", "name": "go:hello" },
    { "id": "clock", "name": "go:clock" },
    { "id": "ui", "name": "go:ui" },
    { "id": "cli", "name": "go:cli" }
  ]
}
```

## 结果

| 项目 | 结果 |
|---|---|
| 启动器 exec rutis-host，宿主通过 `fd:3` 拉起 UI runtime | ✅ 宿主传入的参数是 `fd:3 <project>`，`ServeArgs` 在非主 goroutine 上正常运行，mygo 在主线程上正常打开窗口 |
| `ServeArgs(fd:)` 和 mygo 的信号处理是否冲突 | ✅ 不冲突。fd 模式下 rutis 不监听信号，会话结束时 `ServeArgs` 返回 |
| 同进程服务调用 | ✅ `Service.Local()` 为 true；1000 次调用约 0.45ms（每次约 0.45µs） |
| 跨进程服务调用 | ✅ `Local()` 为 false；200 次调用约 30–49ms（每次约 0.15–0.25ms） |
| 跨进程回调（函数按引用传递） | ✅ `clock` 进程调用 UI 进程传过去的 `onTick`，3 次都按时到达 |
| CLI socket | ✅ 第二次运行 `attention version` / `attention greet` 时，作为客户端连上 UI runtime 并拿到结果 |
| 启动时间（启动器 → 窗口打开） | 228–392ms（3 次） |
| 常驻内存 | UI runtime 约 117MB，rutis-host 约 10.5MB，外置的 `clock` 约 12–14MB |
| 体积 | `attention` 22.1MB，`clock` 13.6MB，`rutis-host` 19.9MB（未 strip） |

## 退出路径

| 场景 | 配置 | 结果 |
|---|---|---|
| 用户关窗 | `restart: "no"`，UI runtime 在 `App.Run` 返回后给父进程（宿主）发 SIGTERM | ✅ **推荐**。宿主按依赖顺序卸载：`ui` → `cli` → `hello`，外置的 `clock` 也执行了清理，会话正常结束，socket 被删除，约 2ms 完成，没有残留进程 |
| 用户关窗 | `restart: "exit"`，UI runtime 直接退出 | ⚠️ 宿主以 3 退出，外置插件执行了清理，但 **UI runtime 里的插件清理都没有执行**（进程先退出了），socket 残留 |
| 终端 Ctrl-C（整个进程组收到 SIGINT） | 推荐配置 | ✅ 和关窗一样，全部清理执行，没有残留 |
| `kill -9` rutis-host | 推荐配置 | ✅ UI runtime 发现连接断开，自己卸载各行，清理全部执行，进程退出，没有残留（前提是忽略 SIGPIPE，见下文） |
| `kill -9` UI runtime | `restart: "no"` | ⚠️ 宿主继续运行，UI 没了，应用变成没有窗口的僵尸。所以不能用 `"no"` |
| `kill -9` UI runtime | `restart: "exit"` | ✅ 宿主卸载其余插件后退出；UI 进程里的清理当然无法执行 |
| 替换外置插件的二进制 | `restart: "on-failure"` | ✅ 换上新二进制，SIGTERM 旧进程，宿主用新二进制把它拉起来；依赖它的 `ui` 自动挂起（清理执行）后恢复（重新 `Apply`），拿到新版本的结果，界面没有崩溃 |

## 发现，需要写进 RFC 的

1. **关停方式**：不用 `restart: "exit"` 来关停应用。关窗时，UI runtime 给父进程宿主发 SIGTERM，等待会话结束后再退出。这样宿主走正常的关停流程，所有插件（包括 UI runtime 里的）都执行清理。
2. **`restart` 的取值**：`runtimes.go.restart` 对所有 Go runtime 统一生效。推荐 `"on-failure"`：外置插件崩溃时会被重新拉起（也是热替换的机制）；UI runtime 崩溃时也会被重新拉起，窗口重新打开。代价是 UI runtime 不断崩溃时，宿主最多重启 5 次就放弃，之后应用会没有窗口地留在后台。要么由启动器监控（UI runtime 放弃重启后结束宿主），要么等 rutis 支持按 runtime 分别设置 `restart`。这一点留给 P1。
3. **`ctx.Go` 的任务必须响应取消**：卸载插件时，rutis 先取消 ctx 并**等待** `ctx.Go` 启动的任务返回，然后才执行 `Effect`。如果任务阻塞在不响应 ctx 的调用上（比如 `net.Listener.Accept`），这个插件会卡住，依赖它的那些插件的卸载也跟着卡住。spike 里 `cli` 的第一版就卡住了，后来在任务里监听 `ctx.Done()` 并关闭 listener 才解决。这一条要写进插件开发规范。
4. **忽略 SIGPIPE**：运行时的 stdout/stderr 是通往宿主的管道。宿主死后，插件清理时只要往 stderr 写一行日志，进程就会被 SIGPIPE 杀死，后面的清理全部丢失。UI runtime 启动时要 `signal.Ignore(syscall.SIGPIPE)`。外置的 Go 插件也有同样的问题（spike 里的 `clock` 在宿主被杀时就没能执行清理），这可以作为一个问题反馈给 rutis，让 Go SDK 默认处理。
5. **外置插件收到 SIGTERM 时不执行清理**：Go runtime 默认收到 SIGTERM 就直接退出。所以热替换时，最好让宿主先卸载这一行（修改配置后发 SIGUSR1），而不是直接给插件进程发信号。
6. **启动器的单实例判断**：spike 用「能连上 CLI socket 就当客户端」来判断，两个启动器同时启动时存在竞态。P1 改用 mygo 的 `App.RequestSingleInstanceLock()`，或者在启动器里加文件锁。

## 还没验证的

- macOS 和 Windows（WKWebView、WebView2 下 UI runtime 由宿主拉起是否正常）。
- `rutis-host dev` 和启动器生成的配置能否用同一套开发流程。spike 证明了在 `run` 下也能热替换外置插件，所以开发时可能用不到 `dev`。
- 宿主以 SIGUSR1 重新读取配置时，增删插件行的行为。
