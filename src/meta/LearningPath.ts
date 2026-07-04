export interface LearningStep {
  id: string;
  title: string;
  read: string[];
  goal: string;
}

export const frontendLearningPath: LearningStep[] = [
  {
    id: "dom-css",
    title: "DOM and CSS shell",
    read: ["src/dom", "src/ui", "src/styles/index.css", "docs/scope-boundary.md"],
    goal: "Understand how DOM/state contracts drive the ArkLoop style system (docs/style-system.md), which forked from the Obsidian app.css artifact.",
  },
  {
    id: "workspace",
    title: "Workspace layout tree",
    read: ["src/workspace/Workspace.ts", "src/workspace/WorkspaceSplit.ts", "src/workspace/WorkspaceTabs.ts", "src/workspace/WorkspaceLeaf.ts"],
    goal: "Understand Split -> Tabs -> Leaf -> View.",
  },
  {
    id: "views",
    title: "View lifecycle",
    read: ["src/views/View.ts", "src/views/ItemView.ts", "src/builtin"],
    goal: "Understand how built-in and plugin panels share the same container lifecycle.",
  },
  {
    id: "markdown",
    title: "MarkdownView as default product",
    read: ["src/views/MarkdownView.ts", "src/markdown", "src/editor"],
    goal: "Understand source/preview mode, processors and editor extensions.",
  },
  {
    id: "plugins",
    title: "Plugin lifecycle and extension points",
    read: ["src/plugin/Plugin.ts", "src/plugin/PluginManager.ts", "examples/plugins"],
    goal: "Understand registration and cleanup.",
  },
  {
    id: "knowledge",
    title: "Vault metadata and structured data",
    read: ["src/vault", "src/metadata", "src/properties", "src/query", "src/bases"],
    goal: "Understand how Markdown files become searchable/queryable data.",
  },
];
