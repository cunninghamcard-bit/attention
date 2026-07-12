import type { App } from "../../../app/App";
import type { AsciiTreeNode } from "../Cli";
import { TFile } from "../../../vault/TAbstractFile";
import { WorkspaceLeaf } from "../../../views/workspace/WorkspaceLeaf";
import { WorkspaceParent } from "../../../views/workspace/WorkspaceParent";
import { WorkspaceSplit } from "../../../views/workspace/WorkspaceSplit";
import { WorkspaceTabs } from "../../../views/workspace/WorkspaceTabs";
import { MobileDrawer } from "../../../platform/mobile/MobileDrawer";
import type { WorkspaceItem } from "../../../views/workspace/WorkspaceItem";

/**
 * The navigation/workspace command batch — faithful to real Obsidian 1.12.7:
 * random, random:read, reload, tabs, recents, tab:open, workspace.
 *
 * Deliberately NOT registered: `restart` ("Restart the app"). The real desktop
 * branch is `window.electron.ipcRenderer.sendSync("relaunch")`, but our main
 * process registers no "relaunch" IPC channel (electron/foundation-ipc.ts
 * handles only file-url/is-quitting/trash), so on desktop the command would be
 * a silent no-op — banned by the fail-fast rule. Register it once the main
 * process grows a relaunch handler.
 */
export function registerNavigationCommands(app: App): void {
  const cli = app.cli;

  // Real shared helper C: markdown files only, folder is a raw path-prefix
  // match with "/" appended, uniform random pick, null when empty.
  const randomMarkdownFile = (folder: string | undefined): TFile | null => {
    let files = app.vault.getMarkdownFiles();
    if (folder) {
      const prefix = folder.endsWith("/") ? folder : `${folder}/`;
      files = files.filter((file) => file.path.startsWith(prefix));
    }
    if (files.length === 0) return null;
    return files[Math.floor(Math.random() * files.length)];
  };

  cli.registerHandler(
    "random",
    "Open a random note",
    {
      folder: { value: "<path>", description: "Limit to folder" },
      newtab: { description: "Open in new tab" },
    },
    async (params) => {
      const file = randomMarkdownFile(params.folder);
      if (!file) return "No markdown files found.";
      const leaf = params.newtab ? app.workspace.getLeaf("tab") : app.workspace.getLeaf();
      await leaf.openFile(file, { active: true });
      // Echoes the resolved file.path (tab:open echoes the flag instead).
      return `Opened: ${file.path}`;
    },
  );

  cli.registerHandler(
    "random:read",
    "Read a random note",
    { folder: { value: "<path>", description: "Limit to folder" } },
    async (params) => {
      const file = randomMarkdownFile(params.folder);
      if (!file) return "No markdown files found.";
      const content = await app.vault.cachedRead(file);
      return `${file.path}\n\n${content}`;
    },
  );

  cli.registerHandler("reload", "Reload the vault", null, () => {
    // Reply first, reload 10ms later so the socket gets the text back.
    setTimeout(() => window.location.reload(), 10);
    return "Reloading...";
  });

  cli.registerHandler(
    "tabs",
    "List open tabs",
    { ids: { description: "Include tab IDs" } },
    (params) => {
      const lines: string[] = [];
      app.workspace.iterateAllLeaves((leaf) => {
        const line = `[${leaf.view.getViewType()}] ${leaf.getDisplayText()}`;
        lines.push(line + (params.ids ? `\t${leaf.id}` : ""));
      });
      return lines.join("\n");
    },
  );

  cli.registerHandler(
    "recents",
    "List recently opened files",
    { total: { description: "Return recent file count" } },
    (params) => {
      const files = app.workspace.getLastOpenFiles();
      // total is checked before the empty case: an empty list counts as "0".
      if (params.total) return String(files.length);
      if (files.length === 0) return "No recent files.";
      return files.join("\n");
    },
  );

  cli.registerHandler(
    "tab:open",
    "Open a new tab",
    {
      group: { value: "<id>", description: "Tab group ID" },
      file: { value: "<path>", description: "File to open" },
      view: { value: "<type>", description: "View type to open" },
    },
    async (params) => {
      // Real order: the leaf is created BEFORE file validation, so a bad
      // file= still leaves a new empty tab open.
      let leaf: WorkspaceLeaf;
      if (params.group) {
        const group = findTabGroup(app, params.group);
        if (!group) throw `Tab group "${params.group}" not found. Use "workspace ids=true" to list tab group IDs.`;
        // Real Obsidian passes a matched MobileDrawer here too; only the
        // WorkspaceParent surface (children/insertChild) is used.
        leaf = app.workspace.createLeafInTabGroup(group as WorkspaceTabs);
      } else {
        leaf = app.workspace.getLeaf("tab");
      }
      if (params.file) {
        const file = app.vault.getAbstractFileByPath(params.file);
        if (!file) throw `File "${params.file}" not found.`;
        if (!(file instanceof TFile)) throw `"${params.file}" is a folder, not a file.`;
        await leaf.openFile(file, { active: true });
        return `Opened: ${params.file}`;
      }
      if (params.view) {
        // No validation that the view type exists (real behavior).
        await leaf.setViewState({ type: params.view });
        return `Opened view: ${params.view}`;
      }
      return "Opened new tab";
    },
  );

  cli.registerHandler(
    "workspace",
    "Show workspace tree",
    { ids: { description: "Include workspace item IDs" } },
    (params) => {
      const idSuffix = (item: WorkspaceItem): string => (params.ids ? ` (${item.id})` : "");
      const map = (node: WorkspaceItem): AsciiTreeNode => {
        if (node instanceof WorkspaceLeaf) {
          return { label: `[${node.view.getViewType()}] ${node.getDisplayText()}${idSuffix(node)}` };
        }
        if (node instanceof WorkspaceParent) {
          const label = node instanceof WorkspaceSplit ? `${node.type}:${node.direction}` : node.type;
          return { label: label + idSuffix(node), children: node.children.map(map) };
        }
        return { label: "unknown" };
      };
      const workspace = app.workspace;
      const sections = [
        cli.formatAsciiTreeWithRoot(`main${idSuffix(workspace.rootSplit)}`, workspace.rootSplit.children.map(map)),
        cli.formatAsciiTreeWithRoot(`left${idSuffix(workspace.leftSplit)}`, workspace.leftSplit.children.map(map)),
        cli.formatAsciiTreeWithRoot(`right${idSuffix(workspace.rightSplit)}`, workspace.rightSplit.children.map(map)),
      ];
      // "floating" is omitted entirely (even with ids) when it has no children.
      if (workspace.floatingSplit.children.length > 0) {
        sections.push(cli.formatAsciiTreeWithRoot(`floating${idSuffix(workspace.floatingSplit)}`, workspace.floatingSplit.children.map(map)));
      }
      return sections.join("\n");
    },
  );
}

// Real tab-group DFS: only Tabs/MobileDrawer nodes match the id (a split id
// will not), search order rootSplit → leftSplit → rightSplit → floatingSplit.
function findTabGroup(app: App, id: string): WorkspaceTabs | MobileDrawer | null {
  const search = (node: WorkspaceItem): WorkspaceTabs | MobileDrawer | null => {
    if ((node instanceof WorkspaceTabs || node instanceof MobileDrawer) && node.id === id) return node;
    if (node instanceof WorkspaceParent) {
      for (const child of node.children) {
        const found = search(child);
        if (found) return found;
      }
    }
    return null;
  };
  const { rootSplit, leftSplit, rightSplit, floatingSplit } = app.workspace;
  return search(rootSplit) ?? search(leftSplit) ?? search(rightSplit) ?? search(floatingSplit);
}
