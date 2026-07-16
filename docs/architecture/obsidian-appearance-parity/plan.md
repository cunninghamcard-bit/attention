# Obsidian Appearance Parity Plan

1. Extend the existing theme registry and marketplace with installed-version update detection, update-only browsing, and bulk update actions.
2. Finish the shared font and ribbon manager DOM: fallback status, visible/hidden actions, add/remove, and drag reorder through `WorkspaceRibbon`.
3. Connect desktop Advanced controls to Electron: zoom in the renderer; frame, icon, GPU, and relaunch through typed IPC and persisted main settings.
4. Add focused renderer/main tests, run TypeScript and the contract lifecycle, then run the repo guard without changing mobile-only settings.
