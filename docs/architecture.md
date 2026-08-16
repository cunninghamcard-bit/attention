# Architecture

This document governs `apps/**` and `packages/**`. The architecture tests under
`tests/architecture.test.ts` enforce the directory layout and import walls in
CI; keep this document and those executable constraints in step with the code.

Attention is a clean-room, runnable reconstruction of Obsidian's frontend
architecture, grown into an agent workspace. It is a **monorepo for a
web + desktop product**: the web product package, the desktop shell package,
and the shared contract lanes between them. The
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
| Renderer | `apps/web` | 461 | The product — the faithful Obsidian reconstruction |
| Shell | `apps/desktop` | 31 | Electron main + preload |
| Contracts | `packages/shared`, `packages/sdk` | 12 | The typed seam between the two above |
| Tests | `tests/**` | 230 | web / desktop / e2e / architecture |

## Directory map

### `apps/web` — the renderer

```
apps/web/
├── builtin/      131  feature slices (git, chat, terminal, search, …)
├── app/           66  composition root, workspace, settings surface
├── styles/        57  faithful extracts + own component CSS + deviations/
├── views/         50  view classes seated in the workspace
├── ui/            27  the shared primitives — TreeItem, Setting, Notice, Modal
├── platform/      23  platform capabilities behind interfaces
├── plugin/        21  plugin runtime (internal track)
├── markdown/      17  markdown pipeline
├── mount/          3  the multi-root workspace router
├── metadata/      13  the metadata cache          ┐
├── vault/          7  the vault                    │ kernel lane —
├── storage/        6  persistence                  │ imports nothing
├── core/           8  core primitives              │ above itself
├── dom/            5  DOM helpers                  ┘
├── editor/         8  editor integration
├── search/         3  search
├── api/            4  the public facade — community plugins only
└── public/         2
```

### `apps/desktop` — the shell

```
apps/desktop/
├── main/     27  Electron main: composition root, windows, app:// protocol,
│                 IPC table, native bridges (git, terminal, dialog, net, menu),
│                 CLI socket server
└── preload/   4  the preload bridge — installs the globals the renderer probes
```

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
  `Home` (an in-memory root, always present) plus any number of
  repositories, which git owns.
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
  repository owning the active file).

## Enforced rules

`tests/architecture.test.ts` (866 lines) fails CI on any of these:

| Rule | Asserts |
|---|---|
| `monorepo-shape` | the three lanes exist; renderer free of shell imports |
| `shell-wall` | shell free of renderer source; both sides import wire contracts from `@app/shared` |
| `shared-contracts` | native port contracts declared in shared; no zod presenters or UI frameworks in the dependency table |
| `perf-red-line` | vault reads stay in-process |
| `kernel-seam` | the vacant `packages/sdk` seat carries no source |
| `history` | the relocated lanes keep reachable history, blame honest |
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
| Tests | `vitest run` | all |
| E2E | `playwright` | web |

Full chain: `mise run lint && mise run typecheck && mise run test`.
