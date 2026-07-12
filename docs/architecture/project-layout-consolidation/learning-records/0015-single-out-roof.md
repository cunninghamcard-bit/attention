# 0015 — All build outputs join the single out/ roof

- **User (2026-07-12)**: why do dists live at the root — where does
  DeepChat put them? Answer: DeepChat's builds also live at the root,
  but under ONE roof (electron-vite's out/{main,preload,renderer}).
  Root placement is normal; three separate roofs was the smell.
- **Done**: dist/ dist-electron/ dist-server/ → out/{web,desktop,
  server} + out/{api,types}; main process finds the renderer via the
  relative sibling (join(here, "..", "web") — the electron-vite
  geometry); exports/types fields, launch scripts, three e2e path
  computations, fix-dts-extensions, vault index skip-list (+"out"),
  alarm skip dirs, .gitignore all follow.
- **Proof**: real Electron launch via desktop e2e 01-launch from the
  new paths; perf harness 32ms/82ms unchanged; full gates green.
