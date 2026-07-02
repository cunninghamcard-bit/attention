# Electron main reconstruction plan

Goal: turn the clean-room renderer (currently a Vite web app) into a **complete,
runnable desktop application** that boots via a real Electron main process, opens a
real vault folder, and edits Markdown — reconstructed **layer by layer against the
reverse-engineering evidence**, with **no minimal stubs and no tech debt**.

Authoritative evidence: `decode-obsidian/.claude/skills/obsidian-reverse-profile/reference/electron-main-api.md`
(inner `obsidian.asar/main.js`, Obsidian 1.12.7).

## Hard constraints

1. **Fidelity, not minimal.** Every layer implements the real semantics from the
   reverse note (window params, `app://` resolver, `obsidian://` routing, IPC
   contract, obsidian.json persistence). No placeholder that "returns empty".
2. **Feature scope = platform contract only.** Per `reconstruction-scope.md`: no
   Graph / Backlinks / Canvas / Sync / Publish / Daily Notes / etc. feature parity —
   seam-only, `defaultOn: false`. This effort touches the desktop shell, not features.
3. **Never break the web build or tests.** `bun run check` (oxlint + tsc + vitest +
   vite build + build:api) and the Playwright e2e must stay green after every layer.
   Electron code lives in its own build target; web/test path keeps using the
   in-memory adapter and the existing `window.electron?`-optional renderer code.
4. **Match the renderer's existing contract exactly** — it already expects
   `window.electron.ipcRenderer.{sendSync,send}`, `window.electron.shell`,
   `window.electron.webUtils`, `window.electronWindow`, and renderer-side
   `import("node:fs/promises")`. This forces `contextIsolation:false` +
   `nodeIntegration:true`, which is also what real Obsidian uses.
5. **Commit per green layer.** Each layer ends with a passing check and a commit.

## Renderer → main contract (must be satisfied exactly)

Sync (`window.electron.ipcRenderer.sendSync`):
- `file-url` → resource path prefix (`Be` = `app://<random>/`)  [Platform.ts:100]
- `is-quitting` → boolean                                        [WorkspaceWindow.ts:249]
- `trash`, path → boolean                                        [FileSystemAdapter.ts:302]

Send (`window.electron.ipcRenderer.send`):
- `set-menu`, `{template}`                                       [DesktopMenu.ts:221]
- `update-menu-items`, items, shareFlag                          [DesktopMenu.ts:177]

`window.electron.shell.showItemInFolder(path)`                    [App.ts:593]
`window.electron.webUtils.getPathForFile(file)`                   [AttachmentImport.ts:93]
`window.electronWindow`: minimize/maximize/unmaximize/close/isMaximized/isMinimized/
  isFullScreen/isFocused/getBounds/setWindowButtonPosition/setTrafficLightPosition/
  webContents.getZoomFactor  [FrameDom.ts:10, WorkspaceWindow.ts, WorkspaceTabs.ts:610]
NativeBridge async: `dialog:open`, `dialog:save`, `window:set-fullscreen`, `request-url`
Renderer Node use: `import("node:fs/promises" | "node:path" | "node:fs")` [FileSystemAdapter]

## Layers (each = its own commit)

- **L0 Foundation / build wiring.** Add `electron` dep; `electron/` target
  (`main.ts`, `preload.ts`) with its own tsconfig (node/CJS); dev = load Vite dev
  server, prod = load built assets via `app://`. `bun run check` still green.
- **L1 Preload bridge.** `preload.ts` installs `window.electron`
  (`ipcRenderer.{sendSync,send,on}`, `shell`, `webUtils`) + `window.electronWindow`.
  Exact interfaces from FrameDom/Platform/FileSystemAdapter. Tests for the bridge shape.
- **L2 Config + vault registry.** `obsidian.json` (userData) read/write; per-vault
  `<id>.json` window state; registry `P` semantics (path resolve, `open` flag, `ts`,
  `Re`/`Ge`/`ve`). Real, tested.
- **L3 BrowserWindow lifecycle.** `de()` vault-window factory (exact webPreferences,
  `fe()` bounds clamp/restore, ready-to-show, close→persist→3s destroy, closed→registry),
  `Ze()` starter/help windows. Back `WindowManager`/`PopoutManager` with real windows.
- **L4 `app://` protocol.** `protocol.handle("app")`: `app://obsidian.md/` assets
  (traversal-guarded under resources) + `app://<random>/` local file origin, Range
  (206/416), headers, `X-Frame-Options`. `file-url` IPC returns the random origin.
- **L5 IPC main handlers.** Full channel table: env getters, `vault*`, `trash`,
  `request-url` (net.request), `set-menu`/`update-menu-items`→real `Menu`,
  `open-url`, `starter`/`help`, `dialog:open/save`→`dialog`, `window:set-fullscreen`.
- **L6 `obsidian://` routing.** `setAsDefaultProtocolClient`, open-url/second-instance/
  argv capture, `$e` parse, `it()` → inject `OBS_ACT` into the vault window. Wire to
  existing `UriRouter`.
- **L7 Real vault.** Swap `InMemoryAdapter`→`FileSystemAdapter` when running under
  Electron (web/test keep in-memory). App opens a real folder and edits Markdown → runnable.
- **L8 Hardening.** default-session `webRequest` header rewrite + tamper lock,
  permission handler, single-instance lock, `window-all-closed`/`activate`/quit flow,
  native menu fidelity (`Qe`/`we`/`Ee`).
- **L9 Packaging (final).** `electron-builder` config to produce a launchable app
  bundle. Optional; "runnable" bar is met at L7 (`electron .` opens a real vault).

Out-of-scope seams recorded only (updater download/install, CLI REPL/server, adblock,
`register-cli`, `create-browser-session`).

## Orchestration

Layers are sequential (each depends on the previous). Within a layer, independent
files + their tests are built in parallel by subagents, then the layer is verified
(`bun run check`) and committed. Non-goal feature domains are never touched.
