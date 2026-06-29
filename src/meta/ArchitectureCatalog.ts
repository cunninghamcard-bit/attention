export type ArchitectureLayerId =
  | "desktop-shell"
  | "app-shell"
  | "workspace"
  | "view-system"
  | "markdown-product"
  | "knowledge-system"
  | "plugin-system"
  | "appearance"
  | "persistence"
  | "distribution"
  | "diagnostics";

export interface ArchitectureModuleRef {
  path: string;
  role: string;
}

export interface ArchitectureLayer {
  id: ArchitectureLayerId;
  title: string;
  summary: string;
  modules: ArchitectureModuleRef[];
}

export const architectureCatalog: ArchitectureLayer[] = [
  {
    id: "desktop-shell",
    title: "Desktop shell",
    summary: "Electron/main/preload/native boundaries around the renderer app.",
    modules: [
      { path: "src/desktop", role: "Main-process-shaped services: windows, protocol, menu, auto update." },
      { path: "src/native", role: "Preload and native bridge facades." },
      { path: "src/shell", role: "Renderer-side aggregate for desktop services." },
    ],
  },
  {
    id: "app-shell",
    title: "App shell",
    summary: "Top-level service composition and startup sequence.",
    modules: [
      { path: "src/app/App.ts", role: "Composes all runtime services." },
      { path: "src/app/AppLifecycle.ts", role: "Coordinates load/save/unload." },
      { path: "src/app/AppCommands.ts", role: "Registers core app commands." },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    summary: "IDE-style layout tree and shell services.",
    modules: [
      { path: "src/workspace", role: "Split/tabs/leaf/window/floating layout system." },
      { path: "src/window", role: "Window and popout management." },
      { path: "src/mobile", role: "Mobile drawer/workspace shell." },
    ],
  },
  {
    id: "view-system",
    title: "View system",
    summary: "View lifecycle and registry for built-in and plugin panels.",
    modules: [
      { path: "src/views", role: "Base View, ItemView, FileView and MarkdownView." },
      { path: "src/builtin", role: "Built-in views registered through ViewRegistry." },
      { path: "src/workspace/ViewRegistry.ts", role: "Type-to-factory mapping for view creation." },
    ],
  },
  {
    id: "markdown-product",
    title: "Markdown product surface",
    summary: "Default core product: markdown editor, renderer and extension points.",
    modules: [
      { path: "src/markdown", role: "Renderer, block parser, inline renderer and processors." },
      { path: "src/editor", role: "CodeMirror-shaped editor primitives." },
      { path: "src/views/MarkdownView.ts", role: "Source/preview view surface." },
    ],
  },
  {
    id: "knowledge-system",
    title: "Knowledge system",
    summary: "Vault, metadata, links, tags, search, properties, bases and query.",
    modules: [
      { path: "src/vault", role: "Files, adapters, watcher and vault manager." },
      { path: "src/metadata", role: "Metadata cache plus scoped link/tag helper seams." },
      { path: "src/properties", role: "Typed properties over frontmatter/cache." },
      { path: "src/query", role: "Structured query engine." },
      { path: "src/bases", role: "Bases-style table views over query results." },
    ],
  },
  {
    id: "plugin-system",
    title: "Plugin system",
    summary: "Lifecycle-managed extension API for community and internal plugins.",
    modules: [
      { path: "src/plugin", role: "Plugin, manager, loader, installer, marketplace and security." },
      { path: "examples/plugins", role: "Example plugins for major extension surfaces." },
      { path: "src/docs", role: "Plugin API documentation generator." },
    ],
  },
  {
    id: "appearance",
    title: "Appearance",
    summary: "Theme, CSS snippets, appearance settings and theme marketplace.",
    modules: [
      { path: "src/theme", role: "Theme manager, custom CSS and appearance settings." },
      { path: "src/theme-market", role: "Theme package, marketplace, installer and validator." },
      { path: "src/ui", role: "Reusable UI primitives styled through CSS variables." },
    ],
  },
  {
    id: "persistence",
    title: "Persistence",
    summary: ".obsidian-style app config, plugin data and layout persistence.",
    modules: [
      { path: "src/storage", role: "JSON store, app config and plugin data store." },
      { path: "src/workspace/WorkspaceLayoutPersistence.ts", role: "Save/restore workspace layout." },
      { path: "src/revisions", role: "File revision history." },
      { path: "src/recovery", role: "File recovery from revisions." },
    ],
  },
  {
    id: "distribution",
    title: "Distribution",
    summary: "Packaging, build pipeline and release management.",
    modules: [
      { path: "src/packaging", role: "Plugin/theme artifact builders." },
      { path: "src/build", role: "Build targets and pipeline." },
      { path: "src/release", role: "Release records, channels and notes." },
    ],
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    summary: "Logging, error reporting and developer tools.",
    modules: [
      { path: "src/diagnostics", role: "Logger, error reporter and plugin boundary." },
      { path: "src/devtools", role: "Developer-facing inspection APIs." },
      { path: "src/builtin/DeveloperConsoleView.ts", role: "Diagnostics view in Workspace." },
    ],
  },
];
