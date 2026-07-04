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
    status: "covered",
    evidence: ["src/theme", "src/theme-market"],
    notes: "Theme/appearance/CSS-snippet managers and marketplace/installer are wired into App with a real style-injection cascade and config persistence; no real network fetch in the marketplace.",
  },
  {
    area: "Vault and scoped metadata",
    status: "covered",
    evidence: ["src/vault", "src/metadata", "src/search"],
    notes: "Files, metadata cache, scoped links/tags and search are represented; full wiki-link resolver and TagIndex parity are excluded.",
  },
  {
    area: "Properties and query",
    status: "covered",
    evidence: ["src/properties", "src/query"],
    notes: "Frontmatter parsing, property types and the query engine are represented; the Bases table product and the sidebar properties panel were removed in the agent-workspace refit.",
  },
  {
    area: "Electron main process",
    status: "covered",
    evidence: ["electron/main.ts", "electron/ipc.ts", "vite.electron.config.ts"],
    notes: "Real Electron main: single-instance lock, BrowserWindow lifecycle with bounds persistence, app:// protocol with Range support, full IPC channel table, obsidian:// routing, session hardening and native menus; builds to dist-electron/main.cjs.",
  },
  {
    area: "Desktop shell boundary (renderer bridge)",
    status: "sketched",
    evidence: ["src/desktop", "src/native", "src/shell"],
    notes: "Renderer-side native bridge branches on real-vs-mocked ipcRenderer and is backed by the real Electron main process (see 'Electron main process'); DesktopMain retains deliberate facade seams.",
  },
  {
    area: "Sync, publish, account",
    status: "not-modeled",
    evidence: ["src/builtin/CorePlugins.ts"],
    notes: "Removed in the agent-workspace refit: Sync/Publish/Account are note-product services with no role in an agent workspace.",
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
