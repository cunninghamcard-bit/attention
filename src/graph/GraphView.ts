import type { App } from "../app/App";
import { ItemView } from "../views/ItemView";
import type { Menu } from "../ui/Menu";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { GraphControls } from "./GraphControls";
import { GraphDataEngine } from "./GraphDataEngine";
import type { GraphNode } from "./GraphDataEngine";
import { GraphRenderer } from "./GraphRenderer";
import type { GraphPluginOptions } from "./GraphOptions";
import { assignGraphPluginOptions, cloneGraphPluginOptions, createDefaultGraphPluginOptions } from "./GraphOptions";
import { ensureGraphStyles } from "./GraphStyles";

export interface GraphViewCallbacks {
  onOptionsChange?: (options: GraphPluginOptions) => void;
}

interface GraphViewState extends Record<string, unknown> {
  file?: string;
  query?: string;
  options?: Partial<GraphPluginOptions>;
}

export class GraphView extends ItemView {
  protected readonly options: GraphPluginOptions;
  protected readonly dataEngine: GraphDataEngine;
  protected controls: GraphControls | null = null;
  protected renderer: GraphRenderer | null = null;
  protected graphContainerEl: HTMLElement | null = null;
  protected local = false;
  protected animating = false;

  constructor(leaf: WorkspaceLeaf, options: GraphPluginOptions = createDefaultGraphPluginOptions(), protected readonly callbacks: GraphViewCallbacks = {}) {
    super(leaf);
    this.options = options;
    this.dataEngine = new GraphDataEngine(this.app as App);
  }

  getViewType(): string { return "graph"; }

  getDisplayText(): string {
    return "Graph view";
  }

  async onOpen(): Promise<void> {
    ensureGraphStyles();
    this.contentEl.classList.add("graph-view");
    this.installActions();
    this.renderFrame();
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      if (!this.local) return;
      const linkedFile = this.getLinkedFile();
      const nextPath = linkedFile?.path ?? this.options.filterOptions.localFile;
      if (nextPath === this.options.filterOptions.localFile) return;
      this.options.filterOptions.localFile = nextPath;
      this.renderer?.resetPan();
      this.refresh();
    }));
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.renderer?.destroy();
    this.renderer = null;
    this.controls = null;
    await super.onClose();
  }

  async setState(state: unknown): Promise<void> {
    await super.setState(state);
    if (state && typeof state === "object") {
      const next = state as GraphViewState;
      if (typeof next.file === "string") this.options.filterOptions.localFile = next.file;
      if (typeof next.query === "string") this.options.filterOptions.query = next.query;
      if (next.options) assignGraphPluginOptions(this.options, next.options);
    }
    this.refresh();
  }

  getState(): GraphViewState {
    return {
      file: this.options.filterOptions.localFile ?? undefined,
      query: this.options.filterOptions.query,
      options: this.local ? cloneGraphPluginOptions(this.options) : undefined,
    };
  }

  showSearch(): void {
    this.controls?.focusSearch();
  }

  toggleAnimation(): void {
    if (this.local) return;
    this.animating = !this.animating;
    this.renderer?.setAnimating(this.animating);
    this.controls?.render(this.getOuterEl());
  }

  copyScreenshot(): HTMLCanvasElement | null {
    const screenshot = this.renderer?.getTransparentScreenshot() ?? null;
    if (screenshot) void GraphRenderer.copyToClipboard(screenshot, "image/png");
    return screenshot;
  }

  onMoreOptionsMenu(menu: Menu): void {
    menu.addItem((item) => item
      .setTitle("Copy screenshot")
      .setIcon("lucide-camera")
      .onClick(() => this.copyScreenshot()));
  }

  protected renderFrame(): void {
    this.contentEl.replaceChildren();
    const outerEl = document.createElement("div");
    outerEl.className = "graph-view-outer";
    this.contentEl.appendChild(outerEl);

    this.controls = new GraphControls(this.options, {
      isLocal: this.local,
      isAnimating: () => this.animating,
      onChange: () => this.onOptionsChange(),
      onResetPan: () => this.renderer?.resetPan(),
      onToggleAnimate: () => this.toggleAnimation(),
    });
    this.controls.render(outerEl);

    this.graphContainerEl = document.createElement("div");
    this.graphContainerEl.className = "graph-view-container";
    outerEl.appendChild(this.graphContainerEl);
    this.renderer = new GraphRenderer(this.graphContainerEl, {
      onNodeClick: (node, event) => this.openNode(node, event),
      onNodeRightClick: (node, event) => this.openNodeMenu(node, event),
      onScaleChange: (scale) => {
        this.options.scale = scale;
        this.onOptionsChange();
      },
    });
    this.renderer.setScale(this.options.scale);
  }

  protected refresh(): void {
    if (!this.renderer) return;
    if (this.local && !this.options.filterOptions.localFile) {
      this.options.filterOptions.localFile = this.getLinkedFile()?.path ?? null;
    }
    const data = this.dataEngine.collect(this.options.filterOptions, this.local, this.options.colorGroups);
    this.renderer.setScale(this.options.scale);
    this.renderer.setRenderOptions(this.options.displayOptions);
    this.renderer.setForces(this.options.forceOptions);
    this.renderer.setData(data);
  }

  protected onOptionsChange(): void {
    this.refresh();
    if (this.local) this.app.workspace.requestSaveLayout();
    else this.callbacks.onOptionsChange?.(this.options);
  }

  protected openNode(node: GraphNode, event?: MouseEvent | PointerEvent): void {
    if (node.type === "tag") {
      this.openGlobalSearch(`tag:${node.id.replace(/^#/, "")}`);
      return;
    }
    void this.app.workspace.openLinkText(node.id, "", undefined, { active: !isModEvent(event) });
  }

  protected openNodeMenu(node: GraphNode, event: MouseEvent): void {
    if (node.type === "tag") {
      this.openGlobalSearch(`tag:${node.id.replace(/^#/, "")}`);
      return;
    }
    const file = this.app.metadataCache.getFirstLinkpathDest(node.id, "");
    if (!file) return;
    this.app.menus.createFileMenu(file, "graph-context-menu", this.leaf).showAtMouseEvent(event);
  }

  protected openGlobalSearch(query: string): void {
    void this.app.workspace.ensureSideLeaf("search", "left", { active: true, reveal: true }).then((leaf) => {
      const view = leaf.view as unknown as { focusSearch?: (query: string) => void };
      view.focusSearch?.(query);
    });
  }

  protected installActions(): void {
    this.actionsEl.appendChild(this.createActionButton("Search graph", "lucide-search", () => this.showSearch()));
    this.actionsEl.appendChild(this.createActionButton("Reset graph", "lucide-refresh-cw", () => {
      this.renderer?.resetPan();
      this.refresh();
    }));
    this.actionsEl.appendChild(this.createActionButton("Copy graph screenshot", "lucide-camera", () => this.copyScreenshot()));
  }

  protected createActionButton(title: string, icon: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "view-action clickable-icon";
    button.type = "button";
    button.title = title;
    button.dataset.icon = icon;
    button.addEventListener("click", callback);
    return button;
  }

  protected getOuterEl(): HTMLElement {
    const outerEl = this.contentEl.querySelector<HTMLElement>(".graph-view-outer");
    return outerEl ?? this.contentEl;
  }

  protected getLinkedFile(): { path: string } | null {
    if (this.leaf.group) {
      const leaves = this.app.workspace.getGroupLeaves(this.leaf.group);
      for (const leaf of leaves) {
        if (leaf === this.leaf) continue;
        const groupedView = leaf.view as ({ file?: { path: string } | null } | null);
        if (groupedView?.file) return groupedView.file;
      }
    }
    return this.app.workspace.getActiveFile();
  }
}

function isModEvent(event: MouseEvent | PointerEvent | undefined): boolean {
  return !!event && (event.metaKey || event.ctrlKey || event.button === 1);
}

export class LocalGraphView extends GraphView {
  constructor(leaf: WorkspaceLeaf, options: GraphPluginOptions = createDefaultGraphPluginOptions()) {
    super(leaf, cloneGraphPluginOptions(options));
    this.local = true;
  }

  getViewType(): string { return "localgraph"; }

  getDisplayText(): string {
    const path = this.options.filterOptions.localFile ?? this.getLinkedFile()?.path;
    return path ? `Local graph: ${path.split("/").pop()}` : "Local graph";
  }
}
