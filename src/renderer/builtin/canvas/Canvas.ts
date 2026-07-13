import {
  createCanvasId,
  normalizeCanvasData,
  type CanvasSide,
  type CanvasData,
  type CanvasEdgeData,
  type CanvasGroupNodeData,
  type CanvasNodeData,
  type CanvasSelectionData,
  type CanvasTextNodeData,
} from "./CanvasData";
import { CanvasEdge } from "./CanvasEdge";
import { CanvasNode } from "./CanvasNode";

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
  tZoom: number;
}

export const CANVAS_DEFAULT_TEXT_NODE_DIMENSIONS = { width: 260, height: 160 };
export const CANVAS_DEFAULT_FILE_NODE_DIMENSIONS = { width: 320, height: 200 };
export const CANVAS_FILE_NODE_GAP = 45;
export const CANVAS_FILE_NODE_COLUMNS = 10;

export class Canvas {
  readonly nodes = new Map<string, CanvasNode>();
  readonly edges = new Map<string, CanvasEdge>();
  readonly selection = new Set<string>();
  viewport: CanvasViewport = { x: 0, y: 0, zoom: 1, tZoom: 1 };
  snapToGrid = false;
  snapToObjects = true;
  readonly = false;
  readonly unknownData: Record<string, unknown> = {};

  constructor(readonly onChange: () => void = () => {}) {}

  importData(data: CanvasData): void {
    const normalized = normalizeCanvasData(data);
    this.nodes.clear();
    this.edges.clear();
    this.selection.clear();
    for (const [key, value] of Object.entries(normalized)) {
      if (key !== "nodes" && key !== "edges") this.unknownData[key] = value;
    }
    for (const node of normalized.nodes) this.nodes.set(node.id, new CanvasNode(node));
    for (const edge of normalized.edges) this.edges.set(edge.id, new CanvasEdge(edge));
  }

  getData(): CanvasData {
    return {
      ...this.unknownData,
      nodes: [...this.nodes.values()].map((node) => node.getData()),
      edges: [...this.edges.values()].map((edge) => edge.getData()),
    };
  }

  getSelectionData(): CanvasSelectionData {
    const nodes = [...this.selection]
      .map((id) => this.nodes.get(id))
      .filter(Boolean)
      .map((node) => (node as CanvasNode).getData());
    const selected = new Set(nodes.map((node) => node.id));
    const edges = [...this.edges.values()]
      .filter((edge) => selected.has(edge.data.fromNode) && selected.has(edge.data.toNode))
      .map((edge) => edge.getData());
    const bbox = this.getBounds(nodes);
    return {
      nodes,
      edges,
      center: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
    };
  }

  createTextNode(text = "", x = 0, y = 0): CanvasNode<CanvasTextNodeData> {
    const node = new CanvasNode({
      id: createCanvasId("node"),
      type: "text",
      x,
      y,
      width: CANVAS_DEFAULT_TEXT_NODE_DIMENSIONS.width,
      height: CANVAS_DEFAULT_TEXT_NODE_DIMENSIONS.height,
      text,
    });
    this.nodes.set(node.id, node);
    this.selectOnly(node.id);
    this.onChange();
    return node;
  }

  createFileNode(file: string, x = 0, y = 0): CanvasNode {
    const node = new CanvasNode({
      id: createCanvasId("node"),
      type: "file",
      x,
      y,
      width: CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.width,
      height: CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.height,
      file,
    });
    this.nodes.set(node.id, node);
    this.selectOnly(node.id);
    this.onChange();
    return node;
  }

  createFileNodes(files: string[], x = 0, y = 0): CanvasNode[] {
    const nodes: CanvasNode[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const node = new CanvasNode({
        id: createCanvasId("node"),
        type: "file",
        x:
          x +
          (CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.width + CANVAS_FILE_NODE_GAP) *
            (index % CANVAS_FILE_NODE_COLUMNS),
        y:
          y +
          (CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.height + CANVAS_FILE_NODE_GAP) *
            Math.trunc(index / CANVAS_FILE_NODE_COLUMNS),
        width: CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.width,
        height: CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.height,
        file: files[index],
      });
      this.nodes.set(node.id, node);
      nodes.push(node);
    }
    if (nodes.length) this.onChange();
    return nodes;
  }

  createLinkNode(url: string, x = 0, y = 0): CanvasNode {
    const node = new CanvasNode({
      id: createCanvasId("node"),
      type: "link",
      x,
      y,
      width: CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.width,
      height: CANVAS_DEFAULT_FILE_NODE_DIMENSIONS.height,
      url,
    });
    this.nodes.set(node.id, node);
    this.selectOnly(node.id);
    this.onChange();
    return node;
  }

  createGroupNode(label = "Group", x = 0, y = 0): CanvasNode<CanvasGroupNodeData> {
    const node = new CanvasNode({
      id: createCanvasId("node"),
      type: "group",
      x,
      y,
      width: 480,
      height: 320,
      label,
    });
    this.nodes.set(node.id, node);
    this.selectOnly(node.id);
    this.onChange();
    return node;
  }

  createEdge(
    fromNode: string,
    toNode: string,
    fromSide: CanvasSide = "right",
    toSide: CanvasSide = "left",
  ): CanvasEdge {
    const edge = new CanvasEdge({
      id: createCanvasId("edge"),
      fromNode,
      fromSide,
      toNode,
      toSide,
      fromEnd: "none",
      toEnd: "arrow",
    });
    this.edges.set(edge.id, edge);
    this.onChange();
    return edge;
  }

  importSelection(data: CanvasSelectionData, center: { x: number; y: number }): void {
    const idMap = new Map<string, string>();
    const dx = center.x - data.center.x;
    const dy = center.y - data.center.y;
    this.selection.clear();
    for (const node of data.nodes) {
      const clone = { ...node, id: createCanvasId("node"), x: node.x + dx, y: node.y + dy };
      idMap.set(node.id, clone.id);
      this.nodes.set(clone.id, new CanvasNode(clone));
      this.selection.add(clone.id);
    }
    for (const edge of data.edges) {
      const fromNode = idMap.get(edge.fromNode);
      const toNode = idMap.get(edge.toNode);
      if (!fromNode || !toNode) continue;
      const id = createCanvasId("edge");
      this.edges.set(
        id,
        new CanvasEdge({
          ...edge,
          id,
          fromNode,
          toNode,
        }),
      );
    }
    this.onChange();
  }

  selectOnly(id: string): void {
    this.selection.clear();
    this.selection.add(id);
  }

  toggleSelect(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
  }

  deselectAll(): void {
    this.selection.clear();
  }

  select(id: string): void {
    if (this.nodes.has(id)) this.selection.add(id);
  }

  selectNodes(nodes: CanvasNode[]): void {
    this.selection.clear();
    for (const node of nodes) this.selection.add(node.id);
  }

  selectAll(): void {
    this.selection.clear();
    for (const id of this.nodes.keys()) this.selection.add(id);
  }

  selectWithin(
    rect: { x: number; y: number; width: number; height: number },
    additive = false,
  ): void {
    if (!additive) this.selection.clear();
    const left = Math.min(rect.x, rect.x + rect.width);
    const right = Math.max(rect.x, rect.x + rect.width);
    const top = Math.min(rect.y, rect.y + rect.height);
    const bottom = Math.max(rect.y, rect.y + rect.height);
    for (const node of this.nodes.values()) {
      const overlaps =
        node.x < right &&
        node.x + node.width > left &&
        node.y < bottom &&
        node.y + node.height > top;
      if (overlaps) this.selection.add(node.id);
    }
  }

  deleteSelection(): void {
    const selected = new Set(this.selection);
    for (const id of selected) this.nodes.delete(id);
    for (const [id, edge] of this.edges.entries()) {
      if (selected.has(edge.data.fromNode) || selected.has(edge.data.toNode) || selected.has(id))
        this.edges.delete(id);
    }
    this.selection.clear();
    this.onChange();
  }

  moveNode(id: string, x: number, y: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const next = this.snapToGrid ? snapPoint(x, y) : { x, y };
    node.moveTo(next.x, next.y);
    this.onChange();
  }

  updateNode(id: string, update: Partial<CanvasNodeData>): void {
    const node = this.nodes.get(id);
    if (!node) return;
    Object.assign(node.data, update);
    this.onChange();
  }

  updateEdge(id: string, update: Partial<CanvasEdgeData>): void {
    const edge = this.edges.get(id);
    if (!edge) return;
    Object.assign(edge.data, update);
    this.onChange();
  }

  zoomBy(delta: number): void {
    this.viewport.zoom = Math.max(0.1, Math.min(4, this.viewport.zoom + delta));
    this.viewport.tZoom = this.viewport.zoom;
  }

  panBy(dx: number, dy: number): void {
    this.viewport.x += dx;
    this.viewport.y += dy;
  }

  zoomToBbox(
    bbox: { x: number; y: number; width: number; height: number },
    viewportWidth = 800,
    viewportHeight = 600,
  ): void {
    const zoom = Math.max(
      0.1,
      Math.min(
        2,
        Math.min(
          viewportWidth / Math.max(1, bbox.width),
          viewportHeight / Math.max(1, bbox.height),
        ) * 0.8,
      ),
    );
    this.viewport.zoom = zoom;
    this.viewport.tZoom = zoom;
    this.viewport.x = viewportWidth / 2 - (bbox.x + bbox.width / 2) * zoom;
    this.viewport.y = viewportHeight / 2 - (bbox.y + bbox.height / 2) * zoom;
  }

  zoomToFit(width?: number, height?: number): void {
    this.zoomToBbox(
      this.getBounds([...this.nodes.values()].map((node) => node.getData())),
      width,
      height,
    );
  }

  zoomToSelection(width?: number, height?: number): void {
    const data = this.getSelectionData();
    if (data.nodes.length > 0) this.zoomToBbox(this.getBounds(data.nodes), width, height);
  }

  getSingleSelectedTextNode(): CanvasNode<CanvasTextNodeData> | null {
    if (this.selection.size !== 1) return null;
    const node = this.nodes.get([...this.selection][0]);
    return node?.data.type === "text" ? (node as CanvasNode<CanvasTextNodeData>) : null;
  }

  getGroupNodes(): Array<CanvasNode<CanvasGroupNodeData>> {
    return [...this.nodes.values()].filter(
      (node): node is CanvasNode<CanvasGroupNodeData> => node.data.type === "group",
    );
  }

  getBounds(nodes: CanvasNodeData[]): { x: number; y: number; width: number; height: number } {
    if (nodes.length === 0) return { x: -200, y: -120, width: 400, height: 240 };
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}

function snapPoint(x: number, y: number): { x: number; y: number } {
  const grid = 20;
  return { x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid };
}
