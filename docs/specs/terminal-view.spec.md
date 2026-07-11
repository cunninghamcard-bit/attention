spec: task
name: "terminal-view"
inherits: project
tags: [workspace, view, terminal, pty, libghostty, plugin-api]
---

## Intent

Add a usable built-in Terminal core plugin to Obsidian-Reconstructed, with a `TerminalView` completion level comparable to `lavs9/obsidian-ghostty-terminal`.

This is not a placeholder, fake terminal, or architecture-only draft. The first deliverable must open a real interactive local terminal inside the workspace, render terminal output, accept keyboard input, resize correctly, clean up processes on close, and expose framework-level extension points in the Obsidian style.

The implementation should follow the existing `WebViewerPlugin` shape: core plugin registration, controller, `ItemView` lifecycle, app-level service, adapter boundary, Ghostty-style terminal renderer, real PTY bridge, input/output piping, resize handling, restart behavior, file/folder menu cwd opening, and cleanup on unload/close.

## Decisions

- Terminal is implemented as a built-in core plugin, analogous to `WebViewerPlugin`, not as a Workspace special case.
- The first implementation must run a real local shell, not a fake terminal.
- Use the `obsidian-ghostty-terminal` architecture as the reference implementation path, but name the renderer dependency by its underlying libghostty route rather than treating Python helper as mandatory.
- Use the same WASM renderer path as `obsidian-ghostty-terminal`: `ghostty-web`, which wraps `libghostty-vt` through WASM.
- Treat libghostty as the terminal emulation/rendering layer, not as the shell/PTY owner. The built-in architecture is `TerminalPlugin` + `TerminalController` + `TerminalView` + `TerminalService` + `TerminalAdapter` + Ghostty renderer.
- Use `node-pty` as the first local PTY implementation for macOS/Linux desktop.
- Use `TerminalAdapter` as the Obsidian-style desktop adapter for terminal native capability, analogous to `FileSystemAdapter`.
- Import `node-pty` only from desktop `TerminalAdapter` code. Renderer/UI code must communicate with terminal native capability through `app.terminals` and typed terminal events.
- The current repo is a Vite/Bun frontend reconstruction without a real Electron runtime. Browser/Vite mode must use an `UnsupportedTerminalAdapter`; the real `node-pty` adapter requires adding a minimal Electron desktop runtime.
- Keep PTY/process internals behind `app.terminals` or an internal `TerminalProcess`; do not expose raw internals to plugins.
- `TerminalView` may own the live renderer for the first usable version, but public control and terminal handles still go through `app.terminals` or Workspace events.
- Extension points are exposed by framework services: `Workspace`, `Events`, and `Plugin` lifecycle cleanup.
- `TerminalView` does not implement its own plugin manager.
- The terminal supports cwd selection from workspace/file context.
- Real backend migration, such as moving PTY ownership to Go, is a later refactor and must not block the first usable desktop version.

## Boundaries

### Allowed changes

- App initialization and service mounting code for `app.terminals`, analogous to `app.webViewer`.
- A new `TerminalPlugin` core plugin definition that registers the `terminal` view type, commands, file/folder menu items, and settings.
- Workspace terminal event typings.
- A local terminal module for `app.terminals`, live `TTerminal`, internal `TerminalProcess`, PTY bridge, `ghostty-web` renderer wrapper, resize handling, and key handling.
- Desktop adapter code needed to spawn the PTY through `node-pty`.
- A minimal Electron desktop runtime if this task implements the real `node-pty` adapter in this repo.
- Build configuration needed to bundle `ghostty-web` WASM/runtime assets.
- Settings/config code needed for shell path, font family, font size, scrollback, and optional Ghostty config path.
- Plugin API sugar only for Workspace event registration and safe terminal actions.
- Tests and documentation proving the terminal is real, interactive, and cleaned up.

### Forbidden changes

- Do not ship a fake-only terminal.
- Do not defer real terminal execution out of the first implementation.
- Do not replace the libghostty/plugin-inspired plan with a minimal echo renderer.
- Do not expose raw process handles, PTY fds, Node streams, backend sockets, or renderer instances to plugins.
- Do not create a TerminalView-specific plugin manager.
- Do not require Go service implementation for the first usable desktop version.
- Do not support Windows in the first usable version.
- Do not implement remote terminal support in this task.
- Do not pretend browser/Vite mode can spawn local shells.
- Do not let plugins replace renderer, PTY transport, or shell process implementation.
- Do not silently leave PTY child processes alive after closing the view or unloading the core plugin.

### Public model

```text
App
  workspace
  terminals

TerminalPlugin
  TerminalController
  TerminalView

WorkspaceLeaf
  TerminalView
    GhosttyTerminalRenderer
    TTerminal

TerminalService
  terminals: Map<terminalId, TTerminal>
  processes: Map<terminalId, TerminalProcess>

TTerminal
  id
  cwd
  shell
  status

TerminalAdapter
  node-pty native boundary
  unsupported browser fallback

TerminalProcess
  node-pty process wrapper
  stdin/write
  stdout/onData
  resize
  kill
```

The internal `TerminalAdapter` and `TerminalProcess` may hold process and stream objects. Public APIs must expose only `TTerminal` handles and context.

### Public API sketch

```ts
interface TTerminal {
  id: string;
  cwd: string;
  shell: string;
  status: "starting" | "running" | "exited" | "error";
}

interface TerminalOpenOptions {
  cwd?: string;
  shell?: string;
  command?: string;
  location?: "left" | "right" | "tab" | "split" | "window";
  reveal?: boolean;
}

interface TerminalService {
  open(options?: TerminalOpenOptions): Promise<TTerminal>;
  getTerminal(id: string): TTerminal | null;
  write(terminalId: string, data: string): void;
  resize(terminalId: string, cols: number, rows: number): void;
  kill(terminalId: string): void;
  restart(terminalId: string): Promise<TTerminal>;
}
```

Public objects are handles and context objects only.

### Core plugin integration

`TerminalPlugin` mirrors the existing `WebViewerPlugin` pattern.

```text
WebViewerPlugin      -> TerminalPlugin
WebViewerController  -> TerminalController
WebViewerView        -> TerminalView
WebViewerService     -> TerminalService / app.terminals
WebViewerElementAdapter -> GhosttyTerminalRenderer
BrowserSessionBridge -> TerminalAdapter
```

`WebViewerElementAdapter` is not treated as a pure frontend component: it uses Electron `<webview>` when available and falls back to `iframe` otherwise. `BrowserSessionBridge` owns browser session capability. Terminal follows the same split: `GhosttyTerminalRenderer` owns DOM/WASM rendering, while `TerminalAdapter` owns Node/Electron PTY capability.

The core plugin registers the `terminal` view type, command palette command, file/folder menu entries, and setting tab. `app.terminals` remains the app-level service used by views and plugins.

### Workspace extension events

```ts
app.workspace.on("terminal-menu", (menu, context) => {});
app.workspace.on("terminal-open", (terminal) => {});
app.workspace.on("terminal-exit", (terminal, code) => {});
app.workspace.on("terminal-error", (terminal, error) => {});
```

Before showing a terminal context menu, `TerminalView` triggers:

```ts
this.app.workspace.trigger("terminal-menu", menu, {
  terminalId,
  cwd,
  shell,
  status,
  selection,
  view: this,
});
```

Plugins may add menu items or call safe `app.terminals` actions. Plugins may not replace renderer, PTY, or terminal implementation.

### Renderer requirements

The renderer must be libghostty-backed and support real terminal control sequences well enough for normal shell use.

```ts
interface TerminalRenderer {
  mount(el: HTMLElement): void;
  write(data: Uint8Array | string): void;
  onInput(callback: (data: string) => void): void;
  fit(): { cols: number; rows: number };
  getSelection(): string;
  focus(): void;
  dispose(): void;
}
```

Renderer path: use `ghostty-web` / `libghostty-vt` WASM, matching the open-source plugin. Keep a small wrapper so the rest of the app is not coupled to the package directly. The wrapper is responsible for rendering, input capture, fit measurement, selection, focus, and disposal only; process spawning and PTY resize remain in the PTY bridge.

### PTY bridge requirements

The PTY bridge must provide these behaviors:

- Start the configured shell with a real PTY through `node-pty` on macOS/Linux.
- In browser/Vite mode, return a clear unsupported-runtime error instead of attempting to spawn.
- Use cwd from explicit options, file/folder context, or vault/project root fallback.
- Pass terminal env values such as `TERM`, `TERM_PROGRAM`, `COLORTERM`, `COLUMNS`, and `LINES`.
- Stream raw PTY output into renderer without corrupting multibyte UTF-8 sequences.
- Stream renderer input into PTY stdin.
- Support resize frames or equivalent OS PTY resize calls.
- Detect process close and surface exit status.
- Surface spawn or PTY errors in the terminal UI and as Workspace events.
- Kill PTY/shell on view close and app unload, with a hard-kill fallback if graceful termination fails.
- Return a clear unsupported-platform error on Windows.

### Keyboard requirements

- Terminal-focused keyboard input must not be stolen by global workspace hotkeys.
- Copy/paste should work in the terminal surface.
- Enter, Backspace, arrows, modifier key sequences, and common terminal control keys should reach the terminal.
- Ghostty-style keybind parsing is allowed when needed for parity, but the first pass may hardcode the proven built-in defaults from the plugin if that keeps the implementation smaller.

### Settings requirements

Provide only settings needed for a usable local terminal:

- Default shell path.
- Default terminal location.
- Font family override.
- Font size override.
- Scrollback line count.
- Optional Ghostty config path if the renderer/config parser needs it.

Avoid speculative settings not needed for the first usable version.

## Acceptance Criteria

Scenario: Open TerminalView from built-in TerminalPlugin with real shell
  Test:
    Package: vitest/e2e
    Filter: TerminalView
  Given App is initialized and TerminalPlugin has registered the `terminal` view type
  When `app.terminals.open()` is called
  Then the leaf contains a `TerminalView`
  And the view creates a terminal DOM surface
  And a real local terminal process is started
  And the terminal displays a prompt or shell output from the real process

Scenario: Input reaches the real PTY
  Test:
    Package: e2e
    Filter: TerminalInput
  Given TerminalView is open and the shell process is running
  When the user types `printf terminal-ready\n` and presses Enter
  Then the command is written to the PTY
  And terminal output includes `terminal-ready`

Scenario: PTY output renders through libghostty renderer
  Test:
    Package: e2e
    Filter: TerminalRenderer
  Given TerminalView is open
  When the shell emits ANSI-colored output
  Then the renderer displays the output without raw escape-code leakage in normal visible text
  And the terminal remains interactive after rendering that output

Scenario: Resize updates PTY dimensions
  Test:
    Package: vitest/e2e
    Filter: TerminalResize
  Given TerminalView is mounted and the shell is running
  When terminal surface size changes
  Then renderer `fit()` returns cols and rows
  And the PTY receives the new cols and rows through resize handling
  And subsequent shell layout-sensitive output uses the updated dimensions

Scenario: Terminal opens at file or folder cwd
  Test:
    Package: vitest/e2e
    Filter: TerminalCwd
  Given a file or folder context is available from a workspace menu
  When the user chooses `Open terminal here`
  Then TerminalView opens or reveals a terminal
  And the shell cwd matches the selected file's parent folder or selected folder

Scenario: Closing view cleans up process resources
  Test:
    Package: vitest/e2e
    Filter: TerminalLifecycle
  Given TerminalView owns a running shell process
  When the WorkspaceLeaf closes or View `onClose()` runs
  Then renderer is disposed
  And PTY stdin/stdout/stderr/resize resources are closed
  And the PTY process and child shell are terminated
  And no orphaned PTY child process remains

Scenario: Restart recovers from exited shell
  Test:
    Package: e2e
    Filter: TerminalRestart
  Given the shell process exits
  When the user clicks restart
  Then TerminalView starts a new real shell process in the same cwd
  And the terminal becomes interactive again

Scenario: Menu extension point is framework-level
  Test:
    Package: vitest
    Filter: TerminalMenu
  Given a plugin listens to `app.workspace.on("terminal-menu", handler)`
  When TerminalView opens its context menu
  Then Workspace triggers `terminal-menu`
  And the handler receives a menu and limited context object
  And the handler can add a menu item

Scenario: Public API hides implementation handles
  Test:
    Package: vitest
    Filter: TerminalPublicApi
  Given a plugin receives terminal context or a terminal handle
  When the returned object is inspected
  Then it has no `pty`, `process`, `stream`, `renderer`, `socket`, or `fd` field
  And plugin code can operate terminal only through `app.terminals` methods

Scenario: Spawn failure is visible and recoverable
  Test:
    Package: vitest/e2e
    Filter: TerminalErrorPath
  Given the configured shell path is invalid or the PTY native module cannot load
  When TerminalView tries to start the terminal
  Then the terminal surface shows a clear error message
  And `terminal-error` is emitted
  And a restart action is available after the configuration is fixed
  And the App remains usable

Scenario: Browser runtime reports unsupported terminal execution
  Test:
    Package: vitest
    Filter: TerminalUnsupportedRuntime
  Given App is running without Electron/Node PTY capability
  When `app.terminals.open()` is called
  Then TerminalView opens with a clear unsupported-runtime message
  And no shell process is spawned
  And `terminal-error` is emitted with an unsupported-runtime code

## Out of Scope

- Fake-only terminal implementation.
- Remote terminal.
- Go backend terminal service as a first-pass requirement.
- Windows terminal support.
- Plugin-controlled renderer replacement.
- Plugin-controlled PTY replacement.
- Terminal output transform plugin pipeline.
- Terminal input interceptor plugin pipeline.
- Full Ghostty config parity beyond what is needed for a usable first version.
- Session persistence across app restarts.
