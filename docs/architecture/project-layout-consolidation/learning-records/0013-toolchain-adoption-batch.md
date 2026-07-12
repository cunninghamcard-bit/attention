# 0013 — Toolchain adoption batch (DeepChat alignment, "now" tier)

- **User (2026-07-12)**: taught the full remaining-alignment ledger
  (18 items); approved the four light adoptions now, the heavy set as a
  future goal, packaging/release family deferred until distribution.
- **Adopted now**:
  1. oxfmt formatter — one-time big-bang reformat (448 files, commit in
     .git-blame-ignore-revs), format:check joins the check chain.
  2. commitlint (@commitlint/config-conventional, ESM config) +
     scripts/hooks/commit-msg + `hooks:install` script installing both
     hooks (docwright pre-commit guard + commit-msg lint) — one command
     per fresh clone, unlike DeepChat's opt-in-and-forget.
  3. engines (node >=26, pnpm >=11) + packageManager field — mise.toml
     already pins exact versions; these enforce for non-mise users.
  4. IPC channel freeze alarm — createIpcHandlers imported live under a
     lazy proxy stub + regex over the three electron-bound files;
     24-channel baseline; growth requires editing the baseline in the
     same commit.
- **Future goal (SDD contract when picked up)**: per-environment
  tsconfig split + strictness ratchet, vitest projects (jsdom/node),
  CI workflow, coverage ratchet, tests for build scripts.
- **Deliberately not adopted**: electron.vite single-config (single-
  package assumption vs our lanes), docs/archives (git is history).
