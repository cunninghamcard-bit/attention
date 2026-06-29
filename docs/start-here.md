# Start Here

This project is a readable reconstruction of Obsidian's architecture, not Obsidian's original source.

Use it as a study map.

## Fast path

```text
1. docs/architecture-map.md
2. docs/reading-order.md
3. docs/extension-points.md
4. docs/scenarios/open-markdown-file.md
5. examples/plugins/custom-view-plugin/main.ts
6. docs/chat-agent-mapping.md
```

## What to understand first

```text
App composes services.
Workspace manages layout.
WorkspaceLeaf hosts View.
MarkdownView is the default product surface.
Plugin registers extension points.
The host owns lifecycle and cleanup.
CSS variables and classes make the object tree visible.
```

## What not to assume

```text
This is not original Obsidian source.
This is not meant to compile as a product.
This is a structural skeleton for learning architecture and plugin design.
```
