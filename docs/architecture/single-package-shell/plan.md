=== Contract ===

# Task Contract: single package shell

## Intent
Collapse the two-package pnpm workspace (`apps/desktop`, `apps/web`) into ONE
package with the conventional electron layout `src/{main, preload, renderer,
shared, types}`, and formalize the renderer↔shell native seam by lifting its
port contracts into `src/shared`. It is one Electron app, not a monorepo. This
is structure-and-contract only: no renderer logic changes, the Obsidian
reconstruction moves wholesale and untouched, and the in-process-node vault
read path (the perf red line) is preserved. A reserved, unimplemented
`KernelApi` port seats the future Go agent kernel without building it now.

## Current State
Two pnpm packages: `apps/desktop` (electron main + preload + native bridges:
git, terminal, dialog, window, menu, protocol, net) and `apps/web` (the
faithful Obsidian reconstruction — a fat, node-privileged renderer). The
renderer never imports the shell; the shell imports the renderer and fills the
ports. The native seam is ports-and-adapters but INFORMAL: the renderer reads
injected globals (`electronGit`, `electronTerminal`, `window.electron`) and the
port interfaces (`ElectronGitApi`, `ElectronTerminalApi`) are duplicated —
declared on the web side and re-declared on the desktop side — agreeing only by
convention. The graduated `project-layout-consolidation` contract still
describes the (now two-package, post-agent-purge) monorepo, and
`docs/architecture.md` still describes three packages plus the removed
`apps/server`.

## Must
- pnpm is the only package manager; a preinstall hook rejects npm and yarn.
- Fail fast on product paths: a missing configuration raises an explicit
- The full vitest suite is green before any merge.
- Keep the perf budget on the 20k-file vault: openFile median under 50ms
- Code stays name-agnostic: no product-name literal appears anywhere in the

## Must NOT
- Do not add a production dependency without a goal contract that adopts it.
- Do not weaken, skip, or delete an existing test to make a gate pass.
- Do not source a default from anywhere but the user's explicit configuration.

## Decisions
- The workspace is three pnpm app packages — `@app/desktop`, `@app/web`,
- Dual-track plugin architecture: `builtin/` is the internal track and may
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only
- Disk access stays behind the `VaultAdapter` seam inside the web app.
- Unit tests are centralized under `tests/` (workspace member), mirroring
- The docs household is docwright goals under
- Single package, electron-vite convention: `src/{main, preload, renderer,
- The renderer moves WHOLESALE and unchanged: its 16 internal directories keep
- The native seam stays ports-and-adapters: the shell implements the ports the
- Port CONTRACTS lift into `src/shared`: a typed IPC channel table (channel
- A `KernelApi` port is RESERVED in `src/shared`: interface only, no
- RED LINE: markdown / block rendering stays in the node-privileged renderer in
- `tests/architecture.test.ts` runtime-walls rewrite from "app packages" to
- No behavior change, no new production dependency, no UI framework

## Boundaries
Allowed changes:
- src/**
- apps/**
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- tsconfig.json
- tsconfig.tools.json
- vitest.config.ts
- tests/**
- docs/**
- mise.toml
- index.html
- starter.html
Forbidden:
- Do not change renderer LOGIC: the move is git-mv plus import-path and
- Do not move the vault fs read/write path behind IPC or the kernel — it
- Do not add zod, a presenter/route registry, or any UI framework; do not
- Do not weaken, skip or delete existing tests to make a gate pass.
- Do not implement the KernelApi or spawn any kernel — reserve the interface
Out of scope:
- Building the Go kernel, its transport, or any agent backend — the KernelApi
- The cloud / web deployment form and its origin and auth model.
- Any change to renderer behavior or the Obsidian reconstruction internals.

## Completion Criteria

Rule: single-package — one app, one package
Scenario: the workspace is a single package (critical)
  Test:
    Filter: declares a single-package src layout
  Given pnpm-workspace.yaml and the source tree
  When the workspace packages and top-level src directories are read
  Then no apps package remains and src holds main, preload, renderer, shared and types

Scenario: the renderer never imports the shell (critical)
  Test:
    Filter: keeps the renderer free of shell imports
  Given every import statement under src/renderer
  When their targets are resolved
  Then none resolves into src/main, src/preload or the electron module


Rule: shared-contracts — the native seam is one typed contract
Scenario: the native port contracts live in shared
  Test:
    Filter: declares the native port contracts in shared
  Given src/shared
  When it is inspected
  Then it declares the DataAdapter, ElectronGitApi and ElectronTerminalApi

Scenario: both sides compile against the shared contracts
  Test:
    Filter: imports the shared contracts from both main and renderer
  Given the native-seam callers in src/renderer and the handlers in src/main
  When their imports are resolved
  Then both sides import the port interfaces from src/shared, not a local copy

Scenario: no presenter or framework machinery is introduced
  Test:
    Filter: keeps zod presenters and UI frameworks out of the dependency table
  Given package.json
  When its dependency tables are read
  Then zod, react, react-dom and vue appear in none of them


Rule: perf-red-line — vault reads stay in-process
Scenario: vault open stays within budget (critical)
  Test:
    Filter: keeps openFile median under the budget on a huge vault
  Given the 20k-file perf vault
  When a file is opened repeatedly through the in-process fs adapter
  Then the openFile median stays under 50ms


Rule: kernel-seam — reserved, not built
Scenario: the kernel port is reserved but unimplemented
  Test:
    Filter: reserves the kernel port without an implementation
  Given src/shared and the workspace
  When the KernelApi port is inspected
  Then it is an interface with no implementation, absent by default, and no

Scenario: block rendering never depends on the kernel port
  Test:
    Filter: keeps renderer rendering free of the kernel port
  Given the renderer markdown and block-render modules
  When their imports are resolved
  Then none imports the KernelApi port

=== Codebase Context ===

Files (645):
  - apps/desktop/app-protocol-register.ts
  - apps/desktop/app-protocol.ts
  - apps/desktop/cli/CliClient.ts
  - apps/desktop/cli/CliDispatch.ts
  - apps/desktop/cli/CliServer.ts
  - apps/desktop/cli/CliVaultRouter.ts
  - apps/desktop/desktop-bridge.ts
  - apps/desktop/env.d.ts
  - apps/desktop/foundation-ipc.ts
  - apps/desktop/git-bridge.ts
  - apps/desktop/ipc.ts
  - apps/desktop/json-store.ts
  - apps/desktop/main.ts
  - apps/desktop/menu.ts
  - apps/desktop/net-request.ts
  - apps/desktop/obsidian-protocol.ts
  - apps/desktop/obsidian-url.ts
  - apps/desktop/package.json
  - apps/desktop/preload.ts
  - apps/desktop/renderer-target.ts
  - apps/desktop/session-hardening.ts
  - apps/desktop/settings.ts
  - apps/desktop/starter-window.ts
  - apps/desktop/state.ts
  - apps/desktop/terminal-bridge.ts
  - apps/desktop/tsconfig.json
  - apps/desktop/vault-registry.ts
  - apps/desktop/vault-windows.ts
  - apps/desktop/vite.config.ts
  - apps/desktop/window-state.ts
  - apps/desktop/window.ts
  - apps/desktop/zsh-shim.ts
  - apps/web/index.html
  - apps/web/package.json
  - apps/web/public/lib/readability.js
  - apps/web/src/api/ObsidianPluginModule.ts
  - apps/web/src/api/PluginApiFacade.ts
  - apps/web/src/api/PublicApi.ts
  - apps/web/src/app/App.ts
  - apps/web/src/app/AppCommands.ts
  - apps/web/src/app/AppDom.ts
  - apps/web/src/app/AppLifecycle.ts
  - apps/web/src/app/AppProtocolHandlers.ts
  - apps/web/src/app/AttachmentImport.ts
  - apps/web/src/app/BodyClasses.ts
  - apps/web/src/app/FileManager.ts
  - apps/web/src/app/FrameDom.ts
  - apps/web/src/app/MetadataIndexingNotice.ts
  - apps/web/src/app/MoveFileModal.ts
  - apps/web/src/app/QuitEvent.ts
  - apps/web/src/app/SettingRegistry.ts
  - apps/web/src/app/SettingTab.ts
  - apps/web/src/app/SettingsSection.ts
  - apps/web/src/app/StatusBar.ts
  - apps/web/src/app/WorkspaceServices.ts
  - apps/web/src/app/cli/Cli.ts
  - apps/web/src/app/cli/commands/coreMisc.ts
  - apps/web/src/app/cli/commands/fileWrites.ts
  - apps/web/src/app/cli/commands/graphLists.ts
  - apps/web/src/app/cli/commands/helpers.ts
  - apps/web/src/app/cli/commands/linksOutlineCli.ts
  - apps/web/src/app/cli/commands/metadata.ts
  - apps/web/src/app/cli/commands/navigation.ts
  - apps/web/src/app/cli/commands/searchCli.ts
  - apps/web/src/app/cli/commands/wordcountWebCli.ts
  - apps/web/src/app/cli/commands/workspacesCli.ts
  - apps/web/src/app/cli/registerCliCommands.ts
  - apps/web/src/app/commands/CommandManager.ts
  - apps/web/src/app/commands/CommandPalette.ts
  - apps/web/src/app/diagnostics/DiagnosticsManager.ts
  - apps/web/src/app/diagnostics/ErrorReporter.ts
  - apps/web/src/app/diagnostics/Logger.ts
  - apps/web/src/app/diagnostics/PluginErrorBoundary.ts
  - apps/web/src/app/hotkeys/HotkeyManager.ts
  - apps/web/src/app/hotkeys/Keymap.ts
  - apps/web/src/app/hotkeys/Scope.ts
  - apps/web/src/app/menus/MenuManager.ts
  - apps/web/src/app/protocol/UriRouter.ts
  - apps/web/src/app/protocol/scheme.ts
  - apps/web/src/app/release/BuildPipeline.ts
  - apps/web/src/app/release/BuildTarget.ts
  - apps/web/src/app/release/ReleaseChannel.ts
  - apps/web/src/app/release/ReleaseManager.ts
  - apps/web/src/app/release/ReleaseNotes.ts
  - apps/web/src/app/release/UpdateManager.ts
  - apps/web/src/app/starter/StarterScreen.ts
  - apps/web/src/app/starter/main.ts
  - apps/web/src/app/theme/AppearanceManager.ts
  - apps/web/src/app/theme/CssSnippetManager.ts
  - apps/web/src/app/theme/CustomCss.ts
  - apps/web/src/app/theme/ThemeManager.ts
  - apps/web/src/app/theme/obsidian-structure.css
  - apps/web/src/app/theme/reconstruction/README.md
  - apps/web/src/app/theme/reconstruction/icons.css
  - apps/web/src/app/theme/reconstruction/index.css
  - apps/web/src/app/theme/reconstruction/runtime.css
  - apps/web/src/bootstrap.ts
  - apps/web/src/builtin/AppearanceSettingTab.ts
  - apps/web/src/builtin/AudioRecorder.ts
  - apps/web/src/builtin/BacklinksView.ts
  - apps/web/src/builtin/Bookmarks.ts
  - apps/web/src/builtin/BuiltinViews.ts
  - apps/web/src/builtin/CommunityPluginMarketplaceModal.ts
  - apps/web/src/builtin/CommunityPluginTrustModal.ts
  - apps/web/src/builtin/CommunityPluginsSettingTab.ts
  - apps/web/src/builtin/CorePlugins.ts
  - apps/web/src/builtin/CorePluginsSettingTab.ts
  - apps/web/src/builtin/DailyNotes.ts
  - apps/web/src/builtin/DeveloperConsoleView.ts
  - apps/web/src/builtin/EditorStatus.ts
  - apps/web/src/builtin/FileExplorerView.ts
  - apps/web/src/builtin/FilesSettingTab.ts
  - apps/web/src/builtin/HotkeysSettingTab.ts
  - apps/web/src/builtin/LinkSuggest.ts
  - apps/web/src/builtin/MarkdownImporter.ts
  - apps/web/src/builtin/MobileSettingTab.ts
  - apps/web/src/builtin/NoteComposer.ts
  - apps/web/src/builtin/OutgoingLinksView.ts
  - apps/web/src/builtin/OutlineView.ts
  - apps/web/src/builtin/PagePreview.ts
  - apps/web/src/builtin/QuickSwitcher.ts
  - apps/web/src/builtin/RandomNote.ts
  - apps/web/src/builtin/SearchView.ts
  - apps/web/src/builtin/SettingsModal.ts
  - apps/web/src/builtin/SettingsRenderer.ts
  - apps/web/src/builtin/SettingsView.ts
  - apps/web/src/builtin/SlashCommand.ts
  - apps/web/src/builtin/Slides.ts
  - apps/web/src/builtin/TagPaneView.ts
  - apps/web/src/builtin/TagSuggest.ts
  - apps/web/src/builtin/Templates.ts
  - apps/web/src/builtin/WordCount.ts
  - apps/web/src/builtin/Workspaces.ts
  - apps/web/src/builtin/ZkPrefixer.ts
  - apps/web/src/builtin/canvas/Canvas.ts
  - apps/web/src/builtin/canvas/CanvasData.ts
  - apps/web/src/builtin/canvas/CanvasEdge.ts
  - apps/web/src/builtin/canvas/CanvasNode.ts
  - apps/web/src/builtin/canvas/CanvasView.ts
  - apps/web/src/builtin/file-recovery/FileRecovery.ts
  - apps/web/src/builtin/file-recovery/FileRecoveryPlugin.ts
  - apps/web/src/builtin/file-recovery/RevisionHistory.ts
  - apps/web/src/builtin/git/BranchSwitchModal.ts
  - apps/web/src/builtin/git/GitChangesView.ts
  - apps/web/src/builtin/git/GitHistoryView.ts
  - apps/web/src/builtin/git/GitLogView.ts
  - apps/web/src/builtin/git/GitPlugin.ts
  - apps/web/src/builtin/git/GitService.ts
  - apps/web/src/builtin/git/relativeDate.ts
  - apps/web/src/builtin/git/review/GitNavView.ts
  - apps/web/src/builtin/git/review/GitReviewView.ts
  - apps/web/src/builtin/git/review/ReviewSurface.ts
  - apps/web/src/builtin/git/review/checkControl.ts
  - apps/web/src/builtin/git/review/reviewModel.ts
  - apps/web/src/builtin/git/review/reviewNavModel.ts
  - apps/web/src/builtin/git/reviewSession.ts
  - apps/web/src/builtin/github/GitHubClient.ts
  - apps/web/src/builtin/github/GitHubExtraPanels.ts
  - apps/web/src/builtin/github/GitHubPlugin.ts
  - apps/web/src/builtin/github/GitHubService.ts
  - apps/web/src/builtin/github/GitHubWorkspace.ts
  - apps/web/src/builtin/github/GitPrViews.ts
  - apps/web/src/builtin/github/patchUtils.ts
  - apps/web/src/builtin/github/prefs.ts
  - apps/web/src/builtin/github/resolveRepository.ts
  - apps/web/src/builtin/github/types.ts
  - apps/web/src/builtin/graph/GraphControls.ts
  - apps/web/src/builtin/graph/GraphDataEngine.ts
  - apps/web/src/builtin/graph/GraphOptions.ts
  - apps/web/src/builtin/graph/GraphPlugin.ts
  - apps/web/src/builtin/graph/GraphRenderer.ts
  - apps/web/src/builtin/graph/GraphSearchQuery.ts
  - apps/web/src/builtin/graph/GraphStyles.ts
  - apps/web/src/builtin/graph/GraphView.ts
  - apps/web/src/builtin/graph/GraphViewPlugin.ts
  - apps/web/src/builtin/terminal/GhosttyTerminalRenderer.ts
  - apps/web/src/builtin/terminal/TerminalAdapter.ts
  - apps/web/src/builtin/terminal/TerminalPlugin.ts
  - apps/web/src/builtin/terminal/TerminalService.ts
  - apps/web/src/builtin/terminal/TerminalView.ts
  - apps/web/src/builtin/theme-market/ThemeInstaller.ts
  - apps/web/src/builtin/theme-market/ThemeManifest.ts
  - apps/web/src/builtin/theme-market/ThemeManifestValidator.ts
  - apps/web/src/builtin/theme-market/ThemeMarketplace.ts
  - apps/web/src/builtin/theme-market/ThemeMarketplaceModal.ts
  - apps/web/src/builtin/webviewer/BrowserSessionBridge.ts
  - apps/web/src/builtin/webviewer/WebContentsBridge.ts
  - apps/web/src/builtin/webviewer/WebViewerAddressSuggest.ts
  - apps/web/src/builtin/webviewer/WebViewerElementAdapter.ts
  - apps/web/src/builtin/webviewer/WebViewerPlugin.ts
  - apps/web/src/builtin/webviewer/WebViewerReader.ts
  - apps/web/src/builtin/webviewer/WebViewerService.ts
  - apps/web/src/core/ApiUtils.ts
  - apps/web/src/core/Component.ts
  - apps/web/src/core/EventRefInternal.ts
  - apps/web/src/core/Events.ts
  - apps/web/src/core/PropertyValue.ts
  - apps/web/src/core/Version.ts
  - apps/web/src/core/fuzzy.ts
  - apps/web/src/dom/ActiveDocument.ts
  - apps/web/src/dom/Clipboard.ts
  - apps/web/src/dom/dom.ts
  - apps/web/src/editor/CodeMirrorFacet.ts
  - apps/web/src/editor/Decoration.ts
  - apps/web/src/editor/Editor.ts
  - apps/web/src/editor/EditorExtension.ts
  - apps/web/src/editor/EditorStateField.ts
  - apps/web/src/editor/EditorView.ts
  - apps/web/src/editor/ViewPlugin.ts
  - apps/web/src/index.ts
  - apps/web/src/main.ts
  - apps/web/src/markdown/FoldManager.ts
  - apps/web/src/markdown/HtmlDropPreprocessor.ts
  - apps/web/src/markdown/HtmlToMarkdown.ts
  - apps/web/src/markdown/MarkdownBlockParser.ts
  - apps/web/src/markdown/MarkdownCodeBlockRegistry.ts
  - apps/web/src/markdown/MarkdownDefaultProcessors.ts
  - apps/web/src/markdown/MarkdownEmbedRenderer.ts
  - apps/web/src/markdown/MarkdownInlineRenderer.ts
  - apps/web/src/markdown/MarkdownLinkResolver.ts
  - apps/web/src/markdown/MarkdownPostProcessorRegistry.ts
  - apps/web/src/markdown/MarkdownPreviewRenderer.ts
  - apps/web/src/markdown/MarkdownPreviewSection.ts
  - apps/web/src/markdown/MarkdownPreviewView.ts
  - apps/web/src/markdown/MarkdownRenderChild.ts
  - apps/web/src/markdown/MarkdownRenderer.ts
  - apps/web/src/markdown/MarkdownTaskList.ts
  - apps/web/src/markdown/RenderContext.ts
  - apps/web/src/metadata/BlockCache.ts
  - apps/web/src/metadata/Frontmatter.ts
  - apps/web/src/metadata/FrontmatterTags.ts
  - apps/web/src/metadata/LinkGraph.ts
  - apps/web/src/metadata/LinkSuggestionManager.ts
  - apps/web/src/metadata/Linkpath.ts
  - apps/web/src/metadata/MetadataCache.ts
  - apps/web/src/metadata/MetadataCacheStore.ts
  - apps/web/src/metadata/TagIndex.ts
  - apps/web/src/metadata/TagSuggestion.ts
  - apps/web/src/platform/Platform.ts
  - apps/web/src/platform/desktop/AutoUpdateService.ts
  - apps/web/src/platform/desktop/DesktopMain.ts
  - apps/web/src/platform/desktop/DesktopMenu.ts
  - apps/web/src/platform/desktop/DesktopProtocolHandler.ts
  - apps/web/src/platform/desktop/SystemMenuBuilder.ts
  - apps/web/src/platform/mobile/MobileBackButton.ts
  - apps/web/src/platform/mobile/MobileDrawer.ts
  - apps/web/src/platform/mobile/MobileToolbar.ts
  - apps/web/src/platform/mobile/MobileWorkspace.ts
  - apps/web/src/platform/native/FileDialogService.ts
  - apps/web/src/platform/native/NativeBridge.ts
  - apps/web/src/platform/native/PreloadApi.ts
  - apps/web/src/platform/native/WindowFrameController.ts
  - apps/web/src/platform/shell/ShellIntegration.ts
  - apps/web/src/platform/window/PopoutManager.ts
  - apps/web/src/platform/window/WindowManager.ts
  - apps/web/src/plugin/CommunityPluginRegistry.ts
  - apps/web/src/plugin/CorePluginManager.ts
  - apps/web/src/plugin/InternalPlugin.ts
  - apps/web/src/plugin/InternalPluginWrapper.ts
  - apps/web/src/plugin/Plugin.ts
  - apps/web/src/plugin/PluginContext.ts
  - apps/web/src/plugin/PluginDevTools.ts
  - apps/web/src/plugin/PluginInstaller.ts
  - apps/web/src/plugin/PluginLoader.ts
  - apps/web/src/plugin/PluginManager.ts
  - apps/web/src/plugin/PluginManifest.ts
  - apps/web/src/plugin/PluginManifestValidator.ts
  - apps/web/src/plugin/PluginMarketplace.ts
  - apps/web/src/plugin/PluginRequire.ts
  - apps/web/src/plugin/PluginSecurity.ts
  - apps/web/src/plugin/PluginSettingTab.ts
  - apps/web/src/plugin/PluginSource.ts
  - apps/web/src/plugin/packaging/PluginPackager.ts
  - apps/web/src/plugin/packaging/ThemePackager.ts
  - apps/web/src/search/SearchEngine.ts
  - apps/web/src/search/SearchHelpers.ts
  - apps/web/src/storage/AppConfig.ts
  - apps/web/src/storage/FileSystemJsonStoreAdapter.ts
  - apps/web/src/storage/JsonStore.ts
  - apps/web/src/storage/PluginDataStore.ts
  - apps/web/src/storage/SecretStorage.ts
  - apps/web/src/styles/base/platform-mobile.css
  - apps/web/src/styles/base/reset.css
  - apps/web/src/styles/base/rtl.css
  - apps/web/src/styles/components/button-card.css
  - apps/web/src/styles/components/checkbox.css
  - apps/web/src/styles/components/clickable-icon.css
  - apps/web/src/styles/components/collapse-indicator.css
  - apps/web/src/styles/components/document-search.css
  - apps/web/src/styles/components/dropdown.css
  - apps/web/src/styles/components/menu.css
  - apps/web/src/styles/components/modal-dialog.css
  - apps/web/src/styles/components/notice.css
  - apps/web/src/styles/components/popover-prompt-scrollbar.css
  - apps/web/src/styles/components/suggestion-tabs.css
  - apps/web/src/styles/components/text-input.css
  - apps/web/src/styles/components/tooltip.css
  - apps/web/src/styles/components/tree-item.css
  - apps/web/src/styles/editor/callout.css
  - apps/web/src/styles/editor/cm-cursor.css
  - apps/web/src/styles/editor/cm6.css
  - apps/web/src/styles/editor/code.css
  - apps/web/src/styles/editor/embeds.css
  - apps/web/src/styles/editor/footnotes.css
  - apps/web/src/styles/editor/headings-hr.css
  - apps/web/src/styles/editor/inline-title.css
  - apps/web/src/styles/editor/links-tasks.css
  - apps/web/src/styles/editor/lists.css
  - apps/web/src/styles/editor/properties-metadata.css
  - apps/web/src/styles/editor/reading-view.css
  - apps/web/src/styles/editor/rendered-content.css
  - apps/web/src/styles/editor/source-view.css
  - apps/web/src/styles/editor/syntax-highlight.css
  - apps/web/src/styles/editor/tables.css
  - apps/web/src/styles/features/bookmarks-nav.css
  - apps/web/src/styles/features/community-plugins.css
  - apps/web/src/styles/features/file-recovery.css
  - apps/web/src/styles/features/graph-outline.css
  - apps/web/src/styles/features/pdf-view.css
  - apps/web/src/styles/features/search.css
  - apps/web/src/styles/features/settings-item.css
  - apps/web/src/styles/features/tag-pane-canvas.css
  - apps/web/src/styles/features/webviewer-workspaces.css
  - apps/web/src/styles/index.css
  - apps/web/src/styles/product/code-view.css
  - apps/web/src/styles/product/diff.css
  - apps/web/src/styles/product/explorer.css
  - apps/web/src/styles/product/git-changes.css
  - apps/web/src/styles/product/git-prs.css
  - apps/web/src/styles/product/git-review.css
  - apps/web/src/styles/product/starter.css
  - apps/web/src/styles/product/terminal.css
  - apps/web/src/styles/product/theme-market.css
  - apps/web/src/styles/reveal/black.css
  - apps/web/src/styles/reveal/reveal.css
  - apps/web/src/styles/reveal/white.css
  - apps/web/src/styles/tokens/tokens.css
  - apps/web/src/styles/vendor/pdfjs-messagebar-dialog.css
  - apps/web/src/styles/vendor/pdfjs-viewer.css
  - apps/web/src/styles/workspace/app-container.css
  - apps/web/src/styles/workspace/empty-state.css
  - apps/web/src/styles/workspace/ribbon-sidedock.css
  - apps/web/src/styles/workspace/splits-tabs.css
  - apps/web/src/styles/workspace/starter-splash.css
  - apps/web/src/styles/workspace/status-bar.css
  - apps/web/src/styles/workspace/titlebar-frameless.css
  - apps/web/src/styles/workspace/titlebar-vault-profile.css
  - apps/web/src/styles/workspace/view-header.css
  - apps/web/src/ui/ActiveCloseableRegistry.ts
  - apps/web/src/ui/Collapse.ts
  - apps/web/src/ui/FileTypeIcon.ts
  - apps/web/src/ui/Icon.ts
  - apps/web/src/ui/Menu.ts
  - apps/web/src/ui/Modal.ts
  - apps/web/src/ui/Notice.ts
  - apps/web/src/ui/Popover.ts
  - apps/web/src/ui/ProgressBar.ts
  - apps/web/src/ui/Setting.ts
  - apps/web/src/ui/drag/DragManager.ts
  - apps/web/src/ui/hover/HoverPreviewController.ts
  - apps/web/src/ui/suggest/AbstractInputSuggest.ts
  - apps/web/src/ui/suggest/ComboboxSuggest.ts
  - apps/web/src/ui/suggest/EditorSuggest.ts
  - apps/web/src/ui/suggest/FileInputSuggest.ts
  - apps/web/src/ui/suggest/SuggestModal.ts
  - apps/web/src/vault/DataAdapter.ts
  - apps/web/src/vault/FileNameValidation.ts
  - apps/web/src/vault/FileSystemAdapter.ts
  - apps/web/src/vault/FileWatcher.ts
  - apps/web/src/vault/TAbstractFile.ts
  - apps/web/src/vault/Vault.ts
  - apps/web/src/vault/VaultManager.ts
  - apps/web/src/views/CodeFileView.ts
  - apps/web/src/views/CodeSymbols.ts
  - apps/web/src/views/DeferredView.ts
  - apps/web/src/views/DiffView.ts
  - apps/web/src/views/EditableFileView.ts
  - apps/web/src/views/EmptyView.ts
  - apps/web/src/views/FileView.ts
  - apps/web/src/views/ItemView.ts
  - apps/web/src/views/MarkdownView.ts
  - apps/web/src/views/MediaViews.ts
  - apps/web/src/views/StreamMarkdownRenderer.ts
  - apps/web/src/views/StreamScroller.ts
  - apps/web/src/views/StreamView.ts
  - apps/web/src/views/TextFileView.ts
  - apps/web/src/views/Typewriter.ts
  - apps/web/src/views/UnknownView.ts
  - apps/web/src/views/View.ts
  - apps/web/src/views/properties/AliasPropertyWidget.ts
  - apps/web/src/views/properties/EditablePropertyPill.ts
  - apps/web/src/views/properties/MetadataTypeManager.ts
  - apps/web/src/views/properties/MultiValuePropertyWidget.ts
  - apps/web/src/views/properties/PropertyLinkRenderer.ts
  - apps/web/src/views/properties/PropertyLinkSuggest.ts
  - apps/web/src/views/properties/PropertyRegistry.ts
  - apps/web/src/views/properties/PropertyStore.ts
  - apps/web/src/views/properties/PropertyTypeMismatchModal.ts
  - apps/web/src/views/properties/PropertyTypes.ts
  - apps/web/src/views/properties/TagPropertyWidget.ts
  - apps/web/src/views/workspace/RecentFileTracker.ts
  - apps/web/src/views/workspace/ViewRegistry.ts
  - apps/web/src/views/workspace/Workspace.ts
  - apps/web/src/views/workspace/WorkspaceContainer.ts
  - apps/web/src/views/workspace/WorkspaceDragManager.ts
  - apps/web/src/views/workspace/WorkspaceFloating.ts
  - apps/web/src/views/workspace/WorkspaceHover.ts
  - apps/web/src/views/workspace/WorkspaceItem.ts
  - apps/web/src/views/workspace/WorkspaceLayout.ts
  - apps/web/src/views/workspace/WorkspaceLayoutPersistence.ts
  - apps/web/src/views/workspace/WorkspaceLayoutSerializer.ts
  - apps/web/src/views/workspace/WorkspaceLeaf.ts
  - apps/web/src/views/workspace/WorkspaceParent.ts
  - apps/web/src/views/workspace/WorkspaceRibbon.ts
  - apps/web/src/views/workspace/WorkspaceRoot.ts
  - apps/web/src/views/workspace/WorkspaceSidedock.ts
  - apps/web/src/views/workspace/WorkspaceSplit.ts
  - apps/web/src/views/workspace/WorkspaceTabs.ts
  - apps/web/src/views/workspace/WorkspaceWindow.ts
  - apps/web/src/vite-env.d.ts
  - apps/web/starter.html
  - apps/web/tsconfig.json
  - apps/web/vite.api.config.ts
  - apps/web/vite.config.ts
  - docs/architecture.md
  - docs/architecture/project-layout-consolidation/learning-records/0001-full-scope-after-chat-merge.md
  - docs/architecture/project-layout-consolidation/learning-records/0002-retire-legacy-docs.md
  - docs/architecture/project-layout-consolidation/learning-records/0003-retire-museum-code.md
  - docs/architecture/project-layout-consolidation/learning-records/0004-monorepo-now.md
  - docs/architecture/project-layout-consolidation/learning-records/0005-dual-track-plugin-api.md
  - docs/architecture/project-layout-consolidation/learning-records/0006-apps-packages-no-lib-packages.md
  - docs/architecture/project-layout-consolidation/learning-records/0007-builtin-as-feature-roof.md
  - docs/architecture/project-layout-consolidation/learning-records/0008-web-naming-no-shared-storage-seam.md
  - docs/architecture/project-layout-consolidation/learning-records/0009-docs-package.md
  - docs/architecture/project-layout-consolidation/learning-records/0010-rename-attention-name-agnostic-code.md
  - docs/architecture/project-layout-consolidation/learning-records/0011-centralized-tests-gate-hardening.md
  - docs/architecture/project-layout-consolidation/learning-records/0012-e2e-under-tests.md
  - docs/architecture/project-layout-consolidation/learning-records/0013-toolchain-adoption-batch.md
  - docs/architecture/project-layout-consolidation/learning-records/0014-repo-hygiene-completion.md
  - docs/architecture/project-layout-consolidation/learning-records/0015-single-out-roof.md
  - docs/architecture/project-layout-consolidation/learning-records/0016-out-vs-reports.md
  - docs/architecture/project-layout-consolidation/learning-records/0017-apps-at-root-cli-rehomed.md
  - docs/architecture/project-layout-consolidation/plan.md
  - docs/architecture/project-layout-consolidation/research.md
  - docs/architecture/project-layout-consolidation/spec.md
  - docs/architecture/project-layout-consolidation/tasks.md
  - docs/architecture/single-package-shell/learning-records/0001-layout-single-package.md
  - docs/architecture/single-package-shell/learning-records/0002-fitting-architecture.md
  - docs/architecture/single-package-shell/spec.md
  - docs/architecture/vanilla-ui-consolidation/spec.md
  - docs/features/codiff-right-sidebar/spec.md
  - docs/features/local-git-surface-completion/learning-records/0001-scope-and-reference.md
  - docs/features/local-git-surface-completion/learning-records/0002-local-commits-view.md
  - docs/features/local-git-surface-completion/spec.md
  - docs/issues/large-vault-click-latency/spec.md
  - docs/issues/reading-view-stale-layout/spec.md
  - docs/project.spec.md
  - tests/architecture.test.ts
  - tests/desktop/app-protocol.test.ts
  - tests/desktop/cli/CliDispatch.test.ts
  - tests/desktop/cli/CliServer.test.ts
  - tests/desktop/desktop-bridge.test.ts
  - tests/desktop/foundation-ipc.test.ts
  - tests/desktop/ipc.test.ts
  - tests/desktop/json-store.test.ts
  - tests/desktop/menu.test.ts
  - tests/desktop/obsidian-protocol.test.ts
  - tests/desktop/obsidian-url.test.ts
  - tests/desktop/preload.test.ts
  - tests/desktop/renderer-target.test.ts
  - tests/desktop/session-hardening.test.ts
  - tests/desktop/vault-registry.test.ts
  - tests/desktop/vault-windows.test.ts
  - tests/desktop/window-state.test.ts
  - tests/desktop/zsh-shim.test.ts
  - tests/e2e/app.spec.ts
  - tests/e2e/desktop/fixtures/electronApp.ts
  - tests/e2e/desktop/specs/01-launch.spec.ts
  - tests/e2e/desktop/specs/02-media.spec.ts
  - tests/e2e/desktop/specs/03-restart-persistence.spec.ts
  - tests/e2e/desktop/specs/04-starter.spec.ts
  - tests/e2e/desktop/specs/05-git.spec.ts
  - tests/e2e/perf/large-vault.spec.ts
  - tests/e2e/playwright.config.ts
  - tests/e2e/playwright.desktop.config.ts
  - tests/package.json
  - tests/web/app/AppCommands.test.ts
  - tests/web/app/AppLifecycle.test.ts
  - tests/web/app/AppProtocolHandlers.test.ts
  - tests/web/app/AppPublicApi.test.ts
  - tests/web/app/AttachmentImport.test.ts
  - tests/web/app/BodyClasses.test.ts
  - tests/web/app/FileManager.test.ts
  - tests/web/app/cli/Cli.test.ts
  - tests/web/app/cli/commands/coreMisc.test.ts
  - tests/web/app/cli/commands/fileWrites.test.ts
  - tests/web/app/cli/commands/graphLists.test.ts
  - tests/web/app/cli/commands/linksOutlineCli.test.ts
  - tests/web/app/cli/commands/metadata.test.ts
  - tests/web/app/cli/commands/navigation.test.ts
  - tests/web/app/cli/commands/searchCli.test.ts
  - tests/web/app/cli/commands/wordcountWebCli.test.ts
  - tests/web/app/cli/commands/workspacesCli.test.ts
  - tests/web/app/cli/registerCliCommands.test.ts
  - tests/web/app/commands/CommandManager.test.ts
  - tests/web/app/commands/CommandPalette.test.ts
  - tests/web/app/menus/MenuManager.test.ts
  - tests/web/app/protocol/UriRouter.test.ts
  - tests/web/app/starter/StarterScreen.test.ts
  - tests/web/app/theme/CssContract.test.ts
  - tests/web/app/theme/CustomCss.test.ts
  - tests/web/bootstrap.test.ts
  - tests/web/builtin/Bookmarks.test.ts
  - tests/web/builtin/CommunityPluginMarketplaceModal.test.ts
  - tests/web/builtin/CommunityPluginsSettingTab.test.ts
  - tests/web/builtin/CorePluginsScope.test.ts
  - tests/web/builtin/FileExplorerView.test.ts
  - tests/web/builtin/FilesSettingTab.test.ts
  - tests/web/builtin/HotkeysSettingTab.test.ts
  - tests/web/builtin/LinkSuggest.test.ts
  - tests/web/builtin/MobileSettingTab.test.ts
  - tests/web/builtin/QuickSwitcher.test.ts
  - tests/web/builtin/SettingsDomParity.test.ts
  - tests/web/builtin/SlashCommand.test.ts
  - tests/web/builtin/TagSuggest.test.ts
  - tests/web/builtin/canvas/CanvasView.test.ts
  - tests/web/builtin/git/BranchSwitchModal.test.ts
  - tests/web/builtin/git/GitLogView.test.ts
  - tests/web/builtin/git/GitPlugin.test.ts
  - tests/web/builtin/git/GitService.test.ts
  - tests/web/builtin/git/review/GitNavView.test.ts
  - tests/web/builtin/git/review/GitReviewView.test.ts
  - tests/web/builtin/git/review/reviewModel.test.ts
  - tests/web/builtin/git/review/reviewNavModel.test.ts
  - tests/web/builtin/git/reviewSession.test.ts
  - tests/web/builtin/github/GitHubClient.test.ts
  - tests/web/builtin/github/GitHubWorkspace.test.tsx
  - tests/web/builtin/github/GitPrViews.test.tsx
  - tests/web/builtin/github/commits.test.ts
  - tests/web/builtin/github/extraApi.test.ts
  - tests/web/builtin/github/patchUtils.test.ts
  - tests/web/builtin/github/resolveRepository.test.ts
  - tests/web/builtin/graph/GraphDataEngine.test.ts
  - tests/web/builtin/graph/GraphSearchQuery.test.ts
  - tests/web/builtin/terminal/GhosttyTerminalRenderer.test.ts
  - tests/web/builtin/terminal/TerminalFocusScope.test.ts
  - tests/web/builtin/terminal/TerminalService.test.ts
  - tests/web/builtin/theme-market/ThemeMarket.test.ts
  - tests/web/builtin/webviewer/WebViewerAddressSuggest.test.ts
  - tests/web/builtin/webviewer/WebViewerElementAdapter.test.ts
  - tests/web/builtin/webviewer/WebViewerHistoryPersistence.test.ts
  - tests/web/builtin/webviewer/WebViewerReader.test.ts
  - tests/web/builtin/webviewer/WebViewerView.test.ts
  - tests/web/core/ApiUtils.test.ts
  - tests/web/core/Component.test.ts
  - tests/web/core/Events.test.ts
  - tests/web/dom/dom-helpers.test.ts
  - tests/web/dom/dom.test.ts
  - tests/web/editor/Editor.test.ts
  - tests/web/markdown/HtmlDropPreprocessor.test.ts
  - tests/web/markdown/HtmlToMarkdown.test.ts
  - tests/web/markdown/MarkdownDefaultProcessors.test.ts
  - tests/web/markdown/MarkdownPreviewRenderer.test.ts
  - tests/web/metadata/BlockCache.test.ts
  - tests/web/metadata/Frontmatter.test.ts
  - tests/web/metadata/LinkSuggestionManager.test.ts
  - tests/web/metadata/Linkpath.test.ts
  - tests/web/metadata/MetadataCache.test.ts
  - tests/web/platform/Platform.test.ts
  - tests/web/platform/desktop/DesktopMenu.test.ts
  - tests/web/platform/mobile/MobileBackButton.test.ts
  - tests/web/platform/mobile/MobileToolbar.test.ts
  - tests/web/platform/shell/ShellIntegration.test.ts
  - tests/web/plugin/CommunityPluginManagerParity.test.ts
  - tests/web/plugin/CorePluginConfig.test.ts
  - tests/web/plugin/InternalPluginWrapperParity.test.ts
  - tests/web/plugin/PluginApiParity.test.ts
  - tests/web/plugin/PluginDiscovery.test.ts
  - tests/web/plugin/PluginLifecycle.test.ts
  - tests/web/plugin/PluginMarketplace.test.ts
  - tests/web/plugin/PluginSettingTab.test.ts
  - tests/web/search/SearchEngine.test.ts
  - tests/web/setup.ts
  - tests/web/storage/AppConfig.test.ts
  - tests/web/storage/FileSystemJsonStoreAdapter.test.ts
  - tests/web/styles/StyleSystem.test.ts
  - tests/web/ui/Collapse.test.ts
  - tests/web/ui/Icon.test.ts
  - tests/web/ui/IconRegistryCompleteness.test.ts
  - tests/web/ui/Menu.test.ts
  - tests/web/ui/Modal.test.ts
  - tests/web/ui/ModalAudit.test.ts
  - tests/web/ui/Notice.test.ts
  - tests/web/ui/Popover.test.ts
  - tests/web/ui/Setting.test.ts
  - tests/web/ui/drag/DragManager.test.ts
  - tests/web/ui/suggest/AbstractInputSuggest.test.ts
  - tests/web/ui/suggest/ComboboxSuggest.test.ts
  - tests/web/ui/suggest/EditorSuggest.test.ts
  - tests/web/ui/suggest/FileInputSuggest.test.ts
  - tests/web/ui/suggest/SuggestModal.test.ts
  - tests/web/vault/FileSystemAdapter.test.ts
  - tests/web/vault/TAbstractFile.test.ts
  - tests/web/vault/Vault.test.ts
  - tests/web/vault/VaultFileSystemAdapter.test.ts
  - tests/web/views/CodeFileView.test.ts
  - tests/web/views/CodeSymbols.test.ts
  - tests/web/views/DiffView.test.ts
  - tests/web/views/FileViewMenuParity.test.ts
  - tests/web/views/MarkdownViewApiParity.test.ts
  - tests/web/views/MarkdownViewDragDrop.test.ts
  - tests/web/views/MarkdownViewPropertyKeys.test.ts
  - tests/web/views/MarkdownViewPropertyTypes.test.ts
  - tests/web/views/ReadingViewResize.test.ts
  - tests/web/views/StreamMarkdownRenderer.test.ts
  - tests/web/views/Typewriter.test.ts
  - tests/web/views/ViewApiParity.test.ts
  - tests/web/views/properties/AliasPropertyWidget.test.ts
  - tests/web/views/properties/MetadataTypeManager.test.ts
  - tests/web/views/properties/MultiValuePropertyWidget.test.ts
  - tests/web/views/properties/PropertyLinkRenderer.test.ts
  - tests/web/views/properties/PropertyLinkSuggest.test.ts
  - tests/web/views/properties/TagPropertyWidget.test.ts
  - tests/web/views/workspace/VaultSwitcher.test.ts
  - tests/web/views/workspace/ViewRegistry.test.ts
  - tests/web/views/workspace/WorkspaceApiAliasesParity.test.ts
  - tests/web/views/workspace/WorkspaceBrowserHistoryParity.test.ts
  - tests/web/views/workspace/WorkspaceClearLayoutParity.test.ts
  - tests/web/views/workspace/WorkspaceDomStructure.test.ts
  - tests/web/views/workspace/WorkspaceEvents.test.ts
  - tests/web/views/workspace/WorkspaceHoverSourcesParity.test.ts
  - tests/web/views/workspace/WorkspaceIterateCodeMirrorsParity.test.ts
  - tests/web/views/workspace/WorkspaceLayoutPersistence.test.ts
  - tests/web/views/workspace/WorkspaceLayoutReadyParity.test.ts
  - tests/web/views/workspace/WorkspaceLeaf.test.ts
  - tests/web/views/workspace/WorkspaceLeafEventsParity.test.ts
  - tests/web/views/workspace/WorkspaceParentInsertParity.test.ts
  - tests/web/views/workspace/WorkspacePopoutAndTabList.test.ts
  - tests/web/views/workspace/WorkspacePublicApi.test.ts
  - tests/web/views/workspace/WorkspaceReadWorkspaceFileParity.test.ts
  - tests/web/views/workspace/WorkspaceRegisterUriHookParity.test.ts
  - tests/web/views/workspace/WorkspaceRibbon.test.ts
  - tests/web/views/workspace/WorkspaceSplit.test.ts
  - tests/web/views/workspace/WorkspaceTabHeaderMenu.test.ts
  - tests/web/views/workspace/WorkspaceTraversalParity.test.ts

=== Task Sketch ===

Group 1 (order 1):
  Scenarios:
    - the workspace is a single package (critical)
    - the renderer never imports the shell (critical)
    - the native port contracts live in shared
    - both sides compile against the shared contracts
    - no presenter or framework machinery is introduced
    - vault open stays within budget (critical)
    - the kernel port is reserved but unimplemented
    - block rendering never depends on the kernel port
  Boundary paths:
    - src/**
    - apps/**
  Test selectors:
    - declares a single-package src layout
    - keeps the renderer free of shell imports
    - declares the native port contracts in shared
    - imports the shared contracts from both main and renderer
    - keeps zod presenters and UI frameworks out of the dependency table
    - keeps openFile median under the budget on a huge vault
    - reserves the kernel port without an implementation
    - keeps renderer rendering free of the kernel port

=== Warnings ===

  - Allowed Changes path not found: src/** (resolved to ./src)
