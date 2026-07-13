spec: project
name: "project constitution"
tags: [constitution, project]
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Project-level invariants that every goal contract inherits. This repository
is a three-runtime workspace — a thin desktop shell, a browser-hosted
product, and a headless server — over one reconstructed local-first notes
workbench. The constitution fixes the toolchain, the fail-fast contract,
the perf budget, and the layering walls once, so individual goals never
re-litigate them.

## Constraints

### Must
- pnpm is the only package manager; a preinstall hook rejects npm and yarn.
- Fail fast on product paths: a missing configuration raises an explicit
  error naming the missing key and how to set it — never a silent fallback.
- The full vitest suite is green before any merge.
- Keep the perf budget on the 20k-file vault: openFile median under 50ms
  and explorerClick median under 120ms, measured by the PERF_VAULT harness.
- Code stays name-agnostic: no product-name literal appears anywhere in the
  tree — package names, URL scheme, env vars, titles, docs — the product
  identity lives only in the git remote.

### Must Not
- Do not add a production dependency without a goal contract that adopts it.
- Do not weaken, skip, or delete an existing test to make a gate pass.
- Do not source a default from anywhere but the user's explicit configuration.

## Decisions

- The workspace is three pnpm app packages — `@app/desktop`, `@app/web`,
  and `@app/server` — each `private: true`; the root package.json holds no
  runtime dependencies.
- Dual-track plugin architecture: `builtin/` is the internal track and may
  use internal APIs; `api/` is the community track; no internal module
  imports `api/`.
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only
  from the kernel, `core`, `dom`, and `platform` — never upward.
- Disk access stays behind the `VaultAdapter` seam inside the web app.
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

Scenario: the workspace declares its app packages
  Test: workspace declares desktop and web app packages
  Given the repository root
  When the workspace configuration is read
  Then pnpm-workspace.yaml lists the app packages, each with its own package.json

Scenario: dependency tables stay in their runtime lanes
  Test: app package dependencies stay in their runtime lane
  Given the three app manifests and the root package.json
  When their dependency tables are inspected
  Then the root declares no runtime dependencies and no app declares another runtime's dependencies

Scenario: the kernel stays headless-ready
  Test: kernel directories import nothing above the kernel
  Given the vault, metadata and storage directories
  When every relative import in them is resolved
  Then no import target lies outside the kernel, core, dom or platform

Scenario: the public facade serves only community plugins
  Test: internal code never imports the public api facade
  Given all web app sources outside api/
  When their imports are resolved
  Then none of them imports from api/

Scenario: the tree stays name-agnostic
  Test: no retired product-name literals remain in code
  Given all code directories and root config files
  When they are scanned for product-name literals
  Then zero matches are found
