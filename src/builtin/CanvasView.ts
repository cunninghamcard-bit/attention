import { Canvas, CANVAS_DEFAULT_FILE_NODE_DIMENSIONS, CANVAS_DEFAULT_TEXT_NODE_DIMENSIONS } from "../canvas/Canvas";
import { parseCanvasData, serializeCanvasData, type CanvasSelectionData, type CanvasNodeData, type CanvasSide } from "../canvas/CanvasData";
import type { CanvasEdge } from "../canvas/CanvasEdge";
import { CanvasNode } from "../canvas/CanvasNode";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { Menu } from "../ui/Menu";
import { TextFileView } from "../views/TextFileView";
import type { DragDropResult, DragSource, FileDragSource, FilesDragSource, FolderDragSource, LinkDragSource } from "../ui/drag/DragManager";
import { TFile, TFolder } from "../vault/TAbstractFile";
import { getAttachmentFilesFromDataTransfer, hasDataTransferAttachmentFiles, type AttachmentImportFile } from "../app/AttachmentImport";

const SVG_NS = "http://www.w3.org/2000/svg";

export class CanvasView extends TextFileView {
  readonly canvas = new Canvas(() => this.onCanvasChanged());
  icon = "lucide-layout-dashboard";
  private wrapperEl: HTMLElement | null = null;
  private moverEl: HTMLElement | null = null;
  private nodesEl: HTMLElement | null = null;
  private edgesEl: SVGSVGElement | null = null;
  private selectionEl: HTMLElement | null = null;
  private suppressBackgroundClick = false;
  private suppressChange = false;

  getViewType(): string { return "canvas"; }
  getDisplayText(): string { return this.file?.basename ?? "Canvas"; }

  setViewData(data: string, clearDirty = false): void {
    super.setViewData(data, clearDirty);
    this.suppressChange = true;
    this.canvas.importData(parseCanvasData(data));
    this.suppressChange = false;
    this.renderCanvas();
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.contentEl.classList.add("canvas-view");
    this.renderCanvas();
  }

  renderCanvas(): void {
    this.contentEl.replaceChildren();
    const wrapper = document.createElement("div");
    wrapper.className = "canvas-wrapper";
    wrapper.classList.toggle("mod-readonly", this.canvas.readonly);
    wrapper.classList.toggle("mod-snap-grid", this.canvas.snapToGrid);
    wrapper.classList.toggle("mod-snap-objects", this.canvas.snapToObjects);
    wrapper.tabIndex = 0;
    wrapper.addEventListener("pointerdown", (event) => this.startSelectionBox(event));
    wrapper.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    wrapper.addEventListener("click", (event) => {
      if (this.suppressBackgroundClick) {
        this.suppressBackgroundClick = false;
        return;
      }
      if (event.target === wrapper || event.target === this.moverEl) {
        this.canvas.deselectAll();
        this.renderCanvas();
      }
    });
    wrapper.addEventListener("copy", (event) => this.copySelection(event));
    wrapper.addEventListener("paste", (event) => this.pasteSelection(event));
    wrapper.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.app.dragManager.handleDrop(wrapper, (event, source, hovering) => this.handleCanvasDrop(event, source, hovering), true);
    wrapper.addEventListener("contextmenu", (event) => this.openSelectionMenu(event));

    const background = document.createElementNS(SVG_NS, "svg");
    background.classList.add("canvas-background");
    background.innerHTML = "<defs><pattern id=\"canvas-grid\" width=\"40\" height=\"40\" patternUnits=\"userSpaceOnUse\"><circle cx=\"1\" cy=\"1\" r=\"1\" /></pattern></defs><rect width=\"100%\" height=\"100%\" fill=\"url(#canvas-grid)\" />";

    const mover = document.createElement("div");
    mover.className = "canvas-mover";
    mover.style.transform = `translate(${this.canvas.viewport.x}px, ${this.canvas.viewport.y}px) scale(${this.canvas.viewport.zoom})`;
    const edges = document.createElementNS(SVG_NS, "svg");
    edges.classList.add("canvas-edges");
    const nodes = document.createElement("div");
    nodes.className = "canvas";
    mover.append(edges, nodes);

    const cardMenu = this.createCardMenu();
    const controls = this.createControls();
    wrapper.append(background, mover, cardMenu, controls, this.createMinimap());
    this.contentEl.appendChild(wrapper);
    this.wrapperEl = wrapper;
    this.moverEl = mover;
    this.nodesEl = nodes;
    this.edgesEl = edges;
    this.renderEdges();
    this.renderNodes();
  }

  generateHDImage(): string {
    const data = serializeCanvasData(this.canvas.getData());
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><foreignObject width="100%" height="100%"><pre xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(data)}</pre></foreignObject></svg>`)}`;
  }

  zoomToGroup(id: string): void {
    const group = this.canvas.nodes.get(id);
    if (!group) return;
    this.canvas.zoomToBbox({ x: group.x, y: group.y, width: group.width, height: group.height }, this.contentEl.clientWidth, this.contentEl.clientHeight);
    this.renderCanvas();
  }

  async convertSelectedTextNodeToFile(): Promise<boolean> {
    const node = this.canvas.getSingleSelectedTextNode();
    if (!node) return false;
    const title = firstLine(node.data.text) || "Canvas note";
    const file = await this.app.fileManager.createNewMarkdownFile(this.file?.parentPath ?? "", title);
    await this.app.vault.modify(file, node.data.text);
    this.canvas.updateNode(node.id, { type: "file", file: file.path } as Partial<CanvasNodeData>);
    return true;
  }

  private renderNodes(): void {
    if (!this.nodesEl) return;
    this.nodesEl.replaceChildren();
    for (const node of this.canvas.nodes.values()) this.nodesEl.appendChild(this.renderNode(node));
  }

  private renderNode(node: CanvasNode): HTMLElement {
    const nodeEl = document.createElement("div");
    nodeEl.className = `canvas-node canvas-node-${node.data.type}`;
    nodeEl.classList.toggle("is-selected", this.canvas.selection.has(node.id));
    if (node.data.type === "group") nodeEl.classList.add("canvas-node-group");
    if (node.data.type === "group" && node.data.backgroundStyle) nodeEl.classList.add(`mod-${node.data.backgroundStyle}`);
    nodeEl.dataset.nodeId = node.id;
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.style.width = `${node.width}px`;
    nodeEl.style.height = `${node.height}px`;
    if (node.data.color) nodeEl.style.setProperty("--canvas-node-color", node.data.color);
    if (node.data.type === "group" && node.data.background) nodeEl.style.background = node.data.background;
    nodeEl.addEventListener("pointerdown", (event) => this.startNodeDrag(event, node));
    nodeEl.addEventListener("contextmenu", (event) => this.openNodeMenu(event, node));

    const container = document.createElement("div");
    container.className = "canvas-node-container";
    const content = document.createElement("div");
    content.className = "canvas-node-content";
    this.renderNodeContent(content, node);
    const resizer = document.createElement("div");
    resizer.className = "canvas-node-resizer";
    resizer.addEventListener("pointerdown", (event) => this.startNodeResize(event, node));
    const connectionPoints = this.createConnectionPoints(node);
    container.append(content, resizer);
    nodeEl.append(container, connectionPoints);
    return nodeEl;
  }

  private renderNodeContent(content: HTMLElement, node: CanvasNode): void {
    if (node.data.type === "text") {
      content.contentEditable = String(!this.canvas.readonly);
      content.textContent = node.data.text;
      content.addEventListener("blur", () => this.canvas.updateNode(node.id, { text: content.textContent ?? "" } as Partial<CanvasNodeData>));
      return;
    }
    if (node.data.type === "file") {
      const title = document.createElement("div");
      title.className = "canvas-node-file-title";
      title.textContent = node.data.file;
      const preview = document.createElement("div");
      preview.className = "canvas-node-file-preview";
      const file = this.app.vault.getFileByPath(node.data.file);
      if (file && file.extension === "md") {
        void this.app.vault.read(file).then((source) => MarkdownRenderer.render(this.app, source, preview, file.path));
      } else {
        preview.textContent = file ? file.path : "Missing file";
      }
      content.append(title, preview);
      return;
    }
    if (node.data.type === "link") {
      const link = document.createElement("a");
      link.href = node.data.url;
      link.textContent = node.data.url;
      link.target = "_blank";
      const frame = document.createElement("iframe");
      frame.className = "canvas-link";
      frame.src = node.data.url;
      frame.setAttribute("sandbox", "allow-forms allow-same-origin allow-scripts allow-popups");
      content.append(link, frame);
      return;
    }
    const label = document.createElement("div");
    label.className = "canvas-group-label";
    label.contentEditable = String(!this.canvas.readonly);
    label.textContent = node.data.label ?? "Group";
    label.addEventListener("blur", () => this.canvas.updateNode(node.id, { label: label.textContent ?? "" } as Partial<CanvasNodeData>));
    content.appendChild(label);
  }

  private createConnectionPoints(node: CanvasNode): HTMLElement {
    const points = document.createElement("div");
    points.className = "canvas-node-connection-points";
    for (const side of ["top", "right", "bottom", "left"] as CanvasSide[]) {
      const point = document.createElement("div");
      point.className = `canvas-node-connection-point mod-${side}`;
      point.dataset.side = side;
      point.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        if (this.canvas.readonly) return;
        const source = [...this.canvas.selection].find((id) => id !== node.id);
        if (source) {
          this.canvas.createEdge(source, node.id, "right", side);
          this.renderCanvas();
        } else {
          this.app.workspace.trigger("canvas:node-connection-drop-menu", node, side, this);
        }
      });
      points.appendChild(point);
    }
    return points;
  }

  private renderEdges(): void {
    if (!this.edgesEl) return;
    this.edgesEl.replaceChildren();
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.innerHTML = "<marker id=\"canvas-arrow\" markerWidth=\"8\" markerHeight=\"8\" refX=\"7\" refY=\"4\" orient=\"auto\" markerUnits=\"strokeWidth\"><path d=\"M 0 0 L 8 4 L 0 8 z\" /></marker>";
    this.edgesEl.appendChild(defs);
    for (const edge of this.canvas.edges.values()) this.edgesEl.appendChild(this.renderEdge(edge));
  }

  private renderEdge(edge: CanvasEdge): SVGGElement {
    const group = document.createElementNS(SVG_NS, "g");
    group.classList.add("canvas-path");
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("canvas-path-visual");
    path.setAttribute("d", edge.getPath(this.canvas.nodes));
    if (edge.data.toEnd === "arrow") path.setAttribute("marker-end", "url(#canvas-arrow)");
    if (edge.data.color) path.setAttribute("stroke", edge.data.color);
    const interaction = document.createElementNS(SVG_NS, "path");
    interaction.classList.add("canvas-path-interaction");
    interaction.setAttribute("d", edge.getPath(this.canvas.nodes));
    interaction.addEventListener("contextmenu", (event) => this.openEdgeMenu(event, edge));
    group.append(path, interaction);
    if (edge.data.label) {
      const position = edge.getLabelPosition(this.canvas.nodes);
      const label = document.createElement("div");
      label.className = "canvas-path-label";
      label.contentEditable = String(!this.canvas.readonly);
      label.textContent = edge.data.label;
      label.addEventListener("blur", () => this.canvas.updateEdge(edge.id, { label: label.textContent ?? "" }));
      const foreign = document.createElementNS(SVG_NS, "foreignObject");
      foreign.setAttribute("x", String(position.x - 100));
      foreign.setAttribute("y", String(position.y - 20));
      foreign.setAttribute("width", "200");
      foreign.setAttribute("height", "40");
      foreign.appendChild(label);
      group.appendChild(foreign);
    }
    return group;
  }

  private createMinimap(): HTMLElement {
    const minimap = document.createElement("div");
    minimap.className = "canvas-minimap";
    const bounds = this.canvas.getBounds([...this.canvas.nodes.values()].map((node) => node.getData()));
    for (const node of this.canvas.nodes.values()) {
      const item = document.createElement("div");
      item.className = `canvas-minimap-node mod-${node.data.type}`;
      item.style.left = `${((node.x - bounds.x) / Math.max(bounds.width, 1)) * 100}%`;
      item.style.top = `${((node.y - bounds.y) / Math.max(bounds.height, 1)) * 100}%`;
      item.style.width = `${Math.max(4, (node.width / Math.max(bounds.width, 1)) * 100)}%`;
      item.style.height = `${Math.max(4, (node.height / Math.max(bounds.height, 1)) * 100)}%`;
      minimap.appendChild(item);
    }
    return minimap;
  }

  private createCardMenu(): HTMLElement {
    const menu = document.createElement("div");
    menu.className = "canvas-card-menu";
    menu.append(
      this.cardButton("Text", "lucide-type", () => this.createAtCenter("text")),
      this.cardButton("File", "lucide-file", () => this.createAtCenter("file")),
      this.cardButton("Link", "lucide-link", () => this.createAtCenter("link")),
      this.cardButton("Group", "lucide-box", () => this.createAtCenter("group")),
    );
    return menu;
  }

  private createControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "canvas-controls";
    controls.append(
      this.controlButton("Zoom in", "lucide-plus", () => { this.canvas.zoomBy(0.1); this.renderCanvas(); }),
      this.controlButton("Zoom out", "lucide-minus", () => { this.canvas.zoomBy(-0.1); this.renderCanvas(); }),
      this.controlButton("Fit", "lucide-scan", () => { this.canvas.zoomToFit(this.contentEl.clientWidth, this.contentEl.clientHeight); this.renderCanvas(); }),
      this.controlButton("Select all", "lucide-square-dashed-mouse-pointer", () => { this.canvas.selectAll(); this.renderCanvas(); }),
      this.controlButton("Delete", "lucide-trash", () => { if (!this.canvas.readonly) { this.canvas.deleteSelection(); this.renderCanvas(); } }),
      this.controlButton(this.canvas.snapToGrid ? "Snap grid on" : "Snap grid off", "lucide-grid-2x2", () => { this.canvas.snapToGrid = !this.canvas.snapToGrid; this.renderCanvas(); }),
      this.controlButton(this.canvas.readonly ? "Readonly on" : "Readonly off", "lucide-lock", () => { this.canvas.readonly = !this.canvas.readonly; this.renderCanvas(); }),
    );
    return controls;
  }

  private createAtCenter(type: "text" | "file" | "link" | "group"): void {
    if (this.canvas.readonly) return;
    const x = (this.contentEl.clientWidth / 2 - this.canvas.viewport.x) / this.canvas.viewport.zoom - 120;
    const y = (this.contentEl.clientHeight / 2 - this.canvas.viewport.y) / this.canvas.viewport.zoom - 80;
    if (type === "text") this.canvas.createTextNode("New text", x, y);
    if (type === "file") this.canvas.createFileNode(window.prompt("File path") ?? "", x, y);
    if (type === "link") this.canvas.createLinkNode(window.prompt("URL") ?? "https://obsidian.md", x, y);
    if (type === "group") this.canvas.createGroupNode("Group", x, y);
    this.renderCanvas();
  }

  private createAtPoint(type: "text" | "file" | "link" | "group", clientX: number, clientY: number, value = ""): void {
    if (this.canvas.readonly) return;
    const point = this.clientToCanvas(clientX, clientY);
    if (type === "text") this.canvas.createTextNode(value || "New text", point.x, point.y);
    if (type === "file") this.canvas.createFileNode(value, point.x, point.y);
    if (type === "link") this.canvas.createLinkNode(value || "https://obsidian.md", point.x, point.y);
    if (type === "group") this.canvas.createGroupNode(value || "Group", point.x, point.y);
    this.renderCanvas();
  }

  private cardButton(title: string, icon: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "canvas-card-menu-button";
    button.dataset.icon = icon;
    button.textContent = title;
    button.addEventListener("click", callback);
    return button;
  }

  private controlButton(title: string, icon: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "canvas-control-item";
    button.title = title;
    button.dataset.icon = icon;
    button.addEventListener("click", callback);
    return button;
  }

  private startNodeDrag(event: PointerEvent, node: CanvasNode): void {
    if (this.canvas.readonly) return;
    if ((event.target as HTMLElement).classList.contains("canvas-node-resizer")) return;
    event.stopPropagation();
    this.wrapperEl?.focus();
    if (event.shiftKey) this.canvas.toggleSelect(node.id);
    else this.canvas.selectOnly(node.id);
    const start = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.x) / this.canvas.viewport.zoom;
      const dy = (moveEvent.clientY - start.y) / this.canvas.viewport.zoom;
      this.canvas.moveNode(node.id, start.nodeX + dx, start.nodeY + dy);
      this.renderCanvas();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    this.renderCanvas();
  }

  private startSelectionBox(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (event.target !== this.wrapperEl && event.target !== this.moverEl) return;
    event.preventDefault();
    this.wrapperEl?.focus();
    const start = this.clientToCanvas(event.clientX, event.clientY);
    const screenStart = { x: event.clientX, y: event.clientY };
    const selectionEl = document.createElement("div");
    selectionEl.className = "canvas-selection";
    this.wrapperEl?.appendChild(selectionEl);
    this.selectionEl = selectionEl;
    const move = (moveEvent: PointerEvent) => {
      this.suppressBackgroundClick = true;
      const left = Math.min(screenStart.x, moveEvent.clientX);
      const top = Math.min(screenStart.y, moveEvent.clientY);
      selectionEl.style.left = `${left - (this.wrapperEl?.getBoundingClientRect().left ?? 0)}px`;
      selectionEl.style.top = `${top - (this.wrapperEl?.getBoundingClientRect().top ?? 0)}px`;
      selectionEl.style.width = `${Math.abs(moveEvent.clientX - screenStart.x)}px`;
      selectionEl.style.height = `${Math.abs(moveEvent.clientY - screenStart.y)}px`;
      const current = this.clientToCanvas(moveEvent.clientX, moveEvent.clientY);
      this.canvas.selectWithin({ x: start.x, y: start.y, width: current.x - start.x, height: current.y - start.y }, moveEvent.shiftKey);
      this.renderNodes();
    };
    const up = () => {
      selectionEl.remove();
      this.selectionEl = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.renderCanvas();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private startNodeResize(event: PointerEvent, node: CanvasNode): void {
    if (this.canvas.readonly) return;
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, width: node.width, height: node.height };
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.x) / this.canvas.viewport.zoom;
      const dy = (moveEvent.clientY - start.y) / this.canvas.viewport.zoom;
      node.resize(start.width + dx, start.height + dy);
      this.onCanvasChanged();
      this.renderCanvas();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private openNodeMenu(event: MouseEvent, node: CanvasNode): void {
    event.preventDefault();
    this.app.workspace.trigger("canvas:node-menu", node, this);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Delete").setIcon("lucide-trash").onClick(() => {
      if (this.canvas.readonly) return;
      this.canvas.selectOnly(node.id);
      this.canvas.deleteSelection();
      this.renderCanvas();
    }));
    menu.addItem((item) => item.setTitle("Connect to selected").setIcon("lucide-git-branch").onClick(() => {
      if (this.canvas.readonly) return;
      const target = [...this.canvas.selection].find((id) => id !== node.id);
      if (target) this.canvas.createEdge(node.id, target);
      else this.app.workspace.trigger("canvas:node-connection-drop-menu", node, this);
      this.renderCanvas();
    }));
    if (node.data.type === "text") {
      menu.addItem((item) => item.setTitle("Convert to file").setIcon("lucide-file-plus").onClick(() => void this.convertSelectedTextNodeToFile()));
    }
    menu.showAtMouseEvent(event);
  }

  private openEdgeMenu(event: MouseEvent, edge: CanvasEdge): void {
    event.preventDefault();
    this.app.workspace.trigger("canvas:edge-menu", edge, this);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Edit label").setIcon("lucide-text").onClick(() => {
      if (this.canvas.readonly) return;
      const label = window.prompt("Edge label", edge.data.label ?? "");
      if (label != null) this.canvas.updateEdge(edge.id, { label });
      this.renderCanvas();
    }));
    menu.addItem((item) => item.setTitle("Remove").setIcon("lucide-trash").onClick(() => {
      if (this.canvas.readonly) return;
      this.canvas.edges.delete(edge.id);
      this.onCanvasChanged();
      this.renderCanvas();
    }));
    menu.showAtMouseEvent(event);
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) this.canvas.zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
    else this.canvas.panBy(-event.deltaX, -event.deltaY);
    this.renderCanvas();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (this.canvas.readonly) return;
    if ((event.key === "Backspace" || event.key === "Delete") && this.canvas.selection.size > 0) {
      event.preventDefault();
      this.canvas.deleteSelection();
      this.renderCanvas();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.canvas.selectAll();
      this.renderCanvas();
    }
  }

  private copySelection(event: ClipboardEvent): void {
    const data = this.canvas.getSelectionData();
    if (data.nodes.length === 0) return;
    event.clipboardData?.setData("obsidian/canvas", JSON.stringify(data));
    event.preventDefault();
  }

  private pasteSelection(event: ClipboardEvent): void {
    const raw = event.clipboardData?.getData("obsidian/canvas");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as CanvasSelectionData;
      const center = this.clientToCanvas(this.contentEl.clientWidth / 2, this.contentEl.clientHeight / 2);
      this.canvas.importSelection(data, center);
      this.renderCanvas();
      event.preventDefault();
    } catch {
      return;
    }
  }

  private onCanvasChanged(): void {
    if (this.suppressChange) return;
    super.setViewData(serializeCanvasData(this.canvas.getData()));
    this.scheduleSave();
  }

  private handleCanvasDrop(event: DragEvent, source: DragSource | null, hovering: boolean): DragDropResult {
    if (this.canvas.readonly) return undefined;
    if (source) return this.handleInternalCanvasDrop(event, source, hovering);
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return undefined;

    const point = this.clientToCanvas(event.clientX, event.clientY);
    if (hasDataTransferAttachmentFiles(dataTransfer)) {
      if (!hovering) void this.importExternalFiles(getAttachmentFilesFromDataTransfer(dataTransfer), point);
      return { dropEffect: "copy" };
    }

    const text = getDataTransferData(dataTransfer, "text/plain");
    if (isCanvasUrlText(text)) {
      if (!hovering) {
        const topLeft = centerToTopLeft(point, CANVAS_DEFAULT_FILE_NODE_DIMENSIONS);
        this.canvas.createLinkNode(text.trim(), topLeft.x, topLeft.y);
        this.renderCanvas();
      }
      return { dropEffect: "link" };
    }

    if (text) {
      if (!hovering) {
        const topLeft = centerToTopLeft(point, CANVAS_DEFAULT_TEXT_NODE_DIMENSIONS);
        this.canvas.createTextNode(text, topLeft.x, topLeft.y);
        this.renderCanvas();
      }
      return { dropEffect: "copy" };
    }

    return undefined;
  }

  private handleInternalCanvasDrop(event: DragEvent, source: DragSource, hovering: boolean): DragDropResult {
    if (!hovering) {
      const point = this.clientToCanvas(event.clientX, event.clientY);
      if (isFileDragSource(source)) {
        this.canvas.createFileNode(source.file.path, point.x, point.y);
        this.renderCanvas();
        this.wrapperEl?.focus();
      } else if (isLinkDragSource(source)) {
        if (source.file instanceof TFile) this.canvas.createFileNode(source.file.path, point.x, point.y);
        this.renderCanvas();
        this.wrapperEl?.focus();
      } else if (isFilesDragSource(source)) {
        const files = collectFilesFromDragItems(source.files, true);
        if (files.length) {
          const nodes = this.canvas.createFileNodes(files.map((file) => file.path), point.x, point.y);
          this.canvas.selectNodes(nodes);
          this.renderCanvas();
        }
        this.wrapperEl?.focus();
      } else if (isFolderDragSource(source)) {
        const files = collectFilesFromFolder(source.file);
        if (files.length) {
          this.canvas.createFileNodes(files.map((file) => file.path), point.x, point.y);
          this.renderCanvas();
        }
        this.wrapperEl?.focus();
      }
    }

    return { dropEffect: "copy" };
  }

  private async importExternalFiles(files: AttachmentImportFile[], point: { x: number; y: number }): Promise<void> {
    const imported = await this.app.importAttachments(files, null, this.file);
    const importedPaths = imported.map((file) => file.path);
    if (!importedPaths.length) return;
    this.canvas.createFileNodes(importedPaths, point.x, point.y);
    this.renderCanvas();
  }

  private openSelectionMenu(event: MouseEvent): void {
    if (event.target !== this.wrapperEl && event.target !== this.moverEl) return;
    event.preventDefault();
    this.app.workspace.trigger("canvas:selection-menu", this.canvas.selection, this);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("New text").setIcon("lucide-type").onClick(() => this.createAtPoint("text", event.clientX, event.clientY)));
    menu.addItem((item) => item.setTitle("New group").setIcon("lucide-box").onClick(() => this.createAtPoint("group", event.clientX, event.clientY)));
    menu.addItem((item) => item.setTitle("Paste").setIcon("lucide-clipboard").onClick(() => void navigator.clipboard?.readText?.().then((text) => {
      if (text) this.createAtPoint("text", event.clientX, event.clientY, text);
    })));
    menu.showAtMouseEvent(event);
  }

  private clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.wrapperEl?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    const y = rect ? clientY - rect.top : clientY;
    return {
      x: (x - this.canvas.viewport.x) / this.canvas.viewport.zoom,
      y: (y - this.canvas.viewport.y) / this.canvas.viewport.zoom,
    };
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char] ?? char));
}

function getDataTransferData(dataTransfer: DataTransfer, format: string): string {
  try {
    return dataTransfer.getData(format);
  } catch {
    return "";
  }
}

function isCanvasUrlText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function centerToTopLeft(point: { x: number; y: number }, size: { width: number; height: number }): { x: number; y: number } {
  return {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
  };
}

function isFileDragSource(source: DragSource): source is FileDragSource {
  return source.type === "file" && (source as Partial<FileDragSource>).file instanceof TFile;
}

function isFilesDragSource(source: DragSource): source is FilesDragSource {
  return source.type === "files" && Array.isArray((source as Partial<FilesDragSource>).files);
}

function isFolderDragSource(source: DragSource): source is FolderDragSource {
  return source.type === "folder" && (source as Partial<FolderDragSource>).file instanceof TFolder;
}

function isLinkDragSource(source: DragSource): source is LinkDragSource {
  return source.type === "link";
}

function collectFilesFromDragItems(items: Array<TFile | TFolder>, unique: boolean): TFile[] {
  const files = unique ? new Set<TFile>() : null;
  const list: TFile[] = [];
  for (const item of items) {
    if (item instanceof TFile) {
      if (files) files.add(item);
      else list.push(item);
    } else if (item instanceof TFolder) {
      for (const child of collectFilesFromFolder(item)) {
        if (files) files.add(child);
        else list.push(child);
      }
    }
  }
  return sortCanvasFiles(files ? [...files] : list);
}

function collectFilesFromFolder(folder: TFolder): TFile[] {
  const files: TFile[] = [];
  recurseFolder(folder, files);
  return sortCanvasFiles(files);
}

function recurseFolder(folder: TFolder, files: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFile) files.push(child);
    else if (child instanceof TFolder) recurseFolder(child, files);
  }
}

function sortCanvasFiles(files: TFile[]): TFile[] {
  return files.sort((a, b) => a.basename.localeCompare(b.basename));
}
