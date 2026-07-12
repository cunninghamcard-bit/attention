# 0006 — F1b: apps become packages; zero library packages today

- **Question**: Package cut — ① apps-as-packages with zero lib packages
  (alarm-level discipline), ② + immediate packages/kernel (physical
  wall, ~32-site surgery, ~130 import rewrites), ③ five layer packages
  (~1000+ rewrites, no industry precedent for discipline-only splits).
- **Teaching that closed the gap**: "physical wall vs alarm" framing;
  concrete surgery cases (FileManager's ConfirmationModal, MetadataCache's
  Notice, `import type { App }` → narrow host interface); VS Code enforces
  its 7 layers with lint rules in a single tree, not packages; definition
  of kernel (vault+metadata+storage = data machinery with no pixels,
  same concept as user's loom/Attention headless kernels).
- **Recommendation**: ①.
- **User's answer (2026-07-12)**: ① — pnpm workspace with
  src/apps/{desktop, renderer, server}; no library packages; kernel
  direction guarded by a vitest architecture test; upgrade path to ②
  stays open (graduate kernel to a package when a second consumer
  appears).
- **Also settles**: F3 (runtime placement) — house style `src/apps/*`
  like Arkloop/along; desktop shell = electron main+preload only.
