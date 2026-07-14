# 0004 — Shape: a Tree/TreeItem class mirroring Obsidian

**Question**: Functional factory (generalize `createNavFolder`) or a
`Tree`/`TreeItem` class mirroring Obsidian?

**Recommendation**: Functional factory — matches the codebase's vanilla
factory idiom.

**User's answer**: A `Tree`/`TreeItem` class, 照抄 Obsidian (mirror its real
API). This OVERRIDES the factory recommendation.

**Consequence**: the class API must be a faithful port of Obsidian's real
Tree/TreeItem (addChild, setCollapsed, collapseEl, self/inner/children
elements, mod-collapsible), verified code-to-code against decode-obsidian —
not invented. `ui/NavFolder.ts` collapses into `TreeItem`. Cites
research.md F2 + the decode-obsidian rule.
