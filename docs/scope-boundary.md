# Reconstruction Scope Boundary

This project reconstructs Obsidian-style architecture, not every Obsidian product feature.

The target is:

- app shell and desktop/window DOM contract
- Workspace, leaves, splits, tabs, side docks, ribbon, layout persistence
- View and ItemView lifecycle
- MarkdownView as the default document view
- plugin lifecycle and extension APIs
- vault, file manager, editor, command, menu, theme, and settings surfaces
- enough built-in views to prove the platform contracts

The following Obsidian features are not implementation targets:

| Area | Classification | Scope |
| --- | --- | --- |
| Graph | built-in feature / core plugin | Do not implement feature parity. |
| Backlinks | built-in feature / core plugin | Do not implement feature parity. Thin linked-view/menu seams may remain. |
| Outgoing Links | built-in feature / core plugin | Do not implement feature parity. Thin linked-view/menu seams may remain. |
| Wiki Link Resolver | metadata/link lower layer | Do not implement the Obsidian resolver. Keep simplified link interfaces only where editor/plugin flows need them. |
| TagIndex | metadata lower layer | Do not implement the Obsidian tag index. Keep simplified metadata surfaces only where needed. |
| Canvas | large built-in feature | Do not implement feature parity. Thin file/view/drop seams may remain. |
| Daily Notes | core plugin | Do not implement. |
| Templates | core plugin | Do not implement. |
| Publish | service + feature | Do not implement. Facade-only seams are acceptable. |
| Sync | service + feature | Do not implement. Facade-only seams are acceptable. |
| Slides | core plugin, reveal-dependent | Do not implement. |
| Audio recorder | core plugin | Do not implement. |
| Bookmarks | core plugin | Do not implement feature parity. Thin drag/source seams may remain. |

Practical rule: if one of these names appears in source, treat it as a boundary marker, compatibility seam, or reverse-evidence fixture. Do not expand it into a real product feature unless the scope changes.

Default product rule: core plugin definitions for these areas may remain registered so API seams and tests can enable them explicitly, but `src/builtin/CorePlugins.ts` scopes them to `defaultOn: false` when they enter the reconstruction's default core plugin list.

When choosing the next work item, prefer architecture fidelity over built-in feature depth:

- correct DOM structure beats more feature UI
- correct public API behavior beats product completeness
- extension points beat internal feature logic
- focused tests for contracts beat broad clone behavior
