spec: task
name: "style components"
inherits: project
tags: [architecture, styles]
estimate: 0.5d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Split the large own stylesheets along the component boundaries the impact
scan proved (class → TS-consumer matrix over every own class, semgrep call
sites cross-checked), and correct one mislocation the scan exposed. Rules
move VERBATIM; class sets across the files of each split are pairwise
disjoint, machine-verified, so cascade order between them is immaterial —
zero visual change by construction.

## Findings and verdicts

- git-prs.css (745 lines, 93 classes) was MISLOCATED: every consumer is a
  builtin/github view or ui/Composer — none is git. It dissolves into
  github-shared.css (cross-view chips/controls/markdown), github-pr.css,
  github-detail.css (detail + commit + create-issue), github-signin.css,
  all under builtin/github/.
- The gh-composer component's styles were split across git-prs.css AND
  git-review.css while its code is ONE component (ui/Composer). They unite
  in ui/composer.css — the scan's clearest reuse win.
- git-changes.css yields git-commit-meta.css: the GitAvatar component and
  the commit hash/author line, reused by history, log and review nav. The
  three list views stay in one sheet — splitting them produced 1-3-rule
  fragments.
- github-nav.css does NOT split: under the pairwise-disjoint constraint
  77 of 91 rules are genuinely shared across the slice's views. The scan
  proved cohesion, not divisibility. Recorded so nobody re-litigates it.

## Boundaries

Allowed: apps/web/{ui,builtin,views,styles}/**, tests/web/**, docs/**.
Forbidden: any rule content change; faithful layers; dependencies; test
weakening. The mod-* status classes with no static TS reference are
composed dynamically (mod-${status}) — they travel with their host rules
and are never dropped.

## Completion Criteria

### Rule: verbatim-split — every rule survives byte-identical (critical)

Test: holds the split rule multiset byte-identical to the sources
Given the pre-split sources and the split files
When their top-level rule blocks are compared as multisets
Then they are identical byte-for-byte

### Rule: disjoint-split — split files never share a class (critical)

Test: keeps class sets pairwise disjoint across each split's files
Given the files of each split
When their selector class sets are intersected pairwise
Then every intersection is empty, so cascade order between the files
cannot change any outcome

### Rule: gate-green — the standard is unchanged (critical)

Review: human
Given the finished branch, when the full gate and e2e run, then all pass.

## Out of Scope

- Splitting github-nav.css (proven cohesive) and github-profile.css
  (already single-consumer).
- Any DOM/class-name change; token work.
