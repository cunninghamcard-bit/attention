---
artifact: tasks
goal: "vanilla ui consolidation"
status: active
derived_from:
  - spec.md
  - plan.md
---

# vanilla ui consolidation Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question.
- [x] Review `plan.md` against the authoritative contract.

## Phase 1 — local surface (review center + right nav, vanilla)

- [x] Replace the shared hard-coded file icon table with the vanilla Pierre complete resolver; use it in explorer, code tabs and Git tree. Render Git tree rows as icon/name, line-count decoration and Git status letter, with no status dot. Covers: `workspace tree icons come from the shared pierre resolver`, `git tree rows separate icon stats and status`.
- [x] Hoist `GitReviewSession` (+ source/mode types) to `builtin/git/reviewSession.ts`; add re-triggerable path activation (seq). Covers: `re-selecting the active file scrolls again`, GitService view-folder decoupling.
- [x] Rewrite `GitNavView` as vanilla ItemView, codiff replica: labeled Tree | History tabs, filter, tree with commit checkboxes + composer at the tab bottom, history list. Covers: `the tree tab owns the commit composer`, `viewed files render muted in the tree`, `history dates render relatively`, `filtering suppresses load-more`.
- [x] Rewrite tree model: folders-before-files sort, single-child chain compression. Covers: `orders folders before files at every level`, `compresses single-child folder chains`.
- [x] Rewrite `ReviewSurface` + `GitReviewView` on the core `CodeView` class (recipe options preserved); center becomes a pure diff surface with per-card paths; scroll spy with programmatic-scroll suppression. Covers: `uses the vanilla code view core in the review surface`, `updates nav selection while scrolling the code view`, `keeps file paths on center diff cards`, `clears nav files when the review is blocked`.
- [x] Mechanical cleanups: delete `requestSource`, rename command to "Open git navigator", restore symmetric deletions fallback. Covers: `names the navigator command open git navigator`, `falls back to symmetric line counts`.
- [x] Keep the codiff-right-sidebar contract green (assertions unweakened); adapt test mounting to vanilla.

## Phase 2 — cloud shells (parity transcription)

- [x] Rewrite `GitHubExtraPanels` vanilla (smallest shell, establishes the pattern). Covers: `cloud-parity` (issues/actions/files/inbox panels).
- [x] Rewrite `GitHubWorkspace` + `GitCommitView` vanilla. Covers: `opens commit detail with files`, `shows sign-in when no token is stored`, `shows repo picker when no repo is selected and no origin`.
- [x] Rewrite `GitPrViews` vanilla; replace moment with the shared relative-date helper. Covers: `lists pull requests for the selected repo`, `opens files tab with tree and renders PR metadata from real shape`.

## Phase 3 — uproot

- [x] Remove react, react-dom, their @types and moment from package manifests; disable automatic peer installation and refresh the lockfile. Covers: `keeps react and moment out of the dependency table`.
- [x] Add the zero-react alarm to tests/architecture.test.ts. Covers: `keeps the source tree free of react imports`.
- [x] Extend tests/e2e/desktop/specs/05-git.spec.ts to drive the new shell (open review, assert right nav, screenshot).

## Tests

- [x] Every scenario selector green via `pnpm vitest run -t "{selectors}"` (report mode).
- [x] Full unit suite + perf harness (openFile < 50ms budget) green.

## Documentation Impact

- [x] architecture.md gains the zero-react rule; no other maintained doc affected.

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7`
- [x] `docwright lifecycle spec.md --code .`
- [x] `docwright guard --spec-dir docs --code .`
