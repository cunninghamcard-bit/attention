---
artifact: tasks
goal: "obsidian appearance parity"
status: active
derived_from:
  - spec.md
  - plan.md
---

# obsidian appearance parity Tasks

## Review Gate

- [x] Inspect Obsidian 1.12.7 Appearance construction in the bundled read-only source.
- [x] Review `spec.md`, resolve every open question, and reach the lint quality gate.
- [x] Review the generated `plan.md` against the authoritative contract.

## Implementation

- [x] Rebuild the panel in source order with native Setting groups and user-facing copy.
- [x] Complete base scheme, accent reset, default/community theme controls and folder action.
- [x] Expose supported Interface, Font and Advanced preferences through existing services.
- [x] Complete CSS snippet reload, folder, empty-state, path and toggle behavior.
- [x] Add the minimal manager seams for font size, translucency and clearing the active theme.

## Tests

- [x] Add component evidence for every `spec.md` scenario.
- [x] Run the 14-scenario Appearance suite.
- [x] Run related appearance manager, custom CSS, config and theme marketplace suites.
- [x] Run typecheck and lint.

## Documentation Impact

- [x] Keep the source comparison, deliberate font-manager reduction and feature exclusions in
  `spec.md`; no maintained user documentation describes this unfinished panel.

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7`
- [x] `docwright lifecycle spec.md --code .`
- [x] `docwright guard --spec-dir docs/architecture/obsidian-appearance-parity --code .`
