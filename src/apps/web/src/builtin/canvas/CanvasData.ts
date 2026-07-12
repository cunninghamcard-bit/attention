export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEdgeEnd = "none" | "arrow";
export type CanvasNodeType = "file" | "text" | "link" | "group";

export interface CanvasBaseNodeData {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  [unknownNodeKey: string]: unknown;
}

export interface CanvasFileNodeData extends CanvasBaseNodeData {
  type: "file";
  file: string;
  subpath?: string;
}

export interface CanvasTextNodeData extends CanvasBaseNodeData {
  type: "text";
  text: string;
}

export interface CanvasLinkNodeData extends CanvasBaseNodeData {
  type: "link";
  url: string;
}

export interface CanvasGroupNodeData extends CanvasBaseNodeData {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: string;
}

export type CanvasNodeData = CanvasFileNodeData | CanvasTextNodeData | CanvasLinkNodeData | CanvasGroupNodeData;

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  fromSide: CanvasSide;
  toNode: string;
  toSide: CanvasSide;
  fromEnd?: CanvasEdgeEnd;
  toEnd?: CanvasEdgeEnd;
  color?: string;
  label?: string;
  [unknownEdgeKey: string]: unknown;
}

export interface CanvasData {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  [unknownTopLevelKey: string]: unknown;
}

export interface CanvasSelectionData {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  center: { x: number; y: number };
}

export const DEFAULT_CANVAS_DATA: CanvasData = { nodes: [], edges: [] };

export function parseCanvasData(source: string): CanvasData {
  if (!source.trim()) return { nodes: [], edges: [] };
  try {
    return normalizeCanvasData(JSON.parse(source));
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function serializeCanvasData(data: CanvasData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function normalizeCanvasData(value: unknown): CanvasData {
  const raw = value && typeof value === "object" ? value as Partial<CanvasData> : {};
  return {
    ...raw,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode).filter(Boolean) as CanvasNodeData[] : [],
    edges: Array.isArray(raw.edges) ? raw.edges.map(normalizeEdge).filter(Boolean) as CanvasEdgeData[] : [],
  };
}

export function createCanvasId(prefix = "canvas"): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function normalizeNode(raw: unknown): CanvasNodeData | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Partial<CanvasNodeData>;
  const base = {
    ...node,
    id: typeof node.id === "string" ? node.id : createCanvasId("node"),
    type: isNodeType(node.type) ? node.type : "text",
    x: numberOr(node.x, 0),
    y: numberOr(node.y, 0),
    width: Math.max(60, numberOr(node.width, 240)),
    height: Math.max(40, numberOr(node.height, 160)),
  };
  if (base.type === "file") return { ...base, type: "file", file: String((node as Partial<CanvasFileNodeData>).file ?? "") };
  if (base.type === "link") return { ...base, type: "link", url: String((node as Partial<CanvasLinkNodeData>).url ?? "") };
  if (base.type === "group") return { ...base, type: "group", label: String((node as Partial<CanvasGroupNodeData>).label ?? "") };
  return { ...base, type: "text", text: String((node as Partial<CanvasTextNodeData>).text ?? "") };
}

function normalizeEdge(raw: unknown): CanvasEdgeData | null {
  if (!raw || typeof raw !== "object") return null;
  const edge = raw as Partial<CanvasEdgeData>;
  if (!edge.fromNode || !edge.toNode) return null;
  return {
    ...edge,
    id: typeof edge.id === "string" ? edge.id : createCanvasId("edge"),
    fromNode: String(edge.fromNode),
    fromSide: isSide(edge.fromSide) ? edge.fromSide : "right",
    toNode: String(edge.toNode),
    toSide: isSide(edge.toSide) ? edge.toSide : "left",
    fromEnd: edge.fromEnd === "arrow" ? "arrow" : "none",
    toEnd: edge.toEnd === "none" ? "none" : "arrow",
  };
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isNodeType(value: unknown): value is CanvasNodeType {
  return value === "file" || value === "text" || value === "link" || value === "group";
}

function isSide(value: unknown): value is CanvasSide {
  return value === "top" || value === "right" || value === "bottom" || value === "left";
}
