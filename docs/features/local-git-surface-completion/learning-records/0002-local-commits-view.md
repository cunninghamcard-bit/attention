# 0002 — User overturned the "cloud Commits covers it" tradeoff

- **User (2026-07-13)**: "how come the commit feature is also cloud?" —
  correct: commit history is local-first data; `git log` works offline.
  The contract's Out-of-Scope line ("repo-wide local commit browser —
  the cloud Commits section covers it") is withdrawn.
- **Decision**: a `git-log` view under the git core plugin: repo-wide
  log, expandable per-commit file lists (status+numstat merged by a
  pure helper), inline pierre diff per file against the parent (root
  commits against empty). Zero network.
