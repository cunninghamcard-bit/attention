spec: task
name: "project layout consolidation"
tags: [architecture, sdd]
estimate: 2d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Convert the repository from one scattered single-package tree (55 flat
directories under src/, stale study-era docs, three runtimes sharing one
dependency table) into a pnpm-workspace monorepo with three runtime
packages and a consolidated web app, guarded by an architecture test and
described by rewritten architecture docs. This is a structure-only
refactor: user-visible behavior stays identical.

## Current State

src/ holds 55 flat directories mixing kernel, features and museum code;
features are split in half (views in builtin/, logic in scattered
top-level dirs). electron/, src/ and server/ share the root
package.json. docs/ carries 21 stale study-era and design-note files
plus a broken stray contract. Dependency ground truth: 41 of 52
directories form one strongly-connected component through the App hub
(research.md, Current Codebase State).

## Decisions

All decisions were grilled and recorded; see research.md and
learning-records/ 0001–0009.

- Workspace: pnpm monorepo; the only packages are the three runtimes
  `src/apps/desktop` (current electron/, main+preload thin shell),
  `src/apps/web` (current src/, the product), `src/apps/server`
  (current server/). Root package.json becomes a pure workspace yard
  with no runtime dependencies. Package names `@arkloop/desktop`,
  `@arkloop/web`, `@arkloop/server`, all `private: true`
  (records 0004, 0006, 0008; research.md F1, F3).
- Zero library packages today: no base/platform/kernel/ui packages.
  kernel (vault+metadata+storage) graduates to a package only when a
  second consumer appears; no `shared` package until protocol types
  have two or more consumers — desktop imports its two shared items
  (`SystemMenuItem`, `URL_SCHEME`) from `@arkloop/web`
  (records 0006, 0008).
- Web-internal consolidation: `builtin/` is the feature roof — one
  subdirectory per core plugin, reuniting split view/logic halves
  (canvas, git, github, graph, webviewer, theme-market, terminal, and
  agent moves under `builtin/agent`). Family merges: platform group
  (platform+native+shell+window+desktop+mobile), ui group
  (ui+drag+suggest+hover), app group (app+settings+hotkeys+commands+
  menus+protocol), core absorbs utils. At most 16 top-level source
  directories remain in the web app (record 0007; research.md F1).
- Dual-track plugin architecture, faithful to the original: builtin
  code legally uses internal APIs; `api/` serves community plugins
  only, so no internal module may import `api/`
  (record 0005; research.md dual-track evidence).
- Enforcement is alarm-level inside the web app: a vitest architecture
  test asserts the direction table (kernel imports nothing above
  itself; internals never import api/; runtime dependency lanes).
  Physical walls exist only between the three app packages
  (record 0006; research.md F2).
- Storage stays behind the `VaultAdapter` seam inside web
  (FileSystemAdapter keeps direct node fs via the shell's
  nodeIntegration); the disk-over-IPC route is rejected for perf
  reasons and documented as a known tradeoff (record 0008).
- Museum retirement: delete `src/meta`, `src/scenarios`, `src/docs`
  (ApiDocGenerator) and `src/query` (QueryEngine) including their
  `App.ts` wiring and `src/index.ts` exports (record 0003).
- Docs: retire all 21 legacy docs; delete
  `docs/specs/terminal-view.spec.md`; write `docs/architecture.md`
  (annotated tree + direction table + runtime topology + dual-track +
  known tradeoffs, with docwright:governs markers), write
  `docs/project.spec.md` constitution, rewrite `README.md`
  (records 0002, 0009; research.md F4).
- Verification constraints, fixed: the full vitest suite (1576+ tests)
  passes after every phase; the perf harness keeps openFile median
  under 50ms and explorerClick median under 120ms on the 20k-file
  vault (`ARKLOOP_PERF=1 pnpm exec playwright test
  e2e/perf/large-vault.spec.ts`; main baseline 32ms / 82ms); file
  moves preserve git history (verify with `git log --follow` on
  Vault.ts and ChatView.ts); no new production dependencies; the
  exported surface of `PublicApi` stays unchanged.

<!-- lint-ack: decision-coverage — suite/perf/git-history gates run as whole-repo commands at each plan phase, not as report-mode selectors -->
<!-- lint-ack: output-mode-coverage — structure-only refactor; no user-facing output modes involved -->
<!-- lint-ack: verification-metadata-suggestion — retirement scenarios are pure filesystem assertions at unit level -->
<!-- lint-ack: platform-decision-tag — pnpm/npm mentions are the project's own toolchain, not parity references -->

## Boundaries

### Allowed Changes

- src/**
- electron/**
- server/**
- docs/**
- e2e/**
- scripts/**
- README.md
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- .gitignore
- tsconfig.json
- vite.config.ts
- vite.electron.config.ts
- vite.api.config.ts
- vitest.config.ts
- playwright.config.ts
- playwright.desktop.config.ts
- index.html
- starter.html

### Forbidden

- Do not touch decode-obsidian (reference symlink) or .claude/**.
- Do not rewrite file contents during moves beyond the import-path and
  wiring fixes the move itself requires.
- Do not weaken, skip or delete existing tests to make gates pass.

## Completion Criteria

### Rule: runtime-walls — the workspace splits by runtime

Scenario: three app packages exist (critical)
  Test: workspace declares desktop web and server app packages
  Given the repository root
  When the workspace configuration is read
  Then pnpm-workspace.yaml lists src/apps/desktop, src/apps/web and src/apps/server
  And each app directory contains its own package.json

Scenario: dependency tables are split by runtime
  Test: app package dependencies stay in their runtime lane
  Given the three app package.json files and the root package.json
  When their dependency tables are inspected
  Then the root package.json declares no runtime dependencies
  And the desktop package declares no UI-framework dependencies
  And the web package declares no electron dependency

Scenario: lane checker catches a violation (synthetic)
  Test: flags a dependency outside its runtime lane
  Given a synthetic package manifest that adds electron to the web lane
  When the lane checker runs on it
  Then the checker reports the violation

### Rule: kernel-direction — the kernel stays headless-ready

Scenario: kernel imports nothing above itself (critical)
  Test: kernel directories import nothing above the kernel
  Given the vault, metadata and storage directories of the web app
  When every relative import in them is resolved
  Then no import target lies outside the kernel directories, core, dom or platform

Scenario: direction checker catches an upward import (synthetic)
  Test: flags an upward import from kernel
  Given a synthetic source file under vault/ importing from ui/
  When the direction checker runs on it
  Then the checker reports the violation

### Rule: dual-track-api — the public facade serves only community plugins

Scenario: internals never import the facade
  Test: internal code never imports the public api facade
  Given all web app sources outside api/
  When their imports are resolved
  Then none of them imports from api/

Scenario: facade checker catches an internal import (synthetic)
  Test: flags an internal import of the api facade
  Given a synthetic source file under workspace/ importing from api/
  When the facade checker runs on it
  Then the checker reports the violation

### Rule: builtin-roof — one core plugin per slice

Scenario: split feature halves are reunited under the roof
  Test: builtin roof holds one directory per core plugin
  Given the web app source tree
  When top-level directories are listed
  Then canvas, git, github, graph, webviewer, theme-market, terminal and agent exist only as subdirectories of builtin/
  And the web app has at most 16 top-level source directories

### Rule: retirement — museum code and legacy docs are gone

Scenario: museum modules are removed with their wiring
  Test: museum modules and their app wiring are retired
  Given the web app source tree and App.ts
  When retired paths are checked
  Then meta/, scenarios/, the ApiDocGenerator and the QueryEngine no longer exist
  And App.ts references none of them

Scenario: legacy docs are removed
  Test: legacy docs and stray spec are retired
  Given the docs/ directory
  When its files are listed
  Then none of the 21 retired study-era and design-note documents remain
  And docs/specs/terminal-view.spec.md does not exist

### Rule: architecture-docs — the new documentation set exists

Scenario: architecture doc and constitution are in place
  Test: architecture doc and constitution exist with governs markers
  Given the docs/ directory
  When docs/architecture.md and docs/project.spec.md are read
  Then docs/architecture.md contains a docwright:governs marker and a direction table
  And docs/project.spec.md declares spec level project

## Out of Scope

- kernel as a physical package (upgrade path documented, not executed).
- Rewriting any builtin onto the public API (the graduation ladder is a
  future goal family).
- Disk access over IPC / renderer sandboxing.
- Web deployment of the web app; a shared protocol package.
- Intra-slice entry-file discipline for builtin/ (contrib-style single
  API file per slice) — candidate follow-up goal.

## Open Questions

None.
