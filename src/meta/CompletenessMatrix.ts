export type CompletionStatus = "covered" | "sketched" | "placeholder" | "not-modeled";

export interface CompletenessItem {
  area: string;
  status: CompletionStatus;
  evidence: string[];
  notes: string;
}

export const completenessMatrix: CompletenessItem[] = [
  {
    area: "App shell and service composition",
    status: "covered",
    evidence: ["src/app/App.ts", "src/app/AppLifecycle.ts", "src/app/AppCommands.ts"],
    notes: "Central composition exists with lifecycle, commands and services.",
  },
  {
    area: "Workspace layout tree",
    status: "covered",
    evidence: ["src/workspace/Workspace.ts", "src/workspace/WorkspaceSplit.ts", "src/workspace/WorkspaceTabs.ts", "src/workspace/WorkspaceLeaf.ts"],
    notes: "Split/Tabs/Leaf/View structure is represented.",
  },
  {
    area: "MarkdownView default product",
    status: "covered",
    evidence: ["src/views/MarkdownView.ts", "src/markdown", "src/editor"],
    notes: "Source/preview, renderer, processors and CodeMirror-shaped extensions exist.",
  },
  {
    area: "Plugin lifecycle and extension APIs",
    status: "covered",
    evidence: ["src/plugin/Plugin.ts", "src/plugin/PluginManager.ts", "examples/plugins"],
    notes: "Registration helpers and cleanup pattern are represented.",
  },
  {
    area: "Community plugin ecosystem",
    status: "sketched",
    evidence: ["src/plugin/PluginMarketplace.ts", "src/plugin/PluginInstaller.ts", "src/plugin/PluginSecurity.ts"],
    notes: "Marketplace/install/security shape exists, but not real network or package execution.",
  },
  {
    area: "Theme ecosystem",
    status: "sketched",
    evidence: ["src/theme", "src/theme-market"],
    notes: "CSS variables, snippets, theme marketplace and installer are modeled.",
  },
  {
    area: "Vault and scoped metadata",
    status: "covered",
    evidence: ["src/vault", "src/metadata", "src/search"],
    notes: "Files, metadata cache, scoped links/tags and search are represented; full wiki-link resolver and TagIndex parity are excluded.",
  },
  {
    area: "Properties, query and Bases",
    status: "covered",
    evidence: ["src/properties", "src/query", "src/bases"],
    notes: "Frontmatter-to-query-to-table chain is represented.",
  },
  {
    area: "Desktop shell boundary",
    status: "sketched",
    evidence: ["src/desktop", "src/native", "src/shell"],
    notes: "Electron-shaped main/preload/native boundaries exist, but not real Electron code.",
  },
  {
    area: "Sync, publish, account",
    status: "placeholder",
    evidence: ["src/sync", "src/publish", "src/account"],
    notes: "Product capability facades exist as boundaries only; Sync and Publish feature parity is excluded.",
  },
  {
    area: "Diagnostics and devtools",
    status: "covered",
    evidence: ["src/diagnostics", "src/devtools", "src/builtin/DeveloperConsoleView.ts"],
    notes: "Plugin error boundary and developer console are modeled.",
  },
  {
    area: "Build, packaging and release",
    status: "sketched",
    evidence: ["src/build", "src/packaging", "src/release"],
    notes: "Distribution model exists without real bundler/electron-builder integration.",
  },
  {
    area: "Real Obsidian source fidelity",
    status: "placeholder",
    evidence: ["README.md", "docs/architecture-map.md"],
    notes: "This is a clean-room readable reconstruction from public/bundled architecture signals, not original source.",
  },
];
