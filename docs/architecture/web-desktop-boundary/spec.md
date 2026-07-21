spec: task
name: "web desktop boundary"
inherits: project
tags: [architecture, layout]
estimate: 1d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Make the monorepo package boundary REAL after monorepo-restore's relocation.
Today the shell still compiles renderer SOURCE into its bundle, preload code
lives in the main lane, and `@app/shared` resolves through four parallel
mechanisms. This ticket is structure only — zero behavior change; the full
existing gate green is the ONLY standard of correctness. It clears the ground
for kernel-integration (which touches apps/web, packages/shared and
packages/sdk) so that ticket lands on clean seams.

## Current State

- apps/desktop deep-imports apps/web source: `URL_SCHEME` (a runtime value)
  in obsidian-url.ts, obsidian-protocol.ts and cli/CliDispatch.ts, and
  `type SystemMenuItem` in main.ts and menu.ts — wired by a vite alias
  `@app/web` → renderer source in main/vite.config.ts, while `@app/web`'s
  package exports carry neither subpath. The workspace dependency is nominal.
- apps/desktop/preload/preload.ts imports `../main/terminal-bridge` and
  `../main/git-bridge` — both self-described preload-side modules living in
  the main lane; `zsh-shim.ts` rides with them.
- `@app/shared` resolves through four mechanisms at once: root tsconfig
  paths (double-named `@app/shared/*` and `@shared/*`), vite aliases in both
  web configs, vitest aliases, and the real workspace exports. Redundant
  tables drift — the desktop `@app/web` alias grew out of exactly this.
- One vitest project runs everything under jsdom with the web setup file,
  including tests/desktop, whose subjects are main-process node code.
- Drift: the README maps an apps/server and src/ paths that do not exist;
  pnpm-workspace.yaml carries a literal placeholder for allowBuilds.electron;
  stale comments cite src/{shared,native,renderer}.

## Decisions

- Wire contracts move to `@app/shared` — the seam package exists for exactly
  this: `scheme.ts` (URL_SCHEME) and `menu.ts` (the SystemMenuItem wire
  shape). SystemMenuBuilder (construction logic) stays in the renderer. The
  desktop vite alias and the root tsconfig `@app/web/*` path retire; the
  direction-table row for main tightens from "renderer contracts" to
  "@app/shared only".
- A shell-wall lands beside the renderer-wall in tests/architecture.test.ts:
  no import under apps/desktop may resolve into apps/web.
- terminal-bridge.ts, git-bridge.ts and zsh-shim.ts git-mv to
  apps/desktop/preload/ — the directory lane matches the runtime lane again.
- Resolution converges on the package mechanism: the `@shared/*` spelling
  retires (imports normalized to `@app/shared`), the web vite aliases are
  removed (workspace link + exports resolve the same files). The root
  tsconfig keeps `@app/shared/*` SOLELY for the centralized tests lane,
  documented inline; retiring it needs a tests-lane workspace dep and a
  lockfile regeneration — deferred, out of scope here.
- vitest splits into projects: tests/web (and the root architecture tests)
  keep jsdom + the web setup; tests/desktop runs under node without it.
- Sweep: allowBuilds.electron placeholder → false (electron 43 has no
  install script); the README repo map matches the tree; the
  tests/package.json description drops src/ wording; `.worktrees/` is
  ignored.

## Boundaries

### Allowed Changes

- apps/**
- packages/shared/**
- tests/**
- docs/**
- README.md
- tsconfig.json
- vitest.config.ts
- pnpm-workspace.yaml
- .gitignore

### Forbidden

- No behavior change; no renderer or kernel logic edits.
- No new dependency, no lockfile change.
- packages/sdk stays empty.
- No capability/registry work and no Platform wiring — kernel-integration
  owns the capability doctrine and its first use cases.
- Do not weaken, skip or delete existing tests to make a gate pass.

## Completion Criteria

### Rule: shell-wall — the boundary points both ways

Scenario: the shell never imports renderer source (critical)
Test: keeps the shell free of renderer-source imports
Given every import statement under apps/desktop
When their targets are resolved
Then none resolves into apps/web, and the shared symbols (URL_SCHEME,
SystemMenuItem) come from @app/shared

### Rule: lane-truth — preload code lives in the preload lane

Scenario: the preload bridges live where they run
Test: keeps preload-side modules in the preload lane
Given apps/desktop
When preload.ts imports are read
Then every bridge module it installs lives under preload/ and main/ holds
no preload-side module

### Rule: one-resolution — the package mechanism is the single truth

Scenario: no redundant alias for @app/shared remains in the web lane
Test: resolves @app/shared through the package mechanism only
Given the web vite configs and the root tsconfig
When alias and path tables are read
Then no @app/shared vite alias remains, the @shared spelling is gone, and
the only remaining tsconfig path for @app/shared is the documented
tests-lane exception

### Rule: env-honest — desktop tests run in their real environment

Scenario: main-process tests run under node
Test: runs tests/desktop under the node environment
Given the vitest configuration
When its projects are read
Then tests/desktop runs under node without the web setup file and
tests/web keeps jsdom with it

### Rule: gate-green — the standard is unchanged

Scenario: the full gate passes after the boundary work (critical)
Review: human
Test: keeps the full gate green through the boundary ticket
Given the finished branch
When lint, format check, typecheck, vitest, builds, e2e and packcheck run
Then all pass with no test weakened, skipped or deleted

## Out of Scope

- Bridge-global consolidation into platform/native and the capability
  registry — kernel-integration (owner doctrine: capability = adapter
  registered for a port, never platform sniffing).
- Platform.isDesktopApp wiring (a behavior change; rides with capability).
- Retiring the tests-lane tsconfig path (needs a tests-lane dep + lockfile).
- out/ one-roof relocation and per-package tsconfig programs (web-ticket
  era decisions).
- Deleting stale out/{api,types,server} build leftovers (untracked; manual).
