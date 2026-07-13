=== Contract ===

# Task Contract: vanilla ui consolidation

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
  `GitNavView.tsx`, the last still uncommitted). `moment` is consumed by
  `GitPrViews.tsx` alone.
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

## Must
- pnpm is the only package manager; a preinstall hook rejects npm and yarn.
- Fail fast on product paths: a missing configuration raises an explicit
- The full vitest suite is green before any merge.
- Keep the perf budget on the 20k-file vault: openFile median under 50ms
- Code stays name-agnostic: no product-name literal appears anywhere in the

## Must NOT
- Do not add a production dependency without a goal contract that adopts it.
- Do not weaken, skip, or delete an existing test to make a gate pass.
- Do not source a default from anywhere but the user's explicit configuration.

## Decisions
- The workspace is three pnpm app packages — `@app/desktop`, `@app/web`,
- Dual-track plugin architecture: `builtin/` is the internal track and may
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only
- Disk access stays behind the `VaultAdapter` seam inside the web app.
- Unit tests are centralized under `tests/` (workspace member), mirroring
- The docs household is docwright goals under
- Rewrite `GitNavView`, `GitReviewView`, `ReviewSurface` as vanilla
- The `codiff-right-sidebar` feature contract stays authoritative for nav
- Cross-leaf coordination keeps the `GitReviewSession` event-bus shape,
- Interaction patterns and UI details replicate codiff wherever they
- Nav tree fidelity fixes ride the rewrite: folders sort before files at
- History polish rides the rewrite: relative dates (hours-ago style, no
- Mechanical cleanups: delete the `requestSource()` alias (callers use
- The three cloud shells are rewritten as vanilla ItemView + direct DOM at
- The cloud PR "Files changed" tab keeps consuming the shared review
- `moment` is replaced by a local date helper (`Intl` + the relative-date
- A zero-react alarm joins `tests/architecture.test.ts`: any `react`,
- No new production dependencies.

## Boundaries
Allowed changes:
- apps/web/src/builtin/git/**
- apps/web/src/builtin/github/**
- apps/web/src/styles/product/**
- apps/web/package.json
- pnpm-lock.yaml
- tests/web/builtin/git/**
- tests/web/builtin/github/**
- tests/architecture.test.ts
- tests/e2e/desktop/specs/05-git.spec.ts
Forbidden:
- Do not change the cloud client/service layer (GitHubClient,
- Do not add production dependencies.
- Do not weaken the codiff-right-sidebar contract's assertions or the
- Do not implement walkthrough or any agent narrative surface.
Out of scope:
- Ownership-flip graduation of the cloud plugin onto the public API (its
- New cloud features or UX changes beyond parity (device-flow OAuth,
- Commit hook output display, buffered or streaming (rejected — commit
- Walkthrough / LLM narrative surfaces (rejected).

## Completion Criteria

Rule: zero-react — the repo has no framework layer
Scenario: react imports anywhere trip the alarm (critical)
  Test:
    Filter: keeps the source tree free of react imports
  Given the source tree under apps and tests
  When the zero-react alarm scans import statements
  Then no file imports react, react-dom or the pierre react wrapper

Scenario: the dependency table is framework-free
  Test:
    Filter: keeps react and moment out of the dependency table
  Given apps/web/package.json
  When its dependencies and devDependencies are read
  Then react, react-dom and moment appear in neither table

Scenario: the review center is built on the core code view
  Test:
    Filter: uses the vanilla code view core in the review surface
  Given the rewritten review surface
  When the review center renders a change set
  Then it drives the core CodeView class and lists the changed files


Rule: cloud-parity — the cloud shells survive their rewrite unchanged
Scenario: pull requests list at parity
  Test:
    Filter: lists pull requests for the selected repo
  Given a repo with open pull requests behind a fake transport
  When the PR list renders
  Then each pull request appears with its number, title and state

Scenario: files tab at parity
  Test:
    Filter: opens files tab with tree and renders PR metadata from real shape
  Given a real-shaped PR detail payload
  When the files tab opens
  Then the changed-file tree and the PR metadata render

Scenario: commit detail at parity
  Test:
    Filter: opens commit detail with files
  Given a commit with changed files behind a fake transport
  When the commit detail view opens
  Then the commit message and its file diffs render

Scenario: signed-out state at parity
  Test:
    Filter: shows sign-in when no token is stored
  Given no GitHub token in secret storage
  When the cloud workspace opens
  Then the sign-in prompt renders instead of repo content

Scenario: repo-less state at parity
  Test:
    Filter: shows repo picker when no repo is selected and no origin
  Given no selected repo and a vault without a GitHub origin
  When the cloud workspace opens
  Then the repo picker renders instead of repo content


Rule: nav-sync — the center and the right nav stay in lockstep
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

Scenario: blocked review empties the nav
  Test:
    Filter: clears nav files when the review is blocked
  Given the session holds a previous file snapshot
  When the review loads against a vault that is not a repository
  Then the session file list becomes empty and the nav shows its empty state


Rule: tree-fidelity — the nav tree reads like the reference
Scenario: folders sort before files at every level
  Test:
    Filter: orders folders before files at every level
    Level: unit
  Given changed paths zz.ts and lib/a.ts at the same level
  When the tree model is built
  Then the lib folder node precedes the zz.ts file node

Scenario: single-child folder chains compress
  Test:
    Filter: compresses single-child folder chains
  Given the only changed file is src/app/components/x.ts
  When the tree model is built
  Then one folder row named src/app/components contains x.ts

Scenario: the tree tab owns the commit composer
  Test:
    Filter: hosts the commit composer in the tree tab
  Given a working-tree review with the right nav open
  When Tree mode renders
  Then tree file rows carry selection checkboxes and the composer with

Scenario: viewed files render muted in the tree
  Test:
    Filter: mutes viewed files in the nav tree
  Given file a is marked viewed in the review center
  When the nav tree renders
  Then the row for file a carries the viewed marker class


Rule: history-polish — the history list is scannable
Scenario: history dates render relatively
  Test:
    Filter: formats history dates relatively
  Given a commit dated two hours before now
  When its history row renders
  Then the date reads as an hours-ago form instead of a calendar date

Scenario: filtering suppresses load-more
  Test:
    Filter: suppresses history load-more while filtering
  Given the history list has more commits to load
  When the user scrolls to the bottom with an active filter query
  Then no further log request is issued


Rule: surface-cleanup — the seams left by the first draft close
Scenario: the navigator command is renamed
  Test:
    Filter: names the navigator command open git navigator
  Given the git core plugin is enabled
  When the palette command git:open-nav is looked up
  Then its display name is "Open git navigator"

Scenario: center cards keep their file path
  Test:
    Filter: keeps file paths on center diff cards
  Given the right nav owns the file list for the review
  When the center renders a file's diff card
  Then the card header shows that file's path

Scenario: deletions fall back symmetrically
  Test:
    Filter: falls back to symmetric line counts
  Given a review file without numstat data whose old content ends in a newline
  When the review file model is built
  Then additions and deletions use the same non-empty-line counting rule

=== Codebase Context ===

Files (45):
  - apps/web/src/builtin/git/BranchSwitchModal.ts
  - apps/web/src/builtin/git/GitChangesView.ts
  - apps/web/src/builtin/git/GitHistoryView.ts
  - apps/web/src/builtin/git/GitLogView.ts
  - apps/web/src/builtin/git/GitPlugin.ts
  - apps/web/src/builtin/git/GitService.ts
  - apps/web/src/builtin/git/review/GitNavView.tsx
  - apps/web/src/builtin/git/review/GitReviewView.tsx
  - apps/web/src/builtin/git/review/ReviewSurface.tsx
  - apps/web/src/builtin/git/review/reviewModel.ts
  - apps/web/src/builtin/git/review/reviewNavModel.ts
  - apps/web/src/builtin/github/GitHubClient.ts
  - apps/web/src/builtin/github/GitHubExtraPanels.tsx
  - apps/web/src/builtin/github/GitHubPlugin.ts
  - apps/web/src/builtin/github/GitHubService.ts
  - apps/web/src/builtin/github/GitHubWorkspace.tsx
  - apps/web/src/builtin/github/GitPrViews.tsx
  - apps/web/src/builtin/github/patchUtils.ts
  - apps/web/src/builtin/github/prefs.ts
  - apps/web/src/builtin/github/resolveRepository.ts
  - apps/web/src/builtin/github/types.ts
  - apps/web/src/styles/product/code-view.css
  - apps/web/src/styles/product/diff.css
  - apps/web/src/styles/product/explorer.css
  - apps/web/src/styles/product/git-changes.css
  - apps/web/src/styles/product/git-prs.css
  - apps/web/src/styles/product/git-review.css
  - apps/web/src/styles/product/starter.css
  - apps/web/src/styles/product/terminal.css
  - apps/web/src/styles/product/theme-market.css
  - tests/web/builtin/git/BranchSwitchModal.test.ts
  - tests/web/builtin/git/GitLogView.test.ts
  - tests/web/builtin/git/GitPlugin.test.ts
  - tests/web/builtin/git/GitService.test.ts
  - tests/web/builtin/git/review/GitNavView.test.tsx
  - tests/web/builtin/git/review/GitReviewView.test.tsx
  - tests/web/builtin/git/review/reviewModel.test.ts
  - tests/web/builtin/git/review/reviewNavModel.test.ts
  - tests/web/builtin/github/GitHubClient.test.ts
  - tests/web/builtin/github/GitHubWorkspace.test.tsx
  - tests/web/builtin/github/GitPrViews.test.tsx
  - tests/web/builtin/github/commits.test.ts
  - tests/web/builtin/github/extraApi.test.ts
  - tests/web/builtin/github/patchUtils.test.ts
  - tests/web/builtin/github/resolveRepository.test.ts

=== Task Sketch ===

Group 1 (order 1):
  Scenarios:
    - react imports anywhere trip the alarm (critical)
    - the dependency table is framework-free
    - the review center is built on the core code view
    - pull requests list at parity
    - files tab at parity
    - commit detail at parity
    - signed-out state at parity
    - repo-less state at parity
    - scrolling the center updates the tree selection
    - re-selecting the active file scrolls again
    - blocked review empties the nav
    - folders sort before files at every level
    - single-child folder chains compress
    - the tree tab owns the commit composer
    - viewed files render muted in the tree
    - history dates render relatively
    - filtering suppresses load-more
    - the navigator command is renamed
    - center cards keep their file path
    - deletions fall back symmetrically
  Boundary paths:
    - apps/web/package.json
  Test selectors:
    - keeps the source tree free of react imports
    - keeps react and moment out of the dependency table
    - uses the vanilla code view core in the review surface
    - lists pull requests for the selected repo
    - opens files tab with tree and renders PR metadata from real shape
    - opens commit detail with files
    - shows sign-in when no token is stored
    - shows repo picker when no repo is selected and no origin
    - updates nav selection while scrolling the code view
    - re-selecting the active file scrolls the code view again
    - clears nav files when the review is blocked
    - orders folders before files at every level
    - compresses single-child folder chains
    - hosts the commit composer in the tree tab
    - mutes viewed files in the nav tree
    - formats history dates relatively
    - suppresses history load-more while filtering
    - names the navigator command open git navigator
    - keeps file paths on center diff cards
    - falls back to symmetric line counts

