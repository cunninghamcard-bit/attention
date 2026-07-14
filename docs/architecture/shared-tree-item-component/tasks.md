---
artifact: tasks
goal: "shared tree item component"
status: active
derived_from:
  - spec.md
  - plan.md
---

# shared tree item component Tasks

> Staged so every phase leaves the tree green (typecheck + affected suites)
> before the next. Each task links a Scenario/Test selector from spec.md.

## Review Gate

- [x] Review spec.md — no open questions (grilled: records 0001-0005).
- [x] Review plan.md against the contract.

## Phase 1 — Foundation (the TreeItem primitive)

- [ ] Build `src/renderer/ui/TreeItem.ts` (extends `Component`), faithful port
      of Obsidian: `el`/`selfEl`/`innerEl`/`childrenEl`/`collapseEl`,
      `setCollapsible`/`setCollapsed`/`addChild`/`onCollapseClick`, DOM
      tree-item/tree-item-self/tree-item-icon collapse-icon/tree-item-inner/
      tree-item-children. Covers: `exposes the Obsidian tree item surface`.
- [ ] Fold `ui/NavFolder.ts` into TreeItem; migrate its two consumers
      (FileExplorerView.renderFolder, GitLogView) to TreeItem; delete NavFolder.
      Covers: `replaces NavFolder with the tree item component`.
- [ ] Unit test TreeItem's DOM + methods; keep NavFolder.test → TreeItem.test.

## Phase 2 — Migration (remaining ~11 tree sites → TreeItem)

- [ ] git: GitChangesView, GitHistoryView, GitLogView (detail rows),
      review/GitNavView, review/ReviewSurface.
- [ ] panes: OutlineView, Bookmarks, TagPaneView, BacklinksView,
      OutgoingLinksView, graph/GraphControls.
      Covers: `builds every tree row through the shared tree item`.

## Phase 3 — Git Changes native structure

- [ ] Changes/Staged become collapsible TreeItem parents; file rows nested in
      tree-item-children. Covers: `nests Git Changes files under collapsible sections`.

## Phase 4 — Guards

- [ ] Alignment guard (shared-construction / equal-inset). Covers:
      `keeps tree rows aligned across views` (Review: human on the pixel gate).
- [ ] Markdown-fold-separation import guard. Covers:
      `keeps markdown fold off the tree component`.

## Quality Gates

- [ ] `pnpm run check` green (all existing suites preserved).
- [ ] e2e alignment probe: changes/log/explorer rows share one inset.
- [ ] `docwright lifecycle spec.md` (all non-human scenarios pass).
- [ ] `docwright guard --spec-dir docs --code .`
- [ ] stamp → commit → finish → (promote TreeItem rule to capabilities).
