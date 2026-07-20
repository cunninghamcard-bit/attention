# monorepo-restore — 搬家对照表 + 静止 hash 基线

分支: feat/monorepo-restore · 基线: main @ 99a3a09 · 生成: 2026-07-20
标准: 全部现有测试/e2e/gate 在新布局下重新全绿。

## 0. 验证命令（可复现）

- 搬家纯净度: `git diff --find-renames 99a3a09..50b9ae6 --name-status` → 446/446 R100（零内容改动）
- 内核字节一致: `git diff agent-form/main HEAD -- cmd internal extension specs go.mod go.sum` → 空
- 内核历史可达: `git log --follow -- cmd/along/main.go` → 原仓提交在原哈希上
- 门: `mise run gate`（format:check + lint + typecheck + vitest + kernel:test）

## 1. 纯搬家（R100，blob hash 逐字节不变，446 条）

| src/main/app-protocol-register.ts | apps/desktop/main/app-protocol-register.ts | R100 |
| src/main/app-protocol.ts | apps/desktop/main/app-protocol.ts | R100 |
| src/main/cli/CliClient.ts | apps/desktop/main/cli/CliClient.ts | R100 |
| src/main/cli/CliDispatch.ts | apps/desktop/main/cli/CliDispatch.ts | R100 |
| src/main/cli/CliServer.ts | apps/desktop/main/cli/CliServer.ts | R100 |
| src/main/cli/CliVaultRouter.ts | apps/desktop/main/cli/CliVaultRouter.ts | R100 |
| src/main/desktop-bridge.ts | apps/desktop/main/desktop-bridge.ts | R100 |
| src/main/foundation-ipc.ts | apps/desktop/main/foundation-ipc.ts | R100 |
| src/main/git-bridge.ts | apps/desktop/main/git-bridge.ts | R100 |
| src/main/ipc.ts | apps/desktop/main/ipc.ts | R100 |
| src/main/json-store.ts | apps/desktop/main/json-store.ts | R100 |
| src/main/main.ts | apps/desktop/main/main.ts | R100 |
| src/main/menu.ts | apps/desktop/main/menu.ts | R100 |
| src/main/net-request.ts | apps/desktop/main/net-request.ts | R100 |
| src/main/obsidian-protocol.ts | apps/desktop/main/obsidian-protocol.ts | R100 |
| src/main/obsidian-url.ts | apps/desktop/main/obsidian-url.ts | R100 |
| src/main/renderer-target.ts | apps/desktop/main/renderer-target.ts | R100 |
| src/main/session-hardening.ts | apps/desktop/main/session-hardening.ts | R100 |
| src/main/settings.ts | apps/desktop/main/settings.ts | R100 |
| src/main/starter-window.ts | apps/desktop/main/starter-window.ts | R100 |
| src/main/state.ts | apps/desktop/main/state.ts | R100 |
| src/main/system-fonts.ts | apps/desktop/main/system-fonts.ts | R100 |
| src/main/terminal-bridge.ts | apps/desktop/main/terminal-bridge.ts | R100 |
| src/main/tsconfig.json | apps/desktop/main/tsconfig.json | R100 |
| src/main/vault-registry.ts | apps/desktop/main/vault-registry.ts | R100 |
| src/main/vault-windows.ts | apps/desktop/main/vault-windows.ts | R100 |
| src/main/vite.config.ts | apps/desktop/main/vite.config.ts | R100 |
| src/main/window-state.ts | apps/desktop/main/window-state.ts | R100 |
| src/main/window.ts | apps/desktop/main/window.ts | R100 |
| src/main/zsh-shim.ts | apps/desktop/main/zsh-shim.ts | R100 |
| src/preload/preload.ts | apps/desktop/preload/preload.ts | R100 |
| src/renderer/api/ObsidianPluginModule.ts | apps/web/api/ObsidianPluginModule.ts | R100 |
| src/renderer/api/PluginApiFacade.ts | apps/web/api/PluginApiFacade.ts | R100 |
| src/renderer/api/PublicApi.ts | apps/web/api/PublicApi.ts | R100 |
| src/renderer/app/App.ts | apps/web/app/App.ts | R100 |
| src/renderer/app/AppCommands.ts | apps/web/app/AppCommands.ts | R100 |
| src/renderer/app/AppDom.ts | apps/web/app/AppDom.ts | R100 |
| src/renderer/app/AppLifecycle.ts | apps/web/app/AppLifecycle.ts | R100 |
| src/renderer/app/AppProtocolHandlers.ts | apps/web/app/AppProtocolHandlers.ts | R100 |
| src/renderer/app/AttachmentImport.ts | apps/web/app/AttachmentImport.ts | R100 |
| src/renderer/app/BodyClasses.ts | apps/web/app/BodyClasses.ts | R100 |
| src/renderer/app/FileManager.ts | apps/web/app/FileManager.ts | R100 |
| src/renderer/app/FrameDom.ts | apps/web/app/FrameDom.ts | R100 |
| src/renderer/app/MetadataIndexingNotice.ts | apps/web/app/MetadataIndexingNotice.ts | R100 |
| src/renderer/app/MoveFileModal.ts | apps/web/app/MoveFileModal.ts | R100 |
| src/renderer/app/QuitEvent.ts | apps/web/app/QuitEvent.ts | R100 |
| src/renderer/app/SettingRegistry.ts | apps/web/app/SettingRegistry.ts | R100 |
| src/renderer/app/SettingTab.ts | apps/web/app/SettingTab.ts | R100 |
| src/renderer/app/SettingsSection.ts | apps/web/app/SettingsSection.ts | R100 |
| src/renderer/app/StatusBar.ts | apps/web/app/StatusBar.ts | R100 |
| src/renderer/app/WorkspaceServices.ts | apps/web/app/WorkspaceServices.ts | R100 |
| src/renderer/app/cli/Cli.ts | apps/web/app/cli/Cli.ts | R100 |
| src/renderer/app/cli/commands/coreMisc.ts | apps/web/app/cli/commands/coreMisc.ts | R100 |
| src/renderer/app/cli/commands/fileWrites.ts | apps/web/app/cli/commands/fileWrites.ts | R100 |
| src/renderer/app/cli/commands/graphLists.ts | apps/web/app/cli/commands/graphLists.ts | R100 |
| src/renderer/app/cli/commands/helpers.ts | apps/web/app/cli/commands/helpers.ts | R100 |
| src/renderer/app/cli/commands/linksOutlineCli.ts | apps/web/app/cli/commands/linksOutlineCli.ts | R100 |
| src/renderer/app/cli/commands/metadata.ts | apps/web/app/cli/commands/metadata.ts | R100 |
| src/renderer/app/cli/commands/navigation.ts | apps/web/app/cli/commands/navigation.ts | R100 |
| src/renderer/app/cli/commands/searchCli.ts | apps/web/app/cli/commands/searchCli.ts | R100 |
| src/renderer/app/cli/commands/wordcountWebCli.ts | apps/web/app/cli/commands/wordcountWebCli.ts | R100 |
| src/renderer/app/cli/commands/workspacesCli.ts | apps/web/app/cli/commands/workspacesCli.ts | R100 |
| src/renderer/app/cli/registerCliCommands.ts | apps/web/app/cli/registerCliCommands.ts | R100 |
| src/renderer/app/commands/CommandManager.ts | apps/web/app/commands/CommandManager.ts | R100 |
| src/renderer/app/commands/CommandPalette.ts | apps/web/app/commands/CommandPalette.ts | R100 |
| src/renderer/app/diagnostics/DiagnosticsManager.ts | apps/web/app/diagnostics/DiagnosticsManager.ts | R100 |
| src/renderer/app/diagnostics/ErrorReporter.ts | apps/web/app/diagnostics/ErrorReporter.ts | R100 |
| src/renderer/app/diagnostics/Logger.ts | apps/web/app/diagnostics/Logger.ts | R100 |
| src/renderer/app/diagnostics/PluginErrorBoundary.ts | apps/web/app/diagnostics/PluginErrorBoundary.ts | R100 |
| src/renderer/app/hotkeys/HotkeyManager.ts | apps/web/app/hotkeys/HotkeyManager.ts | R100 |
| src/renderer/app/hotkeys/Keymap.ts | apps/web/app/hotkeys/Keymap.ts | R100 |
| src/renderer/app/hotkeys/Scope.ts | apps/web/app/hotkeys/Scope.ts | R100 |
| src/renderer/app/menus/MenuManager.ts | apps/web/app/menus/MenuManager.ts | R100 |
| src/renderer/app/protocol/UriRouter.ts | apps/web/app/protocol/UriRouter.ts | R100 |
| src/renderer/app/protocol/scheme.ts | apps/web/app/protocol/scheme.ts | R100 |
| src/renderer/app/release/BuildPipeline.ts | apps/web/app/release/BuildPipeline.ts | R100 |
| src/renderer/app/release/BuildTarget.ts | apps/web/app/release/BuildTarget.ts | R100 |
| src/renderer/app/release/ReleaseChannel.ts | apps/web/app/release/ReleaseChannel.ts | R100 |
| src/renderer/app/release/ReleaseManager.ts | apps/web/app/release/ReleaseManager.ts | R100 |
| src/renderer/app/release/ReleaseNotes.ts | apps/web/app/release/ReleaseNotes.ts | R100 |
| src/renderer/app/release/UpdateManager.ts | apps/web/app/release/UpdateManager.ts | R100 |
| src/renderer/app/starter/StarterScreen.ts | apps/web/app/starter/StarterScreen.ts | R100 |
| src/renderer/app/starter/main.ts | apps/web/app/starter/main.ts | R100 |
| src/renderer/app/theme/AppearanceManager.ts | apps/web/app/theme/AppearanceManager.ts | R100 |
| src/renderer/app/theme/CssSnippetManager.ts | apps/web/app/theme/CssSnippetManager.ts | R100 |
| src/renderer/app/theme/CustomCss.ts | apps/web/app/theme/CustomCss.ts | R100 |
| src/renderer/app/theme/ThemeManager.ts | apps/web/app/theme/ThemeManager.ts | R100 |
| src/renderer/app/theme/obsidian-structure.css | apps/web/app/theme/obsidian-structure.css | R100 |
| src/renderer/app/theme/reconstruction/README.md | apps/web/app/theme/reconstruction/README.md | R100 |
| src/renderer/app/theme/reconstruction/icons.css | apps/web/app/theme/reconstruction/icons.css | R100 |
| src/renderer/app/theme/reconstruction/index.css | apps/web/app/theme/reconstruction/index.css | R100 |
| src/renderer/app/theme/reconstruction/runtime.css | apps/web/app/theme/reconstruction/runtime.css | R100 |
| src/renderer/bootstrap.ts | apps/web/bootstrap.ts | R100 |
| src/renderer/builtin/AppearanceModals.ts | apps/web/builtin/AppearanceModals.ts | R100 |
| src/renderer/builtin/AppearanceSettingTab.ts | apps/web/builtin/AppearanceSettingTab.ts | R100 |
| src/renderer/builtin/AudioRecorder.ts | apps/web/builtin/AudioRecorder.ts | R100 |
| src/renderer/builtin/BacklinksView.ts | apps/web/builtin/BacklinksView.ts | R100 |
| src/renderer/builtin/Bookmarks.ts | apps/web/builtin/Bookmarks.ts | R100 |
| src/renderer/builtin/BuiltinViews.ts | apps/web/builtin/BuiltinViews.ts | R100 |
| src/renderer/builtin/CommunityPluginMarketplaceModal.ts | apps/web/builtin/CommunityPluginMarketplaceModal.ts | R100 |
| src/renderer/builtin/CommunityPluginTrustModal.ts | apps/web/builtin/CommunityPluginTrustModal.ts | R100 |
| src/renderer/builtin/CommunityPluginsSettingTab.ts | apps/web/builtin/CommunityPluginsSettingTab.ts | R100 |
| src/renderer/builtin/CorePlugins.ts | apps/web/builtin/CorePlugins.ts | R100 |
| src/renderer/builtin/CorePluginsSettingTab.ts | apps/web/builtin/CorePluginsSettingTab.ts | R100 |
| src/renderer/builtin/DailyNotes.ts | apps/web/builtin/DailyNotes.ts | R100 |
| src/renderer/builtin/DeveloperConsoleView.ts | apps/web/builtin/DeveloperConsoleView.ts | R100 |
| src/renderer/builtin/EditorStatus.ts | apps/web/builtin/EditorStatus.ts | R100 |
| src/renderer/builtin/FileExplorerView.ts | apps/web/builtin/FileExplorerView.ts | R100 |
| src/renderer/builtin/FilesSettingTab.ts | apps/web/builtin/FilesSettingTab.ts | R100 |
| src/renderer/builtin/HotkeysSettingTab.ts | apps/web/builtin/HotkeysSettingTab.ts | R100 |
| src/renderer/builtin/LinkSuggest.ts | apps/web/builtin/LinkSuggest.ts | R100 |
| src/renderer/builtin/MarkdownImporter.ts | apps/web/builtin/MarkdownImporter.ts | R100 |
| src/renderer/builtin/MobileSettingTab.ts | apps/web/builtin/MobileSettingTab.ts | R100 |
| src/renderer/builtin/NoteComposer.ts | apps/web/builtin/NoteComposer.ts | R100 |
| src/renderer/builtin/OutgoingLinksView.ts | apps/web/builtin/OutgoingLinksView.ts | R100 |
| src/renderer/builtin/OutlineView.ts | apps/web/builtin/OutlineView.ts | R100 |
| src/renderer/builtin/PagePreview.ts | apps/web/builtin/PagePreview.ts | R100 |
| src/renderer/builtin/QuickSwitcher.ts | apps/web/builtin/QuickSwitcher.ts | R100 |
| src/renderer/builtin/RandomNote.ts | apps/web/builtin/RandomNote.ts | R100 |
| src/renderer/builtin/SearchView.ts | apps/web/builtin/SearchView.ts | R100 |
| src/renderer/builtin/SettingsModal.ts | apps/web/builtin/SettingsModal.ts | R100 |
| src/renderer/builtin/SettingsRenderer.ts | apps/web/builtin/SettingsRenderer.ts | R100 |
| src/renderer/builtin/SettingsView.ts | apps/web/builtin/SettingsView.ts | R100 |
| src/renderer/builtin/SlashCommand.ts | apps/web/builtin/SlashCommand.ts | R100 |
| src/renderer/builtin/Slides.ts | apps/web/builtin/Slides.ts | R100 |
| src/renderer/builtin/TagPaneView.ts | apps/web/builtin/TagPaneView.ts | R100 |
| src/renderer/builtin/TagSuggest.ts | apps/web/builtin/TagSuggest.ts | R100 |
| src/renderer/builtin/Templates.ts | apps/web/builtin/Templates.ts | R100 |
| src/renderer/builtin/WordCount.ts | apps/web/builtin/WordCount.ts | R100 |
| src/renderer/builtin/Workspaces.ts | apps/web/builtin/Workspaces.ts | R100 |
| src/renderer/builtin/ZkPrefixer.ts | apps/web/builtin/ZkPrefixer.ts | R100 |
| src/renderer/builtin/canvas/Canvas.ts | apps/web/builtin/canvas/Canvas.ts | R100 |
| src/renderer/builtin/canvas/CanvasData.ts | apps/web/builtin/canvas/CanvasData.ts | R100 |
| src/renderer/builtin/canvas/CanvasEdge.ts | apps/web/builtin/canvas/CanvasEdge.ts | R100 |
| src/renderer/builtin/canvas/CanvasNode.ts | apps/web/builtin/canvas/CanvasNode.ts | R100 |
| src/renderer/builtin/canvas/CanvasView.ts | apps/web/builtin/canvas/CanvasView.ts | R100 |
| src/renderer/builtin/file-recovery/FileRecovery.ts | apps/web/builtin/file-recovery/FileRecovery.ts | R100 |
| src/renderer/builtin/file-recovery/FileRecoveryPlugin.ts | apps/web/builtin/file-recovery/FileRecoveryPlugin.ts | R100 |
| src/renderer/builtin/file-recovery/RevisionHistory.ts | apps/web/builtin/file-recovery/RevisionHistory.ts | R100 |
| src/renderer/builtin/git/BranchSwitchModal.ts | apps/web/builtin/git/BranchSwitchModal.ts | R100 |
| src/renderer/builtin/git/GitAvatar.ts | apps/web/builtin/git/GitAvatar.ts | R100 |
| src/renderer/builtin/git/GitChangesView.ts | apps/web/builtin/git/GitChangesView.ts | R100 |
| src/renderer/builtin/git/GitHistoryView.ts | apps/web/builtin/git/GitHistoryView.ts | R100 |
| src/renderer/builtin/git/GitLogView.ts | apps/web/builtin/git/GitLogView.ts | R100 |
| src/renderer/builtin/git/GitPlugin.ts | apps/web/builtin/git/GitPlugin.ts | R100 |
| src/renderer/builtin/git/GitService.ts | apps/web/builtin/git/GitService.ts | R100 |
| src/renderer/builtin/git/relativeDate.ts | apps/web/builtin/git/relativeDate.ts | R100 |
| src/renderer/builtin/git/review/GitNavView.ts | apps/web/builtin/git/review/GitNavView.ts | R100 |
| src/renderer/builtin/git/review/GitReviewView.ts | apps/web/builtin/git/review/GitReviewView.ts | R100 |
| src/renderer/builtin/git/review/ReviewSurface.ts | apps/web/builtin/git/review/ReviewSurface.ts | R100 |
| src/renderer/builtin/git/review/reviewModel.ts | apps/web/builtin/git/review/reviewModel.ts | R100 |
| src/renderer/builtin/git/review/reviewNavModel.ts | apps/web/builtin/git/review/reviewNavModel.ts | R100 |
| src/renderer/builtin/git/reviewSession.ts | apps/web/builtin/git/reviewSession.ts | R100 |
| src/renderer/builtin/github/CreateIssueModal.ts | apps/web/builtin/github/CreateIssueModal.ts | R100 |
| src/renderer/builtin/github/GitCommitView.ts | apps/web/builtin/github/GitCommitView.ts | R100 |
| src/renderer/builtin/github/GitHubClient.ts | apps/web/builtin/github/GitHubClient.ts | R100 |
| src/renderer/builtin/github/GitHubDetailView.ts | apps/web/builtin/github/GitHubDetailView.ts | R100 |
| src/renderer/builtin/github/GitHubFilterSuggest.ts | apps/web/builtin/github/GitHubFilterSuggest.ts | R100 |
| src/renderer/builtin/github/GitHubGraphQL.ts | apps/web/builtin/github/GitHubGraphQL.ts | R100 |
| src/renderer/builtin/github/GitHubListView.ts | apps/web/builtin/github/GitHubListView.ts | R100 |
| src/renderer/builtin/github/GitHubNavView.ts | apps/web/builtin/github/GitHubNavView.ts | R100 |
| src/renderer/builtin/github/GitHubPlugin.ts | apps/web/builtin/github/GitHubPlugin.ts | R100 |
| src/renderer/builtin/github/GitHubProfileView.ts | apps/web/builtin/github/GitHubProfileView.ts | R100 |
| src/renderer/builtin/github/GitHubRepoView.ts | apps/web/builtin/github/GitHubRepoView.ts | R100 |
| src/renderer/builtin/github/GitHubSearchBar.ts | apps/web/builtin/github/GitHubSearchBar.ts | R100 |
| src/renderer/builtin/github/GitHubService.ts | apps/web/builtin/github/GitHubService.ts | R100 |
| src/renderer/builtin/github/GitPrViews.ts | apps/web/builtin/github/GitPrViews.ts | R100 |
| src/renderer/builtin/github/open.ts | apps/web/builtin/github/open.ts | R100 |
| src/renderer/builtin/github/patchUtils.ts | apps/web/builtin/github/patchUtils.ts | R100 |
| src/renderer/builtin/github/prefs.ts | apps/web/builtin/github/prefs.ts | R100 |
| src/renderer/builtin/github/resolveRepository.ts | apps/web/builtin/github/resolveRepository.ts | R100 |
| src/renderer/builtin/github/reviewDock.ts | apps/web/builtin/github/reviewDock.ts | R100 |
| src/renderer/builtin/github/session.ts | apps/web/builtin/github/session.ts | R100 |
| src/renderer/builtin/github/signin.ts | apps/web/builtin/github/signin.ts | R100 |
| src/renderer/builtin/github/types.ts | apps/web/builtin/github/types.ts | R100 |
| src/renderer/builtin/github/widgets.ts | apps/web/builtin/github/widgets.ts | R100 |
| src/renderer/builtin/graph/GraphControls.ts | apps/web/builtin/graph/GraphControls.ts | R100 |
| src/renderer/builtin/graph/GraphDataEngine.ts | apps/web/builtin/graph/GraphDataEngine.ts | R100 |
| src/renderer/builtin/graph/GraphOptions.ts | apps/web/builtin/graph/GraphOptions.ts | R100 |
| src/renderer/builtin/graph/GraphPlugin.ts | apps/web/builtin/graph/GraphPlugin.ts | R100 |
| src/renderer/builtin/graph/GraphRenderer.ts | apps/web/builtin/graph/GraphRenderer.ts | R100 |
| src/renderer/builtin/graph/GraphSearchQuery.ts | apps/web/builtin/graph/GraphSearchQuery.ts | R100 |
| src/renderer/builtin/graph/GraphStyles.ts | apps/web/builtin/graph/GraphStyles.ts | R100 |
| src/renderer/builtin/graph/GraphView.ts | apps/web/builtin/graph/GraphView.ts | R100 |
| src/renderer/builtin/graph/GraphViewPlugin.ts | apps/web/builtin/graph/GraphViewPlugin.ts | R100 |
| src/renderer/builtin/terminal/GhosttyTerminalRenderer.ts | apps/web/builtin/terminal/GhosttyTerminalRenderer.ts | R100 |
| src/renderer/builtin/terminal/TerminalAdapter.ts | apps/web/builtin/terminal/TerminalAdapter.ts | R100 |
| src/renderer/builtin/terminal/TerminalPlugin.ts | apps/web/builtin/terminal/TerminalPlugin.ts | R100 |
| src/renderer/builtin/terminal/TerminalService.ts | apps/web/builtin/terminal/TerminalService.ts | R100 |
| src/renderer/builtin/terminal/TerminalView.ts | apps/web/builtin/terminal/TerminalView.ts | R100 |
| src/renderer/builtin/theme-market/ThemeInstaller.ts | apps/web/builtin/theme-market/ThemeInstaller.ts | R100 |
| src/renderer/builtin/theme-market/ThemeManifest.ts | apps/web/builtin/theme-market/ThemeManifest.ts | R100 |
| src/renderer/builtin/theme-market/ThemeManifestValidator.ts | apps/web/builtin/theme-market/ThemeManifestValidator.ts | R100 |
| src/renderer/builtin/theme-market/ThemeMarketplace.ts | apps/web/builtin/theme-market/ThemeMarketplace.ts | R100 |
| src/renderer/builtin/theme-market/ThemeMarketplaceModal.ts | apps/web/builtin/theme-market/ThemeMarketplaceModal.ts | R100 |
| src/renderer/builtin/webviewer/BrowserSessionBridge.ts | apps/web/builtin/webviewer/BrowserSessionBridge.ts | R100 |
| src/renderer/builtin/webviewer/WebContentsBridge.ts | apps/web/builtin/webviewer/WebContentsBridge.ts | R100 |
| src/renderer/builtin/webviewer/WebViewerAddressSuggest.ts | apps/web/builtin/webviewer/WebViewerAddressSuggest.ts | R100 |
| src/renderer/builtin/webviewer/WebViewerElementAdapter.ts | apps/web/builtin/webviewer/WebViewerElementAdapter.ts | R100 |
| src/renderer/builtin/webviewer/WebViewerPlugin.ts | apps/web/builtin/webviewer/WebViewerPlugin.ts | R100 |
| src/renderer/builtin/webviewer/WebViewerReader.ts | apps/web/builtin/webviewer/WebViewerReader.ts | R100 |
| src/renderer/builtin/webviewer/WebViewerService.ts | apps/web/builtin/webviewer/WebViewerService.ts | R100 |
| src/renderer/core/ApiUtils.ts | apps/web/core/ApiUtils.ts | R100 |
| src/renderer/core/Component.ts | apps/web/core/Component.ts | R100 |
| src/renderer/core/EventRefInternal.ts | apps/web/core/EventRefInternal.ts | R100 |
| src/renderer/core/Events.ts | apps/web/core/Events.ts | R100 |
| src/renderer/core/PropertyValue.ts | apps/web/core/PropertyValue.ts | R100 |
| src/renderer/core/Version.ts | apps/web/core/Version.ts | R100 |
| src/renderer/core/fuzzy.ts | apps/web/core/fuzzy.ts | R100 |
| src/renderer/dom/ActiveDocument.ts | apps/web/dom/ActiveDocument.ts | R100 |
| src/renderer/dom/Clipboard.ts | apps/web/dom/Clipboard.ts | R100 |
| src/renderer/dom/dom.ts | apps/web/dom/dom.ts | R100 |
| src/renderer/editor/CodeMirrorFacet.ts | apps/web/editor/CodeMirrorFacet.ts | R100 |
| src/renderer/editor/Decoration.ts | apps/web/editor/Decoration.ts | R100 |
| src/renderer/editor/Editor.ts | apps/web/editor/Editor.ts | R100 |
| src/renderer/editor/EditorExtension.ts | apps/web/editor/EditorExtension.ts | R100 |
| src/renderer/editor/EditorStateField.ts | apps/web/editor/EditorStateField.ts | R100 |
| src/renderer/editor/EditorView.ts | apps/web/editor/EditorView.ts | R100 |
| src/renderer/editor/ViewPlugin.ts | apps/web/editor/ViewPlugin.ts | R100 |
| src/renderer/index.html | apps/web/index.html | R100 |
| src/renderer/index.ts | apps/web/index.ts | R100 |
| src/renderer/main.ts | apps/web/main.ts | R100 |
| src/renderer/markdown/FoldManager.ts | apps/web/markdown/FoldManager.ts | R100 |
| src/renderer/markdown/HtmlDropPreprocessor.ts | apps/web/markdown/HtmlDropPreprocessor.ts | R100 |
| src/renderer/markdown/HtmlToMarkdown.ts | apps/web/markdown/HtmlToMarkdown.ts | R100 |
| src/renderer/markdown/MarkdownCodeBlockRegistry.ts | apps/web/markdown/MarkdownCodeBlockRegistry.ts | R100 |
| src/renderer/markdown/MarkdownDefaultProcessors.ts | apps/web/markdown/MarkdownDefaultProcessors.ts | R100 |
| src/renderer/markdown/MarkdownInlineRenderer.ts | apps/web/markdown/MarkdownInlineRenderer.ts | R100 |
| src/renderer/markdown/MarkdownLinkResolver.ts | apps/web/markdown/MarkdownLinkResolver.ts | R100 |
| src/renderer/markdown/MarkdownPostProcessorRegistry.ts | apps/web/markdown/MarkdownPostProcessorRegistry.ts | R100 |
| src/renderer/markdown/MarkdownPreviewRenderer.ts | apps/web/markdown/MarkdownPreviewRenderer.ts | R100 |
| src/renderer/markdown/MarkdownPreviewSection.ts | apps/web/markdown/MarkdownPreviewSection.ts | R100 |
| src/renderer/markdown/MarkdownPreviewView.ts | apps/web/markdown/MarkdownPreviewView.ts | R100 |
| src/renderer/markdown/MarkdownRenderChild.ts | apps/web/markdown/MarkdownRenderChild.ts | R100 |
| src/renderer/markdown/MarkdownRenderer.ts | apps/web/markdown/MarkdownRenderer.ts | R100 |
| src/renderer/markdown/MarkdownTaskList.ts | apps/web/markdown/MarkdownTaskList.ts | R100 |
| src/renderer/markdown/RenderContext.ts | apps/web/markdown/RenderContext.ts | R100 |
| src/renderer/metadata/BlockCache.ts | apps/web/metadata/BlockCache.ts | R100 |
| src/renderer/metadata/Frontmatter.ts | apps/web/metadata/Frontmatter.ts | R100 |
| src/renderer/metadata/FrontmatterTags.ts | apps/web/metadata/FrontmatterTags.ts | R100 |
| src/renderer/metadata/LinkGraph.ts | apps/web/metadata/LinkGraph.ts | R100 |
| src/renderer/metadata/LinkSuggestionManager.ts | apps/web/metadata/LinkSuggestionManager.ts | R100 |
| src/renderer/metadata/Linkpath.ts | apps/web/metadata/Linkpath.ts | R100 |
| src/renderer/metadata/MetadataCache.ts | apps/web/metadata/MetadataCache.ts | R100 |
| src/renderer/metadata/MetadataCacheStore.ts | apps/web/metadata/MetadataCacheStore.ts | R100 |
| src/renderer/metadata/TagIndex.ts | apps/web/metadata/TagIndex.ts | R100 |
| src/renderer/metadata/TagSuggestion.ts | apps/web/metadata/TagSuggestion.ts | R100 |
| src/renderer/platform/Platform.ts | apps/web/platform/Platform.ts | R100 |
| src/renderer/platform/desktop/AutoUpdateService.ts | apps/web/platform/desktop/AutoUpdateService.ts | R100 |
| src/renderer/platform/desktop/DesktopMain.ts | apps/web/platform/desktop/DesktopMain.ts | R100 |
| src/renderer/platform/desktop/DesktopMenu.ts | apps/web/platform/desktop/DesktopMenu.ts | R100 |
| src/renderer/platform/desktop/DesktopProtocolHandler.ts | apps/web/platform/desktop/DesktopProtocolHandler.ts | R100 |
| src/renderer/platform/desktop/SystemMenuBuilder.ts | apps/web/platform/desktop/SystemMenuBuilder.ts | R100 |
| src/renderer/platform/mobile/MobileBackButton.ts | apps/web/platform/mobile/MobileBackButton.ts | R100 |
| src/renderer/platform/mobile/MobileDrawer.ts | apps/web/platform/mobile/MobileDrawer.ts | R100 |
| src/renderer/platform/mobile/MobileToolbar.ts | apps/web/platform/mobile/MobileToolbar.ts | R100 |
| src/renderer/platform/mobile/MobileWorkspace.ts | apps/web/platform/mobile/MobileWorkspace.ts | R100 |
| src/renderer/platform/native/FileDialogService.ts | apps/web/platform/native/FileDialogService.ts | R100 |
| src/renderer/platform/native/NativeBridge.ts | apps/web/platform/native/NativeBridge.ts | R100 |
| src/renderer/platform/native/PreloadApi.ts | apps/web/platform/native/PreloadApi.ts | R100 |
| src/renderer/platform/native/WindowFrameController.ts | apps/web/platform/native/WindowFrameController.ts | R100 |
| src/renderer/platform/shell/ShellIntegration.ts | apps/web/platform/shell/ShellIntegration.ts | R100 |
| src/renderer/platform/window/PopoutManager.ts | apps/web/platform/window/PopoutManager.ts | R100 |
| src/renderer/platform/window/WindowManager.ts | apps/web/platform/window/WindowManager.ts | R100 |
| src/renderer/plugin/CommunityPluginRegistry.ts | apps/web/plugin/CommunityPluginRegistry.ts | R100 |
| src/renderer/plugin/CorePluginManager.ts | apps/web/plugin/CorePluginManager.ts | R100 |
| src/renderer/plugin/InternalPlugin.ts | apps/web/plugin/InternalPlugin.ts | R100 |
| src/renderer/plugin/InternalPluginWrapper.ts | apps/web/plugin/InternalPluginWrapper.ts | R100 |
| src/renderer/plugin/Plugin.ts | apps/web/plugin/Plugin.ts | R100 |
| src/renderer/plugin/PluginContext.ts | apps/web/plugin/PluginContext.ts | R100 |
| src/renderer/plugin/PluginDevTools.ts | apps/web/plugin/PluginDevTools.ts | R100 |
| src/renderer/plugin/PluginInstaller.ts | apps/web/plugin/PluginInstaller.ts | R100 |
| src/renderer/plugin/PluginLoader.ts | apps/web/plugin/PluginLoader.ts | R100 |
| src/renderer/plugin/PluginManager.ts | apps/web/plugin/PluginManager.ts | R100 |
| src/renderer/plugin/PluginManifest.ts | apps/web/plugin/PluginManifest.ts | R100 |
| src/renderer/plugin/PluginManifestValidator.ts | apps/web/plugin/PluginManifestValidator.ts | R100 |
| src/renderer/plugin/PluginMarketplace.ts | apps/web/plugin/PluginMarketplace.ts | R100 |
| src/renderer/plugin/PluginRequire.ts | apps/web/plugin/PluginRequire.ts | R100 |
| src/renderer/plugin/PluginSecurity.ts | apps/web/plugin/PluginSecurity.ts | R100 |
| src/renderer/plugin/PluginSettingTab.ts | apps/web/plugin/PluginSettingTab.ts | R100 |
| src/renderer/plugin/PluginSource.ts | apps/web/plugin/PluginSource.ts | R100 |
| src/renderer/plugin/packaging/PluginPackager.ts | apps/web/plugin/packaging/PluginPackager.ts | R100 |
| src/renderer/plugin/packaging/ThemePackager.ts | apps/web/plugin/packaging/ThemePackager.ts | R100 |
| src/renderer/public/lib/readability.js | apps/web/public/lib/readability.js | R100 |
| src/renderer/search/SearchEngine.ts | apps/web/search/SearchEngine.ts | R100 |
| src/renderer/search/SearchHelpers.ts | apps/web/search/SearchHelpers.ts | R100 |
| src/renderer/starter.html | apps/web/starter.html | R100 |
| src/renderer/storage/AppConfig.ts | apps/web/storage/AppConfig.ts | R100 |
| src/renderer/storage/FileSystemJsonStoreAdapter.ts | apps/web/storage/FileSystemJsonStoreAdapter.ts | R100 |
| src/renderer/storage/JsonStore.ts | apps/web/storage/JsonStore.ts | R100 |
| src/renderer/storage/PluginDataStore.ts | apps/web/storage/PluginDataStore.ts | R100 |
| src/renderer/storage/SecretStorage.ts | apps/web/storage/SecretStorage.ts | R100 |
| src/renderer/styles/base/platform-mobile.css | apps/web/styles/base/platform-mobile.css | R100 |
| src/renderer/styles/base/reset.css | apps/web/styles/base/reset.css | R100 |
| src/renderer/styles/base/rtl.css | apps/web/styles/base/rtl.css | R100 |
| src/renderer/styles/components/button-card.css | apps/web/styles/components/button-card.css | R100 |
| src/renderer/styles/components/checkbox.css | apps/web/styles/components/checkbox.css | R100 |
| src/renderer/styles/components/clickable-icon.css | apps/web/styles/components/clickable-icon.css | R100 |
| src/renderer/styles/components/collapse-indicator.css | apps/web/styles/components/collapse-indicator.css | R100 |
| src/renderer/styles/components/document-search.css | apps/web/styles/components/document-search.css | R100 |
| src/renderer/styles/components/dropdown.css | apps/web/styles/components/dropdown.css | R100 |
| src/renderer/styles/components/menu.css | apps/web/styles/components/menu.css | R100 |
| src/renderer/styles/components/modal-dialog.css | apps/web/styles/components/modal-dialog.css | R100 |
| src/renderer/styles/components/notice.css | apps/web/styles/components/notice.css | R100 |
| src/renderer/styles/components/popover-prompt-scrollbar.css | apps/web/styles/components/popover-prompt-scrollbar.css | R100 |
| src/renderer/styles/components/suggestion-tabs.css | apps/web/styles/components/suggestion-tabs.css | R100 |
| src/renderer/styles/components/text-input.css | apps/web/styles/components/text-input.css | R100 |
| src/renderer/styles/components/tooltip.css | apps/web/styles/components/tooltip.css | R100 |
| src/renderer/styles/components/tree-item.css | apps/web/styles/components/tree-item.css | R100 |
| src/renderer/styles/editor/callout.css | apps/web/styles/editor/callout.css | R100 |
| src/renderer/styles/editor/cm-cursor.css | apps/web/styles/editor/cm-cursor.css | R100 |
| src/renderer/styles/editor/cm6.css | apps/web/styles/editor/cm6.css | R100 |
| src/renderer/styles/editor/code.css | apps/web/styles/editor/code.css | R100 |
| src/renderer/styles/editor/embeds.css | apps/web/styles/editor/embeds.css | R100 |
| src/renderer/styles/editor/footnotes.css | apps/web/styles/editor/footnotes.css | R100 |
| src/renderer/styles/editor/headings-hr.css | apps/web/styles/editor/headings-hr.css | R100 |
| src/renderer/styles/editor/inline-title.css | apps/web/styles/editor/inline-title.css | R100 |
| src/renderer/styles/editor/links-tasks.css | apps/web/styles/editor/links-tasks.css | R100 |
| src/renderer/styles/editor/lists.css | apps/web/styles/editor/lists.css | R100 |
| src/renderer/styles/editor/properties-metadata.css | apps/web/styles/editor/properties-metadata.css | R100 |
| src/renderer/styles/editor/reading-view.css | apps/web/styles/editor/reading-view.css | R100 |
| src/renderer/styles/editor/rendered-content.css | apps/web/styles/editor/rendered-content.css | R100 |
| src/renderer/styles/editor/source-view.css | apps/web/styles/editor/source-view.css | R100 |
| src/renderer/styles/editor/syntax-highlight.css | apps/web/styles/editor/syntax-highlight.css | R100 |
| src/renderer/styles/editor/tables.css | apps/web/styles/editor/tables.css | R100 |
| src/renderer/styles/features/bookmarks-nav.css | apps/web/styles/features/bookmarks-nav.css | R100 |
| src/renderer/styles/features/community-plugins.css | apps/web/styles/features/community-plugins.css | R100 |
| src/renderer/styles/features/file-recovery.css | apps/web/styles/features/file-recovery.css | R100 |
| src/renderer/styles/features/graph-outline.css | apps/web/styles/features/graph-outline.css | R100 |
| src/renderer/styles/features/pdf-view.css | apps/web/styles/features/pdf-view.css | R100 |
| src/renderer/styles/features/search.css | apps/web/styles/features/search.css | R100 |
| src/renderer/styles/features/settings-item.css | apps/web/styles/features/settings-item.css | R100 |
| src/renderer/styles/features/tag-pane-canvas.css | apps/web/styles/features/tag-pane-canvas.css | R100 |
| src/renderer/styles/features/webviewer-workspaces.css | apps/web/styles/features/webviewer-workspaces.css | R100 |
| src/renderer/styles/index.css | apps/web/styles/index.css | R100 |
| src/renderer/styles/product/code-view.css | apps/web/styles/product/code-view.css | R100 |
| src/renderer/styles/product/diff.css | apps/web/styles/product/diff.css | R100 |
| src/renderer/styles/product/explorer.css | apps/web/styles/product/explorer.css | R100 |
| src/renderer/styles/product/git-changes.css | apps/web/styles/product/git-changes.css | R100 |
| src/renderer/styles/product/git-prs.css | apps/web/styles/product/git-prs.css | R100 |
| src/renderer/styles/product/git-review.css | apps/web/styles/product/git-review.css | R100 |
| src/renderer/styles/product/github-nav.css | apps/web/styles/product/github-nav.css | R100 |
| src/renderer/styles/product/github-profile.css | apps/web/styles/product/github-profile.css | R100 |
| src/renderer/styles/product/outline.css | apps/web/styles/product/outline.css | R100 |
| src/renderer/styles/product/reading-view.css | apps/web/styles/product/reading-view.css | R100 |
| src/renderer/styles/product/starter.css | apps/web/styles/product/starter.css | R100 |
| src/renderer/styles/product/terminal.css | apps/web/styles/product/terminal.css | R100 |
| src/renderer/styles/reveal/black.css | apps/web/styles/reveal/black.css | R100 |
| src/renderer/styles/reveal/reveal.css | apps/web/styles/reveal/reveal.css | R100 |
| src/renderer/styles/reveal/white.css | apps/web/styles/reveal/white.css | R100 |
| src/renderer/styles/tokens/tokens.css | apps/web/styles/tokens/tokens.css | R100 |
| src/renderer/styles/vendor/pdfjs-messagebar-dialog.css | apps/web/styles/vendor/pdfjs-messagebar-dialog.css | R100 |
| src/renderer/styles/vendor/pdfjs-viewer.css | apps/web/styles/vendor/pdfjs-viewer.css | R100 |
| src/renderer/styles/workspace/app-container.css | apps/web/styles/workspace/app-container.css | R100 |
| src/renderer/styles/workspace/empty-state.css | apps/web/styles/workspace/empty-state.css | R100 |
| src/renderer/styles/workspace/ribbon-sidedock.css | apps/web/styles/workspace/ribbon-sidedock.css | R100 |
| src/renderer/styles/workspace/splits-tabs.css | apps/web/styles/workspace/splits-tabs.css | R100 |
| src/renderer/styles/workspace/starter-splash.css | apps/web/styles/workspace/starter-splash.css | R100 |
| src/renderer/styles/workspace/status-bar.css | apps/web/styles/workspace/status-bar.css | R100 |
| src/renderer/styles/workspace/titlebar-frameless.css | apps/web/styles/workspace/titlebar-frameless.css | R100 |
| src/renderer/styles/workspace/titlebar-vault-profile.css | apps/web/styles/workspace/titlebar-vault-profile.css | R100 |
| src/renderer/styles/workspace/view-header.css | apps/web/styles/workspace/view-header.css | R100 |
| src/renderer/tsconfig.json | apps/web/tsconfig.json | R100 |
| src/renderer/ui/ActiveCloseableRegistry.ts | apps/web/ui/ActiveCloseableRegistry.ts | R100 |
| src/renderer/ui/Collapse.ts | apps/web/ui/Collapse.ts | R100 |
| src/renderer/ui/Composer.ts | apps/web/ui/Composer.ts | R100 |
| src/renderer/ui/FileTypeIcon.ts | apps/web/ui/FileTypeIcon.ts | R100 |
| src/renderer/ui/Icon.ts | apps/web/ui/Icon.ts | R100 |
| src/renderer/ui/Menu.ts | apps/web/ui/Menu.ts | R100 |
| src/renderer/ui/Modal.ts | apps/web/ui/Modal.ts | R100 |
| src/renderer/ui/Notice.ts | apps/web/ui/Notice.ts | R100 |
| src/renderer/ui/Popover.ts | apps/web/ui/Popover.ts | R100 |
| src/renderer/ui/ProgressBar.ts | apps/web/ui/ProgressBar.ts | R100 |
| src/renderer/ui/Setting.ts | apps/web/ui/Setting.ts | R100 |
| src/renderer/ui/TreeItem.ts | apps/web/ui/TreeItem.ts | R100 |
| src/renderer/ui/drag/DragManager.ts | apps/web/ui/drag/DragManager.ts | R100 |
| src/renderer/ui/highlightWorkers.ts | apps/web/ui/highlightWorkers.ts | R100 |
| src/renderer/ui/hover/HoverPreviewController.ts | apps/web/ui/hover/HoverPreviewController.ts | R100 |
| src/renderer/ui/suggest/AbstractInputSuggest.ts | apps/web/ui/suggest/AbstractInputSuggest.ts | R100 |
| src/renderer/ui/suggest/ComboboxSuggest.ts | apps/web/ui/suggest/ComboboxSuggest.ts | R100 |
| src/renderer/ui/suggest/EditorSuggest.ts | apps/web/ui/suggest/EditorSuggest.ts | R100 |
| src/renderer/ui/suggest/FileInputSuggest.ts | apps/web/ui/suggest/FileInputSuggest.ts | R100 |
| src/renderer/ui/suggest/SuggestModal.ts | apps/web/ui/suggest/SuggestModal.ts | R100 |
| src/renderer/vault/DataAdapter.ts | apps/web/vault/DataAdapter.ts | R100 |
| src/renderer/vault/FileNameValidation.ts | apps/web/vault/FileNameValidation.ts | R100 |
| src/renderer/vault/FileSystemAdapter.ts | apps/web/vault/FileSystemAdapter.ts | R100 |
| src/renderer/vault/FileWatcher.ts | apps/web/vault/FileWatcher.ts | R100 |
| src/renderer/vault/TAbstractFile.ts | apps/web/vault/TAbstractFile.ts | R100 |
| src/renderer/vault/Vault.ts | apps/web/vault/Vault.ts | R100 |
| src/renderer/vault/VaultManager.ts | apps/web/vault/VaultManager.ts | R100 |
| src/renderer/views/CodeFileView.ts | apps/web/views/CodeFileView.ts | R100 |
| src/renderer/views/CodeSymbols.ts | apps/web/views/CodeSymbols.ts | R100 |
| src/renderer/views/DeferredView.ts | apps/web/views/DeferredView.ts | R100 |
| src/renderer/views/DiffView.ts | apps/web/views/DiffView.ts | R100 |
| src/renderer/views/EditableFileView.ts | apps/web/views/EditableFileView.ts | R100 |
| src/renderer/views/EmptyView.ts | apps/web/views/EmptyView.ts | R100 |
| src/renderer/views/FileView.ts | apps/web/views/FileView.ts | R100 |
| src/renderer/views/ItemView.ts | apps/web/views/ItemView.ts | R100 |
| src/renderer/views/MarkdownView.ts | apps/web/views/MarkdownView.ts | R100 |
| src/renderer/views/MediaViews.ts | apps/web/views/MediaViews.ts | R100 |
| src/renderer/views/StreamMarkdownRenderer.ts | apps/web/views/StreamMarkdownRenderer.ts | R100 |
| src/renderer/views/StreamScroller.ts | apps/web/views/StreamScroller.ts | R100 |
| src/renderer/views/StreamView.ts | apps/web/views/StreamView.ts | R100 |
| src/renderer/views/TextFileView.ts | apps/web/views/TextFileView.ts | R100 |
| src/renderer/views/Typewriter.ts | apps/web/views/Typewriter.ts | R100 |
| src/renderer/views/UnknownView.ts | apps/web/views/UnknownView.ts | R100 |
| src/renderer/views/View.ts | apps/web/views/View.ts | R100 |
| src/renderer/views/properties/AliasPropertyWidget.ts | apps/web/views/properties/AliasPropertyWidget.ts | R100 |
| src/renderer/views/properties/EditablePropertyPill.ts | apps/web/views/properties/EditablePropertyPill.ts | R100 |
| src/renderer/views/properties/MetadataTypeManager.ts | apps/web/views/properties/MetadataTypeManager.ts | R100 |
| src/renderer/views/properties/MultiValuePropertyWidget.ts | apps/web/views/properties/MultiValuePropertyWidget.ts | R100 |
| src/renderer/views/properties/PropertyLinkRenderer.ts | apps/web/views/properties/PropertyLinkRenderer.ts | R100 |
| src/renderer/views/properties/PropertyLinkSuggest.ts | apps/web/views/properties/PropertyLinkSuggest.ts | R100 |
| src/renderer/views/properties/PropertyRegistry.ts | apps/web/views/properties/PropertyRegistry.ts | R100 |
| src/renderer/views/properties/PropertyStore.ts | apps/web/views/properties/PropertyStore.ts | R100 |
| src/renderer/views/properties/PropertyTypeMismatchModal.ts | apps/web/views/properties/PropertyTypeMismatchModal.ts | R100 |
| src/renderer/views/properties/PropertyTypes.ts | apps/web/views/properties/PropertyTypes.ts | R100 |
| src/renderer/views/properties/TagPropertyWidget.ts | apps/web/views/properties/TagPropertyWidget.ts | R100 |
| src/renderer/views/workspace/RecentFileTracker.ts | apps/web/views/workspace/RecentFileTracker.ts | R100 |
| src/renderer/views/workspace/ViewRegistry.ts | apps/web/views/workspace/ViewRegistry.ts | R100 |
| src/renderer/views/workspace/Workspace.ts | apps/web/views/workspace/Workspace.ts | R100 |
| src/renderer/views/workspace/WorkspaceContainer.ts | apps/web/views/workspace/WorkspaceContainer.ts | R100 |
| src/renderer/views/workspace/WorkspaceDragManager.ts | apps/web/views/workspace/WorkspaceDragManager.ts | R100 |
| src/renderer/views/workspace/WorkspaceFloating.ts | apps/web/views/workspace/WorkspaceFloating.ts | R100 |
| src/renderer/views/workspace/WorkspaceHover.ts | apps/web/views/workspace/WorkspaceHover.ts | R100 |
| src/renderer/views/workspace/WorkspaceItem.ts | apps/web/views/workspace/WorkspaceItem.ts | R100 |
| src/renderer/views/workspace/WorkspaceLayout.ts | apps/web/views/workspace/WorkspaceLayout.ts | R100 |
| src/renderer/views/workspace/WorkspaceLayoutPersistence.ts | apps/web/views/workspace/WorkspaceLayoutPersistence.ts | R100 |
| src/renderer/views/workspace/WorkspaceLayoutSerializer.ts | apps/web/views/workspace/WorkspaceLayoutSerializer.ts | R100 |
| src/renderer/views/workspace/WorkspaceLeaf.ts | apps/web/views/workspace/WorkspaceLeaf.ts | R100 |
| src/renderer/views/workspace/WorkspaceParent.ts | apps/web/views/workspace/WorkspaceParent.ts | R100 |
| src/renderer/views/workspace/WorkspaceRibbon.ts | apps/web/views/workspace/WorkspaceRibbon.ts | R100 |
| src/renderer/views/workspace/WorkspaceRoot.ts | apps/web/views/workspace/WorkspaceRoot.ts | R100 |
| src/renderer/views/workspace/WorkspaceSidedock.ts | apps/web/views/workspace/WorkspaceSidedock.ts | R100 |
| src/renderer/views/workspace/WorkspaceSplit.ts | apps/web/views/workspace/WorkspaceSplit.ts | R100 |
| src/renderer/views/workspace/WorkspaceTabs.ts | apps/web/views/workspace/WorkspaceTabs.ts | R100 |
| src/renderer/views/workspace/WorkspaceWindow.ts | apps/web/views/workspace/WorkspaceWindow.ts | R100 |
| src/renderer/vite.api.config.ts | apps/web/vite.api.config.ts | R100 |
| src/renderer/vite.config.ts | apps/web/vite.config.ts | R100 |
| src/shared/dataAdapter.ts | packages/shared/dataAdapter.ts | R100 |
| src/shared/gitApi.ts | packages/shared/gitApi.ts | R100 |
| src/shared/ipc.ts | packages/shared/ipc.ts | R100 |
| src/shared/kernelApi.ts | packages/shared/kernelApi.ts | R100 |
| src/shared/terminalApi.ts | packages/shared/terminalApi.ts | R100 |
| src/types/env.d.ts | packages/shared/types/env.d.ts | R100 |
| src/types/vite-env.d.ts | packages/shared/types/vite-env.d.ts | R100 |

## 2. 机械改写（import 路径 / 配置路径字符串，wiring 提交 a6c0897 + 30184fc）

### 2.1 跨包 import 改写（7 文件，@app/shared specifier）

| 文件                                         | 改写                        |
| -------------------------------------------- | --------------------------- |
| apps/desktop/main/git-bridge.ts              | ../shared/* → @app/shared/* |
| apps/desktop/main/terminal-bridge.ts         | ../shared/* → @app/shared/* |
| apps/desktop/main/ipc.ts                     | ../shared/* → @app/shared/* |
| apps/web/vault/DataAdapter.ts                | @shared/* → @app/shared/*   |
| apps/web/platform/Platform.ts                | @shared/* → @app/shared/*   |
| apps/web/builtin/git/GitService.ts           | @shared/* → @app/shared/*   |
| apps/web/builtin/terminal/TerminalAdapter.ts | @shared/* → @app/shared/*   |

### 2.2 tests 相对路径改写（11 文件，src/* → apps|packages/*）

- tests/package.json
- tests/web/app/theme/CssContract.test.ts
- tests/web/builtin/git/GitThemeContract.test.ts
- tests/web/builtin/github/GitHubProfileView.test.ts
- tests/web/builtin/github/GitHubSearchBar.test.ts
- tests/web/builtin/github/repoTree.test.ts
- tests/web/styles/FileTypeIconPalette.test.ts
- tests/web/styles/StyleSystem.test.ts
- tests/web/ui/Icon.test.ts
- tests/web/views/MarkdownViewApiParity.test.ts

### 2.3 清单与配置（路径/转发改写）

| 文件                                 | 改动                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| package.json                         | root 应用包 → 私有 orchestrator，脚本名不变、pnpm --filter 转发；依赖下发到车道 |
| pnpm-workspace.yaml                  | packages += apps/_, packages/_；tests 保留                                      |
| pnpm-lock.yaml                       | 随依赖下发重新生成                                                              |
| tsconfig.json                        | 别名 @web/@desktop/@preload/@app/web/@shared → 新车道；include 换车道           |
| tsconfig.tools.json                  | 同上                                                                            |
| vitest.config.ts                     | 别名指向 apps/web、apps/desktop/{main,preload}、packages/shared                 |
| apps/web/vite.config.ts              | @shared 别名 → @app/shared                                                      |
| apps/web/vite.api.config.ts          | 同上；api 产物落 apps/web/out/api（声明与 JS 同层）                             |
| apps/desktop/main/vite.config.ts     | @app/web 别名 → ../../web；outDir 修正到仓库 root out/desktop                   |
| apps/desktop/main/tsconfig.json      | paths 换新车道；include 去掉已迁目录                                            |
| tests/package.json                   | += @pierre/trees、font-list（原经 root 父链解析，pnpm 严格性下需自声明）        |
| tests/architecture.test.ts           | 墙 re-lane（src/* → 包车道；单包场景→monorepo 场景；新增 kernel-history 规则）  |
| tests/architecture-tree-item.test.ts | 路径常量 re-lane                                                                |

### 2.4 新增清单（无旧路径）

- apps/web/package.json（@app/web，产品包）
- apps/desktop/package.json（@app/desktop，壳）
- packages/shared/package.json（@app/shared，契约）
- packages/sdk/package.json（@app/sdk，空壳占位）

## 3. 内核并入（merge --allow-unrelated-histories，字节一致）

| 旧路径（attention-agent-form） | 新路径          | 备注                                               |
| ------------------------------ | --------------- | -------------------------------------------------- |
| cmd/                           | cmd/            | 含嵌套模块 cmd/tui                                 |
| internal/                      | internal/       |                                                    |
| extension/                     | extension/      |                                                    |
| specs/                         | specs/          | 内核自带 spec household，原样保留                  |
| go.mod / go.sum                | go.mod / go.sum | module path 本单不动                               |
| Makefile                       | （删除）        | 目标溶解进 mise tasks: kernel:build/test/tui/clean |
| README.md                      | docs/kernel.md  | 根 README 保留本仓版                               |
| .gitignore                     | .gitignore      | 并集（/bin/、Go 条目并入）                         |

## 4. 删除

| 路径                         | 原因                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| src/                         | 单包布局废止（446 文件全部迁出，见 §1）                        |
| Makefile                     | 任务注册表唯一化到 mise                                        |
| packages/shared/kernelApi.ts | KernelApi 端口删除（owner override 99a3a09，独立提交 49a1fb2） |

## 5. 静止 hash 结论

- §1 全部 446 个迁移文件 blob hash 与 main 完全一致（R100 定义即内容一致）
- §3 全部内核文件与 agent-form/main 完全一致（diff 为空）
- §2 机械改写文件为允许例外类（import 路径/配置路径字符串），逐文件列明
- §4 删除逐条列明
