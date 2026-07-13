spec: task
name: "single package shell"
inherits: project
tags: [architecture, layout]
estimate: 2d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Collapse the two-package pnpm workspace (`apps/desktop`, `apps/web`) into ONE
package with the conventional electron layout `src/{main, preload, renderer,
shared, types}`, and formalize the renderer↔shell native seam by lifting its
port contracts into `src/shared`. It is one Electron app, not a monorepo. This
is structure-and-contract only: no renderer logic changes, the Obsidian
reconstruction moves wholesale and untouched, and the in-process-node vault
read path (the perf red line) is preserved. A reserved, unimplemented
`KernelApi` port seats the future Go agent kernel without building it now.

## Current State

Two pnpm packages: `apps/desktop` (electron main + preload + native bridges:
git, terminal, dialog, window, menu, protocol, net) and `apps/web` (the
faithful Obsidian reconstruction — a fat, node-privileged renderer). The
renderer never imports the shell; the shell imports the renderer and fills the
ports. The native seam is ports-and-adapters but INFORMAL: the renderer reads
injected globals (`electronGit`, `electronTerminal`, `window.electron`) and the
port interfaces (`ElectronGitApi`, `ElectronTerminalApi`) are duplicated —
declared on the web side and re-declared on the desktop side — agreeing only by
convention. The graduated `project-layout-consolidation` contract still
describes the (now two-package, post-agent-purge) monorepo, and
`docs/architecture.md` still describes three packages plus the removed
`apps/server`.

## Decisions

- Single package, electron-vite convention: `src/{main, preload, renderer,
  shared, types}`. Mapping: `apps/desktop/*.ts` (main + windows + protocol +
  ipc + bridges) → `src/main/`; `apps/desktop/preload.ts` → `src/preload/`;
  `apps/web/src/*` → `src/renderer/*`. The pnpm workspace drops to one package
  (records 0001, 0002).
- The renderer moves WHOLESALE and unchanged: its 16 internal directories keep
  their structure and relative imports; its own `ui/` primitive layer stays
  INSIDE the renderer as `src/renderer/ui` (our vanilla, framework-free design
  system — not top-levelled, no vendored component library, since a top-level
  `src/shadcn`-style dir is only for vendored external code, of which we have
  none). The contribution model is unchanged and correct: `builtin/` (one core
  plugin per slice), the dual-track plugin API, `App` as the hub.
- The native seam stays ports-and-adapters: the shell implements the ports the
  renderer declares; the renderer never imports `src/main` or electron. The
  `DataAdapter` (vault fs) is implemented IN-PROCESS with node fs — the perf
  red line; git/terminal/menu/net/foundation cross to main over the existing
  thin IPC bridges.
- Port CONTRACTS lift into `src/shared`: a typed IPC channel table (channel
  name → request/response types), the `DataAdapter` interface, and the
  `ElectronGitApi` / `ElectronTerminalApi` interfaces — plain TS, one
  definition each, imported by BOTH `src/main` and `src/renderer` so the two
  sides compile against one contract instead of duck-typed globals. No zod, no
  route registry, no presenter classes: the DeepChat presenter/route/zod layer
  is DROPPED — it polices an untrusted, secret-holding, dozens-of-capability
  sandbox we do not have; our trusted small-surface seam needs only typed
  interfaces (record 0002).
- A `KernelApi` port is RESERVED in `src/shared`: interface only, no
  implementation, default-absent, selected at bootstrap exactly like
  `DataAdapter` (`provideAppAdapter` pattern). The future Go agent kernel is an
  external spawned binary OUTSIDE the JS build (like the removed LoomSidecar,
  gated on a `*_BIN` env var), never a workspace member; when built it copies
  SiYuan's transport (spawned child on a negotiated port, one `HTTP
  /api/<domain>/<action>` + one multiplexed WS push, uniform `{code,msg,data}`
  envelope), not SiYuan's kernel-owns-vault model.
- RED LINE: markdown / block rendering stays in the node-privileged renderer in
  ALL forms (desktop and cloud). The future kernel owns the AGENT backend and
  (in cloud) DB-as-truth — NEVER the local vault fs, NEVER block rendering.
  This is the load-bearing divergence from SiYuan and is enforced: renderer
  markdown/render modules do not import the kernel port.
- `tests/architecture.test.ts` runtime-walls rewrite from "app packages" to
  `src/{main, preload, renderer}` directory lanes (renderer imports no electron
  and no `src/main`; main declares no UI-framework dependency). The direction
  table inside the renderer (kernel/api/facade rows) is unchanged.
  `docs/architecture.md` is rewritten to the single-package reality; the
  graduated `project-layout-consolidation` contract is superseded and retired.
- No behavior change, no new production dependency, no UI framework
  (React/Vue) reintroduced; code stays name-agnostic (no product-name literal).

<!-- lint-ack: decision-coverage — the wholesale-move, contribution-model, docs-rewrite and retire-old-contract decisions are structural/mechanical, verified by the move-preserving suite plus guard, not by report-mode selectors -->
<!-- lint-ack: platform-decision-tag — electron-vite and pnpm mentions are this app's own toolchain, not a parity reference -->
<!-- lint-ack: error-path — a structure-only refactor has no runtime error path; the critical "renderer never imports the shell" and "kernel reserved not built" walls ARE the regression-failure guards -->


## Boundaries

### Allowed Changes

- src/**
- apps/**
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- tsconfig.json
- tsconfig.tools.json
- vitest.config.ts
- tests/**
- docs/**
- mise.toml
- index.html
- starter.html

### Forbidden

- Do not change renderer LOGIC: the move is git-mv plus import-path and
  wiring fixes only, not a rewrite of the Obsidian reconstruction.
- Do not move the vault fs read/write path behind IPC or the kernel — it
  stays in-process node (the perf red line).
- Do not add zod, a presenter/route registry, or any UI framework; do not
  vendor a component library.
- Do not weaken, skip or delete existing tests to make a gate pass.
- Do not implement the KernelApi or spawn any kernel — reserve the interface
  only.

## Completion Criteria

### Rule: single-package — one app, one package

Scenario: the workspace is a single package (critical)
  Test: declares a single-package src layout
  Given pnpm-workspace.yaml and the source tree
  When the workspace packages and top-level src directories are read
  Then no apps package remains and src holds main, preload, renderer, shared and types

Scenario: the renderer never imports the shell (critical)
  Test: keeps the renderer free of shell imports
  Given every import statement under src/renderer
  When their targets are resolved
  Then none resolves into src/main, src/preload or the electron module

### Rule: shared-contracts — the native seam is one typed contract

Scenario: the native port contracts live in shared
  Test: declares the native port contracts in shared
  Given src/shared
  When it is inspected
  Then it declares the DataAdapter, ElectronGitApi and ElectronTerminalApi
  interfaces and a typed IPC channel table

Scenario: both sides compile against the shared contracts
  Test: imports the shared contracts from both main and renderer
  Given the native-seam callers in src/renderer and the handlers in src/main
  When their imports are resolved
  Then both sides import the port interfaces from src/shared, not a local copy

Scenario: no presenter or framework machinery is introduced
  Test: keeps zod presenters and UI frameworks out of the dependency table
  Given package.json
  When its dependency tables are read
  Then zod, react, react-dom and vue appear in none of them

### Rule: perf-red-line — vault reads stay in-process

Scenario: vault open stays within budget (critical)
  Review: human
  Test: keeps vault reads in-process (the perf red line)
  Given the 20k-file perf vault
  When a file is opened repeatedly through the in-process fs adapter
  Then the openFile median stays under 50ms — the machine check guards the
  in-process fs seam; the median itself is the e2e:perf gate (human sign-off)

### Rule: kernel-seam — reserved, not built

Scenario: the kernel port is reserved but unimplemented
  Test: reserves the kernel port without an implementation
  Given src/shared and the workspace
  When the KernelApi port is inspected
  Then it is an interface with no implementation, absent by default, and no
  kernel binary is a workspace member

Scenario: block rendering never depends on the kernel port
  Test: keeps renderer rendering free of the kernel port
  Given the renderer markdown and block-render modules
  When their imports are resolved
  Then none imports the KernelApi port

## Out of Scope

- Building the Go kernel, its transport, or any agent backend — the KernelApi
  interface is reserved only.
- The cloud / web deployment form and its origin and auth model.
- Any change to renderer behavior or the Obsidian reconstruction internals.

## Open Questions

None.
