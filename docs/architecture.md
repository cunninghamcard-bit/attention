<!-- docwright:governs: apps/**, packages/**, cmd/**, internal/** -->

# Architecture

This document governs `apps/**`, `packages/**`, and the Go kernel lanes
`cmd/**` + `internal/**`. `docwright guard` flags it as drift when the
directory tree, the runtime split, or the import rules below stop matching
the code — keep the doc and the tree in step or the guard goes red.

This workbench is a clean-room, runnable reconstruction of Obsidian's frontend
architecture, grown into an agent workspace. It is a **monorepo for a
server + web + desktop product**: the web product package, the desktop shell
package, shared contract lanes, and the Go agent kernel at the repo root. The
application is deliberately name-agnostic: no product name appears in the
tree, only in the git remote.

## Directory tree

```
.
├── apps/
│   ├── web/              @app/web — the product: the faithful Obsidian
│   │                     reconstruction (browser tech with node powers), its
│   │                     vite root (index.html, starter.html, public/), the
│   │                     vite configs, and the public plugin API build
│   ├── desktop/          @app/desktop — the Electron shell: loads apps/web's
│   │   ├── main/           build output. Electron main process: composition
│   │   │                   root, windows, app:// protocol, IPC table, native
│   │   │                   bridges (git, terminal, dialog, net, menu), CLI
│   │   │                   socket server
│   │   └── preload/        the preload bridge — installs the exact globals the
│   │                       renderer probes (window.electron, electronGit, …)
├── packages/
│   ├── shared/           @app/shared — the native-seam port CONTRACTS, one
│   │                     definition each: gitApi, terminalApi, dataAdapter,
│   │                     ipc (channel table) — imported by BOTH app lanes,
│   │                     never re-declared per side; plus ambient types
│   ├── sdk/              @app/sdk — an EMPTY seat (manifest only) for the
│   │                     future kernel API client generated from the kernel
│   │                     OpenAPI contract; no runtime code, no dependencies
├── cmd/                  Go kernel binaries (along headless kernel, tui
│   └── tui/              client) — the agent kernel, merged with full history;
│                         cmd/tui is its own nested Go module
├── internal/             the Go kernel's engine packages (orchestrator,
│                         harness, hook, extension, tool, resource, session…)
├── extension/            the kernel's file plugins
├── specs/                the kernel's own spec household (docwright-style,
│                         kept as-is until a later contract consolidates)
├── go.mod / go.sum       the kernel's module — at the ROOT, never a pnpm
│                         workspace member
├── tests/                ALL unit tests, centralized (workspace member
│   │                     @app/tests):
│   ├── web/             mirrors apps/web/** — imports via @web/* aliases
│   ├── desktop/         mirrors apps/desktop/{main,preload} — @desktop/*,
│   │                    @preload/*
│   ├── e2e/             Playwright end-to-end + the large-vault perf harness
│   │                    (PERF_VAULT)
│   ├── architecture.test.ts   the architecture alarms (layout/walls/ports/
│   │                    freeze/history)
│   └── package.json     declares the bare deps tests need (own pnpm lane)
├── docs/                 this file, the project constitution, and SDD goal
│   │                     folders
├── out/                  build outputs, one roof — out/{web,desktop}
│                         (deliverables; the electron-vite geometry) — the
│                         public API bundle is package-local at
│                         apps/web/out/api — gitignored
├── reports/              test observability, one roof — coverage + playwright
├── .githooks/            tracked git hooks (pre-commit guard + commit-msg lint)
├── .github/              CI: the full local gate battery on push/PR
├── scripts/              build/e2e helper scripts (dts fixup, CLI e2e driver)
├── patches/              pnpm dependency patches (ghostty-web)
└── decode-obsidian/      read-only reference symlink to Obsidian's source
                          (never edited)
```

The root `package.json` is a **private orchestrator**: no runtime dependency
table of its own — the lanes carry their own (`@app/web` the browser stack:
codemirror, @pierre/\*, ghostty-web, yaml, stream-markdown-parser;
`@app/desktop` the node stack: electron, @electron/remote, node-pty,
font-list) — and keeps the familiar script names, forwarding into the lanes
via `pnpm --filter` so `mise.toml` tasks and muscle memory are unchanged.
`tests/` stays a workspace member with its own bare-import lane.

### `apps/web/` — the 16 source directories

The renderer collapses what used to be 55 flat directories into 16. Kernel
domain names stay visible at the top; features live under one roof; families
merge. (`public/` sits alongside as static assets served verbatim, not a
source directory; `node_modules/` and `out/` are tooling artifacts, also not
source directories.)

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
`canvas/`, `file-recovery/`, `git/`, `github/`, `graph/`, `terminal/`,
`theme-market/`, `webviewer/`. Each slice holds exactly one core plugin.

**UI paradigm.** Product UI is vanilla TypeScript with direct DOM ownership.
Code under `apps/**`, `packages/**` and `tests/**` must not import React,
React DOM, or the `@pierre/diffs/react` wrapper, and the dependency tables
must not contain React, Vue or a zod presenter layer.
`tests/architecture.test.ts` enforces both. Local Git diffs use Pierre custom
elements through their public CSS-variable contract: host styles bridge
Obsidian semantic tokens into the shadow root, and mounted diff instances
refresh their light/dark syntax mode on the workspace `css-change` event.

## Runtime topology

One product, three runtime lanes across two packages:

- **main** (`apps/desktop/main`) is the Electron main process — full node
  privileges, the composition root: single-instance lock, `obsidian.json`
  settings + vault registry, vault-window lifecycle, the `app://` file
  protocol, the IPC table, `workbench://` URL routing, and the CLI socket
  server.
- **preload** (`apps/desktop/preload`) installs the exact globals the product
  probes for — `window.electron` (ipcRenderer/shell/webUtils),
  `electronWindow`, and the `electronGit` / `electronTerminal` bridges.
- **renderer** (`apps/web`) is the product — DOM, CodeMirror, the whole
  Obsidian-shaped UI. The shell loads it into a `BrowserWindow` with
  `contextIsolation:false` + `nodeIntegration:true`, so browser technology
  gets **node powers via the shell**: the renderer touches the filesystem
  directly.

The main bundle emits to `out/desktop/main.cjs`; the renderer to the sibling
`out/web`, which main serves over `app://` (`join(here, "..", "web")`). The
renderer never imports the shell; the shell fills the renderer's ports.

## Native seam — one typed contract (`@app/shared`)

The renderer↔shell seam is ports-and-adapters, and the port CONTRACTS live
once in `packages/shared`, imported by both lanes instead of duck-typed
twice:

- **`dataAdapter`** — the vault filesystem port. Satisfied IN-PROCESS in the
  renderer (`FileSystemAdapter`, node `fs`), the perf red line; never routed
  over IPC or the kernel. `bootstrap.ts` picks the backend at startup
  (`provideAppAdapter`): under the shell it installs `FileSystemAdapter`, in a
  plain browser it keeps the in-memory adapter, and tests inject a fake
  through the same seam — which is what lets the product boot headless.
- **`gitApi` / `terminalApi`** — git and PTY bridges. The renderer's
  `GitService` / `DesktopTerminalAdapter` consume the port; the preload
  (`git-bridge`, `terminal-bridge`) fills it. Both sides import the one
  interface from `@app/shared`.
- **`ipc`** — the typed IPC channel table (channel name → request/response).
  Main's handler map and the renderer's callers both reference it, so channel
  names are one source of truth. Plain TS types, no zod and no runtime
  validation: the seam is a trusted, small, in-process surface.

The Go agent kernel sits at the repo root (`cmd/`, `internal/`, its own
go.mod) — merged from its repository with full history, NOT a workspace
member, NOT wired into the app: nothing spawns it, nothing imports it. Its
product-facing transport and the renderer's access path are decided for the
kernel-integration ticket (memoh-style: an Echo HTTP facade + one WebSocket
push channel, OpenAPI as the contract of record, `@app/sdk` generated from
it); the retired `KernelApi` port was deleted with this migration — a
hand-written second contract beside a generated client would drift. RED
LINE, unchanged: the kernel owns the agent backend (and, in cloud,
DB-as-truth) — never the local vault fs, never block rendering.

## Direction table (normative)

The layering rule the whole structure exists to protect. A vitest
architecture test asserts it — it walks every relative import and fails on
any edge that breaks a row.

| Layer                                          | May import                                    | Must NOT import                                            |
| ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| **renderer** (`apps/web`)                      | own lane + `@app/shared`                      | `apps/desktop`, the `electron` module                      |
| **main** (`apps/desktop/main`)                 | own lane + `@app/shared` + renderer contracts | a UI-framework dependency                                  |
| **kernel** — `vault/`, `metadata/`, `storage/` | kernel + `core/` + `dom/` + `platform/` only  | anything above itself (app, views, ui, builtin, plugin, …) |
| **`api/`** (public facade)                     | internal modules (it wraps them)              | —                                                          |
| everything **outside `api/`**                  | internal modules                              | `api/` — no internal module may import the facade          |

**Dual-track plugin architecture** (faithful to Obsidian). Two tracks into
the same engine, by design:

- _Internal track_ — `builtin/` slices and other internals call internal APIs
  directly. This is intentional, not debt.
- _Public track_ — `api/` (`PublicApi`, `PluginApiFacade`) is the frozen
  surface for **community plugins only**. Because it exists solely for
  outside code, nothing inside the app may import it — the direction table's
  row.

**builtin roof** — each `builtin/` slice holds exactly one core plugin, so
the feature boundary is the directory boundary.

## Known tradeoffs

**Disk stays in the renderer.** `FileSystemAdapter` calls node `fs` straight
from the renderer instead of routing every read and write over IPC to main.
The IPC route was measured and rejected: keeping disk in-renderer holds
`openFile` under the 50ms budget on the 20k-file vault (`PERF_VAULT`
harness), and per-call IPC round-trips regressed past it. The cost is that
the renderer is trusted with `nodeIntegration`.

**Kernel is a directory, not a package.** `vault`/`metadata`/`storage` are
guarded by the direction table but not physically walled into their own
package. A package boundary with a single consumer is ceremony; the kernel
graduates to a real package the moment a _second_ consumer appears, and the
direction test already keeps its imports clean for that day.

**Ports are contracts, not a presenter framework.** `@app/shared` holds plain
TS interfaces and a channel-name table — deliberately not a zod/route/
presenter layer. That machinery polices an untrusted, secret-holding sandbox
we do not have; our trusted small-surface seam needs only typed interfaces.

**The kernel is seated, not wired.** The Go agent kernel lives at the repo
root with its own module and its own spec household — present but dark:
nothing spawns it and no JS imports it. Seating it in-tree (history intact)
precedes wiring it; the wiring — transport, `@app/sdk` generation, capability
gating — is the kernel-integration ticket's scope, on owner-recorded
direction (memoh-style HTTP facade + WS, OpenAPI-generated client, the
retired hand-written `KernelApi` port never returns).

**Tests are centralized, gates are total.** Unit tests live under `tests/`
(never next to source), mirroring source paths; `tests/` is its own
workspace member so its bare imports and `vi.mock` specifiers resolve in
their own dependency lane. `lint`/`format` sweep `apps packages tests
scripts`; `typecheck` covers the renderer + shared, `typecheck:electron` the
main/preload shell, and `typecheck:tools` the e2e specs, scripts and root
config files. `mise.toml` pins the toolchain (node, pnpm, go) and the
gate runs the JS lane plus `kernel:test` (go test on both Go modules); hooks
live in the tracked `.githooks/`. The IPC channel table and the public
plugin surface are frozen by budget alarms.
