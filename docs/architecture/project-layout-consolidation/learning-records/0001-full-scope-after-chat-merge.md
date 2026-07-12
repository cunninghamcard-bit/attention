# 0001 — Full-scope refactor unblocked by merging feat/chat-view

- **Question**: Physical scope of the layout refactor, given feat/chat-view
  (84 commits ahead) would become unmergeable under a mass src/ file move.
- **Recommendation**: Phase it — docs+root first, src/ moves after the chat
  branch merges.
- **User's answer (2026-07-12)**: Merge chat first, then refactor at full
  scope. Merge executed as a pure fast-forward (merge-base == main tip,
  gates all green on the branch): main 13aa394 → f3c31bb.
- **Overrides**: the phased recommendation; also supersedes the earlier
  session's standing instruction "update chat but do not merge it".
- **Residual constraint**: feat/github-pr-cloud (another session's active
  branch, 3 commits ahead) — coordinate or let it land before executing
  src/ file moves. **RESOLVED same day**: that session merged its branch
  into main itself (4550ed9, adds src/github). No live branch blocks
  src/ moves anymore.
