---
artifact: tasks
goal: "Obsidian Community Plugins Parity"
status: active
derived_from:
  - spec.md
  - plan.md
---

# Obsidian Community Plugins Parity Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question.
- [x] Review `plan.md` against the authoritative contract.

## Implementation

- [x] Port the Community plugins marketplace grid, detail selection, README media,
      and retry behavior from Obsidian. Covers: `opens marketplace as an unselected
    Obsidian grid`, `sets the search query from a missing auto-open plugin id
    instead of selecting the first item`, `selects a plugin into Obsidian detail
    layout`, `resolves plugin README media against repository HEAD`, and `shows
    catalog load errors and retries from the modal`.
- [x] Port the enabled and restricted Community plugins settings surfaces from
      Obsidian. Covers: `renders enabled settings in Obsidian order with installed
    plugin controls` and `renders Obsidian restricted-mode disclaimer and exits
    from the CTA`.

## Tests

- [x] Add public E2E evidence for every Scenario.
- [x] Run focused tests for changed behavior.

## Documentation Impact

- [x] No maintained product documentation changes are required; this ports an
      existing built-in surface without changing its public API.

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7`
- [x] `docwright lifecycle spec.md --code .`
- [x] `docwright guard` scoped to this goal and its allowed changed files
