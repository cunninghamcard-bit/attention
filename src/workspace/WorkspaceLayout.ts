import type { InternalViewState } from "../views/View";

export type WorkspaceLayoutNode =
  | {
      id: string;
      type: "split";
      direction: "vertical" | "horizontal";
      children: WorkspaceLayoutNode[];
      dimension?: number;
      collapsed?: boolean;
      width?: number;
    }
  | { id: string; type: "tabs"; currentTab?: number; stacked?: boolean; children: WorkspaceLayoutNode[]; dimension?: number }
  | { id: string; type: "mobile-drawer"; currentTab?: number; pinned?: boolean; children: WorkspaceLayoutNode[]; dimension?: number }
  | { id: string; type: "leaf"; state: InternalViewState; dimension?: number; group?: string; pinned?: boolean }
  | { id: string; type: "floating"; children: WorkspaceLayoutNode[]; dimension?: number }
  | {
      id: string;
      type: "window";
      direction?: "vertical" | "horizontal";
      children: WorkspaceLayoutNode[];
      dimension?: number;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      maximize?: boolean;
      zoom?: number;
    };

export interface WorkspaceLayout {
  main?: WorkspaceLayoutNode;
  left?: WorkspaceLayoutNode;
  right?: WorkspaceLayoutNode;
  floating?: WorkspaceLayoutNode;
  "left-ribbon"?: Record<string, unknown>;
  active?: string;
  activeLeafId?: string;
  lastOpenFiles?: string[];
}

export class WorkspaceLayoutStore {
  private layout: WorkspaceLayout | null = null;

  save(layout: WorkspaceLayout): void {
    this.layout = structuredClone(layout);
  }

  load(): WorkspaceLayout | null {
    return this.layout ? structuredClone(this.layout) : null;
  }

  clear(): void {
    this.layout = null;
  }
}
