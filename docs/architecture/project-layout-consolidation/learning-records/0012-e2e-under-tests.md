# 0012 — e2e moves under tests/ (completing centralization)

- **Question (user, 2026-07-12)**: shouldn't e2e also live inside tests/?
- **Answer**: yes — record 0011 had left e2e/ at root to avoid churning
  the texts that cite the perf command; the user called the asymmetry.
  Full DeepChat shape now: tests/{web,desktop,e2e}.
- **Moved**: e2e/ -> tests/e2e/ (git mv). Depth-sensitive REPO_ROOT
  computations in 3 files gained one "..; playwright testDirs, lint
  scope (e2e arg dropped — covered via tests), tsconfig.tools include,
  alarm scanDirs, spec.md constraint text, architecture.md tree all
  updated. Root tsconfig excludes tests/e2e (tools context owns it).
