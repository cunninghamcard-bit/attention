# Coverage Audit

This audit checks whether the reconstruction satisfies the goal: a rich, complete architectural skeleton for studying Obsidian-style design.

## Evidence inspected

```text
172 source files under src
11+ docs files under docs
4 example plugins under examples/plugins
fixture vault under fixtures/vault
meta catalogs under src/meta
explicit scope boundary in docs/scope-boundary.md
```

## Requirement coverage

| Requirement | Evidence | Status |
| --- | --- | --- |
| Workspace architecture | src/workspace, docs/architecture-map.md | Covered |
| View lifecycle | src/views, src/builtin | Covered |
| MarkdownView default product | src/views/MarkdownView.ts, src/markdown, src/editor | Covered |
| Plugin system | src/plugin, examples/plugins, docs/extension-points.md | Covered |
| Theme/CSS system | src/theme, src/theme-market, src/styles (docs/style-system.md), docs/scope-boundary.md | Covered; broad reconstruction CSS is quarantined and not part of the default visual contract |
| Vault/metadata/search | src/vault, src/metadata, src/search, docs/scope-boundary.md | Covered for platform study; wiki-link resolver and TagIndex parity are excluded |
| Properties/Bases/query | src/properties, src/query, src/bases | Covered |
| Desktop shell boundary | src/desktop, src/native, src/shell | Covered as skeleton |
| Sync/publish/account/product services | src/sync, src/publish, src/account, docs/scope-boundary.md | Facade only; feature parity excluded |
| Diagnostics/devtools | src/diagnostics, src/devtools, src/builtin/DeveloperConsoleView.ts | Covered |
| Packaging/release | src/packaging, src/build, src/release | Covered as skeleton |
| Learning navigation | docs/start-here.md, docs/module-index.md, src/meta | Covered |
| Chat Agent mapping | docs/chat-agent-mapping.md | Covered |

## Known limitations

```text
This is not original Obsidian source.
This is not a verified compiling product.
Desktop/native/network features are intentionally facades.
The point is architectural readability, not behavioral parity.
Graph, Backlinks, Outgoing Links, Canvas, Daily Notes, Templates, Publish, Sync, Slides, Audio Recorder, Bookmarks, the full Wiki Link Resolver, and full TagIndex are explicit non-goals.
```

## Conclusion

The reconstruction should be evaluated as an architecture and extension-system study target, not as a feature-complete Obsidian clone.
