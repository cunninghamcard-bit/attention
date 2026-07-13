<!-- docwright:governs: src/** -->

# Architecture

This document governs `src/**`. `docwright guard` flags it as drift when the
directory tree, the runtime split, or the import rules below stop matching the
code — keep the doc and the tree in step or the guard goes red.

This workbench is a clean-room, runnable reconstruction of Obsidian's frontend
architecture, grown into an agent workspace. It is **one Electron app, one
package** — not a monorepo. The application is deliberately name-agnostic: no
product name appears in the tree, only in the git remote.

## Directory tree

```
.
├── src/                the single application package, split by runtime lane
│   ├── main/               Electron main process: composition root, windows,
│   │                       app:// protocol, IPC table, native bridges (git,
│   │                       terminal, dialog, net, menu), CLI socket server
│   ├── preload/            the preload bridge — installs the exact globals the
│   │                       renderer probes (window.electron, electronGit, …)
│   ├── renderer/           the product — the faithful Obsidian reconstruction;
│   │                       browser tech with node powers under the shell
│   ├── shared/             the native-seam port CONTRACTS, one definition each:
│   │                       gitApi, terminalApi, dataAdapter, ipc (channel
│   │                       table), kernelApi (reserved) — imported by BOTH
│   │                       main and renderer, never re-declared per side
│   ├── types/              ambient declarations (css modules, node __dirname)
│   └── renderer/{index,starter}.html + public/   the vite root's entry pages and
│                       static assets, served via the app:// protocol
├── tests/              ALL unit tests, centralized (workspace member @app/tests):
│   ├── web/             mirrors src/renderer/** — imports via @web/*
│   ├── desktop/         mirrors src/main + src/preload — @desktop/*, @preload/*
│   ├── e2e/             Playwright end-to-end + the large-vault perf harness (PERF_VAULT)
│   ├── architecture.test.ts   the architecture alarms (layout/walls/ports/freeze)
│   └── package.json     declares the bare deps tests need (own pnpm lane)
├── docs/               this file, the project constitution, and SDD goal folders
├── out/                build outputs, one roof — out/{web,desktop,api,types}
│                       (deliverables; the electron-vite geometry) — gitignored
├── reports/            test observability, one roof — coverage + playwright
├── .githooks/          tracked git hooks (pre-commit guard + commit-msg lint)
├── .github/            CI: the full local gate battery on push/PR
├── scripts/            build/e2e helper scripts (dts fixup, CLI e2e driver)
├── patches/            pnpm dependency patches (ghostty-web)
└── decode-obsidian/    read-only reference symlink to Obsidian's source (never edited)
```

The root `package.json` is the **single app package** (not a workspace yard):
it carries the whole runtime dependency table — the renderer's browser stack
(codemirror, @pierre/\*, ghostty-web, yaml, stream-markdown-parser) and the
shell's node stack (electron, @electron/remote, node-pty) — plus the dev
tooling. `tests/` stays a workspace member with its own bare-import lane.

### `src/renderer/` — the 16 source directories

The renderer collapses what used to be 55 flat directories into 16. Kernel
domain names stay visible at the top; features live under one roof; families
merge. (`public/` sits alongside as static assets served verbatim, not a
source directory.)

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
Code under `src/**` and `tests/**` must not import React, React DOM, or the
`@pierre/diffs/react` wrapper, and the dependency table must not contain
React, Vue or a zod presenter layer. `tests/architecture.test.ts` enforces both.
Local Git diffs use Pierre custom elements through their public CSS-variable
contract: host styles bridge Obsidian semantic tokens into the shadow root,
and mounted diff instances refresh their light/dark syntax mode on the
workspace `css-change` event.

## Runtime topology

One product, three runtime lanes inside one package:

- **main** (`src/main`) is the Electron main process — full node privileges,
  the composition root: single-instance lock, `obsidian.json` settings + vault
  registry, vault-window lifecycle, the `app://` file protocol, the IPC table,
  `workbench://` URL routing, and the CLI socket server.
- **preload** (`src/preload`) installs the exact globals the product probes
  for — `window.electron` (ipcRenderer/shell/webUtils), `electronWindow`, and
  the `electronGit` / `electronTerminal` bridges.
- **renderer** (`src/renderer`) is the product — DOM, CodeMirror, the whole
  Obsidian-shaped UI. The shell loads it into a `BrowserWindow` with
  `contextIsolation:false` + `nodeIntegration:true`, so browser technology gets
  **node powers via the shell**: the renderer touches the filesystem directly.

The main bundle emits to `out/desktop/main.cjs`; the renderer to the sibling
`out/web`, which main serves over `app://` (`join(here, "..", "web")`). The
renderer never imports the shell; the shell fills the renderer's ports.

## Native seam — one typed contract (`src/shared`)

The renderer↔shell seam is ports-and-adapters, and the port CONTRACTS live once
in `src/shared`, imported by both sides instead of duck-typed twice:

- **`dataAdapter`** — the vault filesystem port. Satisfied IN-PROCESS in the
  renderer (`FileSystemAdapter`, node `fs`), the perf red line; never routed
  over IPC or the kernel. `bootstrap.ts` picks the backend at startup
  (`provideAppAdapter`): under the shell it installs `FileSystemAdapter`, in a
  plain browser it keeps the in-memory adapter, and tests inject a fake through
  the same seam — which is what lets the product boot headless.
- **`gitApi` / `terminalApi`** — git and PTY bridges. The renderer's
  `GitService` / `DesktopTerminalAdapter` consume the port; the preload
  (`git-bridge`, `terminal-bridge`) fills it. Both sides import the one
  interface from `src/shared`.
- **`ipc`** — the typed IPC channel table (channel name → request/response).
  Main's handler map and the renderer's callers both reference it, so channel
  names are one source of truth. Plain TS types, no zod and no runtime
  validation: the seam is a trusted, small, in-process surface.
- **`kernelApi`** — a RESERVED port for a future external agent kernel (a
  spawned Go binary gated on a `*_BIN` env var, outside the JS build, never a
  workspace member). Interface only: nothing implements it, nothing provides
  it, default-absent. RED LINE: the kernel owns the agent backend (and, in
  cloud, DB-as-truth) — never the local vault fs, never block rendering; the
  renderer's markdown/render modules do not import it.

## Direction table (normative)

The layering rule the whole structure exists to protect. A vitest architecture
test asserts it — it walks every relative import and fails on any edge that
breaks a row.

| Layer | May import | Must NOT import |
|-------|-----------|-----------------|
| **renderer** (`src/renderer`) | own lane + `src/shared` | `src/main`, `src/preload`, the `electron` module |
| **main** (`src/main`) | own lane + `src/shared` + renderer contracts | a UI-framework dependency |
| **kernel** — `vault/`, `metadata/`, `storage/` | kernel + `core/` + `dom/` + `platform/` only | anything above itself (app, views, ui, builtin, plugin, …) |
| **`api/`** (public facade) | internal modules (it wraps them) | — |
| everything **outside `api/`** | internal modules | `api/` — no internal module may import the facade |

**Dual-track plugin architecture** (faithful to Obsidian). Two tracks into the
same engine, by design:

- *Internal track* — `builtin/` slices and other internals call internal APIs
  directly. This is intentional, not debt.
- *Public track* — `api/` (`PublicApi`, `PluginApiFacade`) is the frozen
  surface for **community plugins only**. Because it exists solely for outside
  code, nothing inside the app may import it — the direction table's row.

**builtin roof** — each `builtin/` slice holds exactly one core plugin, so the
feature boundary is the directory boundary.

## Known tradeoffs

**Disk stays in the renderer.** `FileSystemAdapter` calls node `fs` straight
from the renderer instead of routing every read and write over IPC to main.
The IPC route was measured and rejected: keeping disk in-renderer holds
`openFile` under the 50ms budget on the 20k-file vault (`PERF_VAULT` harness),
and per-call IPC round-trips regressed past it. The cost is that the renderer
is trusted with `nodeIntegration`.

**Kernel is a directory, not a package.** `vault`/`metadata`/`storage` are
guarded by the direction table but not physically walled into their own
package. A package boundary with a single consumer is ceremony; the kernel
graduates to a real package the moment a *second* consumer appears, and the
direction test already keeps its imports clean for that day.

**Ports are contracts, not a presenter framework.** `src/shared` holds plain TS
interfaces and a channel-name table — deliberately not a zod/route/presenter
layer. That machinery polices an untrusted, secret-holding sandbox we do not
have; our trusted small-surface seam needs only typed interfaces.

**The kernel port is reserved, not built.** `kernelApi` seats a future Go agent
kernel without building it. When it lands it is an external spawned binary
(SiYuan-style transport: child process on a negotiated port, `HTTP
/api/<domain>/<action>` + one multiplexed WS push, `{code,msg,data}` envelope),
never a workspace member — and never the owner of the local vault fs or block
rendering.

**Tests are centralized, gates are total.** Unit tests live under `tests/`
(never next to source), mirroring source paths; `tests/` is its own workspace
member so its bare imports and `vi.mock` specifiers resolve in their own
dependency lane. `lint`/`format` sweep `src tests scripts`; `typecheck` covers
the renderer + shared, `typecheck:electron` the main/preload shell, and
`typecheck:tools` the e2e specs, scripts and root config files. `mise.toml`
pins the toolchain; hooks live in the tracked `.githooks/`. The IPC channel
table and the public plugin surface are frozen by budget alarms.
