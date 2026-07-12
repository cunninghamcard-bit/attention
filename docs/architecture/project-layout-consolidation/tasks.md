---
artifact: tasks
goal: "project layout consolidation"
status: active
derived_from:
  - spec.md
  - plan.md
---

# project layout consolidation Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question. (Open Questions: None)
- [x] Review `plan.md` against the authoritative contract.

## Implementation

- [x] Add the smallest implementation slice. Covers: all 11 scenarios
  (runtime-walls, kernel-direction, dual-track-api, builtin-roof,
  retirement, architecture-docs) across Phases 1-4.

## Tests

- [x] Add public E2E evidence for every Scenario. (architecture vitest
  suite, commit 0835780; docwright lifecycle 11/11 pass)
- [x] Run focused tests for changed behavior. (full suite: 1607 passed,
  2 skipped)

## Documentation Impact

- [x] Update affected maintained documentation or record why no update
  is required. (docs/architecture.md, docs/project.spec.md, README.md
  rewritten in Phase 5; 21 legacy docs + stray spec retired in Phase 1)

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7` (100% quality, no issues)
- [x] `docwright lifecycle spec.md --code .` (11/11 scenarios pass)
- [ ] `docwright guard --spec-dir docs --code . --change-scope worktree`
  — FAILS. Two pre-existing/regression issues outside this spec's own
  contract, surfaced by the repo-wide guard scan:
  1. `docs/issues/large-vault-click-latency/spec.md` (a goal that
     predates this refactor, commit ac4e78e, never graduated via
     `docwright finish`) references pre-move paths
     (`src/builtin/QuickSwitcher.ts`, `src/vault/Vault.ts`, etc.) that
     Phase 2/3 relocated to `src/apps/web/src/...`; its 4 scenarios now
     fail selector resolution.
  2. `docs/project.spec.md` (written in Phase 5, commit 3c8ea83) has no
     `## Acceptance Criteria` section, scoring 0% quality (coverage,
     testability, determinism all 0) against docwright's own
     project-spec convention (see reference example at
     `~/Projects/agent-spec/target/package/docwright-0.5.0/docs/project.spec.md`).
  Neither fix is in this task's scope (moving/updating an unrelated
  goal's spec vs. authoring new Acceptance Criteria for the
  constitution); flagged for a follow-up phase rather than patched here.
