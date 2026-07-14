# 0001 — Adopt a shared tree-item component (direction A)

**Question**: Consolidate every collapse/tree row onto one shared component
(A), or just patch the Git Changes view's 37px misalignment with CSS (B)?

**Recommendation**: A. The misalignment is a symptom of ~13 views each
hand-rolling their own tree DOM; Obsidian itself ships ONE shared Tree
primitive (`setCollapsed`/`addChild`/`collapseEl`/`tree-item-children` in
app.js) and lets shared CSS align everything. We already ported the CSS but
not the component.

**User's answer**: A — "这是个架构上的决策，我们需要实现最佳实践."

**Overrides**: the minimal CSS-patch option (B); also promotes
`ui/NavFolder.ts` from a folder-only helper to the seed of the general
component. Cites research.md Industry Norms + Current Codebase State.
