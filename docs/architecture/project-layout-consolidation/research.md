---
artifact: research
goal: "project layout consolidation"
derived_into: spec.md
---

# project layout consolidation — Research

> Follow every claim back to the source that owns it. Primary sources
> first; never trust parametric knowledge. See the docwright-research
> skill for the methodology.

## Unknowns

- U1: How do comparable large TS/Electron desktop apps organize `src/` —
  layer-first, domain-first, or feature-first? How many top-level
  directories at what codebase scale?
- U2: How do those projects express and mechanically enforce layering
  (dependency direction) — custom lint rules, dedicated tools, CI checks?
- U3: What enforcement options fit THIS repo today: oxlint's capabilities,
  dependency-cruiser, eslint-plugin-boundaries, docwright
  `check-structure` — what exactly can each check?
- U4: Where do non-renderer runtimes live (electron main process, node
  sidecar server, CLI) in comparable projects — root-level siblings of
  src/ or inside it?
- U5: What form do architecture docs take in well-regarded projects
  (root ARCHITECTURE.md, docs/ tree, wiki) and what do they contain?

## Industry Norms & Prior Art

### VS Code source organization (U1/U2/U4/U5) — verified on main, 2026-07-12

- `src/vs/` has exactly **7 top-level layer dirs**: `base`, `platform`,
  `editor`, `workbench`, `code`, `server`, `sessions` — for one of the
  largest TS codebases in existence. Features do NOT get top-level
  dirs. Source: gh api contents src/vs.
- **All 99 feature dirs live under `vs/workbench/contrib/`** (chat,
  debug, terminal, search, scm, notebook, extensions, tasks…). Contrib
  rules (wiki): nothing outside contrib may import a contrib's
  internals; each contrib has a single `.contribution.ts` entry and
  exposes one API file; contribs may depend on another contrib's API
  file only. Source: contents workbench/contrib; Source-Code-
  Organization wiki.
- `vs/platform` holds 104 service dirs, `vs/workbench/services` 93 —
  small dirs in the hundreds are NORMAL there; the discipline is the
  layer above them, not dir count. Source: gh api contents.
- Layer direction enforced by ESLint custom rule
  `local/code-import-patterns` (.eslint-plugin-local/
  code-import-patterns.ts; per-target allowed-import lists in
  eslint.config.js, "Do not relax these rules") and
  `local/code-layering` (target-env map: common ← node/browser ←
  electron-browser/electron-main…). Source: eslint.config.js,
  .eslint-plugin-local/.
- Second axis: every module splits internally by TARGET ENVIRONMENT
  (`common | browser | node | electron-browser | electron-utility |
  electron-main`), e.g. vs/platform/files/{common,browser,node,
  electron-main}. Compile-level checks: `valid-layers-check` runs
  build/checker/layersChecker.ts + 6 per-env tsconfigs (browser gets
  DOM lib, node doesn't — cross-env usage fails to compile).
  Source: build/checker/, package.json script valid-layers-check.
- Architecture docs: NO root ARCHITECTURE.md; canonical doc is the
  "Source Code Organization" wiki page defining each layer in a
  paragraph; in-repo agent copy at .github/instructions/
  source-code-organization.instructions.md; a new layer (sessions)
  documents its import rules in src/vs/sessions/LAYERS.md.
  Source: wiki raw fetch; gh api contents.

### Comparable-app survey (U1/U4/U5) — verified live via gh api, 2026-07-12

- joplin (dev branch): monorepo, 27 packages split by RUNTIME/app target
  (app-desktop, app-mobile, app-cli, server + one fat shared `lib`
  package). app-desktop/ splits by technical kind (gui, commands,
  services…); features exist only inside gui/ (38 dirs: NoteEditor,
  Sidebar…). NO boundary tooling (eslint config has none; 0 code-search
  hits). No ARCHITECTURE.md; contributor guide readme/dev/index.md.
  Source: git tree dev; packages/*; eslint.config.js; readme/dev/.
- AFFiNE (canary): monorepo, packages/ = 3 tiers (backend / common
  "isomorphic, no business" / frontend) + apps/ per delivery target
  (electron, electron-renderer, web, ios, android…). Center of gravity:
  frontend/core/src/modules/ = **69 domain-module dirs** (workspace,
  doc, editor, journal, permissions…). blocksuite editor tree splits
  framework/ vs affine/ (product). Enforcement: oxlint
  `no-restricted-imports` bans **/dist & **/src deep imports,
  `import/no-cycle` error — no layer-graph rules. Architecture doc:
  docs/contributing/tutorial.md. Source: package.json workspaces;
  packages/*/*; core/src/modules (jq count 69); .oxlintrc.json.
- element-web (develop): fresh pnpm+Nx monorepo — apps/{web,desktop},
  packages/ (npm-published), modules/. apps/web/src = 40 dirs by
  TECHNICAL LAYER (stores, dispatcher, hooks, settings…); UI under
  components/{structures,views,viewmodels} (MVVM). nx.json has NO
  module-boundary tags. oxlint no-restricted-imports = entry-point
  bans only. Docs: docs/monorepo.md, docs/MVVM.md, 50+ topic docs.
  Source: docs/monorepo.md; apps/web/src listing; nx.json;
  oxlint.config.ts.
- outline (main): SINGLE package; top level split by runtime — app/
  (React SPA, 13 layer dirs), server/ (Koa, 23 layer dirs), shared/
  (isomorphic), plugins/ (23 vertical slices each mirroring
  client/server/shared). One targeted no-restricted-imports rule; no
  boundary tooling. docs/ARCHITECTURE.md = annotated dir-by-dir tree
  with one-line role per dir — best architecture doc of the four.
  Source: git tree main; package.json (no workspaces);
  docs/ARCHITECTURE.md; .oxlintrc.json.
- Cross-repo: **0 of 4 use dependency-cruiser / eslint-plugin-
  boundaries / Nx boundary tags.** Mechanical enforcement in the wild =
  package-manager workspace deps + cycle bans + entry-point
  no-restricted-imports. Features live either under one roof
  (VS Code contrib 99, AFFiNE modules 69) or inside the UI layer
  (joplin gui 38, element views 23); nobody keeps 50+ feature dirs at
  the source root. Small-dir counts in the hundreds are normal ONE
  LEVEL DOWN (vscode platform 104, workbench/services 93).

### Boundary-enforcement tooling (U2/U3)

- Local lint infra: `oxlint ^1.70.0` (npm latest 1.73.0, repo ~current);
  `oxlint.json` has `"rules": {}` — no boundary rules today. No ESLint,
  no dependency-cruiser, no madge installed.
  Source: package.json, oxlint.json, npm registry.
- oxlint implements `no-restricted-imports` (paths/patterns with
  gitignore-style groups) and supports per-directory `overrides` with
  `files` globs — so "files in src/core/** may not import **/ui/**" is
  expressible today with zero new deps. No graph awareness (no
  transitive `reachable`). There is NO `import/no-restricted-paths`
  equivalent (docs 404, no code hits).
  Source: oxc.rs linter rules/config docs; gh search in oxc-project/oxc.
- oxlint custom JS plugins reached alpha 2026-03-11 (`jsPlugins` in
  .oxlintrc.json); could theoretically host boundaries-style rules but
  alpha status. Source: oxc.rs blog 2026-03-11.
- dependency-cruiser: full from/to regex rules plus `circular`,
  `reachable`, `orphan`; CI via `depcruise src` exit code; actively
  maintained (v18.0.0 2026-06-25, ~6.9k stars). Peer-folder isolation
  expressible with regex capture groups.
  Source: sverweij/dependency-cruiser doc/rules-reference.md,
  rules-tutorial.md, releases.
- eslint-plugin-boundaries: nicest typed element model (v7.0.2
  2026-07-07) but peer-depends on ESLint + resolver chain — a whole
  second lint stack for this repo. Poor fit.
  Source: npm registry, javierbrea/eslint-plugin-boundaries README.
- ts-arch: ArchUnit-style architecture tests inside any test framework:
  `filesOfProject().inFolder("business").shouldNot().dependOnFiles()
  .inFolder("ui")` + `beFreeOfCycles()`; framework-agnostic
  `await rule.check()` returns violations, so vitest can assert
  `toEqual([])` — flows straight into the existing JUnit report gate
  that docwright report mode consumes. Caveats: last release v5.4.1
  2024-12-23 (semi-dormant, 650 stars); README warns arch tests are
  slow (their examples set 60s jest timeout).
  Source: ts-arch/ts-arch README, src/jest/ArchMatchers.ts, releases.
- madge: cycles/orphans only, no from/to rules; strict subset of the
  above. Skip. Source: pahen/madge README.

## Current Codebase State

<!-- docwright:generated:start -->
(no files matched the contract's Allowed Changes)
<!-- docwright:generated:end -->

Hand-gathered facts (2026-07-12, commands run at repo root on main b76656a):

- `src/` has 55 top-level directories; 8 contain exactly one source file
  (`query`, `recovery`, `hover`, `settings`, `updates`, `utils`,
  `devtools`, `revisions`), ~15 more contain ≤3 files.
  Source: `find src -type d` + per-dir file counts.
- Most-imported modules (occurrences of `from "../<dir>/` across src):
  `app` 267, `ui` 188, `views` 110, `vault` 98, `plugin` 75,
  `workspace` 74, `dom` 55, `core` 49 — a de-facto foundation/kernel
  already exists. Source: grep count over `src/**/*.ts`.
- Directory names of the big modules (`vault`, `workspace`, `plugin`,
  `views`, `editor`, `metadata`) mirror Obsidian's public API domain
  language. Source: decode-obsidian reference; src dir listing.
- Study-era museum code: `src/meta/` (ArchitectureCatalog, LearningPath,
  CompletenessMatrix, ProjectStatus) and `src/scenarios/` are exported
  only by `src/index.ts`; no product code imports them.
  `src/docs/ApiDocGenerator` and `src/query/QueryEngine` ARE wired into
  `src/app/App.ts`. Source: `grep -rl` importer scan.
  User decision 2026-07-12: retire all four, including the App.ts wiring.
- Legacy docs: 16 study-era docs + 5 design-note docs in `docs/`; user
  decision 2026-07-12: retire all, rewrite architecture docs from code.
  `docs/specs/terminal-view.spec.md` carries `inherits: project` with no
  `docs/project.spec.md` present, keeping `docwright guard` red.
- Non-renderer runtimes today: `electron/` (main process, ~40 files),
  `server/` (chat sidecar engines, own vite.config), `src/cli/` (23
  files), plus entries `index.html`/`starter.html` and three root vite
  configs. Source: root listing.
- Lint infra today: oxlint (oxlint.json, no import-boundary rules
  configured). Test infra: vitest + JUnit reporter already used by
  docwright report mode. Source: package.json, oxlint.json,
  spec frontmatter `test_command`.
- docwright `check-structure` provides mechanical layering guard:
  `--forbid <substring> --in <glob>`, non-zero exit on hit — one rule
  per invocation. Source: docwright-tool-first references/commands.md.

Dependency-graph ground truth (2026-07-12, main 4550ed9, script over
`src/**/*.ts` relative imports; edge list in scratchpad dep-edges.json):

- 52 top-level dirs participate, 293 dir-level edges.
- **41 of 52 dirs form ONE strongly-connected component** (all mutually
  reachable, hub = App service locator): agent, api, app, builtin, cli,
  commands, core, desktop, devtools, diagnostics, docs, drag, editor,
  git, github, graph, hotkeys, hover, markdown, menus, metadata,
  mobile, packaging, plugin, properties, query, recovery, revisions,
  search, storage, suggest, terminal, theme, theme-market, ui, updates,
  vault, views, webviewer, window, workspace. Outside the knot (clean):
  build, canvas, dom, native, platform, protocol, release, settings,
  shell, starter, utils. Consequence: NO cycle-free package cut exists
  today; any monorepo split requires de-tangling surgery first.
- Surgery size across the proposed base/platform/kernel/ui boundaries
  is small and measured: upward (wrong-direction) imports excluding
  tests — vault 9 (4 type-only), metadata 13 (7 type-only), core 3
  (1 type-only), ui 7 (5 type-only), storage 0. ≈15 value imports to
  invert or relocate + ≈17 type-only imports to re-point at extracted
  interfaces.
- Representative value-import offenders and their likely fixes:
  vault/MoveFileModal + FileManager's ConfirmationModal (UI modals
  living in vault — in real Obsidian fileManager is app-level →
  relocate to app pkg); metadata/{LinkSuggestionManager,TagSuggestion}
  → suggest/fuzzyMatch (pure scoring fn → extract down to base);
  metadata/MetadataCache → properties/Frontmatter (pure parsing →
  belongs in kernel) and → ui/Notice (toast from kernel → invert via
  event or accept kernel→ui edge).
- The graph corrects the family intuition used in the first F1b
  proposal: mobile, menus, suggest, hover, desktop, window are all
  app-coupled (edges into app/views/workspace) — they belong in the
  app package, NOT in platform/ui packages. Fully clean leaves:
  dom, platform, native, shell, utils, protocol, settings, starter,
  canvas. Data-corrected cut: platform pkg = platform+native+shell
  (all clean); ui pkg = ui (2 value fixes); base = core+dom+utils
  (2 value fixes); kernel = vault+metadata+storage (~11 value fixes);
  everything else = app pkg.
- github dir appeared on main via the other session's merge (4550ed9,
  "Oh My GitHub workspace surface") — the record-0001 residual
  constraint (wait for feat/github-pr-cloud) is RESOLVED; branch
  already landed.

## Findings

### F1: Target shape of src/

- **Decision**: DECIDED 2026-07-12 (learning-records 0004 + 0006):
  pnpm-workspace monorepo, house style — `src/apps/{desktop, renderer,
  server}` as the only packages; zero library packages today; kernel
  direction alarm-guarded (see F2), graduating to a real package only
  when a second consumer appears. Original recommendation below kept
  for the record; renderer-internal shape continued in F1c.
- **Superseded recommendation**: adapted VS Code shape —
  kernel domain dirs stay flat at the top (`vault`, `metadata`,
  `workspace`, `editor`, `views`, `markdown`…), the ~20 product-feature
  dirs collapse under one roof (contrib pattern), the foundation family
  (`core`+`dom`+`utils`) and the platform family (`platform`+`native`+
  `desktop`+`mobile`+`shell`+`window`) each consolidate. Top level
  55 → ~15.
- **Rationale**: VS Code proves the feature-roof pattern at 99 features;
  AFFiNE at 69 modules. Our kernel dir names mirror Obsidian's API
  domain language and are worth keeping visible. Small dirs one level
  down are industry-normal; the discipline that matters is direction
  between layers.
- **Alternatives considered**: pure flat consolidation 55→20 (no roof —
  keeps feature/kernel confusion at top level); monorepo packages
  (joplin/AFFiNE style — premature with a single consumer); full
  VS Code two-level layers incl. base/platform renames of kernel dirs
  (maximal churn, buries the domain language).

### F2: Mechanical enforcement of layer direction

- **Decision**: DECIDED 2026-07-12 (folded into F1b ①, learning-record
  0006): alarm-level discipline — a hand-rolled vitest architecture
  test asserting the direction table (kernel dirs import nothing above
  them; internals never import api/ per record 0005; builtin slices
  keep to their entry files), running in the existing test gate whose
  JUnit report docwright scenarios bind to. Physical walls exist only
  between the three app packages. Original recommendation matched.
- **Original recommendation**: a hand-rolled vitest
  architecture test (~60 lines: walk src/, parse relative imports,
  assert a direction table) — zero new deps, runs in the existing test
  gate, and lands in the JUnit report that docwright report-mode
  scenarios can bind to. Optionally enable oxlint `import/no-cycle`.
- **Rationale**: 0/4 surveyed apps use dedicated boundary tools;
  VS Code's approach (custom lint in the toolchain it already has) is
  the pattern — our equivalent toolchain-native seat is vitest. A
  vitest test is the only option that makes the layering rule
  docwright-verifiable as a Scenario.
- **Alternatives considered**: dependency-cruiser (strongest rules,
  actively maintained, but a separate CLI outside the test gate);
  ts-arch (fits vitest but semi-dormant since 2024-12 and slow);
  eslint-plugin-boundaries (needs the whole ESLint stack — rejected);
  oxlint no-restricted-imports overrides (zero-dep but blunt, no graph
  awareness — viable supplement, not the spine); docwright
  check-structure (substring forbid per invocation — usable in CI but
  outside the test report).

### F3: Non-renderer runtime placement

- **Decision**: DECIDED 2026-07-12 (learning-record 0006, settled by
  F1b): `src/apps/desktop` (electron main+preload, thin shell),
  `src/apps/renderer` (the product), `src/apps/server` (sidecar) —
  Arkloop/along house style. Original recommendation below kept for
  the record.
- **Superseded recommendation**: keep the existing
  top-level runtime split — `electron/` (main process), `server/`
  (agent sidecar), `src/` (renderer) — unchanged; it already matches
  outline's app/server/shared shape. `src/cli` is NOT a runtime (it is
  the in-app `App.cli` command registry reconstruction) and is treated
  as a feature in F1.
- **Rationale**: outline validates root-level runtime dirs in a single
  package; joplin/element reach the same boundary via monorepo
  packages, which F1 rejected as premature.
- **Alternatives considered**: apps/ + packages/ monorepo conversion
  (element's fresh conversion shows it is done for npm publishing +
  multi-app reuse — needs we don't have); moving electron/ and server/
  under src/ (mixes bundling targets and tsconfig scopes for no gain).

### F4: Architecture documentation form

- **Decision**: DECIDED 2026-07-12 (learning-record 0009):
  docs/architecture.md (outline-style annotated tree + direction table
  + runtime topology + dual-track + known tradeoffs, governs markers) +
  docs/project.spec.md constitution + README rewrite; all 21 legacy
  docs retired (record 0002) and docs/specs/terminal-view.spec.md
  DELETED (not relocated). Original recommendation below.
- **Original recommendation**: one `docs/architecture.md`
  in outline's style — annotated directory tree (one-line role per
  dir) + the layer table with allowed-import directions + runtime
  topology; plus `docs/project.spec.md` as the docwright constitution
  (also unblocks `inherits: project`). Retire all 21 legacy docs
  (user-confirmed 2026-07-12); relocate-or-retire the stray
  `docs/specs/terminal-view.spec.md` contract.
- **Rationale**: outline's ARCHITECTURE.md was the clearest artifact in
  the survey; VS Code shows the layer-definition table + per-layer
  import lists is what a newcomer (and an agent) actually needs; the
  doc gets `docwright:governs` markers so guard flags drift.
- **Alternatives considered**: docs/ tree of many topic files
  (element style — more surface than one maintainer needs); wiki
  (VS Code style — external to the repo, agents can't see it);
  README section (already 20KB and stale-leaning).
