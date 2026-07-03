import { App, provideAppAdapter } from "./app/App";
import { FileSystemAdapter } from "./vault/FileSystemAdapter";
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
  provideDesktopAdapter(parent);
  const app = new App(parent);
  const win = parent.ownerDocument.defaultView ?? window;
  win.app = app;
  await app.ready;

  const welcome = await ensureMarkdownFile(app, "Welcome.md", welcomeMarkdown);
  await ensureMarkdownFile(app, "Plugin Architecture.md", pluginMarkdown);
  await seedCodeDemoFiles(app);
  await app.workspace.openFile(welcome, { active: true, state: { mode: "preview" } });

  app.statusBar.registerStatusBarItem().textContent = "Obsidian Reconstructed";
  return app;
}

async function ensureMarkdownFile(app: App, path: string, markdown: string): Promise<TFile> {
  return app.vault.getFileByPath(path) ?? app.vault.create(path, markdown);
}

// The in-memory demo vault shows the agent-workspace surface: code files
// open highlighted, extensionless files route to the code view, and global
// search reaches all of them (try searching "needle").
async function seedCodeDemoFiles(app: App): Promise<void> {
  if (!app.vault.getFolderByPath("agent")) await app.vault.createFolder("agent");
  const goSource = [
    "package main",
    "",
    'import "fmt"',
    "",
    "// findNeedle scans the haystack for the needle.",
    "func findNeedle(haystack []string) int {",
    "\tfor i, s := range haystack {",
    '\t\tif s == "needle" {',
    "\t\t\treturn i",
    "\t\t}",
    "\t}",
    "\treturn -1",
    "}",
    "",
    "func main() {",
    '\tfmt.Println(findNeedle([]string{"hay", "needle"}))',
    "}",
    "",
  ].join("\n");
  const dockerfile = [
    "FROM golang:1.23-alpine AS build",
    "WORKDIR /app",
    "COPY . .",
    "RUN go build -o server ./agent",
    "",
    "FROM alpine:3",
    "COPY --from=build /app/server /usr/local/bin/server",
    'ENTRYPOINT ["server"]',
    "",
  ].join("\n");
  if (!app.vault.getFileByPath("agent/server.go")) await app.vault.create("agent/server.go", goSource);
  if (!app.vault.getFileByPath("Dockerfile")) await app.vault.create("Dockerfile", dockerfile);
}

/**
 * Under the Electron desktop shell the main process opens a real vault window
 * and answers the `vault` IPC with its folder path; back the vault with a
 * {@link FileSystemAdapter} so edits persist to disk. In the browser (no
 * `window.electron`), leave the App on its default in-memory adapter.
 */
function provideDesktopAdapter(parent: HTMLElement): void {
  const win = parent.ownerDocument.defaultView ?? window;
  const vaultPath = resolveElectronVaultPath(win);
  provideAppAdapter(vaultPath ? new FileSystemAdapter(vaultPath) : undefined);
}

function resolveElectronVaultPath(win: Window): string | null {
  try {
    const electron = (win as Window & {
      electron?: { ipcRenderer?: { sendSync?: (channel: string) => unknown } };
    }).electron;
    const info = electron?.ipcRenderer?.sendSync?.("vault") as { path?: string } | undefined;
    if (info && typeof info.path === "string" && info.path.length > 0) return info.path;
  } catch {
    // Not running under Electron.
  }
  return null;
}
