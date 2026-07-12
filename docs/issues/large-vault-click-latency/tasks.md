---
artifact: tasks
goal: "large vault click latency"
status: active
derived_from:
  - spec.md
  - plan.md
---

# large vault click latency Tasks

> Link each implementation task to a Scenario name or Test selector from `spec.md`.

## Review Gate

- [x] Review `spec.md` and resolve every open question.
- [x] Review `plan.md` against the authoritative contract.

## Implementation

- [x] Cache the quick switcher item list per modal open. Covers: `Quick switcher reuses its item list across keystrokes`
- [x] MetadataCache trusts in-memory `TFile.stat` (mtime > 0). Covers: `Metadata indexing reuses in-memory file stats`, `Metadata indexing falls back to adapter stat when in-memory stat is unknown`
- [x] Adapter create/modified events carry the reconciled stat; Vault applies it without re-statting. Covers: `Vault applies adapter-provided stats without re-statting`

## Tests

- [x] Unit evidence for every Scenario (QuickSwitcher.test.ts, MetadataCache.test.ts, Vault.test.ts).
- [x] Focused + full `pnpm run test` (1495 passed), lint, typecheck.
- [x] Perf harness before/after recorded in spec.md Validation (switcher keystroke ~200ms -> ~33-45ms steady state).

## Documentation Impact

- [x] spec.md Validation section records measured results; no other maintained docs affected.

## Quality Gates

- [x] `agent-spec lint spec.md` (quality 100%)
- [x] `agent-spec lifecycle spec.md --code .` (4/4 passed)
- [ ] `agent-spec guard --spec-dir docs --code .` — fails on pre-existing
  `docs/specs/terminal-view.spec.md` (`inherits: project` unresolvable),
  unrelated to this goal; known guard-vs-historical-specs defect.
