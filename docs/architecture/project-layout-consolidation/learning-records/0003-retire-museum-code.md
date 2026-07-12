# 0003 — Retire study-era museum code, including App.ts wiring

- **Question**: Disposition of study-era code: src/meta/
  (ArchitectureCatalog, LearningPath, CompletenessMatrix, ProjectStatus)
  and src/scenarios/ (exported only by src/index.ts, no product
  importers), plus src/docs/ApiDocGenerator and src/query/QueryEngine
  (wired into src/app/App.ts).
- **Recommendation**: Retire the pure museum pieces now; defer the two
  App-wired ones to a separate assessment.
- **User's answer (2026-07-12)**: Retire ALL of it in this refactor,
  including detaching the ApiDocGenerator/QueryEngine wiring from App.ts.
- **Overrides**: the defer-the-wired-ones recommendation.
