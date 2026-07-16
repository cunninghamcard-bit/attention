spec: task
name: "Git History Avatars"
inherits: project
tags: [feature, git, ui]
test_command: pnpm vitest run tests/desktop/git-bridge.test.ts tests/web/builtin/git/GitNativeViews.test.ts -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Show each local commit author's avatar in the Git history surfaces. Match Codiff's local-Git behavior: read the author name and email from `git log`, derive a Gravatar URL from the normalized email, and keep the author identifiable when the image cannot load.

## Current State

The Git history service reads author names but not emails. File History, Commit Log, and the Git review History sidebar currently render a generic person icon beside the author name.

## Decisions

- Extend the existing local Git log format with `%aE` and do not query GitHub or any remote repository API.
- Normalize the author email with `trim().toLowerCase()`, hash it with MD5 in the preload Git bridge using Node's standard library, and request `https://www.gravatar.com/avatar/<hash>?s=80&d=identicon`.
- Render the author's first visible character when no URL exists or the image emits an error.
- Reuse one Git avatar renderer across all three local history surfaces.

## Boundaries

### Allowed Changes
- src/main/git-bridge.ts
- src/shared/gitApi.ts
- src/renderer/builtin/git/**
- src/renderer/styles/product/git-changes.css
- tests/desktop/git-bridge.test.ts
- tests/web/builtin/git/**
- docs/features/git-history-avatars/**

### Forbidden
- Do not call GitHub, `gh`, or a repository hosting API for avatars.
- Do not add a package dependency.
- Do not change faithful styles outside `src/renderer/styles/product/**`.
- Do not expose the commit author's email in rendered text or accessibility labels.

## Completion Criteria

### Rule: local-author-avatar — Derive avatars from local Git metadata
Scenario: Git log author email produces a Gravatar URL
  Test: hashes normalized Git author email for Gravatar
  Given a local commit author email with uppercase letters and surrounding whitespace
  When the preload Git bridge derives its avatar URL
  Then the URL contains the MD5 hash of the trimmed lowercase email
  And the URL requests an identicon fallback at size "80"

Scenario: Local history surfaces render author avatars
  Test: renders Git commit avatars with initial fallback
  Given a local Git log entry containing an author name, email, and derived avatar URL
  When Commit Log renders the entry
  Then the row contains an image for the derived Gravatar URL beside the author name

Scenario: Failed avatar image keeps the author identifiable
  Test: renders Git commit avatars with initial fallback
  Given a rendered local commit avatar
  When its image emits an error
  Then the image is removed and the author's first visible character remains

## Out of Scope

- GitHub account lookup or GitHub profile avatars
- Persisting or prefetching avatar images
- Adding an avatar to the uncommitted working-tree row

## Questions

None.
