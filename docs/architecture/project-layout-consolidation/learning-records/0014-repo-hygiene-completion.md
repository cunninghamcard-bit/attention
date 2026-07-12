# 0014 — Repo hygiene completion (user audit: "not done yet")

- **User (2026-07-12)**: pointed at remaining root scatter — transient
  report dirs, no .github, hooks invisible in .git/hooks, "mocks".
- **Done**:
  1. Transient outputs consolidated under gitignored `out/`
     (playwright html reports, test-results, vitest coverage); stale
     root dirs removed. Build outputs (dist, dist-electron,
     dist-server) deliberately stay: their locations are launch-path
     coupled (package.json main, electron loadFile, e2e fixtures) and
     belong to the future packaging goal.
  2. Hooks become the TRACKED `.githooks/` dir (DeepChat pattern) armed
     via `core.hooksPath`; a `prepare` script auto-arms every fresh
     clone on install — closing DeepChat's own gap (theirs is opt-in
     and forgettable). scripts/hooks/ and .git/hooks copies removed.
  3. `.github/workflows/ci.yml`: full gate battery on push/PR — lint,
     format, all four typechecks, full vitest suite (the gate DeepChat
     itself skips in CI), all four builds. Follow-ups noted in-file:
     docwright guard needs a cargo step; e2e/perf need xvfb.
  4. Mocks: checked — tests/web/setup.ts is 32 lines with zero global
     mocks; we inject fakes per-seam (VaultAdapter etc.), so DeepChat's
     test/mocks/ layer has no counterpart to create.
