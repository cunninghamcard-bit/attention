import type { App } from "../../app/App";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import type { Menu } from "../../ui/Menu";
import type { TFile } from "../../vault/TAbstractFile";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
import { GraphView, LocalGraphView } from "./GraphView";
import type { GraphPluginOptions } from "./GraphOptions";
import { assignGraphPluginOptions, cloneGraphPluginOptions, createDefaultGraphPluginOptions } from "./GraphOptions";

export const GRAPH_VIEW_TYPE = "graph";
export const LOCAL_GRAPH_VIEW_TYPE = "localgraph";

export function createGraphPluginDefinition(): InternalPluginDefinition {
  const options = createDefaultGraphPluginOptions();
  let wrapper: InternalPluginWrapper | null = null;
  let saveTimer: number | undefined;

  const saveGraphData = () => {
    if (!wrapper) return;
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      if (wrapper?.enabled) void wrapper.saveData(cloneGraphPluginOptions(options));
    }, 500);
  };

  return {
    id: "graph",
    name: "Graph view",
    description: "Displays file links as a graph view.",
    defaultOn: true,
    init(_app: App, plugin: InternalPluginWrapper) {
      wrapper = plugin;
      plugin.registerViewType(GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, options, { onOptionsChange: saveGraphData }));
      plugin.registerViewType(LOCAL_GRAPH_VIEW_TYPE, (leaf) => new LocalGraphView(leaf, options));
      plugin.registerRibbonItem("Open graph view", "lucide-git-fork", () => openGraph(plugin.app));

      plugin.registerGlobalCommand({
        id: "graph:open",
        name: "Open graph view",
        icon: "lucide-git-fork",
        hotkeys: [{ modifiers: ["Mod"], key: "G" }],
        callback: () => openGraph(plugin.app),
      });

      plugin.registerGlobalCommand({
        id: "graph:open-local",
        name: "Open local graph",
        icon: "lucide-git-branch",
        checkCallback: (checking) => {
          const file = plugin.app.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) openLocalGraph(plugin.app, file.path);
          return true;
        },
      });

      plugin.registerGlobalCommand({
        id: "graph:animate",
        name: "Animate graph",
        icon: "lucide-orbit",
        checkCallback: (checking) => {
          const view = plugin.app.workspace.activeLeaf?.view;
          if (!(view instanceof GraphView) || view instanceof LocalGraphView) return false;
          if (!checking) view.toggleAnimation();
          return true;
        },
      });

    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      const stored = await plugin.loadData<Partial<GraphPluginOptions>>();
      if (stored) assignGraphPluginOptions(options, stored);
      plugin.registerEvent(plugin.app.workspace.on<[Menu, TFile, string, WorkspaceLeaf]>("file-menu", (menu, file, source, sourceLeaf) => {
        if (source === "sidebar-context-menu" || file.extension !== "md" || !sourceLeaf) return;
        menu.addItem((item) => item
          .setSection("view.linked")
          .setTitle("Open local graph")
          .setIcon("lucide-git-fork")
          .onClick(() => openLinkedLocalGraph(plugin.app, file.path, sourceLeaf)));
      }));
    },
    async onDisable(_app: App, plugin: InternalPluginWrapper) {
      if (saveTimer !== undefined) {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
      }
      await plugin.saveData(cloneGraphPluginOptions(options));
    },
  };
}

function openGraph(app: App): void {
  void app.workspace.getLeaf("tab").setViewState({ type: GRAPH_VIEW_TYPE, active: true });
}

function openLocalGraph(app: App, path: string): void {
  const sourceLeaf = app.workspace.activeLeaf;
  const leaf = app.workspace.splitActiveLeaf("vertical");
  void leaf.setViewState({ type: LOCAL_GRAPH_VIEW_TYPE, active: true, group: sourceLeaf, state: { file: path } });
}

function openLinkedLocalGraph(app: App, path: string, sourceLeaf: WorkspaceLeaf | null | undefined): void {
  const leaf = app.workspace.splitLeafOrActive(sourceLeaf ?? app.workspace.activeLeaf, "vertical");
  void leaf.setViewState({ type: LOCAL_GRAPH_VIEW_TYPE, active: true, group: sourceLeaf ?? app.workspace.activeLeaf, state: { file: path } });
}
