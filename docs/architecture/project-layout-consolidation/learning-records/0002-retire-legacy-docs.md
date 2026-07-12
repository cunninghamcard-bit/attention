# 0002 — Retire all legacy docs; rewrite architecture docs from code

- **Question**: Disposition of the 16 study-era docs (reading-order,
  reverse-evidence, completeness-matrix, final-handoff…) and 5 design-note
  docs (chat-view-design, kernel-notes, ownership-flip, composer-roadmap,
  dagu-notes) in docs/.
- **Recommendation**: Triage per doc — absorb still-accurate content
  (extension-points, plugin-api) into the new docs, retire the rest.
- **User's answer (2026-07-12)**: Retire ALL of them; write the new
  architecture docs from the code, from scratch. Git keeps history —
  consistent with the docwright "no archive directories" philosophy.
- **Overrides**: the triage recommendation.
- **Open sub-item**: docs/specs/terminal-view.spec.md is a docwright
  contract, not prose — relocate-or-retire decided in F4's grill.
