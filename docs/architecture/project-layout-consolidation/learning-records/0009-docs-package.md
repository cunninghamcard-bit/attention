# 0009 — F4: architecture docs package; terminal-view.spec.md deleted

- **Question**: New docs set — (1) docs/architecture.md (outline-style
  annotated tree + layer/direction table + runtime topology + dual-track
  + known tradeoffs, with docwright:governs markers), (2)
  docs/project.spec.md constitution (unblocks `inherits: project`),
  (3) README rewrite (product identity, points at architecture.md),
  (4) stray contract docs/specs/terminal-view.spec.md → relocate or
  delete.
- **Recommendation**: All four; relocate terminal-view to
  docs/features/terminal-view/spec.md.
- **User's answer (2026-07-12)**: Items 1–3 as proposed;
  terminal-view.spec.md just DELETE (git keeps history). guard goes
  green by removal rather than repair.
- **Overrides**: the relocate recommendation.
