# 0002 — Git Changes sections become collapsible tree parents

**Question**: Should the Changes/Staged sections in GitChangesView become
real collapsible tree parents with file rows nested in `.tree-item-children`
(the native source-control shape), or stay flat with only a gutter reserved
on leaf rows?

**Recommendation**: Collapsible + nested. It is the native Obsidian / VS
Code source-control shape and yields structural alignment for free (the
`.tree-item-children` indent + `.mod-collapsible` gutter come from shared
CSS), removing the flat-row special case.

**User's answer**: 要 (yes — collapsible sections, files nested).

**Overrides**: the current flat section layout in GitChangesView
(`renderSection` appends file rows as siblings of a non-collapsible
`.git-changes-section` header). Cites research.md F4.
