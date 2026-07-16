---
artifact: tasks
goal: "appearance-theme-manager"
status: active
derived_from:
  - spec.md
  - plan.md
---

# appearance-theme-manager Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question.
- [x] Review `plan.md` against the authoritative contract.

## Implementation

- [x] Add the manager layout, action, fallback, and unified global Markdown rendering slices.
- [x] Delete `MarkdownBlockParser` and route block/inline rendering through one configured parser.

## Tests

- [x] Add component evidence for every Scenario.
- [x] Run focused and full tests for changed behavior, including the global Markdown renderer.

## Documentation Impact

- [x] Update the goal contract; no product documentation change is required.

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7`
- [x] `docwright lifecycle spec.md --code .` (8/8 scenarios passed)
- [ ] `docwright guard --spec-dir docs --code .` (full scan stalled; target lifecycle passed)
