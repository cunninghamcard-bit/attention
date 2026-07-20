spec: project
name: "project constitution"
tags: [constitution, project]
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Project-level invariants that every goal contract inherits. This repository is
a **monorepo for a server + web + desktop product**: the web product
(`apps/web`, the faithful Obsidian-reconstruction renderer), the desktop
shell (`apps/desktop`, Electron main + preload), the shared lanes
(`packages/shared` contracts, `packages/sdk` an empty seat for the future
kernel client), and the Go agent kernel at the repo root (`cmd/`, `internal/`
— a spawned binary, never a pnpm workspace member). The constitution fixes
the toolchain, the fail-fast contract, the perf budget, and the layering
walls once, so individual goals never re-litigate them.

## Constraints

### Must
- pnpm is the only package manager; a preinstall hook rejects npm and yarn.
- Fail fast on product paths: a missing configuration raises an explicit
  error naming the missing key and how to set it — never a silent fallback.
- The full vitest suite is green before any merge.
- Keep the perf budget on the 20k-file vault: openFile median under 50ms
  and explorerClick median under 120ms, measured by the PERF_VAULT harness.
- Code stays name-agnostic: no product-name literal appears anywhere in the
  tree — package name, URL scheme, env vars, titles, docs — the product
  identity lives only in the git remote.

### Must Not
- Do not add a production dependency without a goal contract that adopts it.
- Do not weaken, skip, or delete an existing test to make a gate pass.
- Do not source a default from anywhere but the user's explicit configuration.

## Decisions

- One repo, lanes: `apps/web` is the product package (`@app/web`);
  `apps/desktop` is the shell package (`@app/desktop`) and loads the web
  build output; `packages/shared` (`@app/shared`) holds the native-seam port
  CONTRACTS once — `dataAdapter`, `gitApi`, `terminalApi`, the IPC channel
  table — imported by both app lanes, never re-declared per side;
  `packages/sdk` (`@app/sdk`) is an empty manifest seat. `tests/` is the
  centralized test lane (`@app/tests`). The Go kernel lives at the repo root
  with its own go.mod, merged with its history, and is NOT a workspace
  member.
- The native seam is ports-and-adapters: the shell fills the ports the
  renderer declares; the renderer never imports `apps/desktop` or `electron`.
  Plain TS interfaces, no zod/presenter/route layer, no UI framework.
- Dual-track plugin architecture: `builtin/` is the internal track and may use
  internal APIs; `api/` is the community track; no internal module imports
  `api/`.
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only
  from the kernel, `core`, `dom`, and `platform` — never upward.
- Disk access stays in-process behind the `DataAdapter` seam in the renderer
  (the perf red line) — never routed over IPC or the kernel. The kernel owns
  the agent backend (and, in cloud, DB-as-truth) — NEVER the local vault fs,
  NEVER block rendering.
- Unit tests are centralized under `tests/` (workspace member), mirroring
  source paths; no test file lives next to source.
- The docs household is docwright goals under
  `docs/{features,issues,architecture}` plus promoted capabilities in
  `docs/capabilities/`; the kernel keeps its own `specs/` household at the
  root until a later contract consolidates them.

<!-- lint-ack: error-path — constitution invariants are standing structural
     assertions; their failure mode IS the assertion failing, and the bound
     checkers carry their own synthetic-violation tests in
     tests/architecture.test.ts -->

## Completion Criteria

Scenario: the workspace is a monorepo with the kernel seated at the root
  Test: declares the monorepo layout with the kernel seated
  Given the workspace configuration and the source tree
  When the workspace packages and top-level directories are read
  Then apps/desktop, apps/web, packages/shared and packages/sdk are workspace
  packages alongside tests, no top-level src remains, and cmd, internal and
  go.mod sit at the repo root

Scenario: the dependency table stays framework-free
  Test: keeps zod presenters and UI frameworks out of the dependency table
  Given package.json and the tests lane manifest
  When their dependency tables are inspected
  Then zod, react, react-dom and vue appear in none of them

Scenario: the kernel stays headless-ready
  Test: kernel directories import nothing above the kernel
  Given the vault, metadata and storage directories
  When every relative import in them is resolved
  Then no import target lies outside the kernel, core, dom or platform

Scenario: the public facade serves only community plugins
  Test: internal code never imports the public api facade
  Given all renderer sources outside api/
  When their imports are resolved
  Then none of them imports from api/

Scenario: the tree stays name-agnostic
  Test: no retired product-name literals remain in code
  Given all code directories and root config files
  When they are scanned for retired product-name literals
  Then zero matches are found
