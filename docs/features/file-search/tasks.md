---
artifact: tasks
goal: "file-search"
status: active
derived_from:
  - spec.md
  - plan.md
---

# file-search Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question.
- [x] Review `plan.md` against the authoritative contract.

## Implementation

- [x] Complete the Obsidian-shaped search view, persisted controls, grouped results,
      exact result navigation, and stale/error handling. Covers: all five scenarios in `spec.md`.

## Tests

- [x] Add component evidence for every Scenario in `tests/web/builtin/SearchView.test.ts`.
- [x] Run focused tests for changed behavior.

## Documentation Impact

- [x] Keep the completed behavior and boundaries recorded in `spec.md` and `plan.md`.

## Quality Gates

- [ ] `docwright lint spec.md --min-score 0.7`
- [ ] `docwright lifecycle spec.md --code .`
- [ ] `docwright guard --spec-dir . --code .`
