# 0001 — Layout: collapse to a single package (DeepChat's src/ layout)

**Decision (grilled, confirmed):** ①-A. Collapse the `apps/{desktop,web}`
two-package pnpm workspace into ONE package with DeepChat's standard
electron-vite layout: `src/{main, preload, renderer, shared, types}`.

**Why:** "We only have one app." It is a single Electron application, not a
multi-product monorepo, so a single package with the conventional
main/preload/renderer split is the honest structure. The user explicitly
rejected the monorepo framing ("根本不是 monorepo").

**Mapping:**
- `apps/desktop/` (main.ts, bridges, ipc, protocol, windows) → `src/main/`
- `apps/desktop/preload.ts` → `src/preload/`
- `apps/web/` (the Obsidian-faithful renderer) → `src/renderer/`
- cross-process shared code / types → `src/shared/`, `src/types/`

**Cascade (known, accepted):** every import path moves; the pnpm workspace
collapses to one package; `tests/architecture.test.ts` runtime-walls rules
rewrite from "app packages" to "src/{main,preload,renderer}"; the graduated
`project-layout-consolidation` contract is superseded and gets retired; the
build/vite/tsconfig lanes reshape around one package. This is a large move —
hundreds of file moves — justified by the single-app truth.

**Rejected:** ①-B (keep apps/ packages, add presenter layer inside) — the
user wants the full DeepChat shell, not just the three-layer essence.
