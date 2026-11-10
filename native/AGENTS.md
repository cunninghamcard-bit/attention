# native/

Go rewrite of attention. RFC: `docs/rfc/0001-go-native-plugin-browser.md`. Roadmap: `docs/roadmap.md`. Spike: `docs/rfc/0001-spike-report.md`.

The repo-root `AGENTS.md` / `CLAUDE.md` rule “reconstruct Obsidian byte-for-byte” does **not** apply here.

## Behaviour and UI

- Port behaviour from the TS app in `apps/web`. Cite the TS file in a comment. This covers behaviour only: the window's structure and how components are drawn follow docs/rfc/0003-arc-layout.md (the Arc-style sidebar, content card and context column), not the TS app.
- Never call `.Key()` on the element an ACard component or `aui.IconMenu` returns: it rekeys the control, which loses its state, so its click never registers or its menu never opens. Key it with `c.Key(…)` before the call, key the parent, or use `.Clicked()` on a plain element.
- Components come from ACard (`github.com/cunninghamcard-bit/acard-ui`, docs/rfc/0005-acard.md; a private repository, so `go` needs `GOPRIVATE=github.com/cunninghamcard-bit/acard-ui` and git access to it): `components/<pkg>` (`button`, `selectmenu`, `toggleswitch`, `input`, `tooltip`, `popover` …), icons from `acard-ui/icon`. An ACard field returns its inner control: size a column around it, and name it with `.Label` where the row already shows the text (ACard draws `Props.Label` above the field). `native/ui` (imported as `aui`) only holds the Arc-window composites (RFC 0003: `TabRow`, `SplitRow`, `SideRow`, `SidebarItem`, `AddressBar`, `CommandRow`, `Frost`, `Card`, the settings layout) and, until ACard has them, `SearchField`, `NumberField`, `IconMenu`, `Dialog`, `Disclosure` and the icons in `native/ui/icon` (imported as `auiicon`). Pages read colours from `tokens.TokensOf(c)` (ACard's, which `appearance` registers per theme) and, for the semantic tokens ACard has no field for (`BgWindow`, `Scrim`, `Highlight` …), `aui.TokensOf(c)` (docs/rfc/0004-theme-tokens.md); `c.Theme()` only for the fields it projects; no literal colours or ad hoc alphas in pages. A missing capability goes into `acard-ui` and a new tag, not into `native/ui` or a plugin.

## Threading

- UI state only on the mygo main thread.
- Work done on goroutines comes back through `sh.Update` (`*shell.Shell`).
- Never do disk or service calls in a View function.
- `shell.OnMain` must not be called from the main thread.

## rutis plugins

- The `layout` plugin (dsh's ui-layout) draws the window — the sidebar, the content card holding the center slot, the context column, overlays — and keeps the sidebars' and the panels' states (`layout.json`); `workspace` is the center (the tab list, pinned area and folders, splits, the address bar and status line through `SetChrome`, `session.json`). UI plugins inject `slots` (`*slots.Registry` for sidebar panels and context sections, overlays, palette sources), `layout` (`*layout.Layout` to reveal a panel), and `workspace` (`*workspace.Workspace` to reach the tabs, and `tabTypes` as `*tabtypes.Registry` to register tab types). Opening goes through `OpenResource(address, opts)` (`Open(path)` for a path); a bad address or a `Kind` that won't open it is an error and makes no tab.
- Viewers are tab types (`plugins/tabtypes`, RFC §5.6): a pattern over resource addresses (`fs.AddressFor` / `AbsoluteAddress`), a tier, a `Body` keyed by the type's ID. Tab identity is `(kind, address)`. As in dsh's registry: an ID registers once, a kind holds at most a Builtin and an Extension (the Extension in force, a Fallback alone), an unnamed `Priority` is Extension; breaking these panics. Panel IDs register once too. Viewers inject `tabTypes`; the workspace reclaims its tabs whenever the registry's generation changes.
- A tab holds its address in `resources` (`*resources.Registry`) while open; `fileresource` serves the `file` protocol (stat + watch of the parent directory). A viewer keeps per-tab state by `Info.ID`, drops it in `Closed` (called when the tab closes or moves to another type, even one unloaded), waits while `Info.Pending`, and reads its file when `Info.Version` moves. It never subscribes to fs changes; `Info.Missing` comes from the resource's state.
- Plugins are small and one per feature, as dsh's roster: the rows in `launcher.Rows` are flat. A rutis group row (`"group": true`, child rows in `config`) is for an optional bundle toggled as a unit, as dsh's terminal-bundle, not for the core.
- Configuration is `settings` (`*settings.Settings`, attention's getConfig/setConfig): `app`, `appearance`, `hotkeys` JSON files in the config folder, read with `Get`, written with `Set` on the main thread; the settings plugin loads and flushes them. A key read every frame is fine; parse once per `Generation` when costly.
- Shortcuts belong to commands: declare them in `actions.Command.Keys` (`Ctrl` is the platform's command key, `Control` the key itself; several comma-separated) with a `Main` that runs on the main thread; the `shortcuts` plugin binds them, with the user's overrides from `hotkeys.json` (attention's format). App shortcuts do not reach the window while a modal dialog is open. No view reads app-wide keys itself.
- A page is a tab that shows no file: `ws.OpenTab(kind, opts)` opens `attention://<kind>` (`tabtypes.PageAddress`), claimed by kind by a type with no patterns; it reveals its tab or opens a new one, never navigating a file's tab away. Settings follow attention's SettingsModal (apps/web/builtin/SettingsModal.ts, SettingsRenderer.ts): a plugin adds a tab with `sl.RegisterSettingsSection`, in the `Options` group if it is one of the TS app's own tabs (Files and links, Appearance, Hotkeys), else `CorePlugins` as a TS plugin's setting tab; its `Keywords` are its settings' names, for Search settings. Port a tab's rows from its TS setting tab.
- Modals and other window-wide layers are overlays (`sl.RegisterOverlay`); the palette's modes are palette sources (`sl.RegisterPaletteSource`), opened with `sl.OpenPalette(id)`.
- Constructors take a `post func(func())` (`sh.Update` in the plugin): tests pass a channel, since `sh.Update` holds posts until a window exists.

- Every `ctx.Go` task must return when its context is cancelled (unload waits for it before Effects run).
- Register, then hand the off func to `ctx.Effect`.
- Service contract methods end in error.
- No channels in contracts.

## Processes

- The UI runtime ignores SIGPIPE.
- Never send rutis-host a second signal (it skips cleanups).
- Exit-path table: `docs/rfc/0001-spike-report.md`.

## Font

- Body font follows the system (fontconfig sans-serif). Do not “fix” it in the theme.

## Verify

```
cd native && gofmt -l . && go vet ./... && go test ./...
```

GUI tests use mygo’s `ui.NewTester` in-process. Never send synthetic keystrokes to the real desktop — the user works on this machine.

## Commits

Conventional, lowercase subject (commitlint).

## Gates

Before every commit, from `native/`: `gofmt -l .` prints nothing, `go vet ./...` and `go test ./...` pass, and `GOWORK=off asl -forwarder=false ./...` reports nothing (also with `GOOS=darwin`). `asl` is CMGS/asl's layout checker (`go install` it; it lands in `$(go env GOPATH)/bin`). The project hook `.claude/hooks/asl-gate.sh` enforces it on commits, and the `/code` skill (`.claude/skills/code`) holds the style rules it checks.
