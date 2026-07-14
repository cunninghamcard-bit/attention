---
artifact: research
goal: "shared tree item component"
derived_into: spec.md
---

# shared tree item component — Research

> Follow every claim back to the source that owns it. Primary sources
> first; never trust parametric knowledge. See the docwright-research
> skill for the methodology.

## Unknowns

- U1 — Migration scope: which of the ~13 hand-rolled tree sites adopt the
  shared component in THIS goal vs deferred follow-ups?
- U2 — Component shape: a functional factory (generalize `createNavFolder`)
  or a `Tree`/`TreeItem` class mirroring Obsidian more literally?
- U3 — Is the markdown heading/list fold (a separate `.collapse-indicator`
  editor mechanism) in scope?
- U4 — Does the Git Changes "Changes/Staged" section become a real
  collapsible tree parent with files nested (native), or stay flat?
- U5 — What is the machine-checkable acceptance criterion for "aligned"?

## Industry Norms & Prior Art

- Obsidian ships ONE shared tree primitive reused by the file explorer,
  tags, bookmarks, search, outline, backlinks. Its runtime exposes
  `setCollapsed` (44 occurrences), `addChild` (101), `collapseEl`, and
  `tree-item-children`. Source: `decode-obsidian/ref/obsidian/app.js`.
- Alignment is CSS-structural, not per-view: the collapse chevron
  (`.tree-item-self .tree-item-icon`) is `position: absolute` with
  `margin-inline-start: calc(-1 * var(--size-4-5))` — it lives in a left
  gutter and never displaces content; leaf rows use `--nav-item-padding`,
  collapsible rows (`.mod-collapsible`) use `--nav-item-parent-padding`,
  nesting via `.tree-item-children { padding-inline-start }`. So a file and
  a folder at the same depth align by construction. Source:
  `decode-obsidian/ref/obsidian/app.css` (ported into
  `src/renderer/styles/components/tree-item.css` and `collapse-indicator.css`).
- The collapse icon is one shared atom (`right-triangle`, a stroked down
  chevron rotated by `.is-collapsed`), not per-site — matching our fixed
  `Icon.ts`. Source: `decode-obsidian/ref/obsidian/app.js`.
- Obsidian's `TreeItem` is a Component: `createDiv("tree-item-self")`,
  `this.collapseEl = …createDiv("tree-item-icon collapse-icon")` (prepended
  when collapsible, wired to `onCollapseClick`), `childrenEl` lazily created
  as `tree-item-children`, `setCollapsed(b)` → `toggleClass("is-collapsed", b)`,
  `setCollapsible(b)` → `toggleClass("mod-collapsible", b)` + add/remove the
  chevron, `addChild(item)` pushes a child TreeItem and loads it if loaded.
  Source: `decode-obsidian/ref/obsidian/app.js` (verbatim minified fragments).

## Current Codebase State

<!-- docwright:generated:start -->
Files (439):
- docs/architecture.md
- docs/architecture/native-git-surfaces/spec.md
- docs/architecture/obsidian-appearance-parity/spec.md
- docs/architecture/shared-tree-item-component/learning-records/0001-adopt-shared-tree-component.md
- docs/architecture/shared-tree-item-component/learning-records/0002-changes-sections-collapsible.md
- docs/architecture/shared-tree-item-component/learning-records/0003-migrate-all-tree-sites.md
- docs/architecture/shared-tree-item-component/learning-records/0004-tree-class-mirror-obsidian.md
- docs/architecture/shared-tree-item-component/learning-records/0005-markdown-fold-follow-obsidian.md
- docs/architecture/shared-tree-item-component/research.md
- docs/architecture/shared-tree-item-component/spec.md
- docs/architecture/single-package-shell/spec.md
- docs/architecture/vanilla-ui-consolidation/spec.md
- docs/features/codiff-right-sidebar/spec.md
- docs/features/local-git-surface-completion/learning-records/0001-scope-and-reference.md
- docs/features/local-git-surface-completion/learning-records/0002-local-commits-view.md
- docs/features/local-git-surface-completion/spec.md
- docs/issues/large-vault-click-latency/spec.md
- docs/issues/reading-view-stale-layout/spec.md
- docs/learning/single-package-shell/0001-layout-single-package.md
- docs/learning/single-package-shell/0002-fitting-architecture.md
- docs/project.spec.md
- src/renderer/builtin/AppearanceSettingTab.ts
- src/renderer/builtin/AudioRecorder.ts
- src/renderer/builtin/BacklinksView.ts
- src/renderer/builtin/Bookmarks.ts
- src/renderer/builtin/BuiltinViews.ts
- src/renderer/builtin/CommunityPluginMarketplaceModal.ts
- src/renderer/builtin/CommunityPluginTrustModal.ts
- src/renderer/builtin/CommunityPluginsSettingTab.ts
- src/renderer/builtin/CorePlugins.ts
- src/renderer/builtin/CorePluginsSettingTab.ts
- src/renderer/builtin/DailyNotes.ts
- src/renderer/builtin/DeveloperConsoleView.ts
- src/renderer/builtin/EditorStatus.ts
- src/renderer/builtin/FileExplorerView.ts
- src/renderer/builtin/FilesSettingTab.ts
- src/renderer/builtin/HotkeysSettingTab.ts
- src/renderer/builtin/LinkSuggest.ts
- src/renderer/builtin/MarkdownImporter.ts
- src/renderer/builtin/MobileSettingTab.ts
- src/renderer/builtin/NoteComposer.ts
- src/renderer/builtin/OutgoingLinksView.ts
- src/renderer/builtin/OutlineView.ts
- src/renderer/builtin/PagePreview.ts
- src/renderer/builtin/QuickSwitcher.ts
- src/renderer/builtin/RandomNote.ts
- src/renderer/builtin/SearchView.ts
- src/renderer/builtin/SettingsModal.ts
- src/renderer/builtin/SettingsRenderer.ts
- src/renderer/builtin/SettingsView.ts
- src/renderer/builtin/SlashCommand.ts
- src/renderer/builtin/Slides.ts
- src/renderer/builtin/TagPaneView.ts
- src/renderer/builtin/TagSuggest.ts
- src/renderer/builtin/Templates.ts
- src/renderer/builtin/WordCount.ts
- src/renderer/builtin/Workspaces.ts
- src/renderer/builtin/ZkPrefixer.ts
- src/renderer/builtin/canvas/Canvas.ts
- src/renderer/builtin/canvas/CanvasData.ts
- src/renderer/builtin/canvas/CanvasEdge.ts
- src/renderer/builtin/canvas/CanvasNode.ts
- src/renderer/builtin/canvas/CanvasView.ts
- src/renderer/builtin/file-recovery/FileRecovery.ts
- src/renderer/builtin/file-recovery/FileRecoveryPlugin.ts
- src/renderer/builtin/file-recovery/RevisionHistory.ts
- src/renderer/builtin/git/BranchSwitchModal.ts
- src/renderer/builtin/git/GitChangesView.ts
- src/renderer/builtin/git/GitHistoryView.ts
- src/renderer/builtin/git/GitLogView.ts
- src/renderer/builtin/git/GitPlugin.ts
- src/renderer/builtin/git/GitService.ts
- src/renderer/builtin/git/relativeDate.ts
- src/renderer/builtin/git/review/GitNavView.ts
- src/renderer/builtin/git/review/GitReviewView.ts
- src/renderer/builtin/git/review/ReviewSurface.ts
- src/renderer/builtin/git/review/reviewModel.ts
- src/renderer/builtin/git/review/reviewNavModel.ts
- src/renderer/builtin/git/reviewSession.ts
- src/renderer/builtin/github/GitHubClient.ts
- src/renderer/builtin/github/GitHubExtraPanels.ts
- src/renderer/builtin/github/GitHubPlugin.ts
- src/renderer/builtin/github/GitHubService.ts
- src/renderer/builtin/github/GitHubWorkspace.ts
- src/renderer/builtin/github/GitPrViews.ts
- src/renderer/builtin/github/patchUtils.ts
- src/renderer/builtin/github/prefs.ts
- src/renderer/builtin/github/resolveRepository.ts
- src/renderer/builtin/github/types.ts
- src/renderer/builtin/graph/GraphControls.ts
- src/renderer/builtin/graph/GraphDataEngine.ts
- src/renderer/builtin/graph/GraphOptions.ts
- src/renderer/builtin/graph/GraphPlugin.ts
- src/renderer/builtin/graph/GraphRenderer.ts
- src/renderer/builtin/graph/GraphSearchQuery.ts
- src/renderer/builtin/graph/GraphStyles.ts
- src/renderer/builtin/graph/GraphView.ts
- src/renderer/builtin/graph/GraphViewPlugin.ts
- src/renderer/builtin/terminal/GhosttyTerminalRenderer.ts
- src/renderer/builtin/terminal/TerminalAdapter.ts
- src/renderer/builtin/terminal/TerminalPlugin.ts
- src/renderer/builtin/terminal/TerminalService.ts
- src/renderer/builtin/terminal/TerminalView.ts
- src/renderer/builtin/theme-market/ThemeInstaller.ts
- src/renderer/builtin/theme-market/ThemeManifest.ts
- src/renderer/builtin/theme-market/ThemeManifestValidator.ts
- src/renderer/builtin/theme-market/ThemeMarketplace.ts
- src/renderer/builtin/theme-market/ThemeMarketplaceModal.ts
- src/renderer/builtin/webviewer/BrowserSessionBridge.ts
- src/renderer/builtin/webviewer/WebContentsBridge.ts
- src/renderer/builtin/webviewer/WebViewerAddressSuggest.ts
- src/renderer/builtin/webviewer/WebViewerElementAdapter.ts
- src/renderer/builtin/webviewer/WebViewerPlugin.ts
- src/renderer/builtin/webviewer/WebViewerReader.ts
- src/renderer/builtin/webviewer/WebViewerService.ts
- src/renderer/styles/base/platform-mobile.css
- src/renderer/styles/base/reset.css
- src/renderer/styles/base/rtl.css
- src/renderer/styles/components/button-card.css
- src/renderer/styles/components/checkbox.css
- src/renderer/styles/components/clickable-icon.css
- src/renderer/styles/components/collapse-indicator.css
- src/renderer/styles/components/document-search.css
- src/renderer/styles/components/dropdown.css
- src/renderer/styles/components/menu.css
- src/renderer/styles/components/modal-dialog.css
- src/renderer/styles/components/notice.css
- src/renderer/styles/components/popover-prompt-scrollbar.css
- src/renderer/styles/components/suggestion-tabs.css
- src/renderer/styles/components/text-input.css
- src/renderer/styles/components/tooltip.css
- src/renderer/styles/components/tree-item.css
- src/renderer/styles/editor/callout.css
- src/renderer/styles/editor/cm-cursor.css
- src/renderer/styles/editor/cm6.css
- src/renderer/styles/editor/code.css
- src/renderer/styles/editor/embeds.css
- src/renderer/styles/editor/footnotes.css
- src/renderer/styles/editor/headings-hr.css
- src/renderer/styles/editor/inline-title.css
- src/renderer/styles/editor/links-tasks.css
- src/renderer/styles/editor/lists.css
- src/renderer/styles/editor/properties-metadata.css
- src/renderer/styles/editor/reading-view.css
- src/renderer/styles/editor/rendered-content.css
- src/renderer/styles/editor/source-view.css
- src/renderer/styles/editor/syntax-highlight.css
- src/renderer/styles/editor/tables.css
- src/renderer/styles/features/bookmarks-nav.css
- src/renderer/styles/features/community-plugins.css
- src/renderer/styles/features/file-recovery.css
- src/renderer/styles/features/graph-outline.css
- src/renderer/styles/features/pdf-view.css
- src/renderer/styles/features/search.css
- src/renderer/styles/features/settings-item.css
- src/renderer/styles/features/tag-pane-canvas.css
- src/renderer/styles/features/webviewer-workspaces.css
- src/renderer/styles/index.css
- src/renderer/styles/product/code-view.css
- src/renderer/styles/product/diff.css
- src/renderer/styles/product/explorer.css
- src/renderer/styles/product/git-changes.css
- src/renderer/styles/product/git-prs.css
- src/renderer/styles/product/git-review.css
- src/renderer/styles/product/starter.css
- src/renderer/styles/product/terminal.css
- src/renderer/styles/product/theme-market.css
- src/renderer/styles/reveal/black.css
- src/renderer/styles/reveal/reveal.css
- src/renderer/styles/reveal/white.css
- src/renderer/styles/tokens/tokens.css
- src/renderer/styles/vendor/pdfjs-messagebar-dialog.css
- src/renderer/styles/vendor/pdfjs-viewer.css
- src/renderer/styles/workspace/app-container.css
- src/renderer/styles/workspace/empty-state.css
- src/renderer/styles/workspace/ribbon-sidedock.css
- src/renderer/styles/workspace/splits-tabs.css
- src/renderer/styles/workspace/starter-splash.css
- src/renderer/styles/workspace/status-bar.css
- src/renderer/styles/workspace/titlebar-frameless.css
- src/renderer/styles/workspace/titlebar-vault-profile.css
- src/renderer/styles/workspace/view-header.css
- src/renderer/ui/ActiveCloseableRegistry.ts
- src/renderer/ui/Collapse.ts
- src/renderer/ui/FileTypeIcon.ts
- src/renderer/ui/Icon.ts
- src/renderer/ui/Menu.ts
- src/renderer/ui/Modal.ts
- src/renderer/ui/NavFolder.ts
- src/renderer/ui/Notice.ts
- src/renderer/ui/Popover.ts
- src/renderer/ui/ProgressBar.ts
- src/renderer/ui/Setting.ts
- src/renderer/ui/drag/DragManager.ts
- src/renderer/ui/hover/HoverPreviewController.ts
- src/renderer/ui/suggest/AbstractInputSuggest.ts
- src/renderer/ui/suggest/ComboboxSuggest.ts
- src/renderer/ui/suggest/EditorSuggest.ts
- src/renderer/ui/suggest/FileInputSuggest.ts
- src/renderer/ui/suggest/SuggestModal.ts
- src/renderer/views/CodeFileView.ts
- src/renderer/views/CodeSymbols.ts
- src/renderer/views/DeferredView.ts
- src/renderer/views/DiffView.ts
- src/renderer/views/EditableFileView.ts
- src/renderer/views/EmptyView.ts
- src/renderer/views/FileView.ts
- src/renderer/views/ItemView.ts
- src/renderer/views/MarkdownView.ts
- src/renderer/views/MediaViews.ts
- src/renderer/views/StreamMarkdownRenderer.ts
- src/renderer/views/StreamScroller.ts
- src/renderer/views/StreamView.ts
- src/renderer/views/TextFileView.ts
- src/renderer/views/Typewriter.ts
- src/renderer/views/UnknownView.ts
- src/renderer/views/View.ts
- src/renderer/views/properties/AliasPropertyWidget.ts
- src/renderer/views/properties/EditablePropertyPill.ts
- src/renderer/views/properties/MetadataTypeManager.ts
- src/renderer/views/properties/MultiValuePropertyWidget.ts
- src/renderer/views/properties/PropertyLinkRenderer.ts
- src/renderer/views/properties/PropertyLinkSuggest.ts
- src/renderer/views/properties/PropertyRegistry.ts
- src/renderer/views/properties/PropertyStore.ts
- src/renderer/views/properties/PropertyTypeMismatchModal.ts
- src/renderer/views/properties/PropertyTypes.ts
- src/renderer/views/properties/TagPropertyWidget.ts
- src/renderer/views/workspace/RecentFileTracker.ts
- src/renderer/views/workspace/ViewRegistry.ts
- src/renderer/views/workspace/Workspace.ts
- src/renderer/views/workspace/WorkspaceContainer.ts
- src/renderer/views/workspace/WorkspaceDragManager.ts
- src/renderer/views/workspace/WorkspaceFloating.ts
- src/renderer/views/workspace/WorkspaceHover.ts
- src/renderer/views/workspace/WorkspaceItem.ts
- src/renderer/views/workspace/WorkspaceLayout.ts
- src/renderer/views/workspace/WorkspaceLayoutPersistence.ts
- src/renderer/views/workspace/WorkspaceLayoutSerializer.ts
- src/renderer/views/workspace/WorkspaceLeaf.ts
- src/renderer/views/workspace/WorkspaceParent.ts
- src/renderer/views/workspace/WorkspaceRibbon.ts
- src/renderer/views/workspace/WorkspaceRoot.ts
- src/renderer/views/workspace/WorkspaceSidedock.ts
- src/renderer/views/workspace/WorkspaceSplit.ts
- src/renderer/views/workspace/WorkspaceTabs.ts
- src/renderer/views/workspace/WorkspaceWindow.ts
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
- tests/web/builtin/AppearanceSettingTab.test.ts
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
- tests/web/builtin/git/GitNativeViews.test.ts
- tests/web/builtin/git/GitPlugin.test.ts
- tests/web/builtin/git/GitService.test.ts
- tests/web/builtin/git/GitThemeContract.test.ts
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
- tests/web/ui/NavFolder.test.ts
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
<!-- docwright:generated:end -->

Manual survey (grep of `src/renderer`, excluding styles):
- ~13 sites hand-build tree-item DOM: FileExplorerView (19 refs), git/review
  GitNavView (17) & ReviewSurface (16), git GitChangesView (10),
  OutlineView (8), Bookmarks (8), TagPaneView (6), git GitLogView (5),
  git GitHistoryView (4), graph GraphControls (3), OutgoingLinksView (1),
  BacklinksView (1), and `ui/NavFolder.ts` (5) — the only extracted helper.
- `NavFolder.createNavFolder` already packages the folder variant
  (tree-item/nav-folder DOM + collapse-icon + `setCollapsed`), used by
  FileExplorer.renderFolder and GitLogView. It is the seed of the shared
  component but covers only the collapsible-folder case, not leaf rows,
  nesting depth, or non-folder semantics.
- The tree-item + collapse CSS is already a faithful Obsidian port; the gap
  is behavioral/DOM (every view re-implements the structure), which is why
  GitChangesView (flat, hand-rolled `nav-file` rows, no `mod-collapsible`
  gutter, no nesting) sits 37px left of tree rows — measured live.

## Findings

### F1: Migration scope

- **Decision**: [PENDING GRILL] Recommend: build the shared component and
  migrate the Git surfaces that carry the reported defect (GitChangesView,
  GitLogView, GitHistoryView, GitNavView, ReviewSurface) plus keep
  FileExplorer on it (already via NavFolder). Defer the peripheral panes
  (Outline, Bookmarks, TagPane, Backlinks, OutgoingLinks, GraphControls) to
  follow-up goals, but design the component API to serve them.
- **Rationale**: bounds blast radius to the surfaces the user is looking at
  while proving the primitive; the deferred panes already function.
- **Alternatives considered**: (a) migrate all 13 at once — maximal
  consistency, large risky diff; (b) git-only, leave FileExplorer on the
  partial NavFolder — leaves two tree builders.

### F2: Component shape

- **Decision**: [PENDING GRILL] Recommend: a functional factory
  (`createTreeItem(parent, opts)`) that generalizes `createNavFolder` —
  `collapsible` (chevron + gutter + `setCollapsed`) vs leaf variant, a
  `childrenEl` for nesting, returns the element handles the caller wires.
- **Rationale**: matches the codebase's vanilla, factory idiom (NavFolder,
  createBridge-free); no class hierarchy to maintain.
- **Alternatives considered**: a `Tree`/`TreeItem` class with
  `addChild`/`setCollapsed` mirroring Obsidian literally — most faithful but
  heavier and unlike our existing primitives.

### F3: Markdown fold scope

- **Decision**: [PENDING GRILL] Recommend: OUT of scope. Heading/list fold
  uses the editor-integrated `.collapse-indicator` system, not tree-item
  rows; it shares only the `right-triangle` atom (already fixed).
- **Rationale**: different mechanism and lifecycle; folding into this goal
  widens it without alignment payoff.
- **Alternatives considered**: unify both under one collapse abstraction —
  premature; the two live in different subsystems.

### F4: Git Changes structure

- **Decision**: [PENDING GRILL] Recommend (user leaning YES): the
  Changes/Staged sections become real collapsible tree parents with file
  rows nested in `.tree-item-children` — the native source-control shape.
- **Rationale**: gives structural alignment for free and matches Obsidian /
  VS Code source control; removes the flat-row special case.
- **Alternatives considered**: keep sections flat, only reserve the gutter
  on leaf rows — smaller change, but keeps a non-native special case.

### F5: Alignment acceptance criterion

- **Decision**: [PENDING GRILL] Recommend: a structural test asserting that
  tree rows across the migrated views share one construction path (import
  the shared factory) AND that leaf/parent rows at equal depth resolve to
  equal content inset — encodable as a DOM-geometry or import-graph check.
- **Rationale**: makes "aligned" a regression guard, not a screenshot.
- **Alternatives considered**: human-review only — loses the guard.
