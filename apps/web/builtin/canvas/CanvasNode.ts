import type { CanvasNodeData } from "./CanvasData";

export class CanvasNode<T extends CanvasNodeData = CanvasNodeData> {
  selected = false;

  constructor(readonly data: T) {}

  get id(): string {
    return this.data.id;
  }
  get type(): string {
    return this.data.type;
  }
  get x(): number {
    return this.data.x;
  }
  get y(): number {
    return this.data.y;
  }
  get width(): number {
    return this.data.width;
  }
  get height(): number {
    return this.data.height;
  }

  moveTo(x: number, y: number): void {
    this.data.x = x;
    this.data.y = y;
  }

  resize(width: number, height: number): void {
    this.data.width = Math.max(60, width);
    this.data.height = Math.max(40, height);
  }

  getData(): T {
    return { ...this.data };
  }

  containsPoint(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }

  center(): { x: number; y: number } {
    return { x: this.x + this.width / 2, y: this.y + this.height / 2 };
  }
}
