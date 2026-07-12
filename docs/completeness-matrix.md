# Completeness Matrix

This is a practical status matrix for the reconstruction.

See `docs/scope-boundary.md` for features that are intentionally outside the implementation target.

```text
covered     = core structure is represented clearly
sketched    = important shape exists, but implementation is intentionally shallow
placeholder = represented only as a boundary or note
not-modeled = not included
```

| Area | Status | Evidence |
| --- | --- | --- |
| App shell and service composition | covered | src/app |
| Workspace layout tree | covered | src/workspace |
| View lifecycle | covered | src/views, src/builtin |
| MarkdownView product surface | covered | src/views/MarkdownView.ts, src/markdown, src/editor |
| Plugin lifecycle and API | covered | src/plugin, examples/plugins |
| Community plugin marketplace | sketched | src/plugin/PluginMarketplace.ts, src/plugin/PluginInstaller.ts |
| Theme ecosystem | sketched | src/theme, src/theme-market |
| Vault and scoped metadata | covered / scoped | src/vault, src/metadata, src/search; wiki-link resolver and TagIndex are not Obsidian parity targets |
| Properties, query, Bases | covered | src/properties, src/query, src/bases |
| Desktop shell | covered | electron/ bootable main (obsidian.json + vault registry, BrowserWindow lifecycle, app:// protocol, IPC table, obsidian:// routing, session hardening, native menu); src/desktop, src/native, src/shell wired to it. `pnpm run desktop` launches a real on-disk vault. |
| Sync, publish, account | placeholder | src/sync, src/publish, src/account; service facades only, not product features |
| Excluded Obsidian product features | not-modeled | docs/scope-boundary.md |
| Diagnostics and devtools | covered | src/diagnostics, src/devtools |
| Build, packaging, release | sketched | src/build, src/packaging, src/release |
| Real source fidelity | placeholder | clean-room reconstruction, not original source |
```
