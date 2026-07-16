spec: task
name: "vanilla ui consolidation"
inherits: project
tags: [architecture, ui, react]
depends: [codiff-right-sidebar]
estimate: 1w
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Consolidate the UI on a single paradigm: vanilla TS + direct DOM, faithful
to the original — repo-wide, zero React. The local git surface (review
center, right navigator) is rewritten on the framework-free
`@pierre/diffs` core `CodeView` class with the confirmed polish findings
folded in; the three cloud shells are rewritten vanilla at feature parity,
pinned by their existing test suites; `react`, `react-dom` and `moment`
leave package.json, and an alarm keeps them out for good.

## Current State

- Exactly six files import react: three cloud shells under
  `builtin/github/` (`GitPrViews.tsx` 1776 lines, `GitHubWorkspace.tsx`
  944, `GitHubExtraPanels.tsx` 652 — business logic already lives in the
  framework-free client/service layer) and three local review files under
  `builtin/git/review/` (`ReviewSurface.tsx`, `GitReviewView.tsx`,
  `GitNavView.tsx`, the last still uncommitted). `moment` has three
  consumers: `GitPrViews.tsx`, `FileExplorerView.ts` (tooltip timestamps)
  and `core/ApiUtils.ts`, whose `moment` export is part of the public
  plugin API surface.
- `@pierre/diffs` core exports a vanilla `CodeView` class (virtualization,
  `scrollTo`, `getTopForItem`, `getScrollTop`); the React `CodeView` is a
  305-line wrapper. `ReviewSurface.tsx:3` is the repo's only
  `@pierre/diffs/react` import.
- `GitService.ts` (headless service) imports `GitReviewSession` from the
  view folder `review/reviewNavModel.ts`.
- Adversarially verified findings pending: no scroll spy, re-selecting the
  active file is a no-op, viewed state invisible in the nav tree, no
  single-child folder-chain compression, files/folders interleaved in tree
  sort, absolute history dates, load-more active while filtering,
  `requestSource()` dead alias, palette name "Open git tree / history",
  asymmetric deletions fallback in `buildReviewFile`.

## Decisions

- Rewrite `GitNavView`, `GitReviewView`, `ReviewSurface` as vanilla
  ItemView + direct DOM. The center diff uses the core `CodeView` class
  from `@pierre/diffs` (options per the established recipe:
  `collapsedContextThreshold: 12`, `expansionLineCount: 100`,
  `hunkSeparators: 'line-info-basic'`); no `@pierre/diffs/react` import
  remains anywhere.
- The `codiff-right-sidebar` feature contract stays authoritative for nav
  behavior: its selectors must still pass after the rewrite (test mounting
  may change; assertions must not weaken).
- Cross-leaf coordination keeps the `GitReviewSession` event-bus shape,
  hoisted to `apps/web/src/builtin/git/reviewSession.ts` so `GitService`
  never imports from the `review/` view folder. Selection becomes a
  re-triggerable activation event (fixes the active-file no-op), and a
  scroll spy derived from `CodeView.getTopForItem`/`getScrollTop` keeps the
  nav selection synced while reading (suppressed during programmatic
  scrolls).
- One interaction language across the git surface: an icon is a
  momentary ACTION (Refresh, Fetch/Pull/Push, Stage/Discard — all
  `clickable-icon` + tooltip); a persistent MODE is a click-to-flip
  toggle you can read at a glance; a git status is one colored letter
  (`A/D/M/R/U`), never a chip or a dot.
- Both mode switches live in the center leaf's VIEW-HEADER as single
  click-to-flip `addAction` icons (Obsidian reading-toggle idiom, left
  of "More options"): Tree ⟷ History drives the nav, Unified ⟷ Split
  drives the diff layout, plus Refresh. The surface renders no internal
  toolbar when the leaf owns the controls. The sidebar is a PURE list —
  no toggle chrome, no selection controls. (The PR "Files changed" tab
  embeds the surface in a sub-tab with no header of its own, so there
  the surface keeps its own toolbar for the Unified/Split flip.)
- The local review is VIEW-ONLY: diffs, the Viewed toggle, and
  navigation — nothing else. No Open, no Edit (and no
  accept/reject merge editor behind it), no inline comments. The shared
  `ReviewSurface` gates inline comments and the submit bar on the
  `review` prop, which only the cloud PR "Files changed" tab passes;
  the PR tab keeps its full code-review affordances.
- File headers are flat section rows (Obsidian nav/outline idiom), not
  GitHub cards: no rounded box, no accent ring — a hairline underneath,
  a subtle tint plus a 2px accent left rule for the active file. The
  `@pierre/diffs` engine renders the diff body (codiff-faithful); the
  chrome around it is Obsidian-native. Diff body = codiff, shell = Obsidian.
- Commit authoring is OUT of scope: this git surface reviews and
  navigates changes; it does not compose commits. No commit box, commit
  view, amend control, or file-selection commit affordance in any git
  UI. GitChangesView keeps stage/unstage/discard/sync (SCM ops) but no
  commit box; the headless `GitService.commit`/`amend` verbs remain,
  governed by the graduated local-git-surface-completion contract.
- The viewed toggle replicates codiff's check control (`wt-check`
  recipe): 18px rounded toggle, accent-filled with a check icon when on
  — no native checkboxes.
- The nav is self-sufficient (codiff parity): without a center leaf it
  computes its own file summaries (status + numstat, no diff bodies),
  and activating a file or history entry opens or surfaces the center.
- Review file loading is parallelized: per-file HEAD/working reads run
  through a bounded pool instead of a sequential loop.
- Jank guards: active-path sync between center and nav is imperative
  class toggling — never a full CodeView re-render or tree rebuild per
  scroll tick — and shiki highlighting runs in pierre's worker pool
  (3 workers, codiff's limits) off the main thread.
- File icons have one source of truth: the vanilla `@pierre/trees`
  `complete` icon resolver and built-in sprite replace the hand-maintained
  extension/name tables in `FileTypeIcon.ts`. Explorer, code tabs and Git tree
  consume the shared helper; no React wrapper is imported.
- Git tree file rows mirror codiff's semantic lanes in this order: file icon,
  filename, `+N −N` decoration, Git status letter (`A/D/M/R/U`). The old
  leading status dot is removed; status text and line counts remain separate.
- Nav tree fidelity fixes ride the rewrite: folders sort before files at
  every level, single-child folder chains compress into one row, viewed
  files render muted via viewed-state published on the session.
- History polish rides the rewrite: relative dates (hours-ago style, no
  new dependency), infinite-scroll load-more suppressed while a filter
  query is active.
- Mechanical cleanups: delete the `requestSource()` alias (callers use
  `setSource`), rename the palette command to "Open git navigator", restore
  the symmetric `.filter(Boolean)` deletions fallback in `buildReviewFile`.
- The three cloud shells are rewritten as vanilla ItemView + direct DOM at
  feature parity — behavior pinned by the existing
  `tests/web/builtin/github/` suites, whose assertions must not weaken.
  The client/service layer (`GitHubClient`, `GitHubService`, `types`,
  `prefs`, `patchUtils`, `resolveRepository`) does not change.
- The cloud PR "Files changed" tab keeps consuming the shared review
  surface — vanilla to vanilla, no adapter layer.
- `moment` is replaced by a local date helper (`Intl` + the relative-date
  formatter shared with the history list) and removed from package.json
  together with `react`, `react-dom` and their `@types`. The public API's
  `moment` export becomes a minimal compatibility shim (format-token
  subset + `isMoment`) — a deliberate fidelity reduction for community
  plugins, extended only when a real plugin needs more.
- A zero-react alarm joins `tests/architecture.test.ts`: any `react`,
  `react-dom` or `@pierre/diffs/react` import anywhere under `apps/` or
  `tests/`, or a react/moment entry in `apps/web/package.json`
  dependencies, fails the suite.
- `@pierre/trees@1.0.0-beta.5` is the only new production dependency and is
  consumed through its vanilla icon exports; automatic React peer installation
  remains disabled.

<!-- lint-ack: decision-coverage — GitReviewSession 决策由 nav-sync 三场景行为验证;reviewSession.ts 位置迁移属结构性调整,由 react-containment 警报与 guard 共同看护 -->
<!-- lint-ack: error-path — "blocked review empties the nav" 即失败路径(非 git 仓库);"filtering suppresses load-more" 为抑制性守卫路径,linter 关键词未识别 -->
<!-- lint-ack: bdd-implementation-detail-step — "without a click" 是 scroll-spy 行为的本质区分(滚动同步 vs 点击同步),非 UI 机械细节 -->
<!-- lint-ack: verification-metadata-suggestion — 卡片头显示路径是纯 DOM 渲染断言(jsdom 组件测试),无外部 I/O -->


## Boundaries

### Allowed Changes

- apps/web/src/builtin/git/**
- apps/web/src/builtin/github/**
- apps/web/src/builtin/FileExplorerView.ts
- apps/web/src/core/ApiUtils.ts
- apps/web/src/ui/FileTypeIcon.ts
- apps/web/src/ui/Icon.ts
- apps/web/src/views/CodeFileView.ts
- apps/web/src/styles/product/**
- apps/web/package.json
- package.json
- tests/package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- docs/architecture.md
- tests/web/builtin/git/**
- tests/web/builtin/FileExplorerView.test.ts
- tests/web/views/CodeFileView.test.ts
- tests/web/builtin/github/**
- tests/architecture.test.ts
- tests/e2e/desktop/specs/05-git.spec.ts

### Forbidden

- Do not change the cloud client/service layer (GitHubClient,
  GitHubService, types, prefs, patchUtils, resolveRepository) beyond what
  the shells' call sites already exercise.
- Do not add production dependencies other than `@pierre/trees@1.0.0-beta.5`.
- Do not weaken the codiff-right-sidebar contract's assertions or the
  existing github suite's assertions.
- Do not implement walkthrough or any agent narrative surface.

## Completion Criteria

### Rule: zero-react — the repo has no framework layer

Scenario: react imports anywhere trip the alarm (critical)
  Test: keeps the source tree free of react imports
  Given the source tree under apps and tests
  When the zero-react alarm scans import statements
  Then no file imports react, react-dom or the pierre react wrapper

Scenario: the dependency table is framework-free
  Test: keeps react and moment out of the dependency table
  Given apps/web/package.json
  When its dependencies and devDependencies are read
  Then react, react-dom and moment appear in neither table

Scenario: the review center is built on the core code view
  Test: uses the vanilla code view core in the review surface
  Given the rewritten review surface
  When the review center renders a change set
  Then it drives the core CodeView class and lists the changed files

### Rule: cloud-parity — the cloud shells survive their rewrite unchanged

Scenario: pull requests list at parity
  Test: lists pull requests in a repository tab
  Given a repo with open pull requests behind a fake transport
  When the navigator's pull-requests section renders
  Then each pull request appears with its number, title and state

Scenario: files tab at parity
  Test: renders PR metadata and files through the review surface
  Given a real-shaped PR detail payload
  When the PR detail's files tab opens
  Then the PR metadata and its diff render through the shared review surface

Scenario: commit detail at parity
  Test: renders commit diff via the shared review surface
  Given a commit with changed files behind a fake transport
  When the commit detail view opens
  Then the commit's file diffs render through the shared review surface

Scenario: signed-out state at parity
  Test: shows a connect prompt when unauthenticated
  Given no GitHub token in secret storage
  When the navigator opens
  Then the connect-GitHub prompt renders instead of repo content

Scenario: repo-less state at parity
  Test: shows the repository picker from the navigator action
  Given no selected repo and a vault without a GitHub origin
  When the navigator opens
  Then the repo picker renders instead of repo content

### Rule: nav-sync — the center and the right nav stay in lockstep

Scenario: scrolling the center updates the tree selection
  Test:
    Filter: updates nav selection while scrolling the code view
    Level: component
  Given a review with files a and b where b sits below the fold
  When the code view scrolls to bring file b to the reading position
  Then the session selected path becomes b without a click

Scenario: re-selecting the active file scrolls again
  Test:
    Filter: re-selecting the active file scrolls the code view again
    Level: component
  Given file a is the selected path and the user has scrolled away
  When the user activates file a in the nav tree again
  Then the code view receives a second scroll-to for file a

Scenario: review file contents load concurrently
  Test: loads review file contents concurrently
  Given a working-tree review with several changed files
  When the review loads
  Then the per-file content reads are issued before the first one resolves

Scenario: scroll selection sync never rebuilds the tree
  Test: updates tree selection without rebuilding rows
  Given a rendered tree row element
  When the selected path changes twice
  Then the same row element stays connected and only its selection class flips

Scenario: nav activation opens the missing center
  Test: opens the review center when activating from the nav
  Given the right nav is open with no review center leaf
  When the user activates a file in the tree
  Then a git-review leaf opens on the current source

Scenario: blocked review empties the nav
  Test: clears nav files when the review is blocked
  Given the session holds a previous file snapshot
  When the review loads against a vault that is not a repository
  Then the session file list becomes empty and the nav shows its empty state

### Rule: tree-fidelity — the nav tree reads like the reference

Scenario: folders sort before files at every level
  Test:
    Filter: orders folders before files at every level
    Level: unit
  Given changed paths zz.ts and lib/a.ts at the same level
  When the tree model is built
  Then the lib folder node precedes the zz.ts file node

Scenario: single-child folder chains compress
  Test: compresses single-child folder chains
  Given the only changed file is src/app/components/x.ts
  When the tree model is built
  Then one folder row named src/app/components contains x.ts

Scenario: the tree stays pure navigation
  Test: keeps the tree free of selection controls
  Given a working-tree review with the right nav open
  When Tree mode renders
  Then tree file rows carry no selection toggles or checkboxes

Scenario: no commit affordance in the git surface
  Test: keeps the git surface free of commit affordances
  Given the git core plugin is enabled
  When its views and commands are inspected
  Then no git-composer view, no git open-commit command, and no commit
  box in the changes view exist

Scenario: the local review is view-only
  Test: keeps the local review view only
  Given a working-tree review open in the center
  When its file headers and gutters render
  Then no Open or Edit action and no add-comment gutter appear

Scenario: mode switches sit in the leaf header
  Test: puts both mode switches in the leaf header
  Given a working-tree review open in the center
  When its view-header renders
  Then it holds a Tree/History flip toggle and a Unified/Split flip toggle
  and the surface renders no internal toolbar

Scenario: workspace tree icons come from the shared pierre resolver
  Test: uses pierre complete file icons in explorer rows
  Given TypeScript and Markdown files in the workspace explorer
  When their rows render
  Then their icons carry the pierre typescript and markdown tokens and colored palette surface

Scenario: git tree rows separate icon stats and status
  Test: shows icon stats and git status without a status dot
  Given a modified TypeScript file with one addition and two deletions
  When its Git tree row renders
  Then it shows the shared typescript icon, both line counts, and the modified status label
  And no leading status dot renders

Scenario: viewed files render muted in the tree
  Test: mutes viewed files in the nav tree
  Given file a is marked viewed in the review center
  When the nav tree renders
  Then the row for file a carries the viewed marker class

### Rule: history-polish — the history list is scannable

Scenario: history dates render relatively
  Test: formats history dates relatively
  Given a commit dated two hours before now
  When its history row renders
  Then the date reads as an hours-ago form instead of a calendar date

Scenario: filtering suppresses load-more
  Test: suppresses history load-more while filtering
  Given the history list has more commits to load
  When the user scrolls to the bottom with an active filter query
  Then no further log request is issued

### Rule: surface-cleanup — the seams left by the first draft close

Scenario: the navigator command is renamed
  Test: names the navigator command open git navigator
  Given the git core plugin is enabled
  When the palette command git:open-nav is looked up
  Then its display name is "Open git navigator"

Scenario: center cards keep their file path
  Test: keeps file paths on center diff cards
  Given the right nav owns the file list for the review
  When the center renders a file's diff card
  Then the card header shows that file's path

Scenario: the shell reads like the reference side by side
  Review: human
  Test: keeps file paths on center diff cards
  Given fresh real-app screenshots of the review center and right nav
  When they are compared against the reference screenshots
  Then the interaction language matches and the user signs off

Scenario: deletions fall back symmetrically
  Test: falls back to symmetric line counts
  Given a review file without numstat data whose old content ends in a newline
  When the review file model is built
  Then additions and deletions use the same non-empty-line counting rule

## Out of Scope

- Ownership-flip graduation of the cloud plugin onto the public API (its
  own goal; this rewrite removes the React entanglement it was waiting on).
- New cloud features or UX changes beyond parity (device-flow OAuth,
  section redesigns).
- Commit hook output display, buffered or streaming (rejected — commit
  failures already surface their error text; success output stays silent).
- Walkthrough / LLM narrative surfaces (rejected).

## Open Questions

None.
