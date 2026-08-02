/**
 * Input: ./app/App, ./storage/FileSystemJsonStoreAdapter, ./vault/FileSystemAdapter, ./vault/TAbstractFile
 * Output: bootstrap
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { App, provideAppAdapter, provideJsonStoreAdapter } from "./app/App";
import { FileSystemJsonStoreAdapter } from "./storage/FileSystemJsonStoreAdapter";
import { connectSyncClient, loadSyncedAdapter } from "./sync/SyncBoot";
import { FileSystemAdapter } from "./vault/FileSystemAdapter";
import type { TFile } from "./vault/TAbstractFile";

const welcomeMarkdown = `# Welcome to Attention

This workspace is where your agents live and work — code, terminals, notes and search in one place.

## Get around

- **Terminal** — press \`Cmd+J\`, click the terminal icon in the ribbon, or right-click any folder and choose *Open terminal here*. Real shell, real PTY.
- **Code** — open [[agent/server.go|server.go]] or the [[Dockerfile]] straight from the file tree. Syntax highlighting, editing and auto-save included.
- **Search everything** — \`Cmd+Shift+F\`-style global search covers notes *and* code. Try operators: \`path:agent needle\`, \`ext:go\`, \`line:(hay needle)\`.
- **Notes** — markdown still works everywhere. Link with [[wiki-links]], tag with #tags, and agents can reference any file the same way.

## Conventions

- \`agent/\` holds an agent's working files — configs, scripts, sources.
- Extensionless files (Dockerfile, Makefile, dotfiles) open as code.
- The chat and agent board arrive with the agent domain — this workspace is their home.

#attention
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
  // A stored synced-vault choice wins over everything: the window opens ON
  // the local replica (usable offline) and the sync client connects after
  // boot. Otherwise the desktop/browser adapter decision stands unchanged.
  const synced = await loadSyncedAdapter();
  if (synced) provideAppAdapter(synced.adapter);
  else provideDesktopAdapter(parent);
  const app = new App(parent);
  const win = parent.ownerDocument.defaultView ?? window;
  win.app = app;
  await app.ready;
  if (synced) void connectSyncClient(synced);

  // Demo content seeds only a brand-new (empty) vault — an existing vault's
  // contents are the user's; real Obsidian never writes into an opened vault.
  // A synced vault is never seeded: its emptiness may just mean the backfill
  // hasn't arrived yet, and demo files pushed into the account's vault would
  // merge into every device.
  if (!synced && app.vault.getFiles().length === 0) {
    const welcome = await ensureMarkdownFile(app, "Welcome.md", welcomeMarkdown);
    await ensureMarkdownFile(app, "Plugin Architecture.md", pluginMarkdown);
    await seedCodeDemoFiles(app);
    await app.workspace.openFile(welcome, { active: true, state: { mode: "preview" } });
  }

  app.statusBar.registerStatusBarItem().textContent = "Attention";
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
  if (!app.vault.getFileByPath("agent/server.go"))
    await app.vault.create("agent/server.go", goSource);
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
  const { path: vaultPath, home } = resolveElectronVault(win);
  provideAppAdapter(vaultPath ? new FileSystemAdapter(vaultPath) : undefined);
  // Config is the app's, not the folder's: `.obsidian/` lives once under the
  // config home and NOTHING is written into an opened folder. Content and
  // config are two adapters on two different roots from here on.
  provideJsonStoreAdapter(
    home ? new FileSystemJsonStoreAdapter(new FileSystemAdapter(home)) : undefined,
  );
}

function resolveElectronVault(win: Window): { path: string | null; home: string | null } {
  try {
    const electron = (
      win as Window & {
        electron?: { ipcRenderer?: { sendSync?: (channel: string) => unknown } };
      }
    ).electron;
    const info = electron?.ipcRenderer?.sendSync?.("vault") as
      | { path?: string; home?: string }
      | undefined;
    return {
      path: typeof info?.path === "string" && info.path.length > 0 ? info.path : null,
      home: typeof info?.home === "string" && info.home.length > 0 ? info.home : null,
    };
  } catch {
    // Not running under Electron.
    return { path: null, home: null };
  }
}
