---
artifact: tasks
goal: "Git History Avatars"
status: complete
derived_from:
  - spec.md
  - plan.md
---

# Git History Avatars Tasks

## Review Gate

- [x] Review `spec.md`; no open questions remain.
- [x] Review the generated plan against the authoritative contract.

## Implementation

- [x] Read `%aE` from local `git log` and derive the Codiff-style Gravatar URL in the preload bridge.
- [x] Render the shared avatar in File History, Commit Log, and Git review History.
- [x] Replace failed or unavailable images with the author's first visible character.

## Tests

- [x] Verify normalized-email MD5 output.
- [x] Verify image rendering and image-error fallback.
- [x] Run all local Git tests and TypeScript validation.

## Documentation Impact

- [x] Keep the local-only and no-GitHub boundary recorded in `spec.md`.

## Quality Gates

- [x] `docwright lint spec.md --min-score 0.7`
- [x] Scoped `docwright lifecycle spec.md --code .`
