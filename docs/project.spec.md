spec: project
name: "project constitution"
tags: [constitution, project]
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Project-level invariants that every goal contract inherits. This repository is
**one Electron app in one package** — a thin native shell (main + preload) over
a browser-hosted product (renderer), with the native-seam port contracts in a
shared lane — reconstructing a local-first notes workbench. The constitution
fixes the toolchain, the fail-fast contract, the perf budget, and the layering
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

- One app, one package: the repo root is the single application package; its
  `src/` tree splits by runtime lane — `main` (Electron main), `preload`
  (the bridge), `renderer` (the product) — with the native-seam port contracts
  in `shared` and ambient declarations in `types`. `tests/` is the one
  remaining pnpm workspace member (its own bare-import lane).
- The native seam is ports-and-adapters: the shell fills the ports the renderer
  declares; the renderer never imports `src/main`, `src/preload` or `electron`.
  The port CONTRACTS (`dataAdapter`, `gitApi`, `terminalApi`, the IPC channel
  table) live once in `src/shared`, imported by both sides — plain TS
  interfaces, no zod/presenter/route layer, no UI framework.
- Dual-track plugin architecture: `builtin/` is the internal track and may use
  internal APIs; `api/` is the community track; no internal module imports `api/`.
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only from
  the kernel, `core`, `dom`, and `platform` — never upward.
- Disk access stays in-process behind the `DataAdapter` seam in the renderer
  (the perf red line) — never routed over IPC or a kernel.
- Unit tests are centralized under `tests/` (workspace member), mirroring
  source paths; no test file lives next to source.
- The docs household is docwright goals under
  `docs/{features,issues,architecture}` plus promoted capabilities in
  `docs/capabilities/`.

<!-- lint-ack: error-path — constitution invariants are standing structural
     assertions; their failure mode IS the assertion failing, and three of
     the bound checkers carry their own synthetic-violation tests in
     tests/architecture.test.ts -->

## Completion Criteria

Scenario: the source tree is a single package
  Test: declares a single-package src layout
  Given the workspace configuration and the source tree
  When the workspace packages and top-level src directories are read
  Then no apps package remains and src holds main, preload, renderer, shared and types

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
  When they are scanned for product-name literals
  Then zero matches are found
