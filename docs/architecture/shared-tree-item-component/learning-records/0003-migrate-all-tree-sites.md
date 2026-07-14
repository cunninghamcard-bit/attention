# 0003 — Migrate all tree sites in this goal

**Question**: Which of the ~13 hand-rolled tree sites adopt the shared
component in this goal vs deferred follow-ups?

**Recommendation**: Git surfaces + FileExplorer only, defer the peripheral
panes — to bound the blast radius.

**User's answer**: All 13 at once — "全部 13 处一次到位" (maximal
consistency). This OVERRIDES the bounded recommendation.

**Scope set** (every hand-rolled tree site → the shared component):
FileExplorerView, git/GitChangesView, git/GitLogView, git/GitHistoryView,
git/review/GitNavView, git/review/ReviewSurface, OutlineView, Bookmarks,
TagPaneView, BacklinksView, OutgoingLinksView, graph/GraphControls, and
`ui/NavFolder.ts` (folded into the new component). Cites research.md F1.
