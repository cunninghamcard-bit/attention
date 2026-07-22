spec: task
name: "style deviations"
inherits: project
tags: [architecture, styles]
estimate: 0.5d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Close the style-taxonomy ticket's pending half: judge every file the wall
allowlisted, split CSS by COMPONENT so the component inventory is visible
and reuse is explicit, and delete styles/product/. Verdict authority was
delegated wholesale by the owner (07-21); every verdict is recorded here
and beside the wall's allowlist for review. Zero rule content changed —
every byte of CSS survives verbatim; only file boundaries and locations
move, with cascade order preserved (the explorer split is byte-equal by
construction: the two new files concatenate to the old file exactly, and
they are imported consecutively at the old position).

## Verdicts

- explorer.css was TWO components in one file. Lines 1-146 are the
  semantic file-type icon palette — a REUSED component (its own header:
  "shared by explorer, tabs and Git"; consumers: FileExplorerView, git
  log/changes/review/nav, github repo view) — now ui/file-type-icon.css
  beside ui/FileTypeIcon.ts. Lines 147-206 are file-explorer feature
  extensions (chip badge, header-button alignment, folder glyph, inline
  icon slot; the file's own comments mark them PRODUCT choices) — now
  builtin/file-explorer.css beside FileExplorerView.ts. Both keep their
  recorded restyles, verdict RECORDED PRODUCT CHOICE in the allowlist.
- outline.css is a CLEAN component stylesheet (own .outline-symbol-*
  namespace, wall-legal) for the code-symbol outline — now
  builtin/outline.css beside OutlineView.ts. No allowlist entry.
- reading-view.css was initially classified as a measured CSS stand-in for
  Obsidian's runtime container sizing and moved to
  styles/deviations/reading-view.css. Follow-up source inspection superseded
  that verdict; see Resolution below.
- starter.css deliberately replaces Obsidian's splash-brand (app.css
  17518-17526 confirms the surface is faithful) — verdict DELIBERATE
  BRAND DEVIATION; stays with its component at app/starter/starter.css,
  allowlist verdict updated from pending to recorded.
- styles/product/ is deleted. The wall's allowlist now contains only
  verdict-carrying entries; shrinking it further means real design work,
  not bookkeeping.

## Resolution

Follow-up task #46 inspected Obsidian 1.12.7's shipped app.js and found the
exact reading-mode constructor contract: immediately after creating
`.markdown-reading-view`, Obsidian assigns inline `width: 100%` and
`height: 100%`. Attention had omitted both assignments. The CSS rule was
therefore a missing runtime-port workaround, not a deliberate deviation.

`MarkdownView` now reproduces those inline dimensions, the redundant
deviation stylesheet and allowlist entry are removed, and deviations/ is
absent until a genuine deliberate deviation is registered.

## Boundaries

Allowed: apps/web/{ui,builtin,views,app,styles}/**, tests/web/styles/**,
docs/**, CLAUDE.md, AGENTS.md.
Forbidden: any CSS rule content change; any faithful-layer change; any
new dependency; weakening tests.

## Completion Criteria

### Rule: component-visible — one component, one stylesheet, one home

Scenario: every own stylesheet sits beside its owning component (critical)
Test: keeps own stylesheets beside their owning components
Given the own stylesheets
When their directories are compared with their owners
Then file-type-icon sits in ui/, file-explorer and outline in builtin/,
starter in app/starter/, the deviation in styles/deviations/, and
styles/product/ does not exist

### Rule: byte-survival — no rule content changed

Scenario: the explorer split concatenates back to the original (critical)
Review: human
Test: holds every moved rule byte-identical
Given the pre-move blobs and the post-move files
When contents are compared
Then ui/file-type-icon.css + builtin/file-explorer.css concatenate to the
old explorer.css exactly, and every other moved file is blob-identical

### Rule: verdict-registry — the allowlist carries verdicts, not IOUs

Scenario: every allowlist entry records a decision
Test: keeps every allowlist entry verdict-annotated
Given the wall allowlist
When its entries are read
Then each carries a recorded verdict and the deviations registry holds
one file per deviation with its rationale

### Rule: gate-green — the standard is unchanged (critical)

Scenario: the full gate passes
Review: human
Test: keeps the full gate green through the deviations ticket
Given the finished branch
When lint, format check, typecheck, vitest, builds and e2e run
Then all pass with no test weakened, skipped or deleted

## Out of Scope

- Emptying the allowlist (real design work: own-class hooks in the tree
  DOM, brand tokens for the splash, runtime sizing in JS).
- Any visual change; token additions.
