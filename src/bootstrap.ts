import { App } from "./app/App";
import type { TFile } from "./vault/TAbstractFile";

const welcomeMarkdown = `# Obsidian Reconstructed

This runnable shell follows the reconstructed Obsidian chain:

\`\`\`text
AppDom -> App -> Workspace -> WorkspaceTabs -> WorkspaceLeaf -> MarkdownView
\`\`\`

## What is running here

- The app creates the real reconstructed \`App\` object.
- The workspace owns splits, tabs, leaves, and views.
- \`.md\` files resolve through \`ViewRegistry\` into \`MarkdownView\`.
- Core plugin registration goes through the internal plugin wrapper.
- Markdown rendering still uses the reconstructed renderer pipeline.

Open [[Plugin Architecture]] to exercise view navigation, markdown rendering, command registration and plugin seams.

#study #obsidian
`;

const pluginMarkdown = `# Plugin Architecture

Obsidian-style extensibility is centered around stable front-end registration points:

- commands
- views
- ribbon actions
- status bar items
- markdown processors
- themes and snippets

Large Obsidian product features such as Graph, Backlinks, Sync and Publish are intentionally outside the default product surface here. Their thin seams may exist for API study, but the runnable shell focuses on Workspace, View, Markdown and Plugin architecture.

Back to [[Welcome]].
`;

declare global {
  interface Window {
    app?: App;
  }
}

export async function bootstrap(parent: HTMLElement = document.body): Promise<App> {
  const app = new App(parent);
  const win = parent.ownerDocument.defaultView ?? window;
  win.app = app;
  await app.ready;

  const welcome = await ensureMarkdownFile(app, "Welcome.md", welcomeMarkdown);
  await ensureMarkdownFile(app, "Plugin Architecture.md", pluginMarkdown);
  await app.workspace.openFile(welcome, { active: true, state: { mode: "preview" } });

  app.statusBar.registerStatusBarItem().textContent = "Obsidian Reconstructed";
  return app;
}

async function ensureMarkdownFile(app: App, path: string, markdown: string): Promise<TFile> {
  return app.vault.getFileByPath(path) ?? app.vault.create(path, markdown);
}
