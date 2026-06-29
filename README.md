# Obsidian Reconstructed

Readable reconstruction of Obsidian's bundled frontend architecture.

This is not original source code. It is a clean, study-oriented structure rebuilt from the bundled app shape, public API names, DOM classes, and plugin extension points.

## Core chain

```text
App
  Workspace
    WorkspaceSplit
      WorkspaceTabs
        WorkspaceLeaf
          View
```

## Default product chain

```text
WorkspaceLeaf
  MarkdownView
    EditableFileView
    Editor / CodeMirror extensions
    MarkdownRenderer
    MarkdownPreviewView
    MarkdownRenderChild
```

## Application services

```text
App
  viewRegistry
  workspace
  vault
  metadataCache
  fileManager
  commands
  plugins
  themes
  customCss
  setting
  statusBar
```

## Plugin chain

```text
Plugin
  addCommand
  addRibbonIcon
  addStatusBarItem
  addSettingTab
  registerView
  registerMarkdownPostProcessor
  registerMarkdownCodeBlockProcessor
  registerEditorExtension
  registerCss
  registerTheme
```

## Reading order

```text
src/app/App.ts
src/workspace/Workspace.ts
src/workspace/WorkspaceSplit.ts
src/workspace/WorkspaceTabs.ts
src/workspace/WorkspaceLeaf.ts
src/views/View.ts
src/views/ItemView.ts
src/views/MarkdownView.ts
src/markdown/MarkdownRenderer.ts
src/plugin/Plugin.ts
src/styles/app.css
docs/scope-boundary.md
```

## Second-layer modules added

```text
src/vault/*
  TAbstractFile, TFile, TFolder, Vault, FileManager

src/metadata/*
  MetadataCache, CachedMetadata

src/editor/*
  Editor interface, SimpleEditor, EditorExtensionRegistry

src/workspace/*
  WorkspaceLayout, WorkspaceHistory, WorkspaceDragManager, HoverLinkSourceRegistry

src/theme/*
  ThemeManager, CustomCss

src/plugin/*
  PluginContext, InternalPluginRegistry
```

The important architectural lesson is not the exact implementation details. It is the separation:

```text
Workspace manages layout.
View manages panel content.
MarkdownView is the default product surface.
Vault and MetadataCache provide file data.
Plugin APIs attach to controlled extension points.
Theme and CustomCss control presentation through CSS variables and injected styles.
```

## Third-layer modules added

```text
src/ui/*
  Notice, Modal, Menu, Setting and basic input components

src/hotkeys/*
  Scope and Keymap, matching Obsidian's scoped keyboard handling idea

src/suggest/*
  SuggestModal, FuzzySuggestModal, EditorSuggest

src/builtin/*
  FileExplorerView, SearchView, OutlineView and thin non-parity seams for selected built-in views

src/markdown/*
  RenderContext and MarkdownLinkResolver

src/workspace/*
  WorkspaceWindow and WorkspaceContainer
```

The reconstruction is intentionally layered. Read it as an app framework:

```text
UI primitives are reusable shell widgets.
Built-in views are registered through ViewRegistry, like internal plugins.
Markdown has render context and link resolution around the renderer.
Hotkeys are scoped, so modals/editors/workspace can override each other.
Workspace can grow from a single root into windows, containers, floating leaves, and side docks.
```

## Fourth-layer modules added

```text
src/plugin/PluginManifest.ts
src/plugin/PluginLoader.ts
src/plugin/PluginSettingTab.ts
src/plugin/CommunityPluginRegistry.ts
  Plugin package metadata, loading, settings tabs, and community plugin state.

src/commands/CommandPalette.ts
src/hotkeys/HotkeyManager.ts
  Command palette and user-configurable command hotkeys.

src/builtin/SettingsView.ts
  Settings is also modeled as a View, not as an unrelated page.

src/ui/Popover.ts
  Hover popovers and tooltips, used by preview and help surfaces.
```

## Fifth-layer modules added

```text
src/platform/Platform.ts
  Desktop/mobile/platform flags used by menus, shortcuts and shell behavior.

src/vault/DataAdapter.ts
src/vault/FileSystemAdapter.ts
  Adapter boundary between Vault and real filesystem/native desktop APIs.

src/drag/DragManager.ts
  Central drag source tracking for files, tabs, leaves and UI elements.

src/protocol/UriRouter.ts
  Obsidian-style URI/protocol action routing.

src/app/WorkspaceServices.ts
src/app/AppCommands.ts
  App-level service bundle and core commands that drive Workspace behavior.

src/workspace/WorkspaceRoot.ts
src/workspace/WorkspaceFloating.ts
  Named Workspace containers matching the public/bundled architecture.
```

Plugin API now includes more lifecycle-backed registration helpers:

```text
registerEvent
registerDomEvent
registerInterval
registerExtensions
registerHoverLinkSource
registerObsidianProtocolHandler
registerCss
registerTheme
```

## Sixth-layer modules added

```text
src/markdown/MarkdownBlockParser.ts
  Splits markdown source into heading, paragraph, list, quote and fenced code blocks.

src/markdown/MarkdownInlineRenderer.ts
  Renders wikilinks, embeds, inline code and markdown links into DOM fragments.

src/markdown/MarkdownCodeBlockRegistry.ts
src/markdown/MarkdownPostProcessorRegistry.ts
  Separate registries for code block processors and ordered post processors.

src/markdown/MarkdownDefaultProcessors.ts
  Built-in placeholder processors for mermaid, math, query, embeds and callouts.

src/editor/CodeMirrorFacet.ts
src/editor/Decoration.ts
src/editor/ViewPlugin.ts
src/editor/EditorStateField.ts
src/editor/EditorView.ts
  CodeMirror-shaped primitives: facets, compartments, decorations, widgets, state fields, transactions and view plugins.
```

The Markdown chain is now closer to Obsidian's default product surface:

```text
MarkdownView
  source mode
    SimpleEditor
    EditorViewHost
    Workspace.editorExtensionHost

  preview mode
    MarkdownPreviewRenderer
      MarkdownRenderer
        MarkdownBlockParser
        MarkdownInlineRenderer
        MarkdownCodeBlockRegistry
        MarkdownPostProcessorRegistry
```

## Seventh-layer modules added

```text
src/theme/AppearanceManager.ts
  Appearance settings facade: base theme, accent color, fonts and CSS snippet toggle.

src/theme/CssSnippetManager.ts
  User CSS snippet registration and enable/disable flow through CustomCss.

src/settings/SettingsSection.ts
  Settings sections are registered independently from SettingTab instances.

src/plugin/CorePluginManager.ts
  Internal/core plugin enable-disable lifecycle.

src/builtin/CorePlugins.ts
  Built-in Obsidian-style features modeled as internal plugins that register commands and ribbon actions.

src/builtin/AppearanceSettingTab.ts
  Appearance settings as a normal settings tab, not hard-coded UI.
```

The app now has two plugin lanes:

```text
Community plugins
  PluginLoader
  PluginManager
  Plugin
  manifest.json-shaped metadata

Core plugins
  CorePluginManager
  InternalPluginDefinition
  built-in feature definitions
  same Plugin registration helpers
```

Plugin API also includes appearance/settings hooks:

```text
registerCssSnippet
registerSettingsSection
registerTheme
registerCss
addSettingTab
```

## Eighth-layer modules added

```text
src/metadata/LinkGraph.ts
  Provides scoped link relationships for editor/plugin seams; not full graph/backlink feature parity.

src/metadata/TagIndex.ts
  Provides scoped tag lookup for suggestions and metadata surfaces; not full TagIndex parity.

src/search/SearchEngine.ts
  Vault-wide text search over markdown files.

src/menus/MenuManager.ts
  Context menu entry points for file-menu, editor-menu and link-menu events.
```

These modules make the knowledge layer explicit:

```text
Vault
  TFile
  read/write/modify events

MetadataCache
  frontmatter
  headings
  links
  embeds
  tags

LinkGraph / TagIndex / SearchEngine
  scoped link relationships
  scoped tag lookup
  search results

MenuManager
  file-menu
  editor-menu
  link-menu
```

Plugin API now also includes menu helpers:

```text
registerFileMenu
registerEditorMenu
registerLinkMenu
```

## Ninth-layer modules added

```text
src/storage/JsonStore.ts
  `.obsidian`-style JSON storage boundary, backed by an in-memory adapter in this reconstruction.

src/storage/AppConfig.ts
  App-level config facade for appearance, workspace, hotkeys, core plugins and community plugins.

src/storage/PluginDataStore.ts
  Per-plugin data persistence used by Plugin.loadData and Plugin.saveData.

src/workspace/WorkspaceLayoutSerializer.ts
  Converts the live Workspace tree into serializable layout JSON.

src/workspace/WorkspaceLayoutPersistence.ts
  Saves and restores workspace layout through JsonStore.

src/app/AppLifecycle.ts
  App load/save/unload lifecycle that coordinates config and workspace layout persistence.
```

Persistence shape:

```text
JsonStore(".obsidian")
  app.json
  workspace.json
  plugins/<plugin-id>/data.json

AppLifecycle
  config.load()
  workspaceLayouts.restoreSavedLayout()
  workspace.markLayoutReady()

Plugin
  loadData()
  saveData()
```

## Tenth-layer modules added

```text
src/window/WindowManager.ts
  Tracks app windows and focused WorkspaceWindow instances.

src/window/PopoutManager.ts
  Opens and closes floating/popout Workspace containers.

src/mobile/MobileDrawer.ts
src/mobile/MobileWorkspace.ts
  Mobile-specific drawer shell and mobile workspace attach/detach lifecycle.

src/hover/HoverPreviewController.ts
  Hover preview controller built on HoverPopover and Workspace hover link sources.
```

Shell capability map:

```text
WorkspaceServices
  dragManager
  uriRouter
  windowManager
  popoutManager
  mobileWorkspace
  hoverPreview

PluginContext
  exposes the same services so plugins can participate without owning the shell.
```

## Eleventh-layer modules added

```text
src/plugin/PluginMarketplace.ts
  Community plugin catalog/search/package metadata.

src/plugin/PluginSecurity.ts
  Restricted mode and trust decisions for community plugins.

src/plugin/PluginInstaller.ts
  Install, enable, disable and uninstall lifecycle for community plugins.

src/updates/UpdateManager.ts
  Update checking facade for installed plugins.

src/vault/FileWatcher.ts
  Vault event bridge for create/modify/delete/rename-style file watch events.

src/sync/SyncConflict.ts
src/sync/SyncEngine.ts
  Sync-shaped status, conflict representation and conflict resolution facade only.
```

Community plugin lifecycle:

```text
PluginMarketplace
  search plugin entries
  create PluginPackage

PluginSecurity
  restricted mode
  trust/revoke plugin

PluginInstaller
  install package
  enable plugin through PluginLoader
  disable through PluginManager
  uninstall package metadata

UpdateManager
  compare installed versions to known latest versions
```

Vault runtime lifecycle:

```text
Vault events
  -> FileWatcher
  -> MetadataCache/Search/facade listeners

SyncEngine
  -> facade sync-start
  -> facade sync-conflict
  -> facade sync-complete
```

## Twelfth-layer modules added

```text
src/diagnostics/Logger.ts
  App-wide structured log stream with levels and scopes.

src/diagnostics/ErrorReporter.ts
  Central error report collection for recoverable and non-recoverable failures.

src/diagnostics/PluginErrorBoundary.ts
  Wraps plugin load/unload phases so plugin crashes are reported instead of silently breaking the host.

src/diagnostics/DiagnosticsManager.ts
  Aggregates logger, error reporter and plugin error boundary.

src/devtools/PluginDevTools.ts
  Read-only developer facade for loaded plugins, core plugins, logs and errors.

src/builtin/DeveloperConsoleView.ts
  Developer console as a normal Workspace view registered through ViewRegistry.
```

Diagnostics chain:

```text
PluginManager
  loadPlugin/unloadPlugin
  -> DiagnosticsManager.pluginBoundary
  -> ErrorReporter + Logger
  -> DeveloperConsoleView
```

Developer console is opened through the command system:

```text
app:open-developer-console
  -> Workspace.getLeaf("tab")
  -> setViewState({ type: "developer-console" })
```

## Thirteenth-layer modules added

```text
src/desktop/DesktopMain.ts
  Electron-main-shaped boundary: creates windows, bootstraps menu and protocol services.

src/desktop/SystemMenuBuilder.ts
  Native app menu model for File/Edit/View/App menus.

src/desktop/DesktopProtocolHandler.ts
  Desktop-level protocol registration and dispatch for obsidian:// URLs.

src/desktop/AutoUpdateService.ts
  App update checking facade separate from plugin update checking.

src/native/NativeBridge.ts
  IPC-shaped bridge between renderer App and native desktop handlers.

src/native/PreloadApi.ts
  Preload-exposed API shape wrapping NativeBridge.invoke.

src/native/FileDialogService.ts
  Open/save dialog facade at the native boundary.

src/native/WindowFrameController.ts
  Native frame controls such as traffic-light position and fullscreen state.

src/shell/ShellIntegration.ts
  Renderer-side aggregate for bridge, preload API, file dialogs and window frame control.
```

Desktop shell split:

```text
DesktopMain
  app menu
  protocol handler
  auto update
  native windows

Renderer App
  ShellIntegration
    NativeBridge
    PreloadApi
    FileDialogService
    WindowFrameController
```

This mirrors the important architectural boundary:

```text
Obsidian core UI is renderer-side.
Desktop-only capabilities sit behind IPC/preload/native services.
Plugins should call controlled APIs instead of directly owning the desktop shell.
```


## Fourteenth-layer modules added

```text
src/account/AccountManager.ts
  User account profile and auth session facade.

src/account/LicenseManager.ts
  Facade entitlement checks for product capability boundaries.

src/vault/VaultManager.ts
  Multi-vault registry and active vault switching.

src/sync/RemoteSyncProvider.ts
  Facade endpoint and per-vault sync plan configuration.

src/revisions/RevisionHistory.ts
  File revision snapshots for local/sync/manual version history.

src/recovery/FileRecovery.ts
  Recovery service that restores vault files from revision snapshots.

src/publish/PublishService.ts
  Publish-shaped site and job lifecycle facade.
```

Outer product capability map:

```text
AccountManager
  sign in/out
  auth session

LicenseManager
  facade feature gates

VaultManager
  multiple vault records
  active vault switching

RemoteSyncProvider + SyncEngine
  facade endpoint config
  facade sync plan
  facade runtime status/conflicts

RevisionHistory + FileRecovery
  local snapshots
  restore previous file contents

PublishService
  facade publish sites
  facade publish jobs
```


## Fifteenth-layer modules added

```text
src/properties/PropertyTypes.ts
  Property definitions and typed property values.

src/properties/PropertyRegistry.ts
  Registry for known properties and their display/type metadata.

src/properties/PropertyStore.ts
  File-level property lookup, sourced from MetadataCache frontmatter plus runtime overrides.

src/query/QueryEngine.ts
  Structured query engine over file properties.

src/bases/BasesViewConfig.ts
src/bases/BasesQueryResult.ts
src/bases/BasesView.ts
  Bases-style table view over QueryEngine results.
```

Structured data chain:

```text
Markdown frontmatter
  -> MetadataCache.frontmatter
  -> PropertyStore
  -> QueryEngine
  -> BasesQueryResult
  -> BasesView
```

This mirrors Obsidian's modern direction where notes are still Markdown files, but structured views can query properties across the vault.


## Sixteenth-layer modules added

```text
src/theme-market/ThemeManifest.ts
src/theme-market/ThemeMarketplace.ts
src/theme-market/ThemeInstaller.ts
  Theme ecosystem: marketplace entries, packages, installation and enable/disable.

src/docs/ApiDocModel.ts
src/docs/ApiDocGenerator.ts
  Documentation model and generator for plugin API surfaces.

examples/plugins/custom-view-plugin/main.ts
examples/plugins/markdown-processor-plugin/main.ts
examples/plugins/theme-plugin/main.ts
examples/plugins/bases-plugin/main.ts
  Example plugins showing Workspace View, Markdown processor, Theme/CSS, and Bases/Properties extension points.

docs/plugin-api.md
  Reading guide for plugin API extension surfaces.
```

Learning path for plugin authors:

```text
1. custom-view-plugin: registerView + addCommand + addRibbonIcon
2. markdown-processor-plugin: code block processor + post processor
3. theme-plugin: registerTheme + registerCss
4. bases-plugin: propertyRegistry + BasesView state
```


## Seventeenth-layer modules added

```text
src/plugin/PluginManifestValidator.ts
src/theme-market/ThemeManifestValidator.ts
  Manifest validation for plugin and theme packages.

src/packaging/PluginPackager.ts
src/packaging/ThemePackager.ts
  Package artifact builders for plugin/theme distribution.

src/build/BuildTarget.ts
src/build/BuildPipeline.ts
  Desktop/mobile/web build target model and build pipeline steps.

src/release/ReleaseChannel.ts
src/release/ReleaseManager.ts
src/release/ReleaseNotes.ts
  Release channels, release records and release notes rendering.

docs/architecture-map.md
  High-level map of the reconstructed layers.
```

Distribution chain:

```text
Plugin/theme source
  -> manifest validator
  -> packager
  -> marketplace/installer

App source
  -> BuildPipeline
  -> BuildArtifact
  -> ReleaseManager
  -> AutoUpdateService
```

## Eighteenth-layer modules added

```text
src/meta/ArchitectureCatalog.ts
  Machine-readable architecture layer catalog.

src/meta/ExtensionPointCatalog.ts
  Plugin extension point catalog grouped by kind.

src/meta/LearningPath.ts
  Frontend learning path through the reconstructed source tree.

docs/reading-order.md
  Practical reading order for a frontend beginner.

docs/extension-points.md
  Human-readable extension point index.

docs/chat-agent-mapping.md
  Mapping from Obsidian's MarkdownView architecture to a ChatView/Agent app architecture.
```

Navigation chain:

```text
README.md
  -> docs/architecture-map.md
  -> docs/reading-order.md
  -> docs/extension-points.md
  -> docs/chat-agent-mapping.md
  -> examples/plugins/*
```


## Nineteenth-layer modules added

```text
src/api/PublicApi.ts
src/api/PluginApiFacade.ts
  Public API facade showing what plugin authors should conceptually see.

src/scenarios/RuntimeScenario.ts
src/scenarios/DefaultScenarios.ts
src/scenarios/ScenarioMarkdownRenderer.ts
  Runtime scenario catalog for tracing major architecture flows.

fixtures/vault/*
  Tiny example vault for metadata, links, embeds, code blocks and Bases queries.

docs/scenarios/*
  Human-readable scenario traces for opening Markdown, registering a plugin view and running a Bases query.
```

Scenario reading chain:

```text
docs/scenarios/open-markdown-file.md
docs/scenarios/plugin-register-view.md
docs/scenarios/bases-query.md
fixtures/vault/Welcome.md
```

## Twentieth-layer modules added

```text
src/meta/CompletenessMatrix.ts
  Machine-readable completeness/status matrix for the reconstruction.

docs/start-here.md
  Short entry point for reading this project.

docs/module-index.md
  Directory-level map of all major architecture areas.

docs/completeness-matrix.md
  Human-readable coverage/status matrix.
```

Recommended entry point now:

```text
docs/start-here.md
  -> docs/module-index.md
  -> docs/completeness-matrix.md
  -> docs/architecture-map.md
  -> docs/extension-points.md
  -> docs/chat-agent-mapping.md
```

## Final handoff layer added

```text
src/meta/ProjectStatus.ts
  Project-level status model summarizing reconstructed coverage.

docs/final-handoff.md
  Final reading handoff and Chat Agent mapping summary.

docs/coverage-audit.md
  Requirement-by-requirement coverage audit for the reconstruction.
```

Final entry point:

```text
docs/final-handoff.md
  -> docs/start-here.md
  -> docs/module-index.md
  -> docs/coverage-audit.md
```
