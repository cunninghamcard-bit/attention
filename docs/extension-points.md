# Extension Points

Obsidian-style apps should expose small controlled extension points instead of letting plugins rewrite the app.

```text
Workspace
  registerView
  getLeaf
  addCommand
  addRibbonIcon

Markdown
  registerMarkdownPostProcessor
  registerMarkdownCodeBlockProcessor
  registerEditorExtension

Appearance
  registerTheme
  registerCss
  registerCssSnippet
  addSettingTab

Knowledge (scoped metadata seams)
  metadataCache
  scoped link helpers
  scoped tag helpers
  propertyRegistry
  query

Menus
  registerFileMenu
  registerEditorMenu
  registerLinkMenu

Shell
  registerObsidianProtocolHandler
  shell.preloadApi
  shell.fileDialogs
```

Design rule:

```text
Plugins should register capabilities.
The host owns lifecycle, cleanup, layout, persistence and safety.
```
