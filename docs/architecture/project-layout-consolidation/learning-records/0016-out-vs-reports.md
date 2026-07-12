# 0016 — out/ is builds-only; reports get their own roof (user correction)

- **User (2026-07-13)**: "test outputs inside out/? that's wrong, no?"
  Correct — DeepChat's out/ (electron-vite) holds builds only; merging
  reports in conflated deliverables with look-then-discard observability.
- **Fix**: out/{web,desktop,server,api,types} = builds (things that run
  or ship); reports/{coverage, playwright, playwright-desktop,
  test-results, test-results-desktop} = test observability. Both
  gitignored. VAULT_INDEX_SKIP_NAMES deliberately does NOT gain
  "reports" — that name is too common in real user vaults to hide.
- **Overrides**: record 0014's single-roof choice for reports.
