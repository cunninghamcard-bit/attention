# 0001 — Reference reading and scope (autonomous, /goal directive)

- **Goal (user, 2026-07-13)**: "make our git feature complete, reference
  the oh-my-github repo" — executed autonomously per the /goal hook.
- **Reference reading**: jiacai2050/oh-my-github manages the CLOUD side
  (repos/gists/stars sync) — and our builtin/github workspace already
  covers that loop (PRs/Commits/Branches/Issues/Actions/Files/Inbox,
  commits 29ba8df lineage). The actual gap was the LOCAL git surface:
  no sync verbs, no branch affordance, no discard, no amend.
- **Scope decisions (fixed in the contract)**: verb families
  fetch/pull(--ff-only)/push(auto -u)/branches/switch/create/discard
  (restore vs clean routing)/amend; branch/sync header + discard +
  amend in GitChangesView; FuzzySuggest branch switcher with create
  offer. OUT: merge-conflict UI, stash, repo-wide local log,
  history-view changes (already complete for its charter).
- **Proof**: 12 new unit tests (verbs + entry builder), lifecycle 9/9,
  and a desktop e2e on a REAL git-init'ed vault asserting header,
  sections and discard — first-try pass with screenshot.
