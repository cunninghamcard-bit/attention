# 0004 — Adopt pnpm-workspace monorepo NOW (overrides single-package recommendation)

- **Question**: F1, target shape of src/ — single package + feature roof
  (recommended), monorepo packages now, or flat consolidation.
- **Recommendation**: Single package + kernel-flat + feature roof;
  graduate to packages when a second consumer appears (survey: 0/1
  consumers today; joplin/AFFiNE/element split for multi-target or npm
  publishing; outline deliberately stays single-package).
- **User's answer (2026-07-12)**: Split into monorepo packages NOW.
  Answer given after the full cost ledger was taught (whole-repo import
  rewrite, per-package configs, project references, slower inner loop,
  costlier future file moves across package boundaries) — an informed
  override, second round (first round was deferred pending research
  teaching).
- **Overrides**: research.md F1 recommendation and F3's "keep current
  root split" framing (root becomes packages/ + apps/).
- **Consequences to design next**: exact package topology (the first cut
  must be right), npm scope naming, where the feature roof lives
  (inside the renderer app package), how enforcement shifts (package
  dependency declarations become the primary mechanical boundary).
