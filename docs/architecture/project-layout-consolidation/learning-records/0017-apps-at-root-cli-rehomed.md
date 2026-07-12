# 0017 — apps/ moves to root; cli rehomed from builtin to app family

- **User (2026-07-13, /goal)**: layout still has serious problems —
  src/ contains only apps/ (a vestigial wrapper), cli sits in the
  wrong place; complete the refactor autonomously.
- **Audit confirmed both**:
  1. src/ had exactly one child. The wrapper earned its keep in
     Arkloop (src/ also holds services/, personas/, plugins/) but here
     it wrapped nothing. apps/{desktop,web,server} now live at the
     root — the element-web/lobehub shape.
  2. builtin/cli violated our own roof law ("one core plugin per
     slice"): App.cli is an app-level service (original's 26-plugin
     table has no cli; its consumers are App.ts, Plugin.ts,
     InternalPluginWrapper.ts — app/plugin machinery). Moved to
     apps/web/src/app/cli; the remaining roof residents all check out
     against the original table or are deliberate product slices.
- **Ripples handled**: workspace/package paths, tsconfigs (including
  apps/web's extends depth — caught by the suite), vite output depths,
  lint/format scopes, alarm constants and scenario texts, governs
  marker (apps/**), constitution, README.
- **Proof**: 1611 tests, four typechecks, four builds, desktop e2e
  launch, perf 32ms/82ms unchanged, lifecycle 11/11, guard 3/3.
