spec: task
name: "style taxonomy"
inherits: project
tags: [architecture, styles]
estimate: 1d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Retire the provenance bucket. `styles/product/` mixes two unrelated kinds
of CSS in one flat drawer: complete stylesheets for product-original
features (terminal, git, github, diff, code view, starter) and overrides of
faithful surfaces (explorer, outline, reading view). Every other styles/
directory answers "which cascade layer is this"; product/ answers "who
wrote it" — a taxonomy axis collision that breaks the builtin slice
boundary for CSS and grows without structure.

The governing principle (owner-set): use Obsidian's native components
wherever possible — correctly classed markup is styled by the faithful
cascade for free; where a feature genuinely needs its own component, the
component carries its own stylesheet, namespaced, next to its code. There
is NO third kind of CSS. This ticket lands the mechanical half: feature
stylesheets move to their components, and the wall upgrades from an
import-order invariant to the principle itself. Judging the three
remaining override files is a follow-up ticket. Zero behavior change; the
gate green is the standard.

## Current State

- styles/product/ holds 12 flat files (~2.6k lines). Nine are complete
  feature stylesheets whose owning components live elsewhere (builtin/git,
  builtin/github, builtin/terminal, views/DiffView, views/CodeFileView,
  app/starter). Three are overrides of faithful surfaces (explorer.css,
  outline.css, reading-view.css).
- styles/index.css is the single import manifest; StyleSystem.test.ts
  enforces "known layers only" and "product/ imported last" — an
  invariant that exists only BECAUSE overrides exist.
- The faithful layers (tokens, base, components, features, workspace,
  editor) are byte-identical extracts of app.css, separately guarded.

## Decisions

- Feature stylesheets co-locate with their components (the same contrib
  pattern builtin/ already follows for code): terminal.css →
  builtin/terminal/; git-changes.css, git-prs.css → builtin/git/;
  git-review.css → builtin/git/review/; github-nav.css,
  github-profile.css → builtin/github/; diff.css, code-view.css →
  views/; starter.css → app/starter/. File contents are byte-identical;
  only the location and the index.css import paths change.
- index.css REMAINS the single manifest, own styles still imported after
  the faithful layers — one place decides the cascade, unchanged order.
- The wall upgrades to the principle itself, machine-enforced in
  StyleSystem.test.ts:
  - Own CSS may not RESTYLE faithful surfaces: no own rule's subject
    (rightmost compound) may be a bare faithful class. Referencing
    faithful classes as ancestor context, or scoping a faithful container
    by an own attribute qualifier (`.workspace-leaf-content
    [data-type="diff"]` — the community-plugin protocol), stays legal.
  - Own CSS consumes faithful design tokens, never redefines them.
  - Explicit allowlist for recorded exceptions; empty is the goal.
- styles/product/ shrinks to the three unjudged override files and is
  frozen: nothing new may land there. Each file's verdict — a misuse to
  fix, a feature extension to relocate, or a deliberate deviation to
  record — is the follow-up ticket's scope, per-rule, with visual
  verification.
- Stacked on feat/web-desktop-boundary (both tickets edit the same docs).

## Boundaries

### Allowed Changes

- apps/web/styles/**
- apps/web/builtin/**
- apps/web/views/**
- apps/web/app/starter/**
- tests/web/styles/**
- docs/**
- CLAUDE.md
- AGENTS.md

### Forbidden

- No change to any faithful layer file (byte-identical guard stays).
- No CSS rule edited, added, or deleted — moves only; the cascade order
  in index.css is preserved verbatim.
- No judging of explorer/outline/reading-view — follow-up ticket.
- No new dependency, no lockfile change.
- Do not weaken, skip or delete existing tests.

## Completion Criteria

### Rule: css-with-component — feature styles live with their features

Scenario: the nine feature stylesheets sit beside their owning components (critical)
Test: keeps feature stylesheets co-located with their components
Given the moved stylesheets
When their directories are compared with their owning components
Then each lives in its component's directory, byte-identical to its
pre-move blob, and styles/product/ holds only the three override files

### Rule: one-manifest — index.css stays the single cascade truth

Scenario: every stylesheet is imported exactly once, own styles last
Test: imports every stylesheet exactly once with own styles last
Given styles/index.css
When its import list is read
Then every faithful and own stylesheet appears exactly once, faithful
layers first, own styles after them, in the pre-move relative order

### Rule: no-restyle-wall — own CSS never restyles faithful surfaces (critical)

Scenario: an own rule whose subject is a bare faithful class is refused
Test: refuses own selectors whose subject is a faithful class
Given every selector in own stylesheets
When each subject compound is resolved against the faithful class set
Then no subject is a bare faithful class outside the recorded allowlist,
and the checker flags a synthetic violation

### Rule: token-consumer — own CSS consumes tokens, never defines them

Scenario: an own rule redefining a faithful token is refused
Test: refuses faithful token definitions in own stylesheets
Given every declaration in own stylesheets
When custom-property definitions are collected
Then none redefines a token declared by the faithful tokens layer, and
the checker flags a synthetic violation

### Rule: gate-green — the standard is unchanged (critical)

Scenario: the full gate passes after the moves
Review: human
Test: keeps the full gate green through the style taxonomy ticket
Given the finished branch
When lint, format check, typecheck, vitest, builds and e2e run
Then all pass with no test weakened, skipped or deleted

## Out of Scope

- Judging explorer.css / outline.css / reading-view.css (follow-up
  ticket: fix-usage vs relocate vs recorded deviation, with visual e2e).
- Any visual change whatsoever.
- Per-slice CSS code-splitting or lazy loading.
- Theming API changes.
