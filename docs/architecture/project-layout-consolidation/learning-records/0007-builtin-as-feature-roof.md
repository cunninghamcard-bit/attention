# 0007 — F1c: builtin/ becomes the feature roof, one core plugin per subdir

- **Question**: Renderer-internal shape — (a) builtin/ as the roof with
  one subdir per core plugin, absorbing the scattered logic halves
  (canvas/, git/, github/, graph/, webviewer/, theme-market/,
  terminal/, agent…) + family merges (platform group, ui group, app
  group) + orphan rehoming, 55 → ~15 top-level dirs; (b) conservative
  merges only, 55 → ~20, split-feature disease stays; (c) move as-is.
- **Key evidence**: features are split in half today — views live in
  builtin/ (CanvasView, GitChangesView, GitHubWorkspace) while their
  logic lives in scattered top-level dirs (canvas/, git/, github/).
  The roof reunites each feature as a vertical slice, VS Code
  contrib-style; name stays Obsidian-faithful (core plugins = builtin,
  CorePlugins.ts registry at the roof's door). Dual-track decision
  (record 0005) makes internal-API use inside builtin/ legal.
- **Recommendation**: (a).
- **User's answer (2026-07-12)**: (a).
- **Consequences**: agent/ moves under builtin/agent (it registers via
  BuiltinViews already); target top-level ≈ core, dom, platform
  (merged family), vault, metadata, storage, app (merged family), ui
  (merged family), views, editor, markdown, plugin, api, builtin
  (roof), styles.
