<!-- docwright:governs: apps/** -->

# Architecture

This document governs `apps/**`. `docwright guard` flags it as drift when
the directory tree, the runtime split, or the import rules below stop matching
the code — keep the doc and the tree in step or the guard goes red.

This workbench is a clean-room, runnable reconstruction of Obsidian's frontend
architecture, grown into an agent workspace. It is a pnpm-workspace monorepo of
three runtime packages. The application is deliberately name-agnostic: no
product name appears in the tree, only in the git remote.

## Directory tree

```
.
├── apps/            three runtime packages — the only workspace packages
│   ├── desktop/         @app/desktop — Electron main + preload; the thin native shell
│   ├── web/             @app/web — the product; browser tech, node powers under the shell
│   └── server/          @app/server — agent sidecar (loom kernel client, pi engine)
├── tests/               ALL unit tests, centralized (workspace member @app/tests):
│   ├── web/             mirrors apps/web/src/** — imports via @web/*
│   ├── desktop/         mirrors apps/desktop/** — imports via @desktop/*
│   ├── e2e/             Playwright end-to-end + the large-vault perf harness (PERF_VAULT)
│   ├── architecture.test.ts   the architecture alarms (direction/lane/facade/freeze)
│   └── package.json     declares the bare deps tests need (own pnpm lane)

├── docs/                this file, the project constitution, and SDD goal folders
├── out/                 build outputs, one roof — out/{web,desktop,server,api,types}
│                        (deliverables; the electron-vite geometry) — gitignored
├── reports/             test observability, one roof — coverage + playwright
│                        reports/results — gitignored, look-then-discard
├── .githooks/           tracked git hooks (pre-commit guard + commit-msg lint),
│                        auto-armed by the `prepare` script on every install
├── .github/             CI: the full local gate battery on push/PR
├── scripts/             build/e2e helper scripts (dts fixup, CLI e2e driver)
├── patches/             pnpm dependency patches (ghostty-web)
└── decode-obsidian/     read-only reference symlink to Obsidian's source (never edited)
```

The root `package.json` (`monorepo-root`, private) is a pure workspace yard: it
holds dev tooling and scripts but **zero runtime dependencies**. Each runtime
lane carries its own dependency table — web has no `electron`, desktop has no
UI-framework dependency, server has only its agent engine.

### `apps/web/src/` — the 16 source directories

The web app collapses what used to be 55 flat directories into 16. Kernel
domain names stay visible at the top; features live under one roof; families
merge.

```
api/        public plugin facade (PublicApi, PluginApiFacade) — the community-plugin surface
app/        App service locator + composition root; app family (commands, protocol, hotkeys, menus, diagnostics, starter, theme, release)
builtin/    feature roof — one core plugin per slice (see below)
core/       foundation primitives: Component, Events, fuzzy match, Version (utils absorbed here)
dom/        DOM helpers, clipboard, active-document tracking
editor/     CodeMirror wrappers: Editor, EditorView, extensions, decorations
markdown/   markdown parse + render pipeline and the post-processor registry
metadata/   kernel — metadata cache, link graph, tags, frontmatter, block cache
platform/   platform family (platform + native + shell + window + desktop + mobile): env detection + node/electron bridges
plugin/     plugin runtime — manager, loader, manifest, security, marketplace, internal + community machinery
search/     global search engine over notes and code
storage/    kernel — app config, JSON stores, secret storage (behind the JSON-store adapter seam)
styles/     CSS layers: tokens, base, components, product, features, workspace, editor, reveal, vendor
ui/         ui family (ui + drag + hover + suggest): Modal, Menu, Notice, Setting, Icon, Popover primitives
vault/      kernel — Vault, the DataAdapter/FileSystemAdapter seam, TAbstractFile, file watcher
views/      view layer + views family (workspace + properties): ItemView, MarkdownView, FileView, WorkspaceLeaf/Split
```

`builtin/` is the feature roof (VS Code `contrib` pattern). The smaller core
plugins and their setting tabs sit as loose files (Bookmarks, DailyNotes,
QuickSwitcher, FileExplorerView, …); the larger ones each own a subdirectory:
`agent/`, `canvas/`, `cli/`, `file-recovery/`, `git/`, `github/`, `graph/`,
`terminal/`, `theme-market/`, `webviewer/`. Each slice holds exactly one core
plugin, reuniting the view and logic halves that used to live apart.

**UI paradigm.** Product UI is vanilla TypeScript with direct DOM ownership.
Code under `apps/**` and `tests/**` must not import React, React DOM, or the
`@pierre/diffs/react` wrapper, and the web dependency table must not contain
React or moment. `tests/architecture.test.ts` enforces both rules.

## Runtime topology

Three processes, one product:

- **desktop** (`@app/desktop`) is the Electron shell. The **main process**
  (`main.ts`) runs with full node privileges and is the composition root:
  single-instance lock, `obsidian.json` settings + vault registry,
  vault-window lifecycle, the `app://` file protocol, the IPC table, and
  `workbench://` URL routing. The **preload** bridge installs the exact
  `window.electron` globals the product probes for.
- **web** (`@app/web`) is the product — DOM, CodeMirror, the whole Obsidian-
  shaped UI. The shell loads it into a `BrowserWindow` with
  `contextIsolation:false` + `nodeIntegration:true`, so browser technology gets
  **node powers via the shell**: the renderer can touch the filesystem directly.
- **server** (`@app/server`) is the agent sidecar. The desktop main process
  spawns it opt-in (`LoomSidecar`, gated on `LOOM_SIDECAR_BIN`); it drives the
  external agent engine (pi) and answers the chat surface.

**IPC bridge.** The renderer never talks to node directly; it talks to the
preload globals. `window.electron.ipcRenderer.sendSync("vault")` returns the
open vault's path, `"trash"` moves a file to the OS trash, `"file-url"` /
`"set-menu"` / `"update-menu-items"` cover URLs and the native menu. Main
registers the answering handlers.

**VaultAdapter seam.** All disk access goes through the abstract `DataAdapter`
in `vault/`. `bootstrap.ts` picks the concrete backend at startup: under the
Electron shell it resolves the vault path over IPC and installs
`FileSystemAdapter` (direct node `fs`, made possible by the shell's
`nodeIntegration`); in a plain browser (no `window.electron`) the App keeps its
default in-memory adapter, and tests inject a fake through the same seam. This
is what lets the product boot headless in a browser or a test with no Electron
underneath.

## Direction table (normative)

The layering rule the whole structure exists to protect. A vitest architecture
test asserts it — it walks every relative import and fails on any edge that
breaks a row. Physical package walls exist only between the three app packages
(pnpm workspace deps); everything below is enforced *inside* `web`.

| Layer | May import | Must NOT import |
|-------|-----------|-----------------|
| **kernel** — `vault/`, `metadata/`, `storage/` | kernel + `core/` + `dom/` + `platform/` only | anything above itself (app, views, ui, builtin, plugin, …) |
| **`api/`** (public facade) | internal modules (it wraps them) | — |
| everything **outside `api/`** | internal modules | `api/` — no internal module may import the facade |
| **runtime lanes** | own lane's deps | web ⇸ electron; desktop ⇸ UI framework; root ⇸ any runtime dep |

**Dual-track plugin architecture** (faithful to Obsidian). There are two tracks
into the same engine, by design:

- *Internal track* — `builtin/` slices and other internals call internal APIs
  directly. This is intentional, not debt.
- *Public track* — `api/` (`PublicApi`, `PluginApiFacade`) is the frozen
  surface for **community plugins only**. Because it exists solely for outside
  code, nothing inside the app may import it — the direction table's third row.

**builtin roof** — each `builtin/` slice holds exactly one core plugin, so the
feature boundary is the directory boundary.

## Known tradeoffs

**Disk stays in the renderer.** `FileSystemAdapter` calls node `fs` straight
from the web process instead of routing every read and write over IPC to main.
The IPC route was measured and rejected: keeping disk in-renderer holds
`openFile` at a 32ms median on the 20k-file vault (`PERF_VAULT` harness), and
per-call IPC round-trips regressed that past the budget. The cost is that the
product process is trusted with `nodeIntegration`.

**Kernel is a directory, not a package.** `vault`/`metadata`/`storage` are
guarded by the direction table but not physically walled into their own
package. A package boundary with a single consumer is ceremony; the kernel
graduates to a real package the moment a *second* consumer appears, and the
direction test already keeps its imports clean for that day.

**No shared package.** Desktop imports its two shared items — `SystemMenuItem`
and `URL_SCHEME` — directly from `@app/web` rather than from a `shared`
package. A protocol package graduates only once there are **two or more**
protocol consumers; below that threshold it is one indirection for no payoff.

**Builtin graduation ladder.** Builtins ride the internal track today. The
intended future path is a three-rung ladder: internal track → rewritten onto
`PublicApi` (dogfooding the public surface) → extracted into a real package.
These are documented goals, not executed work — the code stays on rung one.

**Desktop bundle resolves its own lane.** The desktop main bundle is emitted
to `out/desktop/` — the single generated-artifacts roof, where the web bundle
sits at the sibling `out/web` (main resolves it relatively, the electron-vite
geometry) — which sits outside the desktop package's own `node_modules`. Ordinary npm dependencies
of `@app/desktop` (e.g. `@electron/remote`) are therefore *bundled* rather
than externalized; only Electron itself, native modules (`node-pty`), and
Node builtins stay external.

**Tests are centralized, gates are total.** Unit tests live under `tests/`
(never next to source), mirroring source paths; `tests/` is its own workspace
member so its bare imports and `vi.mock` specifiers resolve in its own
dependency lane — a structural consequence of per-runtime dependency lanes.
Every root-level sibling of `src/` is covered by a named gate: `lint` sweeps
`src tests scripts` (e2e now lives inside tests/), `typecheck`/`typecheck:electron`/`typecheck:server`
cover the three runtimes, and `typecheck:tools` covers e2e specs, scripts,
examples, and the root config files themselves. `mise.toml` pins the
toolchain (plus `engines`/`packageManager` for non-mise users); `oxfmt` formats
`src tests scripts` (one-time reformat lives in `.git-blame-ignore-revs`);
hooks live in the tracked `.githooks/` (auto-armed via core.hooksPath by `prepare`) — the docwright pre-commit guard
and the commitlint commit-msg check. The IPC channel table and the public
plugin surface are frozen by budget alarms.
