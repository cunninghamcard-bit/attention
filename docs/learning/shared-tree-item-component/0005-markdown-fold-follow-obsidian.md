# 0005 — Markdown heading/list fold: follow Obsidian (stay separate)

**Question**: Fold the markdown heading/list collapse into the shared tree
component too?

**Recommendation**: Out of scope — it's an editor-integrated
`.collapse-indicator` mechanism, not a tree-item row.

**User's answer**: 对照着 obsidian 即可 (do what Obsidian does). Since
Obsidian keeps markdown fold on `.collapse-indicator` and does NOT route it
through its Tree component, the faithful answer is: the markdown fold stays
its own mechanism — OUT of the Tree class — while both remain faithful
Obsidian ports (they already share only the `right-triangle` atom).

**Overrides**: nothing new; refines "out of scope" to "separate by design,
mirroring Obsidian's own separation." Cites research.md F3.
