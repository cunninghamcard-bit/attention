spec: task
name: "local git surface completion"
tags: [feature, git]
estimate: 0.5d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Complete the local-git side of the workspace to match the finished
Oh-My-GitHub-style cloud surface (builtin/github): the changes view gains a
branch/sync header and per-file discard, the service gains the missing
verb families (sync, branch, worktree), and commits can be amended. The
file-history view already fulfils its charter (read-at-commit and
diff-against-commit) and is out of scope.

## Current State

GitService covers status/stage/unstage/commit/log/diff-read plus the gh PR
family; GitChangesView renders staged/unstaged pierre diffs with a commit
box. Missing verbs: fetch, pull, push, branch list/current, switch, create,
discard, amend, divergence (ahead/behind). No branch or sync affordance in
any view; discarding a file requires the terminal.

## Decisions

- Verb set, service layer (`GitService`, same exec/error conventions as
  the existing verbs — booleans for simple verbs, error-string-or-null
  for verbs whose failure text matters): `fetch()`, `pull()`
  (`--ff-only`), `push()` (auto `-u origin <branch>` when no upstream),
  `currentBranch()`, `branches()`, `aheadBehind()` (null when no
  upstream), `switchBranch(name)`, `createBranch(name)`,
  `discard(entries)` (tracked → `restore --worktree`, untracked →
  `clean -f`), `commit(message, { amend })` extending the existing
  commit.
- Merge/rebase conflict resolution UI is OUT of scope (documented
  tradeoff: `pull --ff-only` refuses divergence with a readable error
  instead of starting a merge the UI cannot finish).
- GitChangesView header: branch pill (click opens the branch switcher),
  ahead/behind badge, fetch/pull/push actions with busy state; per-file
  discard action with a confirmation modal; amend checkbox on the
  commit box.
- Branch switcher is a FuzzySuggestModal listing local branches with a
  "create new branch" entry for unknown names (QuickSwitcher pattern);
  its entry-building logic is a pure exported function.
- Stash is OUT of scope for this goal (no consumer demand yet); the
  header verbs cover the sync loop.
- No new production dependencies; browser mode keeps reporting
  unavailable exactly like today.

## Boundaries

### Allowed Changes

- apps/web/src/builtin/git/**
- apps/web/src/styles/product/git-changes.css
- apps/web/src/styles/product/git-prs.css
- tests/web/builtin/git/**

### Forbidden

- Do not touch the gh PR family or the review surface behavior.
- Do not add production dependencies.
- Do not weaken existing tests.

## Completion Criteria

### Rule: sync-verbs — the sync loop is one header away

Scenario: branch and divergence are reported (critical)
  Test: reports branch and divergence
  Given a repository on branch main with an upstream two behind and one ahead
  When currentBranch and aheadBehind run
  Then the branch name is main and the divergence is ahead 1 behind 2

Scenario: pull fast-forwards and push sets upstream
  Test: pull fast-forwards and push sets upstream when missing
  Given a repository whose push has no upstream configured
  When pull and push run
  Then pull passes --ff-only and push retries with -u origin and the current branch

Scenario: sync failures surface as text
  Test: surfaces sync failures as error text
  Given a pull that exits non-zero with divergence advice on stderr
  When pull runs
  Then the returned error contains the git stderr text

### Rule: branch-verbs — switching is first-class

Scenario: branches list switch and create
  Test: lists switches and creates branches
  Given a repository with branches main and feature marked with HEAD
  When branches switchBranch and createBranch run
  Then the current branch is flagged and switch and create pass the right arguments

Scenario: switch failure propagates
  Test: propagates switch failure text
  Given a switch target that git rejects
  When switchBranch runs
  Then the returned error contains the git stderr text

Scenario: switcher offers creation for unknown names
  Test: offers a create entry for unknown branch names
  Given local branches main and feature
  When the switcher entries are built for query "hotfix"
  Then a create entry for hotfix appears after no name matches

### Rule: worktree-verbs — mistakes are recoverable

Scenario: discard routes tracked and untracked correctly
  Test: discards tracked edits and deletes untracked files
  Given a modified tracked file and an untracked file
  When discard runs on both
  Then the tracked file goes through restore worktree and the untracked one through clean

Scenario: amend rewrites the previous commit
  Test: amends the previous commit
  Given a staged fix and a previous commit
  When commit runs with amend
  Then git receives commit --amend and the commit event still fires

Scenario: amend failure returns the git error
  Test: returns amend failure text
  Given an amend that git rejects
  When commit runs with amend
  Then the returned error contains the git stderr text

## Out of Scope

- Merge/rebase conflict resolution UI.
- Stash family.
- Repo-wide local commit browser (the cloud Commits section covers it).
- File-history view changes (already complete for its charter).

## Open Questions

None.
