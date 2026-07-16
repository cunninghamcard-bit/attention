---
artifact: tasks
goal: "GitHub Device Login"
status: active
derived_from:
  - spec.md
  - plan.md
---

# GitHub Device Login Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question.
- [x] Review `plan.md` against the authoritative contract.

## Implementation

- [x] Add Device Flow start/poll/persist to `GitHubService`. Covers: service scenarios.
- [x] Replace the PAT-only card with OAuth-primary/PAT-fallback UI. Covers: login-surface scenarios.

## Tests

- [x] Add focused service and DOM evidence for every Scenario.
- [x] Run focused tests for changed behavior.

## Documentation Impact

- [x] Record build-time client-ID configuration and behavior in `spec.md`; no other maintained docs describe GitHub auth.

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7`
- [x] `docwright lifecycle spec.md --code .`
- [x] `docwright guard --spec-dir docs --code .`
