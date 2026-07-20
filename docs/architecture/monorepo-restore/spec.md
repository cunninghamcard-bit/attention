spec: task
name: "monorepo restore"
inherits: project
tags: [architecture, layout]
estimate: 3d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Restore the pnpm monorepo IN PLACE — the pre-collapse `apps/desktop` +
`apps/web` split — while KEEPING the collapse era's one gain (unified port
contracts, now seated in `packages/shared`), and seat the Go agent kernel in
the same tree at the root. The product direction moved from one local desktop
app to a server + web + desktop application; the single-package shell was a
consolidation stop that deliberately reserved the kernel seam — this ticket
activates it. It is structure only: one branch, git mv plus mechanical
import/path rewrites, zero behavior change. The full existing gate re-greened
in the new layout is the ONLY standard of migration correctness.

## Current State

Single package ("workbench") at the repo root with `src/{main, preload,
renderer, shared, types}`; `tests/` is the only pnpm workspace member
(`@app/tests`). Before the collapse the repo WAS two packages —
`apps/desktop` (electron main + preload + native bridges) and `apps/web` (the
Obsidian-reconstruction renderer) — with the port interfaces DUPLICATED on
both sides, agreeing only by convention; the collapse fixed that by lifting
the contracts into `src/shared`. mise is the toolchain entry: every task
forwards to a root package.json script, and the scripts hardcode `src/` paths
(the vite configs live inside `src/{renderer,main}`).
`tests/architecture.test.ts` enforces the single-package shape and the
`src/*` runtime lanes, and the project constitution declares "one Electron
app in one package" with a bound checker ("no apps package remains"). The
kernel lives in a SEPARATE repository — the Go module
`github.com/cunninghamcard-bit/Attention` (Go 1.26): `cmd/along` headless
kernel plus `cmd/tui` client, `internal/*`, one file plugin under
`extension/`, its own `specs/` household, a Makefile entry, `bin/` output.
The kernel is Pi-compatible on the wire and its TUI is already a client of
its RPC protocol.

## Decisions

- Target shape mirrors the mixed-monorepo reference (memoh): Go at the root,
  JS in workspace packages, web as the product package and desktop as the
  shell that reuses it. Top-level mapping:
  - `src/renderer` → `apps/web` — WHOLESALE, internal relative imports
    untouched; renamed `@app/web`. The name is DIRECTIONAL: the renderer is
    node-privileged today and becomes browser-runnable in the web ticket, not
    here.
  - `src/main` + `src/preload` → `apps/desktop` (`@app/desktop`) — the shell.
    It loads `apps/web`'s build output (vite config and html entry move with
    the renderer; electron load paths are mechanically rewritten).
  - `src/shared` + `src/types` → `packages/shared` (`@app/shared`) — the port
    contracts (`DataAdapter`, `ElectronGitApi`, `ElectronTerminalApi`, the
    typed IPC channel table) and ambient declarations, ONE definition each,
    imported by BOTH apps. The pre-collapse disease — duplicated port
    declarations on both sides — is FORBIDDEN to return.
  - `packages/sdk` is an EMPTY shell (`@app/sdk`): a manifest only, the seat
    of the future kernel API client shared by web and desktop. It is a
    generated-client seat, NOT an extension runtime — the kernel constitution
    forbids a TypeScript extension runtime without a separate contract.
  - Root package.json ("workbench") dissolves into a NEW private orchestrator
    that keeps the same script names and forwards via `pnpm --filter`, so
    mise tasks, the `check`/`quality` gates and muscle memory are unchanged.
    `pnpm-workspace.yaml` gains `apps/*` and `packages/*`; `tests` stays the
    centralized lane (`@app/tests`).
  - The kernel subtree lands at the ROOT: `cmd/`, `internal/`, `extension/`,
    `specs/`, `go.mod`, `go.sum` — via `git merge
    --allow-unrelated-histories`, NOT `subtree --prefix`. Historical paths
    match 1:1, so log/blame stay seamless across the merge. The kernel
    arrives WHOLE — TUI, file plugin, specs household, all of it; no pruning.
    Its Makefile dissolves into mise tasks (mise stays the single task
    registry; `mise.toml` pins Go 1.26 and gains kernel build/test tasks);
    `bin/` goes to `.gitignore`; its README folds into `docs/`; its
    `.gitignore` and `.agents/` skills merge into ours where not duplicate.
    The kernel is NOT a pnpm workspace member and its go.mod module path is
    UNTOUCHED this ticket — zero Go file diffs keeps the hash receipt clean.
  - `tests/architecture.test.ts` walls are RE-LANED from `src/*` directory
    lanes to PACKAGE lanes, intents upgraded where the split allows: the
    renderer wall becomes a workspace-boundary wall (apps/web imports no
    electron and no apps/desktop; contracts come from `@app/shared`, not a
    local copy). The kernel-direction rule, api-facade rule, arkloop-literal
    scan and surface freeze all carry.
  - The constitution and single-package-shell are SUPERSEDED:
    `docs/project.spec.md` is rewritten to the monorepo reality (one repo,
    three lanes: app packages, shared packages, Go kernel at root),
    single-package-shell retires to learning records as history, and
    `docs/architecture.md` is rewritten. The red lines do NOT move: the LOCAL
    vault fs stays in-process node (the kernel never owns it), the renderer
    owns markdown/block rendering in ALL forms.
  - `KernelApi` is DELETED in this ticket (owner override, 07-20): the port
    interface, its wall test and every reference go, in a SEPARATE commit
    after the relocation commits so the static-hash receipt stays clean. The
    "rendering never imports KernelApi" wall retires with it; its successor
    ("rendering never imports @app/sdk") lands with SDK generation in the
    kernel-integration ticket. `@app/sdk` stays an empty seat.
  - Receipt on the branch (suggested name `feat/monorepo-restore`):
    `reports/monorepo-restore/mapping.md` lists old → new for every moved
    path, each landing exactly once; the blob-hash baseline shows every moved
    file identical pre/post except the mechanical-rewrite class (import
    paths, config path strings, re-laned wall constants). Relocation commits
    are recorded in `.git-blame-ignore-revs`. The boxsh receipt follows the
    #26 convention. Branch only — no merge to main, no push — owner reviews
    first.

- Recorded owner direction for the FOLLOW-UP kernel-integration ticket (NOT
  this ticket's scope, frozen here so the next contract does not re-litigate
  it):
  - Transport is memoh-style: the kernel grows an Echo HTTP facade plus ONE
    WebSocket push channel; OpenAPI (swaggo-generated from the Go handlers)
    is the contract of record; `@app/sdk` is GENERATED from it. The
    SiYuan-style envelope is retired; Pi-RPC remains the kernel's INTERNAL
    protocol (its TUI stays an RPC client) and never crosses into JS.
  - The `KernelApi` port is already deleted in THIS ticket (owner override) —
    a hand-written second contract beside a generated client drifts; the
    renderer will call `@app/sdk` directly. That ticket adds the new wall
    "rendering never imports @app/sdk" alongside SDK generation.

<!-- lint-ack: decision-coverage — the wholesale-move, subtree-merge, package-split, Makefile-dissolution and docs-rewrite decisions are structural/mechanical, verified by the re-greened gate plus the hash receipt, not by report-mode selectors -->
<!-- lint-ack: platform-decision-tag — electron-vite, pnpm, go, echo and mise mentions are this repo family's own toolchain, not a parity reference -->
<!-- lint-ack: error-path — a structure-only relocation has no runtime error path; the re-laned walls and the gate-green rule ARE the regression-failure guards -->


## Boundaries

### Allowed Changes

- src/**
- apps/**
- packages/**
- cmd/**
- internal/**
- extension/**
- specs/**
- go.mod
- go.sum
- Makefile
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- tsconfig.json
- tsconfig.tools.json
- vitest.config.ts
- oxlint.json
- .oxfmtrc.json
- tests/**
- docs/**
- reports/**
- mise.toml
- .gitignore
- .git-blame-ignore-revs
- index.html
- starter.html
- scripts/**
- patches/**
- .github/**
- .githooks/**

### Forbidden

- Do not change renderer or kernel LOGIC: the move is git mv plus import-path
  and wiring fixes only, on both sides.
- Do not move the LOCAL vault fs read/write path behind IPC or the kernel —
  it stays in-process node (the perf red line).
- Do not duplicate port declarations across packages: the contracts live once
  in `@app/shared`.
- Do not make apps/web browser-runnable: no remote DataAdapter, no auth, no
  kernel wiring — those are the web and kernel-integration tickets.
- Do not add a production dependency, zod, a presenter/route registry, or any
  UI framework.
- Do not weaken, skip or delete existing tests to make a gate pass — re-laning
  a wall keeps its intent, anything else is a violation.
- Do not spawn or wire the kernel, or touch any transport concern. The
  `KernelApi` deletion is the ONLY non-relocation change allowed, and only as
  its own commit.
- Do not prune the kernel tree (the TUI, the file plugin and the specs
  household arrive whole).
- Do not introduce product-name literals; the arkloop scan stays at zero.
- Do not merge to main or push; one branch, owner review first.

## Completion Criteria

### Rule: monorepo-shape — one repo, three lanes

Scenario: the workspace is a monorepo with the kernel seated at the root (critical)
  Test: declares the monorepo layout with the kernel seated
  Given pnpm-workspace.yaml, go.mod and the source tree
  When the workspace packages and top-level directories are read
  Then apps/desktop, apps/web, packages/shared and packages/sdk are workspace
  packages alongside tests, no top-level src remains, and cmd, internal and
  go.mod sit at the repo root

### Rule: gate-green — the gate is the standard

Scenario: the full gate passes in the new layout (critical)
  Review: human
  Test: keeps the full gate green in the monorepo layout
  Given the relocated tree
  When lint, format check, typecheck, vitest, builds, e2e and packcheck run
  Then all of them pass with no test weakened, skipped or deleted

### Rule: renderer-wall — the native seam is a package boundary

Scenario: the renderer never imports the shell (critical)
  Test: keeps the renderer free of shell imports
  Given every import statement under apps/web
  When their targets are resolved
  Then none resolves into apps/desktop or the electron module, and every port
  contract import resolves into @app/shared, not a local copy

### Rule: shared-contracts — one contract, both sides compile against it

Scenario: the port contracts live in @app/shared
  Test: declares the native port contracts in the shared package
  Given packages/shared
  When it is inspected
  Then it declares the DataAdapter, ElectronGitApi and ElectronTerminalApi
  interfaces and a typed IPC channel table, and no apps package re-declares
  any of them

### Rule: static-hash — pure relocation, proven

Scenario: moved files are byte-identical outside mechanical rewrites (critical)
  Review: human
  Test: holds every moved file byte-identical outside mechanical rewrites
  Given the pre-move tree and the post-move branch
  When blob hashes and the diff are compared
  Then every moved file's blob is identical except files whose only diff is
  an import-path or config-path rewrite, and mapping.md accounts for every
  moved path exactly once

### Rule: kernel-history — the subtree keeps its past

Scenario: kernel history is preserved and reachable
  Test: keeps the kernel commit history reachable
  Given the merged branch
  When git log follows cmd/along and internal/
  Then the kernel repository's commits are reachable from the branch HEAD and
  the relocation commits are listed in .git-blame-ignore-revs

### Rule: kernel-seam — the port is gone, the seat stays empty

Scenario: the KernelApi port is deleted (critical)
  Test: removes the kernel port and every reference
  Given the workspace after the deletion commit
  When all code lanes are searched for the KernelApi identifier
  Then zero definitions and zero references remain, the deletion is its own
  commit separate from every relocation commit, no kernel package is a pnpm
  workspace member, and @app/sdk carries no runtime code and no dependencies

### Rule: name-agnostic — the retired name stays gone

Scenario: no retired product-name literals remain in code
  Test: no retired product-name literals remain in code
  Given all code lanes and root config files in the new layout
  When they are scanned for retired product-name literals
  Then zero matches are found

## Out of Scope

- The kernel transport and facade implementation and `@app/sdk` generation —
  the kernel-integration ticket (owner direction for it is recorded in
  Decisions).
- Making apps/web browser-runnable: the remote DataAdapter, auth, and web
  packaging — the web ticket.
- The cloud origin/auth model.
- Consolidating the kernel's `specs/` household with docwright goals.
- go.mod module-path and kernel identity-string neutralization.
- Any change to renderer behavior or the Obsidian reconstruction internals.

## Open Questions

1. Timing of go.mod module-path and kernel identity-string neutralization.
2. Sequencing of the web ticket: remote DataAdapter vs auth vs web packaging.
3. The kernel facade's HTTP/WS surface and swagger granularity when the
   kernel-integration ticket opens.
