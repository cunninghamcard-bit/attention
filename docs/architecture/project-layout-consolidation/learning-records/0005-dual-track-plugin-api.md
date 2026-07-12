# 0005 — Adopt Obsidian's dual-track plugin architecture (faithful to original)

- **Question**: Should builtin (core) plugins consume the public plugin API
  (lobehub builtin-tool / VS Code extensions/ model), or stay on the
  internal track like real Obsidian?
- **Evidence taught**: decode-obsidian app.js (3.7MB bundle) shows two
  registries (`internalPlugins = new o2` vs `plugins = new $0`), a
  compiled-in table of 26 core plugin IDs, and a distinct internal
  wrapper contract (`onEnable(app, wrapper)`, `registerViewType`,
  `registerGlobalCommand`, `registerRibbonItem`) that parallels but does
  not equal the public Plugin API (`onload`, `registerView`,
  `addCommand`, `addRibbonIcon`). Core plugins reference internal
  classes directly; community plugins load from vault dirs and see only
  the `obsidian` module. Our src/builtin already matches (69 files,
  CorePlugins.ts registry, only 1 import through src/api).
  lobehub can micro-package builtin tools because a tool's contract is
  narrow (function-call schema); a file explorer's contract is wide —
  packaging cost ∝ contract width.
- **Recommendation**: Dual-track, faithful to the original.
- **User's answer (2026-07-12)**: Dual-track, faithful to the original.
- **Consequences**: builtin/ legally uses internal APIs (documented as
  design, not debt); src/api serves ONLY community plugins; mechanical
  rule inverts — forbid internal code from importing api/ (the facade
  looks inward, nothing depends outward on it). The graduation ladder
  (rewrite a builtin onto PublicApi, then package it) is NOT part of
  this refactor; it may appear later as separate goals.
