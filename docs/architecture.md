# Architecture

This document governs `apps/**`, `packages/**`, and the Go kernel lanes
`cmd/**` + `internal/**`. The architecture tests under
`tests/architecture.test.ts` enforce the directory layout and import walls in
CI; keep this document and those executable constraints in step with the code.

Attention is a clean-room, runnable reconstruction of Obsidian's frontend
architecture, grown into an agent workspace. It is a **monorepo for a
server + web + desktop product**: the web product package, the desktop shell
package, shared contract lanes, and the Go agent kernel at the repo root. The
application is deliberately name-agnostic: no product name appears in the
tree, only in the git remote.

The governing rules for how code is written — reconstruct Obsidian rather than
invent a parallel system, one shared primitive per protocol, faithful style
layers stay byte-identical — live in `CLAUDE.md` / `AGENTS.md`. This document
covers where code lives and what it may import.

## Lanes

Three lanes, one repo. Each row is a real directory with its current file
count.

| Lane | Path | Files | What it is |
|---|---|---|---|
| Renderer | `apps/web` | 415 | The product — the faithful Obsidian reconstruction |
| Shell | `apps/desktop` | 32 | Electron main + preload |
| Contracts | `packages/shared`, `packages/sdk` | 10 | The typed seam between the two above |
| Kernel | `internal/**`, `cmd/**` | 204 | The Go agent kernel |
| Tests | `tests/**` | 212 | web / desktop / e2e / architecture |

## Directory map

### `apps/web` — the renderer

```
apps/web/
├── builtin/      121  feature slices (git, chat, terminal, search, …)
├── styles/        59  faithful extracts + own component CSS + deviations/
├── app/           58  composition root, workspace, settings surface
├── views/         49  view classes seated in the workspace
├── ui/            22  the shared primitives — TreeItem, Setting, Notice, Modal
├── plugin/        19  plugin runtime (internal track)
├── platform/      17  platform capabilities behind interfaces
├── markdown/      15  markdown pipeline
├── sync/           8  the synced Home replica (loro docs + persistence)
├── mount/          3  the multi-root workspace router
├── metadata/      10  the metadata cache          ┐
├── vault/          7  the vault                    │ kernel lane —
├── storage/        5  persistence                  │ imports nothing
├── core/           7  core primitives              │ above itself
├── dom/            3  DOM helpers                  ┘
├── editor/         7  editor integration
├── search/         2  search
├── api/            3  the public facade — community plugins only
└── public/         1
```

### `apps/desktop` — the shell

```
apps/desktop/
├── main/     27  Electron main: composition root, windows, app:// protocol,
│                 IPC table, native bridges (git, terminal, dialog, net, menu),
│                 CLI socket server
└── preload/   4  the preload bridge — installs the globals the renderer probes
```

### Go kernel

```
internal/
├── ai/           48  provider adapters (anthropic, openai completions/
│                     responses/codex), oauth, retry, overflow, caching
├── tool/         29  builtin tools
├── orchestrator/ 14  turn orchestration
├── resource/     12
├── session/       9
├── execenv/       7
├── mode/          6   harness/ 6   plugin/ 5   hook/ 5
├── provider/      4   extension/ 4   config/ 4   auth/ 4
└── obs/ message/ agentloop/  3 each

cmd/
├── along/   8  the CLI
└── tui/    30  the terminal UI — a NESTED Go module (own go.mod)
```

> `cmd/tui` is a separate module. Root-level `go` commands do not descend into
> it. `mise run test:go` handles both (`go -C cmd/tui test ./...`);
> `mise run lint:go` currently does not.

## Direction table (normative)

The layering rule the whole structure exists to protect. A vitest
architecture test asserts it — it walks every relative import and fails on
any edge that breaks a row.

| Layer                                          | May import                                   | Must NOT import                                            |
| ---------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| **renderer** (`apps/web`)                      | own lane + `@app/shared`                     | `apps/desktop`, the `electron` module                      |
| **main** (`apps/desktop/main`)                 | own lane + `@app/shared`                     | `apps/web` source, a UI-framework dependency               |
| **kernel** — `vault/`, `metadata/`, `storage/` | kernel + `core/` + `dom/` + `platform/` only | anything above itself (app, views, ui, builtin, plugin, …) |
| **`api/`** (public facade)                     | internal modules (it wraps them)             | —                                                          |
| everything **outside `api/`**                  | internal modules                             | `api/` — no internal module may import the facade          |

**Dual-track plugin architecture** (faithful to Obsidian). Two tracks into
the same engine, by design:

- _Internal track_ — `builtin/` slices and other internals call internal APIs
  directly. This is intentional, not debt.
- _Public track_ — `api/` (`PublicApi`, `PluginApiFacade`) is the frozen
  surface for **community plugins only**. Because it exists solely for
  outside code, nothing inside the app may import it — the direction table's
  last row.

## Deviations from Obsidian, at the level of structure

Two, both product decisions rather than style choices, so they are recorded
here rather than under `styles/deviations/`:

- **One config home** — `.obsidian/` lives once under the app's data
  directory and nothing is ever written into an opened folder or mount
  (`docs/superpowers/specs/2026-07-27-single-config-home-design.md`).
- **A multi-root workspace, and it is the ONLY form** — Obsidian is one
  vault per window, with a registry of vaults, a switcher, per-vault window
  state, and vault-targeted CLI/URL routing. This app replaced that model
  wholesale: ONE workspace window mounts several roots into ONE namespace —
  `Home` (the synced replica where 产物 live, always present) plus any
  number of repositories, which git owns and sync never touches.
  `mount/MountAdapter` routes by the first path segment and re-emits child
  events under it, so everything above the adapter seam — Vault,
  MetadataCache, search, links, the file tree — keeps its single-namespace
  assumption, which is the faithful part. Roots join and leave without a
  reload (the VS Code shape). What the replacement deleted, deliberately:
  the vault registry (`obsidian.json`'s `vaults` key), `switchVault` and
  the vault-window map (one `WorkspaceWindow` keeps the faithful chrome,
  geometry under the fixed `workspace` key), the switcher surfaces
  (`app:switch-vault`, the sidedock vault menu — now the workspace menu),
  CLI `vault=` / cwd / most-recent routing, and `attention://` vault
  resolution (every action lands in THE window). The `vault` boot IPC
  answers `{ home, mounts? }` — config home plus the e2e mount seed —
  never a folder identity. Git and terminals resolve per MOUNT (the
  repository owning the active file). Recorded in
  `docs/superpowers/specs/2026-08-02-data-layer-server-design.md`.

## Enforced rules

`tests/architecture.test.ts` (843 lines) fails CI on any of these:

| Rule | Asserts |
|---|---|
| `monorepo-shape` | the three lanes exist, kernel seated; renderer free of shell imports |
| `shell-wall` | shell free of renderer source; both sides import wire contracts from `@app/shared` |
| `shared-contracts` | native port contracts declared in shared; no zod presenters or UI frameworks in the dependency table |
| `perf-red-line` | vault reads stay in-process |
| `kernel-seam` | the removed kernel port stays removed |
| `kernel-history` | the kernel subtree keeps reachable history, blame honest |
| `zero-react` | no react imports in source; react and moment out of the dependency table |
| `kernel-direction` | kernel directories import nothing above the kernel |
| `dual-track-api` | internal code never imports the public api facade |
| `architecture-docs` | this file and `project.spec.md` exist and declare their governed structure |
| `name-agnostic code` | no retired product-name literals in `apps` / `packages` / `tests` / `scripts` |

`tests/web/styles/StyleSystem.test.ts` (317 lines) additionally guards the
stylesheet layering: the exactly-once manifest, own-last import order, and the
restyle/token walls. Faithful extracts under
`styles/{tokens,base,components,features,workspace,editor}` must stay
byte-identical to `decode-obsidian/ref/obsidian/app.css`; deliberate
deviations live one-per-file under `styles/deviations/`.

## Gates

| Gate | Command | Covers |
|---|---|---|
| Format | `pnpm run format:check` | all |
| JS/TS lint | `oxlint --deny-warnings` | `apps packages tests scripts` |
| Typecheck | three `tsc` lanes | web, electron, tools |
| Go vet | `go vet ./...` | root module only — **not `cmd/tui`**, and no dead-code detection |
| Tests | `vitest run`, `go test ./...`, `go -C cmd/tui test ./...` | all |
| E2E | `playwright` | web |

Full chain: `mise run lint && mise run typecheck && mise run test && mise run test:go`.
