<!-- docwright:integration:start -->
## Spec-Driven Development

Use SDD before substantial changes to code, tests, configuration, or
structure when the work needs shared context or a durable decision record.
Skip SDD for trivial or tightly localized work unless explicitly asked.

Each substantial goal lives in one kebab-case folder: docs/features/<goal>
for new capabilities, docs/issues/<goal> for complex bugs, and
docs/architecture/<goal> for refactors and cross-module design. The goal's
spec.md is the authoritative contract — human-readable and mechanically
verified by docwright. plan.md and tasks.md are execution materials and
never override it.

Resolve every bracketed NEEDS-CLARIFICATION marker before implementation;
the lint gate enforces this. Verified goals graduate: consumable artifacts
are removed, durable rules are promoted, and history stays in git.

The docwright-sdd skill owns goal classification and the workflow. Command
usage lives in the docwright-tool-first skill; contract authoring guidance
lives in the docwright-authoring skill.
<!-- docwright:integration:end -->
