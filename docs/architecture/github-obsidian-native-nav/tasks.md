---
artifact: tasks
goal: "github-obsidian-native-nav"
status: active
derived_from:
  - spec.md
  - plan.md
---

# github-obsidian-native-nav Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [ ] Review `spec.md` and resolve every open question.
- [ ] Review `plan.md` against the authoritative contract.

## Implementation

- [ ] Add the smallest implementation slice. Covers: `<Scenario or Test selector>`

## Tests

- [ ] Add public E2E evidence for every Scenario.
- [ ] Run focused tests for changed behavior.

## Documentation Impact

- [ ] Update affected maintained documentation or record why no update is required.

## Quality Gates

- [ ] `pnpm vitest run tests/web/builtin/github/` passes (spec scenarios green)
