=== Contract ===

# Task Contract: Git History Avatars

## Intent
Show each local commit author's avatar in the Git history surfaces. Match Codiff's local-Git behavior: read the author name and email from `git log`, derive a Gravatar URL from the normalized email, and keep the author identifiable when the image cannot load.

## Current State
The Git history service reads author names but not emails. File History, Commit Log, and the Git review History sidebar currently render a generic person icon beside the author name.

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
- One app, one package: the repo root is the single application package; its
- The native seam is ports-and-adapters: the shell fills the ports the renderer
- Dual-track plugin architecture: `builtin/` is the internal track and may use
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only from
- Disk access stays in-process behind the `DataAdapter` seam in the renderer
- Unit tests are centralized under `tests/` (workspace member), mirroring
- The docs household is docwright goals under
- Extend the existing local Git log format with `%aE` and do not query GitHub or any remote repository API.
- Normalize the author email with `trim().toLowerCase()`, hash it with MD5 in the preload Git bridge using Node's standard library, and request `https://www.gravatar.com/avatar/<hash>?s=80&d=identicon`.
- Render the author's first visible character when no URL exists or the image emits an error.
- Reuse one Git avatar renderer across all three local history surfaces.

## Boundaries
Allowed changes:
- src/main/git-bridge.ts
- src/shared/gitApi.ts
- src/renderer/builtin/git/**
- src/renderer/styles/product/git-changes.css
- tests/desktop/git-bridge.test.ts
- tests/web/builtin/git/**
- docs/features/git-history-avatars/**
Forbidden:
- Do not call GitHub, `gh`, or a repository hosting API for avatars.
- Do not add a package dependency.
- Do not change faithful styles outside `src/renderer/styles/product/**`.
- Do not expose the commit author's email in rendered text or accessibility labels.
Out of scope:
- GitHub account lookup or GitHub profile avatars
- Persisting or prefetching avatar images
- Adding an avatar to the uncommitted working-tree row

## Completion Criteria

Rule: local-author-avatar — Derive avatars from local Git metadata
Scenario: Git log author email produces a Gravatar URL
  Test:
    Filter: hashes normalized Git author email for Gravatar
  Given a local commit author email with uppercase letters and surrounding whitespace
  When the preload Git bridge derives its avatar URL
  Then the URL contains the MD5 hash of the trimmed lowercase email
  And the URL requests an identicon fallback at size "80"

Scenario: Local history surfaces render author avatars
  Test:
    Filter: renders Git commit avatars with initial fallback
  Given a local Git log entry containing an author name, email, and derived avatar URL
  When Commit Log renders the entry
  Then the row contains an image for the derived Gravatar URL beside the author name

Scenario: Failed avatar image keeps the author identifiable
  Test:
    Filter: renders Git commit avatars with initial fallback
  Given a rendered local commit avatar
  When its image emits an error
  Then the image is removed and the author's first visible character remains

=== Codebase Context ===

Files (25):
  - docs/features/git-history-avatars/spec.md
  - src/renderer/builtin/git/BranchSwitchModal.ts
  - src/renderer/builtin/git/GitChangesView.ts
  - src/renderer/builtin/git/GitHistoryView.ts
  - src/renderer/builtin/git/GitLogView.ts
  - src/renderer/builtin/git/GitPlugin.ts
  - src/renderer/builtin/git/GitService.ts
  - src/renderer/builtin/git/relativeDate.ts
  - src/renderer/builtin/git/review/GitNavView.ts
  - src/renderer/builtin/git/review/GitReviewView.ts
  - src/renderer/builtin/git/review/ReviewSurface.ts
  - src/renderer/builtin/git/review/reviewModel.ts
  - src/renderer/builtin/git/review/reviewNavModel.ts
  - src/renderer/builtin/git/reviewSession.ts
  - tests/web/builtin/git/BranchSwitchModal.test.ts
  - tests/web/builtin/git/GitLogView.test.ts
  - tests/web/builtin/git/GitNativeViews.test.ts
  - tests/web/builtin/git/GitPlugin.test.ts
  - tests/web/builtin/git/GitService.test.ts
  - tests/web/builtin/git/GitThemeContract.test.ts
  - tests/web/builtin/git/review/GitNavView.test.ts
  - tests/web/builtin/git/review/GitReviewView.test.ts
  - tests/web/builtin/git/review/reviewModel.test.ts
  - tests/web/builtin/git/review/reviewNavModel.test.ts
  - tests/web/builtin/git/reviewSession.test.ts

=== Task Sketch ===

Group 1 (order 1):
  Scenarios:
    - Git log author email produces a Gravatar URL
    - Local history surfaces render author avatars
    - Failed avatar image keeps the author identifiable
  Boundary paths:
    - src/main/git-bridge.ts
    - src/shared/gitApi.ts
    - src/renderer/builtin/git/**
    - src/renderer/styles/product/git-changes.css
    - tests/desktop/git-bridge.test.ts
    - tests/web/builtin/git/**
    - docs/features/git-history-avatars/**
  Test selectors:
    - hashes normalized Git author email for Gravatar
    - renders Git commit avatars with initial fallback
    - renders Git commit avatars with initial fallback

=== Warnings ===

  - Allowed Changes path not found: tests/desktop/git-bridge.test.ts (resolved to ./tests/desktop/git-bridge.test.ts)
