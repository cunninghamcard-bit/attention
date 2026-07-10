export type ExtensionPointKind = "workspace" | "markdown" | "editor" | "appearance" | "knowledge" | "shell" | "menu" | "diagnostics";

export interface ExtensionPoint {
  id: string;
  kind: ExtensionPointKind;
  api: string;
  purpose: string;
  example?: string;
}

export const extensionPointCatalog: ExtensionPoint[] = [
  { id: "workspace.view", kind: "workspace", api: "plugin.registerView(type, factory)", purpose: "Add a custom panel/view to WorkspaceLeaf.", example: "examples/plugins/custom-view-plugin" },
  { id: "workspace.command", kind: "workspace", api: "plugin.addCommand(command)", purpose: "Expose actions through command palette and hotkeys." },
  { id: "workspace.ribbon", kind: "workspace", api: "plugin.addRibbonIcon(icon, title, callback)", purpose: "Add left ribbon shortcuts." },
  { id: "markdown.post", kind: "markdown", api: "plugin.registerMarkdownPostProcessor(fn)", purpose: "Modify rendered Markdown DOM." },
  { id: "markdown.code-block", kind: "markdown", api: "plugin.registerMarkdownCodeBlockProcessor(lang, fn)", purpose: "Render custom fenced code blocks." },
  { id: "editor.extension", kind: "editor", api: "plugin.registerEditorExtension(extension)", purpose: "Install CodeMirror-shaped editor behavior." },
  { id: "appearance.theme", kind: "appearance", api: "plugin.registerTheme(theme)", purpose: "Register CSS-variable theme metadata." },
  { id: "appearance.css", kind: "appearance", api: "plugin.registerCss(cssText)", purpose: "Inject plugin CSS with cleanup." },
  { id: "knowledge.properties", kind: "knowledge", api: "app.propertyRegistry.register(def)", purpose: "Add known property definitions for Bases/query." },
  { id: "menu.file", kind: "menu", api: "plugin.registerFileMenu(handler)", purpose: "Extend file context menus." },
  { id: "menu.editor", kind: "menu", api: "plugin.registerEditorMenu(handler)", purpose: "Extend editor context menus." },
  { id: "shell.protocol", kind: "shell", api: "plugin.registerObsidianProtocolHandler(action, handler)", purpose: "Handle arkloop:// style actions." },
  { id: "diagnostics.devtools", kind: "diagnostics", api: "app.devtools", purpose: "Inspect plugin/core/log/error state." },
];
