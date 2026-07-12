# 0010 — Rename to attention; code stays name-agnostic; publish to GitHub

- **User directive (2026-07-12)**: the project is renamed to
  "attention"; the CODE must contain no product name at all (a future
  rename must cost nothing); publish the repo to GitHub.
- **Consequences**:
  1. Package names use the neutral `@app/` scope (`@app/desktop`,
     `@app/web`, `@app/server`) instead of `@arkloop/*`.
  2. Debrand sweep: every `arkloop` literal leaves the tree — URL
     scheme constant (`scheme.ts`) becomes `workbench` (single source
     of truth already; tests that hardcode `arkloop://` strings update
     to read/expect the constant), perf env var `ARKLOOP_PERF` becomes
     `PERF_VAULT`, plus any app/product titles found by sweep.
     `obsidian` references stay — they describe the reconstruction
     source (a third-party compat concern), not our product name.
  3. The name "attention" itself also never enters the code or docs —
     it lives only in the GitHub repo name / remote URL.
- **Open item**: github.com/cunninghamcard-bit/attention ALREADY EXISTS
  (user's other project: "an agent form to help people to know their
  attention and intent"). Publishing under that name needs the user to
  resolve the collision (different name / replace / merge identities).
  Publishing decision: create as PRIVATE unless the user says public.
