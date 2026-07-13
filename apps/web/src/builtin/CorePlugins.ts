import type { App } from "../app/App";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { Menu } from "../ui/Menu";
import { TFile, TFolder, type TAbstractFile } from "../vault/TAbstractFile";
import type { WorkspaceLeaf } from "../views/workspace/WorkspaceLeaf";
import { writeClipboardText } from "../dom/Clipboard";
import { Notice } from "../ui/Notice";
import { MoveFileModal } from "../app/MoveFileModal";
import { FileExplorerView } from "./FileExplorerView";
import { SearchView } from "./SearchView";
import { BacklinksView } from "./BacklinksView";
import { OutgoingLinksView } from "./OutgoingLinksView";
import { TagPaneView } from "./TagPaneView";
import { OutlineView } from "./OutlineView";
import { CanvasView } from "./canvas/CanvasView";
import { MarkdownView } from "../views/MarkdownView";
import { registerSearchCliHandlers } from "../app/cli/commands/searchCli";
import {
  registerLinksCliHandlers,
  registerOutlineCliHandlers,
} from "../app/cli/commands/linksOutlineCli";
import { createGraphPluginDefinition } from "./graph/GraphPlugin";
import { createCommandPalettePluginDefinition } from "../app/commands/CommandPalette";
import { createDailyNotesPluginDefinition } from "./DailyNotes";
import { createTemplatesPluginDefinition } from "./Templates";
import { createRandomNotePluginDefinition } from "./RandomNote";
import { createWorkspacesPluginDefinition } from "./Workspaces";
import { createQuickSwitcherPluginDefinition } from "./QuickSwitcher";
import { createEditorStatusPluginDefinition } from "./EditorStatus";
import { createWordCountPluginDefinition } from "./WordCount";
import { createPagePreviewPluginDefinition } from "./PagePreview";
import { createSlashCommandPluginDefinition } from "./SlashCommand";
import { createLinkSuggestPluginDefinition } from "./LinkSuggest";
import { createTagSuggestPluginDefinition } from "./TagSuggest";
import { createZkPrefixerPluginDefinition } from "./ZkPrefixer";
import { createNoteComposerPluginDefinition } from "./NoteComposer";
import { createMarkdownImporterPluginDefinition } from "./MarkdownImporter";
import { createFileRecoveryPluginDefinition } from "./file-recovery/FileRecoveryPlugin";
import { createWebViewerPluginDefinition } from "./webviewer/WebViewerPlugin";
import { createTerminalPluginDefinition } from "./terminal/TerminalPlugin";
import { createGitPluginDefinition } from "./git/GitPlugin";
import { createGitHubPluginDefinition } from "./github/GitHubPlugin";
import { openFileCompare, openGitDiff } from "../views/DiffView";
import { openFileHistory } from "./git/GitHistoryView";
import { openPrList } from "./git/GitPrViews";
import { openGitHubWorkspace } from "./github/GitHubWorkspace";
import { openGitReview } from "./git/review/GitReviewView";
import { createBookmarksPluginDefinition } from "./Bookmarks";
import { createSlidesPluginDefinition } from "./Slides";
import { createAudioRecorderPluginDefinition } from "./AudioRecorder";

const openRootView = (app: App, viewType: string, mode: "tab" | "split" = "tab") => {
  void app.workspace.getLeaf(mode).setViewState({ type: viewType, active: true });
};

export const nonParityFeatureScope = [
  {
    id: "graph",
    area: "core-plugin",
    boundary:
      "not implemented as an Obsidian feature; keep only thin architecture seams when useful",
  },
  {
    id: "backlink",
    area: "core-plugin",
    boundary:
      "not implemented as an Obsidian feature; linked-view/menu contracts may remain as thin seams",
  },
  {
    id: "wiki-link-resolver",
    area: "metadata",
    boundary:
      "do not chase Obsidian's full resolver; keep simplified link interfaces for editor/plugin flow",
  },
  {
    id: "tag-index",
    area: "metadata",
    boundary:
      "do not chase Obsidian's full tag index; keep simplified metadata surfaces only where needed",
  },
  {
    id: "canvas",
    area: "core-plugin",
    boundary:
      "not implemented as a full canvas product; keep file/view/drop seams only when they support architecture study",
  },
  { id: "daily-notes", area: "core-plugin", boundary: "not implemented" },
  { id: "templates", area: "core-plugin", boundary: "not implemented" },
  { id: "slides", area: "core-plugin", boundary: "not implemented" },
  { id: "audio-recorder", area: "core-plugin", boundary: "not implemented" },
  {
    id: "bookmarks",
    area: "core-plugin",
    boundary:
      "not implemented as an Obsidian feature; drag/source contracts may remain as thin seams",
  },
] as const;

const nonParityDefaultOffCorePluginIds = new Set<string>(
  nonParityFeatureScope
    .filter((feature) => feature.area.includes("core-plugin"))
    .map((feature) => feature.id),
);

function scopeCorePluginDefinition(definition: InternalPluginDefinition): InternalPluginDefinition {
  if (!nonParityDefaultOffCorePluginIds.has(definition.id)) return definition;
  return { ...definition, defaultOn: false, hiddenFromList: true };
}

/**
 * Keep this list focused on the platform we are reconstructing: app shell,
 * Workspace, views, MarkdownView, plugin APIs, vault/editor/theme surfaces.
 * Some definitions below are thin architecture seams for reverse-evidence or
 * tests, but the ids in nonParityFeatureScope are not feature-parity targets.
 */
export const corePlugins: InternalPluginDefinition[] = [
  {
    id: "workspace-file-menu",
    name: "Workspace file menu",
    description: "Adds Obsidian's generic file menu actions.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerEvent(
        plugin.app.workspace.on<[Menu, TAbstractFile, string, WorkspaceLeaf]>(
          "file-menu",
          (menu, file) => {
            addWorkspaceFileMenuItems(plugin.app, menu, file);
          },
        ),
      );
      plugin.registerEvent(
        plugin.app.workspace.on<[Menu, TAbstractFile[], string, WorkspaceLeaf]>(
          "files-menu",
          (menu, files) => {
            addWorkspaceFilesMenuItems(plugin.app, menu, files);
          },
        ),
      );
    },
  },
  createQuickSwitcherPluginDefinition(),
  createCommandPalettePluginDefinition(),
  scopeCorePluginDefinition(createBookmarksPluginDefinition()),
  createLinkSuggestPluginDefinition(),
  createTagSuggestPluginDefinition(),
  createSlashCommandPluginDefinition(),
  createPagePreviewPluginDefinition(),
  scopeCorePluginDefinition(createDailyNotesPluginDefinition()),
  scopeCorePluginDefinition(createTemplatesPluginDefinition()),
  createNoteComposerPluginDefinition(),
  createEditorStatusPluginDefinition(),
  createZkPrefixerPluginDefinition(),
  createMarkdownImporterPluginDefinition(),
  createRandomNotePluginDefinition(),
  createWordCountPluginDefinition(),
  scopeCorePluginDefinition(createSlidesPluginDefinition()),
  scopeCorePluginDefinition(createAudioRecorderPluginDefinition()),
  createWorkspacesPluginDefinition(),
  createFileRecoveryPluginDefinition(),
  createWebViewerPluginDefinition(),
  createTerminalPluginDefinition(),
  createGitPluginDefinition(),
  createGitHubPluginDefinition(),
  {
    id: "file-explorer",
    name: "File explorer",
    description: "Shows the vault file tree in a Workspace view.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType("file-explorer", (leaf) => new FileExplorerView(leaf));
      plugin.registerGlobalCommand({
        id: "file-explorer:open",
        name: "Open file explorer",
        icon: "lucide-folder",
        callback: () =>
          void plugin.app.workspace.ensureSideLeaf("file-explorer", "left", {
            active: true,
            reveal: true,
          }),
      });
      plugin.registerGlobalCommand({
        id: "file-explorer:new-file",
        name: "New note",
        icon: "lucide-file-plus",
        hotkeys: [{ modifiers: ["Mod"], key: "N" }],
        callback: async () => {
          const file = await plugin.app.fileManager.createNewMarkdownFile(null);
          await plugin.app.workspace.openFile(file, {
            active: true,
            state: { mode: "source" },
            eState: { rename: "all" },
          });
        },
      });
      plugin.registerGlobalCommand({
        id: "file-explorer:new-folder",
        name: "New folder",
        icon: "lucide-folder-plus",
        callback: () =>
          void plugin.app.fileManager.createNewFolder(null).then((folder) =>
            plugin.app.workspace.ensureSideLeaf("file-explorer", "left", {
              active: true,
              reveal: true,
              state: { newFile: folder.path },
            }),
          ),
      });
      plugin.registerGlobalCommand({
        id: "file-explorer:reveal-active-file",
        name: "Reveal active file in navigation",
        icon: "lucide-folder-open",
        checkCallback: (checking) => {
          const file = plugin.app.workspace.activeEditor?.file;
          if (!file) return false;
          if (!checking) {
            void plugin.app.workspace
              .ensureSideLeaf("file-explorer", "left", { reveal: true })
              .then((leaf) => {
                const view = leaf.view as unknown as { revealFile?: (target: typeof file) => void };
                view.revealFile?.(file);
              });
          }
          return true;
        },
      });
      plugin.registerRibbonItem("Open file explorer", "lucide-folder", () => {
        void plugin.app.workspace.ensureSideLeaf("file-explorer", "left", {
          active: true,
          reveal: true,
        });
      });
    },
    onEnable(app: App) {
      app.workspace.onLayoutReady(
        () => void app.workspace.ensureSideLeaf("file-explorer", "left", { reveal: false }),
      );
    },
  },
  {
    id: "global-search",
    name: "Search",
    description: "Searches across the vault.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType("search", (leaf) => new SearchView(leaf));
      plugin.registerGlobalCommand({
        id: "global-search:open",
        name: "Search in all files",
        icon: "lucide-search",
        callback: () =>
          void plugin.app.workspace
            .ensureSideLeaf("search", "left", { active: true, reveal: true })
            .then((leaf) => {
              const view = leaf.view as unknown as { focusSearch?: () => void };
              view.focusSearch?.();
            }),
      });
      plugin.registerGlobalCommand({
        id: "global-search:search-selection",
        name: "Search current selection",
        icon: "lucide-search-check",
        checkCallback: (checking) => {
          const selection = plugin.app.workspace.activeEditor?.editor.getSelection();
          if (!selection) return false;
          if (!checking) {
            void plugin.app.workspace
              .ensureSideLeaf("search", "left", { active: true, reveal: true })
              .then((leaf) => {
                const view = leaf.view as unknown as { focusSearch?: (query: string) => void };
                view.focusSearch?.(selection);
              });
          }
          return true;
        },
      });
      plugin.registerRibbonItem("Search", "lucide-search", () => {
        void plugin.app.workspace.ensureSideLeaf("search", "left", { active: true, reveal: true });
      });
      registerSearchCliHandlers(plugin);
    },
    onEnable(app: App) {
      app.workspace.onLayoutReady(
        () => void app.workspace.ensureSideLeaf("search", "left", { reveal: false }),
      );
    },
  },
  scopeCorePluginDefinition({
    id: "backlink",
    name: "Backlinks",
    description: "Displays linked mentions for the active file.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType("backlink", (leaf) => new BacklinksView(leaf));
      plugin.registerStatusBarItem();
      plugin.registerGlobalCommand({
        id: "backlink:open",
        name: "Open backlinks",
        icon: "lucide-link",
        callback: () =>
          void plugin.app.workspace.ensureSideLeaf("backlink", "right", {
            active: true,
            reveal: true,
          }),
      });
    },
    onEnable(app: App, plugin: InternalPluginWrapper) {
      plugin.registerEvent(
        app.workspace.on<[Menu, TFile, string, WorkspaceLeaf]>(
          "file-menu",
          (menu, file, source, leaf) => {
            if (source === "sidebar-context-menu" || isMobileRuntime() || !leaf) return;
            addLinkedViewMenuItem(app, menu, file, leaf, {
              title: "Open backlinks",
              icon: "links-coming-in",
              type: "backlink",
              direction: "horizontal",
            });
            if (leaf.view instanceof MarkdownView && leaf.view.canToggleBacklinks()) {
              menu.addItem((item) =>
                item
                  .setSection("pane")
                  .setTitle("Backlinks in document")
                  .setChecked(Boolean(leaf.view.getState().backlinks))
                  .setIcon("links-coming-in")
                  .onClick(() => leaf.view instanceof MarkdownView && leaf.view.toggleBacklinks()),
              );
            }
          },
        ),
      );
      app.workspace.onLayoutReady(
        () => void app.workspace.ensureSideLeaf("backlink", "right", { reveal: false }),
      );
    },
  }),
  scopeCorePluginDefinition({
    id: "outgoing-link",
    name: "Outgoing links",
    description: "Displays links from the active file.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType("outgoing-link", (leaf) => new OutgoingLinksView(leaf));
      plugin.registerGlobalCommand({
        id: "outgoing-links:open",
        name: "Open outgoing links",
        icon: "lucide-forward",
        callback: () =>
          void plugin.app.workspace.ensureSideLeaf("outgoing-link", "right", {
            active: true,
            reveal: true,
          }),
      });
      plugin.registerGlobalCommand({
        id: "outgoing-links:open-for-current",
        name: "Open outgoing links for current file",
        icon: "lucide-forward",
        checkCallback: (checking) => {
          const file = plugin.app.workspace.activeEditor?.file;
          if (!file) return false;
          if (!checking)
            void plugin.app.workspace.ensureSideLeaf("outgoing-link", "right", {
              active: true,
              reveal: true,
            });
          return true;
        },
      });
      registerLinksCliHandlers(plugin);
    },
    onEnable(app: App, plugin: InternalPluginWrapper) {
      plugin.registerEvent(
        app.workspace.on<[Menu, TFile, string, WorkspaceLeaf]>(
          "file-menu",
          (menu, file, source, leaf) => {
            if (
              source === "sidebar-context-menu" ||
              isMobileRuntime() ||
              file.extension !== "md" ||
              !leaf
            )
              return;
            addLinkedViewMenuItem(app, menu, file, leaf, {
              title: "Open outgoing links",
              icon: "links-going-out",
              type: "outgoing-link",
              direction: "horizontal",
            });
          },
        ),
      );
      app.workspace.onLayoutReady(
        () => void app.workspace.ensureSideLeaf("outgoing-link", "right", { reveal: false }),
      );
    },
  }),
  {
    id: "tag-pane",
    name: "Tags",
    description: "Displays tags found in the vault.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType("tag", (leaf) => new TagPaneView(leaf));
      plugin.registerGlobalCommand({
        id: "tag-pane:open",
        name: "Open tags",
        icon: "lucide-tags",
        callback: () =>
          void plugin.app.workspace.ensureSideLeaf("tag", "right", { active: true, reveal: true }),
      });
    },
    onEnable(app: App) {
      app.workspace.onLayoutReady(
        () => void app.workspace.ensureSideLeaf("tag", "right", { reveal: false }),
      );
    },
  },
  {
    id: "outline",
    name: "Outline",
    description: "Displays headings from the active markdown file.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType("outline", (leaf) => new OutlineView(leaf));
      plugin.registerGlobalCommand({
        id: "outline:open",
        name: "Open outline",
        icon: "lucide-list-tree",
        callback: () =>
          void plugin.app.workspace.ensureSideLeaf("outline", "right", {
            active: true,
            reveal: true,
          }),
      });
      registerOutlineCliHandlers(plugin);
    },
    onEnable(app: App, plugin: InternalPluginWrapper) {
      plugin.registerEvent(
        app.workspace.on<[Menu, TFile, string, WorkspaceLeaf]>(
          "file-menu",
          (menu, file, source, leaf) => {
            if (
              source === "sidebar-context-menu" ||
              isMobileRuntime() ||
              file.extension !== "md" ||
              !leaf
            )
              return;
            addLinkedViewMenuItem(app, menu, file, leaf, {
              title: "Open outline",
              icon: "lucide-list",
              type: "outline",
              direction: "vertical",
            });
          },
        ),
      );
      app.workspace.onLayoutReady(
        () => void app.workspace.ensureSideLeaf("outline", "right", { reveal: false }),
      );
    },
  },
  scopeCorePluginDefinition(createGraphPluginDefinition()),
  scopeCorePluginDefinition({
    id: "canvas",
    name: "Canvas",
    description: "Registers the canvas view type and canvas commands.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      plugin.registerViewType("canvas", (leaf) => new CanvasView(leaf));
      plugin.registerExtensions(["canvas"], "canvas");
      const createCanvasFile = async () => {
        const file = await plugin.app.vault.create(
          plugin.app.vault.getAvailablePath("Untitled", "canvas"),
          '{\n  "nodes": [],\n  "edges": []\n}\n',
        );
        await plugin.app.workspace.openFile(file, { active: true, eState: { rename: "all" } });
      };
      plugin.registerGlobalCommand({
        id: "canvas:new-file",
        name: "Create new canvas",
        icon: "lucide-layout-dashboard",
        callback: () => void createCanvasFile(),
      });
      plugin.registerGlobalCommand({
        id: "canvas:new",
        name: "Create new canvas",
        icon: "lucide-layout-dashboard",
        callback: () => void createCanvasFile(),
      });
      plugin.registerGlobalCommand({
        id: "canvas:export-as-image",
        name: "Export canvas as image",
        icon: "lucide-image-down",
        checkCallback: (checking) => {
          const view = plugin.app.workspace.activeLeaf?.view;
          if (!(view instanceof CanvasView)) return false;
          if (!checking) {
            const link = document.createElement("a");
            link.href = view.generateHDImage();
            link.download = `${view.getDisplayText()}.svg`;
            link.click();
          }
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "canvas:jump-to-group",
        name: "Jump to group",
        icon: "lucide-box-select",
        checkCallback: (checking) => {
          const view = plugin.app.workspace.activeLeaf?.view;
          if (!(view instanceof CanvasView)) return false;
          const groups = view.canvas.getGroupNodes();
          if (groups.length === 0) return false;
          if (!checking) {
            const label = window.prompt(
              "Group",
              groups.map((group) => group.data.label || group.id).join(", "),
            );
            const group =
              groups.find((item) => item.id === label || item.data.label === label) ?? groups[0];
            view.zoomToGroup(group.id);
          }
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "canvas:convert-to-file",
        name: "Convert text node to file",
        icon: "lucide-file-plus",
        checkCallback: (checking) => {
          const view = plugin.app.workspace.activeLeaf?.view;
          if (!(view instanceof CanvasView) || !view.canvas.getSingleSelectedTextNode())
            return false;
          if (!checking) void view.convertSelectedTextNodeToFile();
          return true;
        },
      });
    },
  }),
];

function addWorkspaceFileMenuItems(app: App, menu: Menu, file: TAbstractFile): void {
  menu.setSectionSubmenu("info.copy", { title: "Copy path", icon: "lucide-clipboard" });
  if (file instanceof TFile) {
    menu
      .addItem((item) =>
        item
          .setSection("info.copy")
          .setTitle("Copy Obsidian URL")
          .setIcon("lucide-link")
          .onClick(() => void app.copyObsidianUrl(file)),
      )
      .addItem((item) =>
        item
          .setSection("system")
          .setTitle("File history")
          .setIcon("lucide-history")
          .onClick(() => void openFileHistory(app, file.path)),
      )
      .addItem((item) =>
        item
          .setSection("system")
          .setTitle("Open git diff")
          .setIcon("lucide-file-diff")
          .onClick(
            () =>
              void openGitDiff(app, file).then((leaf) => {
                if (!leaf) new Notice("Git is not available for this vault");
              }),
          ),
      )
      .addItem((item) =>
        item
          .setSection("system")
          .setTitle("Open in default app")
          .setIcon("lucide-arrow-up-right")
          .onClick(() => void app.openWithDefaultApp(file.path)),
      )
      .addItem((item) =>
        item
          .setSection("open")
          .setTitle("Open in new window")
          .setIcon("lucide-picture-in-picture-2")
          .onClick(() => void app.workspace.openPopoutLeaf().openFile(file)),
      );
  }
  if (file instanceof TFolder && file.isRoot()) return;
  menu
    .addItem((item) =>
      item
        .setSection("action")
        .setTitle(file instanceof TFile ? "Move file to..." : "Move folder to...")
        .setIcon("lucide-folder-tree")
        .onClick(() => new MoveFileModal(app, [file]).open()),
    )
    .addItem((item) =>
      item
        .setSection("info.copy")
        .setTitle("Copy path")
        .setIcon("vault")
        .onClick(() => void copyVaultPath(file.path)),
    );
}

function addWorkspaceFilesMenuItems(app: App, menu: Menu, files: TAbstractFile[]): void {
  if (files.length === 0 || files.some((file) => file instanceof TFolder && file.isRoot())) return;
  menu.addItem((item) =>
    item
      .setSection("action")
      .setTitle("Move items to...")
      .setIcon("lucide-folder-tree")
      .onClick(() => new MoveFileModal(app, files).open()),
  );
  if (files.length === 2 && files.every((file): file is TFile => file instanceof TFile)) {
    const [baseline, target] = files;
    menu.addItem((item) =>
      item
        .setSection("action")
        .setTitle("Compare files")
        .setIcon("lucide-file-diff")
        .onClick(() => void openFileCompare(app, target, baseline)),
    );
  }
}

async function copyVaultPath(path: string): Promise<void> {
  await writeClipboardText(path === "/" ? "" : path);
  new Notice("Copied path");
}

interface LinkedViewMenuItem {
  title: string;
  icon: string;
  type: string;
  direction: "vertical" | "horizontal";
}

function addLinkedViewMenuItem(
  app: App,
  menu: Menu,
  file: TFile,
  sourceLeaf: WorkspaceLeaf,
  item: LinkedViewMenuItem,
): void {
  menu.addItem((menuItem) =>
    menuItem
      .setSection("view.linked")
      .setTitle(item.title)
      .setIcon(item.icon)
      .onClick(() => {
        const leaf = app.workspace.splitLeafOrActive(sourceLeaf, item.direction);
        void leaf.setViewState({
          type: item.type,
          state: { file: file.path },
          active: true,
          group: sourceLeaf,
        });
      }),
  );
}

function isMobileRuntime(): boolean {
  return document.body.classList.contains("is-mobile") || navigator.userAgent.includes("Mobile");
}

export async function registerCorePlugins(app: App): Promise<void> {
  for (const definition of corePlugins) app.internalPlugins.register(definition);
  await app.internalPlugins.enableDefaults();
}
