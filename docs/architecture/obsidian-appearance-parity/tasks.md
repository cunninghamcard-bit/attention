---
artifact: tasks
goal: "obsidian appearance parity"
status: active
derived_from:
  - spec.md
  - plan.md
---

# obsidian appearance parity Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question.
- [x] Review `plan.md` against the authoritative contract.

## Implementation

- [x] Align the Appearance settings tab with Obsidian's native setting DOM, controls, and spacing. Covers: `appearance-native-structure`, `appearance-theme-management`, `appearance-css-management`.
- [x] Audit the active Primary theme against local Git surfaces and identify the non-inheriting Pierre diff boundary. Covers: `git-theme-inheritance`.
- [x] Bridge Obsidian semantic tokens into local Pierre diff hosts without theme-specific selectors or shadow-DOM reach-in. Covers: `bridges Obsidian theme tokens into git diff hosts`.
- [x] Refresh mounted `CodeView` and `FileDiff` instances on workspace `css-change`. Covers: `refreshes mounted review diffs when the theme changes`, `refreshes mounted file diffs on css-change`.
- [x] Remove literal palette colors from local Git chrome. Covers: `keeps local git chrome free of literal palette colors`.

## Tests

- [x] Add executable evidence for all 18 Scenarios.
- [x] Run focused Git theme and review tests (92 tests).
- [x] Run the complete renderer test suite (178 files, 1620 tests).

## Documentation Impact

- [x] Record the Git theme inheritance boundary and runtime refresh decisions in `spec.md` and `docs/architecture.md`.

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7`
- [x] `docwright lifecycle spec.md --code .` (18/18 passed)
- [x] `docwright guard --spec-dir docs/architecture/obsidian-appearance-parity --code . --change-scope worktree --min-score 0.7`
