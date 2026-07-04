import type { RuntimeScenario } from "./RuntimeScenario";

export const defaultScenarios: RuntimeScenario[] = [
  {
    id: "open-markdown-file",
    title: "Open Markdown file",
    goal: "Trace file opening from Workspace to MarkdownView.",
    steps: [
      { id: "leaf", title: "Get leaf", description: "Workspace selects or creates a leaf.", modules: ["src/workspace/Workspace.ts", "src/workspace/WorkspaceLeaf.ts"] },
      { id: "registry", title: "Resolve view type", description: "ViewRegistry maps .md to markdown.", modules: ["src/workspace/ViewRegistry.ts"] },
      { id: "view", title: "Mount MarkdownView", description: "Leaf closes previous view and opens MarkdownView.", modules: ["src/views/MarkdownView.ts"] },
      { id: "render", title: "Render source/preview", description: "MarkdownView chooses editor or preview renderer.", modules: ["src/markdown/MarkdownRenderer.ts", "src/editor/EditorView.ts"] },
    ],
  },
  {
    id: "plugin-register-view",
    title: "Plugin registers a View",
    goal: "Trace plugin view registration and cleanup.",
    steps: [
      { id: "onload", title: "Plugin onload", description: "Plugin calls registerView.", modules: ["src/plugin/Plugin.ts", "examples/plugins/custom-view-plugin/main.ts"] },
      { id: "registry", title: "ViewRegistry", description: "View factory is registered by type.", modules: ["src/workspace/ViewRegistry.ts"] },
      { id: "open", title: "Open view", description: "Command opens a leaf with custom view state.", modules: ["src/app/AppCommands.ts", "src/workspace/WorkspaceLeaf.ts"] },
      { id: "cleanup", title: "Unload cleanup", description: "Plugin unregisters view and detaches leaves of that type.", modules: ["src/plugin/Plugin.ts"] },
    ],
  },
];
