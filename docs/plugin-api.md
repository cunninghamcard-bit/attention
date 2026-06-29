# Plugin API Reading Guide

This reconstructed project models Obsidian plugins as lifecycle-managed components.

Core flow:

```text
Plugin.onload()
  -> registerView / addCommand / registerMarkdownPostProcessor / registerTheme
  -> Component.register(cleanup)

Plugin.unload()
  -> cleanups run in reverse order
```

Important extension surfaces:

```text
Workspace: views, leaves, layout, hover preview
Markdown: post processors, code block processors, editor extensions
Appearance: themes, CSS snippets, settings sections
Knowledge: metadata cache, scoped link/tag helpers, query engine, bases view
Shell: native bridge, file dialogs, protocol handler
```
