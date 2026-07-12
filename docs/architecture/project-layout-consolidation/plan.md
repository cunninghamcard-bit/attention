=== Contract ===

# Task Contract: project layout consolidation

## Intent
Convert the repository from one scattered single-package tree (55 flat
directories under src/, stale study-era docs, three runtimes sharing one
dependency table) into a pnpm-workspace monorepo with three runtime
packages and a consolidated web app, guarded by an architecture test and
described by rewritten architecture docs. This is a structure-only
refactor: user-visible behavior stays identical.

## Current State
src/ holds 55 flat directories mixing kernel, features and museum code;
features are split in half (views in builtin/, logic in scattered
top-level dirs). electron/, src/ and server/ share the root
package.json. docs/ carries 21 stale study-era and design-note files
plus a broken stray contract. Dependency ground truth: 41 of 52
directories form one strongly-connected component through the App hub
(research.md, Current Codebase State).

## Decisions
- Workspace: pnpm monorepo; the only packages are the three runtimes
- Zero library packages today: no base/platform/kernel/ui packages.
- Web-internal consolidation: `builtin/` is the feature roof — one
- Dual-track plugin architecture, faithful to the original: builtin
- Enforcement is alarm-level inside the web app: a vitest architecture
- Storage stays behind the `VaultAdapter` seam inside web
- Museum retirement: delete `src/meta`, `src/scenarios`, `src/docs`
- Docs: retire all 21 legacy docs; delete
- Verification constraints, fixed: the full vitest suite (1576+ tests)

## Boundaries
Allowed changes:
- src/**
- electron/**
- server/**
- docs/**
- e2e/**
- scripts/**
- README.md
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- .gitignore
- tsconfig.json
- vite.config.ts
- vite.electron.config.ts
- vite.api.config.ts
- vitest.config.ts
- playwright.config.ts
- playwright.desktop.config.ts
- index.html
- starter.html
Forbidden:
- Do not touch decode-obsidian (reference symlink) or .claude/**.
- Do not rewrite file contents during moves beyond the import-path and
- Do not weaken, skip or delete existing tests to make gates pass.
Out of scope:
- kernel as a physical package (upgrade path documented, not executed).
- Rewriting any builtin onto the public API (the graduation ladder is a
- Disk access over IPC / renderer sandboxing.
- Web deployment of the web app; a shared protocol package.
- Intra-slice entry-file discipline for builtin/ (contrib-style single

## Completion Criteria

Rule: runtime-walls — the workspace splits by runtime
Scenario: three app packages exist (critical)
  Test:
    Filter: workspace declares desktop web and server app packages
  Given the repository root
  When the workspace configuration is read
  Then pnpm-workspace.yaml lists src/apps/desktop, src/apps/web and src/apps/server
  And each app directory contains its own package.json

Scenario: dependency tables are split by runtime
  Test:
    Filter: app package dependencies stay in their runtime lane
  Given the three app package.json files and the root package.json
  When their dependency tables are inspected
  Then the root package.json declares no runtime dependencies
  And the desktop package declares no UI-framework dependencies
  And the web package declares no electron dependency

Scenario: lane checker catches a violation (synthetic)
  Test:
    Filter: flags a dependency outside its runtime lane
  Given a synthetic package manifest that adds electron to the web lane
  When the lane checker runs on it
  Then the checker reports the violation


Rule: kernel-direction — the kernel stays headless-ready
Scenario: kernel imports nothing above itself (critical)
  Test:
    Filter: kernel directories import nothing above the kernel
  Given the vault, metadata and storage directories of the web app
  When every relative import in them is resolved
  Then no import target lies outside the kernel directories, core, dom or platform

Scenario: direction checker catches an upward import (synthetic)
  Test:
    Filter: flags an upward import from kernel
  Given a synthetic source file under vault/ importing from ui/
  When the direction checker runs on it
  Then the checker reports the violation


Rule: dual-track-api — the public facade serves only community plugins
Scenario: internals never import the facade
  Test:
    Filter: internal code never imports the public api facade
  Given all web app sources outside api/
  When their imports are resolved
  Then none of them imports from api/

Scenario: facade checker catches an internal import (synthetic)
  Test:
    Filter: flags an internal import of the api facade
  Given a synthetic source file under workspace/ importing from api/
  When the facade checker runs on it
  Then the checker reports the violation


Rule: builtin-roof — one core plugin per slice
Scenario: split feature halves are reunited under the roof
  Test:
    Filter: builtin roof holds one directory per core plugin
  Given the web app source tree
  When top-level directories are listed
  Then canvas, git, github, graph, webviewer, theme-market, terminal and agent exist only as subdirectories of builtin/
  And the web app has at most 16 top-level source directories


Rule: retirement — museum code and legacy docs are gone
Scenario: museum modules are removed with their wiring
  Test:
    Filter: museum modules and their app wiring are retired
  Given the web app source tree and App.ts
  When retired paths are checked
  Then meta/, scenarios/, the ApiDocGenerator and the QueryEngine no longer exist
  And App.ts references none of them

Scenario: legacy docs are removed
  Test:
    Filter: legacy docs and stray spec are retired
  Given the docs/ directory
  When its files are listed
  Then none of the 21 retired study-era and design-note documents remain
  And docs/specs/terminal-view.spec.md does not exist


Rule: architecture-docs — the new documentation set exists
Scenario: architecture doc and constitution are in place
  Test:
    Filter: architecture doc and constitution exist with governs markers
  Given the docs/ directory
  When docs/architecture.md and docs/project.spec.md are read
  Then docs/architecture.md contains a docwright:governs marker and a direction table
  And docs/project.spec.md declares spec level project

=== Codebase Context ===

Files (670):
  - docs/architecture-map.md
  - docs/architecture/project-layout-consolidation/learning-records/0001-full-scope-after-chat-merge.md
  - docs/architecture/project-layout-consolidation/learning-records/0002-retire-legacy-docs.md
  - docs/architecture/project-layout-consolidation/learning-records/0003-retire-museum-code.md
  - docs/architecture/project-layout-consolidation/learning-records/0004-monorepo-now.md
  - docs/architecture/project-layout-consolidation/learning-records/0005-dual-track-plugin-api.md
  - docs/architecture/project-layout-consolidation/learning-records/0006-apps-packages-no-lib-packages.md
  - docs/architecture/project-layout-consolidation/learning-records/0007-builtin-as-feature-roof.md
  - docs/architecture/project-layout-consolidation/learning-records/0008-web-naming-no-shared-storage-seam.md
  - docs/architecture/project-layout-consolidation/learning-records/0009-docs-package.md
  - docs/architecture/project-layout-consolidation/research.md
  - docs/architecture/project-layout-consolidation/spec.md
  - docs/chat-agent-mapping.md
  - docs/chat-view-design.md
  - docs/cli-reconstruction-spec.md
  - docs/completeness-matrix.md
  - docs/composer-roadmap.md
  - docs/dagu-notes.md
  - docs/electron-reconstruction-plan.md
  - docs/extension-points.md
  - docs/final-handoff.md
  - docs/issues/large-vault-click-latency/plan.md
  - docs/issues/large-vault-click-latency/spec.md
  - docs/issues/large-vault-click-latency/tasks.md
  - docs/kernel-notes.md
  - docs/module-index.md
  - docs/ownership-flip.md
  - docs/plugin-api.md
  - docs/reading-order.md
  - docs/reverse-evidence.md
  - docs/scenarios/bases-query.md
  - docs/scenarios/open-markdown-file.md
  - docs/scenarios/plugin-register-view.md
  - docs/scope-boundary.md
  - docs/specs/terminal-view.spec.md
  - docs/start-here.md
  - docs/style-system.md
  - e2e/app.spec.ts
  - e2e/desktop/fixtures/electronApp.ts
  - e2e/desktop/specs/01-launch.spec.ts
  - e2e/desktop/specs/02-media.spec.ts
  - e2e/desktop/specs/03-restart-persistence.spec.ts
  - e2e/desktop/specs/04-starter.spec.ts
  - e2e/perf/large-vault.spec.ts
  - electron/app-protocol-register.ts
  - electron/app-protocol.test.ts
  - electron/app-protocol.ts
  - electron/cli/CliClient.ts
  - electron/cli/CliDispatch.test.ts
  - electron/cli/CliDispatch.ts
  - electron/cli/CliServer.test.ts
  - electron/cli/CliServer.ts
  - electron/cli/CliVaultRouter.ts
  - electron/desktop-bridge.test.ts
  - electron/desktop-bridge.ts
  - electron/env.d.ts
  - electron/foundation-ipc.test.ts
  - electron/foundation-ipc.ts
  - electron/git-bridge.ts
  - electron/ipc.test.ts
  - electron/ipc.ts
  - electron/json-store.test.ts
  - electron/json-store.ts
  - electron/loom-sidecar.test.ts
  - electron/loom-sidecar.ts
  - electron/main.ts
  - electron/menu.test.ts
  - electron/menu.ts
  - electron/net-request.ts
  - electron/obsidian-protocol.test.ts
  - electron/obsidian-protocol.ts
  - electron/obsidian-url.test.ts
  - electron/obsidian-url.ts
  - electron/preload.test.ts
  - electron/preload.ts
  - electron/renderer-target.test.ts
  - electron/renderer-target.ts
  - electron/session-hardening.test.ts
  - electron/session-hardening.ts
  - electron/settings.ts
  - electron/starter-window.ts
  - electron/state.ts
  - electron/terminal-bridge.ts
  - electron/tsconfig.json
  - electron/vault-registry.test.ts
  - electron/vault-registry.ts
  - electron/vault-windows.test.ts
  - electron/vault-windows.ts
  - electron/window-state.test.ts
  - electron/window-state.ts
  - electron/window.ts
  - electron/zsh-shim.test.ts
  - electron/zsh-shim.ts
  - scripts/e2e-cli.mjs
  - scripts/fix-dts-extensions.ts
  - server/chat-bridge.ts
  - server/claude-engine.ts
  - server/engine.ts
  - server/mock-engine.ts
  - server/pi-engine.ts
  - src/agent/Agent.test.ts
  - src/agent/Agent.ts
  - src/agent/AgentBuiltin.test.ts
  - src/agent/AgentBuiltin.ts
  - src/agent/AgentEvent.ts
  - src/agent/AgentManager.ts
  - src/agent/AgentPropertiesView.test.ts
  - src/agent/AgentPropertiesView.ts
  - src/agent/AgentQueue.test.ts
  - src/agent/AgentStatusBar.ts
  - src/agent/AgentStrings.ts
  - src/agent/AgentTransport.ts
  - src/agent/AgentView.test.ts
  - src/agent/AgentView.ts
  - src/agent/ArtifactView.ts
  - src/agent/ChatAttachmentBar.ts
  - src/agent/ChatComposer.test.ts
  - src/agent/ChatComposer.ts
  - src/agent/ChatComposerDrafts.ts
  - src/agent/ChatComposerPaste.test.ts
  - src/agent/ChatComposerPaste.ts
  - src/agent/ChatE2E.test.ts
  - src/agent/ChatMentions.ts
  - src/agent/ChatMessageList.ts
  - src/agent/ChatMessageListTimeline.test.ts
  - src/agent/ChatRegistry.ts
  - src/agent/ChatSettingTab.ts
  - src/agent/ChatStyles.ts
  - src/agent/ChatToolCards.test.ts
  - src/agent/ChatToolCards.ts
  - src/agent/ChatView.ts
  - src/agent/MultiAgentView.test.ts
  - src/agent/MultiAgentView.ts
  - src/agent/StatusDot.ts
  - src/api/ApiUtils.test.ts
  - src/api/ApiUtils.ts
  - src/api/ObsidianPluginModule.ts
  - src/api/PluginApiFacade.ts
  - src/api/PublicApi.ts
  - src/app/App.ts
  - src/app/AppCommands.test.ts
  - src/app/AppCommands.ts
  - src/app/AppDom.ts
  - src/app/AppLifecycle.test.ts
  - src/app/AppLifecycle.ts
  - src/app/AppProtocolHandlers.test.ts
  - src/app/AppProtocolHandlers.ts
  - src/app/AppPublicApi.test.ts
  - src/app/AttachmentImport.test.ts
  - src/app/AttachmentImport.ts
  - src/app/BodyClasses.test.ts
  - src/app/BodyClasses.ts
  - src/app/FrameDom.ts
  - src/app/QuitEvent.ts
  - src/app/SettingRegistry.ts
  - src/app/SettingTab.ts
  - src/app/StatusBar.ts
  - src/app/WorkspaceServices.ts
  - src/bootstrap.test.ts
  - src/bootstrap.ts
  - src/build/BuildPipeline.ts
  - src/build/BuildTarget.ts
  - src/builtin/AppearanceSettingTab.ts
  - src/builtin/AudioRecorder.ts
  - src/builtin/BacklinksView.ts
  - src/builtin/Bookmarks.test.ts
  - src/builtin/Bookmarks.ts
  - src/builtin/BuiltinViews.ts
  - src/builtin/CanvasView.test.ts
  - src/builtin/CanvasView.ts
  - src/builtin/CommunityPluginMarketplaceModal.test.ts
  - src/builtin/CommunityPluginMarketplaceModal.ts
  - src/builtin/CommunityPluginTrustModal.ts
  - src/builtin/CommunityPluginsSettingTab.test.ts
  - src/builtin/CommunityPluginsSettingTab.ts
  - src/builtin/CorePlugins.ts
  - src/builtin/CorePluginsScope.test.ts
  - src/builtin/CorePluginsSettingTab.ts
  - src/builtin/DailyNotes.ts
  - src/builtin/DeveloperConsoleView.ts
  - src/builtin/EditorStatus.ts
  - src/builtin/FileExplorerView.test.ts
  - src/builtin/FileExplorerView.ts
  - src/builtin/FileRecoveryPlugin.ts
  - src/builtin/FilesSettingTab.test.ts
  - src/builtin/FilesSettingTab.ts
  - src/builtin/GitChangesView.ts
  - src/builtin/GitHistoryView.ts
  - src/builtin/GitHubExtraPanels.tsx
  - src/builtin/GitHubWorkspace.test.tsx
  - src/builtin/GitHubWorkspace.tsx
  - src/builtin/GitPrViews.test.tsx
  - src/builtin/GitPrViews.tsx
  - src/builtin/GraphPlugin.ts
  - src/builtin/GraphView.ts
  - src/builtin/HotkeysSettingTab.test.ts
  - src/builtin/HotkeysSettingTab.ts
  - src/builtin/LinkSuggest.test.ts
  - src/builtin/LinkSuggest.ts
  - src/builtin/MarkdownImporter.ts
  - src/builtin/MobileSettingTab.test.ts
  - src/builtin/MobileSettingTab.ts
  - src/builtin/NoteComposer.ts
  - src/builtin/OutgoingLinksView.ts
  - src/builtin/OutlineView.ts
  - src/builtin/PagePreview.ts
  - src/builtin/QuickSwitcher.test.ts
  - src/builtin/QuickSwitcher.ts
  - src/builtin/RandomNote.ts
  - src/builtin/SearchView.ts
  - src/builtin/SettingsDomParity.test.ts
  - src/builtin/SettingsModal.ts
  - src/builtin/SettingsRenderer.ts
  - src/builtin/SettingsView.ts
  - src/builtin/SlashCommand.test.ts
  - src/builtin/SlashCommand.ts
  - src/builtin/Slides.ts
  - src/builtin/TagPaneView.ts
  - src/builtin/TagSuggest.test.ts
  - src/builtin/TagSuggest.ts
  - src/builtin/Templates.ts
  - src/builtin/TerminalFocusScope.test.ts
  - src/builtin/TerminalPlugin.ts
  - src/builtin/TerminalView.ts
  - src/builtin/ThemeMarketplaceModal.ts
  - src/builtin/WebViewerPlugin.ts
  - src/builtin/WebViewerView.test.ts
  - src/builtin/WordCount.ts
  - src/builtin/Workspaces.ts
  - src/builtin/ZkPrefixer.ts
  - src/builtin/review/GitReviewView.test.tsx
  - src/builtin/review/GitReviewView.tsx
  - src/builtin/review/ReviewSurface.tsx
  - src/builtin/review/reviewModel.test.ts
  - src/builtin/review/reviewModel.ts
  - src/canvas/Canvas.ts
  - src/canvas/CanvasData.ts
  - src/canvas/CanvasEdge.ts
  - src/canvas/CanvasNode.ts
  - src/cli/Cli.test.ts
  - src/cli/Cli.ts
  - src/cli/commands/coreMisc.test.ts
  - src/cli/commands/coreMisc.ts
  - src/cli/commands/fileWrites.test.ts
  - src/cli/commands/fileWrites.ts
  - src/cli/commands/graphLists.test.ts
  - src/cli/commands/graphLists.ts
  - src/cli/commands/helpers.ts
  - src/cli/commands/linksOutlineCli.test.ts
  - src/cli/commands/linksOutlineCli.ts
  - src/cli/commands/metadata.test.ts
  - src/cli/commands/metadata.ts
  - src/cli/commands/navigation.test.ts
  - src/cli/commands/navigation.ts
  - src/cli/commands/searchCli.test.ts
  - src/cli/commands/searchCli.ts
  - src/cli/commands/wordcountWebCli.test.ts
  - src/cli/commands/wordcountWebCli.ts
  - src/cli/commands/workspacesCli.test.ts
  - src/cli/commands/workspacesCli.ts
  - src/cli/registerCliCommands.test.ts
  - src/cli/registerCliCommands.ts
  - src/commands/CommandManager.test.ts
  - src/commands/CommandManager.ts
  - src/commands/CommandPalette.test.ts
  - src/commands/CommandPalette.ts
  - src/core/Component.test.ts
  - src/core/Component.ts
  - src/core/EventRefInternal.ts
  - src/core/Events.test.ts
  - src/core/Events.ts
  - src/desktop/AutoUpdateService.ts
  - src/desktop/DesktopMain.ts
  - src/desktop/DesktopMenu.test.ts
  - src/desktop/DesktopMenu.ts
  - src/desktop/DesktopProtocolHandler.ts
  - src/desktop/SystemMenuBuilder.ts
  - src/devtools/PluginDevTools.ts
  - src/diagnostics/DiagnosticsManager.ts
  - src/diagnostics/ErrorReporter.ts
  - src/diagnostics/Logger.ts
  - src/diagnostics/PluginErrorBoundary.ts
  - src/docs/ApiDocGenerator.ts
  - src/docs/ApiDocModel.ts
  - src/dom/ActiveDocument.ts
  - src/dom/Clipboard.ts
  - src/dom/dom-helpers.test.ts
  - src/dom/dom.test.ts
  - src/dom/dom.ts
  - src/drag/DragManager.test.ts
  - src/drag/DragManager.ts
  - src/editor/CodeMirrorFacet.ts
  - src/editor/Decoration.ts
  - src/editor/Editor.test.ts
  - src/editor/Editor.ts
  - src/editor/EditorExtension.ts
  - src/editor/EditorStateField.ts
  - src/editor/EditorView.ts
  - src/editor/ViewPlugin.ts
  - src/git/GitService.test.ts
  - src/git/GitService.ts
  - src/github/GitHubClient.test.ts
  - src/github/GitHubClient.ts
  - src/github/GitHubService.ts
  - src/github/commits.test.ts
  - src/github/extraApi.test.ts
  - src/github/patchUtils.test.ts
  - src/github/patchUtils.ts
  - src/github/prefs.ts
  - src/github/resolveRepository.test.ts
  - src/github/resolveRepository.ts
  - src/github/types.ts
  - src/graph/GraphControls.ts
  - src/graph/GraphDataEngine.test.ts
  - src/graph/GraphDataEngine.ts
  - src/graph/GraphOptions.ts
  - src/graph/GraphRenderer.ts
  - src/graph/GraphSearchQuery.test.ts
  - src/graph/GraphSearchQuery.ts
  - src/graph/GraphStyles.ts
  - src/graph/GraphView.ts
  - src/hotkeys/HotkeyManager.ts
  - src/hotkeys/Keymap.ts
  - src/hotkeys/Scope.ts
  - src/hover/HoverPreviewController.ts
  - src/index.ts
  - src/main.ts
  - src/markdown/FoldManager.ts
  - src/markdown/HtmlDropPreprocessor.test.ts
  - src/markdown/HtmlDropPreprocessor.ts
  - src/markdown/HtmlToMarkdown.test.ts
  - src/markdown/HtmlToMarkdown.ts
  - src/markdown/MarkdownBlockParser.ts
  - src/markdown/MarkdownCodeBlockRegistry.ts
  - src/markdown/MarkdownDefaultProcessors.test.ts
  - src/markdown/MarkdownDefaultProcessors.ts
  - src/markdown/MarkdownEmbedRenderer.ts
  - src/markdown/MarkdownInlineRenderer.ts
  - src/markdown/MarkdownLinkResolver.ts
  - src/markdown/MarkdownPostProcessorRegistry.ts
  - src/markdown/MarkdownPreviewRenderer.test.ts
  - src/markdown/MarkdownPreviewRenderer.ts
  - src/markdown/MarkdownPreviewSection.ts
  - src/markdown/MarkdownPreviewView.ts
  - src/markdown/MarkdownRenderChild.ts
  - src/markdown/MarkdownRenderer.ts
  - src/markdown/MarkdownTaskList.ts
  - src/markdown/RenderContext.ts
  - src/menus/MenuManager.test.ts
  - src/menus/MenuManager.ts
  - src/meta/ArchitectureCatalog.ts
  - src/meta/CompletenessMatrix.ts
  - src/meta/ExtensionPointCatalog.ts
  - src/meta/LearningPath.ts
  - src/meta/ProjectStatus.ts
  - src/metadata/BlockCache.test.ts
  - src/metadata/BlockCache.ts
  - src/metadata/LinkGraph.ts
  - src/metadata/LinkSuggestionManager.test.ts
  - src/metadata/LinkSuggestionManager.ts
  - src/metadata/Linkpath.test.ts
  - src/metadata/Linkpath.ts
  - src/metadata/MetadataCache.test.ts
  - src/metadata/MetadataCache.ts
  - src/metadata/MetadataCacheStore.ts
  - src/metadata/TagIndex.ts
  - src/metadata/TagSuggestion.ts
  - src/mobile/MobileBackButton.test.ts
  - src/mobile/MobileBackButton.ts
  - src/mobile/MobileDrawer.ts
  - src/mobile/MobileToolbar.test.ts
  - src/mobile/MobileToolbar.ts
  - src/mobile/MobileWorkspace.ts
  - src/native/FileDialogService.ts
  - src/native/NativeBridge.ts
  - src/native/PreloadApi.ts
  - src/native/WindowFrameController.ts
  - src/packaging/PluginPackager.ts
  - src/packaging/ThemePackager.ts
  - src/platform/Platform.test.ts
  - src/platform/Platform.ts
  - src/plugin/CommunityPluginManagerParity.test.ts
  - src/plugin/CommunityPluginRegistry.ts
  - src/plugin/CorePluginConfig.test.ts
  - src/plugin/CorePluginManager.ts
  - src/plugin/InternalPlugin.ts
  - src/plugin/InternalPluginWrapper.ts
  - src/plugin/InternalPluginWrapperParity.test.ts
  - src/plugin/Plugin.ts
  - src/plugin/PluginApiParity.test.ts
  - src/plugin/PluginContext.ts
  - src/plugin/PluginDiscovery.test.ts
  - src/plugin/PluginInstaller.ts
  - src/plugin/PluginLifecycle.test.ts
  - src/plugin/PluginLoader.ts
  - src/plugin/PluginManager.ts
  - src/plugin/PluginManifest.ts
  - src/plugin/PluginManifestValidator.ts
  - src/plugin/PluginMarketplace.test.ts
  - src/plugin/PluginMarketplace.ts
  - src/plugin/PluginRequire.ts
  - src/plugin/PluginSecurity.ts
  - src/plugin/PluginSettingTab.test.ts
  - src/plugin/PluginSettingTab.ts
  - src/plugin/PluginSource.ts
  - src/properties/AliasPropertyWidget.test.ts
  - src/properties/AliasPropertyWidget.ts
  - src/properties/EditablePropertyPill.ts
  - src/properties/Frontmatter.test.ts
  - src/properties/Frontmatter.ts
  - src/properties/MetadataTypeManager.test.ts
  - src/properties/MetadataTypeManager.ts
  - src/properties/MultiValuePropertyWidget.test.ts
  - src/properties/MultiValuePropertyWidget.ts
  - src/properties/PropertyLinkRenderer.test.ts
  - src/properties/PropertyLinkRenderer.ts
  - src/properties/PropertyLinkSuggest.test.ts
  - src/properties/PropertyLinkSuggest.ts
  - src/properties/PropertyRegistry.ts
  - src/properties/PropertyStore.ts
  - src/properties/PropertyTypeMismatchModal.ts
  - src/properties/PropertyTypes.ts
  - src/properties/TagPropertyWidget.test.ts
  - src/properties/TagPropertyWidget.ts
  - src/protocol/UriRouter.test.ts
  - src/protocol/UriRouter.ts
  - src/protocol/scheme.ts
  - src/query/QueryEngine.ts
  - src/recovery/FileRecovery.ts
  - src/release/ReleaseChannel.ts
  - src/release/ReleaseManager.ts
  - src/release/ReleaseNotes.ts
  - src/revisions/RevisionHistory.ts
  - src/scenarios/DefaultScenarios.ts
  - src/scenarios/RuntimeScenario.ts
  - src/scenarios/ScenarioMarkdownRenderer.ts
  - src/search/SearchEngine.test.ts
  - src/search/SearchEngine.ts
  - src/search/SearchHelpers.ts
  - src/settings/SettingsSection.ts
  - src/shell/ShellIntegration.test.ts
  - src/shell/ShellIntegration.ts
  - src/starter/StarterScreen.test.ts
  - src/starter/StarterScreen.ts
  - src/starter/main.ts
  - src/storage/AppConfig.test.ts
  - src/storage/AppConfig.ts
  - src/storage/FileSystemJsonStoreAdapter.test.ts
  - src/storage/FileSystemJsonStoreAdapter.ts
  - src/storage/JsonStore.ts
  - src/storage/PluginDataStore.ts
  - src/storage/SecretStorage.ts
  - src/styles/StyleSystem.test.ts
  - src/styles/base/platform-mobile.css
  - src/styles/base/reset.css
  - src/styles/base/rtl.css
  - src/styles/components/button-card.css
  - src/styles/components/checkbox.css
  - src/styles/components/clickable-icon.css
  - src/styles/components/collapse-indicator.css
  - src/styles/components/document-search.css
  - src/styles/components/dropdown.css
  - src/styles/components/menu.css
  - src/styles/components/modal-dialog.css
  - src/styles/components/notice.css
  - src/styles/components/popover-prompt-scrollbar.css
  - src/styles/components/suggestion-tabs.css
  - src/styles/components/text-input.css
  - src/styles/components/tooltip.css
  - src/styles/components/tree-item.css
  - src/styles/editor/callout.css
  - src/styles/editor/cm-cursor.css
  - src/styles/editor/cm6.css
  - src/styles/editor/code.css
  - src/styles/editor/embeds.css
  - src/styles/editor/footnotes.css
  - src/styles/editor/headings-hr.css
  - src/styles/editor/inline-title.css
  - src/styles/editor/links-tasks.css
  - src/styles/editor/lists.css
  - src/styles/editor/properties-metadata.css
  - src/styles/editor/reading-view.css
  - src/styles/editor/rendered-content.css
  - src/styles/editor/source-view.css
  - src/styles/editor/syntax-highlight.css
  - src/styles/editor/tables.css
  - src/styles/features/bookmarks-nav.css
  - src/styles/features/community-plugins.css
  - src/styles/features/file-recovery.css
  - src/styles/features/graph-outline.css
  - src/styles/features/pdf-view.css
  - src/styles/features/search.css
  - src/styles/features/settings-item.css
  - src/styles/features/tag-pane-canvas.css
  - src/styles/features/webviewer-workspaces.css
  - src/styles/index.css
  - src/styles/product/code-view.css
  - src/styles/product/diff.css
  - src/styles/product/explorer.css
  - src/styles/product/git-changes.css
  - src/styles/product/git-prs.css
  - src/styles/product/git-review.css
  - src/styles/product/outline.css
  - src/styles/product/starter.css
  - src/styles/product/terminal.css
  - src/styles/product/theme-market.css
  - src/styles/reveal/black.css
  - src/styles/reveal/reveal.css
  - src/styles/reveal/white.css
  - src/styles/tokens/tokens.css
  - src/styles/vendor/pdfjs-messagebar-dialog.css
  - src/styles/vendor/pdfjs-viewer.css
  - src/styles/workspace/app-container.css
  - src/styles/workspace/empty-state.css
  - src/styles/workspace/ribbon-sidedock.css
  - src/styles/workspace/splits-tabs.css
  - src/styles/workspace/starter-splash.css
  - src/styles/workspace/status-bar.css
  - src/styles/workspace/titlebar-frameless.css
  - src/styles/workspace/titlebar-vault-profile.css
  - src/styles/workspace/view-header.css
  - src/suggest/AbstractInputSuggest.test.ts
  - src/suggest/AbstractInputSuggest.ts
  - src/suggest/ComboboxSuggest.test.ts
  - src/suggest/ComboboxSuggest.ts
  - src/suggest/EditorSuggest.test.ts
  - src/suggest/EditorSuggest.ts
  - src/suggest/FileInputSuggest.test.ts
  - src/suggest/FileInputSuggest.ts
  - src/suggest/SuggestModal.test.ts
  - src/suggest/SuggestModal.ts
  - src/terminal/GhosttyTerminalRenderer.test.ts
  - src/terminal/GhosttyTerminalRenderer.ts
  - src/terminal/TerminalAdapter.ts
  - src/terminal/TerminalService.test.ts
  - src/terminal/TerminalService.ts
  - src/test/setup.ts
  - src/theme-market/ThemeInstaller.ts
  - src/theme-market/ThemeManifest.ts
  - src/theme-market/ThemeManifestValidator.ts
  - src/theme-market/ThemeMarket.test.ts
  - src/theme-market/ThemeMarketplace.ts
  - src/theme/AppearanceManager.ts
  - src/theme/CssContract.test.ts
  - src/theme/CssSnippetManager.ts
  - src/theme/CustomCss.test.ts
  - src/theme/CustomCss.ts
  - src/theme/ThemeManager.ts
  - src/theme/obsidian-structure.css
  - src/theme/reconstruction/README.md
  - src/theme/reconstruction/icons.css
  - src/theme/reconstruction/index.css
  - src/theme/reconstruction/runtime.css
  - src/ui/ActiveCloseableRegistry.ts
  - src/ui/Collapse.test.ts
  - src/ui/Collapse.ts
  - src/ui/FileTypeIcon.ts
  - src/ui/Icon.test.ts
  - src/ui/Icon.ts
  - src/ui/IconRegistryCompleteness.test.ts
  - src/ui/Menu.test.ts
  - src/ui/Menu.ts
  - src/ui/Modal.test.ts
  - src/ui/Modal.ts
  - src/ui/ModalAudit.test.ts
  - src/ui/Notice.test.ts
  - src/ui/Notice.ts
  - src/ui/Popover.test.ts
  - src/ui/Popover.ts
  - src/ui/ProgressBar.ts
  - src/ui/Setting.test.ts
  - src/ui/Setting.ts
  - src/updates/UpdateManager.ts
  - src/utils/Version.ts
  - src/vault/DataAdapter.ts
  - src/vault/FileManager.test.ts
  - src/vault/FileManager.ts
  - src/vault/FileNameValidation.ts
  - src/vault/FileSystemAdapter.test.ts
  - src/vault/FileSystemAdapter.ts
  - src/vault/FileWatcher.ts
  - src/vault/MoveFileModal.ts
  - src/vault/TAbstractFile.test.ts
  - src/vault/TAbstractFile.ts
  - src/vault/Vault.test.ts
  - src/vault/Vault.ts
  - src/vault/VaultFileSystemAdapter.test.ts
  - src/vault/VaultManager.ts
  - src/views/CodeFileView.test.ts
  - src/views/CodeFileView.ts
  - src/views/CodeSymbols.test.ts
  - src/views/CodeSymbols.ts
  - src/views/DeferredView.ts
  - src/views/DiffView.test.ts
  - src/views/DiffView.ts
  - src/views/EditableFileView.ts
  - src/views/EmptyView.ts
  - src/views/FileView.ts
  - src/views/FileViewMenuParity.test.ts
  - src/views/ItemView.ts
  - src/views/MarkdownView.ts
  - src/views/MarkdownViewApiParity.test.ts
  - src/views/MarkdownViewDragDrop.test.ts
  - src/views/MarkdownViewPropertyKeys.test.ts
  - src/views/MarkdownViewPropertyTypes.test.ts
  - src/views/MediaViews.ts
  - src/views/StreamMarkdownRenderer.test.ts
  - src/views/StreamMarkdownRenderer.ts
  - src/views/StreamScroller.ts
  - src/views/StreamView.ts
  - src/views/TextFileView.ts
  - src/views/Typewriter.test.ts
  - src/views/Typewriter.ts
  - src/views/UnknownView.ts
  - src/views/View.ts
  - src/views/ViewApiParity.test.ts
  - src/vite-env.d.ts
  - src/webviewer/BrowserSessionBridge.ts
  - src/webviewer/WebContentsBridge.ts
  - src/webviewer/WebViewerAddressSuggest.test.ts
  - src/webviewer/WebViewerAddressSuggest.ts
  - src/webviewer/WebViewerElementAdapter.test.ts
  - src/webviewer/WebViewerElementAdapter.ts
  - src/webviewer/WebViewerHistoryPersistence.test.ts
  - src/webviewer/WebViewerReader.test.ts
  - src/webviewer/WebViewerReader.ts
  - src/webviewer/WebViewerService.ts
  - src/window/PopoutManager.ts
  - src/window/WindowManager.ts
  - src/workspace/RecentFileTracker.ts
  - src/workspace/VaultSwitcher.test.ts
  - src/workspace/ViewRegistry.test.ts
  - src/workspace/ViewRegistry.ts
  - src/workspace/Workspace.ts
  - src/workspace/WorkspaceApiAliasesParity.test.ts
  - src/workspace/WorkspaceBrowserHistoryParity.test.ts
  - src/workspace/WorkspaceClearLayoutParity.test.ts
  - src/workspace/WorkspaceContainer.ts
  - src/workspace/WorkspaceDomStructure.test.ts
  - src/workspace/WorkspaceDragManager.ts
  - src/workspace/WorkspaceEvents.test.ts
  - src/workspace/WorkspaceFloating.ts
  - src/workspace/WorkspaceHover.ts
  - src/workspace/WorkspaceHoverSourcesParity.test.ts
  - src/workspace/WorkspaceItem.ts
  - src/workspace/WorkspaceIterateCodeMirrorsParity.test.ts
  - src/workspace/WorkspaceLayout.ts
  - src/workspace/WorkspaceLayoutPersistence.test.ts
  - src/workspace/WorkspaceLayoutPersistence.ts
  - src/workspace/WorkspaceLayoutReadyParity.test.ts
  - src/workspace/WorkspaceLayoutSerializer.ts
  - src/workspace/WorkspaceLeaf.test.ts
  - src/workspace/WorkspaceLeaf.ts
  - src/workspace/WorkspaceLeafEventsParity.test.ts
  - src/workspace/WorkspaceParent.ts
  - src/workspace/WorkspaceParentInsertParity.test.ts
  - src/workspace/WorkspacePopoutAndTabList.test.ts
  - src/workspace/WorkspacePublicApi.test.ts
  - src/workspace/WorkspaceReadWorkspaceFileParity.test.ts
  - src/workspace/WorkspaceRegisterUriHookParity.test.ts
  - src/workspace/WorkspaceRibbon.test.ts
  - src/workspace/WorkspaceRibbon.ts
  - src/workspace/WorkspaceRoot.ts
  - src/workspace/WorkspaceSidedock.ts
  - src/workspace/WorkspaceSplit.test.ts
  - src/workspace/WorkspaceSplit.ts
  - src/workspace/WorkspaceTabHeaderMenu.test.ts
  - src/workspace/WorkspaceTabs.ts
  - src/workspace/WorkspaceTraversalParity.test.ts
  - src/workspace/WorkspaceWindow.ts

=== Task Sketch ===

Group 1 (order 1):
  Scenarios:
    - three app packages exist (critical)
    - dependency tables are split by runtime
    - lane checker catches a violation (synthetic)
    - kernel imports nothing above itself (critical)
    - direction checker catches an upward import (synthetic)
    - internals never import the facade
    - facade checker catches an internal import (synthetic)
    - split feature halves are reunited under the roof
    - museum modules are removed with their wiring
    - legacy docs are removed
    - architecture doc and constitution are in place
  Boundary paths:
    - src/**
    - server/**
    - electron/**
    - docs/**
  Test selectors:
    - workspace declares desktop web and server app packages
    - app package dependencies stay in their runtime lane
    - flags a dependency outside its runtime lane
    - kernel directories import nothing above the kernel
    - flags an upward import from kernel
    - internal code never imports the public api facade
    - flags an internal import of the api facade
    - builtin roof holds one directory per core plugin
    - museum modules and their app wiring are retired
    - legacy docs and stray spec are retired
    - architecture doc and constitution exist with governs markers

