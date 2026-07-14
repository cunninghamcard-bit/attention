spec: task
name: "shared tree item component"
inherits: project
tags: [architecture, ui, refactor]
estimate: 3d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Collapse the ~13 hand-rolled tree/collapse-row implementations across the
renderer onto ONE shared, Obsidian-faithful `TreeItem` component, so the
collapse chevron, indent gutter, nesting, and collapse state are packaged
together and every tree view aligns by construction instead of by per-view
DOM. This is the missing half of a faithful port: the tree-item and collapse
CSS is already Obsidian's, but the component is not — each view re-implements
the structure, which is why the Git Changes view drifts 37px from the others.
No behaviour change beyond consolidation and alignment.

## Current State

The renderer ports Obsidian's tree-item + collapse CSS faithfully
(`styles/components/tree-item.css`, `collapse-indicator.css`), including the
alignment mechanism: the collapse chevron (`.tree-item-self .tree-item-icon`)
is `position: absolute` in a left gutter, leaf rows use `--nav-item-padding`,
collapsible rows (`.mod-collapsible`) use `--nav-item-parent-padding`, nesting
via `.tree-item-children`. But there is no shared component: ~13 sites
hand-build the DOM — FileExplorerView, git GitChangesView / GitLogView /
GitHistoryView, git/review GitNavView / ReviewSurface, OutlineView, Bookmarks,
TagPaneView, BacklinksView, OutgoingLinksView, graph GraphControls — and
`ui/NavFolder.ts` is a partial helper covering only the collapsible-folder
case. GitChangesView hand-rolls flat `nav-file` rows with no `mod-collapsible`
gutter and no nesting, so its file rows sit 37px left of tree rows (measured
live). Obsidian instead ships ONE `TreeItem` (a Component with `el`, `selfEl`,
`innerEl`, `childrenEl`, `collapseEl`, and `setCollapsed` / `setCollapsible` /
`addChild`) reused by every tree view (decode-obsidian app.js). The full
site survey, the alignment mechanism, and the verbatim Obsidian `TreeItem`
API fragments are recorded in research.md.

## Decisions

- Build a `TreeItem` class (extends the renderer's `Component`) that is a
  faithful port of Obsidian's: DOM `tree-item` > `tree-item-self` (with a
  `tree-item-icon collapse-icon` when collapsible, and `tree-item-inner`) plus
  a lazily-created `tree-item-children`; methods `setCollapsible(bool)`,
  `setCollapsed(bool)`, `addChild(child)`, and `onCollapseClick`; the collapse
  chevron is the shared `right-triangle` atom. `ui/NavFolder.ts` folds into it
  (records 0001, 0004; research.md Industry Norms; decode-obsidian app.js).
- Migrate ALL 13 hand-rolled tree sites to `TreeItem`: no view constructs
  `tree-item-self` / `nav-folder-title` / `nav-file-title` DOM itself
  (record 0003).
- Alignment is structural, not per-view: rows align because they share the
  component plus Obsidian's `.mod-collapsible` gutter and `.tree-item-children`
  indent CSS. A regression guard asserts the shared construction path, and the
  pixel alignment is a human sign-off (records 0002, 0003; decode-obsidian
  app.css).
- GitChangesView's Changes/Staged sections become real collapsible `TreeItem`
  parents with file rows nested in `.tree-item-children` — the native
  source-control shape (record 0002).
- The markdown heading/list fold stays on its own `.collapse-indicator` editor
  mechanism, NOT routed through `TreeItem`, mirroring Obsidian's own
  separation (record 0005).
- No behaviour change beyond consolidation and alignment; no new production
  dependency; code stays name-agnostic; the existing native-view suites
  (GitNativeViews, FileExplorerView, and the NavFolder→TreeItem tests) keep
  passing — selection, drag/drop, context menus and lazy loading are preserved.

<!-- lint-ack: platform-decision-tag — Obsidian / decode-obsidian IS this goal's parity target, cited as the primary source throughout, not an incidental platform mention -->
<!-- lint-ack: decision-coverage — the "no behaviour change / preserve interactions" and docs decisions are guarded by the untouched existing suites plus guard, not by new report-mode selectors -->
<!-- lint-ack: error-path — a structural consolidation has no new runtime error path; the "no view hand-rolls tree DOM" and "markdown fold stays separate" walls ARE the regression guards -->

## Boundaries

### Allowed Changes

- src/renderer/ui/**
- src/renderer/builtin/**
- src/renderer/views/**
- src/renderer/styles/**
- tests/**
- docs/**

### Forbidden

- Do not route the markdown heading/list fold through `TreeItem` — it stays
  on its own `.collapse-indicator` mechanism.
- Do not change tree-view behaviour beyond consolidation and alignment: same
  selection, drag/drop, context-menu and lazy-load semantics.
- Do not weaken, skip or delete existing tests to make a gate pass.
- Do not add a production dependency or reintroduce a UI framework.
- Do not invent the `TreeItem` API — port Obsidian's (addChild, setCollapsed,
  setCollapsible, the tree-item DOM).

## Completion Criteria

### Rule: single-primitive — one component, every tree view uses it

Scenario: no view hand-rolls tree-item DOM (critical)
  Test: builds every tree row through the shared tree item
  Given the migrated tree views
  When their sources are scanned for tree-item-self, nav-folder-title and
  nav-file-title class construction
  Then only the TreeItem component constructs that DOM

Scenario: the partial NavFolder helper is folded in
  Test: replaces NavFolder with the tree item component
  Given src/renderer/ui
  When it is inspected
  Then NavFolder is absent and TreeItem is the sole tree-row builder

### Rule: faithful-api — TreeItem mirrors Obsidian

Scenario: the tree item exposes Obsidian's surface
  Test: exposes the Obsidian tree item surface
  Given the TreeItem class
  When its DOM and methods are inspected
  Then it builds tree-item, tree-item-self, tree-item-icon collapse-icon,
  tree-item-inner and tree-item-children and exposes setCollapsed,
  setCollapsible and addChild

### Rule: native-alignment — rows align by construction

Scenario: leaf and collapsible rows align at equal depth (critical)
  Review: human
  Test: keeps tree rows aligned across views
  Given a leaf file row and a collapsible row at the same depth
  When their content inset is measured
  Then they share one inset — the machine check guards the shared
  construction path; the pixel alignment is the human sign-off

### Rule: changes-native-structure — sections collapsible, files nested

Scenario: Git Changes sections are collapsible tree parents
  Test: nests Git Changes files under collapsible sections
  Given GitChangesView rendered on a repo with staged and unstaged files
  When the section and file DOM is inspected
  Then each section is a collapsible TreeItem and its files are nested in
  tree-item-children

### Rule: markdown-fold-separate — fold stays its own mechanism

Scenario: markdown fold does not import the tree item
  Test: keeps markdown fold off the tree component
  Given the markdown heading and list fold modules
  When their imports are resolved
  Then none imports the TreeItem component

## Out of Scope

- The markdown heading/list fold mechanism — separate by design.
- Any change to tree-view behaviour (selection, drag/drop, context menus,
  lazy loading) beyond what consolidation requires.
- New tree views, panes, or features.

## Open Questions

None.
