=== Contract ===

# Task Contract: shared tree item component

## Intent
Collapse the ~13 hand-rolled tree/collapse-row implementations across the
renderer onto ONE shared, Obsidian-faithful `TreeItem` component, so the
collapse chevron, indent gutter, nesting, and collapse state are packaged
together and every tree view aligns by construction instead of by per-view
DOM. This is the missing half of a faithful port: the tree-item and collapse
CSS is already Obsidian's, but the component is not — each view re-implements
the structure, which is why the Git Changes view drifts 37px from the others.
No behaviour change beyond consolidation and alignment.

## Current State
The renderer ports Obsidian's tree-item + collapse CSS faithfully
(`styles/components/tree-item.css`, `collapse-indicator.css`), including the
alignment mechanism: the collapse chevron (`.tree-item-self .tree-item-icon`)
is `position: absolute` in a left gutter, leaf rows use `--nav-item-padding`,
collapsible rows (`.mod-collapsible`) use `--nav-item-parent-padding`, nesting
via `.tree-item-children`. But there is no shared component: ~13 sites
hand-build the DOM — FileExplorerView, git GitChangesView / GitLogView /
GitHistoryView, git/review GitNavView / ReviewSurface, OutlineView, Bookmarks,
TagPaneView, BacklinksView, OutgoingLinksView, graph GraphControls — and
`ui/NavFolder.ts` is a partial helper covering only the collapsible-folder
case. GitChangesView hand-rolls flat `nav-file` rows with no `mod-collapsible`
gutter and no nesting, so its file rows sit 37px left of tree rows (measured
live). Obsidian instead ships ONE `TreeItem` (a Component with `el`, `selfEl`,
`innerEl`, `childrenEl`, `collapseEl`, and `setCollapsed` / `setCollapsible` /
`addChild`) reused by every tree view (decode-obsidian app.js). The full
site survey, the alignment mechanism, and the verbatim Obsidian `TreeItem`
API fragments are recorded in research.md.

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
- One app, one package: the repo root is the single application package; its
- The native seam is ports-and-adapters: the shell fills the ports the renderer
- Dual-track plugin architecture: `builtin/` is the internal track and may use
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only from
- Disk access stays in-process behind the `DataAdapter` seam in the renderer
- Unit tests are centralized under `tests/` (workspace member), mirroring
- The docs household is docwright goals under
- Build a `TreeItem` class (extends the renderer's `Component`) that is a
- Migrate ALL 13 hand-rolled tree sites to `TreeItem`: no view constructs
- Alignment is structural, not per-view: rows align because they share the
- GitChangesView's Changes/Staged sections become real collapsible `TreeItem`
- The markdown heading/list fold stays on its own `.collapse-indicator` editor
- No behaviour change beyond consolidation and alignment; no new production

## Boundaries
Allowed changes:
- src/renderer/ui/**
- src/renderer/builtin/**
- src/renderer/views/**
- src/renderer/styles/**
- tests/**
- docs/**
Forbidden:
- Do not route the markdown heading/list fold through `TreeItem` — it stays
- Do not change tree-view behaviour beyond consolidation and alignment: same
- Do not weaken, skip or delete existing tests to make a gate pass.
- Do not add a production dependency or reintroduce a UI framework.
- Do not invent the `TreeItem` API — port Obsidian's (addChild, setCollapsed,
Out of scope:
- The markdown heading/list fold mechanism — separate by design.
- Any change to tree-view behaviour (selection, drag/drop, context menus,
- New tree views, panes, or features.

## Completion Criteria

Rule: single-primitive — one component, every tree view uses it
Scenario: no view hand-rolls tree-item DOM (critical)
  Test:
    Filter: builds every tree row through the shared tree item
  Given the migrated tree views
  When their sources are scanned for tree-item-self, nav-folder-title and
  Then only the TreeItem component constructs that DOM

Scenario: the partial NavFolder helper is folded in
  Test:
    Filter: replaces NavFolder with the tree item component
  Given src/renderer/ui
  When it is inspected
  Then NavFolder is absent and TreeItem is the sole tree-row builder


Rule: faithful-api — TreeItem mirrors Obsidian
Scenario: the tree item exposes Obsidian's surface
  Test:
    Filter: exposes the Obsidian tree item surface
  Given the TreeItem class
  When its DOM and methods are inspected
  Then it builds tree-item, tree-item-self, tree-item-icon collapse-icon,


Rule: native-alignment — rows align by construction
Scenario: leaf and collapsible rows align at equal depth (critical)
  Test:
    Filter: keeps tree rows aligned across views
  Given a leaf file row and a collapsible row at the same depth
  When their content inset is measured
  Then they share one inset — the machine check guards the shared


Rule: changes-native-structure — sections collapsible, files nested
Scenario: Git Changes sections are collapsible tree parents
  Test:
    Filter: nests Git Changes files under collapsible sections
  Given GitChangesView rendered on a repo with staged and unstaged files
  When the section and file DOM is inspected
  Then each section is a collapsible TreeItem and its files are nested in


Rule: markdown-fold-separate — fold stays its own mechanism
Scenario: markdown fold does not import the tree item
  Test:
    Filter: keeps markdown fold off the tree component
  Given the markdown heading and list fold modules
  When their imports are resolved
  Then none imports the TreeItem component

=== Codebase Context ===

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

=== Task Sketch ===

Group 1 (order 1):
  Scenarios:
    - no view hand-rolls tree-item DOM (critical)
    - the partial NavFolder helper is folded in
    - the tree item exposes Obsidian's surface
    - leaf and collapsible rows align at equal depth (critical)
    - Git Changes sections are collapsible tree parents
    - markdown fold does not import the tree item
  Boundary paths:
    - src/renderer/ui/**
  Test selectors:
    - builds every tree row through the shared tree item
    - replaces NavFolder with the tree item component
    - exposes the Obsidian tree item surface
    - keeps tree rows aligned across views
    - nests Git Changes files under collapsible sections
    - keeps markdown fold off the tree component

