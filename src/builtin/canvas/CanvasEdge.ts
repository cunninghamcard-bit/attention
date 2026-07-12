import type { CanvasEdgeData } from "./CanvasData";
import type { CanvasNode } from "./CanvasNode";

export class CanvasEdge {
  selected = false;

  constructor(readonly data: CanvasEdgeData) {}

  get id(): string { return this.data.id; }

  getData(): CanvasEdgeData {
    return { ...this.data };
  }

  getPath(nodes: Map<string, CanvasNode>): string {
    const from = nodes.get(this.data.fromNode);
    const to = nodes.get(this.data.toNode);
    if (!from || !to) return "";
    const start = sidePoint(from, this.data.fromSide);
    const end = sidePoint(to, this.data.toSide);
    const dx = Math.max(80, Math.abs(end.x - start.x) / 2);
    const c1 = controlPoint(start, this.data.fromSide, dx);
    const c2 = controlPoint(end, this.data.toSide, dx);
    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
  }

  getLabelPosition(nodes: Map<string, CanvasNode>): { x: number; y: number } {
    const from = nodes.get(this.data.fromNode);
    const to = nodes.get(this.data.toNode);
    if (!from || !to) return { x: 0, y: 0 };
    const start = sidePoint(from, this.data.fromSide);
    const end = sidePoint(to, this.data.toSide);
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
}

function sidePoint(node: CanvasNode, side: string): { x: number; y: number } {
  if (side === "top") return { x: node.x + node.width / 2, y: node.y };
  if (side === "bottom") return { x: node.x + node.width / 2, y: node.y + node.height };
  if (side === "left") return { x: node.x, y: node.y + node.height / 2 };
  return { x: node.x + node.width, y: node.y + node.height / 2 };
}

function controlPoint(point: { x: number; y: number }, side: string, distance: number): { x: number; y: number } {
  if (side === "top") return { x: point.x, y: point.y - distance };
  if (side === "bottom") return { x: point.x, y: point.y + distance };
  if (side === "left") return { x: point.x - distance, y: point.y };
  return { x: point.x + distance, y: point.y };
}
