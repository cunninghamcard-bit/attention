# Reconstruction CSS layer

`src/styles/app.css` is treated as a compiled Obsidian artifact.

Do not hand-edit the artifact while reconstructing behavior.

This folder is quarantined. Broad reconstruction CSS must not be imported after
the artifact stylesheet to patch core regions such as `.workspace`,
`.workspace-ribbon`, `.workspace-split`, `.workspace-tabs`,
`.workspace-tab-header`, `.workspace-leaf`, `.view-header`, or `.view-content`.

If a future evidence-backed runtime fix is required, prefer fixing DOM/state
contracts first. Any CSS that remains necessary should be narrow, documented,
and loaded so the real Obsidian artifact stays the primary visual contract.
